import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, PenLine, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import ManualQuestions from '../components/questions/ManualQuestions.jsx'
import PaperPicker from '../components/questions/PaperPicker.jsx'
import ExtractionProgress from '../components/questions/ExtractionProgress.jsx'
import QuestionResults from '../components/questions/QuestionResults.jsx'
import SaveQuestionSet from '../components/saved/SaveQuestionSet.jsx'
import { SOURCE_PAPERS } from '../utils/savedQuestions.js'
import { DifficultyField, MarksField, QuestionTypeField } from '../components/questions/QuestionOptions.jsx'
import { Alert, Button, Card, Loader, Select, Skeleton, StatusMessage } from '../components/ui'
import useMaterials from '../hooks/useMaterials.js'
import useAcademicSelection from '../hooks/useAcademicSelection.js'
import useAuth from '../hooks/useAuth.js'
import useManualQuestions from '../hooks/useManualQuestions.js'
import { extractMaterial, fetchMaterial } from '../services/materialService.js'
import { generateImportantQuestions } from '../services/questionService.js'
import { extractPapers, initialProgress, needsExtraction } from '../utils/paperExtraction.js'
import { isAdmin } from '../utils/roles.js'
import {
  DEFAULT_DIFFICULTY, buildRequest, defaultPaperSelection, describeServerErrors, emptyCounts, normalizeResult, totalQuestions, unusedTypes, validateGeneration,
  orderTypes, typeLabel, MAX_PAPERS,
} from '../utils/questionGeneration.js'

// Same list the paper picker starts with (newest first, no filter); the automatic selection is taken from it.
const DEFAULT_PAGE_SIZE = 10

/** AI question generation from the student's selected uploaded papers (questions only, no answers). */
function GenerateQuestions() {
  const { user } = useAuth()
  const userId = user?._id || user?.id || ''
  const admin = isAdmin(user)
  const [mode, setMode] = useState('papers') // 'papers' = AI from uploaded papers, 'manual' = the student's own questions
  const manual = useManualQuestions(userId)
  // The academic details are not chosen here: this is the selection made in Academics (and the saved profile semester).
  const selection = useAcademicSelection(user)
  const { subjects, semesterId, regulationId, universityId, department, selectedSemester } = selection

  const [paperScope, setPaperScope] = useState('all') // admin only: papers of 'all' students, or only the admin's 'mine'
  const [subjectPick, setSubjectPick] = useState('')
  // null = the automatic selection (newest eligible papers); an object = the person's own choice, kept across pages of the list
  const [customPapers, setCustomPapers] = useState(null)
  const defaultList = useMaterials({ search: '', materialType: '', sort: 'newest', uploadedBy: admin ? userId : '', page: 1, limit: DEFAULT_PAGE_SIZE })
  const defaultPapers = useMemo(() => defaultPaperSelection(defaultList.items), [defaultList.items])
  const papers = customPapers ?? defaultPapers
  const [questionTypes, setQuestionTypes] = useState([])
  const [difficulty, setDifficulty] = useState(DEFAULT_DIFFICULTY)
  const [counts, setCounts] = useState(emptyCounts)
  const [submitted, setSubmitted] = useState(false) // show client-side problems only after the first attempt
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null) // { data (normalised), papers: [{ _id, title }] }
  const [failure, setFailure] = useState(null) // { signature, message, lines }
  const [extraction, setExtraction] = useState(null) // { items: [{ _id, title, state, message }], phase: 'extracting' | 'generating' } while / after reading the papers
  const [extractedIds, setExtractedIds] = useState(() => new Set()) // papers whose text was read in this visit: not read again on a retry
  const resultsRef = useRef(null)
  const controllerRef = useRef(null)

  // A subject belongs to one semester: a choice that is not in the loaded list is no choice.
  const subjectId = subjects.options.some((s) => s._id === subjectPick) ? subjectPick : ''
  const paperIds = useMemo(() => Object.keys(papers), [papers])
  const form = { subjectId, semesterId, regulationId, paperIds, questionTypes, difficulty, counts }
  const errors = validateGeneration(form)
  const universityName = selection.universities.options.find((u) => u._id === universityId)?.name ?? ''
  const regulationName = selection.regulations.options.find((r) => r._id === regulationId)?.name ?? ''
  const academicLoading = selection.universities.loading || selection.departments.loading || selection.regulations.loading || selection.semesters.loading
  const academicLoadError = selection.universities.error || selection.departments.error || selection.regulations.error || selection.semesters.error
  const academicReload = () => [selection.universities, selection.departments, selection.regulations, selection.semesters].forEach((o) => o.error && o.reload())
  const academicMissing = !academicLoading && !academicLoadError && !(regulationId && semesterId)
  const request = buildRequest(form)
  const signature = JSON.stringify(request)
  const total = totalQuestions(counts, orderTypes(questionTypes))
  const unused = unusedTypes(counts, questionTypes)
  const showErrors = submitted && Object.keys(errors).length > 0
  const rowErrors = Object.fromEntries(Object.entries(errors).filter(([k]) => k.startsWith('marks:')).map(([k, v]) => [k.slice(6), v]))
  const shownFailure = failure && failure.signature === signature ? failure : null // an old failure goes away once the form changes

  // Stop waiting for a response when the page is left.
  useEffect(() => () => controllerRef.current?.abort(), [])

  // Bring the generated questions (or the loading panel) into view.
  useEffect(() => {
    if (result || loading) resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [result, loading])

  // Functional updates: two quick clicks never overwrite each other. The base is the automatic selection until the person changes it.
  const withoutPaper = (current, id) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id))
  const togglePaper = (paper) =>
    setCustomPapers((prev) => {
      const current = prev ?? defaultPapers
      return current[paper._id] ? withoutPaper(current, paper._id) : { ...current, [paper._id]: { _id: paper._id, title: paper.title, extractionStatus: paper.extractionStatus } }
    })
  const removePaper = (id) => setCustomPapers((prev) => withoutPaper(prev ?? defaultPapers, id))

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (loading) return
    setSubmitted(true)
    setFailure(null)
    if (Object.keys(errors).length > 0) return

    const controller = new AbortController()
    controllerRef.current = controller
    const sentPapers = Object.values(papers)
    setLoading(true)
    setResult(null)
    setExtraction(null)
    try {
      // The backend only generates from papers whose text has been extracted, so read the ones that are not ready yet first.
      const toRead = sentPapers.filter((paper) => needsExtraction(paper, extractedIds))
      if (toRead.length > 0) {
        setExtraction({ items: initialProgress(toRead), phase: 'extracting' })
        await extractPapers(toRead, {
          extract: (id) => extractMaterial(id, { signal: controller.signal }),
          fetchPaper: fetchMaterial,
          signal: controller.signal,
          onProgress: (id, state, message) =>
            setExtraction((prev) => prev && { ...prev, items: prev.items.map((item) => (item._id === id ? { ...item, state, message } : item)) }),
          onDone: (id) => setExtractedIds((prev) => new Set(prev).add(id)),
        })
        if (controller.signal.aborted) return
        setExtraction((prev) => prev && { ...prev, phase: 'generating' })
      }
      const body = await generateImportantQuestions(request, { signal: controller.signal })
      if (controller.signal.aborted) return
      setResult({ data: normalizeResult(body), papers: sentPapers, run: Date.now(), context: { subjectId: request.subjectId, semesterId: request.semesterId, regulationId: request.regulationId } })
    } catch (err) {
      if (controller.signal.aborted || err?.cancelled) return
      setFailure({
        signature,
        message: err?.paperId
          ? `Could not read the text of “${err.title}”: ${err.message} Question generation was not started.`
          : err?.message || 'Something went wrong. Please try again.',
        lines: err?.paperId ? [] : describeServerErrors(err?.data?.errors, request),
      })
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  const subjectOptions = subjects.options.map((s) => ({ value: s._id, label: s.subjectCode ? `${s.subjectCode} · ${s.name}` : s.name }))
  const academicError = (field) => (showErrors ? errors[field] : undefined)

  // What "Save question set" needs: typed questions pick a subject in the dialog, generated ones keep the subject they were made for.
  const saveContext = {
    subjectId: subjectId || '',
    semesterId,
    regulationId,
    subjectOptions: subjects.options.map((s) => ({ value: s._id, label: s.subjectCode ? `${s.subjectCode} · ${s.name}` : s.name, name: s.name })),
    subjectsLoading: subjects.loading,
    subjectsError: subjects.error,
    onRetry: subjects.reload,
  }
  const resultSaveContext = result && {
    ...result.context,
    subjectName: result.data.subject?.name || subjects.options.find((s) => s._id === result.context.subjectId)?.name || '',
  }

  return (
    <>
      <header className="page-head">
        <h1 className="page-head__title">Generate questions</h1>
        <p className="muted">
          {admin
            ? 'Create AI practice questions from any student’s uploaded papers or your own, or type your own and get AI answers for them. Generated questions come only from the papers you select, and no answers are generated for them in this step. The papers’ text is read automatically first if that has not been done yet.'
            : 'Create AI practice questions from the papers you have uploaded, or type your own and get AI answers for them. Generated questions come only from the papers you select, and no answers are generated for them in this step. Your papers\' text is read automatically first if that has not been done yet.'}
        </p>
      </header>

      <div className="gen-modes" role="tablist" aria-label="How to get questions">
        {[
          { value: 'papers', label: 'Generate from uploaded papers', icon: FileText },
          { value: 'manual', label: 'Enter questions manually', icon: PenLine },
        ].map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`gen-tab-${value}`}
            aria-selected={mode === value}
            aria-controls={`gen-panel-${value}`}
            className={`gen-mode ${mode === value ? 'is-active' : ''}`}
            onClick={() => setMode(value)}
          >
            <Icon size={16} aria-hidden="true" /> <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Both panels stay mounted (only hidden), so nothing typed or selected is lost when switching. */}
      <div role="tabpanel" id="gen-panel-papers" aria-labelledby="gen-tab-papers" hidden={mode !== 'papers'}>
      <form onSubmit={handleSubmit} noValidate>
        <fieldset className="gen-form" disabled={loading}>
          <Card
            title="1. Subject"
            subtitle="Your academic details come from Academics. Choose the subject the questions are for."
            actions={<Link to="/academics" className="back-link gen-academics-link">Change in Academics</Link>}
          >
            {academicLoading ? (
              <StatusMessage state="loading" title="Loading your academic details…" />
            ) : academicLoadError ? (
              <StatusMessage state="error" title="Couldn’t load your academic details" text={academicLoadError} onRetry={academicReload} />
            ) : academicMissing ? (
              <StatusMessage
                state="empty"
                title="Academic details not set"
                text="Choose your course, regulation and semester in Academics first, then come back to generate questions."
              />
            ) : (
              <>
                <dl className="subject-info gen-context">
                  {[
                    ['University', universityName],
                    ['Course', selection.course],
                    ['Department', department?.name],
                    ['Regulation', regulationName],
                    ['Semester', selectedSemester ? `Semester ${selectedSemester.semesterNumber}` : ''],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="stat__label">{label}</dt>
                      <dd className="stat__value">{value || '—'}</dd>
                    </div>
                  ))}
                </dl>
                <div className="gen-subject">
                  <Select
                    label="Subject"
                    placeholder="Select subject"
                    disabled={!semesterId}
                    disabledText="Select a semester first"
                    emptyText="No subjects available"
                    options={subjectOptions}
                    loading={subjects.loading}
                    loadError={subjects.error}
                    onRetry={subjects.reload}
                    value={subjectId}
                    onChange={(e) => setSubjectPick(e.target.value)}
                    error={academicError('subjectId')}
                  />
                </div>
              </>
            )}
            {showErrors && (errors.regulationId || errors.semesterId) && (
              <p className="field__msg field__msg--error">Your regulation and semester are not set. Choose them in Academics.</p>
            )}
          </Card>

          <Card className="section" title="2. Uploaded papers" subtitle={admin ? 'Select the papers the questions should be based on. You can use any student’s upload.' : 'Select the papers the questions should be based on.'}>
            <PaperPicker
              selected={papers}
              onToggle={togglePaper}
              onRemove={removePaper}
              onReset={() => setCustomPapers(null)}
              onClear={() => setCustomPapers({})}
              isDefault={customPapers === null}
              moreThanMax={(defaultList.meta?.total ?? 0) > Object.keys(defaultPapers).length && Object.keys(defaultPapers).length >= MAX_PAPERS}
              uploadedBy={admin && paperScope === 'mine' ? userId : ''}
              showUploader={admin}
              currentUserId={userId}
              scope={paperScope}
              onScopeChange={setPaperScope}
              error={showErrors ? errors.paperIds : undefined}
              disabled={loading}
            />
          </Card>

          <Card className="section" title="3. Question settings" subtitle="Types, difficulty and how many questions for each marks value.">
            <div className="gen-settings">
              <QuestionTypeField value={questionTypes} onChange={setQuestionTypes} error={showErrors ? errors.questionTypes : undefined} disabled={loading} />
              <DifficultyField value={difficulty} onChange={setDifficulty} error={showErrors ? errors.difficulty : undefined} disabled={loading} />
              <MarksField
                counts={counts}
                onChange={(marks, value) => setCounts((c) => ({ ...c, [marks]: value }))}
                questionTypes={questionTypes}
                rowErrors={showErrors ? rowErrors : {}}
                error={showErrors ? errors.marksDistribution : undefined}
                total={total}
                disabled={loading}
              />
            </div>
            {unused.length > 0 && total > 0 && (
              <div className="section">
                <Alert variant="info">
                  {unused.map(typeLabel).join(', ')} {unused.length === 1 ? 'is' : 'are'} selected but not allowed for any marks value you entered, so
                  {unused.length === 1 ? ' it' : ' they'} will not appear.
                </Alert>
              </div>
            )}
          </Card>
        </fieldset>

        <div className="gen-submit section">
          {showErrors && <Alert>Please fix the highlighted fields before generating.</Alert>}
          {shownFailure && (
            <Alert>
              {shownFailure.message}
              {shownFailure.lines.length > 0 && (
                <>
                  {': '}
                  {shownFailure.lines.join(' · ')}
                </>
              )}
            </Alert>
          )}
          <Button type="submit" size="lg" loading={loading}>
            {!loading && <Sparkles size={18} aria-hidden="true" />} {loading ? (extraction?.phase === 'extracting' ? 'Reading papers…' : 'Generating…') : 'Generate questions'}
          </Button>
        </div>
      </form>

      <div ref={resultsRef} className="section gen-results-anchor">
        {loading && (
          <Card
            title={extraction?.phase === 'extracting' ? 'Reading your papers' : 'Generating questions'}
            subtitle={extraction?.phase === 'extracting' ? 'The text of your papers is read first. Scanned papers can take a minute or more.' : 'This can take up to a minute. Please keep this page open.'}
          >
            <div className="gen-loading" role="status" aria-busy="true">
              <Loader label={extraction?.phase === 'extracting' ? 'Reading your papers' : 'Generating questions'} />
              {extraction && <ExtractionProgress items={extraction.items} />}
              <div className="gen-loading__lines" aria-hidden="true">
                <Skeleton width="90%" height="1rem" />
                <Skeleton width="75%" height="1rem" />
                <Skeleton width="85%" height="1rem" />
              </div>
            </div>
          </Card>
        )}
        {!loading && !result && extraction?.items.some((item) => item.state === 'failed') && (
          <Card title="Reading your papers"><ExtractionProgress items={extraction.items} /></Card>
        )}
        {!loading && result && (
          <QuestionResults
            key={result.run}
            result={result.data}
            papers={result.papers}
            saveAction={<SaveQuestionSet source={SOURCE_PAPERS} groups={result.data.groups} context={resultSaveContext} />}
          />
        )}
      </div>
      </div>

      <div role="tabpanel" id="gen-panel-manual" aria-labelledby="gen-tab-manual" hidden={mode !== 'manual'}>
        <ManualQuestions questions={manual.questions} answers={manual.answers} onAdd={manual.add} onUpdate={manual.update} onRemove={manual.remove} onAnswers={manual.saveAnswers} saveContext={saveContext} />
      </div>
    </>
  )
}

export default GenerateQuestions

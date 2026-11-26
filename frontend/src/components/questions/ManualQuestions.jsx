import { useEffect, useRef, useState } from 'react'
import { Plus, Save, Sparkles, Trash2, X } from 'lucide-react'
import { Alert, Button, Card, Modal, Select, StatusMessage, Textarea } from '../ui'
import QuestionResults from './QuestionResults.jsx'
import SaveQuestionSet from '../saved/SaveQuestionSet.jsx'
import { SOURCE_MANUAL } from '../../utils/savedQuestions.js'
import { QUESTION_TYPES } from '../../utils/questionGeneration.js'
import { MANUAL_MAX_LENGTH, manualToGroups, marksForType, toAnswerRequest, toBatches, validateManualQuestion } from '../../utils/manualQuestions.js'
import { describeServerErrors } from '../../utils/questionGeneration.js'
import { generateManualAnswers } from '../../services/questionService.js'

const DEFAULT_TYPE = 'short_answer'
const typeOptions = QUESTION_TYPES.map(({ value, label }) => ({ value, label }))

/**
 * Type or paste your own questions, then edit or delete them. They appear in the same grouped, searchable list as generated ones,
 * and the AI can write model answers for them (text, type and marks are sent as they are).
 */
function ManualQuestions({ questions, answers = {}, onAdd, onUpdate, onRemove, onAnswers, saveContext }) {
  const [text, setText] = useState('')
  const [questionType, setQuestionType] = useState(DEFAULT_TYPE)
  const [marks, setMarks] = useState('5')
  const [editingId, setEditingId] = useState(null)
  const [submitted, setSubmitted] = useState(false)
  const [notice, setNotice] = useState('')
  const [deleting, setDeleting] = useState(null) // the question waiting for confirmation
  const [answeringIds, setAnsweringIds] = useState([]) // questions waiting for an AI answer
  const [answerFailure, setAnswerFailure] = useState('')
  const [answerNotes, setAnswerNotes] = useState([])
  const textRef = useRef(null)
  const formRef = useRef(null)
  const controllerRef = useRef(null)
  const answering = answeringIds.length > 0
  const unanswered = questions.filter((q) => !answers[q.id])

  // Stop waiting for a response when the page is left.
  useEffect(() => () => controllerRef.current?.abort(), [])

  const draft = { question: text, questionType, marks }
  const errors = validateManualQuestion(draft, questions, editingId)
  const shown = submitted ? errors : {}
  const editing = editingId !== null

  const resetForm = () => {
    setText('')
    setEditingId(null)
    setSubmitted(false)
  }

  // A type only allows some marks (MCQ: 2, Essay: 10 / 15): move the marks to a valid one when the type changes.
  const changeType = (value) => {
    setQuestionType(value)
    const allowed = marksForType(value)
    if (allowed.length > 0 && !allowed.includes(Number(marks))) setMarks(String(allowed[0]))
    setNotice('')
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    setSubmitted(true)
    if (Object.keys(errors).length > 0) return
    if (editing) {
      onUpdate(editingId, draft)
      setNotice('Question updated.')
    } else {
      onAdd(draft)
      setNotice('Question added. You can add another.')
    }
    resetForm()
    textRef.current?.focus()
  }

  const startEdit = (question) => {
    const found = questions.find((q) => q.id === question.questionId)
    if (!found) return
    setText(found.question)
    setQuestionType(found.questionType)
    setMarks(String(found.marks))
    setEditingId(found.id)
    setSubmitted(false)
    setNotice('')
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    textRef.current?.focus()
  }

  const cancelEdit = () => {
    resetForm()
    setNotice('')
  }

  const confirmDelete = () => {
    if (deleting) {
      onRemove(deleting.id)
      if (deleting.id === editingId) resetForm()
      setNotice('Question deleted.')
    }
    setDeleting(null)
  }

  // Sends the given questions to the AI in small batches. Whatever was answered is kept even if a later batch fails.
  const generateAnswers = async (targets) => {
    if (answering || targets.length === 0) return
    const controller = new AbortController()
    controllerRef.current = controller
    setAnswerFailure('')
    setAnswerNotes([])
    setAnsweringIds(targets.map((q) => q.id))
    const notes = []
    try {
      for (const batch of toBatches(targets)) {
        const body = await generateManualAnswers(toAnswerRequest(batch), { signal: controller.signal })
        if (controller.signal.aborted) return
        onAnswers(Array.isArray(body?.data?.questions) ? body.data.questions : [])
        if (Array.isArray(body?.meta?.warnings)) notes.push(...body.meta.warnings)
      }
    } catch (err) {
      if (controller.signal.aborted) return
      const lines = describeServerErrors(err?.data?.errors, null)
      setAnswerFailure([err?.message || 'Something went wrong. Please try again.', ...lines].join(' · '))
    } finally {
      if (!controller.signal.aborted) {
        setAnsweringIds([])
        setAnswerNotes([...new Set(notes)])
      }
    }
  }

  const askDelete = (question) => setDeleting(questions.find((q) => q.id === question.questionId) ?? null)

  return (
    <>
      <div ref={formRef} className="gen-results-anchor">
        <form onSubmit={handleSubmit} noValidate>
          <Card
            title={editing ? 'Edit question' : 'Add a question'}
            subtitle="Type or paste a question. No papers or uploads are needed. You can then generate AI answers for your questions."
          >
            <div className="gen-manual">
              <Textarea
                ref={textRef}
                label="Question"
                rows={4}
                placeholder="Type or paste your question here"
                value={text}
                maxLength={MANUAL_MAX_LENGTH + 200}
                onChange={(e) => { setText(e.target.value); setNotice('') }}
                error={shown.question}
                hint={!shown.question ? `${text.trim().length} / ${MANUAL_MAX_LENGTH} characters` : undefined}
              />
              <div className="gen-manual__row">
                <Select
                  label="Question type"
                  placeholder="Select type"
                  options={typeOptions}
                  value={questionType}
                  onChange={(e) => changeType(e.target.value)}
                  error={shown.questionType}
                  hint={questionType === 'mcq' ? 'MCQ is 2 marks only' : questionType === 'essay' ? 'Essay is 10 or 15 marks only' : undefined}
                />
                <Select
                  label="Marks"
                  placeholder="Select marks"
                  options={marksForType(questionType).map((m) => ({ value: String(m), label: `${m} marks` }))}
                  value={marks}
                  onChange={(e) => { setMarks(e.target.value); setNotice('') }}
                  error={shown.marks}
                />
              </div>
              <div className="gen-manual__actions">
                <Button type="submit">
                  {editing ? <Save size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />} {editing ? 'Save changes' : 'Add question'}
                </Button>
                {editing && (
                  <Button variant="ghost" onClick={cancelEdit}>
                    <X size={16} aria-hidden="true" /> Cancel
                  </Button>
                )}
              </div>
              {notice && <Alert variant="success">{notice}</Alert>}
            </div>
          </Card>
        </form>
      </div>

      <div className="section">
        {questions.length === 0 ? (
          <Card title="Your questions">
            <StatusMessage state="empty" title="No questions added yet" text="Questions you add appear here, grouped by type and marks." />
          </Card>
        ) : (
          <>
            <Card title="AI answers" subtitle="Model answers are written for the question text, type and marks you entered.">
              <div className="gen-manual">
                <div className="gen-manual__actions">
                  <Button onClick={() => generateAnswers(unanswered)} loading={answering} disabled={unanswered.length === 0}>
                    {!answering && <Sparkles size={16} aria-hidden="true" />}{' '}
                    {answering ? 'Generating answers…' : unanswered.length === 0 ? 'All questions answered' : `Generate answers (${unanswered.length})`}
                  </Button>
                </div>
                {answering && <p className="muted" role="status">This can take up to a minute. Please keep this page open.</p>}
                {answerFailure && <Alert>{answerFailure}</Alert>}
                {answerNotes.length > 0 && <Alert variant="info">{answerNotes.join(' ')}</Alert>}
              </div>
            </Card>
            <div className="section">
              <QuestionResults
                manual
                result={{ groups: manualToGroups(questions) }}
                papers={[]}
                onEdit={startEdit}
                onDelete={askDelete}
                busyId={editingId}
                answers={answers}
                onAnswer={(q) => generateAnswers(questions.filter((item) => item.id === q.questionId))}
                answeringIds={answeringIds}
                answerDisabled={answering}
                saveAction={saveContext && <SaveQuestionSet source={SOURCE_MANUAL} groups={manualToGroups(questions)} answers={answers} context={saveContext} />}
              />
            </div>
          </>
        )}
      </div>

      <Modal
        isOpen={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        size="sm"
        title="Delete question?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button onClick={confirmDelete}><Trash2 size={16} aria-hidden="true" /> Delete</Button>
          </>
        }
      >
        <p className="gen-delete-text">{deleting?.question}</p>
        <p className="muted">This question will be removed from your list.</p>
      </Modal>
    </>
  )
}

export default ManualQuestions

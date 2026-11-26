import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bookmark, BookmarkCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Alert, Button, Input, Modal, Select } from '../ui'
import useAuth from '../../hooks/useAuth.js'
import { describeError } from '../../services/materialService.js'
import { saveQuestionSet } from '../../services/savedQuestionService.js'
import { getFieldErrors } from '../../utils/errors.js'
import { describeServerErrors } from '../../utils/questionGeneration.js'
import {
  SOURCE_MANUAL, TITLE_MAX_LENGTH, buildSavePayload, defaultTitle, groupsToSavedQuestions, rememberSource, validateSave,
} from '../../utils/savedQuestions.js'

/**
 * "Save question set" button and its dialog (POST /saved-question-sets). Used under both generated and typed questions.
 *  - `source`   'papers' | 'manual' (kept in this browser so the Saved questions list can label the set)
 *  - `groups`   question groups as listed on screen; `answers` { [questionId]: answerPoints[] } for typed questions
 *  - `context`  { subjectId, subjectName, semesterId, regulationId, subjectOptions? [{ value, label, name }], subjectsLoading?, subjectsError?, onRetry? }
 *               With `context.subjectOptions` the subject is chosen in the dialog (typed questions have none yet), otherwise it is fixed.
 * Once a set is saved the button stays disabled until the questions change, so the same set is not saved twice by accident.
 */
function SaveQuestionSet({ source, groups, answers, context }) {
  const { user } = useAuth()
  const userId = user?._id || user?.id || ''
  const questions = useMemo(() => groupsToSavedQuestions(groups, answers), [groups, answers])
  const signature = useMemo(() => JSON.stringify(questions), [questions])
  const [savedSignature, setSavedSignature] = useState(null)
  const [open, setOpen] = useState(false)
  const alreadySaved = savedSignature === signature

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={alreadySaved || questions.length === 0}>
        {alreadySaved ? <BookmarkCheck size={14} aria-hidden="true" /> : <Bookmark size={14} aria-hidden="true" />} <span>{alreadySaved ? 'Saved' : 'Save question set'}</span>
      </Button>
      {open && (
        <SaveDialog
          key={signature}
          userId={userId}
          source={source}
          questions={questions}
          context={context}
          onClose={() => setOpen(false)}
          onSaved={() => setSavedSignature(signature)}
        />
      )}
    </>
  )
}

function SaveDialog({ userId, source, questions, context, onClose, onSaved }) {
  const choosesSubject = Array.isArray(context.subjectOptions)
  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [subjectPick, setSubjectPick] = useState(context.subjectId || '')
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [saved, setSaved] = useState(null) // the set returned by the backend
  const busyRef = useRef(false)
  useEffect(() => {
    busyRef.current = busy
  }, [busy])
  // Modal re-runs its open effect (which moves focus to the dialog) whenever its onClose prop changes identity. A new function
  // on every render therefore stole focus from the Title input after each keystroke, so `close` must stay the same function.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  const close = useCallback(() => {
    if (!busyRef.current) onCloseRef.current()
  }, [])

  // A subject belongs to one semester: a pick that is not in the loaded list is no pick.
  const subjectId = choosesSubject ? (context.subjectOptions.some((o) => o.value === subjectPick) ? subjectPick : '') : context.subjectId
  const subjectName = choosesSubject ? context.subjectOptions.find((o) => o.value === subjectId)?.name ?? '' : context.subjectName
  const shownTitle = titleTouched ? title : defaultTitle(subjectName, source)

  const form = { title: shownTitle, subjectId, semesterId: context.semesterId, regulationId: context.regulationId, questions }
  const errors = validateSave(form)
  const shown = submitted ? errors : {}

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (busy || saved) return
    setSubmitted(true)
    setFailure('')
    if (Object.keys(errors).length > 0) return
    setBusy(true)
    try {
      const set = await saveQuestionSet(buildSavePayload(form))
      if (set?._id) rememberSource(userId, set._id, source)
      setSaved(set ?? {})
      onSaved()
    } catch (err) {
      const fields = Object.values(getFieldErrors(err))
      const lines = fields.length > 0 ? fields : describeServerErrors(err?.data?.errors, null)
      setFailure([describeError(err, 'Could not save this set.'), ...lines].join(' · '))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      isOpen
      onClose={close}
      size="md"
      title={saved ? 'Question set saved' : 'Save question set'}
      footer={
        saved ? (
          <>
            <Button variant="ghost" onClick={onClose}>Done</Button>
            <Link to="/saved-questions"><Button>View saved questions</Button></Link>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
            <Button type="submit" form="save-set-form" loading={busy}>
              {!busy && <Bookmark size={16} aria-hidden="true" />} {busy ? 'Saving…' : 'Save'}
            </Button>
          </>
        )
      }
    >
      {saved ? (
        <Alert variant="success">“{saved.title || shownTitle}” was saved with {questions.length} {questions.length === 1 ? 'question' : 'questions'}.</Alert>
      ) : (
        <form id="save-set-form" className="material-form" onSubmit={handleSubmit} noValidate>
          {failure && <Alert>{failure}</Alert>}
          <Input
            label="Title"
            value={shownTitle}
            maxLength={TITLE_MAX_LENGTH + 50}
            onChange={(e) => { setTitle(e.target.value); setTitleTouched(true) }}
            error={shown.title}
            hint={!shown.title ? `${shownTitle.trim().length} / ${TITLE_MAX_LENGTH} characters` : undefined}
            disabled={busy}
          />
          {choosesSubject ? (
            <Select
              label="Subject"
              placeholder="Select subject"
              emptyText="No subjects available"
              options={context.subjectOptions}
              loading={context.subjectsLoading}
              loadError={context.subjectsError}
              onRetry={context.onRetry}
              value={subjectId}
              onChange={(e) => setSubjectPick(e.target.value)}
              error={shown.subjectId}
              hint="Subjects of your current semester. Change the semester in Academics."
              disabled={busy}
            />
          ) : (
            <p className="saved-save__fixed"><span className="stat__label">Subject</span> {subjectName || '—'}</p>
          )}
          {(shown.semesterId || shown.regulationId) && <Alert>{shown.semesterId || shown.regulationId}</Alert>}
          {shown.questions && <Alert>{shown.questions}</Alert>}
          <p className="muted">
            {questions.length} {questions.length === 1 ? 'question' : 'questions'} will be saved
            {source === SOURCE_MANUAL ? ', with the AI answers you generated for them.' : '.'}
          </p>
        </form>
      )}
    </Modal>
  )
}

export default SaveQuestionSet

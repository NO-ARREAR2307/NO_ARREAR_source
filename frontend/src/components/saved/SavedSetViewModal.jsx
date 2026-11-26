import { useEffect, useState } from 'react'
import { Check, Copy, Sparkles } from 'lucide-react'
import { Alert, Button, DetailsSkeleton, Modal, SkeletonText, StatusMessage } from '../ui'
import SavedQuestionList from './SavedQuestionList.jsx'
import SourceTag from './SourceTag.jsx'
import { describeError } from '../../services/materialService.js'
import { fetchSavedSet } from '../../services/savedQuestionService.js'
import { formatDate } from '../../utils/materials.js'
import { formatQuestionsForCopy } from '../../utils/questionGeneration.js'
import { copyToClipboard } from '../../utils/sharing.js'
import { academicLine, countAnswered, resolveSource, savedToGroups, studentAcademicLine, studentName, subjectLine } from '../../utils/savedQuestions.js'

const NOTE =
  'Questions and answers are AI-generated study aids, or typed by you. They are not taken from the official syllabus or from previous question papers. Check every answer against your textbooks and notes.'

const ADMIN_NOTE =
  'Questions and answers are AI-generated study aids, or typed by the student. They are not taken from the official syllabus or from previous question papers. This view is read-only.'

/**
 * One saved set, fresh from GET /saved-question-sets/:id: academic details, every question and its stored answer.
 * With `fetchSet` (the admin route, GET /admin/saved-question-sets/:id) it shows any student's set, read-only, with the student's
 * details; `userId` is only used to label the admin's own sets as "You".
 */
function SavedSetViewModal({ set: listed, source: knownSource, onClose, onLoaded, fetchSet = fetchSavedSet, userId = '', showStudent = false }) {
  const [detail, setDetail] = useState({ key: null, set: null, error: '' })
  const [tick, setTick] = useState(0)
  const [copied, setCopied] = useState('')

  const loadKey = `${listed._id}:${tick}`
  useEffect(() => {
    let active = true
    fetchSet(listed._id)
      .then((set) => {
        if (!active) return
        setDetail({ key: loadKey, set, error: '' })
        onLoaded?.(listed._id, set)
      })
      .catch((err) => active && setDetail({ key: loadKey, set: null, error: err?.status === 404 ? 'This set no longer exists. It may have been deleted.' : describeError(err, 'Could not load this set.') }))
    return () => {
      active = false
    }
  }, [listed._id, loadKey, onLoaded, fetchSet])

  useEffect(() => {
    if (!copied) return undefined
    const timer = setTimeout(() => setCopied(''), 2500)
    return () => clearTimeout(timer)
  }, [copied])

  const ready = detail.key === loadKey
  const set = ready ? detail.set : null
  const shown = set || listed
  const source = set ? resolveSource(set, knownSource ? { [set._id]: knownSource } : {}) : knownSource
  const answered = set ? countAnswered(set.questions) : 0

  const copyAll = async () => {
    try {
      await copyToClipboard(formatQuestionsForCopy(savedToGroups(set.questions)))
      setCopied('Copied all questions.')
    } catch {
      setCopied('Could not copy. Please select the text and copy it manually.')
    }
  }

  const owner = showStudent && shown.student ? shown.student : null
  const rows = [
    ...(owner
      ? [
          ['Student', studentName(shown, userId) === 'You' ? 'You' : [studentName(shown, userId), owner.email].filter(Boolean).join(' · ')],
          ['Student details', studentAcademicLine(owner) || '—'],
        ]
      : []),
    ['Subject', subjectLine(shown)],
    ['Academic details', academicLine(shown) || '—'],
    ['Saved', formatDate(shown.createdAt)],
    ['Questions', String(shown.questionCount ?? set?.questions?.length ?? '—')],
  ]

  return (
    <Modal isOpen onClose={onClose} size="lg" title={shown.title}>
      <div className="saved-view">
        <div className="subject__tags">
          <SourceTag source={source} />
          {shown.isShared && <span className="tag tag--gold">Shared</span>}
        </div>

        <dl className="subject-info saved-view__facts">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="stat__label">{label}</dt>
              <dd className="stat__value">{value}</dd>
            </div>
          ))}
        </dl>

        {!ready && (
          <div role="status" aria-busy="true" aria-live="polite">
            <DetailsSkeleton rows={2} />
            <SkeletonText lines={4} className="saved-view__loading" />
            <span className="sr-only">Loading questions…</span>
          </div>
        )}

        {ready && detail.error && <StatusMessage state="error" title="Couldn’t load this set" text={detail.error} onRetry={() => setTick((t) => t + 1)} />}

        {set && set.questions?.length === 0 && <StatusMessage state="empty" title="This set has no questions" />}

        {set && set.questions?.length > 0 && (
          <>
            <div className="gen-copy-all">
              <Button size="sm" variant="outline" onClick={copyAll}>
                {copied === 'Copied all questions.' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} <span>Copy All</span>
              </Button>
              <p className="muted saved-view__count">
                <Sparkles size={14} aria-hidden="true" /> {answered === 0 ? 'No answers saved with this set' : `${answered} of ${set.questions.length} with answers`}
              </p>
              <p className={`gen-copy-status ${copied && copied !== 'Copied all questions.' ? 'is-error' : ''}`} role="status" aria-live="polite">{copied}</p>
            </div>
            <SavedQuestionList questions={set.questions} />
            <Alert variant="info">{showStudent ? ADMIN_NOTE : NOTE}</Alert>
          </>
        )}
      </div>
    </Modal>
  )
}

export default SavedSetViewModal

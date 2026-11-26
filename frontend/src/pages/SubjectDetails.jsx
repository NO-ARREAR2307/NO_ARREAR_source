import { ArrowLeft, ExternalLink } from 'lucide-react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { Card, StatusMessage } from '../components/ui'
import useOptions from '../hooks/useOptions.js'
import { fetchSubjects } from '../services/academicService.js'
import { humanize } from '../utils/academic.js'

// Official University of Madras UG syllabus portal. Shown for every subject; no syllabus content is copied or hosted here.
const SYLLABUS_PORTAL_URL = 'https://egovernance.unom.ac.in/ugsyllabus2324/'

// Official University of Madras previous-years' question paper portal. Shown for every subject; no papers are copied or hosted here.
const QUESTION_PAPERS_URL = 'https://egovernance.unom.ac.in/qpregular/FrmStudDownloadQP.ASPX?IDE_REG=REG'

const backLink = (
  <Link to="/academics" className="back-link">
    <ArrowLeft size={16} /> Back to subjects
  </Link>
)

/** Details of one subject. Opens instantly from the card's data, and loads from the API on refresh / direct links. */
function SubjectDetails() {
  const { semesterId, subjectId } = useParams()
  const { state } = useLocation()
  const subjects = useOptions(fetchSubjects, semesterId)

  const subject = subjects.options.find((s) => s._id === subjectId) || (state?.subject?._id === subjectId ? state.subject : null)

  if (!subject) {
    return (
      <>
        {backLink}
        {subjects.loading ? (
          <StatusMessage state="loading" title="Loading subject…" />
        ) : subjects.error ? (
          <StatusMessage state="error" title="Couldn’t load subject" text={subjects.error} onRetry={subjects.reload} />
        ) : (
          <StatusMessage state="empty" title="Subject not found" text="This subject doesn’t exist or is no longer available." />
        )}
      </>
    )
  }

  const rows = [
    ['Subject code', subject.subjectCode],
    ['Type', humanize(subject.subjectType)],
    ['Category', humanize(subject.category)],
    ['Credits', subject.credits],
    choiceText(subject),
  ].filter(([, value]) => value !== undefined && value !== null && value !== '')

  return (
    <>
      {backLink}
      <header className="page-head">
        <p className="subject__code">{subject.subjectCode || '—'}</p>
        <h1 className="page-head__title">{subject.name}</h1>
        <div className="subject__tags">
          {subject.subjectType && <span className="tag">{humanize(subject.subjectType)}</span>}
          {subject.category && <span className="tag tag--muted">{humanize(subject.category)}</span>}
        </div>
      </header>
      <Card title="Subject details">
        {typeof subject.description === 'string' && subject.description && <p>{subject.description}</p>}
        <dl className="subject-info">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="stat__label">{label}</dt>
              <dd className="stat__value">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card className="section" title="Official Syllabus & Units" subtitle="Source: University of Madras (official)">
        <p>View and download the official syllabus and unit-wise topics from the University of Madras.</p>
        <p className="muted">
          This opens the University of Madras UG syllabus portal, where you can select and download the syllabus for
          your programme and subject.
        </p>
        <a className="btn btn--primary btn--md syllabus-link" href={SYLLABUS_PORTAL_URL} target="_blank" rel="noopener noreferrer">
          View / Download Official Syllabus <ExternalLink size={16} aria-hidden="true" />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </Card>
      <Card className="section" title="Previous Years' Question Papers" subtitle="Source: University of Madras (official)">
        <p>Browse and download previous years' question papers from the University of Madras.</p>
        <p className="muted">
          This opens the official University of Madras question paper portal, where you can select your programme and
          subject to find past papers.
        </p>
        <a className="btn btn--primary btn--md syllabus-link" href={QUESTION_PAPERS_URL} target="_blank" rel="noopener noreferrer">
          View Previous Years' Question Papers <ExternalLink size={16} aria-hidden="true" />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </Card>
    </>
  )
}

function choiceText(subject) {
  if (!subject.choiceGroup) return ['Choice group', '']
  const rule = subject.choiceRule === 'choose_multiple' ? 'choose any' : 'choose one'
  return ['Choice group', `${subject.choiceGroupLabel || subject.choiceGroup} · ${rule}`]
}

export default SubjectDetails

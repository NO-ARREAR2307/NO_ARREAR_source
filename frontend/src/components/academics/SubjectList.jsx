import { Link } from 'react-router-dom'
import { StatusMessage } from '../ui'
import { humanize } from '../../utils/academic.js'

/** Subjects of the selected semester, with loading / empty / error states. */
function SubjectList({ semesterId, subjects }) {
  if (!semesterId) {
    return <StatusMessage state="empty" title="No semester selected" text="Choose a course, regulation and semester to see its subjects." />
  }
  if (subjects.loading) return <StatusMessage state="loading" title="Loading subjects…" />
  if (subjects.error) return <StatusMessage state="error" title="Couldn’t load subjects" text={subjects.error} onRetry={subjects.reload} />
  if (subjects.options.length === 0) {
    return <StatusMessage state="empty" title="No subjects found" text="No subjects have been added for this semester yet." />
  }

  return (
    <ul className="subjects">
      {subjects.options.map((subject) => (
        <li key={subject._id}>
          <Link className="subject subject--link" to={`/academics/semesters/${semesterId}/subjects/${subject._id}`} state={{ subject }}>
          <div className="subject__main">
            <span className="subject__code">{subject.subjectCode || '—'}</span>
            <span className="subject__name">{subject.name}</span>
          </div>
          <div className="subject__tags">
            {subject.subjectType && <span className="tag">{humanize(subject.subjectType)}</span>}
            {subject.category && <span className="tag tag--muted">{humanize(subject.category)}</span>}
            {subject.choiceGroup && (
              <span className="tag tag--gold">
                {subject.choiceGroupLabel || subject.choiceGroup} · {subject.choiceRule === 'choose_multiple' ? 'choose any' : 'choose one'}
              </span>
            )}
          </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}

export default SubjectList

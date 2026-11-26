import { Bookmark, Eye, Trash2, User } from 'lucide-react'
import { Button, Skeleton } from '../ui'
import SourceTag from './SourceTag.jsx'
import { formatDate } from '../../utils/materials.js'
import { academicLine, studentAcademicLine, studentName, subjectLine } from '../../utils/savedQuestions.js'

/** Placeholder rows shown during the first load. */
export function SavedSetListSkeleton({ rows = 4 }) {
  return (
    <ul className="materials" role="status" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="material material--skeleton">
          <Skeleton width="42px" height="42px" radius="var(--radius-md)" />
          <div className="material__body">
            <Skeleton width={i % 2 ? '50%' : '65%'} height="1.05rem" />
            <Skeleton width="45%" height="0.75rem" />
          </div>
        </li>
      ))}
      <li className="sr-only">Loading your saved questions…</li>
    </ul>
  )
}

/**
 * The saved sets of the current page. `sources` is { [id]: origin } and `pending` the ids whose origin is still being worked out.
 * Admin view: pass `userId` and the student's name and academic profile are shown on each row, and `onDelete` is only offered for sets
 * that belong to that user (an admin never gets a Delete button on a student's set).
 */
function SavedSetList({ items, sources, pending, onView, onDelete, userId, showStudent = false }) {
  return (
    <ul className="materials">
      {items.map((set) => {
        const academic = academicLine(set)
        const owner = showStudent ? studentName(set, userId) : ''
        const ownerDetails = showStudent ? studentAcademicLine(set.student) : ''
        const canDelete = Boolean(onDelete) && (!showStudent || owner === 'You')
        return (
          <li key={set._id} className="material">
            <span className="icon-tile material__icon" aria-hidden="true"><Bookmark size={20} /></span>
            <div className="material__body">
              <button type="button" className="material__title" onClick={() => onView(set)} title="View questions">
                {set.title}
              </button>
              <p className="material__desc">{[subjectLine(set), academic].filter(Boolean).join(' · ')}</p>
              {showStudent && (
                <p className="material__desc saved-owner">
                  <User size={13} aria-hidden="true" /> <strong>{owner === 'You' ? 'Saved by you' : owner}</strong>
                  {owner !== 'You' && set.student?.email ? ` · ${set.student.email}` : ''}
                  {ownerDetails ? ` · ${ownerDetails}` : ''}
                </p>
              )}
              <div className="subject__tags">
                <SourceTag source={sources[set._id] ?? null} pending={pending.includes(set._id)} />
                <span className="tag">{set.questionCount} {set.questionCount === 1 ? 'question' : 'questions'}</span>
                <span className="tag tag--muted">Saved {formatDate(set.createdAt)}</span>
                {set.isShared && <span className="tag tag--gold">Shared</span>}
              </div>
            </div>
            <div className="material__actions">
              <Button size="sm" variant="outline" onClick={() => onView(set)} aria-label={`View questions of ${set.title}`}>
                <Eye size={15} aria-hidden="true" /> <span>View</span>
              </Button>
              {canDelete && (
                <Button size="sm" variant="ghost" className="btn--danger" onClick={() => onDelete(set)} aria-label={`Delete ${set.title}`}>
                  <Trash2 size={15} aria-hidden="true" /> <span>Delete</span>
                </Button>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export default SavedSetList

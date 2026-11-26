import { Download, FileImage, FileText, Pencil, Share2, Trash2 } from 'lucide-react'
import { Button, Skeleton } from '../ui'
import { fileKindLabel, formatDate, formatSize, isImageMaterial, typeLabel } from '../../utils/materials.js'

/** Placeholder rows shown during the first load. */
export function MaterialListSkeleton({ rows = 4 }) {
  return (
    <ul className="materials" role="status" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="material material--skeleton">
          <Skeleton width="42px" height="42px" radius="var(--radius-md)" />
          <div className="material__body">
            <Skeleton width={i % 2 ? '55%' : '70%'} height="1.05rem" />
            <Skeleton width="40%" height="0.75rem" />
          </div>
        </li>
      ))}
      <li className="sr-only">Loading study materials…</li>
    </ul>
  )
}

/**
 * The materials of the current page. The backend already limits the list (student: own materials, admin: all), and the
 * actions below are the same for both; the backend refuses anything that is not allowed.
 * `ownerOf(material)` is only passed for admins, to tell their own uploads from students' uploads.
 */
function MaterialList({ items, busyId, onView, onDownload, onShare, onEdit, onDelete, ownerOf }) {
  return (
    <ul className="materials">
      {items.map((m) => {
        const Icon = isImageMaterial(m) ? FileImage : FileText
        const owner = ownerOf?.(m)
        return (
          <li key={m._id} className="material">
            <span className="icon-tile material__icon" aria-hidden="true">
              <Icon size={20} />
            </span>
            <div className="material__body">
              <button type="button" className="material__title" onClick={() => onView(m)} title="View details">
                {m.title}
              </button>
              {m.description && <p className="material__desc">{m.description}</p>}
              <div className="subject__tags">
                <span className="tag">{typeLabel(m.materialType)}</span>
                <span className="tag tag--muted">{fileKindLabel(m)}</span>
                <span className="tag tag--muted">{formatSize(m.size)}</span>
                <span className="tag tag--muted">{formatDate(m.uploadedAt)}</span>
                {m.isShared && <span className="tag tag--gold">Shared</span>}
                {owner && <span className={`tag ${owner === 'You' ? 'tag--gold' : 'tag--muted'}`}>{owner === 'You' ? 'Uploaded by you' : 'Student upload'}</span>}
              </div>
            </div>
            <div className="material__actions">
              <Button size="sm" variant="outline" onClick={() => onDownload(m)} loading={busyId === m._id} aria-label={`Download ${m.title}`}>
                {busyId !== m._id && <Download size={15} aria-hidden="true" />} <span>Download</span>
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onShare(m)} aria-label={`Share ${m.title}`}>
                <Share2 size={15} aria-hidden="true" /> <span>Share</span>
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onEdit(m)} aria-label={`Edit ${m.title}`}>
                <Pencil size={15} aria-hidden="true" /> <span>Edit</span>
              </Button>
              <Button size="sm" variant="ghost" className="btn--danger" onClick={() => onDelete(m)} aria-label={`Delete ${m.title}`}>
                <Trash2 size={15} aria-hidden="true" /> <span>Delete</span>
              </Button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export default MaterialList

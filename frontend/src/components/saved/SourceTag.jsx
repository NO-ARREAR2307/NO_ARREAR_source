import { FileText, PenLine } from 'lucide-react'
import { Skeleton } from '../ui'
import { SOURCE_LABELS, SOURCE_MANUAL, SOURCE_PAPERS } from '../../utils/savedQuestions.js'

/** "Manual" / "From papers" / "Mixed" badge; a small placeholder while the origin is still being worked out. */
function SourceTag({ source, pending = false }) {
  if (!source) return pending ? <Skeleton width="4.5rem" height="1.2rem" radius="var(--radius-full)" /> : null
  const Icon = source === SOURCE_MANUAL ? PenLine : source === SOURCE_PAPERS ? FileText : null
  return (
    <span className={`tag ${source === SOURCE_MANUAL ? 'tag--gold' : 'tag--muted'} saved-source`}>
      {Icon && <Icon size={12} aria-hidden="true" />} {SOURCE_LABELS[source]}
    </span>
  )
}

export default SourceTag

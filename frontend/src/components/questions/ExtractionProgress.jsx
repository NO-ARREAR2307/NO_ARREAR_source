import { AlertTriangle, Check, FileText, RotateCcw } from 'lucide-react'

const LABELS = { waiting: 'Waiting', running: 'Reading text…', done: 'Text ready', failed: 'Failed' }
const ICONS = { waiting: FileText, running: RotateCcw, done: Check, failed: AlertTriangle }

/** One line per selected paper while its text is read (POST /papers/:id/extract): waiting, reading, ready or failed (with the reason). */
function ExtractionProgress({ items }) {
  if (!items?.length) return null
  const finished = items.filter((item) => item.state === 'done').length
  return (
    <div className="gen-extract" role="status" aria-live="polite">
      <p className="gen-extract__summary">{finished} of {items.length} {items.length === 1 ? 'paper' : 'papers'} ready</p>
      <ul className="gen-extract__list">
        {items.map((item) => {
          const Icon = ICONS[item.state]
          return (
            <li key={item._id} className={`gen-extract__item is-${item.state}`}>
              <Icon size={16} aria-hidden="true" className={item.state === 'running' ? 'gen-extract__spin' : undefined} />
              <span className="gen-extract__title">{item.title}</span>
              <span className="gen-extract__state">{LABELS[item.state]}</span>
              {item.state === 'failed' && item.message && <span className="gen-extract__error">{item.message}</span>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default ExtractionProgress

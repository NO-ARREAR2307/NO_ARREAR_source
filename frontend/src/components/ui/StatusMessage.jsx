import Button from './Button.jsx'
import Loader from './Loader.jsx'

/** Consistent loading / empty / error block for any data section. */
function StatusMessage({ state, title, text, onRetry }) {
  if (state === 'loading') {
    return (
      <div className="status status--loading">
        <Loader label={title || 'Loading'} />
        <p className="muted">{title || 'Loading…'}</p>
      </div>
    )
  }
  return (
    <div className={`status status--${state}`} role={state === 'error' ? 'alert' : undefined}>
      <p className="status__title">{title}</p>
      {text && <p className="muted">{text}</p>}
      {state === 'error' && onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

export default StatusMessage

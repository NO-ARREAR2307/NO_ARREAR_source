import { useId } from 'react'

/**
 * Dropdown with built-in loading, empty and error states.
 * `options`: [{ value, label }]. `onRetry` shows a "Try again" button when `loadError` is set.
 */
function Select({
  label, options = [], placeholder = 'Select…', loading = false, loadError = '', onRetry,
  emptyText = 'No options available', disabled = false, disabledText, error, hint, id, className = '', ...rest
}) {
  const generatedId = useId()
  const selectId = id || generatedId
  const isEmpty = !loading && !loadError && !disabled && options.length === 0
  const shownError = error || loadError
  const firstOption = loading ? 'Loading…' : isEmpty ? emptyText : disabled && disabledText ? disabledText : placeholder

  return (
    <div className={`field ${shownError ? 'field--error' : ''} ${className}`.trim()}>
      {label && (
        <label className="field__label" htmlFor={selectId}>
          {label}
        </label>
      )}
      <select
        id={selectId}
        className="field__input field__select"
        disabled={disabled || loading || isEmpty || Boolean(loadError)}
        aria-invalid={Boolean(shownError)}
        aria-busy={loading}
        {...rest}
      >
        <option value="">{firstOption}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {shownError ? (
        <p className="field__msg field__msg--error">
          {shownError}
          {loadError && onRetry && (
            <button type="button" className="field__retry" onClick={onRetry}>
              Try again
            </button>
          )}
        </p>
      ) : hint ? (
        <p className="field__msg">{hint}</p>
      ) : null}
    </div>
  )
}

export default Select

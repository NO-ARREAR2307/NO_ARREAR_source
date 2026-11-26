import { useId } from 'react'

/** Multi-line text field. Same look, label, hint and error handling as Input. */
function Textarea({ label, error, hint, id, rows = 4, className = '', ...rest }) {
  const generatedId = useId()
  const fieldId = id || generatedId
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined

  return (
    <div className={`field ${error ? 'field--error' : ''} ${className}`.trim()}>
      {label && (
        <label className="field__label" htmlFor={fieldId}>
          {label}
        </label>
      )}
      <textarea
        id={fieldId}
        rows={rows}
        className="field__input field__textarea"
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        {...rest}
      />
      {error ? (
        <p className="field__msg field__msg--error" id={`${fieldId}-error`}>
          {error}
        </p>
      ) : hint ? (
        <p className="field__msg" id={`${fieldId}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export default Textarea

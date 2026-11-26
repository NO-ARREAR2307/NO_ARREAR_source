import { useId, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

function Input({ label, error, hint, id, type = 'text', className = '', ...rest }) {
  const generatedId = useId()
  const inputId = id || generatedId
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined
  const isPassword = type === 'password'
  const [visible, setVisible] = useState(false)

  const input = (
    <input
      id={inputId}
      type={isPassword && visible ? 'text' : type}
      className="field__input"
      aria-invalid={Boolean(error)}
      aria-describedby={describedBy}
      {...rest}
    />
  )

  return (
    <div className={`field ${error ? 'field--error' : ''} ${className}`.trim()}>
      {label && (
        <label className="field__label" htmlFor={inputId}>
          {label}
        </label>
      )}
      {isPassword ? (
        <div className="field__wrap">
          {input}
          <button
            type="button"
            className="field__toggle"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Hide password' : 'Show password'}
          >
            {visible ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      ) : (
        input
      )}
      {error ? (
        <p className="field__msg field__msg--error" id={`${inputId}-error`}>
          {error}
        </p>
      ) : hint ? (
        <p className="field__msg" id={`${inputId}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export default Input

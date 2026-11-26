import { Input } from '../ui'
import {
  DIFFICULTIES, GENERATION_MARKS, MAX_TOTAL_QUESTIONS, QUESTION_TYPES, allowedTypesFor, marksEnabled, orderTypes, typeLabel,
} from '../../utils/questionGeneration.js'

/** Question type checkboxes. The marks rules of MCQ and Essay are shown next to them. */
export function QuestionTypeField({ value, onChange, error, disabled }) {
  const toggle = (type) => onChange(value.includes(type) ? value.filter((t) => t !== type) : [...value, type])
  return (
    <fieldset className={`gen-fieldset ${error ? 'gen-field--error' : ''}`} disabled={disabled}>
      <legend className="field__label">Question types</legend>
      <div className="gen-choices">
        {QUESTION_TYPES.map(({ value: type, label, hint }) => (
          <label key={type} className={`gen-choice ${value.includes(type) ? 'is-selected' : ''}`}>
            <input type="checkbox" checked={value.includes(type)} onChange={() => toggle(type)} />
            <span>
              <span className="gen-choice__label">{label}</span>
              {hint && <span className="gen-choice__hint">{hint}</span>}
            </span>
          </label>
        ))}
      </div>
      {error && <p className="field__msg field__msg--error">{error}</p>}
    </fieldset>
  )
}

/** Easy / Medium / Hard / Balanced. */
export function DifficultyField({ value, onChange, error, disabled }) {
  return (
    <fieldset className={`gen-fieldset ${error ? 'gen-field--error' : ''}`} disabled={disabled}>
      <legend className="field__label">Difficulty</legend>
      <div className="gen-choices gen-choices--row">
        {DIFFICULTIES.map(({ value: level, label, hint }) => (
          <label key={level} className={`gen-choice ${value === level ? 'is-selected' : ''}`} title={hint}>
            <input type="radio" name="difficulty" value={level} checked={value === level} onChange={() => onChange(level)} />
            <span className="gen-choice__label">{label}</span>
          </label>
        ))}
      </div>
      {value === 'balanced' && <p className="field__msg">A mix of easy, medium and hard questions.</p>}
      {error && <p className="field__msg field__msg--error">{error}</p>}
    </fieldset>
  )
}

/**
 * How many questions for each marks value. A row is disabled when none of the selected types may be asked for those marks
 * (MCQ is 2 marks only, Essay is 10 or 15 marks only).
 */
export function MarksField({ counts, onChange, questionTypes, rowErrors, error, total, disabled }) {
  const types = orderTypes(questionTypes)
  return (
    <fieldset className={`gen-fieldset ${error ? 'gen-field--error' : ''}`} disabled={disabled}>
      <legend className="field__label">Marks distribution</legend>
      <div className="gen-marks">
        {GENERATION_MARKS.map((marks) => {
          const enabled = types.length === 0 || marksEnabled(marks, types)
          const usable = allowedTypesFor(marks, types)
          return (
            <div key={marks} className={`gen-marks__row ${enabled ? '' : 'is-disabled'}`}>
              <Input
                label={`${marks} marks`}
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX_TOTAL_QUESTIONS}
                step={1}
                placeholder="0"
                value={enabled ? counts[marks] : ''}
                disabled={!enabled}
                onChange={(e) => onChange(marks, e.target.value)}
                error={rowErrors[marks]}
                hint={
                  !enabled
                    ? 'None of the selected types can be asked for these marks'
                    : types.length > 0
                      ? usable.map(typeLabel).join(', ')
                      : undefined
                }
              />
            </div>
          )
        })}
      </div>
      <p className="gen-total" aria-live="polite">
        Total: <strong>{total}</strong> of {MAX_TOTAL_QUESTIONS} questions
      </p>
      {error && <p className="field__msg field__msg--error">{error}</p>}
    </fieldset>
  )
}

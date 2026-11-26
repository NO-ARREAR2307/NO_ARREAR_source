import { useCallback, useState } from 'react'
import { runValidation } from '../utils/validation.js'

/** Small form helper: values, field errors, a form-level error, and a loading-aware submit. */
export default function useForm(initialValues, rules) {
  const [values, setValues] = useState(initialValues)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleChange = useCallback((e) => {
    const { name, value } = e.target
    setValues((prev) => ({ ...prev, [name]: value }))
    setErrors((prev) => (prev[name] ? { ...prev, [name]: '' } : prev))
    setFormError('')
  }, [])

  // Set several fields at once (used to reset dependent dropdowns when a parent changes).
  const setFields = useCallback((patch) => {
    setValues((prev) => ({ ...prev, ...patch }))
    setErrors((prev) => {
      const next = { ...prev }
      Object.keys(patch).forEach((k) => delete next[k])
      return next
    })
    setFormError('')
  }, [])

  // `overrides` merges derived values (e.g. an auto-selected option) in before validating and submitting.
  const handleSubmit = (onValid, overrides = {}) => async (e) => {
    e.preventDefault()
    const current = { ...values, ...overrides }
    const found = runValidation(rules, current)
    setErrors(found)
    setFormError('')
    if (Object.keys(found).length) return
    setSubmitting(true)
    try {
      await onValid(current)
    } finally {
      setSubmitting(false)
    }
  }

  return { values, errors, setErrors, formError, setFormError, submitting, handleChange, setFields, handleSubmit }
}

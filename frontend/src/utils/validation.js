// Mirrors the backend rules in controllers/authController.js so users get instant feedback.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/

export const validators = {
  required: (label) => (v) => (String(v ?? '').trim() ? '' : `${label} is required`),
  email: (v) => {
    const value = String(v ?? '').trim()
    if (!value) return 'Email is required'
    return value.length > 254 || !EMAIL_PATTERN.test(value) ? 'Please provide a valid email address' : ''
  },
  password: (v) => {
    if (!v) return 'Password is required'
    if (v.length < 8) return 'Password must be at least 8 characters long'
    if (new TextEncoder().encode(v).length > 72) return 'Password cannot exceed 72 bytes'
    return ''
  },
  semester: (v) => {
    if (String(v ?? '').trim() === '') return 'Semester is required'
    const n = Number(v)
    return Number.isInteger(n) && n >= 1 && n <= 12 ? '' : 'Semester must be a whole number between 1 and 12'
  },
  // Registration offers Semester 1–6 only (the backend itself accepts 1–12).
  semesterUg: (v) => {
    if (String(v ?? '').trim() === '') return 'Please select a semester'
    return /^[1-6]$/.test(String(v)) ? '' : 'Semester must be between 1 and 6'
  },
  otp: (v) => {
    const value = String(v ?? '').trim()
    if (!value) return 'Verification code is required'
    return /^\d{6}$/.test(value) ? '' : 'Verification code must be exactly 6 digits'
  },
}

/** Runs { field: validatorFn } against values and returns { field: message } for failures only. */
export function runValidation(rules, values) {
  const errors = {}
  Object.entries(rules).forEach(([field, rule]) => {
    const message = rule(values[field], values)
    if (message) errors[field] = message
  })
  return errors
}

/** Backend validation errors: { errors: [{ field, message }] } → { field: message } */
export function getFieldErrors(err) {
  const list = err?.data?.errors
  if (!Array.isArray(list)) return {}
  return list.reduce((acc, { field, message }) => {
    if (field && !acc[field]) acc[field] = message
    return acc
  }, {})
}

export const getErrorMessage = (err) => err?.message || 'Something went wrong. Please try again.'

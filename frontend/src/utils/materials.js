// Study material rules shared by the forms, list and service. They mirror the backend (validators/paperValidators.js,
// middleware/uploadMiddleware.js) so people get instant feedback; the backend still re-checks everything.

export const TITLE_MAX_LENGTH = 150
export const DESCRIPTION_MAX_LENGTH = 1000
export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB, same as the backend

/**
 * Material types offered in the forms and filter.
 * KEEP IN SYNC with MATERIAL_TYPES in the backend's utils/paperMetadata.js (the backend rejects any other value with a
 * 400 that lists the allowed ones). Edit this single list if your backend's values differ.
 */
export const MATERIAL_TYPES = [
  { value: 'question_paper', label: 'Question paper' },
  { value: 'notes', label: 'Notes' },
  { value: 'syllabus', label: 'Syllabus' },
  { value: 'reference', label: 'Reference' },
  { value: 'other', label: 'Other' },
]

/** Allowed files: PDF, JPG, JPEG, PNG. The backend requires the extension and the MIME type to agree. */
const FILE_TYPES = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' }
export const FILE_ACCEPT = Object.keys(FILE_TYPES).join(',')
export const FILE_HINT = `PDF, JPG or PNG, up to ${MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)} MB`

export const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'title', label: 'Title (A–Z)' },
]

/** "question_paper" → "Question paper" (also copes with a type this frontend does not know yet). */
export function typeLabel(value) {
  const known = MATERIAL_TYPES.find((t) => t.value === value)
  if (known) return known.label
  const text = String(value ?? '').replace(/[_-]+/g, ' ').trim().toLowerCase()
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Study material'
}

/** Options for a type dropdown; keeps a material's current type selectable even if it is not in MATERIAL_TYPES. */
export function typeOptions(currentValue) {
  if (currentValue && !MATERIAL_TYPES.some((t) => t.value === currentValue)) {
    return [...MATERIAL_TYPES, { value: currentValue, label: typeLabel(currentValue) }]
  }
  return MATERIAL_TYPES
}

export function formatSize(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function formatDate(value) {
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export const isImageMaterial = (material) => material?.fileType === 'image' || /^image\//.test(material?.mimeType || '')

/** Short label for the file kind: PDF / JPG / PNG. */
export function fileKindLabel(material) {
  if (material?.mimeType === 'image/png') return 'PNG'
  if (material?.mimeType === 'image/jpeg') return 'JPG'
  if (material?.mimeType === 'application/pdf' || material?.fileType === 'pdf') return 'PDF'
  return isImageMaterial(material) ? 'Image' : 'File'
}

/** Returns an error message for a chosen file, or '' when it can be uploaded. */
export function validateFile(file) {
  if (!file) return 'Please choose a file to upload'
  const name = String(file.name || '')
  const ext = name.includes('.') ? `.${name.split('.').pop().toLowerCase()}` : ''
  if (!FILE_TYPES[ext]) return 'Unsupported file type. Choose a PDF, JPG or PNG file'
  if (file.size === 0) return 'This file is empty'
  if (file.size > MAX_UPLOAD_SIZE_BYTES) return `This file is too large (${formatSize(file.size)}). The limit is 10 MB`
  return ''
}

const tooLong = (label, value, max) => (String(value ?? '').trim().length > max ? `${label} cannot exceed ${max} characters` : '')

/** Rules in the shape useForm expects ({ field: (value) => message }). */
export const uploadRules = {
  title: (v) => tooLong('Title', v, TITLE_MAX_LENGTH),
  description: (v) => tooLong('Description', v, DESCRIPTION_MAX_LENGTH),
  file: (v) => validateFile(v),
}

export const editRules = {
  title: (v) => (String(v ?? '').trim() ? tooLong('Title', v, TITLE_MAX_LENGTH) : 'Title is required'),
  description: (v) => tooLong('Description', v, DESCRIPTION_MAX_LENGTH),
}

/**
 * Who uploaded a material, for the admin's picker: "Uploaded by you", "Uploaded by Asha · BCA · Semester 3", or "Uploader unavailable" when
 * the account no longer exists. `material.uploader` is sent by the backend to admins only.
 */
export function uploaderLabel(material, currentUserId = '') {
  if (currentUserId && material?.uploadedBy === currentUserId) return 'Uploaded by you'
  const uploader = material?.uploader
  const name = String(uploader?.name ?? '').trim()
  if (!name) return 'Uploader unavailable'
  const semester = Number.isFinite(Number(uploader.semester)) && uploader.semester !== null ? `Semester ${uploader.semester}` : ''
  return ['Uploaded by ' + name, String(uploader.course ?? '').trim(), semester].filter(Boolean).join(' · ')
}

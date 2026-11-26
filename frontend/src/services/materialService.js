import api, { del, get, patch, post } from './api.js'
import { getFieldErrors } from '../utils/errors.js'

// Study materials: the existing backend routes in routes/paperRoutes.js, mounted at /api/papers.
// The backend decides who may do what (admin → every material, student → only their own; someone else's answers 404),
// so nothing here filters by role. Responses: { success, message, data: { paper | papers }, meta? }.

const FILE_TIMEOUT_MS = 120000 // uploads / downloads of up to 10 MB need longer than the default 15 s
const EXTRACT_TIMEOUT_MS = 180000 // reading a long or scanned paper (OCR) can take a while

/** GET /papers?page&limit&search&materialType&sort[&uploadedBy] → { items, meta: { page, limit, total, totalPages } } */
export async function fetchMaterials(params) {
  const res = await get('/papers', { params })
  const items = res.data?.papers ?? []
  const meta = res.meta ?? {}
  return {
    items,
    meta: {
      page: meta.page ?? 1,
      limit: meta.limit ?? items.length,
      total: meta.total ?? items.length,
      totalPages: Math.max(1, meta.totalPages ?? 1),
    },
  }
}

/** GET /papers/:id → paper */
export const fetchMaterial = async (id) => (await get(`/papers/${id}`)).data?.paper

/**
 * POST /papers/upload (multipart/form-data, file field "file" + optional title, description, materialType) → paper.
 * The JSON default header of the shared client must be replaced for multipart bodies.
 */
export async function uploadMaterial({ file, title, description, materialType }, onProgress) {
  const body = new FormData()
  if (title?.trim()) body.append('title', title.trim())
  if (description?.trim()) body.append('description', description.trim())
  if (materialType) body.append('materialType', materialType)
  body.append('file', file)
  const res = await api
    .post('/papers/upload', body, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: FILE_TIMEOUT_MS,
      onUploadProgress: (e) => e.total && onProgress?.(Math.round((e.loaded / e.total) * 100)),
    })
    .then((r) => r.data)
  return res.data?.paper
}

/** PATCH /papers/:id { title?, description?, materialType? } → paper. An empty description clears it. */
export const updateMaterial = async (id, changes) => (await patch(`/papers/${id}`, changes)).data?.paper

/**
 * POST /papers/:id/extract (existing backend route): reads the text of a PDF (or image) and stores it on the paper. A paper that
 * is already completed answers from its stored text. Resolves with the response body; a 409 means another request is
 * already extracting the same paper.
 */
export const extractMaterial = (id, { signal } = {}) => post(`/papers/${id}/extract`, undefined, { timeout: EXTRACT_TIMEOUT_MS, signal })

/** DELETE /papers/:id → removes the record and the stored file. */
export const deleteMaterial = (id) => del(`/papers/${id}`)

// File endpoints answer with a Blob, so an error body arrives as a Blob too: read the backend's message out of it.
export async function readBlobError(err) {
  if (typeof Blob !== 'undefined' && err?.data instanceof Blob) {
    try {
      const body = JSON.parse(await err.data.text())
      return { ...err, message: body?.message || err.message, data: body }
    } catch {
      return { ...err, data: null }
    }
  }
  return err
}

/** GET /papers/:id/file → Blob. The token travels in the Authorization header, so a plain link cannot be used. */
export async function fetchMaterialFile(id, { download = false } = {}) {
  try {
    const res = await api.get(`/papers/${id}/file`, {
      params: download ? { download: 'true' } : undefined,
      responseType: 'blob',
      timeout: FILE_TIMEOUT_MS,
    })
    return res.data
  } catch (err) {
    throw await readBlobError(err)
  }
}

/** Downloads a material's file through the browser's normal save flow (authorised by the backend). */
export async function downloadMaterial(material) {
  const blob = await fetchMaterialFile(material._id, { download: true })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = material.originalName || material.title || 'material'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

/** One readable message for an error: the backend's message plus its first field problem, if any. */
export function describeError(err, fallback = 'Something went wrong. Please try again.') {
  const message = err?.message || fallback
  const first = Object.values(getFieldErrors(err))[0]
  return first && !message.includes(first) ? `${message}: ${first}` : message
}

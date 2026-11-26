import axios from 'axios'
import { API_BASE_URL, del, get, post } from './api.js'
import { readBlobError } from './materialService.js'

// Phase 4.3B: sharing of study materials. Backend routes (already built, not modified):
//   owner / admin (JWT):  POST|GET|DELETE /papers/:paperId/share        (POST ?replace=true issues a new link)
//   public (no login):    GET /shared/materials/:token  and  GET /shared/materials/:token/file[?download=true]
// Responses: { success, message, data }. The link (token) is only returned by POST, once; GET never returns it.

const FILE_TIMEOUT_MS = 120000

/** GET /papers/:id/share → { _id, isShared, sharedAt }. 404 = not yours (or gone). */
export const fetchShareStatus = async (id) => (await get(`/papers/${id}/share`)).data

/**
 * POST /papers/:id/share[?replace=true] → { message, data: { _id, isShared, sharedAt, shareUrl, ... } }.
 * Without `replace` an already shared material answers 409 instead of silently changing its link.
 */
// The body is an empty JSON object, not null: the shared client sends "Content-Type: application/json", and axios would
// serialise null as the text "null", which the backend's strict JSON parser refuses ("Malformed JSON in request body").
// The endpoint ignores the body; `{}` is simply valid JSON.
export const enableShare = (id, { replace = false } = {}) =>
  post(`/papers/${id}/share`, {}, { params: replace ? { replace: 'true' } : undefined })

/** DELETE /papers/:id/share → { message, data: { _id, isShared: false } }. The old link stops working at once. */
export const revokeShare = (id) => del(`/papers/${id}/share`)

// ---- Public side: a separate client on purpose. A visitor may happen to be logged in, but the share link must not
// ---- send that login token, and a failed public request must never end their session.
const publicApi = axios.create({ baseURL: API_BASE_URL, timeout: 15000 })
publicApi.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status ?? null
    const data = error.response?.data ?? null
    const message =
      data?.message ||
      (error.code === 'ECONNABORTED' ? 'The request timed out. Please try again.' : !error.response ? 'Unable to reach the server. Check your connection.' : error.message)
    return Promise.reject({ message, status, data })
  },
)

const tokenPath = (token) => `/shared/materials/${encodeURIComponent(token)}`

/** GET /shared/materials/:token → { title, description, materialType, fileName, fileType, mimeType, size, pageCount, uploadedAt, sharedAt } */
export const fetchSharedMaterial = async (token) => (await publicApi.get(tokenPath(token))).data?.data

/** GET /shared/materials/:token/file → Blob (shown in the page, or saved when `download` is true). */
export async function fetchSharedFile(token, { download = false } = {}) {
  try {
    const res = await publicApi.get(`${tokenPath(token)}/file`, {
      params: download ? { download: 'true' } : undefined,
      responseType: 'blob',
      timeout: FILE_TIMEOUT_MS,
    })
    return res.data
  } catch (err) {
    throw await readBlobError(err)
  }
}

/** Saves the shared file through the browser's normal download flow. */
export async function downloadSharedFile(token, material) {
  const blob = await fetchSharedFile(token, { download: true })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = material?.fileName || material?.title || 'material'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

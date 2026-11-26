import axios from 'axios'
import { getToken } from './authStorage.js'

export const UNAUTHORIZED_EVENT = 'noarrear:unauthorized'

/**
 * Shared Axios instance. Import this (or the helpers below) from any service
 * module instead of calling axios directly.
 */
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
})

// Attach the JWT (if any) as a Bearer token.
api.interceptors.request.use((config) => {
  const token = getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Normalise errors so UI code can rely on a single shape: { message, status, data }
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status ?? null
    const data = error.response?.data ?? null
    const message =
      data?.message ||
      (error.code === 'ECONNABORTED'
        ? 'The request timed out. Please try again.'
        : !error.response
          ? 'Unable to reach the server. Check your connection.'
          : error.message)
    // An expired/invalid token on a protected request ends the session (login itself is excluded).
    if (status === 401 && getToken() && !error.config?.url?.includes('/auth/login')) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    }
    return Promise.reject({ message, status, data })
  },
)

export const get = (url, config) => api.get(url, config).then((r) => r.data)
export const post = (url, body, config) => api.post(url, body, config).then((r) => r.data)
export const put = (url, body, config) => api.put(url, body, config).then((r) => r.data)
export const patch = (url, body, config) => api.patch(url, body, config).then((r) => r.data)
export const del = (url, config) => api.delete(url, config).then((r) => r.data)

export default api

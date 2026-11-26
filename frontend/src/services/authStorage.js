const KEY = 'noarrear_auth'
const PENDING_EMAIL_KEY = 'noarrear_pending_email'

export function loadSession() {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed?.token ? parsed : { token: null, user: null }
  } catch {
    return { token: null, user: null }
  }
}

export function saveSession(session) {
  try {
    localStorage.setItem(KEY, JSON.stringify(session))
  } catch {
    /* storage unavailable */
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* storage unavailable */
  }
}

export const getToken = () => loadSession().token

export const getPendingEmail = () => {
  try {
    return sessionStorage.getItem(PENDING_EMAIL_KEY) || ''
  } catch {
    return ''
  }
}

export const setPendingEmail = (email) => {
  try {
    if (email) sessionStorage.setItem(PENDING_EMAIL_KEY, email)
    else sessionStorage.removeItem(PENDING_EMAIL_KEY)
  } catch {
    /* storage unavailable */
  }
}

// ---- Saved semester (per user) -------------------------------------------------------------
// Survives refresh, logout and re-login (it is not part of the session that logout clears).
// { semester: 1-6, synced: boolean }  synced=false means the backend has not confirmed it yet.
const semesterKey = (userKey) => `noarrear_semester:${userKey}`

export const getUserKey = (user) => user?._id || user?.id || (user?.email ? String(user.email).toLowerCase() : '')

export function loadSemesterPref(userKey) {
  if (!userKey) return null
  try {
    const parsed = JSON.parse(localStorage.getItem(semesterKey(userKey)))
    return parsed && Number.isInteger(parsed.semester) ? parsed : null
  } catch {
    return null
  }
}

export function saveSemesterPref(userKey, pref) {
  if (!userKey) return
  try {
    localStorage.setItem(semesterKey(userKey), JSON.stringify(pref))
  } catch {
    /* storage unavailable */
  }
}

export function clearSemesterPref(userKey) {
  if (!userKey) return
  try {
    localStorage.removeItem(semesterKey(userKey))
  } catch {
    /* storage unavailable */
  }
}

// ---- Saved course / department (per user) ---------------------------------------------------
// Same idea as the semester: { course, department, synced } survives refresh and re-login until the backend confirms it.
const academicKey = (userKey) => `noarrear_academic:${userKey}`

export function loadAcademicPref(userKey) {
  if (!userKey) return null
  try {
    const parsed = JSON.parse(localStorage.getItem(academicKey(userKey)))
    return parsed && typeof parsed.course === 'string' && parsed.course ? parsed : null
  } catch {
    return null
  }
}

export function saveAcademicPref(userKey, pref) {
  if (!userKey) return
  try {
    localStorage.setItem(academicKey(userKey), JSON.stringify(pref))
  } catch {
    /* storage unavailable */
  }
}

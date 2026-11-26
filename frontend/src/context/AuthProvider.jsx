import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { UNAUTHORIZED_EVENT } from '../services/api.js'
import { getProfile, updateProfile } from '../services/authService.js'
import {
  clearSession, getUserKey, loadAcademicPref, loadSemesterPref, loadSession, saveAcademicPref, saveSemesterPref, saveSession,
} from '../services/authStorage.js'
import { withAcademicProfile } from '../utils/academic.js'
import { normalizeSemester, withResolvedSemester } from '../utils/semester.js'
import { AuthContext } from './AuthContext.js'

const initialPref = () => loadSemesterPref(getUserKey(loadSession().user))
const initialAcademicPref = () => loadAcademicPref(getUserKey(loadSession().user))

// A saved course/department change the server has not confirmed yet wins over the (stale) server copy.
const withAcademicPref = (user, pref) =>
  user && pref && pref.synced === false ? { ...user, course: pref.course, department: pref.department } : user

function AuthProvider({ children }) {
  const [session, setSession] = useState(loadSession)
  // Locally saved semester for this user (see utils/semester.js for how it is combined with the server value).
  const [semesterPref, setSemesterPref] = useState(initialPref)
  const [academicPref, setAcademicPref] = useState(initialAcademicPref)
  // Verify a stored token once on startup before protected pages render.
  const [initializing, setInitializing] = useState(Boolean(session.token))
  // 'idle' (signed out) | 'loading' (fetching the latest profile) | 'ready' | 'error'
  const [profileStatus, setProfileStatus] = useState(session.token ? 'loading' : 'idle')
  const [profileError, setProfileError] = useState('')
  const sessionRef = useRef(session)
  useEffect(() => {
    sessionRef.current = session
  }, [session])

  const applyPref = useCallback((user, pref) => {
    const key = getUserKey(user)
    if (pref) saveSemesterPref(key, pref)
    setSemesterPref(pref ?? loadSemesterPref(key))
  }, [])

  const login = useCallback(({ token, user }) => {
    const next = { token, user }
    saveSession(next)
    setSession(next)
    // Re-login: a semester saved earlier on this device must win over the (possibly stale) payload.
    setSemesterPref(loadSemesterPref(getUserKey(user)))
    setAcademicPref(loadAcademicPref(getUserKey(user)))
    setProfileStatus('ready')
    setProfileError('')
  }, [])

  const logout = useCallback(() => {
    clearSession() // the saved semester is intentionally kept so it survives re-login
    setSession({ token: null, user: null })
    setSemesterPref(null)
    setAcademicPref(null)
    setProfileStatus('idle')
    setProfileError('')
  }, [])

  /** Fetches the latest profile from the backend and stores it. */
  const refreshProfile = useCallback(async () => {
    const token = sessionRef.current.token
    if (!token) return null
    setProfileStatus('loading')
    setProfileError('')
    try {
      const { user } = await getProfile()
      const next = { token, user }
      saveSession(next)
      setSession(next)
      const pref = loadSemesterPref(getUserKey(user))
      setSemesterPref(pref)
      const academic = loadAcademicPref(getUserKey(user))
      setAcademicPref(academic)
      setProfileStatus('ready')
      return { user, pref, academic }
    } catch (err) {
      // Only a rejected token / unverified account ends the session; network errors keep it.
      if (err.status === 401 || err.status === 403) logout()
      else {
        setProfileStatus('error')
        setProfileError(err.message || 'Could not load your profile.')
      }
      return null
    }
  }, [logout])

  /**
   * Saves a new semester. The new value is shown everywhere immediately, written to the backend, and remembered
   * on this device so refresh / re-login never fall back to the login-time value.
   * Resolves to { ok, synced, message? }.
   */
  const updateSemester = useCallback(async (value) => {
    const semester = normalizeSemester(value)
    const current = sessionRef.current
    if (semester === null || !current.user) return { ok: false, synced: false, message: 'Please choose a semester between 1 and 6.' }
    const key = getUserKey(current.user)
    const previous = loadSemesterPref(key)

    applyPref(current.user, { semester, synced: false })
    try {
      const res = await updateProfile({ semester })
      const serverUser = res?.user
      const confirmed = serverUser ? normalizeSemester(serverUser.semester) === semester : true
      if (serverUser) {
        const next = { token: sessionRef.current.token, user: serverUser }
        saveSession(next)
        setSession(next)
      }
      applyPref(serverUser ?? current.user, { semester, synced: confirmed })
      return confirmed
        ? { ok: true, synced: true }
        : { ok: true, synced: false, message: 'Saved on this device. The server did not confirm the change yet.' }
    } catch (err) {
      if (err.status === 400 || err.status === 422) {
        // The backend rejected the value: roll back so nothing invalid is displayed.
        if (previous) saveSemesterPref(key, previous)
        setSemesterPref(previous)
        return { ok: false, synced: false, message: err.message }
      }
      if (err.status === 401) return { ok: false, synced: false, message: err.message }
      // Endpoint missing (404/405), offline or server error: keep the choice, sync again on the next load.
      return {
        ok: true,
        synced: false,
        message:
          err.status === 404 || err.status === 405
            ? 'Saved on this device. The server has no profile-update endpoint yet.'
            : 'Saved on this device. We will sync it with the server when it is reachable.',
      }
    }
  }, [applyPref])

  /**
   * Saves a new course (and its mapped department) the same way as the semester: shown everywhere immediately,
   * written with PUT /auth/profile, and remembered per user so refresh / re-login keep it.
   * Resolves to { ok, synced, message? }.
   */
  const updateAcademics = useCallback(async ({ course, department }) => {
    const current = sessionRef.current
    if (!course || !department || !current.user) return { ok: false, synced: false, message: 'Please choose a course.' }
    const key = getUserKey(current.user)
    const previous = loadAcademicPref(key)
    const apply = (pref) => {
      saveAcademicPref(key, pref)
      setAcademicPref(pref)
    }

    apply({ course, department, synced: false })
    try {
      const res = await updateProfile({ course, department })
      const serverUser = res?.user
      const normalized = withAcademicProfile(serverUser)
      const confirmed = serverUser ? normalized.course === course && normalized.department === department : true
      if (serverUser) {
        const next = { token: sessionRef.current.token, user: serverUser }
        saveSession(next)
        setSession(next)
      }
      apply({ course, department, synced: confirmed })
      return confirmed
        ? { ok: true, synced: true }
        : { ok: true, synced: false, message: 'Saved on this device. The server did not confirm the change yet.' }
    } catch (err) {
      if (err.status === 400 || err.status === 422) {
        if (previous) saveAcademicPref(key, previous)
        setAcademicPref(previous)
        return { ok: false, synced: false, message: err.message }
      }
      if (err.status === 401) return { ok: false, synced: false, message: err.message }
      return {
        ok: true,
        synced: false,
        message:
          err.status === 404 || err.status === 405
            ? 'Saved on this device. The server has no profile-update endpoint yet.'
            : 'Saved on this device. We will sync it with the server when it is reachable.',
      }
    }
  }, [])

  useEffect(() => {
    if (!session.token) return undefined
    let active = true
    refreshProfile()
      .then(async (result) => {
        if (!active || !result) return
        // Retry a semester change the server has not received yet.
        const { user, pref } = result
        if (pref && pref.synced === false && normalizeSemester(user.semester) !== pref.semester) {
          await updateSemester(pref.semester)
        }
        // Same for a course/department change the server has not received yet.
        const { academic } = result
        if (academic && academic.synced === false && (user.course !== academic.course || user.department !== academic.department)) {
          await updateAcademics({ course: academic.course, department: academic.department })
        }
      })
      .finally(() => active && setInitializing(false))
    return () => {
      active = false
    }
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    window.addEventListener(UNAUTHORIZED_EVENT, logout)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, logout)
  }, [logout])

  const user = useMemo(
    () => withAcademicProfile(withResolvedSemester(withAcademicPref(session.user, academicPref), semesterPref)),
    [session.user, semesterPref, academicPref],
  )

  const value = useMemo(
    () => ({
      user, token: session.token, isAuthenticated: Boolean(session.token), initializing,
      profileStatus, profileError, login, logout, refreshProfile, updateSemester, updateAcademics,
    }),
    [user, session.token, initializing, profileStatus, profileError, login, logout, refreshProfile, updateSemester, updateAcademics],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export default AuthProvider

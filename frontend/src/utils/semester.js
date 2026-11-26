// Single place that decides which semester is "current" for the signed-in student.
// Order of truth: a locally saved choice that the server has not confirmed yet  >  the server profile value.
// There is deliberately no hardcoded default: when neither exists the result is null.

export const MIN_SEMESTER = 1
export const MAX_SEMESTER = 6

/** Returns a valid semester number (1–6) or null. */
export function normalizeSemester(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const n = Number(value)
  return Number.isInteger(n) && n >= MIN_SEMESTER && n <= MAX_SEMESTER ? n : null
}

/**
 * @param {object|null} user  profile returned by the backend
 * @param {{semester:number, synced:boolean}|null} pref  locally saved choice for this user
 */
export function resolveSemester(user, pref) {
  const server = normalizeSemester(user?.semester)
  const local = normalizeSemester(pref?.semester)
  // A pending (unsynced) local choice wins; once the server agrees/has it, the server value is the truth.
  if (local !== null && pref?.synced === false) return local
  return server ?? local
}

/** Returns the user object with its semester replaced by the resolved one. */
export function withResolvedSemester(user, pref) {
  if (!user) return user
  const semester = resolveSemester(user, pref)
  return semester === null ? user : { ...user, semester }
}

export const semesterLabel = (semester) => {
  const n = normalizeSemester(semester)
  return n === null ? null : `Semester ${n}`
}

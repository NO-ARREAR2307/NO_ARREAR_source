import { get } from './api.js'
import { fetchUniversities } from './academicService.js'
import { COURSES } from '../utils/academic.js'

// All active departments (UG and PG) of a university; GET /academic/universities/:id/departments (level is optional).
const fetchAllDepartments = async (universityId) =>
  (await get(`/academic/universities/${universityId}/departments`)).data?.departments ?? []

/**
 * Admin dashboard totals from the existing backend endpoint (admin only; the shared Axios client adds the token).
 * GET /admin/stats → data: { totalStudents, totalCourses, totalDepartments, totalSubjects, unavailable?: { <key>: reason } }
 * A total the backend cannot derive accurately comes back as null with a reason under `unavailable`.
 */
export const fetchAdminStats = async () => {
  const data = (await get('/admin/stats')).data ?? {}
  return {
    totalStudents: data.totalStudents ?? null,
    totalCourses: data.totalCourses ?? null,
    totalDepartments: data.totalDepartments ?? null,
    totalSubjects: data.totalSubjects ?? null,
    unavailable: data.unavailable ?? {},
  }
}

/**
 * Distinct academic programmes (e.g. BCA, B.Sc. Computer Science) in the catalogue.
 *
 * The backend has no Programme model: a programme is only identifiable as a department record that matches one of
 * the known programmes in utils/academic.js (the same mapping the academic selector and the backend's supported
 * scope use). So the count is the number of DISTINCT known programmes found among the live, active departments —
 * several departments of one programme count once, and department records themselves are never counted.
 *
 * It is only reported when it is reliable. Returns null ("N/A") when
 *  - a university or department list cannot be loaded (incomplete data),
 *  - any active department does not map to a known programme (its programme would be unknown), or
 *  - no department exists at all.
 * Existing read-only endpoints only: GET /academic/universities and GET /academic/universities/:id/departments.
 */
const norm = (v) => (typeof v === 'string' ? v.toLowerCase().replace(/[^a-z0-9]/g, '') : '')

const programmeOf = (department) => {
  // Same rule as the backend: only undergraduate departments map to these programmes (never PG M.Sc./MCA).
  if (String(department.level || '').toUpperCase() !== 'UG') return null
  const code = norm(department.code)
  const name = norm(department.name)
  const course = COURSES.find(
    (c) => c.departmentCodes.map(norm).includes(code) || name.startsWith(norm(c.departmentName)),
  )
  return course ? course.value : null
}

export async function fetchProgrammeCount() {
  const universities = await fetchUniversities()
  const lists = await Promise.all(universities.map((u) => fetchAllDepartments(u._id)))
  const departments = new Map(lists.flat().map((d) => [d._id, d]))
  if (departments.size === 0) return { totalProgrammes: null }

  const programmes = new Set()
  for (const department of departments.values()) {
    const programme = programmeOf(department)
    if (!programme) return { totalProgrammes: null }
    programmes.add(programme)
  }
  return { totalProgrammes: programmes.size }
}

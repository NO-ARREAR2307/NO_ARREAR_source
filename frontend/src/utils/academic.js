// Course → department mapping rules. These are display/mapping rules only; every record (and its ID)
// comes from the backend. A department is matched by its name (or code) in the loaded department list.
export const COURSES = [
  { value: 'BCA', label: 'BCA', departmentName: 'Computer Applications', departmentCodes: ['BCA'] },
  { value: 'B.Sc.', label: 'B.Sc.', departmentName: 'Computer Science', departmentCodes: ['BSCCS'] },
]

export const courseOptions = COURSES.map(({ value, label }) => ({ value, label }))

const norm = (v) => (typeof v === 'string' ? v.toLowerCase().replace(/[^a-z0-9]/g, '') : '')

/** Finds the backend department that belongs to a course, from a list returned by the API. */
export function findDepartment(departments, courseValue) {
  const course = COURSES.find((c) => c.value === courseValue)
  if (!course) return null
  const wanted = norm(course.departmentName)
  const codes = course.departmentCodes.map(norm)
  return (
    departments.find((d) => codes.includes(norm(d.code))) ||
    departments.find((d) => norm(d.name).startsWith(wanted)) ||
    null
  )
}

/** "skill_enhancement" → "Skill enhancement" */
export const humanize = (value) => {
  if (!value) return ''
  const text = String(value).replace(/_/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// ---- Student academic profile (course / department) --------------------------------------------
const text = (v) => {
  if (typeof v === 'string') return v.trim()
  if (v && typeof v === 'object') return text(v.name ?? v.label ?? v.value ?? '')
  return ''
}

/** Department name that the course maps to (same rule as registration and the academic selector). */
export const departmentNameForCourse = (courseValue) =>
  COURSES.find((c) => norm(c.value) === norm(text(courseValue)))?.departmentName ?? ''

/**
 * Returns the user with separate, display-ready `course` and `department` strings.
 * - Values may arrive as strings or objects ({ name }); both are read.
 * - If the department is missing or is just a copy of the course, it is taken from the course mapping
 *   (BCA -> Computer Applications, B.Sc. -> Computer Science). Nothing else is invented.
 */
export function withAcademicProfile(user) {
  if (!user) return user
  const course = text(user.course)
  let department = text(user.department)
  if (!department || norm(department) === norm(course)) department = departmentNameForCourse(course)
  return { ...user, course, department }
}

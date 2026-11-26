/**
 * Academic options for the registration form.
 *
 * The backend's /api/academic/* routes require a logged-in, email-verified user (routes/academicRoutes.js uses
 * `protect`), so they cannot be called before registration. Until a public endpoint exists, registration uses
 * this fixed catalogue. Every function is async, so switching to live API calls later only changes this file.
 *
 * Supported scope (matches the backend's SUPPORTED_SCOPE): University of Madras – BCA and B.Sc. Computer Science.
 * The backend stores `course` and `department` as free text (not IDs); registration sends the course name and the
 * mapped department name. No database IDs are hardcoded here.
 */
const CATALOG = [
  {
    id: 'university-of-madras',
    name: 'University of Madras',
    // course -> the backend department it belongs to (department names as stored in the academic data)
    programmes: [
      { course: 'BCA', department: 'Computer Applications' },
      { course: 'B.Sc.', department: 'Computer Science' },
    ],
  },
]

export const SEMESTER_OPTIONS = Array.from({ length: 6 }, (_, i) => ({
  value: String(i + 1),
  label: `Semester ${i + 1}`,
}))

export const getUniversities = async () => CATALOG.map(({ id, name }) => ({ value: id, label: name }))

/** Courses (programmes) offered by a university. */
export const getCourses = async (universityId) => {
  const university = CATALOG.find((u) => u.id === universityId)
  return (university?.programmes ?? []).map(({ course }) => ({ value: course, label: course }))
}

/** The department mapped to a course (always zero or one option). */
export const getDepartments = async (courseName) => {
  const programme = CATALOG.flatMap((u) => u.programmes).find((p) => p.course === courseName)
  return programme ? [{ value: programme.department, label: programme.department }] : []
}

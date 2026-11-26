import { useEffect, useMemo, useState } from 'react'
import {
  fetchDepartments, fetchRegulations, fetchSemesters, fetchSubjects, fetchUniversities,
} from '../services/academicService.js'
import { COURSES, findDepartment } from '../utils/academic.js'
import useOptions from './useOptions.js'

const STORAGE_KEY = 'noarrear:academic-selection'

// Remember the selection for this tab so returning from a subject's page restores it.
// The semester is NOT part of this remembered selection: it comes from the saved profile (single source of truth).
const loadPicked = () => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY))
    if (saved && typeof saved === 'object') return { university: saved.university ?? null, course: saved.course ?? null, regulation: saved.regulation ?? '' }
  } catch { /* ignore unreadable storage */ }
  return { university: null, course: null, regulation: '' }
}

/**
 * Cascading academic selection: university → course → (mapped) department → regulation → semester → subjects.
 * Everything below the course is loaded from the backend; changing a parent resets its dependents.
 * The semester always follows the student's saved semester (`user.semester`); picking one calls `onSemesterChange`.
 * `null` in `picked` means "not chosen yet" (a sensible default may apply); '' means "explicitly cleared".
 */
export default function useAcademicSelection(user, onSemesterChange) {
  const [picked, setPicked] = useState(loadPicked)

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(picked))
    } catch { /* storage unavailable */ }
  }, [picked])

  const universities = useOptions(fetchUniversities, 'all')
  const universityId = picked.university ?? (universities.options.length === 1 ? universities.options[0]._id : '')

  const profileCourse = COURSES.find((c) => c.value === user?.course)?.value ?? ''
  const course = picked.course ?? profileCourse

  const departments = useOptions(fetchDepartments, universityId)
  const department = useMemo(() => findDepartment(departments.options, course), [departments.options, course])

  const regulations = useOptions(fetchRegulations, department?._id)
  const regulationId = picked.regulation || (regulations.options.length === 1 ? regulations.options[0]._id : '')

  const semesters = useOptions(fetchSemesters, regulationId)
  const semesterList = useMemo(
    () => semesters.options.filter((s) => s.semesterNumber >= 1 && s.semesterNumber <= 6),
    [semesters.options],
  )
  const profileSemesterId = semesterList.find((s) => s.semesterNumber === Number(user?.semester))?._id ?? ''
  const semesterId = profileSemesterId

  const subjects = useOptions(fetchSubjects, semesterId)

  const setUniversity = (id) => setPicked((p) => ({ ...p, university: id, regulation: '' }))
  const setCourse = (value) => setPicked((p) => ({ ...p, course: value, regulation: '' }))
  const setRegulation = (id) => setPicked((p) => ({ ...p, regulation: id }))
  const setSemester = (id) => {
    const number = semesterList.find((s) => s._id === id)?.semesterNumber
    if (number) onSemesterChange?.(number)
  }

  return {
    universities, universityId, setUniversity,
    course, setCourse,
    departments, department,
    regulations, regulationId, setRegulation,
    semesters, semesterList, semesterId, setSemester,
    subjects,
    selectedSemester: semesterList.find((s) => s._id === semesterId) ?? null,
  }
}

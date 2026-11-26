import { get } from './api.js'

// Read-only student endpoints from the backend (routes/academicRoutes.js, mounted at /api/academic).
// All of them need the logged-in user's token (added by the shared Axios client).
// Responses: { success, message, data: { <list> }, meta: { total } }

/** GET /academic/universities → data.universities [{ _id, name, code, description }] */
export const fetchUniversities = async () => (await get('/academic/universities')).data?.universities ?? []

/** GET /academic/universities/:id/departments?level=UG → data.departments [{ _id, name, code, level, university }] */
export const fetchDepartments = async (universityId) =>
  (await get(`/academic/universities/${universityId}/departments`, { params: { level: 'UG' } })).data?.departments ?? []

/** GET /academic/departments/:id/regulations → data.regulations [{ _id, name, department }] */
export const fetchRegulations = async (departmentId) =>
  (await get(`/academic/departments/${departmentId}/regulations`)).data?.regulations ?? []

/** GET /academic/regulations/:id/semesters → data.semesters [{ _id, semesterNumber, regulation, department }] */
export const fetchSemesters = async (regulationId) =>
  (await get(`/academic/regulations/${regulationId}/semesters`)).data?.semesters ?? []

/** GET /academic/semesters/:id/subjects → data.subjects [{ _id, name, subjectCode, subjectType, category, choiceGroup?, ... }] */
export const fetchSubjects = async (semesterId) =>
  (await get(`/academic/semesters/${semesterId}/subjects`)).data?.subjects ?? []

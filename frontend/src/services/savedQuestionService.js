import { del, get, post } from './api.js'

// Saved question sets: the existing backend routes in routes/savedQuestionSetRoutes.js, mounted at /api/saved-question-sets.
// Every route is protected and scoped to the signed-in student by the backend; someone else's set answers 404 exactly like a
// missing one. Responses: { success, message, data, meta? }. A list puts the array in `data` and { page, limit, total, totalPages }
// in `meta`; a single set carries its `questions`, a list item does not.

/**
 * GET /saved-question-sets?page&limit&q&sort[&subjectId&semesterId&departmentId&shared] → { items, meta }.
 * `q` searches the title only; `sort` is "newest" (default) or "oldest". Items have no questions.
 */
export async function fetchSavedSets(params, { admin = false } = {}) {
  const res = await get(admin ? '/admin/saved-question-sets' : '/saved-question-sets', { params })
  const items = Array.isArray(res.data) ? res.data : []
  const meta = res.meta ?? {}
  return {
    items,
    meta: {
      page: meta.page ?? 1,
      limit: meta.limit ?? items.length,
      total: meta.total ?? items.length,
      totalPages: Math.max(1, meta.totalPages ?? 1),
    },
  }
}

/** GET /saved-question-sets/:id → one set with all its questions (and the answer key, which only the owner receives). */
export const fetchSavedSet = async (id) => (await get(`/saved-question-sets/${encodeURIComponent(id)}`)).data

/** DELETE /saved-question-sets/:id → a hard delete (a public share link of the set stops working with it). */
export const deleteSavedSet = (id) => del(`/saved-question-sets/${encodeURIComponent(id)}`)

/**
 * POST /saved-question-sets with the body built by utils/savedQuestions.js › buildSavePayload
 * ({ subjectId, semesterId, regulationId, title, questions }) → the saved set (201). Validation failures carry
 * data.errors: [{ field, message }]; a 409 means the per-student limit of saved sets is reached.
 */
export const saveQuestionSet = async (payload) => (await post('/saved-question-sets', payload)).data

/**
 * Admin only (the backend answers 403 to anyone else): GET /admin/saved-question-sets?page&limit&q&sort[&studentId&subjectId&semesterId&departmentId&shared]
 * → { items, meta } for the saved sets of ALL students. Every item also carries `student` ({ _id, name, email, role, course, department,
 * semester }). Read-only: there is no admin route to edit, delete or share a student's set.
 */
export const fetchAdminSavedSets = (params) => fetchSavedSets(params, { admin: true })

/** Admin only: GET /admin/saved-question-sets/:id → one set of any student with every question, its answers and the `student`. */
export const fetchAdminSavedSet = async (id) => (await get(`/admin/saved-question-sets/${encodeURIComponent(id)}`)).data

import { MAX_TOTAL_QUESTIONS, QUESTION_TYPES } from './questionGeneration.js'

// Helpers for the Saved Questions section (list, view, delete) and for saving a generated or typed set.
// Pure functions, so they can be unit-tested without a browser.
//
// Manual vs PDF-generated: the backend stores NO origin on a saved set (see the API report): no source field, no generationId, no
// paper ids. So the origin is worked out here, in this order:
//   1. a source field from the backend, should one ever be added (`source`, `sourceType` or `origin`);
//   2. what this browser recorded when the set was saved, or when it was last opened (a small per-user cache);
//   3. the questions themselves: generated questions always carry a difficulty, typed ones never do.
// The list endpoint returns no questions, so step 3 needs the set to be opened; the page does that quietly for rows whose origin is
// not known yet. KEEP IN SYNC with the backend if it ever stores the origin: only `readBackendSource` has to change.

export const SOURCE_PAPERS = 'papers'
export const SOURCE_MANUAL = 'manual'
export const SOURCE_MIXED = 'mixed'

export const SOURCE_LABELS = {
  [SOURCE_PAPERS]: 'From papers',
  [SOURCE_MANUAL]: 'Manual',
  [SOURCE_MIXED]: 'Mixed',
}

export const TITLE_MAX_LENGTH = 150 // backend: title maxlength
export const MAX_SAVED_QUESTIONS = MAX_TOTAL_QUESTIONS // backend: questions 1..LIMITS.maxTotalQuestions (same limit as one generation)

const VALID_DIFFICULTIES = ['easy', 'medium', 'hard']
const OPTION_LABELS = ['A', 'B', 'C', 'D']
const typeOrder = QUESTION_TYPES.map((t) => t.value)

const text = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()
const keepText = (value) => String(value ?? '').trim()

// ---------------------------------------------------------------- origin

const SOURCE_ALIASES = {
  manual: SOURCE_MANUAL,
  typed: SOURCE_MANUAL,
  papers: SOURCE_PAPERS,
  paper: SOURCE_PAPERS,
  pdf: SOURCE_PAPERS,
  generated: SOURCE_PAPERS,
  uploaded_material: SOURCE_PAPERS,
  mixed: SOURCE_MIXED,
}

const normalizeSource = (value) => SOURCE_ALIASES[String(value ?? '').trim().toLowerCase()] ?? null

/** An origin the backend itself reports, if it ever does. Today it does not, so this is null. */
export const readBackendSource = (set) => normalizeSource(set?.source ?? set?.sourceType ?? set?.origin)

/** The origin of a set from its questions: all with a difficulty → papers, none → manual, a mix → mixed, no questions → null. */
export function inferSource(questions) {
  if (!Array.isArray(questions) || questions.length === 0) return null
  const withDifficulty = questions.filter((q) => q && VALID_DIFFICULTIES.includes(q.difficulty)).length
  if (withDifficulty === questions.length) return SOURCE_PAPERS
  if (withDifficulty === 0) return SOURCE_MANUAL
  return SOURCE_MIXED
}

/** Best known origin of a list row or a loaded set: backend field → questions (when loaded) → the browser's cache → null (unknown). */
export function resolveSource(set, cache = {}) {
  return readBackendSource(set) ?? inferSource(set?.questions) ?? normalizeSource(cache?.[set?._id])
}

const cacheKey = (userId) => `noarrear:saved-set-sources:${userId || 'guest'}`

/** Reads the per-user origin cache: { [setId]: 'manual' | 'papers' | 'mixed' }. Never throws. */
export function loadSourceCache(userId, storage = globalThis.localStorage) {
  try {
    const raw = JSON.parse(storage?.getItem(cacheKey(userId)))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    return Object.fromEntries(Object.entries(raw).filter(([, value]) => normalizeSource(value)))
  } catch {
    return {}
  }
}

/** Remembers (or, with a null source, forgets) the origin of one set. Returns the updated cache. */
export function rememberSource(userId, setId, source, storage = globalThis.localStorage) {
  const cache = loadSourceCache(userId, storage)
  if (!setId) return cache
  if (source) cache[setId] = source
  else delete cache[setId]
  try {
    storage?.setItem(cacheKey(userId), JSON.stringify(cache))
  } catch { /* storage unavailable: the origin is simply worked out again next time */ }
  return cache
}

// ---------------------------------------------------------------- saving

const asOptions = (options) =>
  (Array.isArray(options) ? options : [])
    .map((option, i) => ({ label: OPTION_LABELS.includes(option?.label) ? option.label : OPTION_LABELS[i], text: keepText(option?.text ?? option) }))
    .filter((option) => option.label && option.text)

/**
 * One question in the shape the backend stores: questionType, marks, question and, when known, unit, topic, difficulty, options
 * and the answer (correctAnswer, explanation, answerPoints). `answerPoints` is the typed question's AI answer, passed separately.
 */
export function toSavedQuestion(question, { questionType, marks }, answerPoints) {
  const saved = { questionType, marks: Number(marks), question: keepText(question?.question) }
  if (text(question?.unit)) saved.unit = text(question.unit)
  if (text(question?.topic)) saved.topic = text(question.topic)
  if (VALID_DIFFICULTIES.includes(question?.difficulty)) saved.difficulty = question.difficulty
  const options = asOptions(question?.options)
  if (options.length > 0) saved.options = options
  if (OPTION_LABELS.includes(question?.correctAnswer)) saved.correctAnswer = question.correctAnswer
  if (keepText(question?.explanation)) saved.explanation = keepText(question.explanation)
  const points = (Array.isArray(answerPoints) ? answerPoints : question?.answerPoints ?? []).map(keepText).filter(Boolean)
  if (points.length > 0) saved.answerPoints = points
  return saved
}

/**
 * Flattens question groups ([{ questionType, marks, questions }], as shown on the Generate page) into the questions to save.
 * `answers` is { [questionId]: answerPoints[] } (the AI answers of typed questions); questions are read in the order shown on screen.
 */
export function groupsToSavedQuestions(groups, answers = {}) {
  const list = []
  ;(Array.isArray(groups) ? groups : []).forEach((group) =>
    (group.questions ?? []).forEach((question) => list.push(toSavedQuestion(question, group, answers?.[question.questionId]))),
  )
  return list
}

/** A suggested title such as "Data Structures – Important questions" (never longer than the backend allows). */
export function defaultTitle(subjectName, source) {
  const suffix = source === SOURCE_MANUAL ? 'My questions' : 'Important questions'
  const name = text(subjectName)
  return (name ? `${name} – ${suffix}` : suffix).slice(0, TITLE_MAX_LENGTH)
}

/** Client-side checks before saving. Returns {} when the set can be saved, otherwise { title?, subjectId?, semesterId?, regulationId?, questions? }. */
export function validateSave({ title, subjectId, semesterId, regulationId, questions }) {
  const errors = {}
  const name = text(title)
  if (!name) errors.title = 'Enter a title for this set'
  else if (name.length > TITLE_MAX_LENGTH) errors.title = `The title cannot exceed ${TITLE_MAX_LENGTH} characters`
  if (!subjectId) errors.subjectId = 'Select a subject'
  if (!semesterId) errors.semesterId = 'Your semester is not set. Choose it in Academics'
  if (!regulationId) errors.regulationId = 'Your regulation is not set. Choose it in Academics'
  const count = Array.isArray(questions) ? questions.length : 0
  if (count < 1) errors.questions = 'There are no questions to save'
  else if (count > MAX_SAVED_QUESTIONS) errors.questions = `A saved set can hold at most ${MAX_SAVED_QUESTIONS} questions (this one has ${count}). Remove some first`
  return errors
}

/** The exact request body of POST /api/saved-question-sets. */
export const buildSavePayload = ({ title, subjectId, semesterId, regulationId, questions }) => ({
  subjectId,
  semesterId,
  regulationId,
  title: text(title),
  questions,
})

// ---------------------------------------------------------------- showing a saved set

/**
 * A saved set's questions folded into groups the existing list components understand:
 * [{ questionType, marks, questions: [{ questionId, ... }] }]. Saved questions have no id of their own, so each gets a stable
 * position-based `questionId` (the same value the answers map is keyed by).
 */
export function savedToGroups(questions) {
  const groups = []
  ;(Array.isArray(questions) ? questions : []).forEach((question, index) => {
    let group = groups.find((g) => g.questionType === question.questionType && g.marks === question.marks)
    if (!group) {
      group = { questionType: question.questionType, marks: question.marks, questions: [] }
      groups.push(group)
    }
    group.questions.push({ ...question, questionId: `saved-${index}` })
  })
  const rank = (type) => (typeOrder.includes(type) ? typeOrder.indexOf(type) : 99)
  return groups.sort((a, b) => rank(a.questionType) - rank(b.questionType) || a.marks - b.marks)
}

/** True when a saved question has any stored answer (MCQ key, explanation or answer points). */
export const hasAnswer = (question) =>
  Boolean(question?.correctAnswer || keepText(question?.explanation) || (Array.isArray(question?.answerPoints) && question.answerPoints.length > 0))

export const countAnswered = (questions) => (Array.isArray(questions) ? questions.filter(hasAnswer).length : 0)

/** The text of the MCQ option the answer key points to, e.g. "B) Stack"; '' when it cannot be found. */
export function correctOptionText(question) {
  const option = (question?.options ?? []).find((o) => o?.label === question?.correctAnswer)
  return option ? `${option.label}) ${option.text}` : ''
}

/** "Semester 3 · 2023-2024 · BCA" style line for the academic details of a set (missing parts are left out). */
export function academicLine(set) {
  const semester = Number.isFinite(Number(set?.semester?.semesterNumber)) ? `Semester ${set.semester.semesterNumber}` : ''
  return [semester, set?.regulation?.name, set?.department?.code || set?.department?.name].filter(Boolean).join(' · ')
}

/** The subject of a set for display: "CODE · Name", or "Subject unavailable" when the subject has since been removed. */
export function subjectLine(set) {
  const subject = set?.subject
  if (!subject?.name) return 'Subject unavailable'
  return subject.subjectCode ? `${subject.subjectCode} · ${subject.name}` : subject.name
}

export const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
]

// ---------------------------------------------------------------- the owner of a set (admin views)

/** True when the set belongs to the given user. Only the owner may delete a set, so this decides whether Delete is offered. */
export const isOwnSet = (set, userId) => Boolean(userId) && String(set?.student?._id ?? '') === String(userId)

/** The student's name for display. A set whose owner's account no longer exists (name null) is labelled, never left blank. */
export function studentName(set, userId) {
  const student = set?.student
  if (!student) return ''
  if (isOwnSet(set, userId)) return 'You'
  return text(student.name) || 'Student unavailable'
}

/** "BCA · Computer Science · Semester 3" style line for the student's own academic profile (missing parts are left out). */
export function studentAcademicLine(student) {
  const semester = Number.isFinite(Number(student?.semester)) && student?.semester !== null ? `Semester ${student.semester}` : ''
  return [text(student?.course), text(student?.department), semester].filter(Boolean).join(' · ')
}

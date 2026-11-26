import { FORMAT_MARKS, GENERATION_MARKS, QUESTION_TYPES, typeLabel } from './questionGeneration.js'

// Questions the student types or pastes in themselves (no AI, no upload). They follow the same type / marks rules as the
// generator (MCQ = 2 marks, Essay = 10 or 15 marks) and the backend's question length limits, so they look and behave like
// generated questions in the list.
//
// Typed questions are kept in this browser tab. To get AI answers each one is sent to the backend's existing endpoint for a
// free-standing question, POST /questions/ask { question } → { data: { question, answer } } (services/questionService.js ›
// generateManualAnswers); the server stores nothing. That endpoint answers in Markdown, so the answer is turned into the short
// answer points the list shows (answerToPoints). The PDF-based answers are a different endpoint and are not touched:
// POST /questions/important/:generationId/answers needs a generated set and the papers it came from.

export const MANUAL_MIN_LENGTH = 10 // backend MIN_QUESTION_LENGTH
export const MANUAL_MAX_LENGTH = 1000 // backend MAX_QUESTION_LENGTH

/** Marks a question of this type may carry. */
export const marksForType = (type) => GENERATION_MARKS.filter((marks) => !FORMAT_MARKS[type] || FORMAT_MARKS[type].includes(marks))

const squash = (text) => String(text ?? '').replace(/\s+/g, ' ').trim()
const sameText = (a, b) => squash(a).toLowerCase() === squash(b).toLowerCase()

/**
 * Checks one draft { question, questionType, marks } against the other questions (`editingId` is skipped when editing).
 * Returns {} when it can be saved, otherwise { question?, questionType?, marks? }.
 */
export function validateManualQuestion({ question, questionType, marks }, existing = [], editingId = null) {
  const errors = {}
  const text = squash(question)
  if (!text) errors.question = 'Enter the question'
  else if (text.length < MANUAL_MIN_LENGTH) errors.question = `The question must be at least ${MANUAL_MIN_LENGTH} characters`
  else if (text.length > MANUAL_MAX_LENGTH) errors.question = `The question cannot exceed ${MANUAL_MAX_LENGTH} characters`
  else if (existing.some((q) => q.id !== editingId && sameText(q.question, text))) errors.question = 'This question has already been added'

  if (!QUESTION_TYPES.some((t) => t.value === questionType)) {
    errors.questionType = 'Select a question type'
  } else if (!marksForType(questionType).includes(Number(marks))) {
    errors.marks = FORMAT_MARKS[questionType]
      ? `${typeLabel(questionType)} questions can only be ${FORMAT_MARKS[questionType].join(' or ')} marks`
      : 'Select the marks'
  }
  return errors
}

/** The stored shape of a valid draft (the id is added by the caller). */
export const toManualQuestion = ({ question, questionType, marks }) => ({ question: squash(question), questionType, marks: Number(marks) })

/** Reads a saved list back safely: only well-formed questions survive. */
export function sanitizeManualQuestions(raw) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  return raw.filter((q) => {
    const ok =
      q && typeof q.id === 'string' && q.id && !seen.has(q.id) && typeof q.question === 'string' &&
      Object.keys(validateManualQuestion(q)).length === 0
    if (ok) seen.add(q.id)
    return ok
  }).map((q) => ({ id: q.id, ...toManualQuestion(q) }))
}

/**
 * The typed questions in the shape of a generation result, so the existing question list (grouping by type and marks, search)
 * shows them: groups [{ questionType, marks, questions: [{ questionId, question }] }], in the order they were added.
 */
export function manualToGroups(list) {
  const groups = []
  list.forEach((q) => {
    let group = groups.find((g) => g.questionType === q.questionType && g.marks === q.marks)
    if (!group) {
      group = { questionType: q.questionType, marks: q.marks, questions: [] }
      groups.push(group)
    }
    group.questions.push({ questionId: q.id, question: q.question })
  })
  return groups
}

// ---------------------------------------------------------------- AI answers

/** The backend accepts at most MAX_TOTAL_QUESTIONS (30) per request; a smaller batch keeps each AI call quick. */
export const ANSWER_BATCH_SIZE = 10

/** What generateManualAnswers receives for a list of stored questions. */
export const toAnswerRequest = (list) => ({
  questions: list.map(({ id, question, questionType, marks }) => ({ id, question, questionType, marks })),
})

/** Splits a list into batches of `size`. */
export const toBatches = (list, size = ANSWER_BATCH_SIZE) => {
  const batches = []
  for (let i = 0; i < list.length; i += size) batches.push(list.slice(i, i + size))
  return batches
}

const sameQuestion = (a, b) => squash(a.question) === squash(b.question) && a.questionType === b.questionType && Number(a.marks) === Number(b.marks)

/**
 * Keeps an answer only while it still belongs to its question: the stored answer carries a copy of the question text, type
 * and marks it was written for, so editing a question (or a slow reply arriving after an edit) never shows an old answer.
 * Returns { [questionId]: answerPoints[] }.
 */
export function answersFor(questions, stored) {
  const result = {}
  questions.forEach((q) => {
    const entry = stored?.[q.id]
    if (entry && Array.isArray(entry.answerPoints) && entry.answerPoints.length > 0 && sameQuestion(entry, q)) result[q.id] = entry.answerPoints
  })
  return result
}

/** Reads saved answers back safely: only well-formed entries survive. */
export function sanitizeStoredAnswers(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const result = {}
  Object.entries(raw).forEach(([id, entry]) => {
    if (
      entry && typeof entry.question === 'string' && typeof entry.questionType === 'string' && Number.isFinite(Number(entry.marks)) &&
      Array.isArray(entry.answerPoints) && entry.answerPoints.length > 0 && entry.answerPoints.every((p) => typeof p === 'string' && p.trim())
    ) {
      result[id] = { question: entry.question, questionType: entry.questionType, marks: Number(entry.marks), answerPoints: entry.answerPoints }
    }
  })
  return result
}

// ---------------------------------------------------------------- answers from POST /questions/ask

export const MAX_ANSWER_POINTS = 8 // backend: MAX_ANSWER_POINTS (answer points of one question)
export const MAX_POINT_LENGTH = 300 // backend: MAX_POINT_LENGTH / the saved set's answer point limit
const MIN_POINT_LENGTH = 3
export const ANSWER_CONCURRENCY = 3 // questions answered at the same time

const POINT_COUNT = { 2: '2 to 3', 5: '4 to 5', 10: '6 to 8', 15: '6 to 8' }

/**
 * The text sent to POST /questions/ask for one typed question. That endpoint takes only `question`, so the type and marks go
 * into the text as a short note that sets how deep the answer should be (the same depth the PDF-based answers use).
 */
export function buildAskPrompt({ question, questionType, marks }) {
  const guide =
    questionType === 'mcq'
      ? 'Give the correct option and a one or two sentence reason.'
      : `Answer in ${POINT_COUNT[Number(marks)] ?? '3 to 5'} short bullet points covering what an examiner expects, each under 250 characters.`
  return `${squash(question)}\n\n(University exam practice question: ${typeLabel(questionType)}, ${Number(marks)} marks. ${guide})`
}

const BULLET = /^\s*(?:[-*\u2022\u2023\u25AA]|\d{1,2}[.)])\s+/

const stripMarkdown = (text) =>
  text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // [text](url) → text
    .replace(/(\*\*|__|`)/g, '')
    .replace(/^\s*>\s?/, '')
    .replace(/\s+/g, ' ')
    .trim()

const shorten = (sentence) => `${sentence.slice(0, MAX_POINT_LENGTH - 3).replace(/\s+\S*$/, '')}\u2026`

// A point longer than the limit is cut at sentence ends into several points; one endless sentence is shortened.
function fitLength(text) {
  if (text.length <= MAX_POINT_LENGTH) return [text]
  const sentences = (text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [text]).map((s) => s.trim()).filter(Boolean)
  const parts = []
  let buffer = ''
  sentences.forEach((sentence) => {
    if (sentence.length > MAX_POINT_LENGTH) {
      if (buffer) parts.push(buffer)
      buffer = ''
      parts.push(shorten(sentence))
    } else if (!buffer) {
      buffer = sentence
    } else if (`${buffer} ${sentence}`.length <= MAX_POINT_LENGTH) {
      buffer = `${buffer} ${sentence}`
    } else {
      parts.push(buffer)
      buffer = sentence
    }
  })
  if (buffer) parts.push(buffer)
  return parts
}

/**
 * The Markdown answer of POST /questions/ask as answer points: one per bullet or paragraph, plain text, each within the backend's
 * length limit, without duplicates and at most MAX_ANSWER_POINTS. Headings, code fence lines and "Key points:" style labels are
 * left out. Returns [] when nothing usable is in the text.
 */
export function answerToPoints(markdown) {
  const items = []
  let current = null // the bullet or paragraph a following plain line continues
  String(markdown ?? '').split(/\r?\n/).forEach((line) => {
    if (!line.trim() || /^\s*```/.test(line) || /^\s*#{1,6}\s/.test(line) || /^\s*([-*_]\s*){3,}$/.test(line)) {
      current = null
      return
    }
    const bullet = BULLET.test(line)
    const body = stripMarkdown(line.replace(BULLET, ''))
    if (!body) return
    if (/^[^.!?]{1,60}:$/.test(body)) {
      current = null // a label such as "Key points:"
      return
    }
    if (bullet || !current) {
      current = { text: body }
      items.push(current)
    } else {
      current.text += ` ${body}`
    }
  })

  const seen = new Set()
  const points = []
  items.forEach((item) =>
    fitLength(item.text).forEach((text) => {
      const key = text.toLowerCase()
      if (text.length >= MIN_POINT_LENGTH && !seen.has(key)) {
        seen.add(key)
        points.push(text)
      }
    }),
  )
  return points.slice(0, MAX_ANSWER_POINTS)
}

const isPerQuestionFailure = (err) => err?.status === 422 // the AI declined this one question; the others can still be answered

/**
 * Answers the given stored questions one request each (`ask(text)` resolves with the body of POST /questions/ask), a few at a
 * time. Resolves { data: { questions: [{ id, question, questionType, marks, answerPoints }] }, meta: { requested, generated, warnings } }
 * with the questions that were answered, in order. A question that failed is left out and mentioned in meta.warnings; if none
 * could be answered the first error is thrown. After an error that is not about one question (not signed in, quota, network)
 * no further questions are started. A cancelled `signal` stops at once with an error that has `cancelled: true`.
 */
export async function answerManualQuestions({ questions, ask, signal, concurrency = ANSWER_CONCURRENCY }) {
  const items = Array.isArray(questions) ? questions : []
  const answered = new Array(items.length).fill(null)
  const errors = []
  let unusable = 0
  let next = 0
  let stop = false

  const worker = async () => {
    while (!stop && !signal?.aborted && next < items.length) {
      const index = next
      next += 1
      const item = items[index]
      try {
        const body = await ask(buildAskPrompt(item))
        const answerPoints = answerToPoints(body?.data?.answer)
        if (answerPoints.length === 0) unusable += 1
        else answered[index] = { id: item.id, question: item.question, questionType: item.questionType, marks: item.marks, answerPoints }
      } catch (err) {
        if (signal?.aborted) return
        errors.push(err)
        if (!isPerQuestionFailure(err)) stop = true
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), Math.max(1, items.length)) }, worker))

  if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { cancelled: true })
  const questionsWithAnswers = answered.filter(Boolean)
  if (items.length > 0 && questionsWithAnswers.length === 0) {
    throw errors[0] ?? { message: 'The AI did not return a usable answer. Please try again.', status: null, data: null }
  }

  const missing = items.length - questionsWithAnswers.length
  const warnings = []
  if (missing > 0) {
    const reason = errors[0]?.message ? ` ${errors[0].message}` : ''
    warnings.push(`${missing} of ${items.length} ${items.length === 1 ? 'question' : 'questions'} could not be answered.${reason} Choose Generate answers again to retry.`)
  }
  return { data: { questions: questionsWithAnswers }, meta: { requested: items.length, generated: questionsWithAnswers.length, warnings } }
}

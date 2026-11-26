// Rules for the AI question generator (POST /api/questions/important). They mirror the backend
// (validators/importantQuestionValidators.js) so people get instant feedback; the backend still re-checks everything.
//
// KEEP IN SYNC with the backend: QUESTION_TYPES, GENERATION_MARKS, FORMAT_MARKS, difficulty modes, and the limits
// (maxPapers = 3, MAX_QUESTIONS_PER_REQUEST = 30 by default). If the backend's limits are changed in its .env, edit the
// two limits below.

export const MAX_PAPERS = 3
export const MAX_TOTAL_QUESTIONS = 30

/** In the order the backend uses for its groups. */
export const QUESTION_TYPES = [
  { value: 'mcq', label: 'MCQ', hint: '2 marks only' },
  { value: 'short_answer', label: 'Short Answer' },
  { value: 'essay', label: 'Essay', hint: '10 or 15 marks only' },
  { value: 'paragraph', label: 'Paragraph' },
  { value: 'long_answer', label: 'Long Answer' },
  { value: 'problem_solving', label: 'Problem Solving' },
]

export const DIFFICULTIES = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
  { value: 'balanced', label: 'Balanced', hint: 'A mix of easy, medium and hard' },
]
export const DEFAULT_DIFFICULTY = 'balanced'

export const GENERATION_MARKS = [2, 5, 10, 15]

/** Formats that only make sense for some marks. A type that is not listed can be asked for with any supported marks. */
export const FORMAT_MARKS = { mcq: [2], essay: [10, 15] }

export const emptyCounts = () => Object.fromEntries(GENERATION_MARKS.map((marks) => [marks, '']))

const typeOrder = QUESTION_TYPES.map((t) => t.value)

export const typeLabel = (value) => QUESTION_TYPES.find((t) => t.value === value)?.label ?? String(value ?? '').replace(/_/g, ' ')

/** The selected question types that may be asked for `marks` (mcq only for 2 marks, essay only for 10 / 15). */
export const allowedTypesFor = (marks, types) => types.filter((type) => !FORMAT_MARKS[type] || FORMAT_MARKS[type].includes(marks))

/** Selected types in the backend's order, without duplicates or unknown values. */
export const orderTypes = (types) => typeOrder.filter((type) => types.includes(type))

/** Whole-number value of a count field: '' is 0; anything that is not a whole number >= 0 gives NaN. */
export function parseCount(raw) {
  if (raw === '' || raw === null || raw === undefined) return 0
  const text = String(raw).trim()
  return /^\d+$/.test(text) ? Number(text) : Number.NaN
}

/** A marks row can only be used when at least one selected type may be asked for those marks. */
export const marksEnabled = (marks, types) => allowedTypesFor(marks, types).length > 0

/** Counts that count: a row no selected type can fill is treated as 0 (and shown disabled). */
export function effectiveCounts(counts, types) {
  return Object.fromEntries(GENERATION_MARKS.map((marks) => [marks, marksEnabled(marks, types) ? parseCount(counts[marks]) : 0]))
}

export const totalQuestions = (counts, types) =>
  GENERATION_MARKS.reduce((sum, marks) => {
    const n = effectiveCounts(counts, types)[marks]
    return sum + (Number.isFinite(n) ? n : 0)
  }, 0)

/**
 * The exact request body of POST /api/questions/important:
 * { subjectId, semesterId, regulationId, paperIds, questionTypes, marksDistribution: [{ marks, count }], difficulty, questionCount }
 * (no units, topics or answers; the questions come only from the selected papers).
 */
export function buildRequest({ subjectId, semesterId, regulationId, paperIds, questionTypes, difficulty, counts }) {
  const types = orderTypes(questionTypes)
  const effective = effectiveCounts(counts, types)
  const marksDistribution = GENERATION_MARKS.filter((marks) => effective[marks] > 0).map((marks) => ({ marks, count: effective[marks] }))
  return {
    subjectId,
    semesterId,
    regulationId,
    paperIds: [...new Set(paperIds.filter((id) => typeof id === 'string' && id !== ''))], // the ids of the selected papers, as the API expects
    questionTypes: types,
    marksDistribution,
    difficulty,
    questionCount: marksDistribution.reduce((sum, entry) => sum + entry.count, 0),
  }
}

/**
 * Client-side checks, keyed like the backend's error fields:
 * subjectId, semesterId, regulationId, paperIds, questionTypes, marksDistribution (overall) and `marks:<n>` (one row).
 * Returns {} when the form can be submitted.
 */
export function validateGeneration({ subjectId, semesterId, regulationId, paperIds, questionTypes, difficulty, counts }) {
  const errors = {}
  if (!regulationId) errors.regulationId = 'Select a regulation'
  if (!semesterId) errors.semesterId = 'Select a semester'
  if (!subjectId) errors.subjectId = 'Select a subject'

  if (paperIds.length < 1) errors.paperIds = 'Select at least 1 uploaded paper'
  else if (paperIds.length > MAX_PAPERS) errors.paperIds = `You can select at most ${MAX_PAPERS} papers`

  const types = orderTypes(questionTypes)
  if (types.length === 0) errors.questionTypes = 'Select at least one question type'

  if (!DIFFICULTIES.some((d) => d.value === difficulty)) errors.difficulty = 'Select a difficulty'

  let total = 0
  GENERATION_MARKS.forEach((marks) => {
    if (types.length > 0 && !marksEnabled(marks, types)) return // disabled row, counted as 0
    const n = parseCount(counts[marks])
    if (Number.isNaN(n)) errors[`marks:${marks}`] = 'Enter a whole number (0 or more)'
    else if (n > MAX_TOTAL_QUESTIONS) errors[`marks:${marks}`] = `At most ${MAX_TOTAL_QUESTIONS} questions`
    else total += n
  })
  if (types.length > 0 && !GENERATION_MARKS.some((marks) => marksEnabled(marks, types))) {
    errors.marksDistribution = 'The selected question types cannot be asked for any supported marks'
  } else if (!Object.keys(errors).some((key) => key.startsWith('marks:'))) {
    if (total === 0) errors.marksDistribution = 'Enter how many questions you want for at least one marks value'
    else if (total > MAX_TOTAL_QUESTIONS) errors.marksDistribution = `At most ${MAX_TOTAL_QUESTIONS} questions can be generated per request (you asked for ${total})`
  }
  return errors
}

/** Selected types that no marks row with a count can use (so they would never appear): a gentle hint, not an error. */
export function unusedTypes(counts, questionTypes) {
  const types = orderTypes(questionTypes)
  const effective = effectiveCounts(counts, types)
  const usedMarks = GENERATION_MARKS.filter((marks) => effective[marks] > 0)
  return types.filter((type) => !usedMarks.some((marks) => allowedTypesFor(marks, [type]).length > 0))
}

// ---------------------------------------------------------------- reading the response

const asText = (item) => {
  if (typeof item === 'string') return item.trim()
  if (item && typeof item === 'object') return String(item.message ?? item.warning ?? item.text ?? '').trim()
  return ''
}

/** Warning lists may hold strings or { message } objects; always returns a list of non-empty strings. */
export const toTextList = (list) => (Array.isArray(list) ? list.map(asText).filter(Boolean) : [])

/**
 * Normalises the success body { data, meta } so the UI can rely on its shape.
 * groups: [{ questionType, marks, questions: [{ questionId, difficulty, question, options? }] }], backend order.
 */
export function normalizeResult(body) {
  const data = body?.data ?? {}
  const meta = body?.meta ?? {}
  const groups = (Array.isArray(data.groups) ? data.groups : [])
    .map((g) => ({ questionType: g.questionType, marks: g.marks, questions: Array.isArray(g.questions) ? g.questions : [] }))
    .filter((g) => g.questions.length > 0)
  const generated = Number.isFinite(meta.generated) ? meta.generated : groups.reduce((sum, g) => sum + g.questions.length, 0)
  const requested = Number.isFinite(meta.requested) ? meta.requested : generated
  const unmet = (Array.isArray(meta.unmet) ? meta.unmet : []).filter((u) => u && Number.isFinite(u.requested))
  return {
    generationId: data.generationId ?? '',
    subject: data.subject ?? null,
    academic: data.academic ?? null,
    difficulty: data.difficulty ?? '',
    disclaimer: typeof data.disclaimer === 'string' ? data.disclaimer : '',
    groups,
    generated,
    requested,
    shortfall: Number.isFinite(meta.shortfall) ? meta.shortfall : Math.max(0, requested - generated),
    partial: meta.distributionSatisfied === false || generated < requested || unmet.length > 0,
    unmet,
    warnings: toTextList(meta.warnings),
    extractionWarnings: toTextList(meta.extractionWarnings),
  }
}

/** Question groups folded into one section per question type: [{ questionType, total, byMarks: [{ marks, questions }] }]. */
export function groupByType(groups) {
  const sections = []
  groups.forEach((group) => {
    let section = sections.find((s) => s.questionType === group.questionType)
    if (!section) {
      section = { questionType: group.questionType, total: 0, byMarks: [] }
      sections.push(section)
    }
    section.total += group.questions.length
    section.byMarks.push({ marks: group.marks, questions: group.questions })
  })
  const rank = (type) => (typeOrder.includes(type) ? typeOrder.indexOf(type) : 99)
  sections.forEach((s) => s.byMarks.sort((a, b) => a.marks - b.marks))
  return sections.sort((a, b) => rank(a.questionType) - rank(b.questionType))
}

/** "3 × 5-mark Short Answer" style text for a part of the request the backend could not fill. */
export const describeUnmet = (u) =>
  `${u.marks}-mark ${u.questionType ? typeLabel(u.questionType) : 'questions'}: ${u.generated ?? 0} of ${u.requested} generated`

/** One readable line per backend validation error, e.g. "Marks 5 is listed more than once ...". */
export function describeServerErrors(errors, request) {
  if (!Array.isArray(errors)) return []
  return errors
    .filter((e) => e && typeof e.message === 'string')
    .map((e) => {
      const row = /^marksDistribution\[(\d+)\]/.exec(e.field || '')
      const marks = row ? request?.marksDistribution?.[Number(row[1])]?.marks : undefined
      return marks ? `${marks}-mark row: ${e.message}` : e.message
    })
}

// ---------------------------------------------------------------- uploaded papers

// Text is extracted automatically before generating (utils/paperExtraction.js), so a paper that has not been read yet
// ("pending") or is being read ("processing") is a normal choice. Only a paper whose last extraction failed is left out of
// the automatic selection (it can still be chosen by hand and is retried). No status = eligible.
const NOT_AUTO_SELECTED = ['failed', 'error']
const extractionStatus = (paper) => String(paper?.extractionStatus ?? paper?.extraction?.status ?? '').trim().toLowerCase()

/** { eligible, reason } for a paper from GET /papers: eligible = may be part of the automatic selection. */
export function paperEligibility(paper) {
  const status = extractionStatus(paper)
  if (!NOT_AUTO_SELECTED.includes(status)) return { eligible: true, reason: '' }
  return { eligible: false, reason: 'Last text reading failed. It will be retried when you generate' }
}

/** A short note for the paper list about the state of its text; '' when it is ready (or the state is unknown). */
export function extractionNote(paper) {
  const status = extractionStatus(paper)
  if (status === 'completed' || status === '') return ''
  if (status === 'processing') return 'Text is being read. We will wait for it'
  if (NOT_AUTO_SELECTED.includes(status)) return 'Last text reading failed. It will be retried when you generate'
  return 'Text is read automatically when you generate'
}

/** The papers selected before the person changes anything: the newest eligible ones, at most MAX_PAPERS. { [id]: { _id, title } } */
export function defaultPaperSelection(papers) {
  return Object.fromEntries(
    (papers ?? [])
      .filter((paper) => paper?._id && paperEligibility(paper).eligible)
      .slice(0, MAX_PAPERS)
      .map((paper) => [paper._id, { _id: paper._id, title: paper.title, extractionStatus: paper.extractionStatus }]),
  )
}

// ---------------------------------------------------------------- searching generated questions

const squash = (text) => String(text ?? '').toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Keeps the questions whose text or question type matches `query`, and drops groups that end up empty (order and grouping
 * stay as they are). Every word of the query must be found in the question text or in its type (label or value, so
 * "short answer", "short_answer" and "mcq" all work). An empty query keeps everything.
 */
export function filterGroups(groups, query) {
  const terms = squash(query).split(' ').filter(Boolean)
  if (terms.length === 0) return groups
  return groups
    .map((group) => {
      const type = `${squash(group.questionType)} ${squash(typeLabel(group.questionType))}`
      return { ...group, questions: group.questions.filter((q) => { const haystack = `${squash(q.question)} ${type}`; return terms.every((term) => haystack.includes(term)) }) }
    })
    .filter((group) => group.questions.length > 0)
}

export const countQuestions = (groups) => groups.reduce((sum, group) => sum + group.questions.length, 0)

// ---------------------------------------------------------------- copying questions

const copyOptions = (options) =>
  (Array.isArray(options) ? options : [])
    .map((option, i) => `${option?.label ?? String.fromCharCode(65 + i)}) ${String(option?.text ?? option ?? '').trim()}`)
    .filter((line) => !/^[A-Z]\) $/.test(line))

/** One question as plain text: "[Type · N marks]", the question, and its MCQ options when it has any. `number` adds a "1." prefix. */
export function formatQuestionForCopy(question, { questionType, marks }, number) {
  const label = `[${typeLabel(questionType)} · ${marks} ${Number(marks) === 1 ? 'mark' : 'marks'}]`
  const lines = [`${number ? `${number}. ` : ''}${label}`, String(question?.question ?? '').trim(), ...copyOptions(question?.options)]
  return lines.join('\n')
}

/** All questions as plain text, numbered in the order they are listed on screen (by type, then marks), separated by blank lines. */
export function formatQuestionsForCopy(groups) {
  let number = 0
  const blocks = []
  groupByType(groups).forEach((section) =>
    section.byMarks.forEach(({ marks, questions }) =>
      questions.forEach((question) => {
        number += 1
        blocks.push(formatQuestionForCopy(question, { questionType: section.questionType, marks }, number))
      }),
    ),
  )
  return blocks.join('\n\n')
}

/**
 * One answer as plain text for the per-answer Copy button: the MCQ key ("Correct answer: B) Stack"), the explanation and the
 * answer points ("- point" lines). Only the answer is included, never the question. '' when there is nothing to copy.
 */
export function formatAnswerForCopy({ key = '', explanation = '', points = [] } = {}) {
  const lines = []
  if (String(key).trim()) lines.push(`Correct answer: ${String(key).trim()}`)
  if (String(explanation).trim()) lines.push(String(explanation).trim())
  ;(Array.isArray(points) ? points : []).forEach((point) => {
    if (String(point ?? '').trim()) lines.push(`- ${String(point).trim()}`)
  })
  return lines.join('\n')
}

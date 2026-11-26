import { post } from './api.js'
import { answerManualQuestions } from '../utils/manualQuestions.js'

// AI question generation: the existing backend route in routes/questionRoutes.js, mounted at /api/questions.
// Response: { success, message, data: { generationId, groups, disclaimer, ... }, meta: { requested, generated, warnings, ... } }.

// The model can take a while (it reads the selected papers first), so the shared client's 15 s default is far too short.
const GENERATION_TIMEOUT_MS = 180000

/**
 * POST /questions/important with the request built by utils/questionGeneration.js › buildRequest.
 * Returns the whole body ({ data, meta }). Errors arrive as { message, status, data } (see services/api.js);
 * validation failures carry data.errors: [{ field, message }].
 */
export const generateImportantQuestions = (request, { signal } = {}) =>
  post('/questions/important', request, { timeout: GENERATION_TIMEOUT_MS, signal })

/**
 * AI answers for questions the student typed in. The backend has no separate route for these: it answers a free-standing
 * question through its existing POST /questions/ask { question } → { data: { question, answer } } (Markdown text). So each
 * question is sent there on its own (see utils/manualQuestions.js › answerManualQuestions, which also turns the Markdown into
 * answer points) and the result has the shape callers already use: { data: { questions: [{ id, question, questionType, marks,
 * answerPoints }] }, meta: { requested, generated, warnings } }. The PDF-based answers (POST /questions/important/:generationId/answers)
 * are a different, unchanged flow.
 */
export const generateManualAnswers = ({ questions } = {}, { signal } = {}) =>
  answerManualQuestions({
    questions,
    signal,
    ask: (question) => post('/questions/ask', { question }, { timeout: GENERATION_TIMEOUT_MS, signal }),
  })

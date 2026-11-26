'use strict';

const ApiError = require('../utils/ApiError');
const { isValidObjectId } = require('./commonValidators');
const { QUESTION_TYPES, DIFFICULTIES, LIMITS: GENERATION_LIMITS } = require('./importantQuestionValidators');

// Input rules for the Phase 2B saved question set endpoints.
//
// The saved questions have the shape of one generated question (see POST /api/questions/important):
//   { questionType, marks, question, unit, topic }   (the client flattens the response's groups into one array)
// Phase 2E questions may also carry difficulty, and either options + correctAnswer + explanation (mcq) or
// answerPoints (every other type): exactly what POST /api/questions/important returns, so a generated question can be
// saved as it is. All of these are optional for the earlier types, so sets built before Phase 2E still save.
// Only the fields listed below are accepted: `student` (or anything else) in the body is an "Unknown field" 400,
// because the owner always comes from the verified token.

const LIMITS = Object.freeze({
  maxBodyBytes: 400 * 1024, // generous: 50 questions with options, explanation and answer points are about 325 KB at the very most
  maxTitleLength: 150,
  minQuestions: 1,
  maxQuestions: GENERATION_LIMITS.maxTotalQuestions,
  minMarks: GENERATION_LIMITS.minMarks,
  maxMarks: GENERATION_LIMITS.maxMarks,
  minQuestionLength: 10,
  maxQuestionLength: 1000,
  maxUnitLength: 100,
  maxTopicLength: 150,
  optionLabels: ['A', 'B', 'C', 'D'],
  maxOptionLength: 300,
  minExplanationLength: 10,
  maxExplanationLength: 1000,
  maxAnswerPoints: 8,
  minAnswerPointLength: 3,
  maxAnswerPointLength: 300,
  maxSavedSetsPerStudent: 100,
  maxErrorDetails: 50,
});

const SAVE_FIELDS = Object.freeze(['title', 'subjectId', 'semesterId', 'regulationId', 'questions', 'questionCount']);
// questionId is the id a question has in a generated set (two-stage generation). It is accepted so a generated question can be
// saved as it is, but it is not stored: a saved set keeps its own questions.
const QUESTION_FIELDS = Object.freeze(['questionId', 'questionType', 'marks', 'question', 'unit', 'topic', 'difficulty', 'options', 'correctAnswer', 'explanation', 'answerPoints']);

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key) && object[key] !== undefined;
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

const checkText = (raw, label, min, max) => {
  if (typeof raw !== 'string') return { error: `${label} must be text` };
  if (CONTROL_CHARACTERS.test(raw)) return { error: `${label} cannot contain control characters or line breaks` };
  const value = raw.trim().replace(/\s+/g, ' ');
  if (value === '') return { error: `${label} cannot be empty` };
  if (value.length < min) return { error: `${label} must be at least ${min} characters` };
  if (value.length > max) return { error: `${label} cannot exceed ${max} characters` };
  return { value };
};

const unknownFields = (object, allowed, prefix, details) => {
  Object.keys(object).slice(0, 20).forEach((key) => {
    if (!allowed.includes(key)) details.push({ field: prefix ? `${prefix}.${key}` : key, message: 'Unknown field' });
  });
};

/**
 * Middleware for the save route: refuses a request whose JSON body is larger than LIMITS.maxBodyBytes with 413.
 * (The global parser already caps every body at 1 MB; this is the tighter limit for this endpoint.)
 */
const limitSaveBodySize = (req, res, next) => {
  const declared = Number(req.headers['content-length']);
  const size = Number.isFinite(declared) && declared > 0 ? declared : Buffer.byteLength(JSON.stringify(req.body || {}));
  if (size > LIMITS.maxBodyBytes) return next(new ApiError(413, `Request body is too large (maximum ${LIMITS.maxBodyBytes / 1024} KB)`));
  return next();
};

// Phase 2E: difficulty and the answer key. Returns only the fields that were sent, so a question built before this
// phase keeps its exact shape.
const validateAnswerFields = (raw, prefix, questionType, details) => {
  const extra = {};
  const isMcq = questionType === 'mcq';

  if (has(raw, 'difficulty') && raw.difficulty !== null) {
    const level = typeof raw.difficulty === 'string' ? raw.difficulty.trim().toLowerCase() : raw.difficulty;
    if (typeof level !== 'string' || !DIFFICULTIES.includes(level)) {
      details.push({ field: `${prefix}.difficulty`, message: `difficulty must be one of: ${DIFFICULTIES.join(', ')}` });
    } else {
      extra.difficulty = level;
    }
  }

  const present = (key) => has(raw, key) && raw[key] !== null;

  if (isMcq) {
    // Options: exactly four, labelled A-D in order, distinct.
    let labels = null;
    if (!present('options')) {
      details.push({ field: `${prefix}.options`, message: 'options is required for mcq questions' });
    } else if (!Array.isArray(raw.options) || raw.options.length !== LIMITS.optionLabels.length) {
      details.push({ field: `${prefix}.options`, message: `options must be an array of exactly ${LIMITS.optionLabels.length} { label, text } objects` });
    } else {
      const options = [];
      let optionsOk = true;
      raw.options.forEach((option, index) => {
        const field = `${prefix}.options[${index}]`;
        if (!isPlainObject(option)) {
          details.push({ field, message: 'Each option must be an object like { "label": "A", "text": "..." }' });
          optionsOk = false;
          return;
        }
        unknownFields(option, ['label', 'text'], field, details);
        const expected = LIMITS.optionLabels[index];
        if (option.label !== expected) {
          details.push({ field: `${field}.label`, message: `label must be "${expected}" (options are labelled A, B, C, D in order)` });
          optionsOk = false;
        }
        const text = has(option, 'text') ? checkText(option.text, 'option text', 1, LIMITS.maxOptionLength) : { error: 'option text is required' };
        if (text.error) {
          details.push({ field: `${field}.text`, message: text.error });
          optionsOk = false;
        } else {
          options.push({ label: expected, text: text.value });
        }
      });
      if (optionsOk) {
        if (new Set(options.map((option) => option.text.toLowerCase())).size !== options.length) {
          details.push({ field: `${prefix}.options`, message: 'The four options must be different from each other' });
        } else {
          extra.options = options;
          labels = options.map((option) => option.label);
        }
      }
    }

    // Two-stage generation: an MCQ saved before its answer was generated has options only. The answer key (correctAnswer +
    // explanation) is therefore optional, but the two always come together.
    if (present('correctAnswer') && !present('explanation')) {
      details.push({ field: `${prefix}.explanation`, message: 'explanation is required when correctAnswer is given' });
    }
    if (present('explanation') && !present('correctAnswer')) {
      details.push({ field: `${prefix}.correctAnswer`, message: 'correctAnswer is required when explanation is given' });
    }

    if (present('correctAnswer')) {
      if (typeof raw.correctAnswer !== 'string' || !LIMITS.optionLabels.includes(raw.correctAnswer)) {
        details.push({ field: `${prefix}.correctAnswer`, message: `correctAnswer must be one of: ${LIMITS.optionLabels.join(', ')}` });
      } else if (labels || !present('options')) {
        extra.correctAnswer = raw.correctAnswer;
      }
    }

    if (present('explanation')) {
      const checked = checkText(raw.explanation, 'explanation', LIMITS.minExplanationLength, LIMITS.maxExplanationLength);
      if (checked.error) details.push({ field: `${prefix}.explanation`, message: checked.error });
      else extra.explanation = checked.value;
    }

    if (present('answerPoints')) details.push({ field: `${prefix}.answerPoints`, message: 'answerPoints is not allowed for mcq questions' });
    return extra;
  }

  ['options', 'correctAnswer', 'explanation'].forEach((key) => {
    if (present(key)) details.push({ field: `${prefix}.${key}`, message: `${key} is only allowed for mcq questions` });
  });
  if (present('answerPoints')) {
    if (!Array.isArray(raw.answerPoints) || raw.answerPoints.length < 1 || raw.answerPoints.length > LIMITS.maxAnswerPoints) {
      details.push({ field: `${prefix}.answerPoints`, message: `answerPoints must be an array of 1 to ${LIMITS.maxAnswerPoints} short texts` });
    } else {
      const points = [];
      let pointsOk = true;
      raw.answerPoints.forEach((point, index) => {
        const checked = checkText(point, 'answer point', LIMITS.minAnswerPointLength, LIMITS.maxAnswerPointLength);
        if (checked.error) {
          details.push({ field: `${prefix}.answerPoints[${index}]`, message: checked.error });
          pointsOk = false;
        } else {
          points.push(checked.value);
        }
      });
      if (pointsOk) extra.answerPoints = points;
    }
  }
  return extra;
};

const validateOneQuestion = (raw, index, details) => {
  const prefix = `questions[${index}]`;
  if (!isPlainObject(raw)) {
    details.push({ field: prefix, message: 'Each question must be an object like { "questionType", "marks", "question" }' });
    return null;
  }
  const before = details.length;
  unknownFields(raw, QUESTION_FIELDS, prefix, details);
  if (has(raw, 'questionId') && raw.questionId !== null && !isValidObjectId(raw.questionId)) {
    details.push({ field: `${prefix}.questionId`, message: 'questionId must be a valid MongoDB ObjectId' });
  }

  let questionType;
  const type = typeof raw.questionType === 'string' ? raw.questionType.trim().toLowerCase() : raw.questionType;
  if (!has(raw, 'questionType')) details.push({ field: `${prefix}.questionType`, message: 'questionType is required' });
  else if (typeof type !== 'string' || !QUESTION_TYPES.includes(type)) {
    details.push({ field: `${prefix}.questionType`, message: `questionType must be one of: ${QUESTION_TYPES.join(', ')}` });
  } else questionType = type;

  let marks;
  if (!has(raw, 'marks')) details.push({ field: `${prefix}.marks`, message: 'marks is required' });
  else if (typeof raw.marks !== 'number' || !Number.isInteger(raw.marks) || raw.marks < LIMITS.minMarks || raw.marks > LIMITS.maxMarks) {
    details.push({ field: `${prefix}.marks`, message: `marks must be a whole number between ${LIMITS.minMarks} and ${LIMITS.maxMarks}` });
  } else marks = raw.marks;

  let question;
  if (!has(raw, 'question')) details.push({ field: `${prefix}.question`, message: 'question is required' });
  else {
    const checked = checkText(raw.question, 'question', LIMITS.minQuestionLength, LIMITS.maxQuestionLength);
    if (checked.error) details.push({ field: `${prefix}.question`, message: checked.error });
    else question = checked.value;
  }

  const optional = (key, label, max) => {
    if (!has(raw, key) || raw[key] === null) return null;
    const checked = checkText(raw[key], label, 1, max);
    if (checked.error) {
      details.push({ field: `${prefix}.${key}`, message: checked.error });
      return null;
    }
    return checked.value;
  };
  const unit = optional('unit', 'unit', LIMITS.maxUnitLength);
  const topic = optional('topic', 'topic', LIMITS.maxTopicLength);

  const extra = validateAnswerFields(raw, prefix, questionType, details);

  if (details.length > before) return null;
  return { questionType, marks, question, unit, topic, ...extra };
};

/**
 * Validates the body of POST /api/saved-question-sets and returns the cleaned input:
 *   { title, subjectId, semesterId, regulationId (lower-case ids), questions: [{ questionType, marks, question, unit, topic,
 *     difficulty?, options?, correctAnswer?, explanation?, answerPoints? }] }
 * Throws a 400 ApiError with errors: [{ field, message }].
 */
const validateSaveRequest = (body) => {
  if (!isPlainObject(body)) throw ApiError.badRequest('Request body must be a JSON object');

  const details = [];
  unknownFields(body, SAVE_FIELDS, '', details);

  let title;
  if (!has(body, 'title')) details.push({ field: 'title', message: 'title is required' });
  else {
    const checked = checkText(body.title, 'title', 1, LIMITS.maxTitleLength);
    if (checked.error) details.push({ field: 'title', message: checked.error });
    else title = checked.value;
  }

  const ids = {};
  ['subjectId', 'semesterId', 'regulationId'].forEach((field) => {
    if (!has(body, field)) details.push({ field, message: `${field} is required` });
    else if (!isValidObjectId(body[field])) details.push({ field, message: `${field} must be a valid MongoDB ObjectId` });
    else ids[field] = body[field].toLowerCase();
  });

  const questions = [];
  if (!has(body, 'questions')) {
    details.push({ field: 'questions', message: 'questions is required' });
  } else if (!Array.isArray(body.questions)) {
    details.push({ field: 'questions', message: 'questions must be an array' });
  } else if (body.questions.length < LIMITS.minQuestions) {
    details.push({ field: 'questions', message: 'questions cannot be empty; save at least one question' });
  } else if (body.questions.length > LIMITS.maxQuestions) {
    details.push({ field: 'questions', message: `A saved set cannot contain more than ${LIMITS.maxQuestions} questions (received ${body.questions.length})` });
  } else {
    const seen = new Map();
    body.questions.forEach((raw, index) => {
      const checked = validateOneQuestion(raw, index, details);
      if (!checked) return;
      const key = checked.question.toLowerCase();
      if (seen.has(key)) {
        details.push({ field: `questions[${index}].question`, message: `Duplicate of questions[${seen.get(key)}]` });
        return;
      }
      seen.set(key, index);
      questions.push(checked);
    });
  }

  if (has(body, 'questionCount') && body.questionCount !== null && Array.isArray(body.questions)
    && body.questions.length >= 1 && body.questions.length <= LIMITS.maxQuestions) {
    if (!Number.isInteger(body.questionCount) || body.questionCount !== body.questions.length) {
      details.push({ field: 'questionCount', message: `questionCount must equal the number of questions (${body.questions.length})` });
    }
  }

  if (details.length > 0) throw ApiError.badRequest('Validation failed', details.slice(0, LIMITS.maxErrorDetails));
  return { title, subjectId: ids.subjectId, semesterId: ids.semesterId, regulationId: ids.regulationId, questions };
};

const SORT_VALUES = Object.freeze(['newest', 'oldest']);
const HISTORY = Object.freeze({ maxSearchLength: 100, defaultSort: 'newest' });

/**
 * Validates the history filters of GET /api/saved-question-sets. Pagination (?page=&limit=) is handled by
 * validatePagination. Unknown query parameters are ignored, so nothing in the query string can reach the database
 * except the values validated here. Returns:
 *   { subjectId?, semesterId?, departmentId? (lower-case ids), shared? (true|false), q? (trimmed text), sort ('newest'|'oldest') }
 *   ?subjectId= ?semesterId= ?departmentId=  ObjectIds (departmentId = the programme, e.g. BCA)
 *   ?shared=true|false                       sharing status (false = private)
 *   ?q=                                      title search, 1-100 characters (an empty value means "no search")
 *   ?sort=newest|oldest                      by creation date, default newest
 */
const validateListFilters = (query) => {
  const details = [];
  const filters = {};

  ['subjectId', 'semesterId', 'departmentId'].forEach((field) => {
    if (query[field] === undefined) return;
    if (!isValidObjectId(query[field])) details.push({ field, message: `${field} must be a valid MongoDB ObjectId` });
    else filters[field] = query[field].toLowerCase();
  });

  if (query.shared !== undefined) {
    const value = typeof query.shared === 'string' ? query.shared.trim().toLowerCase() : null;
    if (value !== 'true' && value !== 'false') details.push({ field: 'shared', message: 'shared must be "true" or "false"' });
    else filters.shared = value === 'true';
  }

  if (query.q !== undefined) {
    if (typeof query.q !== 'string') {
      details.push({ field: 'q', message: 'q must be text' });
    } else if (CONTROL_CHARACTERS.test(query.q)) {
      details.push({ field: 'q', message: 'q cannot contain control characters' });
    } else {
      const text = query.q.trim().replace(/\s+/g, ' ');
      if (text.length > HISTORY.maxSearchLength) details.push({ field: 'q', message: `q cannot exceed ${HISTORY.maxSearchLength} characters` });
      else if (text !== '') filters.q = text;
    }
  }

  if (query.sort !== undefined) {
    const value = typeof query.sort === 'string' ? query.sort.trim().toLowerCase() : null;
    if (!SORT_VALUES.includes(value)) details.push({ field: 'sort', message: `sort must be one of: ${SORT_VALUES.join(', ')}` });
    else filters.sort = value;
  }
  if (filters.sort === undefined) filters.sort = HISTORY.defaultSort;

  if (details.length > 0) throw ApiError.badRequest('Validation failed', details);
  return filters;
};

module.exports = { validateSaveRequest, validateListFilters, limitSaveBodySize, LIMITS };

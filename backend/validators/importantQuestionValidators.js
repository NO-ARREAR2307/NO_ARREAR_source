'use strict';

const ApiError = require('../utils/ApiError');
const { config } = require('../config/env');
const { isValidObjectId } = require('./commonValidators');

// Input rules for POST /api/questions/important.
//
// Every value is type-checked here, so nothing but plain, bounded text and numbers can reach the prompt or a
// database query. Only the fields listed in REQUEST_FIELDS are accepted; anything else is a 400.
// All problems are collected and reported together as errors: [{ field, message }].
//
// Phase 2E adds: question formats mcq / essay, a difficulty setting (easy | medium | hard | balanced), the supported
// exam marks (2, 5, 10, 15) and a configurable question limit (MAX_QUESTIONS_PER_REQUEST, default 30, at most 50).

// Question types. mcq, short_answer and essay are the Phase 2E formats; paragraph, long_answer and problem_solving
// are the earlier descriptive types and are still accepted, so existing clients and stored sets keep working.
// The ORDER matters: it is the order of the groups in a response.
const QUESTION_TYPES = Object.freeze(['mcq', 'short_answer', 'essay', 'paragraph', 'long_answer', 'problem_solving']);
const QUESTION_TYPE_DESCRIPTIONS = Object.freeze({
  mcq: 'a multiple-choice question with exactly four options, one correct answer and a short explanation',
  short_answer: 'a short answer (a definition, a term, a one- or two-line explanation)',
  essay: 'an essay-style answer (discuss, analyse or evaluate in depth with a clear structure, examples or diagrams)',
  paragraph: 'a paragraph-style answer (explain, describe or differentiate in about a page)',
  long_answer: 'a long / essay-style answer (discuss, elaborate or explain in detail with diagrams or examples)',
  problem_solving: 'a problem to solve, a program to write or a numerical / procedural question',
});

// Difficulty: one level for every question, or "balanced" (a mix of easy, medium and hard).
const DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard']);
const DIFFICULTY_MODES = Object.freeze([...DIFFICULTIES, 'balanced']);
const DEFAULT_DIFFICULTY = 'balanced';
const DIFFICULTY_ALIASES = Object.freeze({ mixed: 'balanced', balance: 'balanced' });

// Marks a generated question may carry. Saved sets keep the wider 1-20 range (LIMITS.minMarks / maxMarks below) so
// every set stored before Phase 2E stays valid.
const GENERATION_MARKS = Object.freeze([2, 5, 10, 15]);
// Formats that only make sense for some marks. A type that is not listed here can be asked for with any supported marks.
const FORMAT_MARKS = Object.freeze({ mcq: Object.freeze([2]), essay: Object.freeze([10, 15]) });

const LIMITS = Object.freeze({
  maxQuestionTypes: QUESTION_TYPES.length,
  maxDistributionEntries: 8,
  minMarks: 1,
  maxMarks: 20,
  maxTotalQuestions: config.questionGeneration.maxTotalQuestions,
  maxCountPerEntry: config.questionGeneration.maxTotalQuestions,
  minPapers: 1,
  maxPapers: config.questionGeneration.maxPapers,
});

// Phase 3C-2: the content of the questions comes ONLY from the student's uploaded papers (paperIds). The old
// client-supplied "units" and "topics" are no longer a content source and are refused with a clear message.
const REQUEST_FIELDS = Object.freeze(['subjectId', 'semesterId', 'regulationId', 'paperIds', 'questionTypes', 'marksDistribution', 'questionCount', 'difficulty']);
const REMOVED_FIELDS = Object.freeze(['units', 'topics']);
const DISTRIBUTION_FIELDS = Object.freeze(['marks', 'count', 'questionType']);

/** The question types from `types` that may be asked for `marks` (mcq only for 2 marks, essay only for 10 / 15). */
const allowedTypesFor = (marks, types) => types.filter((type) => !FORMAT_MARKS[type] || FORMAT_MARKS[type].includes(marks));

const formatRules = () =>
  Object.entries(FORMAT_MARKS)
    .map(([type, marks]) => `${type}: ${marks.join(' or ')} marks`)
    .join('; ');

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key) && object[key] !== undefined;
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const checkInteger = (raw, label, min, max) => {
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    return { error: `${label} must be a whole number between ${min} and ${max}` };
  }
  return { value };
};

const checkMarks = (raw) => {
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof value !== 'number' || !GENERATION_MARKS.includes(value)) {
    return { error: `Marks must be one of: ${GENERATION_MARKS.join(', ')}` };
  }
  return { value };
};

const normalizeType = (raw) => (typeof raw === 'string' ? raw.trim().toLowerCase() : raw);
const typeError = `must be one of: ${QUESTION_TYPES.join(', ')}`;

const unknownFields = (object, allowed, prefix, details) => {
  Object.keys(object).slice(0, 20).forEach((key) => {
    if (!allowed.includes(key)) details.push({ field: prefix ? `${prefix}.${key}` : key, message: 'Unknown field' });
  });
};

/**
 * Validates the request body and returns the cleaned input:
 *   { subjectId, semesterId, regulationId (lower-case ids), questionTypes: [...],
 *     difficulty ('easy' | 'medium' | 'hard' | 'balanced', default 'balanced'),
 *     marksDistribution: [{ marks, count, questionType|null, allowedTypes: [...] }] (sorted by marks), totalQuestions,
 *     paperIds: [1-3 unique lower-case ObjectIds, in request order] }
 * Throws a 400 ApiError with errors: [{ field, message }].
 */
const validateImportantQuestionRequest = (body) => {
  if (!isPlainObject(body)) throw ApiError.badRequest('Request body must be a JSON object');

  const details = [];
  Object.keys(body).slice(0, 20).forEach((key) => {
    if (REMOVED_FIELDS.includes(key)) {
      details.push({ field: key, message: `${key} is no longer supported. Questions are generated only from your uploaded papers: send paperIds instead` });
    } else if (!REQUEST_FIELDS.includes(key)) {
      details.push({ field: key, message: 'Unknown field' });
    }
  });

  // ---- academic references
  const ids = {};
  ['subjectId', 'semesterId', 'regulationId'].forEach((field) => {
    if (!has(body, field)) details.push({ field, message: `${field} is required` });
    else if (!isValidObjectId(body[field])) details.push({ field, message: `${field} must be a valid MongoDB ObjectId` });
    else ids[field] = body[field].toLowerCase();
  });

  // ---- uploaded papers (the only content source): 1 to 3 distinct ObjectIds
  const paperIds = [];
  if (!has(body, 'paperIds') || body.paperIds === null) {
    details.push({ field: 'paperIds', message: `paperIds is required: select at least ${LIMITS.minPapers} uploaded paper` });
  } else if (!Array.isArray(body.paperIds)) {
    details.push({ field: 'paperIds', message: 'paperIds must be an array of paper ids' });
  } else if (body.paperIds.length < LIMITS.minPapers) {
    details.push({ field: 'paperIds', message: `Select at least ${LIMITS.minPapers} uploaded paper` });
  } else if (body.paperIds.length > LIMITS.maxPapers) {
    details.push({ field: 'paperIds', message: `You can select at most ${LIMITS.maxPapers} papers per request` });
  } else {
    const seen = new Set();
    body.paperIds.forEach((raw, index) => {
      if (!isValidObjectId(raw)) {
        details.push({ field: `paperIds[${index}]`, message: 'Each paper id must be a valid MongoDB ObjectId' });
        return;
      }
      const id = raw.toLowerCase();
      if (seen.has(id)) {
        details.push({ field: `paperIds[${index}]`, message: 'This paper is listed more than once' });
        return;
      }
      seen.add(id);
      paperIds.push(id);
    });
  }

  // ---- question types
  let questionTypes = [];
  if (!has(body, 'questionTypes')) {
    details.push({ field: 'questionTypes', message: 'questionTypes is required' });
  } else if (!Array.isArray(body.questionTypes) || body.questionTypes.length === 0) {
    details.push({ field: 'questionTypes', message: `questionTypes must be a non-empty array. Allowed values: ${QUESTION_TYPES.join(', ')}` });
  } else if (body.questionTypes.length > LIMITS.maxQuestionTypes) {
    details.push({ field: 'questionTypes', message: `questionTypes cannot contain more than ${LIMITS.maxQuestionTypes} items` });
  } else {
    const seen = new Set();
    body.questionTypes.forEach((raw, index) => {
      const value = normalizeType(raw);
      if (typeof value !== 'string' || !QUESTION_TYPES.includes(value)) {
        details.push({ field: `questionTypes[${index}]`, message: `Question type ${typeError}` });
      } else if (!seen.has(value)) {
        seen.add(value);
        questionTypes.push(value);
      }
    });
    if (details.some((d) => d.field.startsWith('questionTypes['))) questionTypes = [];
  }

  // ---- difficulty (optional; "balanced" mixes easy, medium and hard)
  let difficulty = DEFAULT_DIFFICULTY;
  if (has(body, 'difficulty') && body.difficulty !== null) {
    const raw = typeof body.difficulty === 'string' ? body.difficulty.trim().toLowerCase() : null;
    const value = raw !== null && DIFFICULTY_ALIASES[raw] ? DIFFICULTY_ALIASES[raw] : raw;
    if (value === null || !DIFFICULTY_MODES.includes(value)) {
      details.push({ field: 'difficulty', message: `difficulty must be one of: ${DIFFICULTIES.join(', ')} (one level for every question) or balanced (a mix of all three)` });
    } else {
      difficulty = value;
    }
  }

  // ---- marks distribution
  const marksDistribution = [];
  let totalQuestions = 0;
  if (!has(body, 'marksDistribution')) {
    details.push({ field: 'marksDistribution', message: 'marksDistribution is required' });
  } else if (!Array.isArray(body.marksDistribution) || body.marksDistribution.length === 0) {
    details.push({ field: 'marksDistribution', message: 'marksDistribution must be a non-empty array of { marks, count }' });
  } else if (body.marksDistribution.length > LIMITS.maxDistributionEntries) {
    details.push({ field: 'marksDistribution', message: `marksDistribution cannot contain more than ${LIMITS.maxDistributionEntries} entries` });
  } else {
    const typesByMarks = new Map(); // marks -> question types (null = "any allowed type") already used by an entry
    let entriesOk = true;
    body.marksDistribution.forEach((entry, index) => {
      const prefix = `marksDistribution[${index}]`;
      if (!isPlainObject(entry)) {
        details.push({ field: prefix, message: 'Each entry must be an object like { "marks": 5, "count": 3 }' });
        entriesOk = false;
        return;
      }
      unknownFields(entry, DISTRIBUTION_FIELDS, prefix, details);
      const marks = has(entry, 'marks') ? checkMarks(entry.marks) : { error: 'Marks is required' };
      const count = has(entry, 'count') ? checkInteger(entry.count, 'Count', 1, LIMITS.maxCountPerEntry) : { error: 'Count is required' };
      if (marks.error) details.push({ field: `${prefix}.marks`, message: marks.error });
      if (count.error) details.push({ field: `${prefix}.count`, message: count.error });
      let type = null;
      let typeOk = true;
      if (has(entry, 'questionType') && entry.questionType !== null) {
        const value = normalizeType(entry.questionType);
        if (typeof value !== 'string' || !QUESTION_TYPES.includes(value)) {
          details.push({ field: `${prefix}.questionType`, message: `Question type ${typeError}` });
          typeOk = false;
        } else if (questionTypes.length > 0 && !questionTypes.includes(value)) {
          details.push({ field: `${prefix}.questionType`, message: 'Question type must also be listed in questionTypes' });
          typeOk = false;
        } else if (!marks.error && FORMAT_MARKS[value] && !FORMAT_MARKS[value].includes(marks.value)) {
          details.push({ field: `${prefix}.questionType`, message: `${value} questions can only be requested for ${FORMAT_MARKS[value].join(' or ')} marks` });
          typeOk = false;
        } else {
          type = value;
        }
      }
      // A flexible entry (no questionType) needs at least one selected type that suits its marks.
      let allowedTypes = [];
      if (!marks.error && typeOk) {
        allowedTypes = type ? [type] : allowedTypesFor(marks.value, questionTypes);
        if (!type && questionTypes.length > 0 && allowedTypes.length === 0) {
          details.push({ field: `${prefix}.marks`, message: `None of the selected question types can be asked for ${marks.value} marks (${formatRules()})` });
          typeOk = false;
        }
      }
      if (marks.error || count.error || !typeOk) {
        entriesOk = false;
        return;
      }
      // The same marks may appear twice only when both entries name a different questionType.
      const used = typesByMarks.get(marks.value) || [];
      if (used.length > 0 && (type === null || used.includes(null) || used.includes(type))) {
        details.push({
          field: `${prefix}.marks`,
          message: `Marks ${marks.value} is listed more than once; combine the counts into one entry (or give each entry a different questionType)`,
        });
        entriesOk = false;
        return;
      }
      typesByMarks.set(marks.value, [...used, type]);
      marksDistribution.push({ marks: marks.value, count: count.value, questionType: type, allowedTypes });
    });
    if (entriesOk) {
      totalQuestions = marksDistribution.reduce((sum, entry) => sum + entry.count, 0);
      if (totalQuestions > LIMITS.maxTotalQuestions) {
        details.push({ field: 'marksDistribution', message: `At most ${LIMITS.maxTotalQuestions} questions can be generated per request (requested ${totalQuestions})` });
      }
    }
  }

  // ---- optional total, which must agree with the distribution
  if (has(body, 'questionCount') && body.questionCount !== null) {
    const count = checkInteger(body.questionCount, 'questionCount', 1, LIMITS.maxTotalQuestions);
    if (count.error) details.push({ field: 'questionCount', message: count.error });
    else if (totalQuestions > 0 && count.value !== totalQuestions) {
      details.push({ field: 'questionCount', message: `questionCount (${count.value}) must equal the total of marksDistribution (${totalQuestions})` });
    }
  }

  if (details.length > 0) throw ApiError.badRequest('Validation failed', details);

  return {
    subjectId: ids.subjectId,
    semesterId: ids.semesterId,
    regulationId: ids.regulationId,
    paperIds,
    questionTypes,
    difficulty,
    marksDistribution: marksDistribution.sort(
      (a, b) => a.marks - b.marks || (a.questionType ? QUESTION_TYPES.indexOf(a.questionType) : 99) - (b.questionType ? QUESTION_TYPES.indexOf(b.questionType) : 99)
    ),
    totalQuestions,
  };
};

// ---------------------------------------------------------------- stage 2: answers for selected questions

const ANSWER_REQUEST_FIELDS = Object.freeze(['questionIds']);

/**
 * Validates the body of POST /api/questions/important/:generationId/answers and returns { questionIds: [unique lower-case
 * ObjectIds, in request order] }. Whether the ids belong to the student's generated set is checked by the service.
 * Throws a 400 ApiError with errors: [{ field, message }].
 */
const validateAnswerRequest = (body) => {
  if (!isPlainObject(body)) throw ApiError.badRequest('Request body must be a JSON object');

  const details = [];
  unknownFields(body, ANSWER_REQUEST_FIELDS, '', details);

  const questionIds = [];
  if (!has(body, 'questionIds') || body.questionIds === null) {
    details.push({ field: 'questionIds', message: 'questionIds is required: select at least 1 generated question' });
  } else if (!Array.isArray(body.questionIds)) {
    details.push({ field: 'questionIds', message: 'questionIds must be an array of question ids' });
  } else if (body.questionIds.length < 1) {
    details.push({ field: 'questionIds', message: 'Select at least 1 generated question' });
  } else if (body.questionIds.length > LIMITS.maxTotalQuestions) {
    details.push({ field: 'questionIds', message: `You can select at most ${LIMITS.maxTotalQuestions} questions per request` });
  } else {
    const seen = new Set();
    body.questionIds.forEach((raw, index) => {
      if (!isValidObjectId(raw)) {
        details.push({ field: `questionIds[${index}]`, message: 'Each question id must be a valid MongoDB ObjectId' });
        return;
      }
      const id = raw.toLowerCase();
      if (seen.has(id)) {
        details.push({ field: `questionIds[${index}]`, message: 'This question is listed more than once' });
        return;
      }
      seen.add(id);
      questionIds.push(id);
    });
  }

  if (details.length > 0) throw ApiError.badRequest('Validation failed', details);
  return { questionIds };
};

module.exports = {
  validateImportantQuestionRequest,
  validateAnswerRequest,
  allowedTypesFor,
  QUESTION_TYPES,
  QUESTION_TYPE_DESCRIPTIONS,
  DIFFICULTIES,
  DIFFICULTY_MODES,
  DEFAULT_DIFFICULTY,
  GENERATION_MARKS,
  FORMAT_MARKS,
  LIMITS,
};

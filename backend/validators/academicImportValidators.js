'use strict';

const ApiError = require('../utils/ApiError');
const { isValidObjectId } = require('./commonValidators');
const { FIELD_SPECS, checkValue, choiceGroupDependencyErrors } = require('./academicValidators');
const { DEFAULT_CHOICE_RULE } = require('../utils/academicEnums');

// Input rules for POST /api/admin/academic-imports/subjects.
//
// Two layers:
//  1. validateImportRequest: the request ENVELOPE (departmentId, regulationId, dryRun, subjects[]). A problem
//     here rejects the whole request with 400 and nothing is looked up or written.
//  2. validateImportRecord: ONE subject record. A bad record never rejects the others: it is reported as
//     "invalid" in the per-record results so the admin can fix just those rows.
//
// Field rules (lengths, enum lists, semester number range) come from the same FIELD_SPECS the normal
// subject API uses, so an imported subject can never be something the normal API would refuse.

// Hard limits. A real syllabus is a few dozen subjects, so these are generous but still bounded.
const MAX_SUBJECTS_PER_IMPORT = 200;
const MAX_IMPORT_BODY_BYTES = 128 * 1024; // 128 KB; the global JSON parser (1 MB) is the outer limit.
const MAX_REPORTED_UNKNOWN_FIELDS = 10; // keeps the error response small even for a hostile record

const REQUEST_FIELDS = Object.freeze(['departmentId', 'regulationId', 'dryRun', 'subjects']);

// The only fields a subject record may contain (the choice-group fields are optional). Semester IDs are deliberately NOT accepted: the semester
// is always resolved on the server from regulationId + semesterNumber.
const RECORD_SPECS = Object.freeze({
  semesterNumber: FIELD_SPECS.semester.semesterNumber,
  name: FIELD_SPECS.subject.name,
  subjectCode: FIELD_SPECS.subject.subjectCode,
  subjectType: FIELD_SPECS.subject.subjectType,
  category: FIELD_SPECS.subject.category,
  choiceGroup: FIELD_SPECS.subject.choiceGroup,
  choiceGroupLabel: FIELD_SPECS.subject.choiceGroupLabel,
  choiceRule: FIELD_SPECS.subject.choiceRule,
});

const SEMESTER_REFERENCE_FIELDS = new Set(['semester', 'semesterId', 'semesterNumberId']);

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key) && object[key] !== undefined;
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Route middleware: refuses an oversized request before any work is done (413).
 * Requests without a Content-Length header (chunked) are still bounded by the global 1 MB JSON parser.
 */
const limitImportBodySize = (req, res, next) => {
  const length = Number(req.headers['content-length']);
  if (Number.isFinite(length) && length > MAX_IMPORT_BODY_BYTES) {
    return next(new ApiError(413, `Import request is too large (maximum ${MAX_IMPORT_BODY_BYTES / 1024} KB)`));
  }
  return next();
};

/**
 * Validates the request envelope. Returns { departmentId, regulationId, dryRun, subjects } where
 * `subjects` is still the raw array (each record is validated separately).
 * dryRun defaults to true and must be a real boolean when given ("false" as text is rejected, so a
 * write can only ever happen when the client sends the JSON value false).
 * Throws a 400 ApiError with errors: [{ field, message }].
 */
const validateImportRequest = (body) => {
  if (!isPlainObject(body)) throw ApiError.badRequest('Request body must be a JSON object');

  const details = [];

  Object.keys(body).forEach((key) => {
    if (!REQUEST_FIELDS.includes(key)) details.push({ field: key, message: 'Unknown field' });
  });

  const ids = {};
  ['departmentId', 'regulationId'].forEach((field) => {
    if (!has(body, field)) {
      details.push({ field, message: `${field} is required` });
    } else if (!isValidObjectId(body[field])) {
      details.push({ field, message: `${field} must be a valid MongoDB ObjectId` });
    } else {
      ids[field] = body[field].toLowerCase();
    }
  });

  let dryRun = true;
  if (has(body, 'dryRun')) {
    if (typeof body.dryRun !== 'boolean') {
      details.push({ field: 'dryRun', message: 'dryRun must be the boolean true or false' });
    } else {
      dryRun = body.dryRun;
    }
  }

  if (!has(body, 'subjects')) {
    details.push({ field: 'subjects', message: 'subjects is required' });
  } else if (!Array.isArray(body.subjects)) {
    details.push({ field: 'subjects', message: 'subjects must be an array of subject records' });
  } else if (body.subjects.length === 0) {
    details.push({ field: 'subjects', message: 'subjects must contain at least one record' });
  } else if (body.subjects.length > MAX_SUBJECTS_PER_IMPORT) {
    details.push({
      field: 'subjects',
      message: `subjects cannot contain more than ${MAX_SUBJECTS_PER_IMPORT} records per request (received ${body.subjects.length}). Split the import into smaller batches.`,
    });
  }

  if (details.length > 0) throw ApiError.badRequest('Validation failed', details);
  return { departmentId: ids.departmentId, regulationId: ids.regulationId, dryRun, subjects: body.subjects };
};

/**
 * Validates ONE subject record.
 * Returns { value } with the cleaned record:
 *   { semesterNumber, name, subjectCode (upper-case string or null), subjectType, category,
 *     choiceGroup, choiceGroupLabel, choiceRule (all null when the subject has no choice group) }
 * or { errors: [{ field, message }] }. Never throws.
 */
const validateImportRecord = (raw) => {
  if (!isPlainObject(raw)) {
    return { errors: [{ field: 'record', message: 'Each subject must be a JSON object' }] };
  }

  const errors = [];

  // Anything outside the five allowed fields is refused, never ignored.
  const unknown = Object.keys(raw).filter((key) => !Object.prototype.hasOwnProperty.call(RECORD_SPECS, key));
  unknown.slice(0, MAX_REPORTED_UNKNOWN_FIELDS).forEach((key) => {
    errors.push({
      field: key,
      message: SEMESTER_REFERENCE_FIELDS.has(key)
        ? 'Semester IDs are not accepted. Use "semesterNumber"; the semester is resolved from regulationId.'
        : 'Unknown field',
    });
  });
  if (unknown.length > MAX_REPORTED_UNKNOWN_FIELDS) {
    errors.push({ field: 'record', message: `${unknown.length - MAX_REPORTED_UNKNOWN_FIELDS} more unknown fields not listed` });
  }

  const value = {};
  Object.entries(RECORD_SPECS).forEach(([field, spec]) => {
    if (!has(raw, field)) {
      if (spec.required) errors.push({ field, message: `${spec.label} is required` });
      return;
    }
    const result = checkValue(spec, raw[field]);
    if (result.error) errors.push({ field, message: result.error });
    else value[field] = result.value;
  });

  // Same normalisation the Subject model applies on save (trim + upper-case), done here so duplicate
  // detection compares exactly what would be stored. A blank/null code means "no code".
  if (has(value, 'subjectCode') && value.subjectCode !== null) {
    value.subjectCode = value.subjectCode.toUpperCase();
    if (value.subjectCode.length > FIELD_SPECS.subject.subjectCode.max) {
      errors.push({ field: 'subjectCode', message: `${FIELD_SPECS.subject.subjectCode.label} cannot exceed ${FIELD_SPECS.subject.subjectCode.max} characters` });
    }
  }
  if (!has(value, 'subjectCode')) value.subjectCode = null;

  // Choice group (optional): absent / blank values mean "not set". A label or rule needs a group, and a
  // group without a rule defaults to choose_one, exactly like the admin subject API.
  ['choiceGroup', 'choiceGroupLabel', 'choiceRule'].forEach((field) => {
    if (!has(value, field)) value[field] = null;
  });
  if (errors.length === 0) errors.push(...choiceGroupDependencyErrors(value));
  if (value.choiceGroup && !value.choiceRule) value.choiceRule = DEFAULT_CHOICE_RULE;

  if (errors.length > 0) return { errors };
  return { value };
};

module.exports = {
  MAX_SUBJECTS_PER_IMPORT,
  MAX_IMPORT_BODY_BYTES,
  limitImportBodySize,
  validateImportRequest,
  validateImportRecord,
};

'use strict';

const ApiError = require('../utils/ApiError');
const { isValidObjectId } = require('./commonValidators');
const {
  DEPARTMENT_LEVELS,
  SUBJECT_TYPES,
  SUBJECT_CATEGORIES,
  CHOICE_RULES,
  CHOICE_GROUP_PATTERN,
  CHOICE_GROUP_MAX,
  CHOICE_GROUP_LABEL_MAX,
} = require('../utils/academicEnums');

// Input rules for the academic APIs (University, Department, Regulation, Semester, Subject).
// Every value is type-checked here, so a JSON object such as {"$ne": null} can never reach a query.
// Only the fields listed for a resource are accepted; anything else is rejected, never silently stored.

const FIELD_SPECS = {
  university: {
    name: { type: 'string', required: true, max: 150, label: 'Name' },
    code: { type: 'string', max: 20, nullable: true, label: 'Code' },
    description: { type: 'string', max: 1000, nullable: true, label: 'Description' },
    isActive: { type: 'boolean', label: 'isActive' },
  },
  department: {
    name: { type: 'string', required: true, max: 150, label: 'Name' },
    code: { type: 'string', required: true, max: 20, label: 'Code' },
    university: { type: 'objectId', required: true, label: 'University' },
    level: { type: 'enum', required: true, values: DEPARTMENT_LEVELS, normalize: 'upper', label: 'Level' },
    isActive: { type: 'boolean', label: 'isActive' },
  },
  regulation: {
    name: { type: 'string', required: true, max: 100, label: 'Name' },
    department: { type: 'objectId', required: true, label: 'Department' },
    isActive: { type: 'boolean', label: 'isActive' },
  },
  semester: {
    semesterNumber: { type: 'semesterNumber', required: true, label: 'Semester number' },
    regulation: { type: 'objectId', required: true, label: 'Regulation' },
    isActive: { type: 'boolean', label: 'isActive' },
  },
  subject: {
    name: { type: 'string', required: true, max: 150, label: 'Name' },
    // Optional: a subject without an official code simply has none (null/blank clears it).
    subjectCode: { type: 'string', max: 20, nullable: true, label: 'Subject code' },
    subjectType: { type: 'enum', required: true, values: SUBJECT_TYPES, normalize: 'lower', label: 'Subject type' },
    category: { type: 'enum', required: true, values: SUBJECT_CATEGORIES, normalize: 'lower', label: 'Category' },
    semester: { type: 'objectId', required: true, label: 'Semester' },
    // Optional choice group (electives / conditional subjects). null or blank clears the field.
    choiceGroup: {
      type: 'string',
      max: CHOICE_GROUP_MAX,
      nullable: true,
      lower: true,
      pattern: CHOICE_GROUP_PATTERN,
      patternMessage: 'Choice group may only contain letters, digits, \"-\" and \"_\" (no spaces)',
      label: 'Choice group',
    },
    choiceGroupLabel: { type: 'string', max: CHOICE_GROUP_LABEL_MAX, nullable: true, collapseSpaces: true, label: 'Choice group label' },
    choiceRule: { type: 'enum', nullable: true, values: CHOICE_RULES, normalize: 'lower', label: 'Choice rule' },
    isActive: { type: 'boolean', label: 'isActive' },
  },
};

// Query-string filters allowed on each admin list endpoint (besides isActive). `department` on the
// semester list is the pre-Phase-1C filter, kept so old clients keep working: it matches the semesters
// of every regulation of that department.
const FILTER_SPECS = {
  university: {},
  department: { university: FIELD_SPECS.department.university, level: FIELD_SPECS.department.level },
  regulation: { department: FIELD_SPECS.regulation.department },
  semester: {
    regulation: FIELD_SPECS.semester.regulation,
    department: { type: 'objectId', label: 'Department' },
    semesterNumber: FIELD_SPECS.semester.semesterNumber,
  },
  subject: {
    semester: FIELD_SPECS.subject.semester,
    subjectType: FIELD_SPECS.subject.subjectType,
    category: FIELD_SPECS.subject.category,
  },
};

// Filters accepted by the read-only student APIs (the parent comes from the URL).
const PUBLIC_FILTER_SPECS = {
  department: { level: FIELD_SPECS.department.level },
  semester: { regulation: FIELD_SPECS.semester.regulation },
  subject: { subjectType: FIELD_SPECS.subject.subjectType, category: FIELD_SPECS.subject.category },
};

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Checks one value against its spec. Returns { value } (cleaned) or { error }.
const checkValue = (spec, raw) => {
  switch (spec.type) {
    case 'string': {
      if (raw === null || raw === '') {
        if (spec.nullable) return { value: null };
        return { error: `${spec.label} is required` };
      }
      if (typeof raw !== 'string') return { error: `${spec.label} must be text` };
      const value = raw.trim();
      if (value === '') return spec.nullable ? { value: null } : { error: `${spec.label} is required` };
      const cleaned = spec.lower ? value.toLowerCase() : value;
      const final = spec.collapseSpaces ? cleaned.replace(/\s+/g, ' ') : cleaned;
      if (final.length > spec.max) return { error: `${spec.label} cannot exceed ${spec.max} characters` };
      if (spec.pattern && !spec.pattern.test(final)) return { error: spec.patternMessage };
      return { value: final };
    }
    case 'objectId':
      if (!isValidObjectId(raw)) return { error: `${spec.label} must be a valid MongoDB ObjectId` };
      return { value: raw };
    case 'semesterNumber': {
      const number = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
      if (typeof number !== 'number' || !Number.isInteger(number) || number < 1 || number > 8) {
        return { error: 'Semester number must be a whole number between 1 and 8' };
      }
      return { value: number };
    }
    case 'enum': {
      const expected = `${spec.label} must be one of: ${spec.values.join(', ')}`;
      if (raw === null && spec.nullable) return { value: null };
      if (typeof raw !== 'string') return { error: expected };
      const trimmed = raw.trim();
      if (trimmed === '' && spec.nullable) return { value: null };
      const value = spec.normalize === 'upper' ? trimmed.toUpperCase() : trimmed.toLowerCase();
      if (!spec.values.includes(value)) return { error: expected };
      return { value };
    }
    case 'boolean':
      if (typeof raw !== 'boolean') return { error: `${spec.label} must be true or false` };
      return { value: raw };
    default:
      return { error: 'Invalid value' };
  }
};

// A label or rule without a choice group is invalid. `values` holds the (cleaned) choiceGroup,
// choiceGroupLabel and choiceRule of one subject; null / undefined mean "not set".
const choiceGroupDependencyErrors = (values) => {
  if (values.choiceGroup) return [];
  const errors = [];
  if (values.choiceGroupLabel) errors.push({ field: 'choiceGroupLabel', message: 'Choice group label requires a choice group' });
  if (values.choiceRule) errors.push({ field: 'choiceRule', message: 'Choice rule requires a choice group' });
  return errors;
};

/**
 * Validates a request body for a resource and returns only the cleaned, allowed fields.
 * create: every `required` field must be present. update (partial): at least one field must be sent.
 * Throws a 400 ApiError with `errors: [{ field, message }]`.
 */
const validateBody = (resource, body, { partial = false } = {}) => {
  const specs = FIELD_SPECS[resource];
  if (!isPlainObject(body)) throw ApiError.badRequest('Request body must be a JSON object');

  const details = [];
  const cleaned = {};

  Object.keys(body).forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(specs, key)) {
      details.push({ field: key, message: 'Unknown field' });
    }
  });

  Object.entries(specs).forEach(([field, spec]) => {
    const present = Object.prototype.hasOwnProperty.call(body, field) && body[field] !== undefined;
    if (!present) {
      if (spec.required && !partial) details.push({ field, message: `${spec.label} is required` });
      return;
    }
    const result = checkValue(spec, body[field]);
    if (result.error) details.push({ field, message: result.error });
    else cleaned[field] = result.value;
  });

  // Choice-group fields only make sense together with a group. On create this is checked right here; on a
  // partial update it depends on the stored subject, so the service checks it after merging.
  if (resource === 'subject' && !partial && details.length === 0) {
    const groupError = choiceGroupDependencyErrors(cleaned);
    details.push(...groupError);
  }

  if (details.length === 0 && partial && Object.keys(cleaned).length === 0) {
    details.push({ field: 'body', message: 'Send at least one field to update' });
  }
  if (details.length > 0) throw ApiError.badRequest('Validation failed', details);
  return cleaned;
};

// Validates the query-string values named in `specs` and returns the cleaned filter (and any errors).
const parseFilters = (specs, query, details) => {
  const filter = {};
  const q = query || {};
  Object.entries(specs).forEach(([name, spec]) => {
    if (q[name] === undefined) return;
    // A repeated query parameter arrives as an array and is never accepted.
    const result = checkValue(spec, typeof q[name] === 'string' ? q[name] : null);
    if (spec.type === 'objectId' && typeof q[name] !== 'string') {
      details.push({ field: name, message: `"${name}" must be a valid MongoDB ObjectId` });
    } else if (result.error) {
      details.push({ field: name, message: spec.type === 'objectId' ? `"${name}" must be a valid MongoDB ObjectId` : result.error });
    } else {
      filter[name] = result.value;
    }
  });
  return filter;
};

/**
 * Validates the admin list filters (?university=, ?level=, ?department=, ?regulation=, ?semester=,
 * ?semesterNumber=, ?subjectType=, ?category=, ?isActive=) and returns a ready-to-use database filter.
 * Throws a 400 ApiError for an invalid value.
 */
const buildListFilter = (resource, query) => {
  const details = [];
  const filter = parseFilters(FILTER_SPECS[resource], query, details);
  const q = query || {};

  if (q.isActive !== undefined) {
    if (q.isActive === 'true') filter.isActive = true;
    else if (q.isActive === 'false') filter.isActive = false;
    else details.push({ field: 'isActive', message: '"isActive" must be true or false' });
  }

  if (details.length > 0) throw ApiError.badRequest('Validation failed', details);
  return filter;
};

/**
 * Validates the filters of the read-only student APIs (department ?level=, semester ?regulation=,
 * subject ?subjectType= and ?category=). Unknown query parameters are ignored.
 */
const buildPublicFilter = (resource, query) => {
  const details = [];
  const filter = parseFilters(PUBLIC_FILTER_SPECS[resource] || {}, query, details);
  if (details.length > 0) throw ApiError.badRequest('Validation failed', details);
  return filter;
};

// FIELD_SPECS and checkValue are also used by validators/academicImportValidators.js, so bulk-imported
// subjects obey exactly the same field rules (and enum lists) as subjects created one by one.
module.exports = { validateBody, buildListFilter, buildPublicFilter, FIELD_SPECS, checkValue, choiceGroupDependencyErrors };

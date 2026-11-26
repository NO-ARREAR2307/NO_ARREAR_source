'use strict';

const ApiError = require('../utils/ApiError');
const { isAdmin } = require('../utils/paperAccess');
const { isValidObjectId } = require('./commonValidators');
const {
  MATERIAL_TYPES,
  DEFAULT_MATERIAL_TYPE,
  TITLE_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  SEARCH_MAX_LENGTH,
  EXTRACTION_STATUSES,
} = require('../utils/paperMetadata');

// Phase 4.1 validation of study material metadata (upload form fields, PATCH body) and of the list query string.
//
// Rules that apply everywhere:
//  * WHITELIST: only title, description and materialType are ever read. Any other key (uploadedBy, storedName, size,
//    mimeType, extractionStatus, role, __proto__ ...) is refused with a 400, never silently copied, so a client cannot
//    change ownership, storage or extraction fields through this API.
//  * TYPE CHECK: every value must be a string. An object such as { "$gt": "" } is refused, which closes the door on
//    NoSQL operator injection before a value gets anywhere near a query.
//  * CLEAN-UP: control characters, zero-width characters and bidirectional-override characters are removed.
//    (Output encoding for HTML is the job of the client that renders the text; the API only stores plain text.)

const ALLOWED_FIELDS = Object.freeze(['title', 'description', 'materialType']);

// Characters removed from every text field: C0/C1 control codes (except tab and line feed, see cleanDescription),
// line/paragraph separators, zero-width characters and bidirectional overrides.
// eslint-disable-next-line no-control-regex
const INVISIBLE_OR_UNSAFE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200d\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g;

const isPlainObject = (value) => Object.prototype.toString.call(value) === '[object Object]';

// One line: all whitespace (including tabs and line feeds) becomes a single space.
const cleanTitle = (value) => value.replace(/[\t\n\r]+/g, ' ').replace(INVISIBLE_OR_UNSAFE, '').replace(/\s+/g, ' ').trim();

// Several lines are allowed: line breaks are normalised to \n and tabs are kept.
const cleanDescription = (value) =>
  value
    .replace(/\r\n?/g, '\n')
    .replace(INVISIBLE_OR_UNSAFE, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const fieldError = (field, message) => ({ field, message });

const safeKey = (key) => String(key).replace(INVISIBLE_OR_UNSAFE, '').slice(0, 50);

/**
 * Validates the metadata of a study material.
 *  - upload (forUpdate false): every field is optional; an absent body is fine (the title then defaults to the file name).
 *  - update (forUpdate true): the body must be a JSON object with at least one allowed field.
 * Returns only the fields that were sent, already cleaned:
 *   { title?: string (1-150), description?: string (0-1000, '' means "clear it"), materialType?: one of MATERIAL_TYPES }
 * Throws ApiError 400 with { field, message } details.
 */
const parseMetadata = (body, { forUpdate = false } = {}) => {
  if (body === undefined || body === null) {
    if (forUpdate) throw ApiError.badRequest('Request body must be a JSON object');
    return {};
  }
  if (!isPlainObject(body)) throw ApiError.badRequest('Request body must be a JSON object');

  const errors = [];
  const keys = Object.keys(body);

  keys.forEach((key) => {
    if (!ALLOWED_FIELDS.includes(key)) errors.push(fieldError(safeKey(key), 'This field is unknown or cannot be changed'));
  });

  const result = {};

  if (Object.prototype.hasOwnProperty.call(body, 'title')) {
    if (typeof body.title !== 'string') {
      errors.push(fieldError('title', 'Title must be a string'));
    } else {
      const title = cleanTitle(body.title);
      if (title.length === 0) errors.push(fieldError('title', 'Title cannot be empty'));
      else if (title.length > TITLE_MAX_LENGTH) errors.push(fieldError('title', `Title cannot exceed ${TITLE_MAX_LENGTH} characters`));
      else result.title = title;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'description')) {
    if (typeof body.description !== 'string') {
      errors.push(fieldError('description', 'Description must be a string'));
    } else {
      const description = cleanDescription(body.description);
      if (description.length > DESCRIPTION_MAX_LENGTH) {
        errors.push(fieldError('description', `Description cannot exceed ${DESCRIPTION_MAX_LENGTH} characters`));
      } else {
        result.description = description;
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'materialType')) {
    if (typeof body.materialType !== 'string' || !MATERIAL_TYPES.includes(body.materialType)) {
      errors.push(fieldError('materialType', `Material type must be one of: ${MATERIAL_TYPES.join(', ')}`));
    } else {
      result.materialType = body.materialType;
    }
  }

  if (errors.length > 0) throw ApiError.badRequest('Validation failed', errors);
  if (forUpdate && keys.length === 0) throw ApiError.badRequest('Provide at least one field to update: ' + ALLOWED_FIELDS.join(', '));
  return result;
};

// Default title for an upload that did not send one: the file name without its extension.
const defaultTitleFromFileName = (originalName) => {
  const withoutExtension = String(originalName || '').replace(/\.[^./\\]{1,10}$/, '');
  const title = cleanTitle(withoutExtension).slice(0, TITLE_MAX_LENGTH).trim();
  return title || 'Untitled material';
};

const singleString = (value) => (typeof value === 'string' ? value.trim() : undefined);

/**
 * Route middleware for GET /api/papers. Validates the filter and sort parameters and exposes them as req.listQuery:
 *   { materialType?, extractionStatus?, search?, uploadedBy?, sort }
 * Runs after protect, because only an admin may filter by uploader (for a student the parameter is ignored: a student's
 * list is always limited to their own materials, whatever the query string says).
 */
const validateListQuery = (req, res, next) => {
  const q = req.query || {};
  const errors = [];
  const listQuery = { sort: 'newest' };

  const read = (field) => {
    if (q[field] === undefined || q[field] === '') return undefined;
    const value = singleString(q[field]);
    if (value === undefined) {
      errors.push(fieldError(field, `"${field}" must be a single text value`));
      return undefined;
    }
    return value;
  };

  const materialType = read('materialType');
  if (materialType !== undefined) {
    if (MATERIAL_TYPES.includes(materialType)) listQuery.materialType = materialType;
    else errors.push(fieldError('materialType', `Material type must be one of: ${MATERIAL_TYPES.join(', ')}`));
  }

  const extractionStatus = read('extractionStatus');
  if (extractionStatus !== undefined) {
    if (EXTRACTION_STATUSES.includes(extractionStatus)) listQuery.extractionStatus = extractionStatus;
    else errors.push(fieldError('extractionStatus', `Extraction status must be one of: ${EXTRACTION_STATUSES.join(', ')}`));
  }

  const search = read('search');
  if (search !== undefined) {
    const cleaned = cleanTitle(search);
    if (cleaned.length > SEARCH_MAX_LENGTH) errors.push(fieldError('search', `Search text cannot exceed ${SEARCH_MAX_LENGTH} characters`));
    else if (cleaned.length > 0) listQuery.search = cleaned;
  }

  const sort = read('sort');
  if (sort !== undefined) {
    if (['newest', 'oldest', 'title'].includes(sort)) listQuery.sort = sort;
    else errors.push(fieldError('sort', 'Sort must be one of: newest, oldest, title'));
  }

  const uploadedBy = read('uploadedBy');
  if (uploadedBy !== undefined && isAdmin(req.user)) {
    if (isValidObjectId(uploadedBy)) listQuery.uploadedBy = uploadedBy.toLowerCase();
    else errors.push(fieldError('uploadedBy', '"uploadedBy" must be a valid MongoDB ObjectId'));
  }

  if (errors.length > 0) return next(ApiError.badRequest('Validation failed', errors));
  req.listQuery = listQuery;
  return next();
};

module.exports = {
  ALLOWED_FIELDS,
  DEFAULT_MATERIAL_TYPE,
  parseMetadata,
  defaultTitleFromFileName,
  validateListQuery,
};

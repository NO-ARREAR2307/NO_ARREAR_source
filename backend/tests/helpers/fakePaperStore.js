'use strict';

// In-memory stand-in for the Paper model used by the Phase 4.1 study material tests, so they need no MongoDB.
// (tests/helpers/fakePaperDb.js only replaces Paper.find for the generator tests; CRUD needs more.)
//
// Replaced: Paper.create / find / findOne / countDocuments / findOneAndUpdate / findOneAndDelete / updateOne.
//
// Strict on purpose, like the other fakes: it understands only the filter keys and operators the code under test is
// expected to use. Anything else throws, so a query that forgot the access rule, or a typo in a field name, fails
// the test loudly instead of being answered with "everything".
//  - select:false fields (extractedText, extractionWarnings, shareTokenHash) come back only when the query asks for them with "+field";
//  - .lean() returns plain objects (they still contain storedName, like a real lean query); otherwise a hydrated Mongoose
//    document is returned, so toObject()/toJSON() and the schema defaults behave like the real thing;
//  - Paper.create() runs the real schema validation (new Paper(data).validate()).

const mongoose = require('mongoose');
const Paper = require('../../models/Paper');

const SELECT_FALSE_FIELDS = ['extractedText', 'extractionWarnings', 'shareTokenHash'];
const ALLOWED_FILTER_KEYS = ['_id', 'uploadedBy', 'materialType', 'extractionStatus', 'extractionStartedAt', 'title', 'originalName', 'shareTokenHash', 'isShared', '$or', '$and'];

const store = new Map();
const filters = [];

const isOperatorObject = (cond) =>
  cond !== null && typeof cond === 'object' && !(cond instanceof RegExp) && !(cond instanceof Date) && !(cond instanceof mongoose.Types.ObjectId);

const matchValue = (actual, cond) => {
  if (cond instanceof RegExp) return typeof actual === 'string' && cond.test(actual);
  if (isOperatorObject(cond)) {
    return Object.entries(cond).every(([op, expected]) => {
      switch (op) {
        case '$in': return expected.some((item) => (item === null ? actual === null || actual === undefined : String(item) === String(actual)));
        case '$ne': return String(actual) !== String(expected);
        case '$lte': return actual !== null && actual !== undefined && actual <= expected;
        default: throw new Error(`fakePaperStore: unsupported operator "${op}"`);
      }
    });
  }
  if (cond === null) return actual === null || actual === undefined;
  return String(actual) === String(cond);
};

const matches = (raw, filter) =>
  Object.entries(filter).every(([key, cond]) => {
    if (!ALLOWED_FILTER_KEYS.includes(key)) throw new Error(`fakePaperStore: unsupported filter key "${key}"`);
    if (key === '$or') return cond.some((sub) => matches(raw, sub));
    if (key === '$and') return cond.every((sub) => matches(raw, sub));
    return matchValue(raw[key], cond);
  });

const project = (raw, selectText) => {
  const wanted = new Set(String(selectText || '').split(/\s+/).filter((token) => token.startsWith('+')).map((token) => token.slice(1)));
  const copy = { ...raw };
  SELECT_FALSE_FIELDS.forEach((field) => {
    if (!wanted.has(field)) delete copy[field];
  });
  return copy;
};

const comparable = (value) => {
  if (value === undefined || value === null) return '';
  if (value instanceof Date) return value.getTime();
  return String(value).toLowerCase();
};

const sortRows = (rows, spec) => {
  const keys = Object.entries(spec);
  return [...rows].sort((a, b) => {
    for (const [field, direction] of keys) {
      const left = comparable(a[field]);
      const right = comparable(b[field]);
      if (left < right) return -direction;
      if (left > right) return direction;
    }
    return 0;
  });
};

// A chainable, awaitable stand-in for a Mongoose query.
const makeQuery = (run) => {
  const state = { select: '', sort: null, skip: 0, limit: null, lean: false };
  const query = {
    select(value) { state.select = value; return query; },
    sort(value) { state.sort = value; return query; },
    skip(value) { state.skip = value; return query; },
    limit(value) { state.limit = value; return query; },
    lean() { state.lean = true; return query; },
    then(resolve, reject) {
      let result;
      try {
        result = Promise.resolve(run(state));
      } catch (err) {
        result = Promise.reject(err);
      }
      return result.then(resolve, reject);
    },
  };
  return query;
};

const output = (raw, state) => {
  if (!raw) return null;
  const shaped = project(raw, state.select);
  return state.lean ? shaped : Paper.hydrate(shaped);
};

const applyUpdate = (raw, update) => {
  Object.keys(update).forEach((op) => {
    if (!['$set', '$unset'].includes(op)) throw new Error(`fakePaperStore: unsupported update operator "${op}"`);
  });
  if (update.$set && Object.keys(update.$set).length === 0 && !update.$unset) throw new Error('fakePaperStore: empty $set');
  if (update.$unset && Object.keys(update.$unset).length === 0) throw new Error("fakePaperStore: empty $unset (MongoDB rejects it)");
  Object.assign(raw, update.$set || {});
  Object.keys(update.$unset || {}).forEach((field) => delete raw[field]);
};

const findFirst = (filter) => {
  filters.push(filter);
  return [...store.values()].find((raw) => matches(raw, filter)) || null;
};

const install = () => {
  Paper.create = async (data) => {
    const doc = new Paper(data);
    await doc.validate();
    doc.uploadedAt = new Date(); // set by Mongoose "timestamps" on save, which this stand-in does not run
    store.set(String(doc._id), doc.toObject({ transform: false }));
    return doc;
  };

  Paper.find = (filter = {}) =>
    makeQuery((state) => {
      filters.push(filter);
      let rows = [...store.values()].filter((raw) => matches(raw, filter));
      if (state.sort) rows = sortRows(rows, state.sort);
      rows = rows.slice(state.skip, state.limit === null ? undefined : state.skip + state.limit);
      return rows.map((raw) => output(raw, state));
    });

  Paper.findOne = (filter = {}) => makeQuery((state) => output(findFirst(filter), state));

  Paper.countDocuments = async (filter = {}) => {
    filters.push(filter);
    return [...store.values()].filter((raw) => matches(raw, filter)).length;
  };

  Paper.findOneAndUpdate = (filter, update, options = {}) =>
    makeQuery((state) => {
      const raw = findFirst(filter);
      if (!raw) return null;
      const before = { ...raw };
      applyUpdate(raw, update);
      return output(options.returnDocument === 'before' ? before : raw, state);
    });

  Paper.findOneAndDelete = (filter) =>
    makeQuery((state) => {
      const raw = findFirst(filter);
      if (!raw) return null;
      store.delete(String(raw._id));
      return output(raw, state);
    });

  Paper.updateOne = async (filter, update) => {
    const raw = findFirst(filter);
    if (!raw) return { matchedCount: 0, modifiedCount: 0 };
    applyUpdate(raw, update);
    return { matchedCount: 1, modifiedCount: 1 };
  };
};

/**
 * Adds a paper straight into the store (no file is written; see the test file for seeding a stored file).
 * Defaults: a completed-less, pending PDF with a title. Pass `legacy: true` for a paper saved before Phase 4.1
 * (no title, description or materialType). Returns the id as a lower-case hex string.
 */
const add = ({ owner, legacy = false, ...rest } = {}) => {
  const _id = new mongoose.Types.ObjectId();
  const raw = {
    _id,
    uploadedBy: owner,
    originalName: 'paper.pdf',
    storedName: `${_id}.pdf`,
    size: 1024,
    mimeType: 'application/pdf',
    fileType: 'pdf',
    extractionStatus: 'pending',
    uploadedAt: new Date(),
    ...(legacy ? {} : { title: 'Sample material', materialType: 'question_paper' }),
    ...rest,
  };
  store.set(String(_id), raw);
  return String(_id);
};

const get = (id) => (store.has(String(id)) ? { ...store.get(String(id)) } : null);
const all = () => [...store.values()].map((raw) => ({ ...raw }));
const reset = () => {
  store.clear();
  filters.length = 0;
};

module.exports = { install, add, get, all, reset, filters: () => [...filters] };

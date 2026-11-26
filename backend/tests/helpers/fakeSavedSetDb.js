'use strict';

// In-memory stand-in for the SavedQuestionSet model (Phase 2B), so the API tests need no MongoDB.
// The REAL schema is kept: validation, trimming, defaults and the pre-validate hook run on save.
// Replaced operations: save, find (+ sort/skip/limit/select/lean), findOne (+ lean), findOneAndDelete, countDocuments.
// Filters support plain equality on top-level fields (compared as strings).

const { SavedQuestionSet } = require('../../models');

const store = new Map();

// Equality (compared as strings) plus the operators the history queries use: $in, $ne and $regex (+ $options).
const matchesValue = (actual, value) => {
  if (value && typeof value === 'object' && !(value instanceof Date) && Object.keys(value).some((k) => k.startsWith('$'))) {
    return Object.entries(value).every(([operator, operand]) => {
      if (operator === '$in') return operand.map(String).includes(String(actual));
      if (operator === '$ne') return String(actual) !== String(operand);
      if (operator === '$regex') return new RegExp(operand, value.$options || '').test(String(actual));
      if (operator === '$options') return true;
      throw new Error(`fakeSavedSetDb: unsupported operator ${operator}`);
    });
  }
  return String(actual) === String(value);
};
const matches = (raw, filter) => Object.entries(filter).every(([key, value]) => matchesValue(raw[key], value));

const sortValue = (value) => (value instanceof Date ? value.getTime() : String(value));
const compare = (sort) => (a, b) => {
  for (const [key, direction] of Object.entries(sort)) {
    const left = sortValue(a[key]);
    const right = sortValue(b[key]);
    if (left < right) return -1 * direction;
    if (left > right) return 1 * direction;
  }
  return 0;
};

// A plain object with real ObjectIds / Dates, like .lean() returns (structuredClone would break ObjectIds).
const clone = (raw) => SavedQuestionSet.hydrate(raw).toObject();

function install() {
  SavedQuestionSet.prototype.save = async function save() {
    await this.validate();
    const now = new Date();
    if (!this.createdAt) this.createdAt = now;
    this.updatedAt = now;
    store.set(String(this._id), this.toObject());
    this.isNew = false;
    return this;
  };

  SavedQuestionSet.find = (filter = {}) => {
    const query = { sort: {}, skip: 0, limit: Infinity, exclude: [] };
    const chain = {
      sort(value) { query.sort = value; return chain; },
      skip(value) { query.skip = value; return chain; },
      limit(value) { query.limit = value; return chain; },
      select(value) { query.exclude = String(value).split(/\s+/).filter((f) => f.startsWith('-')).map((f) => f.slice(1)); return chain; },
      lean() { return chain; },
      then(resolve, reject) {
        const rows = [...store.values()].filter((raw) => matches(raw, filter)).sort(compare(query.sort));
        const page = rows.slice(query.skip, query.skip + query.limit).map((raw) => {
          const copy = clone(raw);
          query.exclude.forEach((field) => delete copy[field]);
          return copy;
        });
        return Promise.resolve(page).then(resolve, reject);
      },
    };
    return chain;
  };

  SavedQuestionSet.findOne = (filter = {}) => {
    const chain = {
      lean() { return chain; },
      then(resolve, reject) {
        const raw = [...store.values()].find((candidate) => matches(candidate, filter));
        return Promise.resolve(raw ? clone(raw) : null).then(resolve, reject);
      },
    };
    return chain;
  };

  SavedQuestionSet.findOneAndDelete = async (filter = {}) => {
    const raw = [...store.values()].find((candidate) => matches(candidate, filter));
    if (!raw) return null;
    store.delete(String(raw._id));
    return clone(raw);
  };

  // Supports { $set: {...} } updates and returns the updated document (lean-style) when returnDocument is 'after'.
  SavedQuestionSet.findOneAndUpdate = (filter = {}, update = {}, options = {}) => {
    const chain = {
      lean() { return chain; },
      then(resolve, reject) {
        const raw = [...store.values()].find((candidate) => matches(candidate, filter));
        if (!raw) return Promise.resolve(null).then(resolve, reject);
        const before = clone(raw);
        const next = { ...raw, ...(update.$set || {}), updatedAt: new Date() };
        store.set(String(raw._id), next);
        return Promise.resolve(options.returnDocument === 'after' || options.new ? clone(next) : before).then(resolve, reject);
      },
    };
    return chain;
  };

  SavedQuestionSet.countDocuments = async (filter = {}) => [...store.values()].filter((raw) => matches(raw, filter)).length;
}

const reset = () => store.clear();
const count = () => store.size;
const rawDocs = () => [...store.values()];

module.exports = { install, reset, count, rawDocs };

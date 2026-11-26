'use strict';

// In-memory stand-in for the five academic models, so the API tests need no MongoDB.
// It keeps the REAL Mongoose schemas: validation, defaults, setters (trim/upper-case) and the unique
// indexes declared in the Phase 1A models (including the partial index on University.code) are enforced,
// and a violated unique index throws the same E11000 error MongoDB would.
// Replaced operations: save, findById, find (+ sort/skip/limit/collation), countDocuments.

const mongoose = require('mongoose');
const { University, Department, Regulation, Semester, Subject } = require('../../models');

const MODELS = [University, Department, Regulation, Semester, Subject];
const stores = {};

const getStore = (Model) => {
  if (!stores[Model.modelName]) stores[Model.modelName] = new Map();
  return stores[Model.modelName];
};

// Supports plain equality and { $in: [...] } (compared as strings, so ObjectIds and ids match).
const matches = (raw, filter) =>
  Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === 'object' && Array.isArray(value.$in)) {
      return value.$in.map(String).includes(String(raw[key]));
    }
    return String(raw[key]) === String(value);
  });

// Does a document fall inside a partial unique index? Supports { field: { $type: 'string' | 'objectId' } }.
const inPartialIndex = (doc, expression) =>
  Object.entries(expression).every(([field, condition]) => {
    const value = doc.get ? doc.get(field) : doc[field];
    if (condition.$type === 'string') return typeof value === 'string';
    if (condition.$type === 'objectId') return value instanceof mongoose.Types.ObjectId;
    throw new Error(`fakeAcademicDb: unsupported partialFilterExpression ${JSON.stringify(expression)}`);
  });

const compare = (sort) => (a, b) => {
  for (const [key, direction] of Object.entries(sort)) {
    const left = a[key] instanceof Object ? String(a[key]) : a[key];
    const right = b[key] instanceof Object ? String(b[key]) : b[key];
    if (typeof left === 'string' && typeof right === 'string') {
      // Same as the API's collation (locale en, strength 2): case-insensitive alphabetical order.
      const order = left.localeCompare(right, 'en', { sensitivity: 'accent' });
      if (order !== 0) return order * direction;
      continue;
    }
    // Like MongoDB, a missing value sorts before any present value in ascending order.
    if (left === undefined && right !== undefined) return -1 * direction;
    if (left !== undefined && right === undefined) return 1 * direction;
    if (left < right) return -1 * direction;
    if (left > right) return 1 * direction;
  }
  return 0;
};

function install() {
  MODELS.forEach((Model) => {
    Model.prototype.save = async function save(options = {}) {
      // validateModifiedOnly mirrors Mongoose: only changed paths are validated (new documents: all).
      await this.validate(options.validateModifiedOnly && !this.isNew ? { validateModifiedOnly: true } : undefined);
      const store = getStore(Model);
      for (const [fields, options] of Model.schema.indexes()) {
        if (!options.unique) continue;
        const keys = Object.keys(fields);
        if (options.partialFilterExpression && !inPartialIndex(this, options.partialFilterExpression)) continue;
        for (const [id, other] of store) {
          if (id === String(this._id)) continue;
          if (keys.every((key) => other[key] !== undefined && String(other[key]) === String(this.get(key)))) {
            const error = new Error(`E11000 duplicate key error (${Model.collection.name})`);
            error.code = 11000;
            throw error;
          }
        }
      }
      const now = new Date();
      if (!this.createdAt) this.createdAt = now;
      this.updatedAt = now;
      store.set(String(this._id), this.toObject());
      this.isNew = false;
      return this;
    };

    Model.findById = async (id) => {
      const raw = getStore(Model).get(String(id));
      return raw ? Model.hydrate(raw) : null;
    };

    Model.find = (filter = {}) => {
      const query = { sort: {}, skip: 0, limit: Infinity };
      const chain = {
        sort(value) { query.sort = value; return chain; },
        skip(value) { query.skip = value; return chain; },
        limit(value) { query.limit = value; return chain; },
        collation() { return chain; },
        then(resolve, reject) {
          const rows = [...getStore(Model).values()].filter((raw) => matches(raw, filter)).sort(compare(query.sort));
          return Promise.resolve(rows.slice(query.skip, query.skip + query.limit).map((raw) => Model.hydrate(raw))).then(resolve, reject);
        },
      };
      return chain;
    };

    Model.countDocuments = async (filter = {}) => [...getStore(Model).values()].filter((raw) => matches(raw, filter)).length;
  });
}

const reset = () => MODELS.forEach((Model) => getStore(Model).clear());
const count = (Model) => getStore(Model).size;
const rawDocs = (Model) => [...getStore(Model).values()];

module.exports = { install, reset, count, rawDocs };

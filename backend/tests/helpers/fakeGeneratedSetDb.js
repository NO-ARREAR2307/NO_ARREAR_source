'use strict';

// In-memory stand-in for the GeneratedQuestionSet model (two-stage important-question generation), so the API tests need no
// MongoDB. The REAL schema is kept: validation, defaults and sub-document _ids run on save.
// Replaced operations: save, findOne (resolves to a real document that can be inspected), updateOne ($set of
// "questions.$[qN].answer" with arrayFilters, the only update the answers step makes).
//
// Strict on purpose, like fakePaperDb: only the filter keys the services are expected to use are understood, so a query that
// forgot the `student` ownership filter fails the test instead of being answered with every student's sets.

const { GeneratedQuestionSet } = require('../../models');

const ALLOWED_FILTER_KEYS = ['_id', 'student'];
const store = new Map();
let latestFilter = null;

const matches = (raw, filter) =>
  Object.entries(filter).every(([key, value]) => {
    if (!ALLOWED_FILTER_KEYS.includes(key)) throw new Error(`fakeGeneratedSetDb: unsupported filter key "${key}"`);
    return String(raw[key]) === String(value);
  });

function install() {
  GeneratedQuestionSet.prototype.save = async function save() {
    await this.validate();
    const now = new Date();
    if (!this.createdAt) this.createdAt = now;
    this.updatedAt = now;
    store.set(String(this._id), this.toObject());
    this.isNew = false;
    return this;
  };

  GeneratedQuestionSet.findOne = async (filter = {}) => {
    latestFilter = filter;
    const raw = [...store.values()].find((candidate) => matches(candidate, filter));
    return raw ? GeneratedQuestionSet.hydrate(raw) : null;
  };

  GeneratedQuestionSet.updateOne = async (filter = {}, update = {}, options = {}) => {
    latestFilter = filter;
    const raw = [...store.values()].find((candidate) => matches(candidate, filter));
    if (!raw) return { matchedCount: 0, modifiedCount: 0 };
    const filters = new Map();
    (options.arrayFilters || []).forEach((entry) => {
      const [[key, value]] = Object.entries(entry);
      filters.set(key.replace(/\._id$/, ''), String(value));
    });
    Object.entries(update.$set || {}).forEach(([path, value]) => {
      const match = path.match(/^questions\.\$\[(\w+)\]\.answer$/);
      if (!match || !filters.has(match[1])) throw new Error(`fakeGeneratedSetDb: unsupported update path "${path}"`);
      const question = raw.questions.find((item) => String(item._id) === filters.get(match[1]));
      if (question) question.answer = value;
    });
    raw.updatedAt = new Date();
    return { matchedCount: 1, modifiedCount: 1 };
  };
}

const reset = () => {
  store.clear();
  latestFilter = null;
};
const count = () => store.size;
const rawDocs = () => [...store.values()];
const lastFilter = () => latestFilter;

module.exports = { install, reset, count, rawDocs, lastFilter };

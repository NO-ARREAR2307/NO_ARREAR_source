'use strict';

// In-memory stand-in for the Paper queries used by the Phase 3C-2 material loader (services/paperMaterialService.js),
// so the generator tests need no MongoDB. Only Paper.find(filter).select(...).lean() is replaced.
//
// The stand-in is deliberately strict so the tests keep protecting paper ownership:
//  - it understands exactly the filter keys the loader is expected to use (_id with $in, and uploadedBy); any other key
//    throws, so a query that forgot `uploadedBy` is not silently answered with every student's papers;
//  - `lastFilter()` exposes the filter of the latest query, so a test can assert that the signed-in user was part of it;
//  - select:false fields (extractedText, extractionWarnings) are only returned when the query asked for them with "+field",
//    exactly like Mongoose, so a loader that forgets "+extractedText" sees no text.

const mongoose = require('mongoose');
const Paper = require('../../models/Paper');

const SELECT_FALSE_FIELDS = ['extractedText', 'extractionWarnings'];
const ALLOWED_FILTER_KEYS = ['_id', 'uploadedBy'];

const store = new Map();
let latestFilter = null;
let queries = 0;

const matches = (raw, filter) =>
  Object.entries(filter).every(([key, value]) => {
    if (!ALLOWED_FILTER_KEYS.includes(key)) throw new Error(`fakePaperDb: unsupported filter key "${key}"`);
    if (value && typeof value === 'object' && Array.isArray(value.$in)) return value.$in.map(String).includes(String(raw[key]));
    return String(raw[key]) === String(value);
  });

const project = (raw, selectText) => {
  const wanted = new Set(String(selectText || '').split(/\s+/).filter((token) => token.startsWith('+')).map((token) => token.slice(1)));
  const copy = { ...raw };
  SELECT_FALSE_FIELDS.forEach((field) => {
    if (!wanted.has(field)) delete copy[field];
  });
  return copy;
};

const install = () => {
  Paper.find = (filter = {}) => {
    latestFilter = filter;
    queries += 1;
    let selectText = '';
    const chain = {
      select(value) { selectText = value; return chain; },
      lean() { return chain; },
      then(resolve, reject) {
        try {
          const rows = [...store.values()].filter((raw) => matches(raw, filter)).map((raw) => project(raw, selectText));
          return Promise.resolve(rows).then(resolve, reject);
        } catch (err) {
          return Promise.reject(err).then(resolve, reject);
        }
      },
    };
    return chain;
  };
};

const SAMPLE_TEXT =
  'Data Structures Model Paper. Unit 2: Stacks and Queues. A stack is a linear data structure that follows the LIFO principle; ' +
  'push inserts an element and pop removes the top element. A queue follows FIFO. Unit 3: Trees. Tree traversal techniques are ' +
  'inorder, preorder and postorder. A linked list stores elements in nodes linked by pointers.';

/**
 * Adds a paper and returns its id (a lower-case hex string).
 * Defaults: owned by `owner`, a completed PDF extraction with SAMPLE_TEXT. Pass `text: undefined`-like values via `text: null`
 * to store a paper without text. Extra fields (extractionWarnings, ocrConfidence, pageCount...) are stored as given.
 */
const add = ({ owner, status = 'completed', text = SAMPLE_TEXT, fileType = 'pdf', ...rest } = {}) => {
  const _id = new mongoose.Types.ObjectId();
  const raw = {
    _id,
    uploadedBy: owner,
    originalName: rest.originalName || 'paper.pdf',
    storedName: `${_id}.pdf`,
    size: 1024,
    mimeType: fileType === 'image' ? 'image/png' : 'application/pdf',
    fileType,
    extractionStatus: status,
    extractionMethod: fileType === 'image' ? 'ocr' : 'pdf-text',
    pageCount: 1,
    ...rest,
  };
  if (text !== null) raw.extractedText = text;
  store.set(String(_id), raw);
  return String(_id);
};

const reset = () => {
  store.clear();
  latestFilter = null;
  queries = 0;
};

module.exports = { install, add, reset, SAMPLE_TEXT, lastFilter: () => latestFilter, queryCount: () => queries };

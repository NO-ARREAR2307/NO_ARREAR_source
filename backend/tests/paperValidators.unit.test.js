'use strict';

// Unit tests for the Phase 4.1 study material validators. No database, network or Express app needed.

const test = require('node:test');
const assert = require('node:assert/strict');
const ApiError = require('../utils/ApiError');
const { parseMetadata, defaultTitleFromFileName, validateListQuery } = require('../validators/paperValidators');
const { accessFilterForId, accessFilterForList, isAdmin } = require('../utils/paperAccess');

const rejects = (body, options, field) => {
  try {
    parseMetadata(body, options);
  } catch (err) {
    assert.ok(err instanceof ApiError, 'must be an ApiError');
    assert.equal(err.statusCode, 400);
    if (field) assert.ok(Array.isArray(err.details) && err.details.some((d) => d.field === field), `expected an error for "${field}", got ${JSON.stringify(err.details)}`);
    return err;
  }
  assert.fail(`expected ${JSON.stringify(body)} to be rejected`);
  return null;
};

// ---------------------------------------------------------------- parseMetadata

test('upload: no metadata at all is fine (title then defaults to the file name)', () => {
  assert.deepEqual(parseMetadata(undefined), {});
  assert.deepEqual(parseMetadata(null), {});
  assert.deepEqual(parseMetadata(Object.create(null)), {}); // what multer gives when no text fields were sent
});

test('valid metadata is accepted and cleaned', () => {
  const result = parseMetadata({ title: '  Data   Structures \n Model  Paper ', description: 'Unit 1\r\n\r\n\r\n\r\nUnit 2   ', materialType: 'notes' });
  assert.deepEqual(result, { title: 'Data Structures Model Paper', description: 'Unit 1\n\nUnit 2', materialType: 'notes' });
});

test('control, zero-width and bidi-override characters are removed', () => {
  const result = parseMetadata({ title: 'Ma\u0000th\u200bs\u202e Paper\u0007', description: 'a\u0001b\u2028c' });
  assert.equal(result.title, 'Maths Paper');
  assert.equal(result.description, 'abc');
});

test('a title that is empty or only invisible characters is refused', () => {
  rejects({ title: '' }, { forUpdate: true }, 'title');
  rejects({ title: '   \n\t ' }, { forUpdate: false }, 'title');
  rejects({ title: '\u200b\u200b' }, { forUpdate: false }, 'title');
});

test('length limits: title 150, description 1000 (counted after cleaning)', () => {
  assert.equal(parseMetadata({ title: 'a'.repeat(150) }).title.length, 150);
  rejects({ title: 'a'.repeat(151) }, {}, 'title');
  assert.equal(parseMetadata({ description: 'd'.repeat(1000) }).description.length, 1000);
  rejects({ description: 'd'.repeat(1001) }, {}, 'description');
});

test('an empty description is allowed (it means "clear the description")', () => {
  assert.deepEqual(parseMetadata({ description: '' }, { forUpdate: true }), { description: '' });
});

test('materialType must be one of the known types, exactly', () => {
  for (const type of ['question_paper', 'notes', 'syllabus', 'other']) assert.equal(parseMetadata({ materialType: type }).materialType, type);
  for (const bad of ['Notes', 'NOTES', 'exam', '', ' notes', null, 5, ['notes'], { $ne: 'x' }]) rejects({ materialType: bad }, {}, 'materialType');
});

test('values that are not strings are refused (NoSQL operator objects, arrays, numbers, booleans)', () => {
  for (const bad of [{ $gt: '' }, { $ne: null }, ['a'], 5, true, null]) {
    rejects({ title: bad }, {}, 'title');
    rejects({ description: bad }, {}, 'description');
  }
});

test('mass assignment: ownership, storage and extraction fields are refused, never copied', () => {
  for (const field of ['uploadedBy', 'storedName', 'size', 'mimeType', 'fileType', 'extractionStatus', 'extractedText', 'originalName', '_id', 'role', 'uploadedAt']) {
    rejects({ title: 'ok', [field]: 'x' }, { forUpdate: true }, field);
  }
  // __proto__ as an own key (what JSON.parse produces) is just another unknown field
  rejects(JSON.parse('{"__proto__": {"role": "admin"}, "title": "ok"}'), { forUpdate: true }, '__proto__');
  assert.equal({}.role, undefined, 'Object.prototype must not be polluted');
});

test('update: the body must be an object with at least one field', () => {
  for (const bad of [undefined, null, 'text', 5, [], [{ title: 'x' }]]) {
    assert.throws(() => parseMetadata(bad, { forUpdate: true }), (err) => err instanceof ApiError && err.statusCode === 400, JSON.stringify(bad));
  }
  assert.throws(() => parseMetadata({}, { forUpdate: true }), (err) => err instanceof ApiError && err.statusCode === 400);
  assert.deepEqual(parseMetadata({ title: 'New' }, { forUpdate: true }), { title: 'New' });
});

test('every problem is reported at once', () => {
  const err = rejects({ title: 5, materialType: 'nope', extra: 1 }, { forUpdate: true });
  assert.deepEqual(err.details.map((d) => d.field).sort(), ['extra', 'materialType', 'title']);
});

// ---------------------------------------------------------------- defaultTitleFromFileName

test('default title: the file name without its extension, cleaned and capped', () => {
  assert.equal(defaultTitleFromFileName('DS Model Paper.pdf'), 'DS Model Paper');
  assert.equal(defaultTitleFromFileName('archive.v2.final.PNG'), 'archive.v2.final');
  assert.equal(defaultTitleFromFileName('.pdf'), 'Untitled material');
  assert.equal(defaultTitleFromFileName(''), 'Untitled material');
  assert.equal(defaultTitleFromFileName(`${'x'.repeat(300)}.pdf`).length, 150);
});

// ---------------------------------------------------------------- validateListQuery

const runListQuery = (query, user = { role: 'student' }) => {
  const req = { query, user };
  let error = null;
  validateListQuery(req, {}, (err) => { error = err || null; });
  return { req, error };
};

test('list query: defaults, valid filters, and unknown parameters ignored', () => {
  const { req, error } = runListQuery({ materialType: 'notes', extractionStatus: 'completed', search: '  data  structures ', sort: 'title', foo: 'bar' });
  assert.equal(error, null);
  assert.deepEqual(req.listQuery, { sort: 'title', materialType: 'notes', extractionStatus: 'completed', search: 'data structures' });
  assert.deepEqual(runListQuery({}).req.listQuery, { sort: 'newest' });
  assert.deepEqual(runListQuery({ search: '', materialType: '' }).req.listQuery, { sort: 'newest' });
});

test('list query: bad values and repeated / non-string parameters are refused', () => {
  for (const query of [
    { materialType: 'exam' }, { extractionStatus: 'done' }, { sort: 'random' },
    { search: 'x'.repeat(101) }, { search: ['a', 'b'] }, { materialType: ['notes'] }, { sort: { $ne: 'x' } },
  ]) {
    const { error } = runListQuery(query);
    assert.ok(error instanceof ApiError && error.statusCode === 400, JSON.stringify(query));
  }
});

test('list query: only an admin can filter by uploader; for a student the parameter is ignored', () => {
  const id = 'AAAAAAAAAAAAAAAAAAAAAAAA';
  assert.equal(runListQuery({ uploadedBy: id }, { role: 'student' }).req.listQuery.uploadedBy, undefined);
  assert.equal(runListQuery({ uploadedBy: 'not-an-id' }, { role: 'student' }).error, null);
  assert.equal(runListQuery({ uploadedBy: id }, { role: 'admin' }).req.listQuery.uploadedBy, id.toLowerCase());
  assert.ok(runListQuery({ uploadedBy: 'not-an-id' }, { role: 'admin' }).error instanceof ApiError);
});

// ---------------------------------------------------------------- access rules

test('access filters: admin sees everything, a student only their own, an unknown role is treated as a student', () => {
  const admin = { _id: 'a1', role: 'admin' };
  const student = { _id: 's1', role: 'student' };
  assert.equal(isAdmin(admin), true);
  assert.equal(isAdmin(student), false);
  assert.equal(isAdmin(undefined), false);
  assert.equal(isAdmin({ _id: 'x', role: 'ADMIN' }), false, 'exact match only');
  assert.deepEqual(accessFilterForId(admin, 'p1'), { _id: 'p1' });
  assert.deepEqual(accessFilterForId(student, 'p1'), { _id: 'p1', uploadedBy: 's1' });
  assert.deepEqual(accessFilterForId({ _id: 'g1', role: 'guest' }, 'p1'), { _id: 'p1', uploadedBy: 'g1' });
  assert.deepEqual(accessFilterForList(admin), {});
  assert.deepEqual(accessFilterForList(student), { uploadedBy: 's1' });
});

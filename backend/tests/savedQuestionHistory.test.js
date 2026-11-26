'use strict';

// Phase 2D: history and management of saved question sets (GET /api/saved-question-sets with search, filters,
// sorting and pagination), plus a regression pass over save, retrieve, delete and sharing.
// Same set-up as tests/savedQuestionSets.test.js: in-memory stand-ins for the academic models and the
// SavedQuestionSet model, a replaced user lookup and a global fetch that fails the test on any outbound call
// (so Gemini and every other external service are mocked out).

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'unit-test-secret-unit-test-secret-1234567890';
process.env.MONGO_URI = 'mongodb://localhost:27017/studywise_ai_test';
process.env.GEMINI_API_KEY = 'TEST_KEY_SHOULD_NEVER_LEAK';
process.env.RATE_LIMIT_MAX = '100000';
process.env.SHARE_BASE_URL = 'https://studywise.example.com';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const realFetch = global.fetch;
const User = require('../models/User');
const { University, Department, Regulation, Semester, Subject, SavedQuestionSet } = require('../models');
const generateToken = require('../utils/generateToken');
const fakeDb = require('./helpers/fakeAcademicDb');
const fakeSets = require('./helpers/fakeSavedSetDb');
const app = require('../app');

fakeDb.install();
fakeSets.install();

const newId = () => new mongoose.Types.ObjectId().toString();
const STUDENT_ID = newId();
const OTHER_ID = newId();
const accounts = {
  [STUDENT_ID]: { _id: STUDENT_ID, name: 'Student One', email: 'one@example.com', role: 'student', emailVerified: true },
  [OTHER_ID]: { _id: OTHER_ID, name: 'Student Two', email: 'two@example.com', role: 'student', emailVerified: true },
};
User.findById = async (id) => accounts[String(id)] || null;
const token = generateToken(STUDENT_ID);
const otherToken = generateToken(OTHER_ID);

let outboundCalls = [];
global.fetch = async (url) => {
  outboundCalls.push(String(url));
  throw new Error('No outbound request is allowed in this test');
};

let server;
let baseUrl;
test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  global.fetch = realFetch;
  await new Promise((resolve) => server.close(resolve));
});

// ----- fixture: University of Madras; programme A = BCA (2 semesters, 2 subjects), programme B = B.Sc. CS -----
let fx;
const makeProgramme = async (university, { name, code }) => {
  const department = await new Department({ name, code, university: university._id, level: 'UG' }).save();
  const regulation = await new Regulation({ name: '2023-2024', department: department._id }).save();
  const sem1 = await new Semester({ semesterNumber: 1, regulation: regulation._id }).save();
  const sem2 = await new Semester({ semesterNumber: 2, regulation: regulation._id }).save();
  const sub1 = await new Subject({ name: `${code} Programming`, subjectCode: `${code}101`, subjectType: 'theory', category: 'core', semester: sem1._id }).save();
  const sub2 = await new Subject({ name: `${code} Systems`, subjectCode: `${code}201`, subjectType: 'theory', category: 'core', semester: sem2._id }).save();
  return { department, regulation, sem1, sem2, sub1, sub2 };
};

test.beforeEach(async () => {
  fakeDb.reset();
  fakeSets.reset();
  outboundCalls = [];
  const university = await new University({ name: 'University of Madras', code: 'UNOM' }).save();
  fx = {
    bca: await makeProgramme(university, { name: 'BCA', code: 'BCA' }),
    bsc: await makeProgramme(university, { name: 'B.Sc. Computer Science', code: 'BSCCS' }),
  };
});

const q = (n) => ({ questionType: 'short_answer', marks: 2, question: `Define data structure concept number ${n} with an example.`, unit: null, topic: null });

let clock = Date.parse('2026-01-01T00:00:00Z');
// Inserts a set directly (the save endpoint is covered by its own tests). Each new set is one minute newer.
const seedSet = async ({ title, programme = fx.bca, subject, semester, student = STUDENT_ID, shared = false } = {}) => {
  clock += 60 * 1000;
  const doc = new SavedQuestionSet({
    student,
    subject: (subject || programme.sub1)._id,
    semester: (semester || programme.sem1)._id,
    regulation: programme.regulation._id,
    title,
    questions: [q(1), q(2)],
    createdAt: new Date(clock),
    ...(shared ? { isShared: true, shareToken: `${String(clock).padEnd(43, 'x')}`.slice(0, 43), sharedAt: new Date(clock) } : {}),
  });
  await doc.save();
  return String(doc._id);
};

const request = async (method, path, { body, auth = token } = {}) => {
  const h = {};
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (auth) h.Authorization = `Bearer ${auth}`;
  const response = await realFetch(`${baseUrl}/api/saved-question-sets${path}`, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (err) {
    json = null;
  }
  return { status: response.status, text, json };
};
const list = (query = '', opts) => request('GET', `${query ? `?${query}` : ''}`, opts);
const titles = (result) => result.json.data.map((s) => s.title);
const fieldsOf = (result) => (result.json.errors || []).map((e) => e.field).sort();

// =============================================================== default listing and response shape

test('default history: the student\'s sets, newest first, page 1 of 10, with the documented fields and no questions', async () => {
  const a = await seedSet({ title: 'Arrays revision' });
  const b = await seedSet({ title: 'Stacks revision', shared: true });
  const result = await list();
  assert.equal(result.status, 200, result.text);
  assert.equal(result.json.success, true);
  assert.equal(result.json.message, 'Saved question sets retrieved successfully');
  assert.deepEqual(result.json.data.map((s) => s._id), [b, a]);
  assert.deepEqual(result.json.meta, { page: 1, limit: 10, total: 2, totalPages: 1 });

  const item = result.json.data[1];
  assert.deepEqual(Object.keys(item).sort(), ['_id', 'createdAt', 'department', 'isShared', 'questionCount', 'regulation', 'semester', 'sharedAt', 'subject', 'title', 'updatedAt']);
  assert.equal(item.title, 'Arrays revision');
  assert.equal(item.questionCount, 2);
  assert.equal(item.isShared, false);
  assert.equal(item.sharedAt, null);
  assert.equal(item.subject.name, 'BCA Programming');
  assert.equal(item.subject.subjectCode, 'BCA101');
  assert.equal(item.semester.semesterNumber, 1);
  assert.deepEqual({ name: item.department.name, code: item.department.code, level: item.department.level }, { name: 'BCA', code: 'BCA', level: 'UG' });
  assert.ok(item.createdAt && item.updatedAt);
  assert.equal(result.json.data[0].isShared, true);
  assert.ok(result.json.data[0].sharedAt);

  // no question content and no sharing token / owner data in the list
  assert.equal(result.text.includes('questions'), false);
  assert.equal(result.text.includes('Define data structure'), false);
  assert.equal(result.text.includes('shareToken'), false);
  assert.equal(result.text.includes('one@example.com'), false);
  assert.equal(result.text.includes(STUDENT_ID), false);
  assert.equal(outboundCalls.length, 0);
});

test('empty history is a normal 200 with an empty list', async () => {
  const result = await list();
  assert.equal(result.status, 200);
  assert.deepEqual(result.json.data, []);
  assert.deepEqual(result.json.meta, { page: 1, limit: 10, total: 0, totalPages: 0 });
  // a student who has sets elsewhere still gets an empty list of their own
  await seedSet({ title: 'Other student set', student: OTHER_ID });
  assert.deepEqual((await list()).json.data, []);
});

test('filters that match nothing give an empty list, not an error', async () => {
  await seedSet({ title: 'Arrays revision' });
  for (const query of [`subjectId=${newId()}`, `semesterId=${newId()}`, `departmentId=${newId()}`, 'q=nothing-like-this']) {
    const result = await list(query);
    assert.equal(result.status, 200, query);
    assert.deepEqual(result.json.data, [], query);
    assert.deepEqual(result.json.meta, { page: 1, limit: 10, total: 0, totalPages: 0 }, query);
  }
});

// =============================================================== pagination

test('pagination: page and limit select the right slice and meta describes the whole result', async () => {
  const ids = [];
  for (let i = 1; i <= 5; i += 1) ids.push(await seedSet({ title: `Set ${i}` }));
  const newestFirst = [...ids].reverse();
  const p1 = await list('page=1&limit=2');
  const p2 = await list('page=2&limit=2');
  const p3 = await list('page=3&limit=2');
  const p4 = await list('page=4&limit=2');
  assert.deepEqual(p1.json.data.map((s) => s._id), newestFirst.slice(0, 2));
  assert.deepEqual(p2.json.data.map((s) => s._id), newestFirst.slice(2, 4));
  assert.deepEqual(p3.json.data.map((s) => s._id), newestFirst.slice(4));
  assert.deepEqual(p4.json.data, []);
  assert.deepEqual(p2.json.meta, { page: 2, limit: 2, total: 5, totalPages: 3 });
  assert.deepEqual(p4.json.meta, { page: 4, limit: 2, total: 5, totalPages: 3 });
});

test('the page size is capped at 50 and the default is 10', async () => {
  for (let i = 1; i <= 12; i += 1) await seedSet({ title: `Set ${i}` });
  assert.equal((await list()).json.data.length, 10);
  assert.equal((await list('limit=50')).status, 200);
  const tooBig = await list('limit=51');
  assert.equal(tooBig.status, 400);
  assert.match(tooBig.json.message, /between 1 and 50/);
});

test('pagination combines with filters and sorting', async () => {
  for (let i = 1; i <= 5; i += 1) await seedSet({ title: `Algo ${i}` });
  await seedSet({ title: 'Other topic' });
  const result = await list('q=algo&sort=oldest&page=2&limit=2');
  assert.deepEqual(titles(result), ['Algo 3', 'Algo 4']);
  assert.deepEqual(result.json.meta, { page: 2, limit: 2, total: 5, totalPages: 3 });
});

// =============================================================== title search

test('title search is case-insensitive "contains" and ignores surrounding or repeated spaces', async () => {
  await seedSet({ title: 'Binary Trees - unit 3' });
  await seedSet({ title: 'Linked lists' });
  await seedSet({ title: 'Balanced binary search trees' });
  assert.deepEqual(titles(await list('q=binary')), ['Balanced binary search trees', 'Binary Trees - unit 3']);
  assert.deepEqual(titles(await list('q=BINARY%20TREES')), ['Binary Trees - unit 3']);
  assert.deepEqual(titles(await list('q=%20%20linked%20%20%20lists%20')), ['Linked lists']);
  assert.deepEqual(titles(await list('q=trees')).length, 2);
});

test('title search treats special characters literally (no regular expressions)', async () => {
  await seedSet({ title: 'Unit 1 (Stacks) + Queues' });
  await seedSet({ title: 'Unit 1 Arrays' });
  assert.deepEqual(titles(await list('q=' + encodeURIComponent('(Stacks) +'))), ['Unit 1 (Stacks) + Queues']);
  for (const pattern of ['.*', '^Unit', 'Unit 1$', '[a-z]+', '(((', '\\']) {
    const result = await list('q=' + encodeURIComponent(pattern));
    assert.equal(result.status, 200, pattern);
    assert.deepEqual(result.json.data, [], pattern);
  }
});

test('an empty search text means no search; an over-long or repeated one is rejected', async () => {
  await seedSet({ title: 'Arrays' });
  assert.equal((await list('q=')).json.data.length, 1);
  assert.equal((await list('q=%20%20')).json.data.length, 1);
  const tooLong = await list('q=' + 'a'.repeat(101));
  assert.equal(tooLong.status, 400);
  assert.deepEqual(fieldsOf(tooLong), ['q']);
  assert.equal((await list('q=' + 'a'.repeat(100))).status, 200);
  assert.deepEqual(fieldsOf(await list('q=a&q=b')), ['q']);
  assert.deepEqual(fieldsOf(await list('q=a%0Ab')), ['q']);
});

// =============================================================== subject / semester / programme

test('filter by subject', async () => {
  await seedSet({ title: 'BCA prog 1' });
  await seedSet({ title: 'BCA systems', subject: fx.bca.sub2, semester: fx.bca.sem2 });
  await seedSet({ title: 'BSC prog', programme: fx.bsc });
  assert.deepEqual(titles(await list(`subjectId=${fx.bca.sub2._id}`)), ['BCA systems']);
  assert.deepEqual(titles(await list(`subjectId=${fx.bsc.sub1._id}`)), ['BSC prog']);
  // upper-case ids are accepted
  assert.deepEqual(titles(await list(`subjectId=${String(fx.bca.sub2._id).toUpperCase()}`)), ['BCA systems']);
});

test('filter by semester', async () => {
  await seedSet({ title: 'BCA sem 1' });
  await seedSet({ title: 'BCA sem 2', subject: fx.bca.sub2, semester: fx.bca.sem2 });
  assert.deepEqual(titles(await list(`semesterId=${fx.bca.sem2._id}`)), ['BCA sem 2']);
  assert.deepEqual(titles(await list(`semesterId=${fx.bca.sem1._id}`)), ['BCA sem 1']);
});

test('filter by programme (department), including sets from every semester of it', async () => {
  await seedSet({ title: 'BCA sem 1' });
  await seedSet({ title: 'BSC sem 1', programme: fx.bsc });
  await seedSet({ title: 'BCA sem 2', subject: fx.bca.sub2, semester: fx.bca.sem2 });
  await seedSet({ title: 'BSC sem 2', programme: fx.bsc, subject: fx.bsc.sub2, semester: fx.bsc.sem2 });
  assert.deepEqual(titles(await list(`departmentId=${fx.bca.department._id}`)), ['BCA sem 2', 'BCA sem 1']);
  assert.deepEqual(titles(await list(`departmentId=${fx.bsc.department._id}`)), ['BSC sem 2', 'BSC sem 1']);
  const item = (await list(`departmentId=${fx.bsc.department._id}`)).json.data[0];
  assert.equal(item.department.name, 'B.Sc. Computer Science');
  assert.equal(item.department.code, 'BSCCS');
});

test('subject, semester, programme, sharing and search filters combine (all must match)', async () => {
  await seedSet({ title: 'Trees A' });
  await seedSet({ title: 'Trees B', shared: true });
  await seedSet({ title: 'Trees C', shared: true, subject: fx.bca.sub2, semester: fx.bca.sem2 });
  await seedSet({ title: 'Trees D', shared: true, programme: fx.bsc });
  const result = await list(`q=trees&shared=true&departmentId=${fx.bca.department._id}&semesterId=${fx.bca.sem1._id}&subjectId=${fx.bca.sub1._id}`);
  assert.deepEqual(titles(result), ['Trees B']);
  assert.deepEqual(result.json.meta, { page: 1, limit: 10, total: 1, totalPages: 1 });
});

// =============================================================== shared / private

test('filter by sharing status: shared, private and no filter', async () => {
  await seedSet({ title: 'Private 1' });
  await seedSet({ title: 'Shared 1', shared: true });
  await seedSet({ title: 'Private 2' });
  await seedSet({ title: 'Shared 2', shared: true });
  assert.deepEqual(titles(await list('shared=true')), ['Shared 2', 'Shared 1']);
  assert.deepEqual(titles(await list('shared=false')), ['Private 2', 'Private 1']);
  assert.equal((await list()).json.data.length, 4);
  assert.deepEqual(titles(await list('shared=TRUE')), ['Shared 2', 'Shared 1']);
  assert.equal((await list('shared=false')).json.meta.total, 2);
});

test('sets saved before sharing existed (no isShared field) count as private', async () => {
  const legacy = await seedSet({ title: 'Legacy set' });
  delete fakeSets.rawDocs().find((doc) => String(doc._id) === legacy).isShared;
  assert.deepEqual(titles(await list('shared=false')), ['Legacy set']);
  assert.deepEqual((await list('shared=true')).json.data, []);
  assert.equal((await list()).json.data[0].isShared, false);
});

test('the history follows the real share and revoke endpoints', async () => {
  const id = await seedSet({ title: 'Will be shared' });
  assert.deepEqual((await list('shared=true')).json.data, []);
  assert.equal((await request('POST', `/${id}/share`)).status, 200);
  assert.deepEqual(titles(await list('shared=true')), ['Will be shared']);
  assert.deepEqual((await list('shared=false')).json.data, []);
  assert.equal((await request('DELETE', `/${id}/share`)).status, 200);
  assert.deepEqual(titles(await list('shared=false')), ['Will be shared']);
});

// =============================================================== sorting

test('sort=newest (default) and sort=oldest order by creation date', async () => {
  const ids = [];
  for (let i = 1; i <= 4; i += 1) ids.push(await seedSet({ title: `Set ${i}` }));
  assert.deepEqual((await list()).json.data.map((s) => s._id), [...ids].reverse());
  assert.deepEqual((await list('sort=newest')).json.data.map((s) => s._id), [...ids].reverse());
  assert.deepEqual((await list('sort=oldest')).json.data.map((s) => s._id), ids);
  assert.deepEqual((await list('sort=OLDEST')).json.data.map((s) => s._id), ids);
});

test('sets created at the same moment are ordered consistently across pages', async () => {
  const same = new Date('2026-05-05T10:00:00Z');
  for (let i = 1; i <= 4; i += 1) {
    await new SavedQuestionSet({
      student: STUDENT_ID, subject: fx.bca.sub1._id, semester: fx.bca.sem1._id, regulation: fx.bca.regulation._id,
      title: `Tie ${i}`, questions: [q(i)], createdAt: same,
    }).save();
  }
  const first = [...(await list('limit=2&page=1')).json.data, ...(await list('limit=2&page=2')).json.data].map((s) => s._id);
  assert.equal(new Set(first).size, 4);
  const oldest = [...(await list('sort=oldest&limit=2&page=1')).json.data, ...(await list('sort=oldest&limit=2&page=2')).json.data].map((s) => s._id);
  assert.deepEqual(oldest, [...first].reverse());
});

// =============================================================== invalid input

test('invalid pagination values are rejected with 400', async () => {
  for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=abc', 'limit=0', 'limit=-5', 'limit=2.5', 'limit=abc', 'limit=1000']) {
    const result = await list(query);
    assert.equal(result.status, 400, query);
    assert.equal(result.json.success, false, query);
  }
});

test('invalid filters are rejected with 400 and name the field', async () => {
  const cases = {
    'subjectId=abc': ['subjectId'],
    'semesterId=123': ['semesterId'],
    'departmentId=xyz': ['departmentId'],
    'subjectId=a&subjectId=b': ['subjectId'],
    'shared=yes': ['shared'],
    'shared=1': ['shared'],
    'shared=': ['shared'],
    'shared=true&shared=false': ['shared'],
    'sort=latest': ['sort'],
    'sort=': ['sort'],
    'sort=newest&sort=oldest': ['sort'],
    'subjectId=abc&semesterId=abc&departmentId=abc&shared=maybe&sort=up': ['departmentId', 'semesterId', 'shared', 'sort', 'subjectId'],
  };
  for (const [query, fields] of Object.entries(cases)) {
    const result = await list(query);
    assert.equal(result.status, 400, query);
    assert.equal(result.json.message, 'Validation failed', query);
    assert.deepEqual(fieldsOf(result), fields, query);
  }
});

test('operator syntax and unknown parameters in the query string cannot widen the search', async () => {
  await seedSet({ title: 'Other student set', student: OTHER_ID });
  const mine = await seedSet({ title: 'Mine' });
  for (const query of [
    'student=' + OTHER_ID, `student[$ne]=${STUDENT_ID}`, 'title[$ne]=x', 'q[$ne]=x', 'isShared[$ne]=true', 'regulation[$in]=x', '$where=1',
  ]) {
    const result = await list(query);
    assert.equal(result.status === 200 || result.status === 400, true, query);
    if (result.status === 200) assert.deepEqual(result.json.data.map((s) => s._id), [mine], query);
    assert.equal(result.text.includes('Other student set'), false, query);
  }
});

// =============================================================== ownership isolation

test('every history query is scoped to the authenticated student', async () => {
  await seedSet({ title: 'Mine shared', shared: true });
  await seedSet({ title: 'Mine private' });
  await seedSet({ title: 'Theirs shared', student: OTHER_ID, shared: true });
  await seedSet({ title: 'Theirs private', student: OTHER_ID, programme: fx.bsc });
  const queries = ['', 'shared=true', 'shared=false', 'q=theirs', 'q=mine', `departmentId=${fx.bsc.department._id}`, `departmentId=${fx.bca.department._id}`, `subjectId=${fx.bca.sub1._id}`, 'sort=oldest', 'limit=50'];
  for (const query of queries) {
    const mine = await list(query);
    assert.equal(mine.status, 200, query);
    assert.equal(mine.text.includes('Theirs'), false, `student 1, ${query}`);
    const theirs = await list(query, { auth: otherToken });
    assert.equal(theirs.text.includes('Mine'), false, `student 2, ${query}`);
  }
  assert.deepEqual(titles(await list('shared=true')), ['Mine shared']);
  assert.deepEqual(titles(await list('shared=true', { auth: otherToken })), ['Theirs shared']);
  assert.deepEqual(titles(await list(`departmentId=${fx.bsc.department._id}`)), []);
  assert.deepEqual(titles(await list(`departmentId=${fx.bsc.department._id}`, { auth: otherToken })), ['Theirs private']);
  assert.equal((await list('', { auth: otherToken })).json.meta.total, 2);
});

test('the history needs a login', async () => {
  await seedSet({ title: 'Mine' });
  assert.equal((await list('', { auth: null })).status, 401);
  assert.equal((await list('shared=true&q=mine', { auth: 'garbage' })).status, 401);
  // authentication is checked before the filters are validated
  assert.equal((await list('limit=1000&sort=bad', { auth: null })).status, 401);
});

test('the history schema has indexes for the student-scoped filters', () => {
  const indexed = SavedQuestionSet.schema.indexes().map(([fields]) => Object.keys(fields).join(','));
  assert.ok(indexed.includes('student,createdAt'));
  assert.ok(indexed.includes('student,subject,semester,createdAt'));
  assert.ok(indexed.includes('student,regulation,createdAt'));
  assert.ok(indexed.includes('student,isShared,createdAt'));
});

// =============================================================== regression: save, retrieve, delete, share

test('regression: save -> appears in history -> retrieve with questions -> share -> delete', async () => {
  const saved = await request('POST', '', {
    body: {
      title: 'Regression set',
      subjectId: String(fx.bca.sub1._id),
      semesterId: String(fx.bca.sem1._id),
      regulationId: String(fx.bca.regulation._id),
      questions: [q(1), q(2), q(3)],
    },
  });
  assert.equal(saved.status, 201, saved.text);
  const id = saved.json.data._id;
  assert.equal(saved.json.data.questions.length, 3);
  assert.equal(saved.json.data.isShared, false);

  const history = await list();
  assert.deepEqual(history.json.data.map((s) => s._id), [id]);
  assert.equal(history.json.data[0].questionCount, 3);
  assert.equal(history.json.data[0].questions, undefined);

  const detail = await request('GET', `/${id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.json.data.questions.length, 3);
  assert.equal((await request('GET', `/${id}`, { auth: otherToken })).status, 404);

  const shared = await request('POST', `/${id}/share`);
  assert.equal(shared.status, 200);
  const shareToken = shared.json.data.shareUrl.split('/shared/')[1];
  const publicView = await realFetch(`${baseUrl}/api/shared/question-sets/${shareToken}`);
  assert.equal(publicView.status, 200);
  assert.equal((await list('shared=true')).json.data.length, 1);

  assert.equal((await request('DELETE', `/${id}`, { auth: otherToken })).status, 404);
  assert.equal((await request('DELETE', `/${id}`)).status, 200);
  assert.deepEqual((await list()).json.data, []);
  assert.equal((await realFetch(`${baseUrl}/api/shared/question-sets/${shareToken}`)).status, 404);
  assert.equal(outboundCalls.length, 0);
});

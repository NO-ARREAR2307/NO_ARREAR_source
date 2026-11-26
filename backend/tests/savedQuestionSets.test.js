'use strict';

// Phase 2B: saved question sets (/api/saved-question-sets).
// No database, internet or Gemini key is needed:
//  - the academic models and the SavedQuestionSet model run against in-memory stand-ins (tests/helpers),
//  - the user lookup of the JWT middleware is replaced,
//  - global fetch is replaced by a trap that fails the test if any outbound (Gemini) call is attempted.
// Express, the auth middleware, validators, services, the real Mongoose schemas and the error handler are the real code.

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'unit-test-secret-unit-test-secret-1234567890';
process.env.MONGO_URI = 'mongodb://localhost:27017/studywise_ai_test';
process.env.GEMINI_API_KEY = 'TEST_KEY_SHOULD_NEVER_LEAK';
process.env.RATE_LIMIT_MAX = '100000';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const realFetch = global.fetch;
const User = require('../models/User');
const { University, Department, Regulation, Semester, Subject, SavedQuestionSet } = require('../models');
const generateToken = require('../utils/generateToken');
const fakeDb = require('./helpers/fakeAcademicDb');
const fakeSets = require('./helpers/fakeSavedSetDb');
const { LIMITS } = require('../validators/savedQuestionSetValidators');
const app = require('../app');

fakeDb.install();
fakeSets.install();

const newId = () => new mongoose.Types.ObjectId().toString();
const STUDENT_ID = newId();
const OTHER_ID = newId();
const ADMIN_ID = newId();
const UNVERIFIED_ID = newId();
const accounts = {
  [STUDENT_ID]: { _id: STUDENT_ID, name: 'Student One', email: 'one@example.com', role: 'student', emailVerified: true },
  [OTHER_ID]: { _id: OTHER_ID, name: 'Student Two', email: 'two@example.com', role: 'student', emailVerified: true },
  [ADMIN_ID]: { _id: ADMIN_ID, name: 'Admin', email: 'admin@example.com', role: 'admin' },
  [UNVERIFIED_ID]: { _id: UNVERIFIED_ID, name: 'New', email: 'new@example.com', role: 'student', emailVerified: false },
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

// ----- academic fixture: University of Madras / 2023-2024 / BCA / semester 1 / two subjects -----
let fx;
const makeScope = async ({ universityName = 'University of Madras', universityCode = 'UNOM', departmentName = 'BCA', departmentCode = 'BCA', level = 'UG', regulationName = '2023-2024' } = {}) => {
  const university = await new University({ name: universityName, code: universityCode }).save();
  const department = await new Department({ name: departmentName, code: departmentCode, university: university._id, level }).save();
  const regulation = await new Regulation({ name: regulationName, department: department._id }).save();
  const semester = await new Semester({ semesterNumber: 1, regulation: regulation._id }).save();
  const subject = await new Subject({ name: 'Data Structures', subjectCode: 'BCA101', subjectType: 'theory', category: 'core', semester: semester._id }).save();
  const semester2 = await new Semester({ semesterNumber: 2, regulation: regulation._id }).save();
  const subject2 = await new Subject({ name: 'Operating Systems', subjectCode: 'BCA201', subjectType: 'theory', category: 'core', semester: semester2._id }).save();
  return { university, department, regulation, semester, subject, semester2, subject2 };
};

test.beforeEach(async () => {
  fakeDb.reset();
  fakeSets.reset();
  outboundCalls = [];
  fx = await makeScope();
});

const q = (n, over = {}) => ({
  questionType: 'short_answer',
  marks: 2,
  question: `Define data structure concept number ${n} with an example.`,
  unit: null,
  topic: null,
  ...over,
});
const questions = (count) => Array.from({ length: count }, (_, i) => q(i + 1));

const payload = (over = {}) => ({
  title: 'Data Structures - revision set',
  subjectId: String(fx.subject._id),
  semesterId: String(fx.semester._id),
  regulationId: String(fx.regulation._id),
  questions: [
    q(1, { unit: 'Unit 1', topic: 'Stacks' }),
    q(2),
    { questionType: 'long_answer', marks: 10, question: 'Explain the different tree traversal techniques with algorithms.', unit: null, topic: null },
  ],
  ...over,
});

const call = async (method, path, { body, auth = token, rawBody, headers = {} } = {}) => {
  const h = { ...headers };
  if (body !== undefined || rawBody !== undefined) h['Content-Type'] = 'application/json';
  if (auth) h.Authorization = `Bearer ${auth}`;
  const response = await realFetch(`${baseUrl}/api/saved-question-sets${path}`, {
    method,
    headers: h,
    body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (err) {
    json = null;
  }
  return { status: response.status, text, json };
};
const save = (body, opts) => call('POST', '', { body, ...opts });
const fieldsOf = (result) => (result.json.errors || []).map((e) => e.field).sort();

// =============================================================== save

test('saves a question set for the authenticated student and returns it with academic details', async () => {
  const result = await save(payload());
  assert.equal(result.status, 201, result.text);
  assert.equal(result.json.success, true);
  assert.equal(result.json.message, 'Question set saved successfully');
  const set = result.json.data;
  assert.match(set._id, /^[0-9a-f]{24}$/);
  assert.equal(set.title, 'Data Structures - revision set');
  assert.equal(set.questionCount, 3);
  assert.equal(set.questions.length, 3);
  assert.deepEqual(set.questions[0], { questionType: 'short_answer', marks: 2, question: 'Define data structure concept number 1 with an example.', unit: 'Unit 1', topic: 'Stacks' });
  assert.equal(set.subject.name, 'Data Structures');
  assert.equal(set.subject.subjectCode, 'BCA101');
  assert.equal(set.semester.semesterNumber, 1);
  assert.equal(set.regulation.name, '2023-2024');
  assert.equal(set.department.name, 'BCA');
  assert.ok(set.createdAt && set.updatedAt);
  assert.equal(fakeSets.count(), 1);
  assert.equal(outboundCalls.length, 0, 'saving must not call Gemini or any external service');
});

test('the owner is the token holder and academic data is stored as references only', async () => {
  const result = await save(payload());
  assert.equal(result.status, 201, result.text);
  const [raw] = fakeSets.rawDocs();
  assert.equal(String(raw.student), STUDENT_ID);
  assert.equal(String(raw.subject), String(fx.subject._id));
  assert.equal(String(raw.semester), String(fx.semester._id));
  assert.equal(String(raw.regulation), String(fx.regulation._id));
  assert.equal(raw.questionCount, 3);
  assert.equal(raw.subjectName, undefined);
  assert.equal(raw.department, undefined);
  assert.equal(raw.university, undefined);
});

test('the response never exposes the student, email or other user data', async () => {
  const result = await save(payload());
  assert.ok(!result.text.includes(STUDENT_ID), 'student id leaked');
  assert.ok(!result.text.includes('one@example.com'), 'email leaked');
  assert.equal(result.json.data.student, undefined);
});

test('a student id sent in the body is rejected, so a set cannot be saved for someone else', async () => {
  const result = await save(payload({ student: OTHER_ID }));
  assert.equal(result.status, 400);
  assert.deepEqual(fieldsOf(result), ['student']);
  assert.equal(fakeSets.count(), 0);
});

test('whitespace in title and question text is normalised; type is case-insensitive; omitted unit/topic become null', async () => {
  const result = await save(payload({
    title: '  My   set  ',
    questions: [{ questionType: 'SHORT_ANSWER', marks: 2, question: '  Define   a   stack   and its uses.  ' }],
  }));
  assert.equal(result.status, 201, result.text);
  assert.equal(result.json.data.title, 'My set');
  assert.deepEqual(result.json.data.questions[0], { questionType: 'short_answer', marks: 2, question: 'Define a stack and its uses.', unit: null, topic: null });
});

test('a matching questionCount is accepted', async () => {
  const result = await save(payload({ questionCount: 3 }));
  assert.equal(result.status, 201, result.text);
});

test('a mismatching questionCount is rejected', async () => {
  const result = await save(payload({ questionCount: 7 }));
  assert.equal(result.status, 400);
  assert.deepEqual(fieldsOf(result), ['questionCount']);
});

test('a set of exactly the maximum number of questions can be saved', async () => {
  const result = await save(payload({ questions: questions(LIMITS.maxQuestions) }));
  assert.equal(result.status, 201, result.text);
  assert.equal(result.json.data.questionCount, LIMITS.maxQuestions);
});

// ----- required fields / invalid references

test('missing required fields are all reported together', async () => {
  const result = await save({});
  assert.equal(result.status, 400);
  assert.deepEqual(fieldsOf(result), ['questions', 'regulationId', 'semesterId', 'subjectId', 'title']);
});

test('non-ObjectId references and a bad title are rejected', async () => {
  const result = await save(payload({ subjectId: 'abc', semesterId: 123, regulationId: '{"$ne":null}', title: '   ' }));
  assert.equal(result.status, 400);
  assert.deepEqual(fieldsOf(result), ['regulationId', 'semesterId', 'subjectId', 'title']);
});

test('a title longer than the limit and a title with line breaks are rejected', async () => {
  assert.equal((await save(payload({ title: 'x'.repeat(LIMITS.maxTitleLength + 1) }))).status, 400);
  assert.equal((await save(payload({ title: 'line1\nline2' }))).status, 400);
  assert.equal((await save(payload({ title: 42 }))).status, 400);
});

test('a non-existent subject, semester or regulation is a 404', async () => {
  assert.equal((await save(payload({ subjectId: newId() }))).status, 404);
  assert.equal((await save(payload({ semesterId: newId() }))).status, 404);
  assert.equal((await save(payload({ regulationId: newId() }))).status, 404);
  assert.equal(fakeSets.count(), 0);
});

test('an inactive subject is treated as not found', async () => {
  fx.subject.isActive = false;
  await fx.subject.save();
  const result = await save(payload());
  assert.equal(result.status, 404);
  assert.equal(fakeSets.count(), 0);
});

test('a subject that does not belong to the given semester is rejected', async () => {
  const result = await save(payload({ semesterId: String(fx.semester2._id) }));
  assert.equal(result.status, 400);
  assert.deepEqual(fieldsOf(result), ['semesterId']);
  assert.equal(fakeSets.count(), 0);
});

test('a semester that does not belong to the given regulation is rejected', async () => {
  const other = await makeScope({ universityCode: 'UNOM9', departmentName: 'B.Sc. Computer Science', departmentCode: 'BSCCS' });
  const result = await save(payload({ regulationId: String(other.regulation._id) }));
  assert.equal(result.status, 400);
  assert.deepEqual(fieldsOf(result), ['regulationId']);
  assert.equal(fakeSets.count(), 0);
});

test('a subject outside the supported scope (other university, regulation or programme) is rejected', async () => {
  const outsideUniversity = await makeScope({ universityName: 'Anna University', universityCode: 'AU' });
  const outsideRegulation = await makeScope({ universityCode: 'UNOM2', regulationName: '2019-2020' });
  const postgraduate = await makeScope({ universityCode: 'UNOM3', departmentName: 'M.Sc. Computer Science', departmentCode: 'MSCCS', level: 'PG' });
  for (const scope of [outsideUniversity, outsideRegulation, postgraduate]) {
    const result = await save(payload({
      subjectId: String(scope.subject._id),
      semesterId: String(scope.semester._id),
      regulationId: String(scope.regulation._id),
    }));
    assert.equal(result.status, 400, result.text);
  }
  assert.equal(fakeSets.count(), 0);
});

// ----- invalid question data

test('malformed question data is rejected with the offending fields', async () => {
  const bad = [
    'just a string',
    null,
    ['array'],
    q(1, { questionType: 'quiz' }), // ("essay" and "mcq" are valid types since Phase 2E)
    q(2, { marks: 0 }),
    q(3, { marks: 21 }),
    q(4, { marks: 2.5 }),
    q(5, { marks: '5' }),
    q(6, { question: 'short' }),
    q(7, { question: 'x'.repeat(LIMITS.maxQuestionLength + 1) }),
    q(8, { question: 'has a\nline break in it' }),
    q(9, { question: 12345 }),
    q(10, { unit: 'u'.repeat(LIMITS.maxUnitLength + 1) }),
    q(11, { topic: ['not text'] }),
    { ...q(12), answer: 'unknown field' },
    { marks: 2, question: 'Missing the question type field entirely.' },
  ];
  const result = await save(payload({ questions: bad }));
  assert.equal(result.status, 400);
  const fields = fieldsOf(result);
  for (const expected of [
    'questions[0]', 'questions[1]', 'questions[2]', 'questions[3].questionType', 'questions[4].marks', 'questions[5].marks',
    'questions[6].marks', 'questions[7].marks', 'questions[8].question', 'questions[9].question', 'questions[10].question',
    'questions[11].question', 'questions[12].unit', 'questions[13].topic', 'questions[14].answer', 'questions[15].questionType',
  ]) {
    assert.ok(fields.includes(expected), `expected an error for ${expected}, got ${fields.join(', ')}`);
  }
  assert.equal(fakeSets.count(), 0);
});

test('duplicate questions inside one set are rejected', async () => {
  const result = await save(payload({ questions: [q(1), q(2), q(1, { question: '  DEFINE data structure concept number 1 with an EXAMPLE.  ' })] }));
  assert.equal(result.status, 400);
  assert.deepEqual(fieldsOf(result), ['questions[2].question']);
});

test('prototype-pollution style keys and operator objects cannot slip through as question data', async () => {
  const result = await save(payload({ questions: [{ ...q(1), $set: { a: 1 }, __proto__x: 1 }, { questionType: { $ne: null }, marks: { $gt: 0 }, question: { $regex: '.*' } }] }));
  assert.equal(result.status, 400);
  assert.ok(fieldsOf(result).includes('questions[1].questionType'));
  assert.ok(fieldsOf(result).includes('questions[1].marks'));
  assert.ok(fieldsOf(result).includes('questions[1].question'));
});

// ----- empty / oversized

test('an empty question list is rejected', async () => {
  const result = await save(payload({ questions: [] }));
  assert.equal(result.status, 400);
  assert.deepEqual(fieldsOf(result), ['questions']);
  assert.match(result.json.errors[0].message, /empty/);
});

test('questions that are not an array are rejected', async () => {
  for (const value of ['text', 5, {}, null]) {
    const result = await save(payload({ questions: value }));
    assert.equal(result.status, 400);
    assert.deepEqual(fieldsOf(result), ['questions']);
  }
});

test('more than the maximum number of questions is rejected', async () => {
  const result = await save(payload({ questions: questions(LIMITS.maxQuestions + 1) }));
  assert.equal(result.status, 400);
  assert.deepEqual(fieldsOf(result), ['questions']);
  assert.match(result.json.errors[0].message, /more than 30/);
  assert.equal(fakeSets.count(), 0);
});

test('an oversized request body is rejected with 413 before any validation or saving', async () => {
  const result = await save(payload({ padding: 'x'.repeat(LIMITS.maxBodyBytes + 1024) }));
  assert.equal(result.status, 413);
  assert.equal(result.json.success, false);
  assert.equal(fakeSets.count(), 0);
});

test('a body above the global 1 MB parser limit is also a 413', async () => {
  const result = await save(payload({ padding: 'x'.repeat(1024 * 1024 + 10) }));
  assert.equal(result.status, 413);
});

test('malformed JSON and a non-object body are 400', async () => {
  assert.equal((await call('POST', '', { rawBody: '{bad json' })).status, 400);
  assert.equal((await save([1, 2, 3])).status, 400);
  assert.equal((await save('text')).status, 400);
});

test('a student cannot keep more than the maximum number of saved sets', async () => {
  for (let i = 0; i < LIMITS.maxSavedSetsPerStudent; i += 1) {
    await new SavedQuestionSet({
      student: STUDENT_ID, subject: fx.subject._id, semester: fx.semester._id, regulation: fx.regulation._id,
      title: `Set ${i}`, questions: [q(1)],
    }).save();
  }
  const result = await save(payload());
  assert.equal(result.status, 409);
  assert.match(result.json.message, /at most 100/);
  // The limit is per student: another student can still save.
  assert.equal((await save(payload(), { auth: otherToken })).status, 201);
});

// =============================================================== list

const seed = async (count, { student = STUDENT_ID, subject, semester, regulation, prefix = 'Set' } = {}) => {
  const ids = [];
  for (let i = 1; i <= count; i += 1) {
    const result = await save(payload({
      title: `${prefix} ${i}`,
      subjectId: String((subject || fx.subject)._id),
      semesterId: String((semester || fx.semester)._id),
      regulationId: String((regulation || fx.regulation)._id),
    }), { auth: generateToken(student) });
    assert.equal(result.status, 201, result.text);
    ids.push(result.json.data._id);
  }
  return ids;
};

test('lists only the current student\'s sets, newest first, without the questions or private data', async () => {
  const mine = await seed(3);
  await seed(2, { student: OTHER_ID, prefix: 'Other' });
  const result = await call('GET', '');
  assert.equal(result.status, 200, result.text);
  assert.equal(result.json.message, 'Saved question sets retrieved successfully');
  assert.deepEqual(result.json.data.map((s) => s._id), [...mine].reverse());
  assert.deepEqual(result.json.meta, { page: 1, limit: 10, total: 3, totalPages: 1 });
  const first = result.json.data[0];
  assert.equal(first.questions, undefined, 'the list must not include the questions');
  assert.equal(first.questionCount, 3);
  assert.equal(first.subject.name, 'Data Structures');
  assert.equal(first.semester.semesterNumber, 1);
  assert.equal(first.regulation.name, '2023-2024');
  assert.equal(first.department.name, 'BCA');
  assert.ok(!result.text.includes('Other '), "another student's set leaked");
  assert.ok(!result.text.includes(STUDENT_ID) && !result.text.includes('one@example.com') && !result.text.includes('two@example.com'));
});

test('an empty list is a normal 200 response', async () => {
  const result = await call('GET', '');
  assert.equal(result.status, 200);
  assert.deepEqual(result.json.data, []);
  assert.deepEqual(result.json.meta, { page: 1, limit: 10, total: 0, totalPages: 0 });
});

test('pagination: page and limit select the right slice and meta describes the whole result', async () => {
  const ids = await seed(5);
  const newestFirst = [...ids].reverse();
  const page1 = await call('GET', '?page=1&limit=2');
  const page2 = await call('GET', '?page=2&limit=2');
  const page3 = await call('GET', '?page=3&limit=2');
  const page4 = await call('GET', '?page=4&limit=2');
  assert.deepEqual(page1.json.data.map((s) => s._id), newestFirst.slice(0, 2));
  assert.deepEqual(page2.json.data.map((s) => s._id), newestFirst.slice(2, 4));
  assert.deepEqual(page3.json.data.map((s) => s._id), newestFirst.slice(4));
  assert.deepEqual(page4.json.data, []);
  assert.deepEqual(page2.json.meta, { page: 2, limit: 2, total: 5, totalPages: 3 });
});

test('invalid pagination values are rejected', async () => {
  for (const query of ['?page=0', '?page=-1', '?page=abc', '?limit=0', '?limit=51', '?limit=1.5', '?limit=abc']) {
    assert.equal((await call('GET', query)).status, 400, query);
  }
});

test('filtering by subject and by semester', async () => {
  const ds = await seed(2, { prefix: 'DS' });
  const os = await seed(1, { subject: fx.subject2, semester: fx.semester2, prefix: 'OS' });

  const bySubject = await call('GET', `?subjectId=${fx.subject._id}`);
  assert.deepEqual(bySubject.json.data.map((s) => s._id).sort(), [...ds].sort());
  assert.equal(bySubject.json.meta.total, 2);

  const bySemester = await call('GET', `?semesterId=${fx.semester2._id}`);
  assert.deepEqual(bySemester.json.data.map((s) => s._id), os);
  assert.equal(bySemester.json.data[0].subject.name, 'Operating Systems');
  assert.equal(bySemester.json.data[0].semester.semesterNumber, 2);

  const both = await call('GET', `?subjectId=${fx.subject2._id}&semesterId=${fx.semester2._id}`);
  assert.deepEqual(both.json.data.map((s) => s._id), os);

  const mismatch = await call('GET', `?subjectId=${fx.subject._id}&semesterId=${fx.semester2._id}`);
  assert.deepEqual(mismatch.json.data, []);

  const none = await call('GET', `?subjectId=${newId()}`);
  assert.deepEqual(none.json.data, []);
});

test('filters combine with pagination and never reach another student\'s sets', async () => {
  await seed(3);
  await seed(2, { student: OTHER_ID });
  const result = await call('GET', `?subjectId=${fx.subject._id}&limit=2&page=2`);
  assert.equal(result.json.data.length, 1);
  assert.deepEqual(result.json.meta, { page: 2, limit: 2, total: 3, totalPages: 2 });
});

test('invalid filter ids are rejected', async () => {
  const result = await call('GET', '?subjectId=abc&semesterId=%7B%22%24ne%22%3Anull%7D');
  assert.equal(result.status, 400);
  assert.deepEqual(fieldsOf(result), ['semesterId', 'subjectId']);
});

test('query-string operator syntax cannot widen the search to other students\' sets', async () => {
  await seed(1, { student: OTHER_ID, prefix: 'Other' });
  for (const query of ['?subjectId[$ne]=x', '?student=' + OTHER_ID, `?student[$ne]=${STUDENT_ID}`]) {
    const result = await call('GET', query);
    assert.equal(result.status, 200, query);
    assert.deepEqual(result.json.data, [], query);
    assert.ok(!result.text.includes('Other 1'));
  }
});

test('a saved set stays readable after its subject was removed from the academic data', async () => {
  const [id] = await seed(1);
  fakeDb.reset();
  const result = await call('GET', '');
  assert.equal(result.status, 200);
  assert.equal(result.json.data[0]._id, id);
  assert.equal(result.json.data[0].subject.name, null);
  assert.equal(result.json.data[0].department, null);
});

// =============================================================== get one

test('retrieves one of the student\'s own sets with all its questions', async () => {
  const [id] = await seed(1);
  const result = await call('GET', `/${id}`);
  assert.equal(result.status, 200, result.text);
  assert.equal(result.json.message, 'Saved question set retrieved successfully');
  const set = result.json.data;
  assert.equal(set._id, id);
  assert.equal(set.title, 'Set 1');
  assert.equal(set.questionCount, 3);
  assert.equal(set.questions.length, 3);
  assert.equal(set.questions[2].questionType, 'long_answer');
  assert.equal(set.questions[2].marks, 10);
  assert.equal(set.subject.name, 'Data Structures');
  assert.equal(set.department.name, 'BCA');
  assert.equal(set.student, undefined);
  assert.ok(!result.text.includes(STUDENT_ID));
});

test("another student's set is a 404 and none of its content is revealed", async () => {
  const [id] = await seed(1, { student: OTHER_ID, prefix: 'Secret' });
  const result = await call('GET', `/${id}`);
  assert.equal(result.status, 404);
  assert.equal(result.json.message, 'Saved question set not found');
  assert.ok(!result.text.includes('Secret'));
  assert.ok(!result.text.includes('tree traversal'));
  // Same answer as for an id that does not exist at all, so ids cannot be probed.
  const missing = await call('GET', `/${newId()}`);
  assert.equal(missing.status, 404);
  assert.equal(missing.json.message, result.json.message);
});

test('an invalid set id is a 400', async () => {
  for (const id of ['abc', '123', 'zzzzzzzzzzzzzzzzzzzzzzzz']) {
    assert.equal((await call('GET', `/${id}`)).status, 400, id);
    assert.equal((await call('DELETE', `/${id}`)).status, 400, id);
  }
});

// =============================================================== delete

test('deletes one of the student\'s own sets and only that one', async () => {
  const ids = await seed(2);
  const result = await call('DELETE', `/${ids[0]}`);
  assert.equal(result.status, 200, result.text);
  assert.equal(result.json.success, true);
  assert.equal(result.json.message, 'Saved question set deleted successfully');
  assert.equal(fakeSets.count(), 1);
  assert.equal((await call('GET', `/${ids[0]}`)).status, 404);
  assert.equal((await call('GET', `/${ids[1]}`)).status, 200);
  assert.equal((await call('DELETE', `/${ids[0]}`)).status, 404, 'deleting twice is a 404');
});

test("another student's set cannot be deleted and stays intact", async () => {
  const [id] = await seed(1, { student: OTHER_ID });
  const result = await call('DELETE', `/${id}`);
  assert.equal(result.status, 404);
  assert.equal(result.json.message, 'Saved question set not found');
  assert.equal(fakeSets.count(), 1);
  assert.equal((await call('GET', `/${id}`, { auth: otherToken })).status, 200, 'the owner still has the set');
});

test('deleting a non-existent set is a 404', async () => {
  assert.equal((await call('DELETE', `/${newId()}`)).status, 404);
});

// =============================================================== authentication

const someId = () => newId();
const endpoints = [
  ['POST', '', () => payload()],
  ['GET', '', () => undefined],
  ['GET', `/${someId()}`, () => undefined],
  ['DELETE', `/${someId()}`, () => undefined],
];

test('every endpoint requires a token', async () => {
  for (const [method, path, makeBody] of endpoints) {
    const result = await call(method, path, { body: makeBody(), auth: null });
    assert.equal(result.status, 401, `${method} ${path}`);
    assert.equal(result.json.success, false);
  }
  assert.equal(fakeSets.count(), 0);
});

test('malformed, wrongly signed, expired and non-bearer tokens are 401', async () => {
  const wrongSecret = jwt.sign({ id: STUDENT_ID }, 'another-secret-another-secret-123456789');
  const expired = jwt.sign({ id: STUDENT_ID }, process.env.JWT_SECRET, { expiresIn: -10 });
  const noId = jwt.sign({ foo: 'bar' }, process.env.JWT_SECRET);
  for (const bad of ['not.a.jwt', wrongSecret, expired, noId]) {
    for (const [method, path, makeBody] of endpoints) {
      const result = await call(method, path, { body: makeBody(), auth: bad });
      assert.equal(result.status, 401, `${method} ${path} with ${bad.slice(0, 12)}`);
    }
  }
  const basic = await call('GET', '', { auth: null, headers: { Authorization: `Basic ${token}` } });
  assert.equal(basic.status, 401);
});

test('a token of a deleted account is 401', async () => {
  const ghost = generateToken(newId());
  assert.equal((await call('GET', '', { auth: ghost })).status, 401);
  assert.equal((await save(payload(), { auth: ghost })).status, 401);
});

test('a student whose email is not verified gets 403 on every endpoint', async () => {
  const unverified = generateToken(UNVERIFIED_ID);
  for (const [method, path, makeBody] of endpoints) {
    const result = await call(method, path, { body: makeBody(), auth: unverified });
    assert.equal(result.status, 403, `${method} ${path}`);
    assert.equal(result.json.code, 'EMAIL_NOT_VERIFIED');
  }
  assert.equal(fakeSets.count(), 0);
});

test('authentication is checked before validation: an invalid body without a token is 401, not 400', async () => {
  const result = await save({}, { auth: null });
  assert.equal(result.status, 401);
});

// =============================================================== regression: Phase 2A untouched

test('the existing endpoints are still mounted and protected', async () => {
  for (const path of ['/api/questions/important', '/api/questions/ask', '/api/questions/ask/stream']) {
    const response = await realFetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 401, path);
  }
});

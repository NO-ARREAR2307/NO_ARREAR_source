'use strict';

// Phase 2C: sharing saved question sets (POST/DELETE /api/saved-question-sets/:id/share and
// GET /api/shared/question-sets/:token).
// Same set-up as tests/savedQuestionSets.test.js: in-memory stand-ins for the academic models and the
// SavedQuestionSet model, a replaced user lookup, and a global fetch that fails the test on any outbound call
// (so Gemini and every other external service are mocked out). Express, middleware, validators, services,
// the real Mongoose schemas and the error handler are the real code.

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
  [STUDENT_ID]: { _id: STUDENT_ID, name: 'Student One', email: 'one@example.com', role: 'student', emailVerified: true, password: 'HASHED_SECRET_ONE' },
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

let fx;
test.beforeEach(async () => {
  fakeDb.reset();
  fakeSets.reset();
  outboundCalls = [];
  const university = await new University({ name: 'University of Madras', code: 'UNOM' }).save();
  const department = await new Department({ name: 'BCA', code: 'BCA', university: university._id, level: 'UG' }).save();
  const regulation = await new Regulation({ name: '2023-2024', department: department._id }).save();
  const semester = await new Semester({ semesterNumber: 1, regulation: regulation._id }).save();
  const subject = await new Subject({ name: 'Data Structures', subjectCode: 'BCA101', subjectType: 'theory', category: 'core', semester: semester._id }).save();
  fx = { university, department, regulation, semester, subject };
});

const payload = () => ({
  title: 'Data Structures - revision set',
  subjectId: String(fx.subject._id),
  semesterId: String(fx.semester._id),
  regulationId: String(fx.regulation._id),
  questions: [
    { questionType: 'short_answer', marks: 2, question: 'Define a stack and give one use of it.', unit: 'Unit 1', topic: 'Stacks' },
    { questionType: 'long_answer', marks: 10, question: 'Explain the different tree traversal techniques with algorithms.', unit: null, topic: null },
  ],
});

const request = async (method, path, { body, auth, headers = {} } = {}) => {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (auth) h.Authorization = `Bearer ${auth}`;
  const response = await realFetch(`${baseUrl}/api${path}`, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (err) {
    json = null;
  }
  return { status: response.status, headers: response.headers, text, json };
};

const saveSet = async (auth = token) => {
  const result = await request('POST', '/saved-question-sets', { body: payload(), auth });
  assert.equal(result.status, 201, result.text);
  return result.json.data._id;
};
const enable = (id, auth = token) => request('POST', `/saved-question-sets/${id}/share`, { auth });
const revoke = (id, auth = token) => request('DELETE', `/saved-question-sets/${id}/share`, { auth });
const publicGet = (shareToken, opts) => request('GET', `/shared/question-sets/${shareToken}`, opts);
const tokenFromUrl = (url) => url.split('/shared/')[1];
const stored = (id) => fakeSets.rawDocs().find((doc) => String(doc._id) === String(id));

// =============================================================== private by default

test('a new saved set is private: not shared, no token, and its id is not a public link', async () => {
  const id = await saveSet();
  const raw = stored(id);
  assert.equal(raw.isShared, false);
  assert.equal(raw.shareToken, null);
  assert.equal(raw.sharedAt, null);

  const owner = await request('GET', `/saved-question-sets/${id}`, { auth: token });
  assert.equal(owner.status, 200);
  assert.equal(owner.json.data.isShared, false);
  assert.equal(owner.json.data.sharedAt, null);
  assert.equal(owner.text.includes('shareToken'), false);

  // the Mongo id must not work as a share token
  const byId = await publicGet(id);
  assert.equal(byId.status, 404);
});

test('the schema keeps sets private by default and indexes tokens uniquely', () => {
  const doc = new SavedQuestionSet({});
  assert.equal(doc.isShared, false);
  assert.equal(doc.shareToken, null);
  assert.equal(doc.sharedAt, null);
  const tokenIndex = SavedQuestionSet.schema.indexes().find(([fields]) => fields.shareToken === 1);
  assert.ok(tokenIndex, 'shareToken index exists');
  assert.equal(tokenIndex[1].unique, true);
  assert.deepEqual(tokenIndex[1].partialFilterExpression, { shareToken: { $type: 'string' } });
});

// =============================================================== enable

test('the owner can enable sharing and gets a public URL with a random token', async () => {
  const id = await saveSet();
  const result = await enable(id);
  assert.equal(result.status, 200, result.text);
  assert.equal(result.json.success, true);
  assert.equal(result.json.message, 'Sharing enabled successfully');
  const data = result.json.data;
  assert.equal(data.isShared, true);
  assert.ok(data.sharedAt);
  assert.match(data.shareUrl, /^https:\/\/studywise\.example\.com\/shared\/[A-Za-z0-9_-]{43}$/);
  const shareToken = tokenFromUrl(data.shareUrl);
  assert.equal(data.apiUrl, `/api/shared/question-sets/${shareToken}`);
  assert.notEqual(shareToken, id);
  assert.equal(shareToken.includes(id), false);
  assert.equal(result.json.data.alreadyShared, undefined);

  const raw = stored(id);
  assert.equal(raw.isShared, true);
  assert.equal(raw.shareToken, shareToken);
  assert.ok(raw.sharedAt instanceof Date);
  assert.equal(outboundCalls.length, 0);
});

test('tokens are unpredictable: different sets get different tokens', async () => {
  const tokens = new Set();
  for (let i = 0; i < 8; i += 1) {
    const id = await saveSet();
    tokens.add(tokenFromUrl((await enable(id)).json.data.shareUrl));
  }
  assert.equal(tokens.size, 8);
});

test('enabling twice returns the same link and does not create a new token', async () => {
  const id = await saveSet();
  const first = await enable(id);
  const sharedAtFirst = stored(id).sharedAt.getTime();
  const second = await enable(id);
  const third = await enable(id);
  assert.equal(second.status, 200);
  assert.equal(second.json.message, 'Question set is already shared');
  assert.equal(second.json.data.shareUrl, first.json.data.shareUrl);
  assert.equal(third.json.data.shareUrl, first.json.data.shareUrl);
  assert.equal(stored(id).sharedAt.getTime(), sharedAtFirst);
});

test('after a revoke, enabling again issues a NEW token and the old link stays dead', async () => {
  const id = await saveSet();
  const oldToken = tokenFromUrl((await enable(id)).json.data.shareUrl);
  await revoke(id);
  const newToken = tokenFromUrl((await enable(id)).json.data.shareUrl);
  assert.notEqual(newToken, oldToken);
  assert.equal((await publicGet(oldToken)).status, 404);
  assert.equal((await publicGet(newToken)).status, 200);
});

test('the owner sees the sharing status of their set', async () => {
  const id = await saveSet();
  await enable(id);
  const one = await request('GET', `/saved-question-sets/${id}`, { auth: token });
  assert.equal(one.json.data.isShared, true);
  assert.ok(one.json.data.sharedAt);
  const list = await request('GET', '/saved-question-sets', { auth: token });
  assert.equal(list.json.data[0].isShared, true);
  assert.equal(list.text.includes('shareToken'), false);
});

// =============================================================== public access

test('a valid token returns the set without logging in', async () => {
  const id = await saveSet();
  const shareToken = tokenFromUrl((await enable(id)).json.data.shareUrl);
  const result = await publicGet(shareToken); // no Authorization header
  assert.equal(result.status, 200, result.text);
  assert.equal(result.json.success, true);
  const set = result.json.data;
  assert.equal(set.title, 'Data Structures - revision set');
  assert.equal(set.questionCount, 2);
  assert.deepEqual(set.questions[0], { questionType: 'short_answer', marks: 2, question: 'Define a stack and give one use of it.', unit: 'Unit 1', topic: 'Stacks' });
  assert.equal(set.questions[1].marks, 10);
  assert.deepEqual(set.subject, { name: 'Data Structures', subjectCode: 'BCA101', subjectType: 'theory', category: 'core' });
  assert.deepEqual(set.semester, { semesterNumber: 1 });
  assert.deepEqual(set.regulation, { name: '2023-2024' });
  assert.deepEqual(set.department, { name: 'BCA', code: 'BCA', level: 'UG' });
  assert.ok(set.sharedAt);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(result.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(outboundCalls.length, 0);
});

test('the public link also works with an invalid or someone else\'s Authorization header', async () => {
  const id = await saveSet();
  const shareToken = tokenFromUrl((await enable(id)).json.data.shareUrl);
  assert.equal((await publicGet(shareToken, { auth: otherToken })).status, 200);
  assert.equal((await publicGet(shareToken, { auth: 'not-a-real-jwt' })).status, 200);
});

test('the public response contains no private user data, ids or tokens', async () => {
  const id = await saveSet();
  const shareToken = tokenFromUrl((await enable(id)).json.data.shareUrl);
  const result = await publicGet(shareToken);
  assert.equal(result.status, 200);
  const text = result.text;
  for (const secret of ['one@example.com', 'Student One', 'HASHED_SECRET_ONE', STUDENT_ID, 'password', 'email', 'student', 'role']) {
    assert.equal(text.includes(secret), false, `public response leaks "${secret}"`);
  }
  // no internal ids at all: not the set's, nor the academic records'
  for (const internal of [id, String(fx.subject._id), String(fx.semester._id), String(fx.regulation._id), String(fx.department._id)]) {
    assert.equal(text.includes(internal), false);
  }
  assert.equal(text.includes(shareToken), false);
  const keys = Object.keys(result.json.data).sort();
  assert.deepEqual(keys, ['department', 'questionCount', 'questions', 'regulation', 'semester', 'sharedAt', 'subject', 'title']);
});

test('invalid, malformed and nonexistent tokens all give the same safe 404', async () => {
  const id = await saveSet();
  await enable(id);
  const unknown = 'A'.repeat(43);
  const attempts = [unknown, 'short', 'x'.repeat(200), `${'a'.repeat(42)}!`, '%20', newId(), "{$ne:null}", '$ne'];
  const bodies = new Set();
  for (const attempt of attempts) {
    const result = await publicGet(encodeURIComponent(attempt));
    assert.equal(result.status, 404, `token ${attempt}`);
    assert.equal(result.json.success, false);
    bodies.add(result.json.message);
    assert.equal(result.text.includes('one@example.com'), false);
  }
  assert.deepEqual([...bodies], ['Shared question set not found']);
  // query-string operator injection must not match a private/shared set either
  assert.equal((await request('GET', `/shared/question-sets/${unknown}?shareToken[$ne]=null`)).status, 404);
});

test('a private set (never shared) has no working link', async () => {
  const id = await saveSet();
  assert.equal(stored(id).shareToken, null);
  assert.equal((await publicGet('null')).status, 404);
  assert.equal((await publicGet('undefined')).status, 404);
});

test('a token whose set is flagged not shared is refused (isShared must be true)', async () => {
  const id = await saveSet();
  const shareToken = tokenFromUrl((await enable(id)).json.data.shareUrl);
  fakeSets.rawDocs().find((doc) => String(doc._id) === id).isShared = false;
  assert.equal((await publicGet(shareToken)).status, 404);
});

test('a deleted set stops being reachable through its link', async () => {
  const id = await saveSet();
  const shareToken = tokenFromUrl((await enable(id)).json.data.shareUrl);
  assert.equal((await request('DELETE', `/saved-question-sets/${id}`, { auth: token })).status, 200);
  assert.equal((await publicGet(shareToken)).status, 404);
});

// =============================================================== revoke

test('revoking sharing disables the link immediately and clears the token', async () => {
  const id = await saveSet();
  const shareToken = tokenFromUrl((await enable(id)).json.data.shareUrl);
  assert.equal((await publicGet(shareToken)).status, 200);

  const result = await revoke(id);
  assert.equal(result.status, 200, result.text);
  assert.equal(result.json.message, 'Sharing revoked successfully');
  assert.equal(result.json.data.isShared, false);
  assert.equal(result.json.data.shareUrl, null);
  assert.equal(result.json.data.sharedAt, null);

  const raw = stored(id);
  assert.equal(raw.isShared, false);
  assert.equal(raw.shareToken, null);
  assert.equal(raw.sharedAt, null);

  const after = await publicGet(shareToken);
  assert.equal(after.status, 404);
  assert.equal(after.json.message, 'Shared question set not found');
});

test('revoking a set that is not shared is harmless', async () => {
  const id = await saveSet();
  const result = await revoke(id);
  assert.equal(result.status, 200);
  assert.equal(result.json.data.isShared, false);
});

test('revoking keeps the saved set itself intact for the owner', async () => {
  const id = await saveSet();
  await enable(id);
  await revoke(id);
  const owner = await request('GET', `/saved-question-sets/${id}`, { auth: token });
  assert.equal(owner.status, 200);
  assert.equal(owner.json.data.questions.length, 2);
  assert.equal(owner.json.data.isShared, false);
});

// =============================================================== owner-only / security

test('enable and revoke need a login', async () => {
  const id = await saveSet();
  assert.equal((await enable(id, null)).status, 401);
  assert.equal((await revoke(id, null)).status, 401);
  assert.equal((await enable(id, 'garbage')).status, 401);
  assert.equal(stored(id).isShared, false);
});

test('another student cannot enable sharing on my set (404, nothing changes)', async () => {
  const id = await saveSet();
  const result = await enable(id, otherToken);
  assert.equal(result.status, 404);
  assert.equal(result.json.message, 'Saved question set not found');
  assert.equal(stored(id).isShared, false);
  assert.equal(stored(id).shareToken, null);
});

test('another student cannot revoke my share, and my link keeps working', async () => {
  const id = await saveSet();
  const shareToken = tokenFromUrl((await enable(id)).json.data.shareUrl);
  const result = await revoke(id, otherToken);
  assert.equal(result.status, 404);
  assert.equal(stored(id).isShared, true);
  assert.equal(stored(id).shareToken, shareToken);
  assert.equal((await publicGet(shareToken)).status, 200);
});

test('another student gets the same 404 for a set that does not exist, and a bad id is a 400', async () => {
  const missing = await enable(newId());
  assert.equal(missing.status, 404);
  assert.equal(missing.json.message, 'Saved question set not found');
  assert.equal((await enable('not-an-id')).status, 400);
  assert.equal((await revoke('not-an-id')).status, 400);
});

test('a link does not let the visitor see or change the owner\'s other sets', async () => {
  const sharedId = await saveSet();
  const privateId = await saveSet();
  const shareToken = tokenFromUrl((await enable(sharedId)).json.data.shareUrl);
  const result = await publicGet(shareToken);
  assert.equal(result.status, 200);
  assert.equal(JSON.stringify(result.json).includes(privateId), false);
  assert.equal(stored(privateId).isShared, false);
  // and the visitor (other student) cannot read the shared set through the owner-only endpoint
  assert.equal((await request('GET', `/saved-question-sets/${sharedId}`, { auth: otherToken })).status, 404);
});

test('the share body cannot smuggle in fields: the owner and the token always come from the server', async () => {
  const id = await saveSet();
  const result = await request('POST', `/saved-question-sets/${id}/share`, {
    auth: token,
    body: { shareToken: 'A'.repeat(43), isShared: false, student: OTHER_ID },
  });
  assert.equal(result.status, 200);
  const shareToken = tokenFromUrl(result.json.data.shareUrl);
  assert.notEqual(shareToken, 'A'.repeat(43));
  assert.equal(String(stored(id).student), STUDENT_ID);
  assert.equal(stored(id).isShared, true);
});

// =============================================================== read-only public endpoint

test('the public endpoint is read-only: POST, PUT, PATCH and DELETE are refused and change nothing', async () => {
  const id = await saveSet();
  const shareToken = tokenFromUrl((await enable(id)).json.data.shareUrl);
  const before = JSON.stringify(stored(id));

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const result = await request(method, `/shared/question-sets/${shareToken}`, {
      body: { title: 'hacked', questions: [], isShared: false },
      auth: token,
    });
    assert.equal(result.status, 405, method);
    assert.equal(result.headers.get('allow'), 'GET, HEAD');
    assert.equal(result.json.success, false);
  }
  assert.equal(JSON.stringify(stored(id)), before);
  assert.equal(fakeSets.count(), 1);
  assert.equal((await publicGet(shareToken)).status, 200);
});

test('a public GET never modifies the stored set', async () => {
  const id = await saveSet();
  const shareToken = tokenFromUrl((await enable(id)).json.data.shareUrl);
  const before = JSON.stringify(stored(id));
  await publicGet(shareToken);
  await publicGet(shareToken);
  assert.equal(JSON.stringify(stored(id)), before);
});

test('the shared route exposes nothing else (no listing of shared sets)', async () => {
  const id = await saveSet();
  await enable(id);
  for (const path of ['/shared', '/shared/', '/shared/question-sets', '/shared/question-sets/']) {
    const result = await request('GET', path);
    assert.equal(result.status, 404, path);
    assert.equal(result.text.includes('Data Structures'), false);
  }
});

test('two students share independently and each link shows only its own set', async () => {
  const mine = await saveSet(token);
  const theirs = await saveSet(otherToken);
  const myToken = tokenFromUrl((await enable(mine)).json.data.shareUrl);
  const theirToken = tokenFromUrl((await enable(theirs, otherToken)).json.data.shareUrl);
  assert.notEqual(myToken, theirToken);
  await revoke(mine);
  assert.equal((await publicGet(myToken)).status, 404);
  assert.equal((await publicGet(theirToken)).status, 200);
});

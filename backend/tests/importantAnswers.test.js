'use strict';

// Two-stage generation, stage 2: POST /api/questions/important/:generationId/answers
// Same approach as tests/importantQuestions.test.js: in-memory academic / paper / generated-set stand-ins, the JWT user lookup
// replaced, and the Gemini HTTP call (global fetch) replaced by a test double. Express, the auth middleware, validators,
// services, the real Gemini service and the central error handler are the real code.

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'unit-test-secret-unit-test-secret-1234567890';
process.env.MONGO_URI = 'mongodb://localhost:27017/studywise_ai_test';
process.env.GEMINI_API_KEY = 'TEST_KEY_SHOULD_NEVER_LEAK';
process.env.GEMINI_MODEL = 'gemini-3.8-flash';
process.env.GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
process.env.GEMINI_THINKING_LEVEL = 'low';
process.env.GEMINI_TIMEOUT_MS = '300';
process.env.RATE_LIMIT_MAX = '100000';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const realFetch = global.fetch;
const User = require('../models/User');
const { University, Department, Regulation, Semester, Subject, GeneratedQuestionSet } = require('../models');
const generateToken = require('../utils/generateToken');
const fakeDb = require('./helpers/fakeAcademicDb');
const fakePapers = require('./helpers/fakePaperDb');
const fakeGenerated = require('./helpers/fakeGeneratedSetDb');
const app = require('../app');

fakeDb.install();
fakePapers.install();
fakeGenerated.install();

const newId = () => new mongoose.Types.ObjectId().toString();
const STUDENT_ID = newId();
const OTHER_ID = newId();
const accounts = {
  [STUDENT_ID]: { _id: STUDENT_ID, name: 'Student', email: 'student@example.com', role: 'student', emailVerified: true },
  [OTHER_ID]: { _id: OTHER_ID, name: 'Other', email: 'other@example.com', role: 'student', emailVerified: true },
};
User.findById = async (id) => accounts[String(id)] || null;
const studentToken = generateToken(STUDENT_ID);
const otherToken = generateToken(OTHER_ID);

let geminiCalls = [];
let geminiImpl;
global.fetch = async (url, options) => {
  geminiCalls.push({ url: String(url), options });
  return geminiImpl(url, options);
};
const geminiJson = (value) => async () =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] }, finishReason: 'STOP' }] }), { status: 200 });

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

let fx; // { scope, paperId, set, ids: { mcq, short, essay } }

const makeScope = async () => {
  const university = await new University({ name: 'University of Madras', code: 'UNOM' }).save();
  const department = await new Department({ name: 'BCA', code: 'BCA', university: university._id, level: 'UG' }).save();
  const regulation = await new Regulation({ name: '2023-2024', department: department._id }).save();
  const semester = await new Semester({ semesterNumber: 1, regulation: regulation._id }).save();
  const subject = await new Subject({ name: 'Data Structures', subjectCode: 'BCA101', subjectType: 'theory', category: 'core', semester: semester._id }).save();
  return { university, department, regulation, semester, subject };
};

// A stage 1 result, stored directly: one MCQ, one short answer, one essay, none with an answer.
const makeSet = async ({ scope, paperId, owner = STUDENT_ID }) => {
  const set = await new GeneratedQuestionSet({
    student: owner,
    subject: scope.subject._id,
    semester: scope.semester._id,
    regulation: scope.regulation._id,
    papers: [paperId],
    difficulty: 'balanced',
    questions: [
      {
        questionType: 'mcq',
        marks: 2,
        difficulty: 'easy',
        question: 'Which principle does a stack follow?',
        source: 'M1',
        options: [
          { label: 'A', text: 'FIFO' },
          { label: 'B', text: 'LIFO' },
          { label: 'C', text: 'Random access' },
          { label: 'D', text: 'Priority order' },
        ],
      },
      { questionType: 'short_answer', marks: 2, difficulty: 'medium', question: 'What is a linked list?', source: 'M1' },
      { questionType: 'essay', marks: 10, difficulty: 'hard', question: 'Discuss the tree traversal techniques with examples.', source: 'M1' },
    ],
  }).save();
  const [mcq, short, essay] = set.questions.map((question) => String(question._id));
  return { set, ids: { mcq, short, essay } };
};

test.beforeEach(async () => {
  fakeDb.reset();
  fakePapers.reset();
  fakeGenerated.reset();
  geminiCalls = [];
  geminiImpl = async () => {
    throw new Error('Gemini must not be called in this test');
  };
  const scope = await makeScope();
  const paperId = fakePapers.add({ owner: STUDENT_ID, originalName: 'ds-model-paper.pdf' });
  const { set, ids } = await makeSet({ scope, paperId });
  fx = { scope, paperId, set, ids };
});

const answers = async (generationId, payload, { token = studentToken } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await realFetch(`${baseUrl}/api/questions/important/${generationId}/answers`, { method: 'POST', headers, body: JSON.stringify(payload) });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (err) {
    json = null;
  }
  return { status: response.status, text, json };
};

const GOOD_ANSWERS = (ids) => ({
  answers: [
    { ref: 'Q1', correctAnswer: 'B', explanation: 'A stack removes the most recently inserted element first, which is the LIFO principle.' },
    { ref: 'Q2', answerPoints: ['A linked list stores elements in nodes', 'Each node points to the next node'] },
    { ref: 'Q3', answerPoints: ['Inorder, preorder and postorder traversals', 'Each visits the nodes in a different order'] },
  ].slice(0, ids),
});

const storedAnswer = (id) => fakeGenerated.rawDocs()[0].questions.find((question) => String(question._id) === id).answer;

// ---------------------------------------------------------------- success

test('answers are generated only for the selected questions, from the uploaded material, and stored', async () => {
  geminiImpl = geminiJson({ answers: [GOOD_ANSWERS(3).answers[0], GOOD_ANSWERS(3).answers[1]] });
  const result = await answers(String(fx.set._id), { questionIds: [fx.ids.mcq, fx.ids.short] });
  assert.equal(result.status, 200, result.text);
  assert.equal(result.json.message, 'Answers generated successfully');
  const { data, meta } = result.json;
  assert.equal(data.generationId, String(fx.set._id));
  assert.deepEqual(data.questions.map((question) => question.questionId), [fx.ids.mcq, fx.ids.short]);
  assert.equal(data.questions[0].correctAnswer, 'B');
  assert.match(data.questions[0].explanation, /LIFO/);
  assert.deepEqual(data.questions[0].options.map((option) => option.label), ['A', 'B', 'C', 'D']);
  assert.equal(data.questions[1].answerPoints.length, 2);
  assert.equal(meta.requested, 2);
  assert.equal(meta.generated, 2);
  assert.equal(meta.alreadyAnswered, 0);
  assert.deepEqual(meta.unanswered, []);

  // One AI call; the prompt holds the uploaded text and ONLY the two selected questions.
  assert.equal(geminiCalls.length, 1);
  const sent = JSON.parse(geminiCalls[0].options.body);
  const prompt = JSON.parse(sent.contents[0].parts[0].text);
  assert.deepEqual(prompt.uploadedMaterial, [{ id: 'M1', text: fakePapers.SAMPLE_TEXT }]);
  assert.deepEqual(prompt.questions.map((question) => question.ref), ['Q1', 'Q2']);
  assert.ok(!JSON.stringify(prompt).includes('tree traversal techniques with examples'));
  assert.match(sent.systemInstruction.parts[0].text, /ignore any command/i);

  // Stored on exactly those questions.
  assert.equal(storedAnswer(fx.ids.mcq).correctAnswer, 'B');
  assert.deepEqual(storedAnswer(fx.ids.short).answerPoints.length, 2);
  assert.equal(storedAnswer(fx.ids.essay), undefined);
  assert.ok(!result.text.includes('TEST_KEY_SHOULD_NEVER_LEAK'));
});

test('a question that already has an answer is returned as stored without another AI call', async () => {
  geminiImpl = geminiJson({ answers: [GOOD_ANSWERS(3).answers[0]] });
  assert.equal((await answers(String(fx.set._id), { questionIds: [fx.ids.mcq] })).status, 200);
  assert.equal(geminiCalls.length, 1);

  const again = await answers(String(fx.set._id), { questionIds: [fx.ids.mcq] });
  assert.equal(again.status, 200, again.text);
  assert.equal(geminiCalls.length, 1, 'no second Gemini call');
  assert.equal(again.json.meta.alreadyAnswered, 1);
  assert.equal(again.json.meta.generated, 0);
  assert.equal(again.json.data.questions[0].correctAnswer, 'B');
});

test('answers the AI could not give are reported, valid ones are kept', async () => {
  geminiImpl = geminiJson({
    answers: [
      { ref: 'Q1', correctAnswer: 'B', explanation: 'A stack removes the most recently inserted element first, which is the LIFO principle.' },
      { ref: 'Q2', answerPoints: [] }, // invalid
      { ref: 'Q9', answerPoints: ['Not a requested question'] }, // unknown ref
    ],
  });
  const result = await answers(String(fx.set._id), { questionIds: [fx.ids.mcq, fx.ids.short] });
  assert.equal(result.status, 200, result.text);
  assert.equal(result.json.data.questions.length, 1);
  assert.deepEqual(result.json.meta.unanswered, [fx.ids.short]);
  assert.equal(result.json.meta.generated, 1);
  assert.ok(result.json.meta.warnings.length >= 1);
  assert.equal(storedAnswer(fx.ids.short), undefined);
});

test('an MCQ answer must name one of the stored options', async () => {
  geminiImpl = geminiJson({ answers: [{ ref: 'Q1', correctAnswer: 'E', explanation: 'A stack removes the most recently inserted element first.' }] });
  const result = await answers(String(fx.set._id), { questionIds: [fx.ids.mcq] });
  assert.equal(result.status, 502, result.text);
  assert.equal(storedAnswer(fx.ids.mcq), undefined);
});

// ---------------------------------------------------------------- ownership and validation

test('a generated set of another student is a 404 identical to a missing one, nothing is sent to Gemini', async () => {
  const foreign = await makeSet({ scope: fx.scope, paperId: fx.paperId, owner: OTHER_ID });
  const a = await answers(String(foreign.set._id), { questionIds: [foreign.ids.mcq] });
  const b = await answers(newId(), { questionIds: [fx.ids.mcq] });
  assert.equal(a.status, 404);
  assert.equal(b.status, 404);
  assert.deepEqual(a.json, b.json);
  assert.equal(geminiCalls.length, 0);
});

test('a question id that is not in the set is a 404 and nothing is sent to Gemini', async () => {
  const result = await answers(String(fx.set._id), { questionIds: [fx.ids.mcq, newId()] });
  assert.equal(result.status, 404, result.text);
  assert.deepEqual(result.json.errors.map((error) => error.field), ['questionIds[1]']);
  assert.equal(geminiCalls.length, 0);

  // A question id of someone else's set is just as unknown.
  const foreign = await makeSet({ scope: fx.scope, paperId: fx.paperId, owner: OTHER_ID });
  const crossed = await answers(String(fx.set._id), { questionIds: [foreign.ids.mcq] });
  assert.equal(crossed.status, 404);
  assert.equal(geminiCalls.length, 0);
});

test('the request body is validated before anything else', async () => {
  const id = String(fx.set._id);
  const cases = [
    [{}, ['questionIds']],
    [{ questionIds: [] }, ['questionIds']],
    [{ questionIds: 'abc' }, ['questionIds']],
    [{ questionIds: ['nope'] }, ['questionIds[0]']],
    [{ questionIds: [fx.ids.mcq, fx.ids.mcq] }, ['questionIds[1]']],
    [{ questionIds: [fx.ids.mcq], student: OTHER_ID }, ['student']],
    [{ questionIds: [fx.ids.mcq], paperIds: [fx.paperId] }, ['paperIds']],
  ];
  for (const [payload, fields] of cases) {
    const result = await answers(id, payload);
    assert.equal(result.status, 400, JSON.stringify(payload));
    assert.deepEqual(result.json.errors.map((error) => error.field), fields);
  }
  const badId = await answers('not-an-id', { questionIds: [fx.ids.mcq] });
  assert.equal(badId.status, 400);
  assert.equal(geminiCalls.length, 0);
});

test('authentication is required', async () => {
  const result = await answers(String(fx.set._id), { questionIds: [fx.ids.mcq] }, { token: null });
  assert.equal(result.status, 401);
  assert.equal(geminiCalls.length, 0);
});

// ---------------------------------------------------------------- source material and academic checks

test('the source paper must still belong to the student: otherwise 404 and no AI call', async () => {
  const foreignPaper = fakePapers.add({ owner: OTHER_ID });
  const { set, ids } = await makeSet({ scope: fx.scope, paperId: foreignPaper });
  const result = await answers(String(set._id), { questionIds: [ids.mcq] });
  assert.equal(result.status, 404, result.text);
  assert.equal(geminiCalls.length, 0);
});

test('a source paper whose extraction is not completed stops the request before the AI call', async () => {
  const paperId = fakePapers.add({ owner: STUDENT_ID, status: 'failed', text: null });
  const { set, ids } = await makeSet({ scope: fx.scope, paperId });
  const result = await answers(String(set._id), { questionIds: [ids.mcq] });
  assert.equal(result.status, 422, result.text);
  assert.equal(geminiCalls.length, 0);
});

test('the academic records are checked again: an inactive subject is refused', async () => {
  fx.scope.subject.isActive = false;
  await fx.scope.subject.save();
  const result = await answers(String(fx.set._id), { questionIds: [fx.ids.mcq] });
  assert.equal(result.status, 404, result.text);
  assert.equal(geminiCalls.length, 0);
});

test('another student cannot use someone else\'s set even with a valid token and valid ids', async () => {
  const result = await answers(String(fx.set._id), { questionIds: [fx.ids.mcq] }, { token: otherToken });
  assert.equal(result.status, 404);
  assert.equal(geminiCalls.length, 0);
});

'use strict';

// Integration tests for POST /api/questions/ask.
// Run with:  npm test
// No database, internet or real Gemini key is needed: the user lookup and the Gemini HTTP call
// are replaced by test doubles. Everything else (Express app, auth middleware, validation,
// error handler, Gemini service) is the real code.

// Environment must be set BEFORE the app (and config/env.js) is loaded.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'unit-test-secret-unit-test-secret-1234567890';
process.env.MONGO_URI = 'mongodb://localhost:27017/studywise_ai_test';
process.env.GEMINI_API_KEY = 'TEST_KEY_SHOULD_NEVER_LEAK';
// The API itself names models "models/<id>"; the service must build .../models/<id>:generateContent from it.
process.env.GEMINI_MODEL = 'models/gemini-3.8-flash';
process.env.GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
process.env.GEMINI_THINKING_LEVEL = 'low';
process.env.GEMINI_TIMEOUT_MS = '300';
process.env.RATE_LIMIT_MAX = '10000';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const realFetch = global.fetch; // used to call our own test server
const User = require('../models/User');
const generateToken = require('../utils/generateToken');
const app = require('../app');

const USER_ID = new mongoose.Types.ObjectId().toString();
User.findById = async (id) => (String(id) === USER_ID ? { _id: USER_ID, name: 'Test Student', role: 'student', emailVerified: true } : null);

const VALID_TOKEN = generateToken(USER_ID);
const FAKE_ANSWER = '## Normalization\n\n- Removes redundancy.\n- Example: split a table.';

// ----- Gemini test double -----
let geminiCalls = [];
let geminiImpl;
const geminiOk = (text = FAKE_ANSWER) => async () =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }), { status: 200 });
const geminiStatus = (status, message = 'internal detail that must not leak') => async () =>
  new Response(JSON.stringify({ error: { code: status, message, status: 'ERR' } }), { status });

global.fetch = async (url, options) => {
  geminiCalls.push({ url: String(url), options });
  return geminiImpl(url, options);
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

test.beforeEach(() => {
  geminiCalls = [];
  geminiImpl = geminiOk();
});

const ask = async (body, { token = VALID_TOKEN, rawBody } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await realFetch(`${baseUrl}/api/questions/ask`, {
    method: 'POST',
    headers,
    body: rawBody !== undefined ? rawBody : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, text, json: JSON.parse(text) };
};

const assertNoLeaks = (result) => {
  assert.ok(!result.text.includes('TEST_KEY_SHOULD_NEVER_LEAK'), 'API key leaked');
  assert.ok(!result.text.includes('internal detail that must not leak'), 'Gemini internals leaked');
  assert.equal(result.json.stack, undefined, 'stack trace leaked');
};

// 1
test('valid question returns the Gemini-generated answer', async () => {
  const result = await ask({ question: '   What is normalization in DBMS?  \n' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.json, {
    success: true,
    message: 'Answer generated successfully',
    data: { question: 'What is normalization in DBMS?', answer: FAKE_ANSWER },
  });

  assert.equal(geminiCalls.length, 1);
  const { url, options } = geminiCalls[0];
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
  assert.ok(!url.includes('TEST_KEY'), 'key must not be in the URL');
  assert.equal(options.headers['x-goog-api-key'], 'TEST_KEY_SHOULD_NEVER_LEAK');
  const sent = JSON.parse(options.body);
  assert.equal(sent.contents[0].parts[0].text, 'What is normalization in DBMS?');
  assert.equal(sent.generationConfig.temperature, undefined, 'Gemini 3 should use its default temperature');
  assert.ok(sent.systemInstruction.parts[0].text.includes('Markdown'));
  assertNoLeaks(result);
});

// 2
test('empty and whitespace-only questions are rejected', async () => {
  for (const question of ['', '   ', '\n\t  \n']) {
    const result = await ask({ question });
    assert.equal(result.status, 400, JSON.stringify(question));
    assert.equal(result.json.success, false);
    assert.equal(result.json.errors[0].field, 'question');
  }
  assert.equal(geminiCalls.length, 0);
});

// 3
test('missing question field is rejected', async () => {
  for (const body of [{}, { other: 'x' }, { question: null }]) {
    const result = await ask(body);
    assert.equal(result.status, 400);
    assert.equal(result.json.errors[0].message, 'Question is required');
  }
  const noBody = await realFetch(`${baseUrl}/api/questions/ask`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${VALID_TOKEN}` },
  });
  assert.equal(noBody.status, 400);
  assert.equal(geminiCalls.length, 0);
});

// 4
test('non-string question types are rejected', async () => {
  for (const question of [123, true, ['What is DBMS?'], { text: 'What is DBMS?' }]) {
    const result = await ask({ question });
    assert.equal(result.status, 400, JSON.stringify(question));
    assert.equal(result.json.errors[0].message, 'Question must be plain text');
  }
  assert.equal(geminiCalls.length, 0);
});

// 5
test('question over 10,000 characters is rejected; exactly 10,000 is accepted', async () => {
  const tooLong = await ask({ question: 'a'.repeat(10001) });
  assert.equal(tooLong.status, 400);
  assert.match(tooLong.json.errors[0].message, /10,000/);
  assert.equal(geminiCalls.length, 0);

  const limit = await ask({ question: 'a'.repeat(10000) });
  assert.equal(limit.status, 200);
  assert.equal(geminiCalls.length, 1);
});

// 6
test('missing JWT is rejected', async () => {
  const result = await ask({ question: 'What is DBMS?' }, { token: null });
  assert.equal(result.status, 401);
  assert.equal(result.json.success, false);
  assert.equal(geminiCalls.length, 0);
});

// 7
test('invalid JWTs are rejected', async () => {
  const wrongSecret = jwt.sign({ id: USER_ID }, 'a-completely-different-secret-value-123456');
  const unknownUser = generateToken(new mongoose.Types.ObjectId().toString());
  for (const token of ['not-a-jwt', wrongSecret, unknownUser]) {
    const result = await ask({ question: 'What is DBMS?' }, { token });
    assert.equal(result.status, 401);
    assert.equal(result.json.success, false);
  }
  assert.equal(geminiCalls.length, 0);
});

// 8
test('Gemini failures are handled without leaking details', async () => {
  const cases = [
    ['Gemini HTTP 500', geminiStatus(500), 502],
    ['invalid API key (HTTP 400 API_KEY_INVALID)', async () => new Response(JSON.stringify({ error: { code: 400, message: 'internal detail that must not leak: API key not valid', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }), { status: 400 }), 503],
    ['invalid API key (HTTP 401)', geminiStatus(401), 503],
    ['key rejected / API disabled (HTTP 403)', geminiStatus(403), 503],
    ['quota exceeded (HTTP 429)', geminiStatus(429), 503],
    ['quota exceeded (RESOURCE_EXHAUSTED)', async () => new Response(JSON.stringify({ error: { code: 429, message: 'internal detail that must not leak', status: 'RESOURCE_EXHAUSTED' } }), { status: 429 }), 503],
    ['model not found (HTTP 404)', geminiStatus(404), 502],
    ['network failure', async () => { throw new TypeError('fetch failed'); }, 502],
    [
      'timeout',
      (url, options) =>
        new Promise((resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
      504,
    ],
    ['empty candidates', async () => new Response(JSON.stringify({ candidates: [] }), { status: 200 }), 422],
    [
      'blocked prompt',
      async () => new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }), { status: 200 }),
      422,
    ],
    ['non-JSON error page', async () => new Response('<html>Bad gateway</html>', { status: 502 }), 502],
  ];

  for (const [label, impl, expectedStatus] of cases) {
    geminiImpl = impl;
    const result = await ask({ question: 'What is DBMS?' });
    assert.equal(result.status, expectedStatus, label);
    assert.equal(result.json.success, false, label);
    assert.equal(typeof result.json.message, 'string', label);
    assertNoLeaks(result);
  }
});

// 9: logs show Gemini's status and sanitized message in development, but never the key or the question.
test('error logs are useful but never contain the key or the question', async () => {
  const QUESTION = 'Explain SECRET-QUESTION-TEXT-98765 in detail';
  const FAKE_KEY_LOOKALIKE = 'AIza' + 'SyA1234567890123456789012345678901'; // built at runtime: not a real key
  const captured = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  for (const level of Object.keys(original)) console[level] = (...args) => captured.push(args.join(' '));

  let result;
  try {
    geminiImpl = async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 400,
            status: 'INVALID_ARGUMENT',
            message: `Invalid request for "${QUESTION}" using key TEST_KEY_SHOULD_NEVER_LEAK (${FAKE_KEY_LOOKALIKE})`,
          },
        }),
        { status: 400 }
      );
    result = await ask({ question: QUESTION });
  } finally {
    Object.assign(console, original);
  }

  assert.equal(result.status, 502);
  const logs = captured.join('\n');
  assert.match(logs, /HTTP 400 INVALID_ARGUMENT/);
  assert.match(logs, /model gemini-3\.8-flash/);
  assert.match(logs, /API version v1beta/);
  assert.ok(!logs.includes('TEST_KEY_SHOULD_NEVER_LEAK'), 'key in logs');
  assert.ok(!logs.includes('AIzaSy'), 'key-like value in logs');
  assert.ok(!logs.includes('SECRET-QUESTION-TEXT'), 'question text in logs');
  assertNoLeaks(result);
});

// 10: a model that rejects thinkingLevel is retried once without it instead of failing the question.
test('a model that rejects the thinking setting is retried once without it', async () => {
  geminiImpl = async (url, options) => {
    if (JSON.parse(options.body).generationConfig.thinkingConfig) {
      return new Response(
        JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Thinking level is not supported for this model.' } }),
        { status: 400 }
      );
    }
    return geminiOk()();
  };
  const result = await ask({ question: 'What is DBMS?' });
  assert.equal(result.status, 200);
  assert.equal(result.json.data.answer, FAKE_ANSWER);
  assert.equal(geminiCalls.length, 2);
  assert.equal(JSON.parse(geminiCalls[1].options.body).generationConfig.thinkingConfig, undefined);
});

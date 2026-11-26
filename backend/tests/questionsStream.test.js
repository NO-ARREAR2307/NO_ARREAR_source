'use strict';

// Integration tests for POST /api/questions/ask/stream (Server-Sent Events).
// Run with:  npm test
// No database, internet or real Gemini key is needed: the user lookup and the Gemini HTTP call are
// replaced by test doubles. Everything else (Express app, auth middleware, validation, error
// handler, Gemini service, streaming controller) is the real code.

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'unit-test-secret-unit-test-secret-1234567890';
process.env.MONGO_URI = 'mongodb://localhost:27017/studywise_ai_test';
process.env.GEMINI_API_KEY = 'TEST_KEY_SHOULD_NEVER_LEAK';
// Pin every Gemini setting the assertions depend on: dotenv would otherwise load the real .env values.
process.env.GEMINI_MODEL = 'gemini-3.8-flash';
process.env.GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
process.env.GEMINI_THINKING_LEVEL = 'low';
process.env.GEMINI_TIMEOUT_MS = '700';
process.env.RATE_LIMIT_MAX = '10000';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const realFetch = global.fetch; // used by the test client; global.fetch is replaced for the Gemini call
const User = require('../models/User');
const generateToken = require('../utils/generateToken');
const app = require('../app');

const USER_ID = new mongoose.Types.ObjectId().toString();
User.findById = async (id) => (String(id) === USER_ID ? { _id: USER_ID, name: 'Test Student', role: 'student', emailVerified: true } : null);
const VALID_TOKEN = generateToken(USER_ID);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const chunk = (text, extra = {}) => ({ candidates: [{ content: { parts: [{ text }] }, ...extra }] });

// ----- Gemini test double -----
let geminiCalls = [];
let geminiImpl;
let upstreamAborted = 0;

// Builds an SSE Response from steps: { data, delay } | { raw, delay } | { drop: true } | { stall: true }.
// When the caller aborts (the service does this on client disconnect or timeout) the stream errors out.
const sseResponse = (steps, signal) => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let dead = false;
      const onAbort = () => {
        dead = true;
        upstreamAborted += 1;
        try {
          controller.error(new DOMException('aborted', 'AbortError'));
        } catch (err) {
          /* already closed */
        }
      };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      for (const step of steps) {
        if (step.delay) await sleep(step.delay);
        if (dead) return;
        if (step.drop) {
          controller.error(new TypeError('terminated'));
          return;
        }
        if (step.stall) return; // never closes: the service must time out
        controller.enqueue(encoder.encode(step.raw !== undefined ? step.raw : `data: ${JSON.stringify(step.data)}\r\n\r\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};

const jsonError = (status, error) => async () => new Response(JSON.stringify({ error }), { status });

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
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});
test.beforeEach(() => {
  geminiCalls = [];
  upstreamAborted = 0;
  geminiImpl = async (url, options) =>
    sseResponse([{ data: chunk('Hello ') }, { data: chunk('world', { finishReason: 'STOP' }) }], options.signal);
});

const post = (body, { token = VALID_TOKEN, signal } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return realFetch(`${baseUrl}/api/questions/ask/stream`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    signal,
  });
};

// Reads an SSE response incrementally. Returns [{ event, data, at }] with arrival times in ms.
const readSse = async (response, { stopAfter } = {}) => {
  const events = [];
  const started = Date.now();
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const bytes of response.body) {
    buffer += decoder.decode(bytes, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (block.startsWith(':')) continue; // keep-alive comment
      const event = /^event: (.*)$/m.exec(block)[1];
      const data = JSON.parse(/^data: (.*)$/m.exec(block)[1]);
      events.push({ event, data, at: Date.now() - started });
      if (stopAfter && stopAfter(events)) return events;
    }
  }
  return events;
};

const assertNoLeaks = (text) => {
  assert.ok(!text.includes('TEST_KEY_SHOULD_NEVER_LEAK'), 'API key leaked');
  assert.ok(!text.includes('internal detail that must not leak'), 'Gemini internals leaked');
  assert.ok(!/"stack"/.test(text), 'stack trace leaked');
};

test('streams progressive SSE events with the right headers, order and content', async () => {
  geminiImpl = async (url, options) =>
    sseResponse(
      [
        // the first event is split mid-JSON and mid-CRLF to exercise the parser
        { raw: `data: ${JSON.stringify(chunk('## DBMS\n'))}`.slice(0, 25) },
        { raw: `data: ${JSON.stringify(chunk('## DBMS\n'))}`.slice(25) + '\r', delay: 30 },
        { raw: '\n\r\n', delay: 30 },
        { data: chunk('A database '), delay: 150 },
        { data: chunk('system.', { finishReason: 'STOP' }), delay: 150 },
        { data: { usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 9 } } },
      ],
      options.signal
    );

  const response = await post({ question: '  What is DBMS?  ' });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/event-stream/);
  assert.match(response.headers.get('cache-control'), /no-cache/);
  assert.equal(response.headers.get('x-accel-buffering'), 'no');

  const events = await readSse(response);
  assert.deepEqual(events.map((e) => e.event), ['start', 'chunk', 'chunk', 'chunk', 'done']);
  assert.equal(events[0].data.question, 'What is DBMS?');
  const chunks = events.filter((e) => e.event === 'chunk');
  assert.equal(chunks.map((c) => c.data.text).join(''), '## DBMS\nA database system.');
  assert.ok(chunks[2].at - chunks[0].at >= 150, 'chunks must arrive progressively, not all at the end');
  assert.deepEqual(events.at(-1).data, {
    success: true,
    message: 'Answer generated successfully',
    data: { finishReason: 'STOP', chunks: 3, characters: 26, truncated: false },
  });

  const { url, options } = geminiCalls[0];
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse');
  assert.ok(!url.includes('TEST_KEY'), 'key must not be in the URL');
  assert.equal(options.headers['x-goog-api-key'], 'TEST_KEY_SHOULD_NEVER_LEAK');
  assert.equal(JSON.parse(options.body).contents[0].parts[0].text, 'What is DBMS?');
});

test('requires authentication', async () => {
  const wrongSecret = jwt.sign({ id: USER_ID }, 'a-completely-different-secret-value-123456');
  for (const token of [null, 'not-a-jwt', wrongSecret]) {
    const response = await post({ question: 'What is DBMS?' }, { token });
    assert.equal(response.status, 401);
    assert.match(response.headers.get('content-type'), /json/);
    assert.equal((await response.json()).success, false);
  }
  assert.equal(geminiCalls.length, 0);
});

test('rejects invalid questions with a JSON 400 and never calls Gemini', async () => {
  for (const body of [{ question: '' }, { question: '   ' }, {}, { question: 5 }, { question: ['a'] }, { question: 'a'.repeat(10001) }]) {
    const response = await post(body);
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 40));
    assert.match(response.headers.get('content-type'), /json/);
    assert.equal((await response.json()).errors[0].field, 'question');
  }
  assert.equal(geminiCalls.length, 0);
});

test('Gemini failures before the answer starts return a normal JSON error', async () => {
  const leaky = 'internal detail that must not leak';
  const cases = [
    ['invalid key', jsonError(400, { code: 400, status: 'INVALID_ARGUMENT', message: leaky, details: [{ reason: 'API_KEY_INVALID' }] }), 503],
    ['key rejected', jsonError(403, { code: 403, status: 'PERMISSION_DENIED', message: leaky }), 503],
    ['quota', jsonError(429, { code: 429, status: 'RESOURCE_EXHAUSTED', message: leaky }), 503],
    ['server error', jsonError(500, { code: 500, status: 'INTERNAL', message: leaky }), 502],
    ['model not found', jsonError(404, { code: 404, status: 'NOT_FOUND', message: leaky }), 502],
    ['network failure', async () => { throw new TypeError('fetch failed'); }, 502],
    ['blocked prompt', async (url, options) => sseResponse([{ data: { promptFeedback: { blockReason: 'SAFETY' } } }], options.signal), 422],
    ['empty answer', async (url, options) => sseResponse([{ data: { candidates: [{ finishReason: 'STOP' }] } }], options.signal), 422],
    [
      'timeout before the first response',
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
  ];
  for (const [label, impl, expectedStatus] of cases) {
    geminiImpl = impl;
    const response = await post({ question: 'What is DBMS?' });
    const text = await response.text();
    assert.equal(response.status, expectedStatus, label);
    assert.match(response.headers.get('content-type'), /application\/json/, label);
    assert.equal(JSON.parse(text).success, false, label);
    assertNoLeaks(text);
  }
});

test('a Gemini failure after streaming started is sent as an "error" event and the stream ends', async () => {
  const leaky = 'internal detail that must not leak';
  const cases = [
    [
      'error inside the stream',
      (url, options) => sseResponse([{ data: chunk('partial ') }, { data: { error: { code: 503, status: 'UNAVAILABLE', message: leaky } }, delay: 30 }], options.signal),
      502,
    ],
    ['connection dropped', (url, options) => sseResponse([{ data: chunk('partial ') }, { drop: true, delay: 30 }], options.signal), 502],
    ['stall until the timeout', (url, options) => sseResponse([{ data: chunk('partial ') }, { stall: true }], options.signal), 504],
  ];
  for (const [label, impl, expectedStatus] of cases) {
    geminiImpl = impl;
    const response = await post({ question: 'What is DBMS?' });
    assert.equal(response.status, 200, label);
    const events = await readSse(response);
    assert.deepEqual(events.map((e) => e.event), ['start', 'chunk', 'error'], label);
    const failure = events.at(-1).data;
    assert.equal(failure.success, false, label);
    assert.equal(failure.status, expectedStatus, label);
    assertNoLeaks(JSON.stringify(failure));
  }
});

test('a client that disconnects mid-stream cancels the request to Gemini', async () => {
  geminiImpl = (url, options) =>
    sseResponse([{ data: chunk('first ') }, { data: chunk('second '), delay: 400 }, { data: chunk('third', { finishReason: 'STOP' }), delay: 400 }], options.signal);

  const controller = new AbortController();
  const response = await post({ question: 'What is DBMS?' }, { signal: controller.signal });
  await readSse(response, { stopAfter: (events) => events.some((e) => e.event === 'chunk') });
  controller.abort();

  for (let i = 0; i < 40 && upstreamAborted === 0; i += 1) await sleep(50);
  assert.equal(upstreamAborted, 1, 'the request to Gemini was not cancelled');
});

test('the existing JSON endpoint still works', async () => {
  geminiImpl = async () =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'JSON answer' }] }, finishReason: 'STOP' }] }), { status: 200 });
  const response = await realFetch(`${baseUrl}/api/questions/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${VALID_TOKEN}` },
    body: JSON.stringify({ question: 'What is DBMS?' }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    message: 'Answer generated successfully',
    data: { question: 'What is DBMS?', answer: 'JSON answer' },
  });
  assert.ok(geminiCalls[0].url.includes(':generateContent') && !geminiCalls[0].url.includes('stream'));
});

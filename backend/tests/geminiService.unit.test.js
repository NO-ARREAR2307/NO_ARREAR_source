'use strict';

// Unit tests for the pure helpers in services/geminiService.js (no network, database or Express).
// Run with:  npm test

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'unit-test-secret-unit-test-secret-1234567890';
process.env.MONGO_URI = 'mongodb://localhost:27017/studywise_ai_test';
process.env.GEMINI_API_KEY = 'TEST_KEY_SHOULD_NEVER_LEAK';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSseParser, sanitizeForLog } = require('../services/geminiService');

const feed = (pieces) => {
  const parser = createSseParser();
  const out = [];
  pieces.forEach((piece) => out.push(...parser.push(piece)));
  out.push(...parser.flush());
  return out;
};

test('SSE parser: several events in one piece, LF and CRLF', () => {
  assert.deepEqual(feed(['data: {"a":1}\n\ndata: {"a":2}\r\n\r\n']), ['{"a":1}', '{"a":2}']);
});

test('SSE parser: an event split anywhere (mid-JSON, mid-CRLF) is reassembled', () => {
  const whole = 'data: {"text":"héllo wörld"}\r\n\r\n';
  for (let cut = 1; cut < whole.length; cut += 1) {
    assert.deepEqual(feed([whole.slice(0, cut), whole.slice(cut)]), ['{"text":"héllo wörld"}'], `cut at ${cut}`);
  }
  assert.deepEqual(feed(whole.split('')), ['{"text":"héllo wörld"}'], 'one character at a time');
});

test('SSE parser: comments, event:/id: lines and blank noise are ignored; final event without blank line is flushed', () => {
  assert.deepEqual(feed([': keep-alive\n\nevent: message\nid: 7\ndata: {"x":1}\n\n\n\ndata: {"x":2}']), ['{"x":1}', '{"x":2}']);
});

test('SSE parser: multi-line data fields are joined with a newline', () => {
  assert.deepEqual(feed(['data: line1\ndata: line2\n\n']), ['line1\nline2']);
});

test('log sanitizer removes the key, key-like values, tokens, the question and fragments of it', () => {
  const question = 'Explain the SECRET-QUESTION-TEXT topic';
  const keyLookalike = 'AIza' + 'SyA1234567890123456789012345678901'; // built at runtime: not a real key
  const dirty = `bad request: "${question}" key=TEST_KEY_SHOULD_NEVER_LEAK ${keyLookalike} Bearer abc.def.ghi; fragment SECRET-QUESTION-TEXT only`;
  const clean = sanitizeForLog(dirty, question);
  assert.ok(!clean.includes('TEST_KEY_SHOULD_NEVER_LEAK'));
  assert.ok(!clean.includes('AIzaSy'));
  assert.ok(!clean.includes('abc.def.ghi'));
  assert.ok(!clean.includes('SECRET-QUESTION-TEXT'));
  assert.ok(clean.includes('bad request'), 'unrelated text is kept');
});

test('log sanitizer truncates long text and keeps short unrelated messages intact', () => {
  assert.equal(sanitizeForLog('model not found', 'What is DBMS?'), 'model not found');
  assert.ok(sanitizeForLog('x'.repeat(5000), 'q').length <= 300);
});

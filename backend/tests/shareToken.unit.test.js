'use strict';

// Unit tests for utils/shareToken.js (Phase 4.3A). No database, network or Express app needed.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { SHARE_TOKEN_PATTERN, generateShareToken, isWellFormedShareToken, hashShareToken, redactShareTokens } = require('../utils/shareToken');

test('generateShareToken: 43 URL-safe characters (256 bits), always well formed', () => {
  for (let i = 0; i < 50; i += 1) {
    const token = generateShareToken();
    assert.equal(token.length, 43);
    assert.match(token, SHARE_TOKEN_PATTERN);
    assert.equal(isWellFormedShareToken(token), true);
    assert.equal(Buffer.from(token, 'base64url').length, 32, 'decodes to 32 random bytes');
  }
});

test('generateShareToken: tokens are unique (no repeats in 5000 draws) and not derived from the time or a counter', () => {
  const seen = new Set();
  for (let i = 0; i < 5000; i += 1) seen.add(generateShareToken());
  assert.equal(seen.size, 5000);
  // Two tokens made one after the other share no long prefix (a sequential or time-based scheme would).
  const a = generateShareToken();
  const b = generateShareToken();
  assert.notEqual(a.slice(0, 8), b.slice(0, 8));
});

test('hashShareToken: SHA-256 hex, deterministic, different tokens give different hashes, and the hash is not the token', () => {
  const token = generateShareToken();
  const hash = hashShareToken(token);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, crypto.createHash('sha256').update(token).digest('hex'));
  assert.equal(hashShareToken(token), hash);
  assert.notEqual(hashShareToken(generateShareToken()), hash);
  assert.ok(!hash.includes(token));
});

test('isWellFormedShareToken: refuses anything that is not exactly 43 base64url characters', () => {
  const good = generateShareToken();
  const bad = [
    undefined, null, 42, {}, [], ['a'.repeat(43)], true,
    '', ' ', good.slice(1), `${good}a`, `${good} `, ` ${good}`, `${good}\n`,
    'a'.repeat(42), 'a'.repeat(44),
    `${good.slice(0, 42)}+`, `${good.slice(0, 42)}/`, `${good.slice(0, 42)}=`, `${good.slice(0, 42)}.`,
    '../'.repeat(15), '%2e%2e%2f'.repeat(5), "a'; DROP TABLE--".padEnd(43, 'a'), '$ne'.padEnd(43, 'a'), '{"$ne":null}'.padEnd(43, 'a'),
  ];
  bad.forEach((value) => assert.equal(isWellFormedShareToken(value), false, `must refuse ${JSON.stringify(value)}`));
  assert.equal(isWellFormedShareToken(good), true);
  assert.equal(isWellFormedShareToken('A'.repeat(43)), true);
  assert.equal(isWellFormedShareToken('-_'.repeat(21) + '-'), true);
});

test('redactShareTokens: hides the token of a shared URL in log text and leaves everything else alone', () => {
  const token = generateShareToken();
  assert.equal(redactShareTokens(`/api/shared/materials/${token}`), '/api/shared/materials/[redacted]');
  assert.equal(redactShareTokens(`/api/shared/materials/${token}/file?download=true`), '/api/shared/materials/[redacted]/file?download=true');
  assert.equal(redactShareTokens(`/api/shared/question-sets/${token}`), '/api/shared/question-sets/[redacted]');
  assert.equal(redactShareTokens(`GET /api/shared/materials/${token} -> 404: Route not found: GET /api/shared/materials/${token}/x`), 'GET /api/shared/materials/[redacted] -> 404: Route not found: GET /api/shared/materials/[redacted]/x');
  // A malformed but long token-like segment is hidden too.
  assert.equal(redactShareTokens('/api/shared/materials/' + 'x'.repeat(60)), '/api/shared/materials/[redacted]');
  ['/api/papers/664f1a2b3c4d5e6f7a8b9c0d/share', '/api/papers', '/api/shared/materials/short', '', undefined, null].forEach((text) => {
    assert.equal(redactShareTokens(text), text === undefined || text === null ? '' : text);
  });
});

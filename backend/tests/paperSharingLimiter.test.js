'use strict';

// Phase 4.3A: the public study material links are rate limited per IP, so tokens cannot be tried at speed.
// Own file (own process) because the limit is read from the environment when the app is loaded.

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'unit-test-secret-unit-test-secret-1234567890';
process.env.MONGO_URI = 'mongodb://localhost:27017/studywise_ai_test';
process.env.RATE_LIMIT_MAX = '100000';
process.env.SHARED_ACCESS_LIMIT_MAX = '5';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fake = require('./helpers/fakePaperStore');
const app = require('../app');

fake.install();

let server;
let baseUrl;
test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('guessing tokens is slowed down: after the per-IP limit every request answers 429, wrong tokens included', async () => {
  const statuses = [];
  for (let i = 0; i < 8; i += 1) {
    const token = crypto.randomBytes(32).toString('base64url');
    const response = await fetch(`${baseUrl}/api/shared/materials/${token}`);
    statuses.push(response.status);
    if (response.status === 429) assert.equal((await response.json()).success, false);
  }
  assert.deepEqual(statuses, [404, 404, 404, 404, 404, 429, 429, 429]);
});

test('the limit does not apply to the private API or to the Phase 2C question-set links', async () => {
  const response = await fetch(`${baseUrl}/api/papers`);
  assert.equal(response.status, 401, 'still the normal login check, not 429');
  const set = await fetch(`${baseUrl}/api/shared/question-sets/${crypto.randomBytes(32).toString('base64url')}`);
  assert.equal(set.status, 404);
});

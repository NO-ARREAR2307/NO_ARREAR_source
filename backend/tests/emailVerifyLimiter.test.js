'use strict';

// The per-IP limiter on POST /api/auth/verify-email (separate file: the limit is read when the app loads).
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'unit-test-secret-unit-test-secret-1234567890';
process.env.MONGO_URI = 'mongodb://localhost:27017/studywise_ai_test';
process.env.RATE_LIMIT_MAX = '10000';
process.env.OTP_VERIFY_LIMIT_MAX = '3';

const test = require('node:test');
const assert = require('node:assert/strict');

const User = require('../models/User');
const app = require('../app');

User.findOne = async () => null; // every request is a plain "wrong / unknown" 400 until the limiter steps in

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

test('verify-email is limited per IP: the 4th request in the window is 429', async () => {
  const post = (path, body) =>
    fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  for (let i = 0; i < 3; i += 1) {
    assert.equal((await post('/api/auth/verify-email', { email: 'a@example.com', otp: '123456' })).status, 400);
  }
  const limited = await post('/api/auth/verify-email', { email: 'a@example.com', otp: '123456' });
  assert.equal(limited.status, 429);
  assert.match((await limited.json()).message, /too many verification attempts/i);

  // Other endpoints are not affected by this limiter.
  assert.equal((await post('/api/auth/login', {})).status, 400);
});

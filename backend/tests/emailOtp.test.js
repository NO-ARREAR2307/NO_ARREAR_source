'use strict';

// Tests for Phase 0B Part 1: student email OTP generation and sending.
// Run with:  npm test
// No database, internet or real Brevo account is needed: the EmailOtp/User database calls and the
// SMTP transport are replaced by test doubles. Everything else (Express app, controller, OTP
// service, e-mail message building, rate limiter, error handler) is the real code.

// Environment must be set BEFORE the app (and config/env.js) is loaded.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'unit-test-secret-unit-test-secret-1234567890';
process.env.MONGO_URI = 'mongodb://localhost:27017/studywise_ai_test';
process.env.RATE_LIMIT_MAX = '10000';
process.env.BREVO_SMTP_USER = 'test-login@smtp-brevo.com';
process.env.BREVO_SMTP_PASS = 'SMTP_KEY_SHOULD_NEVER_LEAK';
process.env.EMAIL_FROM_ADDRESS = 'no-reply@studywise.test';
process.env.OTP_RESEND_COOLDOWN_SECONDS = '60';
process.env.OTP_RESEND_LIMIT_MAX = '1000';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const User = require('../models/User');
const EmailOtp = require('../models/EmailOtp');
const emailService = require('../services/emailService');
const otpService = require('../services/otpService');
const { config } = require('../config/env');
const app = require('../app');

// ----- database doubles -----
let createdDocs;
let usersByEmail;
User.exists = async () => null;
User.create = async (doc) => {
  createdDocs.push(doc);
  const user = new User(doc);
  usersByEmail[user.email] = user;
  return user;
};
User.findOne = async (filter) => usersByEmail[filter.email] || null;

// One EmailOtp document per user, with the same atomic rule as the real filter:
// "match only when lastSentAt <= cutoff, otherwise try to insert -> duplicate key".
let otpStore;
EmailOtp.findOneAndUpdate = async (filter, update) => {
  const key = String(filter.user);
  const existing = otpStore.get(key);
  if (existing) {
    if (!(existing.lastSentAt <= filter.lastSentAt.$lte)) {
      const error = new Error('E11000 duplicate key error');
      error.code = 11000;
      throw error;
    }
    Object.assign(existing, update.$set);
    return existing;
  }
  const doc = { user: key, ...update.$set };
  otpStore.set(key, doc);
  return doc;
};
EmailOtp.findOne = async (filter) => otpStore.get(String(filter.user)) || null;
EmailOtp.deleteOne = async (filter) => {
  const existing = otpStore.get(String(filter.user));
  if (existing && existing.otpHash === filter.otpHash) otpStore.delete(String(filter.user));
};

// ----- SMTP transport double -----
let sentMails;
let sendImpl;
const okSend = async (message) => {
  sentMails.push(message);
  return { accepted: [message.to] };
};
emailService._setTransportForTests({ sendMail: (message) => sendImpl(message) });

// ----- helpers -----
let server;
let baseUrl;
const realLog = { log: console.log, info: console.info, warn: console.warn, error: console.error };
let captured;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test.beforeEach(() => {
  createdDocs = [];
  usersByEmail = {};
  otpStore = new Map();
  sentMails = [];
  sendImpl = okSend;
  captured = [];
  for (const level of Object.keys(realLog)) {
    console[level] = (...args) => captured.push(args.map(String).join(' '));
  }
});

test.afterEach(() => {
  Object.assign(console, realLog);
});

const call = async (path, { method = 'POST', body } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, text, json: JSON.parse(text), headers: response.headers };
};

const registerBody = (overrides = {}) => ({
  name: 'Asha',
  email: 'asha@example.com',
  password: 'password123',
  course: 'B.Tech',
  department: 'CSE',
  semester: 3,
  ...overrides,
});

// The code is only visible inside the sent email.
const otpFromMail = (mail) => {
  const match = mail.text.match(/\n(\d{6})\n/);
  assert.ok(match, 'the email must contain a 6-digit code');
  return match[1];
};

const storedFor = (email) => otpStore.get(String(usersByEmail[email]._id));

// ---------- generation and hashing ----------

test('generated codes are always 6 digits (leading zeros kept)', () => {
  let startsWithZero = 0;
  for (let i = 0; i < 5000; i += 1) {
    const otp = otpService.generateOtp();
    assert.match(otp, /^\d{6}$/);
    if (otp.startsWith('0')) startsWithZero += 1;
  }
  assert.ok(startsWithZero > 0, 'zero-padding must work');
});

test('hashOtp is a keyed, per-user hash that does not contain the code', () => {
  const a = new mongoose.Types.ObjectId().toString();
  const b = new mongoose.Types.ObjectId().toString();
  const hash = otpService.hashOtp(a, '123456');
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, otpService.hashOtp(a, '123456'), 'deterministic for the same user and code');
  assert.notEqual(hash, otpService.hashOtp(b, '123456'), 'different user, different hash');
  assert.notEqual(hash, otpService.hashOtp(a, '123457'), 'different code, different hash');
  assert.ok(!hash.includes('123456'));
  // Not a plain SHA-256 of the code: without the server key the hash cannot be recomputed.
  const plain = require('crypto').createHash('sha256').update('123456').digest('hex');
  assert.notEqual(hash, plain);
});

test('the OTP model has no field that could hold the plain code', () => {
  const paths = Object.keys(EmailOtp.schema.paths);
  assert.ok(paths.includes('otpHash'));
  assert.ok(!paths.some((p) => p !== 'otpHash' && /^(otp|code|plain)/i.test(p)));
  assert.equal(EmailOtp.schema.paths.otpHash.options.select, false);
});

// ---------- registration ----------

test('registration creates an unverified student, stores only a hash and emails the code', async () => {
  const before = Date.now();
  const result = await call('/api/auth/register', { body: registerBody({ emailVerified: true }) });

  assert.equal(result.status, 201);
  assert.equal(createdDocs[0].emailVerified, false, 'a body value must not make the account verified');
  assert.equal(result.json.user.emailVerified, false);
  assert.equal(result.json.emailVerification.otpSent, true);
  assert.equal(result.json.emailVerification.expiresInSeconds, 300);
  assert.equal(result.json.emailVerification.resendCooldownSeconds, 60);
  assert.equal(result.json.emailVerification.sentTo, 'a***@example.com');

  assert.equal(sentMails.length, 1);
  const mail = sentMails[0];
  assert.equal(mail.to, 'asha@example.com');
  assert.equal(mail.from.address, 'no-reply@studywise.test');
  assert.match(mail.subject, /verification code/i);
  assert.match(mail.text, /5 minutes/);
  const otp = otpFromMail(mail);
  assert.ok(mail.html.includes(otp));

  const stored = storedFor('asha@example.com');
  assert.equal(stored.otpHash, otpService.hashOtp(usersByEmail['asha@example.com']._id, otp));
  assert.ok(!Object.values(stored).some((v) => String(v).includes(otp)), 'the plain code is not stored');
  const lifetime = stored.expiresAt.getTime() - stored.lastSentAt.getTime();
  assert.equal(lifetime, 5 * 60 * 1000, 'expires exactly 5 minutes after it was issued');
  assert.ok(stored.lastSentAt.getTime() >= before);

  // Never in the API response ...
  assert.ok(!result.text.includes(otp), 'the code must not appear in the response');
  assert.ok(!result.text.includes(stored.otpHash), 'the hash must not appear in the response');
  assert.ok(!/otp(?!Sent)/i.test(JSON.stringify(Object.keys(result.json.emailVerification))), 'no otp field');
  // ... and never in the logs.
  assert.ok(!captured.join('\n').includes(otp), 'the code must not appear in the logs');
});

test('registration still succeeds (otpSent false) when the email cannot be sent, and no code is left behind', async () => {
  sendImpl = async () => {
    const error = new Error('535 5.7.8 Authentication failed for SMTP_KEY_SHOULD_NEVER_LEAK');
    error.code = 'EAUTH';
    error.responseCode = 535;
    error.command = 'AUTH PLAIN';
    throw error;
  };
  const result = await call('/api/auth/register', { body: registerBody() });

  assert.equal(result.status, 201);
  assert.equal(result.json.emailVerification.otpSent, false);
  assert.equal(result.json.token, undefined, 'no JWT before the email is verified (Part 2)');
  assert.equal(otpStore.size, 0, 'an unsent code is removed so the student can retry at once');
  const everything = result.text + captured.join('\n');
  assert.ok(!everything.includes('SMTP_KEY_SHOULD_NEVER_LEAK'), 'credentials and SMTP replies must not leak');
  assert.ok(captured.join('\n').includes('EAUTH'), 'the cause code is logged for the operator');
});

test('registration still succeeds when Brevo is not configured', async () => {
  const saved = { ...config.email };
  Object.assign(config.email, { user: '', pass: '', fromAddress: '' });
  try {
    const result = await call('/api/auth/register', { body: registerBody() });
    assert.equal(result.status, 201);
    assert.equal(result.json.emailVerification.otpSent, false);
    assert.equal(sentMails.length, 0);
    assert.equal(emailService.isEmailConfigured(), false);
  } finally {
    Object.assign(config.email, saved);
  }
});

test('registration validation still works and sends nothing for invalid input', async () => {
  const result = await call('/api/auth/register', { body: registerBody({ password: 'short' }) });
  assert.equal(result.status, 400);
  assert.equal(sentMails.length, 0);
});

// ---------- resend ----------

test('resend inside the cooldown -> 429 with retryAfterSeconds, nothing sent, old code stays valid', async () => {
  await call('/api/auth/register', { body: registerBody() });
  const firstHash = storedFor('asha@example.com').otpHash;

  const result = await call('/api/auth/resend-otp', { body: { email: 'asha@example.com' } });
  assert.equal(result.status, 429);
  assert.equal(result.json.success, false);
  assert.ok(result.json.retryAfterSeconds >= 1 && result.json.retryAfterSeconds <= 60);
  assert.equal(result.headers.get('retry-after'), String(result.json.retryAfterSeconds));
  assert.equal(sentMails.length, 1, 'no second email');
  assert.equal(storedFor('asha@example.com').otpHash, firstHash, 'the earlier code was not touched');
});

test('resend after the cooldown issues a new code and invalidates the previous one', async () => {
  await call('/api/auth/register', { body: registerBody() });
  const user = usersByEmail['asha@example.com'];
  const firstOtp = otpFromMail(sentMails[0]);
  const firstHash = storedFor('asha@example.com').otpHash;

  storedFor('asha@example.com').lastSentAt = new Date(Date.now() - 61 * 1000); // cooldown over

  const result = await call('/api/auth/resend-otp', { body: { email: 'ASHA@example.com ' } });
  assert.equal(result.status, 200);
  assert.equal(result.json.success, true);
  assert.equal(sentMails.length, 2);

  const secondOtp = otpFromMail(sentMails[1]);
  const stored = storedFor('asha@example.com');
  assert.equal(otpStore.size, 1, 'still exactly one active code per student');
  assert.notEqual(stored.otpHash, firstHash, 'the old hash was replaced');
  assert.equal(stored.otpHash, otpService.hashOtp(user._id, secondOtp));
  if (firstOtp !== secondOtp) {
    assert.notEqual(stored.otpHash, otpService.hashOtp(user._id, firstOtp), 'the old code no longer matches');
  }
  assert.ok(stored.expiresAt.getTime() - Date.now() > 4 * 60 * 1000, 'the new code has a fresh 5-minute lifetime');
  assert.ok(!result.text.includes(secondOtp));
  assert.ok(!captured.join('\n').includes(secondOtp));

  // and the cooldown applies again right away
  assert.equal((await call('/api/auth/resend-otp', { body: { email: 'asha@example.com' } })).status, 429);
});

test('two simultaneous resends after the cooldown send exactly one email', async () => {
  await call('/api/auth/register', { body: registerBody() });
  storedFor('asha@example.com').lastSentAt = new Date(Date.now() - 61 * 1000);

  const [a, b] = await Promise.all([
    call('/api/auth/resend-otp', { body: { email: 'asha@example.com' } }),
    call('/api/auth/resend-otp', { body: { email: 'asha@example.com' } }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 429]);
  assert.equal(sentMails.length, 2, 'registration email + exactly one resend');
});

test('a failed resend removes the unsent code so the student can retry immediately', async () => {
  await call('/api/auth/register', { body: registerBody() });
  storedFor('asha@example.com').lastSentAt = new Date(Date.now() - 61 * 1000);
  sendImpl = async () => {
    const error = new Error('connect ETIMEDOUT 1.2.3.4:587');
    error.code = 'ETIMEDOUT';
    throw error;
  };
  const failed = await call('/api/auth/resend-otp', { body: { email: 'asha@example.com' } });
  assert.equal(failed.status, 502);
  assert.equal(otpStore.size, 0);

  sendImpl = okSend;
  const retry = await call('/api/auth/resend-otp', { body: { email: 'asha@example.com' } });
  assert.equal(retry.status, 200);
  assert.equal(sentMails.length, 2);
});

test('resend answers 503 when Brevo is not configured', async () => {
  await call('/api/auth/register', { body: registerBody() });
  storedFor('asha@example.com').lastSentAt = new Date(Date.now() - 61 * 1000);
  const saved = { ...config.email };
  Object.assign(config.email, { user: '', pass: '', fromAddress: '' });
  try {
    const result = await call('/api/auth/resend-otp', { body: { email: 'asha@example.com' } });
    assert.equal(result.status, 503);
  } finally {
    Object.assign(config.email, saved);
  }
});

test('resend does not reveal unknown, verified or admin accounts and sends nothing for them', async () => {
  usersByEmail['done@example.com'] = new User({ name: 'Done', email: 'done@example.com', password: 'password123', emailVerified: true });
  usersByEmail['boss@example.com'] = new User({ name: 'Boss', email: 'boss@example.com', password: 'password123', role: 'admin' });

  const unknown = await call('/api/auth/resend-otp', { body: { email: 'nobody@example.com' } });
  const verified = await call('/api/auth/resend-otp', { body: { email: 'done@example.com' } });
  const admin = await call('/api/auth/resend-otp', { body: { email: 'boss@example.com' } });

  for (const result of [unknown, verified, admin]) assert.equal(result.status, 200);
  assert.deepEqual(unknown.json, verified.json);
  assert.deepEqual(unknown.json, admin.json);
  assert.equal(sentMails.length, 0);
  assert.equal(otpStore.size, 0);
});

test('resend validates the email', async () => {
  assert.equal((await call('/api/auth/resend-otp', { body: {} })).status, 400);
  assert.equal((await call('/api/auth/resend-otp', { body: { email: 'not-an-email' } })).status, 400);
  assert.equal((await call('/api/auth/resend-otp', { body: { email: { $ne: '' } } })).status, 400);
  assert.equal(sentMails.length, 0);
});

// ---------- email content / model ----------

test('the email escapes the student name in HTML', () => {
  const mail = emailService.buildOtpMessage({ to: 'x@example.com', name: '<script>alert(1)</script>', otp: '012345', expiresInMinutes: 5 });
  assert.ok(!mail.html.includes('<script>'));
  assert.ok(mail.html.includes('&lt;script&gt;'));
  assert.ok(mail.text.includes('012345'));
});

test('new User documents default to emailVerified false (also for accounts created before the field existed)', () => {
  assert.equal(new User({ name: 'X', email: 'x@example.com', password: 'password123' }).emailVerified, false);
});

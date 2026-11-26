'use strict';

// Tests for Phase 0B Part 2: OTP verification, attempt limits and "verified students only".
// Run with:  npm test
// No database, internet or real Brevo account is needed: the User/EmailOtp database calls and the Brevo
// transport are replaced by in-memory test doubles that follow the same rules as the real queries
// (filters with $gt / $not $gte, atomic $inc, atomic find-and-delete). Everything else (Express app,
// controller, OTP service, auth middleware, role middleware, error handler) is the real code.

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'unit-test-secret-unit-test-secret-1234567890';
process.env.MONGO_URI = 'mongodb://localhost:27017/studywise_ai_test';
process.env.RATE_LIMIT_MAX = '10000';
process.env.BREVO_API_KEY = 'xkeysib-API_KEY_SHOULD_NEVER_LEAK';
process.env.EMAIL_FROM_ADDRESS = 'no-reply@studywise.test';
process.env.OTP_RESEND_COOLDOWN_SECONDS = '60';
process.env.OTP_RESEND_LIMIT_MAX = '1000';
process.env.OTP_MAX_ATTEMPTS = '5';
process.env.OTP_VERIFY_LIMIT_MAX = '10000';

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const User = require('../models/User');
const EmailOtp = require('../models/EmailOtp');
const emailService = require('../services/emailService');
const otpService = require('../services/otpService');
const { config, validateEnv } = require('../config/env');
const app = require('../app');

// ----- User double -----
let usersByEmail;
let userUpdates;
const asQuery = (value) => {
  const promise = Promise.resolve(value);
  promise.select = () => promise; // login uses .select('+password')
  return promise;
};
User.exists = async () => null;
User.create = async (doc) => {
  const user = new User({ ...doc, password: bcrypt.hashSync(doc.password, 4) });
  usersByEmail[user.email] = user;
  return user;
};
User.findOne = (filter) => asQuery(usersByEmail[filter.email] || null);
User.findById = async (id) => Object.values(usersByEmail).find((u) => String(u._id) === String(id)) || null;
User.updateOne = async (filter, update) => {
  userUpdates.push({ filter, update });
  const user = Object.values(usersByEmail).find((u) => String(u._id) === String(filter._id));
  if (user && update.$set) Object.assign(user, update.$set);
  return { modifiedCount: user ? 1 : 0 };
};

// ----- EmailOtp double (one document per user; each method runs atomically, like one MongoDB operation) -----
let otpStore;
EmailOtp.findOneAndUpdate = async (filter, update) => {
  const key = String(filter.user);
  const existing = otpStore.get(key);

  if (filter.lastSentAt) {
    // issue / resend: match only when the previous code is older than the cooldown, else insert -> duplicate key
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
  }

  // verify: count an attempt, only while unexpired and attempts < max (a missing field counts as 0)
  if (!existing) return null;
  if (!(existing.expiresAt > filter.expiresAt.$gt)) return null;
  if ((existing.attempts || 0) >= filter.attempts.$not.$gte) return null;
  existing.attempts = (existing.attempts || 0) + update.$inc.attempts;
  return { ...existing };
};
EmailOtp.findOneAndDelete = async (filter) => {
  const key = String(filter.user);
  const existing = otpStore.get(key);
  if (!existing || existing.otpHash !== filter.otpHash || !(existing.expiresAt > filter.expiresAt.$gt)) return null;
  otpStore.delete(key);
  return existing;
};
EmailOtp.findOne = async (filter) => otpStore.get(String(filter.user)) || null;
EmailOtp.deleteOne = async (filter) => {
  const existing = otpStore.get(String(filter.user));
  if (existing && existing.otpHash === filter.otpHash) otpStore.delete(String(filter.user));
};

// ----- Brevo transport double -----
let sentMails;
emailService._setTransportForTests({
  sendMail: async (message) => {
    sentMails.push(message);
    return { accepted: [message.to] };
  },
});

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
  usersByEmail = {};
  userUpdates = [];
  otpStore = new Map();
  sentMails = [];
  captured = [];
  for (const level of Object.keys(realLog)) console[level] = (...args) => captured.push(args.map(String).join(' '));
});
test.afterEach(() => Object.assign(console, realLog));

const call = async (path, { method = 'POST', body, token } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, text, json: JSON.parse(text), headers: response.headers };
};

const EMAIL = 'asha@example.com';
const PASSWORD = 'password123';
const registerBody = (overrides = {}) => ({ name: 'Asha', email: EMAIL, password: PASSWORD, course: 'B.Tech', department: 'CSE', semester: 3, ...overrides });
const otpFromMail = (mail) => mail.text.match(/\n(\d{6})\n/)[1];
const stored = () => otpStore.get(String(usersByEmail[EMAIL]._id));
const verify = (otp, email = EMAIL) => call('/api/auth/verify-email', { body: { email, otp } });
const wrongCode = (real) => (real === '000000' ? '111111' : '000000');

// Registers the student and returns the code from the e-mail.
const registerStudent = async () => {
  const result = await call('/api/auth/register', { body: registerBody() });
  assert.equal(result.status, 201);
  return otpFromMail(sentMails[sentMails.length - 1]);
};

// ---------- successful verification ----------

test('a correct code verifies the student, is used up, and issues the first JWT', async () => {
  const otp = await registerStudent();
  assert.equal(usersByEmail[EMAIL].emailVerified, false);

  const result = await verify(otp);
  assert.equal(result.status, 200);
  assert.equal(result.json.success, true);
  assert.equal(result.json.user.emailVerified, true);
  assert.equal(result.json.user.password, undefined);
  assert.ok(result.json.token);
  assert.equal(usersByEmail[EMAIL].emailVerified, true, 'the flag is set on the account');
  assert.deepEqual(userUpdates[0].update, { $set: { emailVerified: true } });
  assert.equal(otpStore.size, 0, 'the code is removed once used');

  // The token works now.
  assert.equal((await call('/api/auth/profile', { method: 'GET', token: result.json.token })).status, 200);
  // The code and its hash never appear in the answer or in the logs.
  assert.ok(!result.text.includes(otp));
  assert.ok(!captured.join('\n').includes(otp));
});

test('the email is matched case-insensitively and with surrounding spaces; the code may have spaces around it', async () => {
  const otp = await registerStudent();
  const result = await verify(` ${otp} `, '  ASHA@Example.com ');
  assert.equal(result.status, 200);
});

test('a code works only once', async () => {
  const otp = await registerStudent();
  assert.equal((await verify(otp)).status, 200);
  const again = await verify(otp);
  assert.equal(again.status, 400);
  assert.match(again.json.message, /invalid or expired/i);
  assert.equal(again.json.token, undefined);
});

test('two simultaneous requests with the same correct code: exactly one succeeds', async () => {
  const otp = await registerStudent();
  const results = await Promise.all([verify(otp), verify(otp), verify(otp)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400, 400]);
  assert.equal(userUpdates.length, 1);
});

// ---------- expiry ----------

test('a code older than 5 minutes is refused even when it is correct', async () => {
  const otp = await registerStudent();
  stored().expiresAt = new Date(Date.now() - 1000); // just expired (MongoDB cleanup may not have run yet)
  const result = await verify(otp);
  assert.equal(result.status, 400);
  assert.match(result.json.message, /invalid or expired/i);
  assert.equal(usersByEmail[EMAIL].emailVerified, false);
  assert.equal(userUpdates.length, 0);
});

test('a code that is 4 minutes old still works; the lifetime is exactly 5 minutes', async () => {
  const otp = await registerStudent();
  assert.equal(stored().expiresAt.getTime() - stored().lastSentAt.getTime(), 5 * 60 * 1000);
  stored().expiresAt = new Date(Date.now() + 60 * 1000); // 4 minutes have passed
  assert.equal((await verify(otp)).status, 200);
});

// ---------- wrong codes and the attempt limit ----------

test('wrong codes are refused and count down the attempts; the 5th wrong guess locks the code', async () => {
  const otp = await registerStudent();
  const bad = wrongCode(otp);

  for (let remaining = 4; remaining >= 1; remaining -= 1) {
    const result = await verify(bad);
    assert.equal(result.status, 400);
    assert.equal(result.json.attemptsRemaining, remaining);
    assert.match(result.json.message, /incorrect/i);
  }
  const last = await verify(bad);
  assert.equal(last.status, 429);
  assert.match(last.json.message, /too many incorrect attempts/i);
  assert.equal(stored().attempts, 5);

  // Locked: even the CORRECT code is refused now and is not consumed.
  const locked = await verify(otp);
  assert.equal(locked.status, 429);
  assert.equal(usersByEmail[EMAIL].emailVerified, false);
  assert.equal(otpStore.size, 1);
  assert.equal(stored().attempts, 5, 'a locked code does not count further attempts');
});

test('the correct code still works before the limit is reached, after some wrong guesses', async () => {
  const otp = await registerStudent();
  assert.equal((await verify(wrongCode(otp))).status, 400);
  assert.equal((await verify(wrongCode(otp))).status, 400);
  assert.equal((await verify(otp)).status, 200);
});

test('many parallel guesses cannot exceed the attempt limit', async () => {
  const otp = await registerStudent();
  const guesses = Array.from({ length: 30 }, (_, i) => String(100000 + i)).filter((g) => g !== otp);
  const results = await Promise.all(guesses.map((g) => verify(g)));

  assert.ok(results.every((r) => r.status === 400 || r.status === 429));
  assert.equal(stored().attempts, 5, 'only 5 guesses were ever compared');
  assert.equal(results.filter((r) => r.status === 400).length, 4, 'four "wrong code" answers, then locked');
  // And the code is locked for the correct value too.
  assert.equal((await verify(otp)).status, 429);
});

test('requesting a new code resets the attempts and replaces the old code', async () => {
  const otp = await registerStudent();
  for (let i = 0; i < 5; i += 1) await verify(wrongCode(otp));
  assert.equal((await verify(otp)).status, 429);

  // The resend cooldown still applies to a locked code ...
  assert.equal((await call('/api/auth/resend-otp', { body: { email: EMAIL } })).status, 429);
  // ... and once it is over a new code unlocks the account.
  stored().lastSentAt = new Date(Date.now() - 61 * 1000);
  assert.equal((await call('/api/auth/resend-otp', { body: { email: EMAIL } })).status, 200);
  assert.equal(stored().attempts, 0);

  const newOtp = otpFromMail(sentMails[sentMails.length - 1]);
  if (newOtp !== otp) assert.equal((await verify(otp)).status, 400, 'the old code no longer works');
  assert.equal((await verify(newOtp)).status, 200);
});

test('a code document created before the attempts field existed still works and is counted', async () => {
  const otp = await registerStudent();
  delete stored().attempts;
  assert.equal((await verify(wrongCode(otp))).status, 400);
  assert.equal(stored().attempts, 1);
  assert.equal((await verify(otp)).status, 200);
});

// ---------- input validation ----------

test('invalid input is rejected with 400 and never touches the stored code', async () => {
  const otp = await registerStudent();
  const bodies = [
    {},
    { email: EMAIL },
    { otp },
    { email: 'not-an-email', otp },
    { email: EMAIL, otp: '' },
    { email: EMAIL, otp: '12345' },
    { email: EMAIL, otp: '1234567' },
    { email: EMAIL, otp: '12345a' },
    { email: EMAIL, otp: 123456 },
    { email: EMAIL, otp: { $ne: '' } },
    { email: EMAIL, otp: [otp] },
    { email: { $ne: '' }, otp },
  ];
  for (const body of bodies) {
    const result = await call('/api/auth/verify-email', { body });
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.equal(result.json.success, false);
  }
  assert.equal(stored().attempts || 0, 0, 'validation errors do not use up attempts');
  assert.equal(usersByEmail[EMAIL].emailVerified, false);
});

// ---------- no account enumeration ----------

test('unknown, already verified, admin and code-less accounts all get the same answer', async () => {
  const hash = bcrypt.hashSync(PASSWORD, 4);
  usersByEmail['done@example.com'] = new User({ name: 'Done', email: 'done@example.com', password: hash, emailVerified: true });
  usersByEmail['boss@example.com'] = new User({ name: 'Boss', email: 'boss@example.com', password: hash, role: 'admin' });
  usersByEmail['nocode@example.com'] = new User({ name: 'NoCode', email: 'nocode@example.com', password: hash });

  const results = await Promise.all(
    ['nobody@example.com', 'done@example.com', 'boss@example.com', 'nocode@example.com'].map((email) => verify('123456', email))
  );
  for (const result of results) {
    assert.equal(result.status, 400);
    assert.deepEqual(result.json, results[0].json);
  }
  assert.equal(userUpdates.length, 0);
  assert.equal(usersByEmail['boss@example.com'].emailVerified, false, 'verify-email never changes an admin');
});

// ---------- only verified students get in ----------

test('registration issues no JWT', async () => {
  const result = await call('/api/auth/register', { body: registerBody() });
  assert.equal(result.status, 201);
  assert.equal(result.json.token, undefined);
  assert.equal(result.json.user.emailVerified, false);
  assert.equal(result.json.emailVerification.required, true);
});

test('an unverified student cannot log in: 403 EMAIL_NOT_VERIFIED and no token', async () => {
  await registerStudent();
  const result = await call('/api/auth/login', { body: { email: EMAIL, password: PASSWORD } });
  assert.equal(result.status, 403);
  assert.equal(result.json.code, 'EMAIL_NOT_VERIFIED');
  assert.equal(result.json.token, undefined);
  assert.equal(result.json.user, undefined);
  assert.ok(!/token/i.test(result.text.replace(/EMAIL_NOT_VERIFIED/g, '')) || result.json.token === undefined);
});

test('the verification status is only revealed to someone who knows the password', async () => {
  await registerStudent();
  const wrongPassword = await call('/api/auth/login', { body: { email: EMAIL, password: 'wrong-password' } });
  const unknown = await call('/api/auth/login', { body: { email: 'nobody@example.com', password: 'wrong-password' } });
  assert.equal(wrongPassword.status, 401);
  assert.deepEqual(wrongPassword.json, unknown.json, 'no hint that the account exists or is unverified');
});

test('an unverified student cannot use a JWT either (for example one issued before this rule)', async () => {
  await registerStudent();
  const token = require('../utils/generateToken')(usersByEmail[EMAIL]._id);
  for (const path of ['/api/auth/profile', '/api/admin/access-check']) {
    const result = await call(path, { method: 'GET', token });
    assert.equal(result.status, 403);
    assert.equal(result.json.code, 'EMAIL_NOT_VERIFIED');
  }
});

test('full flow: register -> login refused -> verify -> login works', async () => {
  const otp = await registerStudent();
  assert.equal((await call('/api/auth/login', { body: { email: EMAIL, password: PASSWORD } })).status, 403);

  const verified = await verify(otp);
  assert.equal(verified.status, 200);

  const login = await call('/api/auth/login', { body: { email: EMAIL, password: PASSWORD } });
  assert.equal(login.status, 200);
  assert.ok(login.json.token);
  assert.equal(login.json.user.emailVerified, true);
  assert.equal((await call('/api/auth/profile', { method: 'GET', token: login.json.token })).status, 200);
});

test('a student verified before this rule keeps working; a legacy account without the flag must verify', async () => {
  const hash = bcrypt.hashSync(PASSWORD, 4);
  usersByEmail['ok@example.com'] = new User({ name: 'Ok', email: 'ok@example.com', password: hash, emailVerified: true });
  usersByEmail['old@example.com'] = new User({ name: 'Old', email: 'old@example.com', password: hash });
  assert.equal((await call('/api/auth/login', { body: { email: 'ok@example.com', password: PASSWORD } })).status, 200);
  const old = await call('/api/auth/login', { body: { email: 'old@example.com', password: PASSWORD } });
  assert.equal(old.status, 403);
  // The way out: ask for a code, then verify.
  assert.equal((await call('/api/auth/resend-otp', { body: { email: 'old@example.com' } })).status, 200);
  const otp = otpFromMail(sentMails[sentMails.length - 1]);
  assert.equal((await verify(otp, 'old@example.com')).status, 200);
  assert.equal((await call('/api/auth/login', { body: { email: 'old@example.com', password: PASSWORD } })).status, 200);
});

// ---------- the admin is never locked out ----------

test('an existing admin (no emailVerified flag, never verified) can still log in and use admin routes', async () => {
  const hash = bcrypt.hashSync('a-long-admin-password', 4);
  const admin = new User({ name: 'Boss', email: 'boss@example.com', password: hash, role: 'admin' });
  assert.equal(admin.emailVerified, false, 'the admin account is NOT verified, and must not need to be');
  usersByEmail['boss@example.com'] = admin;

  const login = await call('/api/auth/login', { body: { email: 'boss@example.com', password: 'a-long-admin-password' } });
  assert.equal(login.status, 200);
  assert.ok(login.json.token);
  assert.equal(login.json.user.role, 'admin');

  const access = await call('/api/admin/access-check', { method: 'GET', token: login.json.token });
  assert.equal(access.status, 200);
  assert.equal((await call('/api/auth/profile', { method: 'GET', token: login.json.token })).status, 200);
});

test('verified students still cannot reach admin routes (authorization is unchanged)', async () => {
  const otp = await registerStudent();
  const { json } = await verify(otp);
  assert.equal((await call('/api/admin/access-check', { method: 'GET', token: json.token })).status, 403);
});

// ---------- configuration ----------

test('OTP_MAX_ATTEMPTS and OTP_VERIFY_LIMIT_MAX are validated at start-up', () => {
  assert.equal(config.emailOtp.maxAttempts, 5);
  const saved = { a: process.env.OTP_MAX_ATTEMPTS, v: process.env.OTP_VERIFY_LIMIT_MAX };
  try {
    for (const bad of ['2', '11', 'abc', '3.5']) {
      process.env.OTP_MAX_ATTEMPTS = bad;
      assert.ok(validateEnv().some((p) => p.startsWith('OTP_MAX_ATTEMPTS')), `OTP_MAX_ATTEMPTS=${bad}`);
    }
    process.env.OTP_MAX_ATTEMPTS = '5';
    process.env.OTP_VERIFY_LIMIT_MAX = '0';
    assert.ok(validateEnv().some((p) => p.startsWith('OTP_VERIFY_LIMIT_MAX')));
    process.env.OTP_VERIFY_LIMIT_MAX = '20';
    assert.ok(!validateEnv().some((p) => p.startsWith('OTP_')));
  } finally {
    process.env.OTP_MAX_ATTEMPTS = saved.a;
    process.env.OTP_VERIFY_LIMIT_MAX = saved.v;
  }
});

test('the OTP model keeps the attempt counter and still holds no plain code', () => {
  assert.ok(Object.keys(EmailOtp.schema.paths).includes('attempts'));
  assert.equal(EmailOtp.schema.paths.attempts.options.default, 0);
  assert.equal(EmailOtp.schema.paths.otpHash.options.select, false);
});

'use strict';

// Focused tests for the password reset flow (forgot-password -> verify-reset-otp -> reset-password).
//
// They run with Node's built-in runner (`node --test tests/passwordReset.test.js`) and need no database or
// network: the Mongoose models, the config, the email sender and the HTTP libraries are replaced by small
// in-memory fakes BEFORE the real controller / service / route files are loaded. The real code under test is:
// controllers/authController.js, services/passwordResetService.js, services/emailService.js (message builder)
// and routes/authRoutes.js. The fakes implement exactly the MongoDB operators those files use ($set, $unset,
// $inc, $lte, $gt, $not/$gte, upsert + unique index).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.join(__dirname, '..');
const abs = (p) => require.resolve(path.join(root, p));
const Module = require('node:module');
const stub = (id, exports) => {
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
// Third-party packages that the loaded files require but that these tests never exercise.
const routerCalls = [];
const fakeThirdParty = {
  express: { Router: () => ({ post: (...a) => routerCalls.push(['post', ...a]), get: (...a) => routerCalls.push(['get', ...a]) }) },
  'express-rate-limit': { rateLimit: (opts) => Object.assign(() => {}, { opts }) },
  jsonwebtoken: { sign: (payload) => `jwt-for-${payload.id}` },
};
const originalLoad = Module._load;
Module._load = function patched(request, ...rest) {
  if (/(^|[\\/])config[\\/]env$/.test(request)) return { config: CONFIG }; // the test configuration below
  if (Object.prototype.hasOwnProperty.call(fakeThirdParty, request)) return fakeThirdParty[request];
  return originalLoad.call(this, request, ...rest);
};

// ---------- fakes ----------
const CONFIG = {
  isProduction: false,
  jwt: { secret: 'test-jwt-secret', expiresIn: '1h' },
  rateLimit: { windowMs: 60000, max: 100 },
  extraction: { userLimitWindowMs: 60000, userLimitMax: 5 },
  bcryptSaltRounds: 4,
  email: { host: 'smtp.test', port: 587, user: 'u', pass: 'p', fromAddress: 'noreply@test.dev', fromName: 'Test', timeoutMs: 1000 },
  emailOtp: {
    hashSecret: 'test-otp-secret',
    resendCooldownSeconds: 60,
    maxAttempts: 5,
    resendLimitWindowMs: 60000,
    resendLimitMax: 10,
    verifyLimitWindowMs: 60000,
    verifyLimitMax: 10,
  },
};

const matches = (value, cond) => {
  if (cond && typeof cond === 'object' && !(cond instanceof Date) && !(cond instanceof Array)) {
    return Object.entries(cond).every(([op, arg]) => {
      if (op === '$lte') return value <= arg;
      if (op === '$gt') return value > arg;
      if (op === '$gte') return value >= arg;
      if (op === '$not') return !matches(value, arg);
      throw new Error(`fake does not support ${op}`);
    });
  }
  return String(value) === String(cond);
};
const docMatches = (doc, filter) => Object.entries(filter).every(([k, c]) => matches(doc[k], c));

class FakePasswordReset {
  static docs = [];
  static reset() { FakePasswordReset.docs = []; }
  static async findOne(filter) { return FakePasswordReset.docs.find((d) => docMatches(d, filter)) || null; }
  static async findOneAndUpdate(filter, update, opts = {}) {
    let doc = FakePasswordReset.docs.find((d) => docMatches(d, filter));
    if (!doc) {
      if (!opts.upsert) return null;
      const userId = filter.user;
      if (FakePasswordReset.docs.some((d) => String(d.user) === String(userId))) {
        const err = new Error('E11000 duplicate key'); err.code = 11000; throw err; // unique index on user
      }
      doc = { user: userId, stage: 'otp', attempts: 0 };
      FakePasswordReset.docs.push(doc);
    }
    Object.assign(doc, update.$set || {});
    Object.entries(update.$inc || {}).forEach(([k, n]) => { doc[k] = (doc[k] || 0) + n; });
    Object.keys(update.$unset || {}).forEach((k) => { delete doc[k]; });
    return { ...doc };
  }
  static async findOneAndDelete(filter) {
    const i = FakePasswordReset.docs.findIndex((d) => docMatches(d, filter));
    return i === -1 ? null : FakePasswordReset.docs.splice(i, 1)[0];
  }
  static async deleteOne(filter) {
    const i = FakePasswordReset.docs.findIndex((d) => docMatches(d, filter));
    if (i !== -1) FakePasswordReset.docs.splice(i, 1);
  }
}

class FakeUser {
  static users = [];
  static add(fields) {
    const u = Object.assign(new FakeUser(), { _id: `u${FakeUser.users.length + 1}`, role: 'student', emailVerified: true, name: 'Test Student', password: 'old-hash', saves: 0 }, fields);
    FakeUser.users.push(u);
    return u;
  }
  static findOne({ email }) {
    const found = FakeUser.users.find((u) => u.email === email) || null;
    const q = Promise.resolve(found);
    q.select = () => q;
    return q;
  }
  async save() { this.saves += 1; }
}
stub(abs('models/User.js'), FakeUser);
stub(abs('models/PasswordReset.js'), FakePasswordReset);
stub(abs('models/EmailOtp.js'), {});


const ApiError = require(abs('utils/ApiError.js'));
const emailService = require(abs('services/emailService.js'));

const sent = [];
let failNextSend = false;
stub(abs('services/emailService.js'), {
  ...emailService,
  sendOtpEmail: async (args) => {
    if (failNextSend) {
      failNextSend = false;
      throw new ApiError(502, 'send failed');
    }
    sent.push(args);
  },
});

const controller = require(abs('controllers/authController.js'));
const otpService = require(abs('services/otpService.js'));

// ---------- helpers ----------
const call = async (handler, body) => {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  try {
    await handler({ body }, res);
    return { res };
  } catch (error) {
    return { error };
  }
};

const EMAIL = 'student@example.com';
let user;
test.beforeEach((t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 0, 1, 12, 0, 0) });
  FakePasswordReset.reset();
  FakeUser.users = [];
  sent.length = 0;
  failNextSend = false;
  user = FakeUser.add({ email: EMAIL });
});
const advance = (t, ms) => t.mock.timers.tick(ms);

const requestCode = async () => {
  const out = await call(controller.forgotPassword, { email: EMAIL });
  assert.ifError(out.error);
  return sent[sent.length - 1].otp;
};
const verifyCode = (otp) => call(controller.verifyResetOtp, { email: EMAIL, otp });
const getToken = async (t) => {
  const otp = await requestCode();
  const out = await verifyCode(otp);
  assert.ifError(out.error);
  return out.res.body.resetToken;
};

// ---------- forgot-password ----------
test('forgot-password emails a 6-digit reset code and never returns it', async () => {
  const { res, error } = await call(controller.forgotPassword, { email: `  ${EMAIL.toUpperCase()} ` });
  assert.ifError(error);
  assert.equal(res.statusCode, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, EMAIL);
  assert.equal(sent[0].purpose, 'password-reset');
  assert.match(sent[0].otp, /^\d{6}$/);
  assert.equal(sent[0].expiresInMinutes, 5);
  assert.equal(res.body.data.expiresInSeconds, 300);
  assert.equal(res.body.data.resendCooldownSeconds, 60);
  assert.ok(!JSON.stringify(res.body).includes(sent[0].otp));
  // only a keyed hash is stored
  const stored = JSON.stringify(FakePasswordReset.docs);
  assert.ok(!stored.includes(sent[0].otp));
  assert.equal(FakePasswordReset.docs[0].otpHash.length, 64);
});

test('forgot-password gives the same answer for unknown and unverified accounts and sends nothing', async () => {
  const known = await call(controller.forgotPassword, { email: EMAIL });
  sent.length = 0;
  FakePasswordReset.reset();
  FakeUser.add({ email: 'new@example.com', emailVerified: false });
  const unknown = await call(controller.forgotPassword, { email: 'nobody@example.com' });
  const unverified = await call(controller.forgotPassword, { email: 'new@example.com' });
  assert.equal(sent.length, 0);
  assert.equal(FakePasswordReset.docs.length, 0);
  assert.deepEqual(unknown.res.body, known.res.body);
  assert.deepEqual(unverified.res.body, known.res.body);
});

test('forgot-password validates the email', async () => {
  for (const body of [undefined, {}, { email: '' }, { email: 'nope' }, { email: 42 }]) {
    const { error } = await call(controller.forgotPassword, body);
    assert.equal(error.statusCode, 400);
    assert.equal(error.details[0].field, 'email');
  }
});

test('resend protection: a second request inside the cooldown gets 429 with retryAfterSeconds, then works', async (t) => {
  await requestCode();
  advance(t, 20 * 1000);
  const early = await call(controller.forgotPassword, { email: EMAIL });
  assert.equal(early.error.statusCode, 429);
  assert.equal(early.error.retryAfterSeconds, 40);
  assert.equal(sent.length, 1);

  advance(t, 40 * 1000);
  const first = sent[0].otp;
  const ok = await call(controller.forgotPassword, { email: EMAIL });
  assert.ifError(ok.error);
  assert.equal(sent.length, 2);
  // the previous code was invalidated by the new one (unless both happen to be equal, 1 in a million)
  if (first !== sent[1].otp) assert.equal((await verifyCode(first)).error.statusCode, 400);
});

test('if the email cannot be sent the code is removed so the user can retry immediately', async () => {
  failNextSend = true;
  const failed = await call(controller.forgotPassword, { email: EMAIL });
  assert.equal(failed.error.statusCode, 502);
  assert.equal(FakePasswordReset.docs.length, 0);
  const retry = await call(controller.forgotPassword, { email: EMAIL });
  assert.ifError(retry.error);
  assert.equal(sent.length, 1);
});

// ---------- verify-reset-otp ----------
test('verify-reset-otp validates the input format', async () => {
  for (const otp of [undefined, '', '12345', '1234567', 'abcdef', 123456]) {
    const { error } = await call(controller.verifyResetOtp, { email: EMAIL, otp });
    assert.equal(error.statusCode, 400);
    assert.equal(error.details[0].field, 'otp');
  }
  assert.equal((await call(controller.verifyResetOtp, { email: 'bad', otp: '123456' })).error.details[0].field, 'email');
});

test('a correct code returns a one-time reset token and is consumed', async () => {
  const otp = await requestCode();
  const { res, error } = await verifyCode(otp);
  assert.ifError(error);
  assert.equal(res.statusCode, 200);
  assert.match(res.body.resetToken, /^[0-9a-f]{64}$/);
  assert.equal(res.body.data.resetToken, res.body.resetToken);
  assert.equal(res.body.data.expiresInSeconds, 600);
  // neither the code nor the token is stored in plain text, and the code hash is gone
  const stored = JSON.stringify(FakePasswordReset.docs);
  assert.ok(!stored.includes(res.body.resetToken));
  assert.equal(FakePasswordReset.docs[0].otpHash, undefined);
  assert.equal(FakePasswordReset.docs[0].stage, 'verified');
  // the code cannot be used a second time
  assert.equal((await verifyCode(otp)).error.statusCode, 400);
});

test('wrong codes are counted and the code locks after the maximum attempts', async () => {
  const otp = await requestCode();
  const wrong = otp === '000000' ? '111111' : '000000';
  const first = await verifyCode(wrong);
  assert.equal(first.error.statusCode, 400);
  assert.equal(first.error.attemptsRemaining, 4);
  for (let i = 0; i < 3; i += 1) await verifyCode(wrong);
  const last = await verifyCode(wrong);
  assert.equal(last.error.statusCode, 429);
  // locked: even the correct code is refused until a new one is requested
  assert.equal((await verifyCode(otp)).error.statusCode, 429);
});

test('an expired code (older than 5 minutes) is rejected', async (t) => {
  const otp = await requestCode();
  advance(t, 5 * 60 * 1000 + 1000);
  assert.equal((await verifyCode(otp)).error.statusCode, 400);
});

test('verify-reset-otp does not reveal unknown, unverified or code-less accounts', async () => {
  FakeUser.add({ email: 'new@example.com', emailVerified: false });
  for (const email of ['nobody@example.com', 'new@example.com', EMAIL]) {
    const { error } = await call(controller.verifyResetOtp, { email, otp: '123456' });
    assert.equal(error.statusCode, 400);
    assert.match(error.message, /Invalid or expired/);
  }
});

// ---------- reset-password ----------
test('full flow: the token lets the user set a new password, which is assigned in plain text for the hashing hook', async (t) => {
  const token = await getToken(t);
  const { res, error } = await call(controller.resetPassword, { email: EMAIL, resetToken: token, password: 'BrandNewPass1' });
  assert.ifError(error);
  assert.equal(res.statusCode, 200);
  assert.equal(user.password, 'BrandNewPass1'); // models/User.js pre('save') bcrypt-hashes it on save()
  assert.equal(user.saves, 1);
  assert.equal(FakePasswordReset.docs.length, 0);
});

test('the reset token is single use', async (t) => {
  const token = await getToken(t);
  await call(controller.resetPassword, { email: EMAIL, resetToken: token, password: 'BrandNewPass1' });
  const again = await call(controller.resetPassword, { email: EMAIL, resetToken: token, password: 'AnotherPass22' });
  assert.equal(again.error.statusCode, 400);
  assert.equal(user.password, 'BrandNewPass1');
  assert.equal(user.saves, 1);
});

test('newPassword is accepted as an alias and a leftover otp field is ignored', async (t) => {
  const token = await getToken(t);
  const { error } = await call(controller.resetPassword, { email: EMAIL, otp: '123456', resetToken: token, newPassword: 'AliasPass123' });
  assert.ifError(error);
  assert.equal(user.password, 'AliasPass123');
});

test('invalid, wrong-user and expired tokens are rejected and the password is untouched', async (t) => {
  const token = await getToken(t);
  const other = FakeUser.add({ email: 'other@example.com' });

  for (const bad of ['0'.repeat(64), 'short', token.toUpperCase()]) {
    const out = await call(controller.resetPassword, { email: EMAIL, resetToken: bad, password: 'BrandNewPass1' });
    assert.equal(out.error.statusCode, 400);
  }
  const wrongUser = await call(controller.resetPassword, { email: 'other@example.com', resetToken: token, password: 'BrandNewPass1' });
  assert.equal(wrongUser.error.statusCode, 400);
  assert.equal(other.saves, 0);

  advance(t, 10 * 60 * 1000 + 1000);
  const expired = await call(controller.resetPassword, { email: EMAIL, resetToken: token, password: 'BrandNewPass1' });
  assert.equal(expired.error.statusCode, 400);
  assert.equal(user.password, 'old-hash');
  assert.equal(user.saves, 0);
});

test('a token is not accepted before the code was verified, and a new request invalidates an old token', async (t) => {
  await requestCode();
  const early = await call(controller.resetPassword, { email: EMAIL, resetToken: 'a'.repeat(64), password: 'BrandNewPass1' });
  assert.equal(early.error.statusCode, 400);

  const otp = sent.at(-1).otp;
  const goodToken = (await verifyCode(otp)).res.body.resetToken;
  advance(t, 61 * 1000); // past the resend cooldown
  await requestCode(); // a new forgot-password request replaces the verified record
  const stale = await call(controller.resetPassword, { email: EMAIL, resetToken: goodToken, password: 'BrandNewPass1' });
  assert.equal(stale.error.statusCode, 400);
  assert.equal(user.saves, 0);
});

test('weak or malformed passwords are rejected without using up the token', async (t) => {
  const token = await getToken(t);
  const cases = [
    [undefined, 'password'], ['', 'password'], ['short', 'password'], ['é'.repeat(37), 'password'], [12345678, 'password'],
  ];
  for (const [password, field] of cases) {
    const out = await call(controller.resetPassword, { email: EMAIL, resetToken: token, password });
    assert.equal(out.error.statusCode, 400);
    assert.equal(out.error.details[0].field, field);
  }
  assert.equal((await call(controller.resetPassword, { email: EMAIL, password: 'BrandNewPass1' })).error.details[0].field, 'resetToken');
  assert.equal(user.saves, 0);
  // the token still works afterwards
  const ok = await call(controller.resetPassword, { email: EMAIL, resetToken: token, password: 'BrandNewPass1' });
  assert.ifError(ok.error);
});

test('admins can reset their password too (they are exempt from email verification)', async (t) => {
  const admin = FakeUser.add({ email: 'admin@example.com', role: 'admin', emailVerified: false });
  const out = await call(controller.forgotPassword, { email: admin.email });
  assert.ifError(out.error);
  assert.equal(sent.at(-1).to, admin.email);
});

// ---------- email message + routes ----------
test('the reset email has its own wording; the verification email is unchanged', () => {
  const base = { to: 'a@b.co', name: 'Asha', otp: '123456', expiresInMinutes: 5 };
  const verification = emailService.buildOtpMessage(base);
  assert.equal(verification.subject, 'Your STUDYWISE AI verification code');
  assert.match(verification.text, /verify your email address/);
  const reset = emailService.buildOtpMessage({ ...base, purpose: 'password-reset' });
  assert.equal(reset.subject, 'Your STUDYWISE AI password reset code');
  assert.match(reset.text, /reset your STUDYWISE AI password/);
  assert.match(reset.text, /123456/);
});

test('the three routes are registered with rate limiters, next to the existing auth routes', () => {
  routerCalls.length = 0;
  delete require.cache[abs('routes/authRoutes.js')];
  require(abs('routes/authRoutes.js'));
  const find = (method, p) => routerCalls.find(([m, route]) => m === method && route === p);
  const forgot = find('post', '/forgot-password');
  const verify = find('post', '/verify-reset-otp');
  const reset = find('post', '/reset-password');
  assert.ok(forgot && verify && reset);
  assert.equal(forgot[3], controller.forgotPassword);
  assert.equal(verify[3], controller.verifyResetOtp);
  assert.equal(reset[3], controller.resetPassword);
  for (const r of [forgot, verify, reset]) assert.equal(typeof r[2], 'function'); // limiter before the handler
  for (const existing of ['/register', '/login', '/resend-otp', '/verify-email']) assert.ok(find('post', existing), existing);
  assert.ok(find('get', '/profile'));
});

test('verification-email codes and reset codes use different hashes for the same user and digits', () => {
  assert.notEqual(otpService.hashOtp('u1', '123456'), otpService.hashOtp('pwreset-code:u1', '123456'));
});

'use strict';

// Tests for Phase 0B email delivery diagnostics: a failed send must log the real error code and a safe
// message, never a secret, the OTP or the recipient, while the API error stays generic.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'unit-test-secret-unit-test-secret-1234567890';
process.env.MONGO_URI = 'mongodb://localhost:27017/studywise_ai_test';
process.env.BREVO_SMTP_USER = 'login-user-9z@smtp-brevo.com';
process.env.BREVO_SMTP_PASS = 'xsmtpsib-SECRETKEYSECRETKEY-abc';
process.env.EMAIL_FROM_ADDRESS = 'no-reply@studywise.test';

const test = require('node:test');
const assert = require('node:assert/strict');
const emailService = require('../services/emailService');

const captureErrors = async (fn) => {
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.map(String).join(' '));
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return lines.join('\n');
};

const send = () => emailService.sendOtpEmail({ to: 'student@example.com', name: 'S', otp: '482913', expiresInMinutes: 5 });

test('EAUTH: logs code, SMTP reply code and a hint; client error stays generic', async () => {
  const error = Object.assign(new Error('Invalid login: 535 5.7.8 Authentication failed for student@example.com using xsmtpsib-SECRETKEYSECRETKEY-abc 482913'), {
    code: 'EAUTH',
    responseCode: 535,
    command: 'AUTH PLAIN',
  });
  emailService._setTransportForTests({ sendMail: async () => { throw error; } });

  let thrown;
  const log = await captureErrors(async () => {
    try { await send(); } catch (err) { thrown = err; }
  });

  assert.equal(thrown.statusCode, 502);
  assert.match(thrown.message, /could not send the verification email/i);
  assert.ok(!/EAUTH|535|smtp/i.test(thrown.message));
  assert.match(log, /code=EAUTH/);
  assert.match(log, /smtpResponse=535/);
  assert.match(log, /command=AUTH PLAIN/);
  assert.match(log, /CAUSE: Brevo rejected the login/);
  for (const secret of ['SECRETKEYSECRETKEY', 'xsmtpsib', 'login-user-9z', 'student@example.com', '482913']) {
    assert.ok(!log.includes(secret), `log must not contain ${secret}`);
  }
  emailService._setTransportForTests();
});

test('MODULE_NOT_FOUND (nodemailer not installed) is reported as such, not as a network problem', async () => {
  const error = Object.assign(new Error("Cannot find module 'nodemailer'"), { code: 'MODULE_NOT_FOUND' });
  emailService._setTransportForTests({ sendMail: async () => { throw error; } });
  const log = await captureErrors(async () => {
    await assert.rejects(send(), { statusCode: 502 });
  });
  assert.match(log, /code=MODULE_NOT_FOUND/);
  assert.match(log, /nodemailer.*not installed.*npm install/);
  emailService._setTransportForTests();
});

test('network failures log syscall, host and port', async () => {
  const error = Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:587'), { code: 'ECONNECTION', syscall: 'connect', errno: -111 });
  emailService._setTransportForTests({ sendMail: async () => { throw error; } });
  const log = await captureErrors(async () => {
    await assert.rejects(send(), { statusCode: 502 });
  });
  assert.match(log, /code=ECONNECTION/);
  assert.match(log, /syscall=connect/);
  assert.match(log, /host=smtp-relay\.brevo\.com, port=587/);
  emailService._setTransportForTests();
});

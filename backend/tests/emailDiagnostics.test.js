'use strict';

// Tests for email delivery through the Brevo HTTPS API (Phase 0B): the real transport must call Brevo with the
// right request, and a failed send must log the real error code and a safe message, never the API key, the OTP
// or the recipient, while the API error stays generic.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'unit-test-secret-unit-test-secret-1234567890';
process.env.MONGO_URI = 'mongodb://localhost:27017/studywise_ai_test';
process.env.BREVO_API_KEY = 'xkeysib-SECRETKEYSECRETKEY-abc';
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

const send = (extra = {}) =>
  emailService.sendOtpEmail({ to: 'student@example.com', name: 'S', otp: '482913', expiresInMinutes: 5, ...extra });

const realFetch = global.fetch;
test.afterEach(() => {
  global.fetch = realFetch;
  emailService._setTransportForTests();
});

const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('sends through the Brevo HTTPS API with the api-key header and the NO_ARREAR sender', async () => {
  let call;
  global.fetch = async (url, options) => {
    call = { url, options };
    return jsonResponse(201, { messageId: '<abc@smtp-relay.mailin.fr>' });
  };

  await send();

  assert.equal(call.url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(call.options.method, 'POST');
  assert.equal(call.options.headers['api-key'], 'xkeysib-SECRETKEYSECRETKEY-abc');
  assert.equal(call.options.headers['content-type'], 'application/json');
  const body = JSON.parse(call.options.body);
  assert.deepEqual(body.sender, { name: 'NO_ARREAR', email: 'no-reply@studywise.test' });
  assert.deepEqual(body.to, [{ email: 'student@example.com' }]);
  assert.equal(body.subject, 'Your NO_ARREAR verification code');
  assert.match(body.htmlContent, /482913/);
  assert.match(body.textContent, /482913/);
  assert.ok(!call.options.body.includes('xkeysib'), 'the API key is only sent in the header');
});

test('password-reset purpose keeps its own template over the API', async () => {
  let body;
  global.fetch = async (url, options) => {
    body = JSON.parse(options.body);
    return jsonResponse(201, {});
  };
  await send({ purpose: 'password-reset' });
  assert.equal(body.subject, 'Your NO_ARREAR password reset code');
  assert.match(body.textContent, /reset your NO_ARREAR password/);
});

test('HTTP 401: logs status, code and a hint; client error stays generic; nothing secret is logged', async () => {
  global.fetch = async () =>
    jsonResponse(401, {
      code: 'unauthorized',
      message: 'Key not found: xkeysib-SECRETKEYSECRETKEY-abc for student@example.com 482913',
    });

  let thrown;
  const log = await captureErrors(async () => {
    try {
      await send();
    } catch (err) {
      thrown = err;
    }
  });

  assert.equal(thrown.statusCode, 502);
  assert.match(thrown.message, /could not send the verification email/i);
  assert.ok(!/401|brevo|unauthorized/i.test(thrown.message));
  assert.match(log, /code=BREVO_HTTP_ERROR/);
  assert.match(log, /httpStatus=401/);
  assert.match(log, /brevoCode=unauthorized/);
  assert.match(log, /CAUSE: Brevo rejected the API key/);
  for (const secret of ['SECRETKEYSECRETKEY', 'student@example.com', '482913']) {
    assert.ok(!log.includes(secret), `log must not contain ${secret}`);
  }
});

test('HTTP 400 points at the verified sender', async () => {
  global.fetch = async () => jsonResponse(400, { code: 'invalid_parameter', message: 'Sender not valid' });
  const log = await captureErrors(async () => {
    await assert.rejects(send(), { statusCode: 502 });
  });
  assert.match(log, /httpStatus=400/);
  assert.match(log, /EMAIL_FROM_ADDRESS must be a sender/);
});

test('network failures log the error code and the endpoint', async () => {
  global.fetch = async () => {
    const err = new TypeError('fetch failed');
    err.cause = Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:443'), { code: 'ECONNREFUSED' });
    throw err;
  };
  const log = await captureErrors(async () => {
    await assert.rejects(send(), { statusCode: 502 });
  });
  assert.match(log, /code=ECONNREFUSED/);
  assert.match(log, /endpoint=https:\/\/api\.brevo\.com\/v3\/smtp\/email/);
  assert.match(log, /Could not reach the Brevo API over HTTPS/);
});

test('a request that never answers is aborted and reported as ETIMEDOUT', async () => {
  const { config } = require('../config/env');
  const saved = config.email.timeoutMs;
  config.email.timeoutMs = 20;
  global.fetch = (url, options) =>
    new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
  try {
    const log = await captureErrors(async () => {
      await assert.rejects(send(), { statusCode: 502 });
    });
    assert.match(log, /code=ETIMEDOUT/);
  } finally {
    config.email.timeoutMs = saved;
  }
});

test('without BREVO_API_KEY nothing is sent and the answer is 503', async () => {
  const { config } = require('../config/env');
  const saved = config.email.apiKey;
  config.email.apiKey = '';
  let called = false;
  global.fetch = async () => {
    called = true;
    return jsonResponse(201, {});
  };
  try {
    await captureErrors(async () => {
      await assert.rejects(send(), { statusCode: 503 });
    });
    assert.equal(called, false);
    assert.equal(emailService.isEmailConfigured(), false);
  } finally {
    config.email.apiKey = saved;
  }
});

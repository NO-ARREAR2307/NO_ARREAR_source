'use strict';

// Integration tests for Phase 0 (roles and admin authorization).
// Run with:  npm test
// No database or internet is needed: the User model's database calls are replaced by test doubles.
// Everything else (Express app, JWT middleware, role middleware, validation, error handler) is real.

// Environment must be set BEFORE the app (and config/env.js) is loaded.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'unit-test-secret-unit-test-secret-1234567890';
process.env.MONGO_URI = 'mongodb://localhost:27017/studywise_ai_test';
process.env.RATE_LIMIT_MAX = '10000';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const User = require('../models/User');
const generateToken = require('../utils/generateToken');
const otpService = require('../services/otpService');
const app = require('../app');

// Part 2: students must have a verified email to get any access, admins never do (see tests/emailVerify.test.js).
// Registration now also sends an email verification code (covered in tests/emailOtp.test.js).
// Here it is replaced so these tests stay independent of the database and of email.
otpService.issueEmailOtp = async () => ({ expiresInSeconds: 300, resendCooldownSeconds: 60, sentTo: 'e***@example.com' });

const ADMIN_ID = new mongoose.Types.ObjectId().toString();
const STUDENT_ID = new mongoose.Types.ObjectId().toString();
const LEGACY_ID = new mongoose.Types.ObjectId().toString(); // account saved before roles existed

// The "database": findById is what middleware/authMiddleware.js uses on every request.
const accounts = {
  // The admin has NO emailVerified flag on purpose: an existing admin must keep working untouched.
  [ADMIN_ID]: { _id: ADMIN_ID, name: 'Admin', email: 'admin@example.com', role: 'admin' },
  [STUDENT_ID]: { _id: STUDENT_ID, name: 'Student', email: 'student@example.com', role: 'student', emailVerified: true },
  [LEGACY_ID]: { _id: LEGACY_ID, name: 'Legacy', email: 'legacy@example.com', emailVerified: true },
};
User.findById = async (id) => accounts[String(id)] || null;

let createdDocs = [];
User.exists = async () => null;
// Builds a real (unsaved) model instance, so the schema default and toJSON behave exactly as in production.
User.create = async (doc) => {
  createdDocs.push(doc);
  return new User(doc);
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
  await new Promise((resolve) => server.close(resolve));
});

test.beforeEach(() => {
  createdDocs = [];
});

const call = async (path, { method = 'GET', token, body } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  return { status: response.status, json: JSON.parse(text) };
};

const ADMIN_URL = '/api/admin/access-check';

test('admin route without a token -> 401', async () => {
  const result = await call(ADMIN_URL);
  assert.equal(result.status, 401);
  assert.equal(result.json.success, false);
});

test('admin route with an invalid token -> 401', async () => {
  assert.equal((await call(ADMIN_URL, { token: 'not.a.jwt' })).status, 401);
});

test('student token on an admin route -> 403', async () => {
  const result = await call(ADMIN_URL, { token: generateToken(STUDENT_ID) });
  assert.equal(result.status, 403);
  assert.equal(result.json.success, false);
});

test('admin token on an admin route -> 200', async () => {
  const result = await call(ADMIN_URL, { token: generateToken(ADMIN_ID) });
  assert.equal(result.status, 200);
  assert.equal(result.json.data.admin.role, 'admin');
  assert.equal(result.json.data.admin.email, 'admin@example.com');
});

test('a token that CLAIMS the admin role does not make a student an admin (role comes from the database)', async () => {
  const forged = jwt.sign({ id: STUDENT_ID, role: 'admin', isAdmin: true }, process.env.JWT_SECRET, { expiresIn: '1h' });
  assert.equal((await call(ADMIN_URL, { token: forged })).status, 403);
});

test('an account saved before roles existed is treated as a student -> 403', async () => {
  assert.equal((await call(ADMIN_URL, { token: generateToken(LEGACY_ID) })).status, 403);
});

test('a role sent in the request body or query does not grant access', async () => {
  const token = generateToken(STUDENT_ID);
  const result = await call(`${ADMIN_URL}?role=admin`, { token, method: 'GET' });
  assert.equal(result.status, 403);
});

test('a demoted or deleted admin loses access immediately, even with a still-valid token', async () => {
  const token = generateToken(ADMIN_ID);
  assert.equal((await call(ADMIN_URL, { token })).status, 200);

  const saved = accounts[ADMIN_ID];
  accounts[ADMIN_ID] = { ...saved, role: 'student' };
  assert.equal((await call(ADMIN_URL, { token })).status, 403);

  delete accounts[ADMIN_ID];
  assert.equal((await call(ADMIN_URL, { token })).status, 401);

  accounts[ADMIN_ID] = saved; // restore
});

test('registration ignores a role in the body and always creates a student', async () => {
  const result = await call('/api/auth/register', {
    method: 'POST',
    body: {
      name: 'Eve',
      email: 'eve@example.com',
      password: 'password123',
      course: 'B.Tech',
      department: 'CSE',
      semester: 3,
      role: 'admin',
      isAdmin: true,
    },
  });
  assert.equal(result.status, 201);
  assert.equal(createdDocs.length, 1);
  assert.equal(createdDocs[0].role, undefined, 'role must not be passed to the model');
  assert.equal(createdDocs[0].isAdmin, undefined);
  assert.equal(result.json.user.role, 'student');
  assert.equal(result.json.user.password, undefined);

  // Part 2: no token is issued at registration at all. Even a token minted by hand for the new account
  // opens neither admin routes (403) nor anything else until the email is verified.
  assert.equal(result.json.token, undefined);
  accounts[result.json.user._id] = { ...result.json.user };
  const handMade = generateToken(result.json.user._id);
  assert.equal((await call(ADMIN_URL, { token: handMade })).status, 403);
  assert.equal((await call('/api/auth/profile', { token: handMade })).status, 403);
  delete accounts[result.json.user._id];
});

test('the User model only accepts the roles student and admin', async () => {
  const base = { name: 'X', email: 'x@example.com', password: 'password123' };
  assert.equal(new User(base).role, 'student');
  assert.equal(new User({ ...base, role: 'admin' }).validateSync(), undefined);
  const error = new User({ ...base, role: 'teacher' }).validateSync();
  assert.ok(error && error.errors.role, 'an unknown role must fail validation');
});

test('existing authenticated endpoints still work for a student', async () => {
  const profile = await call('/api/auth/profile', { token: generateToken(STUDENT_ID) });
  assert.equal(profile.status, 200);
  assert.equal(profile.json.user.email, 'student@example.com');
});

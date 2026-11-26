'use strict';

// Unit tests for middleware/roleMiddleware.js and utils/roles.js. No database or internet needed.

const test = require('node:test');
const assert = require('node:assert/strict');
const ApiError = require('../utils/ApiError');
const { ROLES, ROLE_VALUES, DEFAULT_ROLE } = require('../utils/roles');
const { authorizeRoles, requireAdmin } = require('../middleware/roleMiddleware');

// Runs a middleware and returns what it passed to next().
const run = (middleware, req) => {
  let received;
  middleware(req, {}, (arg) => {
    received = arg;
  });
  return received;
};

test('roles: only student and admin exist, and the default is student', () => {
  assert.deepEqual([...ROLE_VALUES].sort(), ['admin', 'student']);
  assert.equal(DEFAULT_ROLE, 'student');
});

test('no authenticated user -> 401', () => {
  const err = run(requireAdmin, {});
  assert.ok(err instanceof ApiError);
  assert.equal(err.statusCode, 401);
});

test('student -> 403', () => {
  const err = run(requireAdmin, { user: { _id: '1', role: ROLES.STUDENT } });
  assert.ok(err instanceof ApiError);
  assert.equal(err.statusCode, 403);
});

test('admin -> allowed (next() without an error)', () => {
  assert.equal(run(requireAdmin, { user: { _id: '1', role: ROLES.ADMIN } }), undefined);
});

test('missing, unknown or differently-cased role is denied', () => {
  for (const role of [undefined, null, '', 'Admin', 'ADMIN', 'superadmin', ['admin'], { $ne: 'x' }]) {
    const err = run(requireAdmin, { user: { _id: '1', role } });
    assert.ok(err instanceof ApiError, `role ${JSON.stringify(role)} must be denied`);
    assert.equal(err.statusCode, 403);
  }
});

test('a role value in the request body or query never grants access', () => {
  const req = { user: { _id: '1', role: ROLES.STUDENT }, body: { role: 'admin' }, query: { role: 'admin' }, headers: { 'x-role': 'admin' } };
  assert.equal(run(requireAdmin, req).statusCode, 403);
});

test('authorizeRoles accepts several roles and an array', () => {
  const both = authorizeRoles(ROLES.STUDENT, ROLES.ADMIN);
  assert.equal(run(both, { user: { role: 'student' } }), undefined);
  assert.equal(run(both, { user: { role: 'admin' } }), undefined);
  const viaArray = authorizeRoles([ROLES.ADMIN]);
  assert.equal(run(viaArray, { user: { role: 'student' } }).statusCode, 403);
});

test('authorizeRoles refuses to be built without valid roles (no accidentally open route)', () => {
  assert.throws(() => authorizeRoles(), /one or more of/);
  assert.throws(() => authorizeRoles('teacher'), /one or more of/);
});

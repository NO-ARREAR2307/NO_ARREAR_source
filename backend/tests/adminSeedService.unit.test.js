'use strict';

// Unit tests for services/adminSeedService.js (the logic behind `npm run seed:admin`).
// The User model is replaced by an in-memory double, so no database is needed.

const test = require('node:test');
const assert = require('node:assert/strict');
const { seedAdmin, SeedError } = require('../services/adminSeedService');

const STRONG = 'a-Very-Long-Passw0rd!';

const makeUserDouble = ({ users = [] } = {}) => {
  const calls = { created: [], updated: [] };
  const User = {
    countDocuments: async (filter) => users.filter((u) => u.role === filter.role).length,
    findOne: async ({ email }) => users.find((u) => u.email === email) || null,
    create: async (doc) => {
      calls.created.push(doc);
      users.push({ _id: String(users.length + 1), ...doc });
      return doc;
    },
    updateOne: async (filter, update) => {
      calls.updated.push({ filter, update });
      const user = users.find((u) => u._id === filter._id && u.role !== 'admin');
      if (user) Object.assign(user, update.$set);
    },
  };
  return { User, calls, users };
};

const input = (overrides = {}) => ({ name: 'Site Admin', email: 'Admin@Example.com ', password: STRONG, ...overrides });

test('creates an admin with a normalized email and the admin role (password handed over in plain text for the model hook to hash)', async () => {
  const { User, calls } = makeUserDouble();
  const result = await seedAdmin({ User, input: input() });
  assert.deepEqual(result, { status: 'created', email: 'admin@example.com' });
  assert.equal(calls.created.length, 1);
  assert.equal(calls.created[0].role, 'admin');
  assert.equal(calls.created[0].email, 'admin@example.com');
  assert.equal(calls.created[0].password, STRONG); // hashed by User's pre('save') hook, as in registration
});

test('running twice does not create a second admin', async () => {
  const { User, calls } = makeUserDouble();
  await seedAdmin({ User, input: input() });
  const second = await seedAdmin({ User, input: input({ email: 'other@example.com' }) });
  assert.equal(second.status, 'admin-exists');
  assert.equal(calls.created.length, 1);
});

test('an existing account with that email is not changed without --promote-existing', async () => {
  const { User, calls, users } = makeUserDouble({ users: [{ _id: '1', email: 'admin@example.com', role: 'student' }] });
  await assert.rejects(() => seedAdmin({ User, input: input() }), (err) => err instanceof SeedError && /--promote-existing/.test(err.message));
  assert.equal(calls.created.length, 0);
  assert.equal(calls.updated.length, 0);
  assert.equal(users[0].role, 'student');
});

test('--promote-existing makes that account an admin and creates no new account', async () => {
  const { User, calls, users } = makeUserDouble({ users: [{ _id: '1', email: 'admin@example.com', role: 'student' }] });
  const result = await seedAdmin({ User, input: input({ password: '', name: '' }), promoteExisting: true });
  assert.equal(result.status, 'promoted');
  assert.equal(users[0].role, 'admin');
  assert.equal(calls.created.length, 0);
  assert.equal('password' in calls.updated[0].update.$set, false, 'password must not be touched');
});

test('--promote-existing still refuses when an admin already exists', async () => {
  const { User, calls } = makeUserDouble({
    users: [
      { _id: '1', email: 'boss@example.com', role: 'admin' },
      { _id: '2', email: 'admin@example.com', role: 'student' },
    ],
  });
  const result = await seedAdmin({ User, input: input(), promoteExisting: true });
  assert.equal(result.status, 'admin-exists');
  assert.equal(calls.updated.length, 0);
});

test('missing or invalid values are rejected, and the password never appears in the message', async () => {
  const cases = [
    input({ email: '' }),
    input({ email: 'not-an-email' }),
    input({ name: '   ' }),
    input({ password: '' }),
    input({ password: 'short-pw' }),
    input({ password: 'x'.repeat(73) }),
  ];
  for (const bad of cases) {
    const { User, calls } = makeUserDouble();
    await assert.rejects(
      () => seedAdmin({ User, input: bad }),
      (err) => err instanceof SeedError && !err.message.includes(bad.password || '\u0000')
    );
    assert.equal(calls.created.length, 0);
  }
});

test('a duplicate-key error from the database becomes a clear SeedError', async () => {
  const { User } = makeUserDouble();
  User.create = async () => {
    const err = new Error('E11000 duplicate key');
    err.code = 11000;
    throw err;
  };
  await assert.rejects(() => seedAdmin({ User, input: input() }), SeedError);
});

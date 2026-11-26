'use strict';

const { ROLES } = require('../utils/roles');

// Logic of the one-time admin setup (scripts/seedAdmin.js). Kept free of database/connection code
// and receives the User model as a parameter, so it can be unit-tested without MongoDB.

// Same pattern as models/User.js and controllers/authController.js.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const MAX_EMAIL_LENGTH = 254;
const ADMIN_MIN_PASSWORD_LENGTH = 12; // stricter than students: this account can manage the platform
const MAX_PASSWORD_BYTES = 72; // bcrypt only uses the first 72 bytes

// A problem the person running the script can fix (bad .env value, existing account...).
class SeedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SeedError';
  }
}

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const emailProblems = (email) => {
  if (!isNonEmptyString(email)) return ['ADMIN_EMAIL is not set.'];
  if (email.trim().length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email.trim())) {
    return ['ADMIN_EMAIL is not a valid email address.'];
  }
  return [];
};

// Messages never contain the password value.
const newAdminProblems = ({ name, password }) => {
  const problems = [];
  if (!isNonEmptyString(name)) problems.push('ADMIN_NAME is not set.');
  else if (name.trim().length > 100) problems.push('ADMIN_NAME cannot exceed 100 characters.');
  if (typeof password !== 'string' || password.length === 0) {
    problems.push('ADMIN_PASSWORD is not set.');
  } else if (password.length < ADMIN_MIN_PASSWORD_LENGTH) {
    problems.push(`ADMIN_PASSWORD must be at least ${ADMIN_MIN_PASSWORD_LENGTH} characters long.`);
  } else if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    problems.push(`ADMIN_PASSWORD cannot exceed ${MAX_PASSWORD_BYTES} bytes.`);
  }
  return problems;
};

/**
 * Creates the first admin account.
 *
 * - If an admin already exists, nothing is changed (this is what prevents duplicate admins).
 * - If an account with ADMIN_EMAIL already exists it is NEVER silently changed: the caller must pass
 *   promoteExisting = true (flag --promote-existing) to make that existing student an admin. Its
 *   password is left untouched in that case.
 * - A new account is saved with User.create(), so the existing pre('save') hook hashes the password
 *   with bcrypt exactly like registration does. The role is set here, on the server, only.
 *
 * @param {{ User: object, input: { name: string, email: string, password: string }, promoteExisting?: boolean }} params
 * @returns {Promise<{ status: 'created' | 'promoted' | 'admin-exists', email?: string }>}
 */
const seedAdmin = async ({ User, input, promoteExisting = false }) => {
  const problems = emailProblems(input.email);
  if (problems.length > 0) throw new SeedError(problems.join(' '));
  const email = input.email.trim().toLowerCase();

  if ((await User.countDocuments({ role: ROLES.ADMIN })) > 0) {
    return { status: 'admin-exists' };
  }

  const existing = await User.findOne({ email });
  if (existing) {
    if (!promoteExisting) {
      throw new SeedError(
        'An account with this email already exists. It was not changed. ' +
          'To make that existing account an admin, run again with --promote-existing (its password stays the same).'
      );
    }
    // The filter makes the update a no-op if someone else changed the role in the meantime.
    await User.updateOne({ _id: existing._id, role: { $ne: ROLES.ADMIN } }, { $set: { role: ROLES.ADMIN } });
    return { status: 'promoted', email };
  }

  const creationProblems = newAdminProblems(input);
  if (creationProblems.length > 0) throw new SeedError(creationProblems.join(' '));

  try {
    await User.create({
      name: input.name.trim(),
      email,
      password: input.password,
      role: ROLES.ADMIN,
    });
  } catch (err) {
    // Same email created by someone else between the check above and now (unique index).
    if (err && err.code === 11000) throw new SeedError('An account with this email already exists.');
    throw err;
  }
  return { status: 'created', email };
};

module.exports = { seedAdmin, SeedError, ADMIN_MIN_PASSWORD_LENGTH };

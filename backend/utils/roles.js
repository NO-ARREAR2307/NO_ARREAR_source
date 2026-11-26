'use strict';

// Single source of truth for user roles. Roles are only ever assigned by the server
// (default on the model, or the admin seed script) - never taken from a request body.
const ROLES = Object.freeze({
  STUDENT: 'student',
  ADMIN: 'admin',
});

const ROLE_VALUES = Object.freeze(Object.values(ROLES));
const DEFAULT_ROLE = ROLES.STUDENT;

module.exports = { ROLES, ROLE_VALUES, DEFAULT_ROLE };

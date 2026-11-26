'use strict';

const ApiError = require('./ApiError');
const { ROLES } = require('./roles');

// Single place that decides who must have a verified email address.
//
//   - Admins are NEVER blocked: they are created by scripts/seedAdmin.js (not by public registration, so
//     there is no email code for them) and must always be able to log in.
//   - Everyone else (students, and legacy accounts without a role, which read as students) needs
//     emailVerified === true. Only the server sets it, after the code from the email was verified.
const isEmailVerificationRequired = (user) => !user || (user.role !== ROLES.ADMIN && user.emailVerified !== true);

const EMAIL_NOT_VERIFIED_CODE = 'EMAIL_NOT_VERIFIED';

// 403 with a stable machine-readable code, so a client can send the student to the verification screen.
const emailNotVerifiedError = () => {
  const error = ApiError.forbidden('Please verify your email address before continuing. Check your inbox for the 6-digit code or request a new one.');
  error.errorCode = EMAIL_NOT_VERIFIED_CODE;
  return error;
};

module.exports = { isEmailVerificationRequired, emailNotVerifiedError, EMAIL_NOT_VERIFIED_CODE };

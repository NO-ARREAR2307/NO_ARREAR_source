'use strict';

const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const generateToken = require('../utils/generateToken');
const logger = require('../utils/logger');
const { config } = require('../config/env');
const { ROLES } = require('../utils/roles');
const { sendSuccess } = require('../utils/apiResponse');
const { isEmailVerificationRequired, emailNotVerifiedError } = require('../utils/emailVerification');
// Used as otpService.issueEmailOtp(...) (not destructured) so tests can replace it.
const otpService = require('../services/otpService');
// Used as passwordResetService.issuePasswordResetOtp(...) (not destructured) so tests can replace it.
const passwordResetService = require('../services/passwordResetService');

// Same pattern as models/User.js, plus the 254 character limit.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const MAX_EMAIL_LENGTH = 254;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_BYTES = 72; // bcrypt only uses the first 72 bytes

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const validateEmail = (email, details) => {
  if (!isNonEmptyString(email)) {
    details.push({ field: 'email', message: 'Email is required' });
    return;
  }
  const value = email.trim();
  if (value.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(value)) {
    details.push({ field: 'email', message: 'Please provide a valid email address' });
  }
};

// Express 5 forwards rejected promises from async handlers to the error handler,
// so no asyncHandler wrapper is needed.

// POST /api/auth/register
const register = async (req, res) => {
  // Only these fields are read from the body. `role` is deliberately NOT one of them: public
  // registration always creates a student (the model default). Admins come from scripts/seedAdmin.js.
  const { name, email, password, course, department, semester } = req.body || {};
  const details = [];

  if (!isNonEmptyString(name)) details.push({ field: 'name', message: 'Name is required' });
  validateEmail(email, details);

  if (typeof password !== 'string' || password.length === 0) {
    details.push({ field: 'password', message: 'Password is required' });
  } else if (password.length < MIN_PASSWORD_LENGTH) {
    details.push({ field: 'password', message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long` });
  } else if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    details.push({ field: 'password', message: `Password cannot exceed ${MAX_PASSWORD_BYTES} bytes` });
  }

  if (!isNonEmptyString(course)) details.push({ field: 'course', message: 'Course is required' });
  if (!isNonEmptyString(department)) details.push({ field: 'department', message: 'Department is required' });

  const semesterNumber = typeof semester === 'string' && semester.trim() !== '' ? Number(semester) : semester;
  if (semester === undefined || semester === null || semester === '') {
    details.push({ field: 'semester', message: 'Semester is required' });
  } else if (typeof semesterNumber !== 'number' || !Number.isInteger(semesterNumber) || semesterNumber < 1 || semesterNumber > 12) {
    details.push({ field: 'semester', message: 'Semester must be a whole number between 1 and 12' });
  }

  if (details.length > 0) throw ApiError.badRequest('Validation failed', details);

  const normalizedEmail = email.trim().toLowerCase();

  const existing = await User.exists({ email: normalizedEmail });
  if (existing) throw ApiError.conflict('An account with this email already exists');

  let user;
  try {
    // The pre('save') hook in models/User.js hashes the password. Pass it in plain text, once.
    user = await User.create({
      name,
      email: normalizedEmail,
      password,
      course,
      department,
      semester: semesterNumber,
      emailVerified: false, // always false for a new student; only the server can ever set it to true
    });
  } catch (err) {
    // Two simultaneous registrations can both pass the check above; the unique index catches the second.
    if (err && err.code === 11000) throw ApiError.conflict('An account with this email already exists');
    throw err;
  }

  // No JWT is issued here: a student receives one only after the email address has been verified
  // (POST /api/auth/verify-email) and can then also log in.

  // Send the email verification code. The account already exists at this point, so a problem with
  // the email service must not fail the registration: the response says the code was not sent and
  // the student can use POST /api/auth/resend-otp. The code itself is never part of the response.
  let emailVerification;
  try {
    const issued = await otpService.issueEmailOtp(user);
    emailVerification = {
      required: true,
      otpSent: true,
      sentTo: issued.sentTo,
      expiresInSeconds: issued.expiresInSeconds,
      resendCooldownSeconds: issued.resendCooldownSeconds,
      message: 'A 6-digit verification code has been sent to your email address.',
    };
  } catch (err) {
    // emailService has already logged the cause (without the code or any credentials).
    if (!(err instanceof ApiError)) {
      logger.error(`Unexpected error while sending the verification email (user ${user._id})`, err && err.stack ? err.stack : err);
    } else {
      logger.warn(`Registration succeeded but the verification email was not sent (user ${user._id}): ${err.message}`);
    }
    emailVerification = {
      required: true,
      otpSent: false,
      message: 'Your account was created, but we could not send the verification email. Please request a new code.',
    };
  }

  // user.toJSON() in the model removes password and __v.
  return res.status(201).json({
    success: true,
    message: 'Registration successful. Please verify your email address to continue.',
    user,
    emailVerification,
  });
};

// POST /api/auth/login
const login = async (req, res) => {
  const { email, password } = req.body || {};
  const details = [];

  validateEmail(email, details);
  if (typeof password !== 'string' || password.length === 0) {
    details.push({ field: 'password', message: 'Password is required' });
  }

  if (details.length > 0) throw ApiError.badRequest('Validation failed', details);

  const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+password');

  // Same message for "no such user" and "wrong password" so accounts cannot be enumerated.
  const isMatch = user ? await user.comparePassword(password) : false;
  if (!isMatch) throw ApiError.unauthorized('Invalid email or password');

  // Checked only AFTER the password was proven correct, so this answer cannot be used to find out which
  // emails are registered. Admins are exempt (see utils/emailVerification.js): they are never locked out.
  if (isEmailVerificationRequired(user)) throw emailNotVerifiedError();

  const token = generateToken(user._id);

  return res.status(200).json({
    success: true,
    message: 'Login successful',
    user,
    token,
  });
};

// GET /api/auth/profile (protected by middleware/authMiddleware.js, which sets req.user)
const getProfile = async (req, res) => {
  // req.user was loaded without the password hash; the model's toJSON also strips it.
  return res.status(200).json({
    success: true,
    message: 'Profile retrieved successfully',
    user: req.user,
  });
};

// POST /api/auth/verify-email
// Body: { "email": "student@example.com", "otp": "123456" }. Public (the student cannot log in yet).
// On success the student is marked emailVerified, the code is used up, and the first JWT is issued.
// Unknown emails, already verified accounts, admins, missing/expired codes and wrong codes of accounts
// without a pending code all get the same 400, so this endpoint does not reveal who has an account.
const verifyEmail = async (req, res) => {
  const { email, otp } = req.body || {};
  const details = [];

  validateEmail(email, details);
  // Only a string of exactly 6 digits is accepted (never an object or number), so the value is safe to hash.
  const code = typeof otp === 'string' ? otp.trim() : '';
  if (typeof otp !== 'string' || otp.trim().length === 0) {
    details.push({ field: 'otp', message: 'Verification code is required' });
  } else if (!/^\d{6}$/.test(code)) {
    details.push({ field: 'otp', message: 'Verification code must be exactly 6 digits' });
  }
  if (details.length > 0) throw ApiError.badRequest('Validation failed', details);

  const user = await User.findOne({ email: email.trim().toLowerCase() });
  const eligible = user && user.role === ROLES.STUDENT && user.emailVerified !== true ? user : null;

  // Throws 400 (wrong / expired / none) or 429 (too many wrong attempts); resolves only for a correct code.
  await otpService.verifyEmailOtp(eligible, code);

  // The code was correct and is already consumed. Only the server ever sets this flag.
  await User.updateOne({ _id: eligible._id }, { $set: { emailVerified: true } });
  eligible.emailVerified = true;

  return res.status(200).json({
    success: true,
    message: 'Email verified successfully',
    user: eligible,
    token: generateToken(eligible._id),
  });
};

// POST /api/auth/resend-otp
// Body: { "email": "student@example.com" }. Public (the student may not be able to log in yet).
// Issues a NEW code and invalidates the previous one. Too-early requests get 429 (resend cooldown).
// Unknown emails, already verified accounts and non-student accounts get the same answer as a
// successful request and nothing is sent, so this endpoint does not reveal who has an account
// (the cooldown 429 can only occur for a real, unverified student).
const resendOtp = async (req, res) => {
  const { email } = req.body || {};
  const details = [];
  validateEmail(email, details);
  if (details.length > 0) throw ApiError.badRequest('Validation failed', details);

  const user = await User.findOne({ email: email.trim().toLowerCase() });

  let expiresInSeconds = otpService.OTP_TTL_SECONDS;
  let resendCooldownSeconds = config.emailOtp.resendCooldownSeconds;
  if (user && user.role === ROLES.STUDENT && user.emailVerified !== true) {
    const issued = await otpService.issueEmailOtp(user);
    expiresInSeconds = issued.expiresInSeconds;
    resendCooldownSeconds = issued.resendCooldownSeconds;
  }

  return sendSuccess(res, {
    message: 'If this email belongs to an account that still needs verification, a new code has been sent.',
    data: { expiresInSeconds, resendCooldownSeconds },
  });
};

// ---------- password reset ----------

// Accounts that may reset a password: the same ones that may log in (verified email; admins are exempt).
const canResetPassword = (user) => Boolean(user) && !isEmailVerificationRequired(user);

// POST /api/auth/forgot-password
// Body: { "email": "student@example.com" }. Public. Emails a 6-digit code (valid 5 minutes) and invalidates any
// earlier code or reset token. Unknown emails and accounts that cannot log in yet (unverified) get the same answer
// as a real account and nothing is sent, so this endpoint does not reveal who has an account (the cooldown 429 can
// only occur for a real account, the same trade-off as resend-otp).
const forgotPassword = async (req, res) => {
  const { email } = req.body || {};
  const details = [];
  validateEmail(email, details);
  if (details.length > 0) throw ApiError.badRequest('Validation failed', details);

  const user = await User.findOne({ email: email.trim().toLowerCase() });

  let expiresInSeconds = otpService.OTP_TTL_SECONDS;
  let resendCooldownSeconds = config.emailOtp.resendCooldownSeconds;
  if (canResetPassword(user)) {
    const issued = await passwordResetService.issuePasswordResetOtp(user);
    expiresInSeconds = issued.expiresInSeconds;
    resendCooldownSeconds = issued.resendCooldownSeconds;
  }

  return sendSuccess(res, {
    message: 'If an account exists for this email, a password reset code has been sent.',
    data: { expiresInSeconds, resendCooldownSeconds },
  });
};

// POST /api/auth/verify-reset-otp
// Body: { "email": "...", "otp": "123456" }. Public. A correct code is consumed and exchanged for a one-time reset
// token (valid 10 minutes) that POST /api/auth/reset-password requires. This is NOT a login token.
const verifyResetOtp = async (req, res) => {
  const { email, otp } = req.body || {};
  const details = [];
  validateEmail(email, details);
  const code = typeof otp === 'string' ? otp.trim() : '';
  if (typeof otp !== 'string' || otp.trim().length === 0) {
    details.push({ field: 'otp', message: 'Verification code is required' });
  } else if (!/^\d{6}$/.test(code)) {
    details.push({ field: 'otp', message: 'Verification code must be exactly 6 digits' });
  }
  if (details.length > 0) throw ApiError.badRequest('Validation failed', details);

  const user = await User.findOne({ email: email.trim().toLowerCase() });
  const eligible = canResetPassword(user) ? user : null;

  const { resetToken, expiresInSeconds } = await passwordResetService.verifyPasswordResetOtp(eligible, code);

  return res.status(200).json({
    success: true,
    message: 'Code verified. You can now choose a new password.',
    resetToken,
    data: { resetToken, expiresInSeconds },
  });
};

// POST /api/auth/reset-password
// Body: { "email": "...", "resetToken": "...", "password": "NewPassword1" } (`newPassword` is accepted as an alias
// of `password`; an `otp` field, if sent, is ignored because the code was already used up in the previous step).
// The token is single use. The new password is hashed by the User model's pre('save') hook (bcrypt).
const resetPassword = async (req, res) => {
  const { email, resetToken } = req.body || {};
  const body = req.body || {};
  const password = body.password !== undefined ? body.password : body.newPassword;
  const details = [];

  validateEmail(email, details);
  if (typeof resetToken !== 'string' || resetToken.trim().length === 0) {
    details.push({ field: 'resetToken', message: 'Reset token is required' });
  }
  if (typeof password !== 'string' || password.length === 0) {
    details.push({ field: 'password', message: 'Password is required' });
  } else if (password.length < MIN_PASSWORD_LENGTH) {
    details.push({ field: 'password', message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long` });
  } else if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    details.push({ field: 'password', message: `Password cannot exceed ${MAX_PASSWORD_BYTES} bytes` });
  }
  if (details.length > 0) throw ApiError.badRequest('Validation failed', details);

  const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+password');
  const eligible = canResetPassword(user) ? user : null;

  // Throws 400 for a wrong / expired / already used token; resolves only once, for a valid one.
  await passwordResetService.consumeResetToken(eligible, resetToken.trim());

  eligible.password = password; // plain text on purpose: the pre('save') hook in models/User.js hashes it
  await eligible.save();

  return sendSuccess(res, { message: 'Password reset successfully. You can now log in with your new password.' });
};

module.exports = { register, login, getProfile, resendOtp, verifyEmail, forgotPassword, verifyResetOtp, resetPassword };

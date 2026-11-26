'use strict';

const crypto = require('crypto');
const { config } = require('../config/env');
const EmailOtp = require('../models/EmailOtp');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { sendOtpEmail } = require('./emailService');

// Student email verification codes: generation, hashing, storage, sending and checking.

const OTP_LENGTH = 6;
const OTP_TTL_MS = 5 * 60 * 1000; // a code is valid for 5 minutes
const OTP_TTL_SECONDS = OTP_TTL_MS / 1000;

// A random 6-digit code, uniformly distributed (crypto.randomInt, not Math.random), zero-padded.
const generateOtp = () => String(crypto.randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');

// Key for hashing codes: OTP_HASH_SECRET if set, otherwise a key derived from JWT_SECRET (so the
// JWT secret itself is never used directly as an HMAC key for something else).
const getHashKey = () => {
  if (config.emailOtp.hashSecret) return config.emailOtp.hashSecret;
  if (!config.jwt.secret) throw new Error('JWT_SECRET is not set. Add it to .env before using email verification.');
  return crypto.createHmac('sha256', config.jwt.secret).update('studywise-email-otp-key').digest();
};

/**
 * Keyed hash (HMAC-SHA256, hex) of a code. A plain hash of a 6-digit number could be reversed by
 * trying all 1,000,000 values, so the secret key matters: without it the stored hash is useless.
 * The user id is part of the input, so the same code gives a different hash for every student.
 */
const hashOtp = (userId, otp) =>
  crypto.createHmac('sha256', getHashKey()).update(`${String(userId)}:${String(otp)}`).digest('hex');

// "student@example.com" -> "s*****@example.com": enough for the student to recognise it.
const maskEmail = (email) => {
  const [local, domain] = String(email).split('@');
  if (!domain) return '***';
  return `${local.charAt(0)}${'*'.repeat(Math.max(local.length - 1, 3))}@${domain}`;
};

const buildCooldownError = async (userId, now) => {
  const cooldownMs = config.emailOtp.resendCooldownSeconds * 1000;
  let remainingMs = cooldownMs;
  try {
    const current = await EmailOtp.findOne({ user: userId });
    if (current && current.lastSentAt) remainingMs = current.lastSentAt.getTime() + cooldownMs - now.getTime();
  } catch (err) {
    // Fall back to the full cooldown; the answer is still correct, just less precise.
  }
  const retryAfterSeconds = Math.min(config.emailOtp.resendCooldownSeconds, Math.max(1, Math.ceil(remainingMs / 1000)));
  const error = ApiError.tooManyRequests(`Please wait ${retryAfterSeconds} second${retryAfterSeconds === 1 ? '' : 's'} before requesting a new code.`);
  error.retryAfterSeconds = retryAfterSeconds; // read by middleware/errorHandler.js
  return error;
};

/**
 * Creates a new code for a student, stores its hash and emails the code.
 *
 *  - Any earlier code of the student is replaced in the same database write, so it stops working
 *    immediately (invalidated on resend).
 *  - The resend cooldown is enforced by that same write: it only matches when the previous code was
 *    issued at least `resendCooldownSeconds` ago. Two simultaneous requests therefore cannot both
 *    pass; the second hits the unique index and gets a 429.
 *  - If the email cannot be sent, the new code is removed again, so the student can retry at once
 *    instead of waiting out a cooldown for a code that never arrived.
 *
 * @param {{ _id: any, email: string, name?: string }} user
 * @returns {Promise<{ expiresInSeconds: number, resendCooldownSeconds: number, sentTo: string }>}
 * Throws ApiError: 429 (cooldown, with retryAfterSeconds), 503 / 502 (email not configured / not sent).
 */
const issueEmailOtp = async (user) => {
  const now = new Date();
  const cooldownSeconds = config.emailOtp.resendCooldownSeconds;
  const cutoff = new Date(now.getTime() - cooldownSeconds * 1000);

  const otp = generateOtp(); // lives only in this function and in the outgoing email
  const otpHash = hashOtp(user._id, otp);

  try {
    await EmailOtp.findOneAndUpdate(
      { user: user._id, lastSentAt: { $lte: cutoff } },
      { $set: { otpHash, expiresAt: new Date(now.getTime() + OTP_TTL_MS), lastSentAt: now, attempts: 0 } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
  } catch (err) {
    // A code was issued less than the cooldown ago: the filter did not match, the upsert tried to
    // insert a second document for this user, and the unique index refused it.
    if (err && err.code === 11000) throw await buildCooldownError(user._id, now);
    throw err;
  }

  try {
    await sendOtpEmail({ to: user.email, name: user.name, otp, expiresInMinutes: OTP_TTL_SECONDS / 60 });
  } catch (err) {
    try {
      // Only remove the code that was just created, never a newer one from a parallel request.
      await EmailOtp.deleteOne({ user: user._id, otpHash });
    } catch (cleanupError) {
      logger.error(`Could not remove an unsent verification code (user ${user._id}): ${cleanupError.message}`);
    }
    throw err;
  }

  return { expiresInSeconds: OTP_TTL_SECONDS, resendCooldownSeconds: cooldownSeconds, sentTo: maskEmail(user.email) };
};

const INVALID_CODE_MESSAGE = 'Invalid or expired verification code. Please request a new code.';

const tooManyAttemptsError = () =>
  ApiError.tooManyRequests('Too many incorrect attempts. Please request a new verification code.');

/**
 * Checks a code typed in by a student and CONSUMES it when it is correct.
 *
 *  - Expiry: a code older than 5 minutes never matches (checked against expiresAt in the database
 *    query itself; MongoDB's TTL cleanup is only housekeeping and runs about once a minute).
 *  - Single use: the correct code is removed with one atomic findOneAndDelete, so two simultaneous
 *    requests with the same correct code cannot both succeed.
 *  - Attempt limit: every guess is counted BEFORE the code is compared, in one atomic update that only
 *    succeeds while attempts < OTP_MAX_ATTEMPTS. Parallel requests therefore cannot get more than the
 *    allowed number of guesses. Once the limit is reached the code is locked: even the correct code is
 *    refused until the student requests a new one (which resets the counter).
 *  - The comparison is done by the database on the keyed hash (HMAC-SHA256), never on the plain code,
 *    and the plain code is never stored or logged.
 *
 * @param {{ _id: any } | null} user  the student (null = no eligible account; answered like a wrong code)
 * @param {string} otp                already validated: exactly 6 digits
 * Resolves when the code was correct and has been consumed. Throws ApiError:
 *   400 (invalid / expired / no pending code, or wrong code with `attemptsRemaining`), 429 (locked).
 */
const verifyEmailOtp = async (user, otp) => {
  if (!user) throw ApiError.badRequest(INVALID_CODE_MESSAGE);

  const maxAttempts = config.emailOtp.maxAttempts;
  const now = new Date();

  // Step 1: count this attempt (only for an unexpired code that still has attempts left).
  // "$not $gte" also matches code documents created before the attempts field existed.
  const record = await EmailOtp.findOneAndUpdate(
    { user: user._id, expiresAt: { $gt: now }, attempts: { $not: { $gte: maxAttempts } } },
    { $inc: { attempts: 1 } },
    { returnDocument: 'after' }
  );

  if (!record) {
    // Nothing to check against: there is no code, it expired, or it is locked.
    const current = await EmailOtp.findOne({ user: user._id });
    if (current && current.expiresAt > now && current.attempts >= maxAttempts) throw tooManyAttemptsError();
    throw ApiError.badRequest(INVALID_CODE_MESSAGE);
  }

  // Step 2: consume the code if (and only if) the hash matches and it has not expired meanwhile.
  const consumed = await EmailOtp.findOneAndDelete({
    user: user._id,
    otpHash: hashOtp(user._id, otp),
    expiresAt: { $gt: new Date() },
  });
  if (consumed) return;

  const remaining = Math.max(0, maxAttempts - (record.attempts || 0));
  if (remaining === 0) throw tooManyAttemptsError();
  const error = ApiError.badRequest(`Incorrect verification code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`);
  error.attemptsRemaining = remaining; // read by middleware/errorHandler.js
  throw error;
};

module.exports = {
  issueEmailOtp,
  verifyEmailOtp,
  generateOtp,
  hashOtp,
  maskEmail,
  OTP_LENGTH,
  OTP_TTL_MS,
  OTP_TTL_SECONDS,
};

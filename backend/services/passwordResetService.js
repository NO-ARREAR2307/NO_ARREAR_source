'use strict';

const crypto = require('crypto');
const { config } = require('../config/env');
const PasswordReset = require('../models/PasswordReset');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { generateOtp, hashOtp, maskEmail, OTP_TTL_MS, OTP_TTL_SECONDS } = require('./otpService');
const { sendOtpEmail } = require('./emailService');

// Forgotten-password flow: (1) emailed 6-digit code, (2) code -> one-time reset token, (3) token + new password.
// It reuses the verification-code building blocks (code generation, keyed HMAC hashing, masking, email sender) and
// the same limits (config.emailOtp: resend cooldown, max wrong attempts), but stores its state in its own
// collection so it can never interfere with email verification.

const RESET_TOKEN_TTL_MS = 10 * 60 * 1000; // the token from step 2 is valid for 10 minutes
const RESET_TOKEN_TTL_SECONDS = RESET_TOKEN_TTL_MS / 1000;

// Domain separation: the same secret key is used, but a code hash can never equal a token hash or a
// verification-email hash because the hashed input differs.
const codeHash = (userId, otp) => hashOtp(`pwreset-code:${String(userId)}`, otp);
const tokenHash = (userId, token) => hashOtp(`pwreset-token:${String(userId)}`, token);

const INVALID_CODE_MESSAGE = 'Invalid or expired reset code. Please request a new code.';
const INVALID_TOKEN_MESSAGE = 'This password reset link or session is invalid or has expired. Please start again.';

const tooManyAttemptsError = () =>
  ApiError.tooManyRequests('Too many incorrect attempts. Please request a new reset code.');

const buildCooldownError = async (userId, now) => {
  const cooldownMs = config.emailOtp.resendCooldownSeconds * 1000;
  let remainingMs = cooldownMs;
  try {
    const current = await PasswordReset.findOne({ user: userId });
    if (current && current.lastSentAt) remainingMs = current.lastSentAt.getTime() + cooldownMs - now.getTime();
  } catch (err) {
    // Fall back to the full cooldown.
  }
  const retryAfterSeconds = Math.min(config.emailOtp.resendCooldownSeconds, Math.max(1, Math.ceil(remainingMs / 1000)));
  const error = ApiError.tooManyRequests(`Please wait ${retryAfterSeconds} second${retryAfterSeconds === 1 ? '' : 's'} before requesting a new code.`);
  error.retryAfterSeconds = retryAfterSeconds; // read by middleware/errorHandler.js
  return error;
};

/**
 * Creates a reset code, stores its hash and emails it. Any earlier code or reset token of the account is replaced
 * in the same write (so it stops working). The resend cooldown is enforced by that write: it only matches when the
 * previous request was at least `resendCooldownSeconds` ago; a parallel request hits the unique index and gets 429.
 * If the email cannot be sent the new code is removed again so the user can retry at once.
 * Throws ApiError: 429 (cooldown), 503 / 502 (email not configured / not sent).
 */
const issuePasswordResetOtp = async (user) => {
  const now = new Date();
  const cooldownSeconds = config.emailOtp.resendCooldownSeconds;
  const cutoff = new Date(now.getTime() - cooldownSeconds * 1000);

  const otp = generateOtp();
  const otpHash = codeHash(user._id, otp);

  try {
    await PasswordReset.findOneAndUpdate(
      { user: user._id, lastSentAt: { $lte: cutoff } },
      {
        $set: { stage: 'otp', otpHash, expiresAt: new Date(now.getTime() + OTP_TTL_MS), lastSentAt: now, attempts: 0 },
        $unset: { resetTokenHash: 1 },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
  } catch (err) {
    if (err && err.code === 11000) throw await buildCooldownError(user._id, now);
    throw err;
  }

  try {
    await sendOtpEmail({ to: user.email, name: user.name, otp, expiresInMinutes: OTP_TTL_SECONDS / 60, purpose: 'password-reset' });
  } catch (err) {
    try {
      await PasswordReset.deleteOne({ user: user._id, otpHash });
    } catch (cleanupError) {
      logger.error(`Could not remove an unsent password reset code (user ${user._id}): ${cleanupError.message}`);
    }
    throw err;
  }

  return { expiresInSeconds: OTP_TTL_SECONDS, resendCooldownSeconds: cooldownSeconds, sentTo: maskEmail(user.email) };
};

/**
 * Checks the emailed code. A correct code is consumed and exchanged for a one-time reset token (returned once).
 * Same guarantees as verifyEmailOtp: expiry checked in the query, every guess counted atomically BEFORE comparing
 * (max config.emailOtp.maxAttempts per code, then locked), single use, comparison on the keyed hash only.
 * @param {{ _id: any } | null} user  null = no eligible account (answered like a wrong code)
 * Resolves { resetToken, expiresInSeconds }. Throws ApiError 400 (invalid / expired / wrong) or 429 (locked).
 */
const verifyPasswordResetOtp = async (user, otp) => {
  if (!user) throw ApiError.badRequest(INVALID_CODE_MESSAGE);

  const maxAttempts = config.emailOtp.maxAttempts;
  const now = new Date();

  const record = await PasswordReset.findOneAndUpdate(
    { user: user._id, stage: 'otp', expiresAt: { $gt: now }, attempts: { $not: { $gte: maxAttempts } } },
    { $inc: { attempts: 1 } },
    { returnDocument: 'after' }
  );

  if (!record) {
    const current = await PasswordReset.findOne({ user: user._id, stage: 'otp' });
    if (current && current.expiresAt > now && current.attempts >= maxAttempts) throw tooManyAttemptsError();
    throw ApiError.badRequest(INVALID_CODE_MESSAGE);
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  const verifiedAt = new Date();
  const exchanged = await PasswordReset.findOneAndUpdate(
    { user: user._id, stage: 'otp', otpHash: codeHash(user._id, otp), expiresAt: { $gt: verifiedAt } },
    {
      $set: { stage: 'verified', resetTokenHash: tokenHash(user._id, resetToken), expiresAt: new Date(verifiedAt.getTime() + RESET_TOKEN_TTL_MS) },
      $unset: { otpHash: 1 },
    },
    { returnDocument: 'after' }
  );
  if (exchanged) return { resetToken, expiresInSeconds: RESET_TOKEN_TTL_SECONDS };

  const remaining = Math.max(0, maxAttempts - (record.attempts || 0));
  if (remaining === 0) throw tooManyAttemptsError();
  const error = ApiError.badRequest(`Incorrect reset code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`);
  error.attemptsRemaining = remaining;
  throw error;
};

/**
 * Consumes a reset token (single use, atomic). Resolves when it was valid for this user; throws 400 otherwise.
 * Unknown users, wrong tokens, expired tokens and already used tokens all get the same answer.
 */
const consumeResetToken = async (user, token) => {
  if (!user || typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) throw ApiError.badRequest(INVALID_TOKEN_MESSAGE);
  const consumed = await PasswordReset.findOneAndDelete({
    user: user._id,
    stage: 'verified',
    resetTokenHash: tokenHash(user._id, token),
    expiresAt: { $gt: new Date() },
  });
  if (!consumed) throw ApiError.badRequest(INVALID_TOKEN_MESSAGE);
};

module.exports = {
  issuePasswordResetOtp,
  verifyPasswordResetOtp,
  consumeResetToken,
  RESET_TOKEN_TTL_SECONDS,
};

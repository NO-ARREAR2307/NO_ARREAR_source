'use strict';

const mongoose = require('mongoose');

// The pending password reset of ONE account (at most one document per user, unique index), so a new
// request replaces the previous code / token at the moment it is stored.
//
//   stage 'otp'      : a 6-digit code was emailed; only its keyed hash is stored (never the plain code).
//   stage 'verified' : the code was entered correctly and consumed; a one-time reset token was issued
//                      and only ITS keyed hash is stored. The token is what authorises the new password.
//
// Plain codes and tokens are never stored, logged or returned by any endpoint except the token, which is
// returned once by POST /api/auth/verify-reset-otp.
const passwordResetSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: [true, 'User is required'], unique: true },
    stage: { type: String, enum: ['otp', 'verified'], default: 'otp' },
    otpHash: { type: String, select: false },
    resetTokenHash: { type: String, select: false },
    // The code (stage 'otp') or the token (stage 'verified') is invalid from this moment on.
    expiresAt: { type: Date, required: [true, 'Expiry time is required'] },
    // When the current code was issued. Drives the resend cooldown.
    lastSentAt: { type: Date, required: [true, 'Send time is required'] },
    // Guesses against the current code; reset to 0 when a new code is issued.
    attempts: { type: Number, default: 0, min: 0 },
  },
  { timestamps: false }
);

// MongoDB removes expired documents (about once a minute); every check also compares expiresAt itself.
passwordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('PasswordReset', passwordResetSchema);

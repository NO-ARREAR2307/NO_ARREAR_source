'use strict';

const mongoose = require('mongoose');

// The pending email-verification code of ONE student. There is at most one document per user
// (unique index), so issuing a new code replaces the previous one: the old code stops working at
// the same moment the new one is stored.
//
// Only a keyed hash of the code is stored (see services/otpService.js). The plain 6-digit code
// exists only in memory while the email is being sent and is never written to the database,
// a log or an API response.
const emailOtpSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User is required'],
      unique: true,
    },
    // HMAC-SHA256 (hex) of the code. Never selected by default.
    otpHash: {
      type: String,
      required: [true, 'OTP hash is required'],
      select: false,
    },
    // The code is invalid from this moment on (5 minutes after it was issued).
    expiresAt: { type: Date, required: [true, 'Expiry time is required'] },
    // When the current code was issued. Drives the resend cooldown.
    lastSentAt: { type: Date, required: [true, 'Send time is required'] },
    // Wrong/used guesses against THIS code. Reset to 0 whenever a new code is issued; when it reaches
    // OTP_MAX_ATTEMPTS the code is locked. Documents issued before this field existed have none (= 0).
    attempts: { type: Number, default: 0, min: 0 },
  },
  { timestamps: false }
);

// MongoDB deletes expired documents automatically (its cleanup runs about once a minute, so the
// code must still be checked against expiresAt when it is verified).
emailOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('EmailOtp', emailOtpSchema);

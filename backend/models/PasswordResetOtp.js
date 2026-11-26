'use strict';

const mongoose = require('mongoose');

// Password reset codes. Kept in its own collection, separate from EmailOtp (email verification), so
// a verification code can never be used to reset a password and the two flows cannot overwrite each
// other. At most one document per student (unique index on `user`).
const passwordResetOtpSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  // HMAC-SHA256 of the 6-digit code (see services/otpService.js). The plain code is never stored.
  otpHash: { type: String, required: true },
  // End of the code's validity. After a correct code it is moved to the end of the reset token's validity.
  // MongoDB's TTL index on this field only removes old documents; every query still checks it explicitly.
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  lastSentAt: { type: Date, required: true },
  attempts: { type: Number, default: 0 },
  // Set to true only by a correct code (POST /verify-reset-otp). Required by POST /reset-password.
  verified: { type: Boolean, default: false },
  // HMAC of the one-time reset token handed out after verification (the token itself is not stored).
  resetTokenHash: { type: String },
  resetTokenExpiresAt: { type: Date },
});

module.exports = mongoose.model('PasswordResetOtp', passwordResetOtpSchema);

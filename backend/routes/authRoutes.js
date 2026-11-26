'use strict';

const express = require('express');
const {
  register, login, getProfile, resendOtp, verifyEmail, forgotPassword, verifyResetOtp, resetPassword,
} = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const {
  otpResendLimiter, otpVerifyLimiter, passwordResetRequestLimiter, passwordResetVerifyLimiter,
} = require('../middleware/rateLimiter');

const router = express.Router();

// Mounted at /api/auth (see routes/index.js).
router.post('/register', register); // POST /api/auth/register
router.post('/login', login); // POST /api/auth/login
router.post('/resend-otp', otpResendLimiter, resendOtp); // POST /api/auth/resend-otp (new email verification code)
router.post('/verify-email', otpVerifyLimiter, verifyEmail); // POST /api/auth/verify-email (6-digit code from the email)
router.post('/forgot-password', passwordResetRequestLimiter, forgotPassword); // POST /api/auth/forgot-password (emails a reset code)
router.post('/verify-reset-otp', passwordResetVerifyLimiter, verifyResetOtp); // POST /api/auth/verify-reset-otp (code -> reset token)
router.post('/reset-password', passwordResetVerifyLimiter, resetPassword); // POST /api/auth/reset-password (token + new password)
router.get('/profile', protect, getProfile); // GET  /api/auth/profile (JWT required)

module.exports = router;

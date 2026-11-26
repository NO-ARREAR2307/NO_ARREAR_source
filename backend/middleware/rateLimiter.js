'use strict';

const { rateLimit } = require('express-rate-limit');
const { config } = require('../config/env');
const ApiError = require('../utils/ApiError');

// General per-IP limiter applied to every API route.
const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.max,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res, next) => {
    next(ApiError.tooManyRequests('Too many requests. Please try again later.'));
  },
});

// Stricter limiter for the expensive extract endpoint. Counted per logged-in student, not per IP
// (it must run AFTER the protect middleware, which sets req.user).
const extractionLimiter = rateLimit({
  windowMs: config.extraction.userLimitWindowMs,
  limit: config.extraction.userLimitMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user._id),
  handler: (req, res, next) => {
    next(ApiError.tooManyRequests('Too many extraction requests. Please try again later.'));
  },
});

// Phase 4.3A: per-IP limiter for the public study material links (no login, so the client address is all there is).
// Every request counts, whether the token is valid or not, which also slows down anyone trying to guess tokens.
const sharedMaterialLimiter = rateLimit({
  windowMs: config.share.publicLimitWindowMs,
  limit: config.share.publicLimitMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res, next) => {
    next(ApiError.tooManyRequests('Too many requests for shared materials. Please try again later.'));
  },
});

// Per-IP limiter for POST /api/auth/resend-otp. It sits on top of the per-account cooldown in
// services/otpService.js and stops one client from asking for codes for many different accounts.
const otpResendLimiter = rateLimit({
  windowMs: config.emailOtp.resendLimitWindowMs,
  limit: config.emailOtp.resendLimitMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res, next) => {
    next(ApiError.tooManyRequests('Too many verification code requests. Please try again later.'));
  },
});

// Per-IP limiter for POST /api/auth/verify-email. The per-code attempt limit in services/otpService.js
// stops guessing a single code; this one stops one client from hammering many accounts.
const otpVerifyLimiter = rateLimit({
  windowMs: config.emailOtp.verifyLimitWindowMs,
  limit: config.emailOtp.verifyLimitMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res, next) => {
    next(ApiError.tooManyRequests('Too many verification attempts. Please try again later.'));
  },
});

// Password reset limiters (own counters, same limits as the email verification ones).
// forgot-password: one client cannot request reset codes for many accounts.
const passwordResetRequestLimiter = rateLimit({
  windowMs: config.emailOtp.resendLimitWindowMs,
  limit: config.emailOtp.resendLimitMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res, next) => {
    next(ApiError.tooManyRequests('Too many password reset requests. Please try again later.'));
  },
});

// verify-reset-otp and reset-password: one client cannot hammer many accounts.
const passwordResetVerifyLimiter = rateLimit({
  windowMs: config.emailOtp.verifyLimitWindowMs,
  limit: config.emailOtp.verifyLimitMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res, next) => {
    next(ApiError.tooManyRequests('Too many password reset attempts. Please try again later.'));
  },
});

module.exports = {
  apiLimiter,
  extractionLimiter,
  sharedMaterialLimiter,
  otpResendLimiter,
  otpVerifyLimiter,
  passwordResetRequestLimiter,
  passwordResetVerifyLimiter,
};

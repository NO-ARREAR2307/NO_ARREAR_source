'use strict';

const mongoose = require('mongoose');
const { config } = require('../config/env');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { redactShareTokens } = require('../utils/shareToken');

// Converts known library errors into ApiError. Returns null for unknown errors.
const toApiError = (err) => {
  if (err instanceof ApiError) return err;

  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
    return ApiError.badRequest('Validation failed', details);
  }

  if (err instanceof mongoose.Error.CastError) {
    return ApiError.badRequest(`Invalid value for "${err.path}"`);
  }

  if (err && err.code === 11000) {
    const fields = Object.keys(err.keyValue || {});
    return ApiError.conflict(fields.length ? `Duplicate value for: ${fields.join(', ')}` : 'Duplicate value');
  }

  if (err && err.type === 'entity.parse.failed') {
    return ApiError.badRequest('Malformed JSON in request body');
  }

  if (err && err.type === 'entity.too.large') {
    return new ApiError(413, 'Request body is too large');
  }

  return null;
};

// Central error handler: every error in the app ends up here.
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  const apiError = toApiError(err);
  const statusCode = apiError ? apiError.statusCode : 500;

  if (statusCode >= 500) {
    logger.error(`${req.method} ${redactShareTokens(req.originalUrl)} -> ${statusCode}`, err && err.stack ? err.stack : err);
  } else {
    logger.warn(`${req.method} ${redactShareTokens(req.originalUrl)} -> ${statusCode}: ${redactShareTokens(apiError.message)}`);
  }

  const message = apiError
    ? apiError.message
    : config.isProduction
      ? 'Internal server error'
      : (err && err.message) || 'Internal server error';

  const body = { success: false, message };
  if (apiError && apiError.details) body.errors = apiError.details;
  // Cooldown answers (for example a too-early OTP resend) tell the client how long to wait.
  if (apiError && Number.isInteger(apiError.retryAfterSeconds) && apiError.retryAfterSeconds > 0) {
    body.retryAfterSeconds = apiError.retryAfterSeconds;
    res.set('Retry-After', String(apiError.retryAfterSeconds));
  }
  // Machine-readable reason (for example EMAIL_NOT_VERIFIED) so a client can react without parsing the message.
  if (apiError && typeof apiError.errorCode === 'string') body.code = apiError.errorCode;
  // Wrong verification code: how many guesses are left before the code is locked.
  if (apiError && Number.isInteger(apiError.attemptsRemaining)) body.attemptsRemaining = apiError.attemptsRemaining;
  // Expected errors (ApiError, validation, duplicates, bad JSON) never carry a stack trace.
  // Only an UNEXPECTED error outside production gets one, so bugs stay easy to debug locally.
  // The full stack is always written to the server log above, never sent in production.
  if (!apiError && !config.isProduction && err && err.stack) body.stack = err.stack;

  return res.status(statusCode).json(body);
};

module.exports = errorHandler;

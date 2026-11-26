'use strict';

const jwt = require('jsonwebtoken');
const { config } = require('../config/env');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { isValidObjectId } = require('../validators/commonValidators');
const { isEmailVerificationRequired, emailNotVerifiedError } = require('../utils/emailVerification');

// utils/generateToken.js signs with jwt.sign({ id }, secret, { expiresIn }), which defaults to HS256.
const JWT_ALGORITHMS = ['HS256'];

// Extracts the token from "Authorization: Bearer <token>". Returns null if absent or malformed.
const getBearerToken = (req) => {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const [scheme, token, ...extra] = header.trim().split(/\s+/);
  if (extra.length > 0 || !token || scheme.toLowerCase() !== 'bearer') return null;
  return token;
};

/**
 * Protects a route: requires a valid JWT and attaches the logged-in student to req.user.
 * Usage (later): router.get('/me', protect, controller)
 */
const protect = async (req, res, next) => {
  try {
    const token = getBearerToken(req);
    if (!token) throw ApiError.unauthorized('Authentication required. Please log in.');

    if (!config.jwt.secret) {
      // Server misconfiguration: becomes a generic 500 and is logged, never shown to the client.
      throw new Error('JWT_SECRET is not set. Add it to .env before using authentication.');
    }

    let payload;
    try {
      payload = jwt.verify(token, config.jwt.secret, { algorithms: JWT_ALGORITHMS });
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw ApiError.unauthorized('Your session has expired. Please log in again.');
      }
      throw ApiError.unauthorized('Invalid authentication token.');
    }

    // Same payload shape as utils/generateToken.js: { id: "<user ObjectId string>" }.
    const userId = payload && payload.id;
    if (!isValidObjectId(userId)) throw ApiError.unauthorized('Invalid authentication token.');

    // The id comes only from the verified token, never from the request body or params.
    // password has select:false in the model, so the hash is not loaded here.
    const user = await User.findById(userId);
    if (!user) throw ApiError.unauthorized('The account for this token no longer exists.');

    // A student whose email is not verified gets no access, even with a still-valid token (for example
    // one issued before email verification was enforced). Admins are never blocked by this check.
    if (isEmailVerificationRequired(user)) throw emailNotVerifiedError();

    req.user = user;
    return next();
  } catch (err) {
    return next(err);
  }
};

module.exports = { protect };

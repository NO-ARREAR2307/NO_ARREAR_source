'use strict';

const jwt = require('jsonwebtoken');
const { config } = require('../config/env');

/**
 * Signs a JWT for the given user id using JWT_SECRET and JWT_EXPIRES_IN from the environment.
 * The payload only contains the user id (no email, no password data).
 */
const generateToken = (userId) => {
  if (!config.jwt.secret) {
    // Server misconfiguration: surfaces as a generic 500 and is logged by the error handler.
    throw new Error('JWT_SECRET is not set. Add it to .env before using authentication.');
  }
  return jwt.sign({ id: String(userId) }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
};

module.exports = generateToken;

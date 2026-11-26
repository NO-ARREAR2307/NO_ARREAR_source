'use strict';

const ApiError = require('../utils/ApiError');
const { ROLES, ROLE_VALUES } = require('../utils/roles');

/**
 * Builds a middleware that only lets users with one of the given roles through.
 * It must run AFTER middleware/authMiddleware.js (protect), which verifies the JWT and loads the
 * user from the database into req.user. The role is therefore always the CURRENT value stored in
 * the database - never a value from the token or from the request - so a role change (or a
 * deleted account) takes effect immediately.
 *
 *   401 - no authenticated user (protect did not run, or failed)
 *   403 - authenticated, but the role is not allowed
 *
 * Usage: router.get('/something', protect, authorizeRoles('admin'), controller)
 */
const authorizeRoles = (...roles) => {
  const allowed = roles.flat();
  if (allowed.length === 0 || allowed.some((role) => !ROLE_VALUES.includes(role))) {
    // Programming error: fail at start-up instead of silently leaving a route unprotected.
    throw new Error(`authorizeRoles() needs one or more of: ${ROLE_VALUES.join(', ')}`);
  }

  return (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized('Authentication required. Please log in.'));
    // Exact match: a user document without a valid role (for example a legacy record) is denied.
    if (!allowed.includes(req.user.role)) {
      return next(ApiError.forbidden('You do not have permission to access this resource.'));
    }
    return next();
  };
};

// Shortcut for admin-only routes: router.use(protect, requireAdmin)
const requireAdmin = authorizeRoles(ROLES.ADMIN);

module.exports = { authorizeRoles, requireAdmin };

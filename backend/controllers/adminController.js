'use strict';

const { sendSuccess } = require('../utils/apiResponse');
const { getAdminStats } = require('../services/adminStatsService');

// GET /api/admin/access-check   (protect -> requireAdmin, see routes/adminRoutes.js)
// Phase 0 verification endpoint: it only confirms that the caller is an authenticated admin.
const getAccessCheck = (req, res) =>
  sendSuccess(res, {
    message: 'Admin access granted',
    data: { admin: { id: req.user._id, name: req.user.name, email: req.user.email, role: req.user.role } },
  });

// GET /api/admin/stats   (protect -> requireAdmin, see routes/adminRoutes.js)
// Live totals for the admin dashboard, read from the database on every request (services/adminStatsService.js).
// Express 5 forwards a rejected promise to the central error handler, so a database failure answers a generic 500.
const getStats = async (req, res) => {
  const data = await getAdminStats();
  return sendSuccess(res, { message: 'Admin statistics retrieved successfully', data });
};

module.exports = { getAccessCheck, getStats };

'use strict';

const { sendSuccess } = require('../utils/apiResponse');
const logger = require('../utils/logger');
const ApiError = require('../utils/ApiError');
const { isValidObjectId } = require('../validators/commonValidators');
const { validateSaveRequest, validateListFilters } = require('../validators/savedQuestionSetValidators');
const savedQuestionSetService = require('../services/savedQuestionSetService');

// All handlers run after middleware/authMiddleware.js (protect). The student is always req.user._id, never a
// value from the body, query or params. Express 5 forwards rejected promises to the central error handler.

// POST /api/saved-question-sets
const saveQuestionSet = async (req, res) => {
  const input = validateSaveRequest(req.body);
  const data = await savedQuestionSetService.saveQuestionSet(req.user._id, input);
  logger.info(`Saved question set ${String(data._id)} by user ${String(req.user._id)}: subject=${input.subjectId} questions=${data.questionCount}`);
  return sendSuccess(res, { statusCode: 201, message: 'Question set saved successfully', data });
};

// GET /api/saved-question-sets?page=&limit=&q=&subjectId=&semesterId=&departmentId=&shared=&sort=   (history, no questions)
const listQuestionSets = async (req, res) => {
  const filters = validateListFilters(req.query);
  const { records, meta } = await savedQuestionSetService.listQuestionSets(req.user._id, filters, req.pagination);
  return sendSuccess(res, { message: 'Saved question sets retrieved successfully', data: records, meta });
};

// GET /api/saved-question-sets/:id
const getQuestionSet = async (req, res) => {
  const data = await savedQuestionSetService.getQuestionSet(req.user._id, req.params.id);
  return sendSuccess(res, { message: 'Saved question set retrieved successfully', data });
};

// DELETE /api/saved-question-sets/:id
const deleteQuestionSet = async (req, res) => {
  await savedQuestionSetService.deleteQuestionSet(req.user._id, req.params.id);
  logger.info(`Deleted saved question set ${req.params.id} by user ${String(req.user._id)}`);
  return sendSuccess(res, { message: 'Saved question set deleted successfully' });
};

// POST /api/saved-question-sets/:id/share  (owner only; repeating it returns the same link)
const enableSharing = async (req, res) => {
  const { alreadyShared, ...data } = await savedQuestionSetService.enableSharing(req.user._id, req.params.id);
  if (!alreadyShared) logger.info(`Sharing enabled for saved question set ${req.params.id} by user ${String(req.user._id)}`);
  return sendSuccess(res, { message: alreadyShared ? 'Question set is already shared' : 'Sharing enabled successfully', data });
};

// DELETE /api/saved-question-sets/:id/share  (owner only)
const revokeSharing = async (req, res) => {
  const data = await savedQuestionSetService.revokeSharing(req.user._id, req.params.id);
  logger.info(`Sharing revoked for saved question set ${req.params.id} by user ${String(req.user._id)}`);
  return sendSuccess(res, { message: 'Sharing revoked successfully', data });
};

// GET /api/shared/question-sets/:token  (public, read-only, no login)
const getSharedQuestionSet = async (req, res) => {
  const data = await savedQuestionSetService.getSharedQuestionSet(req.params.token);
  // The link can be revoked at any moment, so it must never be served from a browser or proxy cache,
  // and the token in the URL must not leak to other sites through the Referer header.
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  return sendSuccess(res, { message: 'Shared question set retrieved successfully', data });
};

// ---------------------------------------------------------------------------------------------------------------------
// Admin read access. Mounted ONLY in routes/adminRoutes.js, behind protect + requireAdmin, so a student gets 403 before any
// of this runs. Read-only: an admin cannot edit, delete or share a student's set through these handlers.
// ---------------------------------------------------------------------------------------------------------------------

// GET /api/admin/saved-question-sets?page=&limit=&q=&subjectId=&semesterId=&departmentId=&shared=&sort=&studentId=
const adminListQuestionSets = async (req, res) => {
  // studentId is the admin-only filter; the rest goes through the same validation as the student history.
  const { studentId, ...rest } = req.query;
  if (studentId !== undefined && !isValidObjectId(studentId)) {
    throw ApiError.badRequest('Validation failed', [{ field: 'studentId', message: 'studentId must be a valid id' }]);
  }
  const filters = validateListFilters(rest);
  const { records, meta } = await savedQuestionSetService.listAllQuestionSets(filters, req.pagination, { studentId });
  return sendSuccess(res, { message: 'Saved question sets retrieved successfully', data: records, meta });
};

// GET /api/admin/saved-question-sets/:id
const adminGetQuestionSet = async (req, res) => {
  const data = await savedQuestionSetService.getQuestionSetForAdmin(req.params.id);
  logger.info(`Saved question set ${req.params.id} viewed by admin ${String(req.user._id)}`);
  return sendSuccess(res, { message: 'Saved question set retrieved successfully', data });
};

module.exports = {
  saveQuestionSet,
  listQuestionSets,
  getQuestionSet,
  deleteQuestionSet,
  enableSharing,
  revokeSharing,
  getSharedQuestionSet,
  adminListQuestionSets,
  adminGetQuestionSet,
};

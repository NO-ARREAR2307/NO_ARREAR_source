'use strict';

const ApiError = require('../utils/ApiError');

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

const isValidObjectId = (value) => typeof value === 'string' && OBJECT_ID_PATTERN.test(value);

/**
 * Route middleware: ensures req.params[paramName] is a valid MongoDB ObjectId.
 * Usage: router.get('/:id', validateObjectIdParam('id'), controller)
 */
const validateObjectIdParam = (paramName = 'id') => (req, res, next) => {
  if (!isValidObjectId(req.params[paramName])) {
    return next(ApiError.badRequest(`Invalid "${paramName}": must be a valid MongoDB ObjectId`));
  }
  return next();
};

/**
 * Route middleware: validates ?page= and ?limit= and exposes
 * req.pagination = { page, limit, skip }.
 */
const validatePagination = ({ defaultLimit = 10, maxLimit = 100 } = {}) => (req, res, next) => {
  const page = req.query.page === undefined ? 1 : Number(req.query.page);
  const limit = req.query.limit === undefined ? defaultLimit : Number(req.query.limit);

  if (!Number.isInteger(page) || page < 1) {
    return next(ApiError.badRequest('"page" must be a positive integer'));
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    return next(ApiError.badRequest(`"limit" must be an integer between 1 and ${maxLimit}`));
  }

  req.pagination = { page, limit, skip: (page - 1) * limit };
  return next();
};

module.exports = { isValidObjectId, validateObjectIdParam, validatePagination };

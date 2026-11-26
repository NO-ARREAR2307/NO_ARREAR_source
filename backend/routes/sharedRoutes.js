'use strict';

const express = require('express');
const { getSharedQuestionSet } = require('../controllers/savedQuestionSetController');
const { getSharedMaterial, downloadSharedMaterialFile } = require('../controllers/paperShareController');
const { sharedMaterialLimiter } = require('../middleware/rateLimiter');
const ApiError = require('../utils/ApiError');

const router = express.Router();

// Phase 2C: public, read-only access to a shared question set. Mounted at /api/shared (see routes/index.js).
// There is NO protect middleware here on purpose: the unguessable token in the URL is the access.
// Nothing on this router can change data; every method other than GET/HEAD is refused.
router.get('/question-sets/:token', getSharedQuestionSet);
router.all('/question-sets/:token', (req, res, next) => {
  res.set('Allow', 'GET, HEAD');
  next(new ApiError(405, 'Method not allowed. Shared question sets are read-only.'));
});

// Phase 4.3A: public, read-only access to a shared study material (metadata and the file itself).
// Same rules as above: no protect middleware (the token is the access), GET/HEAD only. A per-IP limiter counts every
// request, valid token or not, so tokens cannot be tried at speed.
router.get('/materials/:token', sharedMaterialLimiter, getSharedMaterial);
router.get('/materials/:token/file', sharedMaterialLimiter, downloadSharedMaterialFile);
router.all(['/materials/:token', '/materials/:token/file'], (req, res, next) => {
  res.set('Allow', 'GET, HEAD');
  next(new ApiError(405, 'Method not allowed. Shared materials are read-only.'));
});

module.exports = router;

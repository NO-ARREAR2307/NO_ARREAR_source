'use strict';

const express = require('express');
const {
  uploadPaper,
  extractPaper,
  listPapers,
  getPaper,
  updatePaper,
  deletePaper,
  downloadPaperFile,
} = require('../controllers/paperController');
const { enableSharing, getSharingStatus, revokeSharing } = require('../controllers/paperShareController');
const { protect } = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');
const { uploadPaperFile } = require('../middleware/uploadMiddleware');
const { extractionLimiter } = require('../middleware/rateLimiter');
const { validateObjectIdParam, validatePagination } = require('../validators/commonValidators');
const { validateListQuery } = require('../validators/paperValidators');
const { ROLES } = require('../utils/roles');

const router = express.Router();

// Mounted at /api/papers (see routes/index.js). These are the study materials of Phase 4.1; the same endpoints
// (and the same Paper model, upload folder and extraction code) have served question papers since Phase 0.
//
// EVERY route below sits behind both guards, in this order:
//   1. protect            - valid JWT and a verified account (401 otherwise), BEFORE any file is read or stored
//   2. authorizeRoles(..) - the CURRENT role in the database must be student or admin (403 otherwise)
// Which materials a student or an admin may touch is then decided inside each query (utils/paperAccess.js):
//   admin -> every material, student -> only their own (someone else's material answers 404).
router.use(protect, authorizeRoles(ROLES.STUDENT, ROLES.ADMIN));

router.get('/', validatePagination({ defaultLimit: 20, maxLimit: 100 }), validateListQuery, listPapers); // GET /api/papers
router.post('/upload', uploadPaperFile, uploadPaper); // POST /api/papers/upload
router.get('/:paperId', validateObjectIdParam('paperId'), getPaper); // GET /api/papers/:paperId
router.patch('/:paperId', validateObjectIdParam('paperId'), updatePaper); // PATCH /api/papers/:paperId
router.delete('/:paperId', validateObjectIdParam('paperId'), deletePaper); // DELETE /api/papers/:paperId
router.get('/:paperId/file', validateObjectIdParam('paperId'), downloadPaperFile); // GET /api/papers/:paperId/file
router.post('/:paperId/extract', validateObjectIdParam('paperId'), extractionLimiter, extractPaper); // POST /api/papers/:paperId/extract

// Phase 4.3A: secure sharing. Same guards as above; only the material's owner or an admin may create, replace, revoke or
// look at a link (anyone else answers 404). The public side (opening a link) lives in routes/sharedRoutes.js.
router.get('/:paperId/share', validateObjectIdParam('paperId'), getSharingStatus); // GET /api/papers/:paperId/share
router.post('/:paperId/share', validateObjectIdParam('paperId'), enableSharing); // POST /api/papers/:paperId/share[?replace=true]
router.delete('/:paperId/share', validateObjectIdParam('paperId'), revokeSharing); // DELETE /api/papers/:paperId/share

module.exports = router;

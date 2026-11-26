'use strict';

const express = require('express');
const {
  saveQuestionSet,
  listQuestionSets,
  getQuestionSet,
  deleteQuestionSet,
  enableSharing,
  revokeSharing,
} = require('../controllers/savedQuestionSetController');
const { protect } = require('../middleware/authMiddleware');
const { validateObjectIdParam, validatePagination } = require('../validators/commonValidators');
const { limitSaveBodySize } = require('../validators/savedQuestionSetValidators');

const router = express.Router();

// Mounted at /api/saved-question-sets (see routes/index.js). protect runs first on every route.
router.use(protect);

router.post('/', limitSaveBodySize, saveQuestionSet); // save a generated question set
router.get('/', validatePagination({ defaultLimit: 10, maxLimit: 50 }), listQuestionSets); // my history: search, filters, sort, pagination (no questions)
router.get('/:id', validateObjectIdParam('id'), getQuestionSet); // one of my sets, with questions
router.delete('/:id', validateObjectIdParam('id'), deleteQuestionSet); // delete one of my sets
router.post('/:id/share', validateObjectIdParam('id'), enableSharing); // Phase 2C: make my set public via a link
router.delete('/:id/share', validateObjectIdParam('id'), revokeSharing); // Phase 2C: stop sharing (link dies at once)

module.exports = router;

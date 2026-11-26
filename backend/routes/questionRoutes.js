'use strict';

const express = require('express');
const { askQuestion, askQuestionStream } = require('../controllers/questionController');
const {
  generateImportantQuestions,
  generateImportantAnswers,
  listGeneratedSets,
  getGeneratedSet,
  deleteGeneratedSet,
} = require('../controllers/importantQuestionController');
const { protect } = require('../middleware/authMiddleware');
const { validateObjectIdParam, validatePagination } = require('../validators/commonValidators');

const router = express.Router();

// Mounted at /api/questions (see routes/index.js).
// protect runs first, so unauthenticated requests never reach the validation or the AI service.
router.post('/ask', protect, askQuestion); // POST /api/questions/ask
router.post('/ask/stream', protect, askQuestionStream); // POST /api/questions/ask/stream (Server-Sent Events)
router.post('/important', protect, generateImportantQuestions); // POST /api/questions/important (stage 1: important exam questions only, no answers)
router.post('/important/:generationId/answers', protect, validateObjectIdParam('generationId'), generateImportantAnswers); // stage 2: answers for the selected questions
router.get('/important', protect, validatePagination({ defaultLimit: 10, maxLimit: 50 }), listGeneratedSets); // my generated sets (no questions)
router.get('/important/:generationId', protect, validateObjectIdParam('generationId'), getGeneratedSet); // one of my sets: all questions + stored answers
router.delete('/important/:generationId', protect, validateObjectIdParam('generationId'), deleteGeneratedSet); // delete one of my generated sets

module.exports = router;

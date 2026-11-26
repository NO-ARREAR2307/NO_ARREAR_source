'use strict';

const { sendSuccess } = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { ROLES } = require('../utils/roles');
const { validateImportantQuestionRequest, validateAnswerRequest } = require('../validators/importantQuestionValidators');
const importantQuestionService = require('../services/importantQuestionService');
const answerGenerationService = require('../services/answerGenerationService');
const generatedQuestionSetService = require('../services/generatedQuestionSetService');

// POST /api/questions/important   (protected by middleware/authMiddleware.js, see routes/questionRoutes.js)
// Stage 1: questions only, no answers. Express 5 forwards rejected promises from async handlers to the central error handler,
// which answers with a client-safe message: Gemini details, the API key and stack traces never reach the response.
const generateImportantQuestions = async (req, res) => {
  const input = validateImportantQuestionRequest(req.body);
  // req.user is loaded from the database by protect, so the role is the current stored value, never a client value.
  const isAdmin = req.user.role === ROLES.ADMIN;
  const { data, meta } = await importantQuestionService.generateImportantQuestions(input, { userId: req.user._id, isAdmin });

  // Audit line: who asked for which subject and how much came back (never the question text).
  logger.info(
    `Important questions for ${req.user.role} ${String(req.user._id)}: subject=${input.subjectId} papers=${input.paperIds.length} difficulty=${input.difficulty} requested=${meta.requested} generated=${meta.generated} generation=${data.generationId}`
  );
  return sendSuccess(res, { message: 'Important questions generated successfully', data, meta });
};

// POST /api/questions/important/:generationId/answers   (protected; the :generationId format is checked in the route)
// Stage 2: answers for the selected questions of the caller's own generated set.
const generateImportantAnswers = async (req, res) => {
  const { questionIds } = validateAnswerRequest(req.body);
  const generationId = req.params.generationId.toLowerCase();
  const isAdmin = req.user.role === ROLES.ADMIN;
  const { data, meta } = await answerGenerationService.generateAnswersForQuestions({ generationId, questionIds }, { userId: req.user._id, isAdmin });

  logger.info(
    `Important question answers for ${req.user.role} ${String(req.user._id)}: generation=${generationId} requested=${meta.requested} generated=${meta.generated} alreadyAnswered=${meta.alreadyAnswered}`
  );
  return sendSuccess(res, { message: 'Answers generated successfully', data, meta });
};

// GET /api/questions/important?page=&limit=   (protected) - the caller's generated sets, newest first, without the questions.
const listGeneratedSets = async (req, res) => {
  const { records, meta } = await generatedQuestionSetService.listGeneratedSets(req.user._id, req.pagination);
  return sendSuccess(res, { message: 'Generated question sets retrieved successfully', data: records, meta });
};

// GET /api/questions/important/:generationId   (protected) - one of the caller's sets with all questions and stored answers.
const getGeneratedSet = async (req, res) => {
  const data = await generatedQuestionSetService.getGeneratedSet(req.user._id, req.params.generationId);
  return sendSuccess(res, { message: 'Generated question set retrieved successfully', data });
};

// DELETE /api/questions/important/:generationId   (protected) - deletes one of the caller's generated sets.
const deleteGeneratedSet = async (req, res) => {
  await generatedQuestionSetService.deleteGeneratedSet(req.user._id, req.params.generationId);
  logger.info(`Deleted generated question set ${req.params.generationId} by user ${String(req.user._id)}`);
  return sendSuccess(res, { message: 'Generated question set deleted successfully' });
};

module.exports = { generateImportantQuestions, generateImportantAnswers, listGeneratedSets, getGeneratedSet, deleteGeneratedSet };

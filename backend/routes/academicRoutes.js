'use strict';

const express = require('express');
const controller = require('../controllers/studentAcademicController');
const ApiError = require('../utils/ApiError');
const { protect } = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');
const { validateObjectIdParam } = require('../validators/commonValidators');

const router = express.Router();

// Mounted at /api/academic (see routes/index.js). READ-ONLY academic data for logged-in students and admins.
// Requests without a valid JWT get 401. Writes (creating, changing, deleting academic records) are not
// available here for anyone: they exist only under /api/admin and need the admin role.
router.use(protect, authorizeRoles('student', 'admin'));

router.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  res.set('Allow', 'GET, HEAD');
  return next(new ApiError(405, 'This API is read-only. Method not allowed.'));
});

router.get('/universities', controller.getUniversities); // GET /api/academic/universities
router.get('/universities/:universityId/departments', validateObjectIdParam('universityId'), controller.getDepartments);
router.get('/departments/:departmentId/regulations', validateObjectIdParam('departmentId'), controller.getRegulations);
router.get('/regulations/:regulationId/semesters', validateObjectIdParam('regulationId'), controller.getRegulationSemesters);
router.get('/departments/:departmentId/semesters', validateObjectIdParam('departmentId'), controller.getSemesters);
router.get('/semesters/:semesterId/subjects', validateObjectIdParam('semesterId'), controller.getSubjects);
router.get('/official-question-paper-portal', controller.getOfficialQuestionPaperPortal);

module.exports = router;

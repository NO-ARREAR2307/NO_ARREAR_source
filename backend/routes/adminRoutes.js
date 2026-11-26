'use strict';

const express = require('express');
const { getAccessCheck, getStats } = require('../controllers/adminController');
const academicController = require('../controllers/academicController');
const academicImportController = require('../controllers/academicImportController');
const { adminListQuestionSets, adminGetQuestionSet } = require('../controllers/savedQuestionSetController');
const { protect } = require('../middleware/authMiddleware');
const { requireAdmin } = require('../middleware/roleMiddleware');
const { validateObjectIdParam, validatePagination } = require('../validators/commonValidators');
const { limitImportBodySize } = require('../validators/academicImportValidators');

const router = express.Router();

// Mounted at /api/admin (see routes/index.js).
// Every route in this router requires a valid JWT (401 otherwise) AND the admin role (403 otherwise).
// Later admin features only need to be added below this line to inherit the protection.
router.use(protect, requireAdmin);

router.get('/access-check', getAccessCheck); // GET /api/admin/access-check
router.get('/stats', getStats); // GET /api/admin/stats (dashboard totals: students, courses, departments, subjects)

// Academic data: University -> Department -> Regulation -> Semester -> Subject.
// Each resource gets POST, GET (list), GET /:id, PUT /:id and DELETE /:id (deactivates, never removes).
const mountAcademicResource = (path, controller) => {
  router.post(`/${path}`, controller.create);
  router.get(`/${path}`, validatePagination({ defaultLimit: 20, maxLimit: 100 }), controller.list);
  router.get(`/${path}/:id`, validateObjectIdParam('id'), controller.get);
  router.put(`/${path}/:id`, validateObjectIdParam('id'), controller.update);
  router.delete(`/${path}/:id`, validateObjectIdParam('id'), controller.remove);
};

mountAcademicResource('universities', academicController.university);
mountAcademicResource('departments', academicController.department);
mountAcademicResource('regulations', academicController.regulation);
mountAcademicResource('semesters', academicController.semester);
mountAcademicResource('subjects', academicController.subject);

// Saved question sets of ALL students (read-only; the student routes under /api/saved-question-sets stay owner-only).
router.get('/saved-question-sets', validatePagination({ defaultLimit: 10, maxLimit: 50 }), adminListQuestionSets); // GET /api/admin/saved-question-sets
router.get('/saved-question-sets/:id', validateObjectIdParam('id'), adminGetQuestionSet); // GET /api/admin/saved-question-sets/:id (full set + answers + student)

// Bulk import of subjects into EXISTING semesters of one regulation (dry run by default; never overwrites).
router.post('/academic-imports/subjects', limitImportBodySize, academicImportController.importSubjects); // POST /api/admin/academic-imports/subjects

module.exports = router;

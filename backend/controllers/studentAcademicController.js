'use strict';

const { sendSuccess } = require('../utils/apiResponse');
const academicReadService = require('../services/studentAcademicService');
const { buildPublicFilter } = require('../validators/academicValidators');
const { OFFICIAL_QUESTION_PAPER_PORTAL } = require('../config/academicPortal');

// Read-only handlers for /api/academic (see routes/academicRoutes.js). Express 5 forwards rejected
// promises from async handlers to the central error handler.

// GET /api/academic/universities
const getUniversities = async (req, res) => {
  const universities = await academicReadService.listUniversities();
  return sendSuccess(res, {
    message: 'Universities retrieved successfully',
    data: { universities },
    meta: { total: universities.length },
  });
};

// GET /api/academic/universities/:universityId/departments?level=UG|PG
const getDepartments = async (req, res) => {
  const departments = await academicReadService.listDepartments(req.params.universityId, buildPublicFilter('department', req.query));
  return sendSuccess(res, {
    message: 'Departments retrieved successfully',
    data: { departments },
    meta: { total: departments.length },
  });
};

// GET /api/academic/departments/:departmentId/regulations
const getRegulations = async (req, res) => {
  const regulations = await academicReadService.listRegulations(req.params.departmentId);
  return sendSuccess(res, {
    message: 'Regulations retrieved successfully',
    data: { regulations },
    meta: { total: regulations.length },
  });
};

// GET /api/academic/regulations/:regulationId/semesters
const getRegulationSemesters = async (req, res) => {
  const semesters = await academicReadService.listSemestersOfRegulation(req.params.regulationId);
  return sendSuccess(res, {
    message: 'Semesters retrieved successfully',
    data: { semesters },
    meta: { total: semesters.length },
  });
};

// GET /api/academic/departments/:departmentId/semesters?regulation=<id>
const getSemesters = async (req, res) => {
  const semesters = await academicReadService.listSemesters(req.params.departmentId, buildPublicFilter('semester', req.query));
  return sendSuccess(res, {
    message: 'Semesters retrieved successfully',
    data: { semesters },
    meta: { total: semesters.length },
  });
};

// GET /api/academic/semesters/:semesterId/subjects?subjectType=&category=
const getSubjects = async (req, res) => {
  const subjects = await academicReadService.listSubjects(req.params.semesterId, buildPublicFilter('subject', req.query));
  return sendSuccess(res, {
    message: 'Subjects retrieved successfully',
    data: { subjects, choiceGroups: academicReadService.buildChoiceGroups(subjects) },
    meta: { total: subjects.length },
  });
};

// GET /api/academic/official-question-paper-portal  (static configuration: nothing is fetched from the portal)
const getOfficialQuestionPaperPortal = (req, res) =>
  sendSuccess(res, {
    message: 'Official question paper portal retrieved successfully',
    data: { portal: OFFICIAL_QUESTION_PAPER_PORTAL },
  });

module.exports = {
  getUniversities,
  getDepartments,
  getRegulations,
  getRegulationSemesters,
  getSemesters,
  getSubjects,
  getOfficialQuestionPaperPortal,
};

'use strict';

const { sendSuccess } = require('../utils/apiResponse');
const { validateBody, buildListFilter } = require('../validators/academicValidators');
const academicService = require('../services/academicService');

// Admin CRUD handlers for University, Department, Regulation, Semester and Subject. Mounted in routes/adminRoutes.js
// behind protect + requireAdmin. Express 5 forwards rejected promises from async handlers to the
// central error handler. DELETE deactivates (isActive=false); records are never physically removed.

const RESOURCES = {
  university: { label: 'University', plural: 'universities' },
  department: { label: 'Department', plural: 'departments' },
  regulation: { label: 'Regulation', plural: 'regulations' },
  semester: { label: 'Semester', plural: 'semesters' },
  subject: { label: 'Subject', plural: 'subjects' },
};

const buildController = (key) => {
  const { label, plural } = RESOURCES[key];

  return {
    // POST /api/admin/<plural>
    create: async (req, res) => {
      const input = validateBody(key, req.body);
      const record = await academicService.createRecord(key, input);
      return sendSuccess(res, { statusCode: 201, message: `${label} created successfully`, data: { [key]: record } });
    },

    // GET /api/admin/<plural>?page=&limit=&isActive=&<parent>=
    list: async (req, res) => {
      const filter = buildListFilter(key, req.query);
      const { records, meta } = await academicService.listRecords(key, filter, req.pagination);
      return sendSuccess(res, { message: `${label} list retrieved successfully`, data: { [plural]: records }, meta });
    },

    // GET /api/admin/<plural>/:id
    get: async (req, res) => {
      const record = await academicService.getRecord(key, req.params.id);
      return sendSuccess(res, { message: `${label} retrieved successfully`, data: { [key]: record } });
    },

    // PUT /api/admin/<plural>/:id   (only the fields that are sent are changed)
    update: async (req, res) => {
      const input = validateBody(key, req.body, { partial: true });
      const record = await academicService.updateRecord(key, req.params.id, input);
      return sendSuccess(res, { message: `${label} updated successfully`, data: { [key]: record } });
    },

    // DELETE /api/admin/<plural>/:id   (safe deactivation)
    remove: async (req, res) => {
      const { record, alreadyInactive } = await academicService.deactivateRecord(key, req.params.id);
      return sendSuccess(res, {
        message: alreadyInactive ? `${label} was already deactivated` : `${label} deactivated successfully`,
        data: { [key]: record },
      });
    },
  };
};

module.exports = {
  university: buildController('university'),
  department: buildController('department'),
  regulation: buildController('regulation'),
  semester: buildController('semester'),
  subject: buildController('subject'),
};

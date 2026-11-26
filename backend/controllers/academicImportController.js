'use strict';

const { sendSuccess } = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { validateImportRequest } = require('../validators/academicImportValidators');
const academicImportService = require('../services/academicImportService');

// Admin-only bulk import handlers. Mounted in routes/adminRoutes.js behind protect + requireAdmin, so a missing
// token is 401 and a student is 403 before any code here runs. Express 5 forwards rejected promises from async
// handlers to the central error handler (no stack traces reach the client in production).

// POST /api/admin/academic-imports/subjects
const importSubjects = async (req, res) => {
  const input = validateImportRequest(req.body);
  const report = await academicImportService.importSubjects(input);

  // Audit trail: who ran which import and what it did (counts only, no record contents).
  logger.info(
    `Academic subject import by admin ${String(req.user._id)}: regulation=${report.regulation.id} dryRun=${report.dryRun} ` +
      `received=${report.totalReceived} imported=${report.imported} skipped=${report.skipped} failed=${report.failed}`
  );

  const message = report.dryRun
    ? 'Dry run completed. Nothing was written to the database.'
    : `Import completed: ${report.imported} imported, ${report.skipped} skipped, ${report.failed} failed.`;
  return sendSuccess(res, { message, data: report });
};

module.exports = { importSubjects };

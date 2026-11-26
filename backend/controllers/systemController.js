'use strict';

const healthService = require('../services/healthService');
const { sendSuccess } = require('../utils/apiResponse');

// GET /api
const getApiInfo = (req, res) => {
  sendSuccess(res, {
    message: 'Welcome to the STUDYWISE AI API',
    data: healthService.getApiInfo(),
  });
};

// GET /api/health
const getHealth = (req, res) => {
  sendSuccess(res, {
    message: 'STUDYWISE AI API is running',
    data: healthService.getHealthStatus(),
  });
};

module.exports = { getApiInfo, getHealth };

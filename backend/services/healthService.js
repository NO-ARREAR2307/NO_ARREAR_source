'use strict';

const { config } = require('../config/env');
const pkg = require('../package.json');

const getApiInfo = () => ({
  name: 'STUDYWISE AI API',
  version: pkg.version,
  environment: config.nodeEnv,
  endpoints: {
    health: `${config.apiPrefix}/health`,
    register: `${config.apiPrefix}/auth/register`,
    login: `${config.apiPrefix}/auth/login`,
    verifyEmail: `${config.apiPrefix}/auth/verify-email`,
    resendOtp: `${config.apiPrefix}/auth/resend-otp`,
    profile: `${config.apiPrefix}/auth/profile`,
    uploadPaper: `${config.apiPrefix}/papers/upload`,
    extractPaper: `${config.apiPrefix}/papers/:paperId/extract`,
    listPapers: `${config.apiPrefix}/papers`,
    getPaper: `${config.apiPrefix}/papers/:paperId`,
    updatePaper: `${config.apiPrefix}/papers/:paperId`,
    deletePaper: `${config.apiPrefix}/papers/:paperId`,
    downloadPaperFile: `${config.apiPrefix}/papers/:paperId/file`,
  },
});

const getHealthStatus = () => ({
  status: 'ok',
  service: pkg.name,
  version: pkg.version,
  environment: config.nodeEnv,
  uptimeSeconds: Math.round(process.uptime()),
  timestamp: new Date().toISOString(),
});

module.exports = { getApiInfo, getHealthStatus };

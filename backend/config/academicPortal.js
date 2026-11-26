'use strict';

// Official University of Madras question paper portal. Only the link is kept here, for the frontend to
// open in the student's browser. The backend never fetches, scrapes, copies or hosts anything from it.
// Fixed on purpose (not an environment variable) so the exact official URL cannot drift.
const OFFICIAL_QUESTION_PAPER_PORTAL = Object.freeze({
  name: 'University of Madras Official Question Paper Portal',
  url: 'https://egovernance.unom.ac.in/qpregular/FrmStudDownloadQP.ASPX?IDE_REG=REG',
  description: 'Access official model and previous-year question papers.',
});

module.exports = { OFFICIAL_QUESTION_PAPER_PORTAL };

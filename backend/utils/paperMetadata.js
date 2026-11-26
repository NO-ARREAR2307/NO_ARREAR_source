'use strict';

// Single source of truth for the metadata of a study material (Phase 4.1). Used by the Paper model,
// the request validators and the controller so the limits can never drift apart.

const MATERIAL_TYPES = Object.freeze(['question_paper', 'notes', 'syllabus', 'other']);
const DEFAULT_MATERIAL_TYPE = 'question_paper'; // everything uploaded before Phase 4.1 is a question paper

const TITLE_MAX_LENGTH = 150;
const DESCRIPTION_MAX_LENGTH = 1000;
const SEARCH_MAX_LENGTH = 100;

const EXTRACTION_STATUSES = Object.freeze(['pending', 'processing', 'completed', 'failed']);

module.exports = {
  MATERIAL_TYPES,
  DEFAULT_MATERIAL_TYPE,
  TITLE_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  SEARCH_MAX_LENGTH,
  EXTRACTION_STATUSES,
};

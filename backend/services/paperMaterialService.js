'use strict';

const Paper = require('../models/Paper');
const ApiError = require('../utils/ApiError');
const { config } = require('../config/env');

// Phase 3C-2: loads the text of the student's own uploaded papers (PDF text layer or image OCR, already extracted by
// POST /api/papers/:paperId/extract) so the important-question generator can use it as its ONLY content source.
//
//  * Ownership is part of the database query (uploadedBy), so another student's paper is indistinguishable from a paper
//    that does not exist: both are a plain 404 "Paper not found" and nothing about the other paper is revealed.
//  * The one exception is an admin: the same rule as the study material APIs (utils/paperAccess.js) applies, so an admin may
//    use ANY student's uploaded material for generation. The caller passes isAdmin only from the role stored in the database
//    (req.user.role, loaded by protect), never from the request, and a student can never turn it on.
//  * Only papers whose extraction is "completed" are used.
//  * extractedText is a select:false field; it is requested explicitly here and never returned to the client.
//  * The text is normalised (page breaks and control characters) but NEVER shortened. If the combined text is over the
//    configured limit the request is refused with a clear message, so the AI never sees a silently cut-off paper.

const OCR_LOW_CONFIDENCE = 60; // same threshold as services/extractionService.js
const CUT_OFF_PATTERN = /was cut off\.?$/i;

// Page breaks (\f) become a blank line; control characters other than \n and \t are removed; runs of blank lines and
// trailing spaces are collapsed. The result is what is counted against the limit AND what is sent to the model.
const normalizeMaterialText = (raw) =>
  String(raw || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\f/g, '\n\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const requestField = (index) => `paperIds[${index}]`;

// Extraction warnings for one paper. Papers extracted since Phase 3C-2 carry the exact warnings of their extraction run.
// Older papers have none stored, so what can be derived from their saved fields is reported instead (the image-rotation
// notice cannot be recovered for those).
const extractionWarningsFor = (paper) => {
  const raw = typeof paper.extractedText === 'string' ? paper.extractedText : '';
  let warnings;
  if (Array.isArray(paper.extractionWarnings)) {
    warnings = [...paper.extractionWarnings];
  } else {
    warnings = [];
    if (paper.fileType !== 'image' && paper.extractionMethod !== 'ocr') {
      const blank = [];
      raw.split('\f').forEach((page, index) => {
        if (page.trim() === '') blank.push(index + 1);
      });
      if (blank.length > 0 && blank.length < raw.split('\f').length) {
        warnings.push(`No text found on page(s): ${blank.join(', ')} (they may be blank or scanned).`);
      }
    } else if (typeof paper.ocrConfidence === 'number' && paper.ocrConfidence < OCR_LOW_CONFIDENCE) {
      warnings.push('The image was hard to read, so some text may be wrong. A clearer photo or scan gives better results.');
    }
  }
  // A text stored at exactly the extraction ceiling was cut off when it was saved: the questions can only cover its start.
  const { maxTextChars } = config.extraction;
  if (raw.length >= maxTextChars && !warnings.some((w) => CUT_OFF_PATTERN.test(w))) {
    warnings.push(`The extracted text was longer than ${maxTextChars} characters and was cut off.`);
  }
  return warnings;
};

/**
 * Loads the extracted text of the given papers for one user (a student: their own papers only; an admin: any paper).
 * @param {{ paperIds: string[], userId: any, isAdmin?: boolean }} input paperIds are validated, distinct, lower-case ObjectIds (1-3)
 * @returns {Promise<{ materials: {id: string, text: string}[], papers: object[], extractionWarnings: object[], totalCharacters: number }>}
 * Throws ApiError: 404 (missing or not owned), 409 (extraction not finished), 422 (extraction failed, too little text,
 * or more text than the limit allows).
 */
const loadPaperMaterial = async ({ paperIds, userId, isAdmin = false }) => {
  // Only a literal `true` lifts the ownership rule; anything else (missing, "true", 1) keeps it.
  const access = isAdmin === true ? {} : { uploadedBy: userId };
  const found = await Paper.find({ _id: { $in: paperIds }, ...access })
    .select('+extractedText +extractionWarnings')
    .lean();
  const byId = new Map(found.map((paper) => [String(paper._id).toLowerCase(), paper]));

  // Keep the order the student chose.
  const missing = [];
  const ordered = paperIds.map((id, index) => {
    const paper = byId.get(id);
    if (!paper) missing.push({ field: requestField(index), message: 'Paper not found' });
    return paper;
  });
  if (missing.length > 0) throw new ApiError(404, 'Paper not found', missing);

  // Only finished extractions can be used.
  const notReady = [];
  let anyFailed = false;
  ordered.forEach((paper, index) => {
    if (paper.extractionStatus === 'completed') return;
    if (paper.extractionStatus === 'failed') {
      anyFailed = true;
      notReady.push({ field: requestField(index), message: 'Text extraction failed for this paper. Upload it again or re-run the extraction.' });
    } else if (paper.extractionStatus === 'processing') {
      notReady.push({ field: requestField(index), message: 'Text extraction for this paper is still in progress. Try again when it has finished.' });
    } else {
      notReady.push({ field: requestField(index), message: 'Text has not been extracted from this paper yet. Extract it first (POST /api/papers/:paperId/extract).' });
    }
  });
  if (notReady.length > 0) {
    throw new ApiError(anyFailed ? 422 : 409, 'Every selected paper must have completed text extraction', notReady);
  }

  const { minMaterialChars, maxMaterialChars } = config.questionGeneration;
  const materials = [];
  const papers = [];
  const extractionWarnings = [];
  const tooLittle = [];
  let totalCharacters = 0;

  ordered.forEach((paper, index) => {
    const text = normalizeMaterialText(paper.extractedText);
    if (text.length < minMaterialChars) {
      tooLittle.push({ field: requestField(index), message: `This paper has too little readable text to generate questions from (at least ${minMaterialChars} characters are needed).` });
      return;
    }
    totalCharacters += text.length;
    const id = `M${index + 1}`;
    materials.push({ id, text });
    papers.push({
      paperId: String(paper._id),
      originalName: paper.originalName,
      fileType: paper.fileType || 'pdf',
      extractionMethod: paper.extractionMethod || null,
      pageCount: typeof paper.pageCount === 'number' ? paper.pageCount : null,
      characters: text.length,
    });
    const warnings = extractionWarningsFor(paper);
    if (warnings.length > 0) extractionWarnings.push({ paperId: String(paper._id), originalName: paper.originalName, warnings });
  });
  if (tooLittle.length > 0) throw new ApiError(422, 'Not enough readable text in the selected paper(s)', tooLittle);

  // Never truncate: refuse instead.
  if (totalCharacters > maxMaterialChars) {
    throw new ApiError(
      422,
      `The selected papers contain ${totalCharacters} characters of text, which is over the limit of ${maxMaterialChars} characters per request. ` +
        'Select fewer or shorter papers. Nothing was cut off or sent to the AI.',
      papers.map((paper, index) => ({ field: requestField(index), message: `${paper.characters} characters` }))
    );
  }

  return { materials, papers, extractionWarnings, totalCharacters };
};

module.exports = { loadPaperMaterial, normalizeMaterialText, extractionWarningsFor };

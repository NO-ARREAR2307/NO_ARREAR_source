'use strict';

const { config } = require('../config/env');
const { extractPdfText } = require('./pdfExtractionService');
const { recognizeImage } = require('./ocrService');

/**
 * Picks the right extraction method for an already-verified file.
 * @param {{ buffer: Buffer, kind: 'pdf' | 'image' }} input
 * @returns {Promise<{ text: string, method: 'pdf-text'|'ocr', pageCount: number,
 *                     confidence: number|null, truncated: boolean, warnings: string[] }>}
 */
const extractText = async ({ buffer, kind }) => {
  let text;
  let method;
  let pageCount;
  let confidence = null;
  const warnings = [];

  if (kind === 'pdf') {
    const result = await extractPdfText(buffer);
    text = result.text;
    method = 'pdf-text';
    pageCount = result.pageCount;
    if (result.emptyPages.length > 0) {
      warnings.push(`No text found on page(s): ${result.emptyPages.join(', ')} (they may be blank or scanned).`);
    }
  } else {
    const result = await recognizeImage(buffer);
    text = result.text;
    method = 'ocr';
    pageCount = result.pageCount;
    confidence = result.confidence;
    if (result.confidence < 60) {
      warnings.push('The image was hard to read, so some text may be wrong. A clearer photo or scan gives better results.');
    }
    if (result.rotation !== 0) {
      warnings.push(`The image appeared rotated; it was read after rotating it ${result.rotation} degrees.`);
    }
  }

  // Keep the saved document comfortably below MongoDB's 16 MB limit.
  const { maxTextChars } = config.extraction;
  const truncated = text.length > maxTextChars;
  if (truncated) {
    text = text.slice(0, maxTextChars);
    warnings.push(`The extracted text was longer than ${maxTextChars} characters and was cut off.`);
  }

  return { text, method, pageCount, confidence, truncated, warnings };
};

module.exports = { extractText };

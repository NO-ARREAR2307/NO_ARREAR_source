'use strict';

const { config } = require('../config/env');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

// pdfjs-dist is an ES module, so it is loaded with a dynamic import() (works from CommonJS).
// The "legacy" build is the one meant for Node.js.
let pdfjsPromise = null;
const loadPdfjs = () => {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').catch((err) => {
      pdfjsPromise = null; // allow a retry
      throw err;
    });
  }
  return pdfjsPromise;
};

// A PDF whose total readable text is below this is treated as a scan (images only).
const MIN_TEXT_CHARS = 20;

const countReadableChars = (text) => (text.match(/[\p{L}\p{N}]/gu) || []).length;

// Tidies the text of ONE page: removes control characters, trailing spaces and runs of blank lines.
const cleanPageText = (text) =>
  text
    .replace(/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// Rebuilds readable lines from pdf.js text items (which arrive as small fragments).
const pageItemsToText = (items) => {
  let text = '';
  let lastY = null;
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    const y = Array.isArray(item.transform) ? item.transform[5] : null;
    const lineHeight = item.height || 8;
    if (lastY !== null && y !== null && Math.abs(y - lastY) > lineHeight * 0.5 && text && !text.endsWith('\n')) {
      text += '\n';
    }
    text += item.str;
    if (item.hasEOL && !text.endsWith('\n')) text += '\n';
    if (y !== null) lastY = y;
  }
  return text;
};

// Maps a pdf.js failure to a clear, client-safe ApiError. The original error is only logged.
const toPdfError = (err) => {
  if (err instanceof ApiError) return err;
  const name = (err && err.name) || '';
  if (name === 'PasswordException') {
    return new ApiError(422, 'This PDF is password-protected. Remove the password and upload it again.');
  }
  logger.warn(`PDF could not be read (${name || 'Error'}): ${(err && err.message) || 'unknown error'}`);
  return new ApiError(422, 'This PDF is corrupted or could not be read. Please upload a valid PDF.');
};

/**
 * Extracts the text layer of a PDF, page by page, in page order.
 * @param {Buffer} buffer the PDF file content
 * @returns {Promise<{ text: string, pages: string[], pageCount: number, emptyPages: number[] }>}
 *   `text` is the pages joined with a form feed (\f) so page boundaries survive.
 * Throws ApiError (422) for corrupted, password-protected, scanned or too-long PDFs.
 */
const extractPdfText = async (buffer) => {
  const pdfjs = await loadPdfjs();
  const { pdfTimeoutMs, maxPdfPages } = config.extraction;

  let loadingTask = null;
  let timer = null;
  let timedOut = false;

  const work = (async () => {
    loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer), // pdf.js wants a Uint8Array, not a Buffer
      isEvalSupported: false, // never evaluate generated code from a PDF
      enableXfa: false,
      useSystemFonts: false,
      disableFontFace: true,
      stopAtErrors: false,
      verbosity: 0,
    });

    const doc = await loadingTask.promise;
    if (doc.numPages > maxPdfPages) {
      throw new ApiError(422, `This PDF has ${doc.numPages} pages. The maximum supported is ${maxPdfPages}.`);
    }

    const pages = [];
    const emptyPages = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      if (timedOut) break;
      const page = await doc.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const text = cleanPageText(pageItemsToText(content.items));
        pages.push(text);
        if (countReadableChars(text) === 0) emptyPages.push(pageNumber);
      } finally {
        page.cleanup();
      }
    }
    return { pages, emptyPages, pageCount: doc.numPages };
  })();

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new ApiError(422, 'Reading this PDF took too long and was stopped. Try a smaller or simpler file.'));
    }, pdfTimeoutMs);
  });

  let result;
  try {
    result = await Promise.race([work, timeout]);
  } catch (err) {
    throw toPdfError(err);
  } finally {
    clearTimeout(timer);
    work.catch(() => {}); // a late failure after a timeout must not become an unhandled rejection
    if (loadingTask) loadingTask.destroy().catch(() => {});
  }

  const text = result.pages.join('\f');
  if (countReadableChars(text) < MIN_TEXT_CHARS) {
    throw new ApiError(
      422,
      'No extractable text was found. This PDF looks like a scan (pages are images). ' +
        'Upload the pages as JPG or PNG images so they can be read with OCR.'
    );
  }

  return { text, pages: result.pages, pageCount: result.pageCount, emptyPages: result.emptyPages };
};

module.exports = { extractPdfText, MIN_TEXT_CHARS };

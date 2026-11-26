'use strict';

const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const Paper = require('../models/Paper');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { sendSuccess } = require('../utils/apiResponse');
const {
  ALLOWED_DESCRIPTION,
  STORED_NAME_PATTERN,
  detectFileType,
  getTypeByMime,
  getTypeByStoredName,
} = require('../utils/fileSignature');
const { accessFilterForId, accessFilterForList } = require('../utils/paperAccess');
const { ROLES } = require('../utils/roles');
const { DEFAULT_MATERIAL_TYPE } = require('../utils/paperMetadata');
const { parseMetadata, defaultTitleFromFileName } = require('../validators/paperValidators');
const { extractText } = require('../services/extractionService');
const {
  PAPERS_UPLOAD_DIR,
  MAX_UPLOAD_SIZE_BYTES,
  UPLOAD_FIELD_NAME,
} = require('../middleware/uploadMiddleware');

// A run still marked "processing" after this long is assumed to have crashed and may be retried.
const STALE_PROCESSING_MS = 10 * 60 * 1000;

// Builds the absolute path of a stored file, refusing anything that would leave uploads/papers.
const resolveStoredPath = (storedName) => {
  const name = String(storedName);
  // Stored names are always "<uuid>.pdf|jpg|png". A tampered database value is refused outright.
  if (!STORED_NAME_PATTERN.test(name)) {
    logger.error('Refusing to use an unexpected stored file name from the database');
    throw new ApiError(500, 'The stored file reference is invalid. Please upload the paper again.');
  }
  const resolved = path.resolve(PAPERS_UPLOAD_DIR, path.basename(name));
  if (path.dirname(resolved) !== path.resolve(PAPERS_UPLOAD_DIR)) {
    logger.error('Refusing to use a stored path outside the uploads directory');
    throw new ApiError(500, 'The stored file reference is invalid. Please upload the paper again.');
  }
  return resolved;
};

// Deletes a stored file. A failure here is logged but never hides the original error.
const removeStoredFile = async (filePath) => {
  try {
    await fs.promises.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') logger.error('Could not delete stored upload', err.message);
  }
};

// Keeps only a plain file name for the metadata field: no directories, no control characters.
const sanitizeOriginalName = (name) => {
  const base = path.basename(String(name || '').replace(/\\/g, '/'));
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!cleaned) return 'paper';
  if (cleaned.length <= 255) return cleaned;
  const ext = path.extname(cleaned);
  return cleaned.slice(0, 255 - ext.length) + ext;
};

// Phase 4.1: the ONLY shape in which a study material leaves the API. It is a whitelist, so a field added to the model
// later (and storedName, extractedText, extractionWarnings, extractionStartedAt) never leaks by accident.
// Papers uploaded before Phase 4.1 have no title or type: they are shown with their file name and as a question paper.
const serializePaper = (raw) => ({
  _id: String(raw._id),
  uploadedBy: raw.uploadedBy ? String(raw.uploadedBy) : null,
  title: raw.title || raw.originalName,
  description: raw.description || '',
  materialType: raw.materialType || DEFAULT_MATERIAL_TYPE,
  originalName: raw.originalName,
  size: raw.size,
  mimeType: raw.mimeType,
  fileType: raw.fileType || 'pdf',
  extractionStatus: raw.extractionStatus || 'pending',
  extractionError: raw.extractionError || null,
  extractionMethod: raw.extractionMethod || null,
  pageCount: typeof raw.pageCount === 'number' ? raw.pageCount : null,
  ocrConfidence: typeof raw.ocrConfidence === 'number' ? raw.ocrConfidence : null,
  extractedAt: raw.extractedAt || null,
  uploadedAt: raw.uploadedAt,
  updatedAt: raw.updatedAt || null,
  // Phase 4.3A: whether a public link is active. The token, its hash and who created the link are never part of it.
  isShared: raw.isShared === true,
  sharedAt: raw.isShared === true ? raw.sharedAt || null : null,
});

// Same as serializePaper for a Mongoose document.
const documentToResponse = (doc) => serializePaper(doc.toObject({ transform: false }));

// Admin only: who uploaded each material (name, email and academic profile), so an admin looking at every student's uploads can
// tell them apart and pick one. Students never get this field (their list only holds their own materials), and no account data
// other than these display fields is read (the password hash is not selectable anyway). `papers` are already serialized.
const attachUploaders = async (user, papers) => {
  if (!user || user.role !== ROLES.ADMIN || papers.length === 0) return papers;
  const ids = [...new Set(papers.map((paper) => paper.uploadedBy).filter(Boolean))];
  const accounts = await User.find({ _id: { $in: ids } }).select('name email role course department semester').lean();
  const byId = new Map(accounts.map((account) => [String(account._id), account]));
  return papers.map((paper) => {
    const account = byId.get(paper.uploadedBy);
    return {
      ...paper,
      uploader: account
        ? {
            _id: String(account._id),
            name: account.name,
            email: account.email,
            role: account.role || ROLES.STUDENT,
            course: account.course || null,
            department: account.department || null,
            semester: typeof account.semester === 'number' ? account.semester : null,
          }
        : null, // the uploader's account no longer exists; the material is still listed
    };
  });
};

// Deletes the stored file that belongs to a database record. Never throws: by the time this runs the record is already
// gone, and a leftover file (or a tampered name, which is refused) must not turn a completed delete into an error.
const removeStoredFileFor = async (storedName) => {
  try {
    await removeStoredFile(resolveStoredPath(storedName));
  } catch (err) {
    logger.error('Could not remove the stored file of a deleted paper', err && err.message ? err.message : err);
  }
};

// POST /api/papers/upload   (protected by middleware/authMiddleware.js, file parsed by uploadMiddleware.js)
const uploadPaper = async (req, res) => {
  const file = req.file;
  if (!file) {
    throw ApiError.badRequest(
      `No file uploaded. Send a ${ALLOWED_DESCRIPTION} as multipart/form-data in a field named "${UPLOAD_FIELD_NAME}".`
    );
  }

  const storedPath = resolveStoredPath(file.filename);
  let paper;

  try {
    // Metadata is validated first (cheap). Anything refused below removes the stored file again (see catch).
    const metadata = parseMetadata(req.body, { forUpdate: false });
    const originalName = sanitizeOriginalName(file.originalname);

    const { size } = await fs.promises.stat(storedPath);
    if (size === 0) throw ApiError.badRequest('The uploaded file is empty.');

    // Third check, after extension and MIME type: the real bytes at the start of the file.
    const detected = await detectFileType(storedPath);
    if (!detected) {
      throw ApiError.badRequest(`The uploaded file is not a valid ${ALLOWED_DESCRIPTION}.`);
    }
    const declared = getTypeByMime(file.mimetype);
    if (!declared || declared.key !== detected.key) {
      throw ApiError.badRequest('The file content does not match its extension or declared type.');
    }

    const document = {
      uploadedBy: req.user._id, // taken from the verified JWT, never from the request body
      originalName,
      title: metadata.title || defaultTitleFromFileName(originalName),
      materialType: metadata.materialType || DEFAULT_MATERIAL_TYPE,
      storedName: path.basename(storedPath),
      size,
      mimeType: detected.mime,
      fileType: detected.kind,
    };
    if (metadata.description) document.description = metadata.description;
    paper = await Paper.create(document);
  } catch (err) {
    // Rejected content or a failed database save must not leave an orphaned file on disk.
    await removeStoredFile(storedPath);
    if (err && err.code === 11000) throw new Error('Stored filename collision');
    throw err;
  }

  return sendSuccess(res, {
    statusCode: 201,
    message: 'Question paper uploaded successfully',
    data: { paper: documentToResponse(paper) },
  });
};

// The paper as sent to the client. The (possibly large) text is returned separately as `extractedText`.
const toPaperResponse = (paper) => documentToResponse(paper);

// Saves a failed extraction on the paper. Never throws: it must not hide the original error.
const markExtractionFailed = async (paperId, message) => {
  try {
    await Paper.updateOne(
      { _id: paperId },
      {
        $set: {
          extractionStatus: 'failed',
          extractionError: String(message).slice(0, 500),
          extractionMethod: null,
          pageCount: null,
          ocrConfidence: null,
          extractedAt: null,
          extractionStartedAt: null,
        },
        $unset: { extractedText: '', extractionWarnings: '' },
      }
    );
  } catch (err) {
    logger.error(`Could not record extraction failure for paper ${paperId}: ${err.message}`);
  }
};

// Reads the stored file after checking that it exists, is a regular file, is not oversized and
// that its real content (magic bytes) still matches the type it was stored as.
const verifyStoredFile = async (paper) => {
  const storedPath = resolveStoredPath(paper.storedName);

  let stats;
  try {
    stats = await fs.promises.stat(storedPath);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
      throw ApiError.notFound('The stored file for this paper is missing on the server. Please upload the paper again.');
    }
    throw err;
  }

  if (!stats.isFile() || stats.size === 0 || stats.size > MAX_UPLOAD_SIZE_BYTES) {
    throw new ApiError(422, 'The stored file is empty, too large or damaged. Please upload the paper again.');
  }

  const detected = await detectFileType(storedPath);
  const expected = getTypeByStoredName(paper.storedName);
  if (!detected || !expected || detected.key !== expected.key) {
    throw new ApiError(422, 'The stored file is corrupted or is not a valid PDF, JPG or PNG. Please upload the paper again.');
  }

  return { storedPath, stats, detected };
};

const readVerifiedFile = async (paper) => {
  const { storedPath, detected } = await verifyStoredFile(paper);
  const buffer = await fs.promises.readFile(storedPath);
  return { buffer, kind: detected.kind };
};

// POST /api/papers/:paperId/extract   (protect -> validate id -> per-user limiter -> this handler)
// Add ?force=true to re-run an extraction that already completed.
const extractPaper = async (req, res) => {
  const { paperId } = req.params;
  const force = req.query.force === 'true';

  // Access is part of the query (utils/paperAccess.js): a student's request for another student's paper is simply
  // "not found" (no 403 that would confirm the paper exists). An admin may extract any paper.
  const access = accessFilterForId(req.user, paperId);
  const existing = await Paper.findOne(access);
  if (!existing) throw ApiError.notFound('Paper not found');

  if (existing.extractionStatus === 'completed' && !force) {
    const cached = await Paper.findOne(access).select('+extractedText');
    return sendSuccess(res, {
      message: 'Text was already extracted for this paper',
      data: { paper: toPaperResponse(cached), extractedText: cached.extractedText || '', cached: true, warnings: [] },
    });
  }

  // Claim the paper atomically so two simultaneous requests cannot both run the extraction.
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);
  const claimed = await Paper.findOneAndUpdate(
    {
      ...access,
      $or: [{ extractionStatus: { $ne: 'processing' } }, { extractionStartedAt: { $lte: staleBefore } }],
    },
    { $set: { extractionStatus: 'processing', extractionError: null, extractionStartedAt: new Date() } },
    { returnDocument: 'after' }
  );
  if (!claimed) throw ApiError.conflict('Extraction for this paper is already in progress.');

  let result;
  try {
    const { buffer, kind } = await readVerifiedFile(claimed);
    result = await extractText({ buffer, kind });
  } catch (err) {
    // Expected problems (missing/corrupted file, scanned PDF, no text...) keep their clear message.
    // Anything else is a bug or an outage: store a generic message and let the handler answer 500.
    const operational = err instanceof ApiError;
    await markExtractionFailed(paperId, operational ? err.message : 'Extraction failed because of an internal error.');
    if (operational) throw err;
    // The full error (with stack) goes to the server log only. The client gets a generic message,
    // even outside production, so server paths and library internals are never exposed.
    logger.error(`Extraction crashed for paper ${paperId}`, err && err.stack ? err.stack : err);
    throw new ApiError(500, 'Extraction failed because of an internal error.');
  }

  const paper = await Paper.findOneAndUpdate(
    { _id: paperId },
    {
      $set: {
        extractedText: result.text,
        extractionStatus: 'completed',
        extractionError: null,
        extractionWarnings: result.warnings,
        extractionMethod: result.method,
        pageCount: result.pageCount,
        ocrConfidence: result.confidence,
        extractedAt: new Date(),
        extractionStartedAt: null,
      },
    },
    { returnDocument: 'after', runValidators: true }
  );
  // The paper was deleted while its text was being extracted: nothing is left to save the result on.
  if (!paper) throw ApiError.notFound('Paper not found');

  logger.info(`Extraction completed for paper ${paperId} (${result.method}, ${result.text.length} characters)`);

  return sendSuccess(res, {
    message: result.method === 'ocr' ? 'Text recognized from the image successfully' : 'Text extracted from the PDF successfully',
    data: {
      paper: toPaperResponse(paper),
      extractedText: result.text,
      truncated: result.truncated,
      warnings: result.warnings,
    },
  });
};

// ---------------------------------------------------------------------------------------------------------------------
// Phase 4.1: study material management. Every handler below runs behind protect + authorizeRoles (routes/paperRoutes.js)
// and applies utils/paperAccess.js inside its database query: admin -> all materials, student -> only their own.
// ---------------------------------------------------------------------------------------------------------------------

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const LIST_SORTS = {
  newest: { uploadedAt: -1, _id: -1 },
  oldest: { uploadedAt: 1, _id: 1 },
  title: { title: 1, _id: 1 },
};

// GET /api/papers   (?page&limit&materialType&extractionStatus&search&sort, plus ?uploadedBy for admins)
const listPapers = async (req, res) => {
  const { page, limit, skip } = req.pagination;
  const query = req.listQuery || { sort: 'newest' };

  const filter = { ...accessFilterForList(req.user) };
  if (query.uploadedBy) filter.uploadedBy = query.uploadedBy; // validateListQuery only lets an admin set this
  if (query.extractionStatus) filter.extractionStatus = query.extractionStatus;
  if (query.materialType) {
    // Papers uploaded before Phase 4.1 have no stored type and count as question papers ({ $in: [.., null] } matches a missing field).
    filter.materialType = query.materialType === DEFAULT_MATERIAL_TYPE ? { $in: [DEFAULT_MATERIAL_TYPE, null] } : query.materialType;
  }
  if (query.search) {
    // The text is escaped, so it is always matched literally (no regular-expression injection, no catastrophic patterns).
    const pattern = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [{ title: pattern }, { originalName: pattern }];
  }

  const [total, rows] = await Promise.all([
    Paper.countDocuments(filter),
    Paper.find(filter).sort(LIST_SORTS[query.sort] || LIST_SORTS.newest).skip(skip).limit(limit).lean(),
  ]);

  return sendSuccess(res, {
    message: 'Study materials retrieved successfully',
    data: { papers: await attachUploaders(req.user, rows.map(serializePaper)) },
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
};

// GET /api/papers/:paperId
const getPaper = async (req, res) => {
  const paper = await Paper.findOne(accessFilterForId(req.user, req.params.paperId)).lean();
  if (!paper) throw ApiError.notFound('Paper not found');
  const [shown] = await attachUploaders(req.user, [serializePaper(paper)]);
  return sendSuccess(res, { message: 'Study material retrieved successfully', data: { paper: shown } });
};

// PATCH /api/papers/:paperId   body: any of { title, description, materialType }
// The owner check and the write are ONE atomic operation (the filter contains the access rule), and only whitelisted,
// validated fields are written: ownership, storage and extraction fields cannot be changed here.
const updatePaper = async (req, res) => {
  const changes = parseMetadata(req.body, { forUpdate: true });

  const $set = { updatedAt: new Date() };
  const $unset = {};
  if (changes.title !== undefined) $set.title = changes.title;
  if (changes.materialType !== undefined) $set.materialType = changes.materialType;
  if (changes.description !== undefined) {
    if (changes.description === '') $unset.description = '';
    else $set.description = changes.description;
  }
  const update = Object.keys($unset).length > 0 ? { $set, $unset } : { $set };

  const paper = await Paper.findOneAndUpdate(accessFilterForId(req.user, req.params.paperId), update, {
    returnDocument: 'after',
    runValidators: true,
  }).lean();
  if (!paper) throw ApiError.notFound('Paper not found');

  return sendSuccess(res, { message: 'Study material updated successfully', data: { paper: serializePaper(paper) } });
};

// DELETE /api/papers/:paperId
// Removes the database record first (atomically, with the access rule in the filter) and then the stored file.
// Question sets generated from the paper keep working until they expire, but asking for their answers (stage 2) will
// answer "Paper not found", because the source text is gone.
const deletePaper = async (req, res) => {
  const paper = await Paper.findOneAndDelete(accessFilterForId(req.user, req.params.paperId)).lean();
  if (!paper) throw ApiError.notFound('Paper not found');

  await removeStoredFileFor(paper.storedName);
  logger.info(`Paper ${String(paper._id)} deleted by ${req.user.role} ${String(req.user._id)}`);

  return sendSuccess(res, { message: 'Study material deleted successfully', data: { _id: String(paper._id) } });
};

// Content-Disposition with a plain-ASCII fallback name and the real name in RFC 5987 form.
const buildContentDisposition = (disposition, fileName) => {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\%;]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
};

// GET /api/papers/:paperId/file   (?download=true to force a download instead of showing it in the browser)
// The uploads folder is never served statically. This is the only way to read a stored file, and it applies the same
// access rule as every other endpoint. The Content-Type comes from the bytes that were verified, never from the client.
const downloadPaperFile = async (req, res) => {
  const paper = await Paper.findOne(accessFilterForId(req.user, req.params.paperId)).lean();
  if (!paper) throw ApiError.notFound('Paper not found');

  const { storedPath, stats, detected } = await verifyStoredFile(paper);
  const disposition = req.query.download === 'true' ? 'attachment' : 'inline';

  res.set({
    'Content-Type': detected.mime,
    'Content-Length': String(stats.size),
    'Content-Disposition': buildContentDisposition(disposition, sanitizeOriginalName(paper.originalName)),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  });

  try {
    await pipeline(fs.createReadStream(storedPath), res);
  } catch (err) {
    // Nothing has been sent yet: let the error handler answer. Otherwise the client went away or the read failed midway.
    if (!res.headersSent) throw err;
    logger.warn(`File stream for paper ${String(paper._id)} ended early: ${err && err.message ? err.message : err}`);
    res.destroy();
  }
};

module.exports = {
  uploadPaper,
  extractPaper,
  listPapers,
  getPaper,
  updatePaper,
  deletePaper,
  downloadPaperFile,
  serializePaper,
  // Reused by the public share controller (Phase 4.3A) so a shared file is checked and sent exactly like an owner's.
  verifyStoredFile,
  buildContentDisposition,
  sanitizeOriginalName,
};


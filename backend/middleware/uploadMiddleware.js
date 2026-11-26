'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const ApiError = require('../utils/ApiError');
const { ALLOWED_DESCRIPTION, getTypeByExtension, getTypeByMime } = require('../utils/fileSignature');

// Private storage folder (backend/uploads/papers). It is NOT mounted as a static folder in app.js.
// PAPERS_UPLOAD_DIR may point somewhere else (the tests use a temporary folder); when it is not set nothing changes.
const PAPERS_UPLOAD_DIR = process.env.PAPERS_UPLOAD_DIR
  ? path.resolve(process.env.PAPERS_UPLOAD_DIR)
  : path.join(__dirname, '..', 'uploads', 'papers');
const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB (PDF and images)
const UPLOAD_FIELD_NAME = 'file';

fs.mkdirSync(PAPERS_UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PAPERS_UPLOAD_DIR),
  // The storage name is always generated here (UUID + an extension chosen from the validated type).
  // The client's filename is never used for the path.
  filename: (req, file, cb) => {
    const type = getTypeByMime(file.mimetype);
    cb(null, `${crypto.randomUUID()}${type ? type.storedExt : '.bin'}`);
  },
});

// First line of defence: extension and declared MIME type, which must agree with each other.
// (The real file content is verified later in the controller by checking the magic bytes.)
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const typeByExt = getTypeByExtension(ext);
  if (!typeByExt) {
    return cb(new ApiError(415, `Unsupported file type. Allowed: ${ALLOWED_DESCRIPTION}.`));
  }
  if (file.mimetype !== typeByExt.mime) {
    return cb(new ApiError(415, `The file type does not match its extension. Allowed: ${ALLOWED_DESCRIPTION}.`));
  }
  return cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_UPLOAD_SIZE_BYTES,
    files: 1,
    fields: 10,
    fieldSize: 10 * 1024,
  },
}).single(UPLOAD_FIELD_NAME);

// Translates Multer / multipart errors into clean ApiErrors for the global error handler.
const toUploadError = (err) => {
  if (err instanceof ApiError) return err;

  if (err instanceof multer.MulterError) {
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return new ApiError(413, `File too large. The maximum allowed size is ${MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)} MB.`);
      case 'LIMIT_UNEXPECTED_FILE':
        return ApiError.badRequest(`Unexpected file field. Upload the file in a form field named "${UPLOAD_FIELD_NAME}".`);
      case 'LIMIT_FILE_COUNT':
        return ApiError.badRequest('Only one file can be uploaded at a time.');
      default:
        return ApiError.badRequest('Invalid upload request.');
    }
  }

  // Disk/system failures (EACCES, ENOSPC, ...) are real server errors: let the error handler report a 500.
  if (err && typeof err.code === 'string' && /^E[A-Z]+$/.test(err.code)) return err;

  // Broken multipart bodies (missing boundary, truncated upload, ...) are client mistakes.
  if (err && /multipart|boundary|unexpected end of form|malformed/i.test(err.message || '')) {
    return ApiError.badRequest('Malformed upload request. Send the file as multipart/form-data.');
  }

  return err;
};

const uploadPaperFile = (req, res, next) => {
  upload(req, res, (err) => (err ? next(toUploadError(err)) : next()));
};

module.exports = {
  uploadPaperFile,
  PAPERS_UPLOAD_DIR,
  MAX_UPLOAD_SIZE_BYTES,
  // Kept so any code written against the Day 1 name keeps working.
  MAX_PDF_SIZE_BYTES: MAX_UPLOAD_SIZE_BYTES,
  UPLOAD_FIELD_NAME,
};

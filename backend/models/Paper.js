'use strict';

const mongoose = require('mongoose');
const {
  MATERIAL_TYPES,
  DEFAULT_MATERIAL_TYPE,
  TITLE_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
} = require('../utils/paperMetadata');

// Metadata for an uploaded question paper (PDF, JPG, JPEG or PNG). The file itself lives in
// uploads/papers/ (never served publicly); this document records who uploaded it, how it is
// stored, and the result of text extraction (PDF text layer or image OCR).
const paperSchema = new mongoose.Schema(
  {
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Uploader is required'],
      index: true,
    },
    // ----- Phase 4.1 study material metadata (all optional, so every paper uploaded earlier stays valid) -----
    // Display name chosen by the uploader. Papers uploaded before Phase 4.1 have none; the API then shows originalName.
    title: {
      type: String,
      trim: true,
      maxlength: [TITLE_MAX_LENGTH, `Title cannot exceed ${TITLE_MAX_LENGTH} characters`],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [DESCRIPTION_MAX_LENGTH, `Description cannot exceed ${DESCRIPTION_MAX_LENGTH} characters`],
    },
    // Papers uploaded before Phase 4.1 are question papers, which is also the default.
    materialType: {
      type: String,
      enum: { values: MATERIAL_TYPES, message: 'Material type must be one of: ' + MATERIAL_TYPES.join(', ') },
      default: DEFAULT_MATERIAL_TYPE,
      index: true,
    },
    // Set only when the metadata is edited (PATCH /api/papers/:paperId). Extraction runs do not touch it.
    updatedAt: { type: Date, default: null },

    // The filename the student's computer had. Metadata only, never used as a storage path.
    originalName: {
      type: String,
      required: [true, 'Original filename is required'],
      trim: true,
      maxlength: [255, 'Original filename cannot exceed 255 characters'],
    },
    // Server-generated unique filename inside uploads/papers/.
    storedName: {
      type: String,
      required: [true, 'Stored filename is required'],
      unique: true,
      trim: true,
    },
    size: {
      type: Number,
      required: [true, 'File size is required'],
      min: [1, 'File size must be greater than 0'],
    },
    mimeType: {
      type: String,
      required: [true, 'MIME type is required'],
      enum: {
        values: ['application/pdf', 'image/jpeg', 'image/png'],
        message: 'Only PDF, JPG, JPEG and PNG files are supported',
      },
    },
    // 'pdf' -> text extraction, 'image' -> OCR. Papers uploaded before images were supported are PDFs.
    fileType: {
      type: String,
      enum: { values: ['pdf', 'image'], message: 'File type must be pdf or image' },
      default: 'pdf',
    },

    // ----- Phase 4.3A: secure sharing (all optional, so every material saved earlier stays valid and private) -----
    // A material is private unless isShared is true. Papers saved before Phase 4.3A have none of these fields.
    isShared: { type: Boolean, default: false },
    // SHA-256 hash of the share token (see utils/shareToken.js). The token itself is never stored; it is shown to the
    // owner once, inside the share URL. Absent whenever sharing is off. Never returned by the API (select: false).
    shareTokenHash: { type: String, select: false },
    sharedAt: { type: Date, default: null },
    // The user (the owner or an admin) who created the current link. Internal, kept for the audit trail.
    sharedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // ----- Extraction results (filled by POST /api/papers/:paperId/extract) -----
    extractionStatus: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
      index: true,
    },
    // Short, client-safe reason when extractionStatus is 'failed'. Never holds paths or stack traces.
    extractionError: { type: String, default: null, maxlength: 500 },
    // 'pdf-text' (text layer of a PDF) or 'ocr' (Tesseract on an image).
    extractionMethod: { type: String, enum: ['pdf-text', 'ocr', null], default: null },
    // Pages are separated by a form feed character (\f), in page order. Not loaded unless asked for.
    extractedText: { type: String, select: false },
    // Phase 3C-2: the warnings of the extraction run (blank pages, low OCR confidence, rotation, cut-off text), kept so
    // question generation can report them. Not loaded unless asked for and absent on papers extracted earlier.
    extractionWarnings: { type: [{ type: String, maxlength: 500 }], select: false, default: undefined },
    pageCount: { type: Number, min: 0, default: null },
    // Mean OCR confidence (0-100). Only set for images.
    ocrConfidence: { type: Number, min: 0, max: 100, default: null },
    extractedAt: { type: Date, default: null },
    // Set when an extraction starts; lets a crashed run be retried instead of staying "processing" forever.
    extractionStartedAt: { type: Date, default: null },
  },
  {
    // uploadedAt is the upload timestamp.
    timestamps: { createdAt: 'uploadedAt', updatedAt: false },
    toJSON: {
      // storedName is an internal storage detail; keep it out of API responses.
      transform: (doc, ret) => {
        delete ret.storedName;
        delete ret.extractionStartedAt;
        delete ret.extractionWarnings; // internal; question generation reads it directly
        delete ret.shareTokenHash; // Phase 4.3A: never leaves the server
        delete ret.sharedBy;
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      transform: (doc, ret) => {
        delete ret.storedName;
        delete ret.extractionStartedAt;
        delete ret.extractionWarnings; // internal; question generation reads it directly
        delete ret.shareTokenHash; // Phase 4.3A: never leaves the server
        delete ret.sharedBy;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Serves "my materials, newest first" (GET /api/papers for a student) without scanning other users' documents.
paperSchema.index({ uploadedBy: 1, uploadedAt: -1 });

// Phase 4.3A: public lookup by the hash of the share token. Unique, but only for materials that have a link:
// private materials (no hash) are not indexed, so they never collide with each other.
paperSchema.index({ shareTokenHash: 1 }, { unique: true, partialFilterExpression: { shareTokenHash: { $type: 'string' } } });

module.exports = mongoose.model('Paper', paperSchema);

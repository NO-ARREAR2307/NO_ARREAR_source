'use strict';

const Paper = require('../models/Paper');
const ApiError = require('../utils/ApiError');
const { config } = require('../config/env');
const { accessFilterForId } = require('../utils/paperAccess');
const { DEFAULT_MATERIAL_TYPE } = require('../utils/paperMetadata');
const { generateShareToken, hashShareToken, isWellFormedShareToken } = require('../utils/shareToken');

// Phase 4.3A: secure sharing of study materials (the existing Paper documents).
//
// Who may do what (the rule is part of every database query, never a check made after loading the document):
//   create / replace / revoke / see the status of a link:  the material's owner, or an admin (utils/paperAccess.js).
//       Anyone else gets the same 404 as for a material that does not exist, so a 403 never confirms that it exists.
//   open a shared material:                                  anyone who holds the link, no login.
//
// Tokens (utils/shareToken.js): 256 random bits, only their SHA-256 hash is stored, the token is shown to the owner
// once (in the share URL of the create response) and cannot be read back afterwards.
//
// State, always changed in ONE atomic write:
//   private  -> isShared=false, no shareTokenHash, sharedAt=null, no sharedBy       (also every paper saved earlier)
//   shared   -> isShared=true,  shareTokenHash=<hash>, sharedAt=<date>, sharedBy=<user>
// Revoking removes the hash, so the old link stops working at once and can never come back; sharing again makes a new token.

const NOT_FOUND = 'Paper not found';
const SHARED_NOT_FOUND = 'Shared material not found';

const shareBaseUrl = () => config.share.publicBaseUrl || (config.corsOrigins[0] || '').replace(/\/+$/, '');
const buildShareUrl = (token) => `${shareBaseUrl()}/shared/materials/${token}`;
const buildSharePath = (token) => `${config.apiPrefix}/shared/materials/${token}`;
const buildShareFilePath = (token) => `${config.apiPrefix}/shared/materials/${token}/file`;

const idOf = (value) => (value === null || value === undefined ? null : String(value));

/**
 * Owner or admin. Turns sharing on and returns the public link (the only time the token is visible).
 *  - A private material gets a link.
 *  - A material that is already shared is NOT touched (409), so a second click or a retry cannot silently replace a
 *    link that is already in use. Pass { replace: true } to deliberately issue a new token; the old link stops working.
 * Returns { _id, isShared, sharedAt, shareUrl, apiUrl, fileUrl, replaced }.
 */
const enableSharing = async (user, paperId, { replace = false } = {}) => {
  const access = accessFilterForId(user, paperId);
  const token = generateShareToken();
  const sharedAt = new Date();
  const $set = { isShared: true, shareTokenHash: hashShareToken(token), sharedAt, sharedBy: user._id };

  // Without `replace` the write only matches a material that has no link yet (shareTokenHash null or absent), so two
  // simultaneous requests cannot both succeed and replace each other's token: the second one sees a conflict.
  const filter = replace ? access : { ...access, shareTokenHash: null };
  const before = await Paper.findOneAndUpdate(filter, { $set }, { returnDocument: 'before' }).lean();

  if (before) {
    return {
      _id: String(before._id),
      isShared: true,
      sharedAt,
      shareUrl: buildShareUrl(token),
      apiUrl: buildSharePath(token),
      fileUrl: buildShareFilePath(token),
      replaced: before.isShared === true,
    };
  }

  // Nothing matched: the material is not visible to this user (or was deleted in between), or it is already shared.
  const existing = await Paper.findOne(access).lean();
  if (!existing) throw ApiError.notFound(NOT_FOUND);
  throw ApiError.conflict(
    'This material already has an active share link. The link is only shown when it is created; revoke it first, or repeat the request with ?replace=true to issue a new link (the old one stops working).'
  );
};

/** Owner or admin. Turns sharing off and destroys the token. Safe to call on a material that is not shared. */
const revokeSharing = async (user, paperId) => {
  const before = await Paper.findOneAndUpdate(
    accessFilterForId(user, paperId),
    { $set: { isShared: false, sharedAt: null }, $unset: { shareTokenHash: '', sharedBy: '' } },
    { returnDocument: 'before' }
  ).lean();
  if (!before) throw ApiError.notFound(NOT_FOUND);
  return { _id: String(before._id), isShared: false, sharedAt: null, wasShared: before.isShared === true };
};

/** Owner or admin. Whether the material is shared and since when. It can never return the link or the token. */
const getSharingStatus = async (user, paperId) => {
  const paper = await Paper.findOne(accessFilterForId(user, paperId)).lean();
  if (!paper) throw ApiError.notFound(NOT_FOUND);
  const shared = paper.isShared === true;
  return {
    _id: String(paper._id),
    isShared: shared,
    sharedAt: shared ? paper.sharedAt || null : null,
    sharedBy: shared ? idOf(paper.sharedBy) : null,
  };
};

/**
 * Public, no login. Returns the raw material for a token. Malformed, unknown, revoked and deleted-material tokens, and a
 * material that is no longer shared, all give the same 404; a malformed token is refused before any query is made.
 */
const findSharedMaterial = async (token) => {
  if (!isWellFormedShareToken(token)) throw ApiError.notFound(SHARED_NOT_FOUND);
  const paper = await Paper.findOne({ shareTokenHash: hashShareToken(token), isShared: true }).lean();
  if (!paper) throw ApiError.notFound(SHARED_NOT_FOUND);
  return paper;
};

// What a visitor with the link may see: a whitelist. No ids, no owner, no storage details, no extracted text, no
// extraction state, nothing about who shared it. The token is not repeated in the body, only in the file URL below.
const serializeSharedMaterial = (paper, token) => ({
  title: paper.title || paper.originalName,
  description: paper.description || '',
  materialType: paper.materialType || DEFAULT_MATERIAL_TYPE,
  fileName: paper.originalName,
  fileType: paper.fileType || 'pdf',
  mimeType: paper.mimeType,
  size: paper.size,
  pageCount: typeof paper.pageCount === 'number' ? paper.pageCount : null,
  uploadedAt: paper.uploadedAt || null,
  sharedAt: paper.sharedAt || null,
  fileUrl: buildShareFilePath(token),
});

module.exports = {
  NOT_FOUND,
  SHARED_NOT_FOUND,
  enableSharing,
  revokeSharing,
  getSharingStatus,
  findSharedMaterial,
  serializeSharedMaterial,
};

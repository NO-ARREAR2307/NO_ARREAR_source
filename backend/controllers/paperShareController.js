'use strict';

const fs = require('fs');
const { pipeline } = require('stream/promises');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { sendSuccess } = require('../utils/apiResponse');
const paperShareService = require('../services/paperShareService');
const { verifyStoredFile, buildContentDisposition, sanitizeOriginalName } = require('./paperController');

// Phase 4.3A handlers. The first three run behind protect + authorizeRoles (routes/paperRoutes.js) and apply the owner/admin
// rule inside the database query; the last two are PUBLIC (routes/sharedRoutes.js): the unguessable token is the access.

// Headers for everything a visitor with a link receives. A link can be revoked at any moment, so nothing may come from a
// browser or proxy cache; the token in the URL must not leak to other sites (Referer); search engines must not index it.
const setPublicHeaders = (res) => {
  res.set({
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff',
  });
};

// POST /api/papers/:paperId/share            create the link (owner or admin)
// POST /api/papers/:paperId/share?replace=true   issue a NEW link for an already shared material; the old one stops working
const enableSharing = async (req, res) => {
  const replace = req.query.replace === 'true';
  const data = await paperShareService.enableSharing(req.user, req.params.paperId, { replace });
  const { replaced, ...body } = data;
  // The response holds the only copy of the link: it must not be stored anywhere on the way.
  res.set('Cache-Control', 'no-store');
  // Never the token or the URL itself: only who did what to which material.
  logger.info(`Sharing ${replaced ? 'replaced' : 'enabled'} for paper ${body._id} by ${req.user.role} ${String(req.user._id)}`);
  return sendSuccess(res, {
    statusCode: replaced ? 200 : 201,
    message: replaced ? 'Share link replaced successfully. The previous link no longer works.' : 'Share link created successfully',
    data: body,
  });
};

// GET /api/papers/:paperId/share   (owner or admin)
const getSharingStatus = async (req, res) => {
  const data = await paperShareService.getSharingStatus(req.user, req.params.paperId);
  res.set('Cache-Control', 'no-store');
  return sendSuccess(res, { message: 'Sharing status retrieved successfully', data });
};

// DELETE /api/papers/:paperId/share   (owner or admin; harmless on a material that is not shared)
const revokeSharing = async (req, res) => {
  const { wasShared, ...data } = await paperShareService.revokeSharing(req.user, req.params.paperId);
  if (wasShared) logger.info(`Sharing revoked for paper ${data._id} by ${req.user.role} ${String(req.user._id)}`);
  res.set('Cache-Control', 'no-store');
  return sendSuccess(res, {
    message: wasShared ? 'Share link revoked successfully. The link no longer works.' : 'This material was not shared',
    data,
  });
};

// GET /api/shared/materials/:token   (public, read-only, no login)
const getSharedMaterial = async (req, res) => {
  const paper = await paperShareService.findSharedMaterial(req.params.token);
  setPublicHeaders(res);
  return sendSuccess(res, {
    message: 'Shared study material retrieved successfully',
    data: paperShareService.serializeSharedMaterial(paper, req.params.token),
  });
};

// GET /api/shared/materials/:token/file   (public; ?download=true forces a download instead of showing it in the browser)
// Streams the stored file of a material that is currently shared. The uploads folder is still never served statically.
const downloadSharedMaterialFile = async (req, res) => {
  const paper = await paperShareService.findSharedMaterial(req.params.token);

  let verified;
  try {
    verified = await verifyStoredFile(paper);
  } catch (err) {
    // A missing or damaged stored file is the owner's problem. A visitor gets the plain 404 and no internal detail
    // (the owner-facing message talks about uploading the paper again).
    if (err instanceof ApiError) {
      logger.warn(`Shared material ${String(paper._id)} has an unusable stored file: ${err.message}`);
      throw ApiError.notFound(paperShareService.SHARED_NOT_FOUND);
    }
    throw err;
  }
  const { storedPath, stats, detected } = verified;
  const disposition = req.query.download === 'true' ? 'attachment' : 'inline';

  setPublicHeaders(res);
  res.set({
    'Content-Type': detected.mime, // from the verified bytes, never from the client
    'Content-Length': String(stats.size),
    'Content-Disposition': buildContentDisposition(disposition, sanitizeOriginalName(paper.originalName)),
  });

  try {
    await pipeline(fs.createReadStream(storedPath), res);
  } catch (err) {
    if (!res.headersSent) throw err;
    logger.warn(`Shared file stream for paper ${String(paper._id)} ended early: ${err && err.message ? err.message : err}`);
    res.destroy();
  }
};

module.exports = { enableSharing, getSharingStatus, revokeSharing, getSharedMaterial, downloadSharedMaterialFile };

'use strict';

const crypto = require('crypto');

// Phase 4.3A: secure share tokens for study materials.
//
//  - A token is 32 random bytes from crypto.randomBytes, base64url encoded (43 characters, 256 bits). It has no
//    relation to the material's _id, the owner or the time, so it cannot be guessed or enumerated.
//  - Only the SHA-256 hash of a token is stored (Paper.shareTokenHash). The token itself exists in the database
//    nowhere: a leaked backup or a read-only database leak cannot be turned into working links. A token that already
//    has 256 bits of entropy needs no salt or slow hash; SHA-256 is the standard choice and keeps the lookup an
//    indexed equality match.
//  - Whatever a visitor sends is checked for its shape BEFORE it is hashed or any query is made.

const SHARE_TOKEN_BYTES = 32;
const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const generateShareToken = () => crypto.randomBytes(SHARE_TOKEN_BYTES).toString('base64url');

const isWellFormedShareToken = (value) => typeof value === 'string' && SHARE_TOKEN_PATTERN.test(value);

// Hex SHA-256 of the token. Callers must have checked isWellFormedShareToken first.
const hashShareToken = (token) => crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');

// Share tokens travel in URL paths (/api/shared/<kind>/<token>[/file]), so request logs would otherwise keep every
// working link. This replaces the token part of such a path with a placeholder; it is used by the access log and the
// error logger. Matches any 20+ character token-like segment so a malformed token is hidden as well.
const SHARED_PATH_PATTERN = /(\/shared\/(?:materials|question-sets)\/)[^/?#\s]{20,}/gi;
const redactShareTokens = (text) => String(text === undefined || text === null ? '' : text).replace(SHARED_PATH_PATTERN, '$1[redacted]');

module.exports = { SHARE_TOKEN_PATTERN, generateShareToken, isWellFormedShareToken, hashShareToken, redactShareTokens };

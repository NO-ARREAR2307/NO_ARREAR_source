'use strict';

const { ROLES } = require('./roles');

// Phase 4.1 ownership rules for study materials, kept in one place so every endpoint applies the same ones:
//   admin   -> may act on every material
//   student -> may act only on materials they uploaded themselves
//
// The rule is part of the DATABASE QUERY (never a check done after loading the document), so:
//  * a student's request for someone else's material finds nothing and answers 404, exactly like a material that
//    does not exist (a 403 would confirm that the material exists);
//  * the check and the write happen in one atomic operation (no "load, check, then update" gap).

const isAdmin = (user) => Boolean(user) && user.role === ROLES.ADMIN;

// Filter for ONE material by id.
const accessFilterForId = (user, paperId) => (isAdmin(user) ? { _id: paperId } : { _id: paperId, uploadedBy: user._id });

// Base filter for LISTS: admins see everything, students only their own.
const accessFilterForList = (user) => (isAdmin(user) ? {} : { uploadedBy: user._id });

module.exports = { isAdmin, accessFilterForId, accessFilterForList };

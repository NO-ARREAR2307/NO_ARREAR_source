'use strict';

const crypto = require('crypto');
const { config } = require('../config/env');
const { Department, Regulation, Semester, Subject, SavedQuestionSet, User } = require('../models');
const ApiError = require('../utils/ApiError');
const { resolveAcademicContext } = require('./importantQuestionService');
const { LIMITS } = require('../validators/savedQuestionSetValidators');

// Phase 2B: saved question sets.
//
// - Every query is scoped by the student id taken from the verified JWT. A set that belongs to someone else is
//   answered exactly like a set that does not exist (404), so ids cannot be probed.
// - Saving re-uses the Phase 2A academic checks (resolveAcademicContext): active records, subject in semester,
//   semester in regulation, supported University of Madras / 2023-2024 / BCA or B.Sc. Computer Science scope.
// - Only references are stored; names, codes and the department are read from the academic collections on output.
// - Admin read access (listAllQuestionSets / getQuestionSetForAdmin) is a separate, read-only pair of functions. It is only reachable
//   through the admin router (protect -> requireAdmin, routes/adminRoutes.js); the student functions above stay owner-scoped and
//   an admin can neither edit, delete nor (un)share a student's set.

const NOT_FOUND = 'Saved question set not found';
const SHARE_NOT_FOUND = 'Shared question set not found';

// Phase 2C: sharing.
// - The token is 32 random bytes from crypto.randomBytes, base64url encoded (43 characters, 256 bits). It has no
//   relation to the set's _id, the owner or the time, so it cannot be guessed or enumerated.
// - Sharing is owner-only: every write is filtered by { _id, student }, so another student's set is a 404.
// - Revoking nulls the token in the same write that turns sharing off, so the old link stops working at once.
const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const generateShareToken = () => crypto.randomBytes(32).toString('base64url');

const shareBaseUrl = () => config.share.publicBaseUrl || (config.corsOrigins[0] || '').replace(/\/+$/, '');
const buildShareUrl = (token) => `${shareBaseUrl()}/shared/${token}`;
const buildSharePath = (token) => `${config.apiPrefix}/shared/question-sets/${token}`;

const idOf = (value) => (value === null || value === undefined ? null : String(value));
const byId = (docs) => new Map(docs.map((doc) => [String(doc._id), doc]));

// Loads the subjects, semesters, regulations and departments the given sets point at (4 queries, however many sets).
// A record that has since been removed simply yields null, the saved set stays readable.
const loadAcademicLookups = async (sets) => {
  const unique = (field) => [...new Set(sets.map((set) => idOf(set[field])).filter(Boolean))];
  const [subjects, semesters, regulations] = await Promise.all([
    Subject.find({ _id: { $in: unique('subject') } }),
    Semester.find({ _id: { $in: unique('semester') } }),
    Regulation.find({ _id: { $in: unique('regulation') } }),
  ]);
  const departmentIds = [...new Set(regulations.map((regulation) => idOf(regulation.department)).filter(Boolean))];
  const departments = departmentIds.length > 0 ? await Department.find({ _id: { $in: departmentIds } }) : [];
  return { subjects: byId(subjects), semesters: byId(semesters), regulations: byId(regulations), departments: byId(departments) };
};

// Phase 2E: one stored question as the API returns it. Fields that were never stored (sets saved before Phase 2E)
// are left out, so an old question keeps exactly its old shape.
//   - difficulty and the MCQ options are part of the question and are always returned;
//   - the answer key (correctAnswer, explanation, answerPoints) is returned only with includeAnswerKey, i.e. to the owner.
//     The public shared view never passes it.
const serializeQuestion = (q, { includeAnswerKey }) => {
  const result = {
    questionType: q.questionType,
    marks: q.marks,
    question: q.question,
    unit: q.unit || null,
    topic: q.topic || null,
  };
  if (q.difficulty) result.difficulty = q.difficulty;
  if (Array.isArray(q.options) && q.options.length > 0) result.options = q.options.map((option) => ({ label: option.label, text: option.text }));
  if (includeAnswerKey) {
    if (q.correctAnswer) result.correctAnswer = q.correctAnswer;
    if (q.explanation) result.explanation = q.explanation;
    if (Array.isArray(q.answerPoints) && q.answerPoints.length > 0) result.answerPoints = [...q.answerPoints];
  }
  return result;
};

const serialize = (set, lookups, { withQuestions }) => {
  const subject = lookups.subjects.get(idOf(set.subject));
  const semester = lookups.semesters.get(idOf(set.semester));
  const regulation = lookups.regulations.get(idOf(set.regulation));
  const department = regulation ? lookups.departments.get(idOf(regulation.department)) : null;

  const result = {
    _id: set._id,
    title: set.title,
    questionCount: set.questionCount,
    subject: subject
      ? { _id: subject._id, name: subject.name, subjectCode: subject.subjectCode || null, subjectType: subject.subjectType || null, category: subject.category || null }
      : { _id: set.subject, name: null },
    semester: semester ? { _id: semester._id, semesterNumber: semester.semesterNumber } : { _id: set.semester },
    regulation: regulation ? { _id: regulation._id, name: regulation.name } : { _id: set.regulation, name: null },
    department: department ? { _id: department._id, name: department.name, code: department.code, level: department.level } : null,
    isShared: set.isShared === true,
    sharedAt: set.isShared === true ? set.sharedAt || null : null,
    createdAt: set.createdAt,
    updatedAt: set.updatedAt,
  };
  if (withQuestions) {
    result.questions = (set.questions || []).map((q) => serializeQuestion(q, { includeAnswerKey: true }));
  }
  return result;
};

/** input: output of validateSaveRequest. Returns the saved set (with questions and academic details). */
const saveQuestionSet = async (studentId, input) => {
  // 404 / 400 for missing, inactive, mismatched or out-of-scope academic references.
  await resolveAcademicContext(input);

  const existing = await SavedQuestionSet.countDocuments({ student: studentId });
  if (existing >= LIMITS.maxSavedSetsPerStudent) {
    throw ApiError.conflict(`You can keep at most ${LIMITS.maxSavedSetsPerStudent} saved question sets. Delete one to save a new set.`);
  }

  const saved = await new SavedQuestionSet({
    student: studentId,
    subject: input.subjectId,
    semester: input.semesterId,
    regulation: input.regulationId,
    title: input.title,
    questions: input.questions,
  }).save();

  const plain = saved.toObject();
  return serialize(plain, await loadAcademicLookups([plain]), { withQuestions: true });
};

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const listMeta = ({ page, limit }, total) => ({ page, limit, total, totalPages: Math.ceil(total / limit) });

/**
 * The query filter shared by the student's history and the admin's all-students list: `base` ({ student } or {}) plus the optional
 * filters. Returns null when the department filter can match nothing (the department has no regulations).
 * The programme (department) is not stored on a set: it is reached through the set's regulation, so the department filter first
 * looks up that department's regulations (a handful of rows) and then filters the sets by regulation (indexed).
 */
const buildListFilter = async (base, filters) => {
  const filter = { ...base };
  if (filters.subjectId) filter.subject = filters.subjectId;
  if (filters.semesterId) filter.semester = filters.semesterId;
  if (filters.departmentId) {
    const regulations = await Regulation.find({ department: filters.departmentId });
    if (regulations.length === 0) return null;
    filter.regulation = { $in: regulations.map((regulation) => regulation._id) };
  }
  // Sets saved before Phase 2C have no isShared field, so "private" means "not true", not "false".
  if (filters.shared === true) filter.isShared = true;
  if (filters.shared === false) filter.isShared = { $ne: true };
  // Case-insensitive "contains" on the title; the text is escaped so it can never act as a pattern.
  if (filters.q) filter.title = { $regex: escapeRegex(filters.q), $options: 'i' };
  return filter;
};

/**
 * Phase 2D: the student's history, without the questions.
 * filters: output of validateListFilters { subjectId?, semesterId?, departmentId?, shared?, q?, sort }.
 * The student id is always part of the query.
 */
const listQuestionSets = async (studentId, filters, pagination) => {
  const { limit, skip } = pagination;
  const filter = await buildListFilter({ student: studentId }, filters);
  if (!filter) return { records: [], meta: listMeta(pagination, 0) };

  const direction = filters.sort === 'oldest' ? 1 : -1;
  const [sets, total] = await Promise.all([
    SavedQuestionSet.find(filter).sort({ createdAt: direction, _id: direction }).skip(skip).limit(limit).select('-questions').lean(),
    SavedQuestionSet.countDocuments(filter),
  ]);
  const lookups = await loadAcademicLookups(sets);
  return { records: sets.map((set) => serialize(set, lookups, { withQuestions: false })), meta: listMeta(pagination, total) };
};

const getQuestionSet = async (studentId, setId) => {
  const set = await SavedQuestionSet.findOne({ _id: setId, student: studentId }).lean();
  if (!set) throw ApiError.notFound(NOT_FOUND);
  return serialize(set, await loadAcademicLookups([set]), { withQuestions: true });
};

const deleteQuestionSet = async (studentId, setId) => {
  const deleted = await SavedQuestionSet.findOneAndDelete({ _id: setId, student: studentId });
  if (!deleted) throw ApiError.notFound(NOT_FOUND);
};

// ---------------------------------------------------------------------------------------------------------------------
// Admin read access. These two functions have NO student condition on purpose: they are only ever called from the admin routes,
// which sit behind protect + requireAdmin. They are read-only, and they never return the share token.
// ---------------------------------------------------------------------------------------------------------------------

// The owner of each set as an admin sees it. Only display fields are read (the password hash is not selectable). A student whose
// account has been removed still leaves a readable set: the owner is then { _id, name: null }.
const loadOwners = async (sets) => {
  const ids = [...new Set(sets.map((set) => idOf(set.student)).filter(Boolean))];
  if (ids.length === 0) return new Map();
  const users = await User.find({ _id: { $in: ids } }).select('name email role course department semester').lean();
  return byId(users);
};

const serializeOwner = (set, owners) => {
  const id = idOf(set.student);
  const user = owners.get(id);
  if (!user) return { _id: id, name: null };
  return {
    _id: id,
    name: user.name,
    email: user.email,
    role: user.role || 'student',
    course: user.course || null,
    department: user.department || null,
    semester: typeof user.semester === 'number' ? user.semester : null,
  };
};

/**
 * Admin: every saved set of every user, newest first, without the questions. Same filters, sort and pagination as the student
 * history (filters: output of validateListFilters), plus options.studentId to see one student's sets only.
 */
const listAllQuestionSets = async (filters, pagination, { studentId } = {}) => {
  const { limit, skip } = pagination;
  const filter = await buildListFilter(studentId ? { student: studentId } : {}, filters);
  if (!filter) return { records: [], meta: listMeta(pagination, 0) };

  const direction = filters.sort === 'oldest' ? 1 : -1;
  const [sets, total] = await Promise.all([
    SavedQuestionSet.find(filter).sort({ createdAt: direction, _id: direction }).skip(skip).limit(limit).select('-questions').lean(),
    SavedQuestionSet.countDocuments(filter),
  ]);
  const [lookups, owners] = await Promise.all([loadAcademicLookups(sets), loadOwners(sets)]);
  return {
    records: sets.map((set) => ({ ...serialize(set, lookups, { withQuestions: false }), student: serializeOwner(set, owners) })),
    meta: listMeta(pagination, total),
  };
};

/** Admin: one saved set of any user, complete: every question with its answer key and generated answer points, plus the owner. */
const getQuestionSetForAdmin = async (setId) => {
  const set = await SavedQuestionSet.findOne({ _id: setId }).lean();
  if (!set) throw ApiError.notFound(NOT_FOUND);
  const [lookups, owners] = await Promise.all([loadAcademicLookups([set]), loadOwners([set])]);
  const answeredCount = (set.questions || []).filter(
    (q) => q.correctAnswer || q.explanation || (Array.isArray(q.answerPoints) && q.answerPoints.length > 0)
  ).length;
  return { ...serialize(set, lookups, { withQuestions: true }), answeredCount, student: serializeOwner(set, owners) };
};

const shareResult = (set) => ({
  _id: set._id,
  isShared: set.isShared === true,
  sharedAt: set.isShared === true ? set.sharedAt || null : null,
  shareUrl: set.isShared === true && set.shareToken ? buildShareUrl(set.shareToken) : null,
  apiUrl: set.isShared === true && set.shareToken ? buildSharePath(set.shareToken) : null,
});

/** Owner only. Turns sharing on and returns the public link; calling it again returns the same link. */
const enableSharing = async (studentId, setId) => {
  const existing = await SavedQuestionSet.findOne({ _id: setId, student: studentId }).lean();
  if (!existing) throw ApiError.notFound(NOT_FOUND);
  if (existing.isShared === true && existing.shareToken) return { ...shareResult(existing), alreadyShared: true };

  // Only a set that has no token yet is updated, so two simultaneous requests cannot replace each other's token.
  const updated = await SavedQuestionSet.findOneAndUpdate(
    { _id: setId, student: studentId, shareToken: null },
    { $set: { isShared: true, shareToken: generateShareToken(), sharedAt: new Date() } },
    { returnDocument: 'after' }
  ).lean();
  if (updated) return { ...shareResult(updated), alreadyShared: false };

  // Lost the race (or the set was deleted in between): answer from what is stored now.
  const current = await SavedQuestionSet.findOne({ _id: setId, student: studentId }).lean();
  if (!current) throw ApiError.notFound(NOT_FOUND);
  return { ...shareResult(current), alreadyShared: true };
};

/** Owner only. Turns sharing off and invalidates the token. Safe to call on a set that is not shared. */
const revokeSharing = async (studentId, setId) => {
  const updated = await SavedQuestionSet.findOneAndUpdate(
    { _id: setId, student: studentId },
    { $set: { isShared: false, shareToken: null, sharedAt: null } },
    { returnDocument: 'after' }
  ).lean();
  if (!updated) throw ApiError.notFound(NOT_FOUND);
  return shareResult(updated);
};

// What a visitor with the link may see: the questions and the academic context only. No ids, no owner, no
// account data, no sharing token.
const serializePublic = (set, lookups) => {
  const subject = lookups.subjects.get(idOf(set.subject));
  const semester = lookups.semesters.get(idOf(set.semester));
  const regulation = lookups.regulations.get(idOf(set.regulation));
  const department = regulation ? lookups.departments.get(idOf(regulation.department)) : null;
  return {
    title: set.title,
    questionCount: set.questionCount,
    subject: subject
      ? { name: subject.name, subjectCode: subject.subjectCode || null, subjectType: subject.subjectType || null, category: subject.category || null }
      : null,
    semester: semester ? { semesterNumber: semester.semesterNumber } : null,
    regulation: regulation ? { name: regulation.name } : null,
    department: department ? { name: department.name, code: department.code, level: department.level } : null,
    // No answer key in a public response: correct answers, explanations and answer points stay with the owner.
    questions: (set.questions || []).map((q) => serializeQuestion(q, { includeAnswerKey: false })),
    sharedAt: set.sharedAt || null,
  };
};

/** Public, no login. Wrong, malformed, revoked and unknown tokens all give the same 404. */
const getSharedQuestionSet = async (token) => {
  if (typeof token !== 'string' || !SHARE_TOKEN_PATTERN.test(token)) throw ApiError.notFound(SHARE_NOT_FOUND);
  const set = await SavedQuestionSet.findOne({ shareToken: token, isShared: true }).lean();
  if (!set) throw ApiError.notFound(SHARE_NOT_FOUND);
  return serializePublic(set, await loadAcademicLookups([set]));
};

module.exports = {
  saveQuestionSet,
  listQuestionSets,
  listAllQuestionSets,
  getQuestionSet,
  getQuestionSetForAdmin,
  deleteQuestionSet,
  enableSharing,
  revokeSharing,
  getSharedQuestionSet,
};

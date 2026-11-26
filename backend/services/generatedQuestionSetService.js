'use strict';

const mongoose = require('mongoose');
const { GeneratedQuestionSet, Department, Regulation, Semester, Subject } = require('../models');
const ApiError = require('../utils/ApiError');
const { serializeAnswered, hasAnswer, NOT_FOUND } = require('./answerGenerationService');

// Read / delete side of the two-stage generation workflow (models/GeneratedQuestionSet.js).
//
// - Every query is scoped by the student id from the verified JWT. A set that belongs to someone else is answered exactly
//   like a set that does not exist (404), so ids cannot be probed.
// - Only references are stored on the set; subject, semester, regulation and department are read from the academic
//   collections on output. A record that has since been removed yields null and the set stays readable.
// - Questions are returned in the same flat shape as stage 2 (serializeAnswered), so a question from here can be saved as it is
//   with POST /api/saved-question-sets. Stored papers are never loaded: only their ids are returned.

const idOf = (value) => (value === null || value === undefined ? null : String(value));
const byId = (docs) => new Map(docs.map((doc) => [String(doc._id), doc]));

const loadAcademicLookups = async (sets) => {
  const unique = (field) => [...new Set(sets.map((set) => idOf(set[field])).filter(Boolean))];
  const [subjects, semesters, regulations] = await Promise.all([
    Subject.find({ _id: { $in: unique('subject') } }).lean(),
    Semester.find({ _id: { $in: unique('semester') } }).lean(),
    Regulation.find({ _id: { $in: unique('regulation') } }).lean(),
  ]);
  const departmentIds = [...new Set(regulations.map((regulation) => idOf(regulation.department)).filter(Boolean))];
  const departments = departmentIds.length > 0 ? await Department.find({ _id: { $in: departmentIds } }).lean() : [];
  return { subjects: byId(subjects), semesters: byId(semesters), regulations: byId(regulations), departments: byId(departments) };
};

const serializeSet = (set, lookups) => {
  const subject = lookups.subjects.get(idOf(set.subject));
  const semester = lookups.semesters.get(idOf(set.semester));
  const regulation = lookups.regulations.get(idOf(set.regulation));
  const department = regulation ? lookups.departments.get(idOf(regulation.department)) : null;
  return {
    generationId: String(set._id),
    difficulty: set.difficulty,
    subject: subject
      ? { _id: subject._id, name: subject.name, subjectCode: subject.subjectCode || null, subjectType: subject.subjectType || null, category: subject.category || null }
      : { _id: set.subject, name: null },
    semester: semester ? { _id: semester._id, semesterNumber: semester.semesterNumber } : { _id: set.semester },
    regulation: regulation ? { _id: regulation._id, name: regulation.name } : { _id: set.regulation, name: null },
    department: department ? { _id: department._id, name: department.name, code: department.code, level: department.level } : null,
    createdAt: set.createdAt,
    updatedAt: set.updatedAt,
    expiresAt: set.expiresAt || null,
  };
};

/** The student's generated sets, newest first, without the questions. Pagination comes from validatePagination. */
const listGeneratedSets = async (studentId, { page, limit, skip }) => {
  const student = new mongoose.Types.ObjectId(String(studentId)); // aggregate() does not cast ids
  const [rows, total] = await Promise.all([
    GeneratedQuestionSet.aggregate([
      { $match: { student } },
      { $sort: { createdAt: -1, _id: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $project: {
          subject: 1,
          semester: 1,
          regulation: 1,
          difficulty: 1,
          createdAt: 1,
          updatedAt: 1,
          expiresAt: 1,
          paperCount: { $size: { $ifNull: ['$papers', []] } },
          questionCount: { $size: { $ifNull: ['$questions', []] } },
          answeredCount: {
            $size: {
              $filter: {
                input: { $ifNull: ['$questions', []] },
                as: 'q',
                cond: { $ne: [{ $ifNull: ['$$q.answer.generatedAt', null] }, null] },
              },
            },
          },
        },
      },
    ]),
    GeneratedQuestionSet.countDocuments({ student }),
  ]);
  const lookups = await loadAcademicLookups(rows);
  return {
    records: rows.map((row) => ({
      ...serializeSet(row, lookups),
      paperCount: row.paperCount,
      questionCount: row.questionCount,
      answeredCount: row.answeredCount,
    })),
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

/** One of the student's generated sets with every question and its stored answer (if one was generated). */
const getGeneratedSet = async (studentId, generationId) => {
  const set = await GeneratedQuestionSet.findOne({ _id: generationId, student: studentId }).lean();
  if (!set) throw ApiError.notFound(NOT_FOUND);
  const questions = (set.questions || []).map((question) => ({
    ...serializeAnswered(question, question.answer || {}),
    source: question.source,
    answered: hasAnswer(question),
    ...(question.answer && question.answer.generatedAt ? { answeredAt: question.answer.generatedAt } : {}),
  }));
  return {
    ...serializeSet(set, await loadAcademicLookups([set])),
    paperIds: (set.papers || []).map(String),
    questionCount: questions.length,
    answeredCount: questions.filter((question) => question.answered).length,
    questions,
  };
};

const deleteGeneratedSet = async (studentId, generationId) => {
  const deleted = await GeneratedQuestionSet.findOneAndDelete({ _id: generationId, student: studentId });
  if (!deleted) throw ApiError.notFound(NOT_FOUND);
};

module.exports = { listGeneratedSets, getGeneratedSet, deleteGeneratedSet };

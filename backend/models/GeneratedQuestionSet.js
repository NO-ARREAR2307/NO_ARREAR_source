'use strict';

const mongoose = require('mongoose');
const { QUESTION_TYPES, DIFFICULTIES, DIFFICULTY_MODES, LIMITS } = require('../validators/importantQuestionValidators');

// Two-stage important-question generation (collection "generatedquestionsets").
//
// Stage 1 (POST /api/questions/important) stores the questions it generated here, WITHOUT answers, and returns the id of
// this document (generationId) plus one questionId per question (the question sub-document _id).
// Stage 2 (POST /api/questions/important/:generationId/answers) looks the set up by { _id, student }, checks that every
// selected questionId belongs to it, and stores the generated answer on exactly those questions.
//
// This is a short-lived working copy, not the student's history: the saved question sets (models/SavedQuestionSet.js) stay
// the long-term store. Documents expire on their own after GENERATION_TTL_DAYS (MongoDB TTL index on expiresAt).

const GENERATION_TTL_DAYS = 30;

const optionSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, enum: ['A', 'B', 'C', 'D'] },
    text: { type: String, required: true, trim: true, maxlength: [300, 'Option text cannot exceed 300 characters'] },
  },
  { _id: false }
);

// The answer of one question, written by stage 2 only. Absent until then.
const answerSchema = new mongoose.Schema(
  {
    correctAnswer: { type: String, enum: ['A', 'B', 'C', 'D'], default: undefined },
    explanation: { type: String, trim: true, maxlength: [1000, 'Explanation cannot exceed 1000 characters'], default: undefined },
    answerPoints: {
      type: [{ type: String, trim: true, maxlength: [300, 'An answer point cannot exceed 300 characters'] }],
      default: undefined,
    },
    generatedAt: { type: Date, required: true },
  },
  { _id: false }
);

// Keeps its own _id: that is the questionId the client sends in stage 2.
const generatedQuestionSchema = new mongoose.Schema({
  questionType: { type: String, required: true, enum: QUESTION_TYPES },
  marks: { type: Number, required: true, min: LIMITS.minMarks, max: LIMITS.maxMarks },
  difficulty: { type: String, required: true, enum: DIFFICULTIES },
  question: { type: String, required: true, trim: true, maxlength: [1000, 'Question text cannot exceed 1000 characters'] },
  unit: { type: String, trim: true, default: null },
  topic: { type: String, trim: true, default: null },
  // Id of the uploaded material the question was written from (M1, M2, M3 = position in `papers`).
  source: { type: String, required: true, match: /^M[1-3]$/ },
  options: { type: [optionSchema], default: undefined },
  answer: { type: answerSchema, default: undefined },
});

const generatedQuestionSetSchema = new mongoose.Schema(
  {
    // Always taken from the verified JWT (req.user), never from the request body.
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
    semester: { type: mongoose.Schema.Types.ObjectId, ref: 'Semester', required: true },
    regulation: { type: mongoose.Schema.Types.ObjectId, ref: 'Regulation', required: true },
    // The uploaded papers the questions came from, in request order (M1 = papers[0]). Stage 2 re-loads exactly these.
    papers: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Paper' }],
      validate: { validator: (list) => Array.isArray(list) && list.length >= LIMITS.minPapers && list.length <= LIMITS.maxPapers, message: 'A generated set needs 1 to 3 papers' },
    },
    difficulty: { type: String, required: true, enum: DIFFICULTY_MODES },
    questions: {
      type: [generatedQuestionSchema],
      validate: {
        validator: (list) => Array.isArray(list) && list.length >= 1 && list.length <= LIMITS.maxTotalQuestions,
        message: `A generated set must contain between 1 and ${LIMITS.maxTotalQuestions} questions`,
      },
    },
    expiresAt: { type: Date, default: () => new Date(Date.now() + GENERATION_TTL_DAYS * 24 * 60 * 60 * 1000) },
  },
  { timestamps: true }
);

generatedQuestionSetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
generatedQuestionSetSchema.index({ student: 1, createdAt: -1 });

module.exports = mongoose.model('GeneratedQuestionSet', generatedQuestionSetSchema);

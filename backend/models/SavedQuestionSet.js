'use strict';

const mongoose = require('mongoose');
const { QUESTION_TYPES, DIFFICULTIES, LIMITS } = require('../validators/importantQuestionValidators');

// Phase 2B: a question set a student chose to keep (collection "savedquestionsets").
//
// Only ObjectId references to the existing academic collections are stored (subject, semester, regulation);
// names, codes and the department are looked up when the set is read, so nothing academic is duplicated here.
// The questions themselves are embedded: they belong to this one set and are always read and deleted with it.

// Phase 2E: the four options of a multiple-choice question.
const optionSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, enum: ['A', 'B', 'C', 'D'] },
    text: { type: String, required: true, trim: true, maxlength: [300, 'Option text cannot exceed 300 characters'] },
  },
  { _id: false }
);

const questionSchema = new mongoose.Schema(
  {
    questionType: {
      type: String,
      required: [true, 'Question type is required'],
      enum: { values: QUESTION_TYPES, message: `Question type must be one of: ${QUESTION_TYPES.join(', ')}` },
    },
    marks: {
      type: Number,
      required: [true, 'Marks are required'],
      min: [LIMITS.minMarks, `Marks must be between ${LIMITS.minMarks} and ${LIMITS.maxMarks}`],
      max: [LIMITS.maxMarks, `Marks must be between ${LIMITS.minMarks} and ${LIMITS.maxMarks}`],
      validate: { validator: Number.isInteger, message: 'Marks must be a whole number' },
    },
    question: {
      type: String,
      required: [true, 'Question text is required'],
      trim: true,
      maxlength: [1000, 'Question text cannot exceed 1000 characters'],
    },
    unit: { type: String, trim: true, maxlength: [100, 'Unit cannot exceed 100 characters'], default: null },
    topic: { type: String, trim: true, maxlength: [150, 'Topic cannot exceed 150 characters'], default: null },
    // Phase 2E. All of these are optional and absent on sets saved before this phase (nothing is back-filled), so
    // old sets read exactly as they always did. The answer key (correctAnswer, explanation, answerPoints) is only
    // ever returned to the owner, never in a public shared response.
    difficulty: {
      type: String,
      enum: { values: DIFFICULTIES, message: `Difficulty must be one of: ${DIFFICULTIES.join(', ')}` },
      default: undefined,
    },
    options: { type: [optionSchema], default: undefined },
    correctAnswer: { type: String, enum: ['A', 'B', 'C', 'D'], default: undefined },
    explanation: { type: String, trim: true, maxlength: [1000, 'Explanation cannot exceed 1000 characters'], default: undefined },
    answerPoints: {
      type: [{ type: String, trim: true, maxlength: [300, 'An answer point cannot exceed 300 characters'] }],
      default: undefined,
    },
  },
  { _id: false }
);

const savedQuestionSetSchema = new mongoose.Schema(
  {
    // Always taken from the verified JWT (req.user), never from the request body.
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Student is required'],
    },
    subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: [true, 'Subject is required'] },
    semester: { type: mongoose.Schema.Types.ObjectId, ref: 'Semester', required: [true, 'Semester is required'] },
    regulation: { type: mongoose.Schema.Types.ObjectId, ref: 'Regulation', required: [true, 'Regulation is required'] },
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      maxlength: [150, 'Title cannot exceed 150 characters'],
    },
    questions: {
      type: [questionSchema],
      validate: {
        validator: (list) => Array.isArray(list) && list.length >= 1 && list.length <= LIMITS.maxTotalQuestions,
        message: `A saved set must contain between 1 and ${LIMITS.maxTotalQuestions} questions`,
      },
    },
    // Kept equal to questions.length (see the pre-validate hook); stored so lists need not load the questions.
    questionCount: {
      type: Number,
      required: [true, 'Question count is required'],
      min: [1, 'Question count must be at least 1'],
      max: [LIMITS.maxTotalQuestions, `Question count cannot exceed ${LIMITS.maxTotalQuestions}`],
    },
    // Phase 2C: public sharing. A set is private until its owner enables sharing.
    // shareToken is a random value (never the _id) and is null whenever sharing is off.
    isShared: { type: Boolean, default: false },
    shareToken: { type: String, default: null },
    sharedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => {
        delete ret.student; // never expose the owner reference in a response
        delete ret.shareToken; // the token is only ever returned inside a share URL to the owner
        delete ret.__v;
        return ret;
      },
    },
  }
);

savedQuestionSetSchema.pre('validate', function syncQuestionCount() {
  if (Array.isArray(this.questions)) this.questionCount = this.questions.length;
});

// "My sets, newest first" (with and without the subject / semester filters).
savedQuestionSetSchema.index({ student: 1, createdAt: -1 });
savedQuestionSetSchema.index({ student: 1, subject: 1, semester: 1, createdAt: -1 });
// Phase 2D history filters: by programme (through its regulations) and by sharing status. Both directions of the
// createdAt sort (newest / oldest) use the same index.
savedQuestionSetSchema.index({ student: 1, regulation: 1, createdAt: -1 });
savedQuestionSetSchema.index({ student: 1, isShared: 1, createdAt: -1 });

// Public lookup by token. Unique, but only for real tokens: sets that are private (token null) are not indexed.
savedQuestionSetSchema.index({ shareToken: 1 }, { unique: true, partialFilterExpression: { shareToken: { $type: 'string' } } });

module.exports = mongoose.model('SavedQuestionSet', savedQuestionSetSchema);

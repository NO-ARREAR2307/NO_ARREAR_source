'use strict';

const mongoose = require('mongoose');
const {
  SUBJECT_TYPES,
  SUBJECT_CATEGORIES,
  CHOICE_RULES,
  DEFAULT_CHOICE_RULE,
  CHOICE_GROUP_PATTERN,
  CHOICE_GROUP_MAX,
  CHOICE_GROUP_LABEL_MAX,
} = require('../utils/academicEnums');

// Bottom level: a subject of ONE semester (ObjectId reference, collection "subjects"). A subject reaches
// its regulation, department and university through the Semester -> Regulation -> Department ->
// University references.

// Trims and upper-cases the code; a blank code means "no official code" and is not stored at all, so
// subjects without a code never collide on the unique index.
const normalizeCode = (value) => {
  if (typeof value !== 'string') return value;
  const cleaned = value.trim().toUpperCase();
  return cleaned === '' ? undefined : cleaned;
};

const normalizeEnum = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

// Choice-group fields are optional: a blank value means "not set" and is not stored at all.
const normalizeGroup = (value) => {
  if (typeof value !== 'string') return value;
  const cleaned = value.trim().toLowerCase();
  return cleaned === '' ? undefined : cleaned;
};
const normalizeLabel = (value) => {
  if (typeof value !== 'string') return value;
  const cleaned = value.trim().replace(/\s+/g, ' ');
  return cleaned === '' ? undefined : cleaned;
};
const normalizeRule = (value) => {
  if (typeof value !== 'string') return value;
  const cleaned = value.trim().toLowerCase();
  return cleaned === '' ? undefined : cleaned;
};

const subjectSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Subject name is required'],
      trim: true,
      maxlength: [150, 'Subject name cannot exceed 150 characters'],
    },
    // Optional: some subjects have no official code.
    subjectCode: {
      type: String,
      set: normalizeCode,
      maxlength: [20, 'Subject code cannot exceed 20 characters'],
    },
    subjectType: {
      type: String,
      required: [true, 'Subject type is required'],
      set: normalizeEnum,
      enum: { values: SUBJECT_TYPES, message: `Subject type must be one of: ${SUBJECT_TYPES.join(', ')}` },
    },
    category: {
      type: String,
      required: [true, 'Subject category is required'],
      set: normalizeEnum,
      enum: { values: SUBJECT_CATEGORIES, message: `Subject category must be one of: ${SUBJECT_CATEGORIES.join(', ')}` },
    },
    semester: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Semester',
      required: [true, 'Semester is required'],
    },
    // Optional choice group: subjects of the SAME semester that share a choiceGroup are alternatives of each
    // other (an elective / conditional choice) instead of compulsory subjects. Subjects without a group are
    // unaffected. The group, label and rule must be consistent inside one semester (enforced by the services).
    choiceGroup: {
      type: String,
      set: normalizeGroup,
      maxlength: [CHOICE_GROUP_MAX, `Choice group cannot exceed ${CHOICE_GROUP_MAX} characters`],
      match: [CHOICE_GROUP_PATTERN, 'Choice group may only contain lower-case letters, digits, "-" and "_" (no spaces)'],
    },
    choiceGroupLabel: {
      type: String,
      set: normalizeLabel,
      maxlength: [CHOICE_GROUP_LABEL_MAX, `Choice group label cannot exceed ${CHOICE_GROUP_LABEL_MAX} characters`],
    },
    choiceRule: {
      type: String,
      set: normalizeRule,
      enum: { values: CHOICE_RULES, message: `Choice rule must be one of: ${CHOICE_RULES.join(', ')}` },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// A subject in a choice group defaults to "choose_one"; a label or rule without a group makes no sense.
subjectSchema.pre('validate', function validateChoiceGroup() {
  if (this.choiceGroup) {
    if (!this.choiceRule) this.choiceRule = DEFAULT_CHOICE_RULE;
    return;
  }
  if (this.choiceGroupLabel) this.invalidate('choiceGroupLabel', 'Choice group label requires a choice group');
  if (this.choiceRule) this.invalidate('choiceRule', 'Choice rule requires a choice group');
});

// A subject code may repeat across semesters but only once inside one semester. The index is PARTIAL:
// it only covers subjects that actually have a (non-empty) code, so any number of subjects without a
// code can live in the same semester. It also serves "subjects of a semester" lookups.
subjectSchema.index(
  { semester: 1, subjectCode: 1 },
  { unique: true, partialFilterExpression: { subjectCode: { $type: 'string' } } }
);

module.exports = mongoose.model('Subject', subjectSchema);

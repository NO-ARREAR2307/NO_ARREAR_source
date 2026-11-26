'use strict';

const mongoose = require('mongoose');

// Fourth level: a semester (1 to 8) of ONE regulation (ObjectId reference, collection "semesters").
// Subjects point back to the semester; nothing is embedded here.
//
// Before Phase 1C a semester pointed at a department. Those old documents keep their `department`
// field in the database (it is not part of this schema any more and nothing deletes it) until
// scripts/migrateAcademicSchema.js assigns them a regulation.
const semesterSchema = new mongoose.Schema(
  {
    semesterNumber: {
      type: Number,
      required: [true, 'Semester number is required'],
      min: [1, 'Semester number must be between 1 and 8'],
      max: [8, 'Semester number must be between 1 and 8'],
      validate: {
        validator: Number.isInteger,
        message: 'Semester number must be a whole number',
      },
    },
    regulation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Regulation',
      required: [true, 'Regulation is required'],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Each semester number exists once per regulation. The index is PARTIAL (only documents that have a
// regulation) so that not-yet-migrated legacy semesters, which have none, can never collide with each
// other while the migration is pending. It also serves "semesters of a regulation" lookups.
semesterSchema.index(
  { regulation: 1, semesterNumber: 1 },
  { unique: true, partialFilterExpression: { regulation: { $type: 'objectId' } } }
);

module.exports = mongoose.model('Semester', semesterSchema);

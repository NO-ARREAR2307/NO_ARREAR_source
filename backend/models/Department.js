'use strict';

const mongoose = require('mongoose');
const { DEPARTMENT_LEVELS } = require('../utils/academicEnums');

// Second level: a department (programme) belongs to ONE university (ObjectId reference, collection
// "departments"). Regulations point back to the department; nothing is embedded here.
const departmentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Department name is required'],
      trim: true,
      maxlength: [150, 'Department name cannot exceed 150 characters'],
    },
    code: {
      type: String,
      required: [true, 'Department code is required'],
      trim: true,
      uppercase: true,
      maxlength: [20, 'Department code cannot exceed 20 characters'],
    },
    university: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'University',
      required: [true, 'University is required'],
    },
    // UG (undergraduate) or PG (postgraduate). Documents saved before Phase 1C have no level; see
    // scripts/migrateAcademicSchema.js (the level is never guessed).
    level: {
      type: String,
      required: [true, 'Department level is required'],
      set: (value) => (typeof value === 'string' ? value.trim().toUpperCase() : value),
      enum: { values: DEPARTMENT_LEVELS, message: 'Level must be UG or PG' },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// A department code may be reused by different universities but only once inside one university.
// The index also serves "all departments of a university" lookups (university is its first key).
departmentSchema.index({ university: 1, code: 1 }, { unique: true });

module.exports = mongoose.model('Department', departmentSchema);

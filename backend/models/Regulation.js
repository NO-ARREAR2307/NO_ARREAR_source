'use strict';

const mongoose = require('mongoose');

// Third level: a regulation (syllabus year / regulation identifier, for example "2023-2024") of ONE
// department (ObjectId reference, collection "regulations"). Semesters point back to the regulation;
// nothing is embedded here.
const regulationSchema = new mongoose.Schema(
  {
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      required: [true, 'Department is required'],
    },
    name: {
      type: String,
      required: [true, 'Regulation name is required'],
      trim: true,
      maxlength: [100, 'Regulation name cannot exceed 100 characters'],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// A regulation name exists once per department. Also serves "regulations of a department" lookups.
regulationSchema.index({ department: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Regulation', regulationSchema);

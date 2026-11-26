'use strict';

const mongoose = require('mongoose');

// Top of the academic hierarchy: University -> Department -> Semester -> Subject.
// Stored in its own collection ("universities"). Departments point to it with an ObjectId reference;
// nothing academic is embedded in this document.

// Trims and upper-cases the code; a blank code is treated as "no code" so several universities
// without a code never collide on the unique index.
const normalizeCode = (value) => {
  if (typeof value !== 'string') return value;
  const cleaned = value.trim().toUpperCase();
  return cleaned === '' ? undefined : cleaned;
};

const universitySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'University name is required'],
      trim: true,
      maxlength: [150, 'University name cannot exceed 150 characters'],
    },
    // Optional short identifier (for example "VTU"). Unique when present.
    code: {
      type: String,
      set: normalizeCode,
      maxlength: [20, 'University code cannot exceed 20 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, 'Description cannot exceed 1000 characters'],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true } // adds createdAt and updatedAt
);

// Unique only for documents that actually have a code (a plain unique index would allow just ONE
// university without a code).
universitySchema.index({ code: 1 }, { unique: true, partialFilterExpression: { code: { $type: 'string' } } });

module.exports = mongoose.model('University', universitySchema);

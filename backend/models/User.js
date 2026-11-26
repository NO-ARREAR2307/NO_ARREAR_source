'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { config } = require('../config/env');
const { ROLE_VALUES, DEFAULT_ROLE } = require('../utils/roles');

// Each domain label excludes "." so the pattern cannot backtrack heavily on hostile input.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

// bcrypt only uses the first 72 bytes of a password, so longer ones are rejected.
const MAX_PASSWORD_BYTES = 72;

// A student account.
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: [254, 'Email cannot exceed 254 characters'],
      match: [EMAIL_PATTERN, 'Please provide a valid email address'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters long'],
      validate: {
        validator: (value) => Buffer.byteLength(value, 'utf8') <= MAX_PASSWORD_BYTES,
        message: `Password cannot exceed ${MAX_PASSWORD_BYTES} bytes`,
      },
      // Excluded from query results by default. Use .select('+password') when logging in.
      select: false,
    },
    // Authorization role. Set only by the server: new accounts are always 'student' (default), and an
    // admin is created with scripts/seedAdmin.js. Registration never reads a role from the request.
    // Documents created before roles existed have no value stored; Mongoose reads them as 'student'.
    role: {
      type: String,
      enum: { values: ROLE_VALUES, message: 'Role must be one of: ' + ROLE_VALUES.join(', ') },
      default: DEFAULT_ROLE,
    },
    // Whether the student has proved they own the email address (Phase 0B). New students start as
    // false; only the server changes it, never a request body. Documents created before this field
    // existed are read as false too.
    emailVerified: {
      type: Boolean,
      default: false,
    },
    course: {
      type: String,
      trim: true,
      maxlength: [100, 'Course cannot exceed 100 characters'],
    },
    department: {
      type: String,
      trim: true,
      maxlength: [100, 'Department cannot exceed 100 characters'],
    },
    semester: {
      type: Number,
      min: [1, 'Semester must be between 1 and 12'],
      max: [12, 'Semester must be between 1 and 12'],
      validate: {
        validator: Number.isInteger,
        message: 'Semester must be a whole number',
      },
    },
  },
  {
    timestamps: true, // adds createdAt and updatedAt
    toJSON: {
      // Never expose the password hash (or the internal version key) in JSON responses.
      transform: (doc, ret) => {
        delete ret.password;
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      transform: (doc, ret) => {
        delete ret.password;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Hash the password only when it is new or has been changed.
// Validation (minimum length etc.) runs on the plain-text value before this hook.
// Note: this hook runs for save()/create(); it is skipped by update queries and insertMany().
userSchema.pre('save', async function hashPassword() {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, config.bcryptSaltRounds);
});

// Compares a plain-text password with the stored hash. Used by login (next step).
// The user must be loaded with .select('+password').
userSchema.methods.comparePassword = async function comparePassword(candidatePassword) {
  if (!this.password) {
    throw new Error("Password hash is not loaded. Query the user with .select('+password').");
  }
  if (typeof candidatePassword !== 'string' || candidatePassword.length === 0) return false;
  // bcrypt ignores everything after 72 bytes, so reject longer input instead of matching only its prefix.
  if (Buffer.byteLength(candidatePassword, 'utf8') > MAX_PASSWORD_BYTES) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);

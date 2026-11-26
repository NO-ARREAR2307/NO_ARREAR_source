'use strict';

// Central export for all Mongoose models.
// Requiring this file registers every schema (and its indexes) with Mongoose.
const User = require('./User');
const University = require('./University');
const Department = require('./Department');
const Regulation = require('./Regulation');
const Semester = require('./Semester');
const Subject = require('./Subject');
const Paper = require('./Paper');
const EmailOtp = require('./EmailOtp');
const PasswordReset = require('./PasswordReset');
const SavedQuestionSet = require('./SavedQuestionSet');
const GeneratedQuestionSet = require('./GeneratedQuestionSet');

module.exports = { User, University, Department, Regulation, Semester, Subject, Paper, EmailOtp, PasswordReset, SavedQuestionSet, GeneratedQuestionSet };

'use strict';

const express = require('express');
const systemRoutes = require('./systemRoutes');
const authRoutes = require('./authRoutes');
const paperRoutes = require('./paperRoutes');
const questionRoutes = require('./questionRoutes');
const adminRoutes = require('./adminRoutes');
const academicRoutes = require('./academicRoutes');
const savedQuestionSetRoutes = require('./savedQuestionSetRoutes');
const sharedRoutes = require('./sharedRoutes');

const router = express.Router();

// All routes below are mounted under /api (see app.js).
// New feature routers (auth, subjects, ...) get mounted here.
router.use('/', systemRoutes);
router.use('/auth', authRoutes);
router.use('/papers', paperRoutes);
router.use('/questions', questionRoutes);
router.use('/admin', adminRoutes);
router.use('/academic', academicRoutes);
router.use('/saved-question-sets', savedQuestionSetRoutes);
router.use('/shared', sharedRoutes);

module.exports = router;

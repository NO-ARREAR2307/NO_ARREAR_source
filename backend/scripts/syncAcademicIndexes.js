'use strict';

// Makes the indexes of the five academic collections match the schemas (it drops indexes that are no
// longer defined and creates missing ones). It never changes documents.
//   npm run sync:academic-indexes
//
// Databases that already contain academic data should use `npm run migrate:academic` instead: it also
// moves old semesters to regulations. This script is kept for index-only repairs (for example the old
// unique index on subjects.code from the first Subject model, or the old {department, semesterNumber}
// semester index, both of which would reject valid new records).

const { connectDB, disconnectDB } = require('../config/db');
const logger = require('../utils/logger');
const { University, Department, Regulation, Semester, Subject } = require('../models');

const main = async () => {
  try {
    await connectDB(); // logs the reason and a hint, then throws, if the database is unreachable
  } catch (err) {
    return 1;
  }

  let exitCode = 0;
  try {
    for (const Model of [University, Department, Regulation, Semester, Subject]) {
      const dropped = await Model.syncIndexes();
      logger.info(`${Model.collection.name}: indexes in sync${dropped.length ? ` (dropped: ${dropped.join(', ')})` : ''}.`);
    }
    const legacy = await Subject.countDocuments({ semester: { $exists: false } });
    if (legacy > 0) {
      logger.warn(`${legacy} document(s) in "subjects" use the old structure (no semester reference). They were left untouched.`);
    }
    const unmigrated = await Semester.countDocuments({ regulation: { $exists: false } });
    if (unmigrated > 0) {
      logger.warn(`${unmigrated} semester(s) have no regulation yet. Run "npm run migrate:academic" to review and migrate them.`);
    }
  } catch (err) {
    logger.error(`Index sync failed: ${err.message}`);
    exitCode = 1;
  } finally {
    await disconnectDB();
  }
  return exitCode;
};

main().then((code) => process.exit(code));

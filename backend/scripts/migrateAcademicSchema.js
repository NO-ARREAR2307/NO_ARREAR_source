'use strict';

// Migrates existing academic data to the Phase 1C structure
// (University -> Department -> Regulation -> Semester -> Subject). See README "Migrating existing academic data".
//
//   npm run migrate:academic                      DRY RUN: only reports what would change
//   npm run migrate:academic -- --apply ...       performs the migration
//
// Options (nothing is guessed: whatever is not supplied is reported and left untouched):
//   --level UG|PG                 level for every department that has none
//   --level-map file.json         { "<departmentId>": "UG" | "PG", ... }
//   --regulation "2023-2024"      regulation name for every department that still has old semesters
//   --regulation-map file.json    { "<departmentId>": "<regulation name>", ... }
//   --apply                       write the changes (default: dry run)
//
// Nothing is deleted. After --apply the script drops the obsolete semester index and then makes the
// indexes of the five academic collections match the schemas (syncIndexes). Safe to run again.

const fs = require('fs');
const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('../config/db');
const logger = require('../utils/logger');
const { University, Department, Regulation, Semester, Subject } = require('../models');
const { migrateAcademicData } = require('../services/academicMigrationService');

const FLAGS_WITH_VALUE = ['--level', '--level-map', '--regulation', '--regulation-map'];

const parseArgs = (argv) => {
  const args = { apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--apply') args.apply = true;
    else if (FLAGS_WITH_VALUE.includes(flag)) {
      if (argv[i + 1] === undefined) throw new Error(`${flag} needs a value`);
      args[flag.slice(2)] = argv[i + 1];
      i += 1;
    } else throw new Error(`Unknown option "${flag}"`);
  }
  return args;
};

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

const main = async () => {
  let args;
  let options;
  try {
    args = parseArgs(process.argv.slice(2));
    options = {
      apply: args.apply,
      defaultLevel: args.level,
      defaultRegulation: args.regulation,
      levelMap: args['level-map'] ? readJson(args['level-map']) : undefined,
      regulationMap: args['regulation-map'] ? readJson(args['regulation-map']) : undefined,
    };
  } catch (err) {
    logger.error(err.message);
    return 1;
  }

  try {
    await connectDB();
  } catch (err) {
    return 1;
  }

  let exitCode = 0;
  try {
    const collection = (Model) => mongoose.connection.collection(Model.collection.name);
    const report = await migrateAcademicData(
      { departments: collection(Department), regulations: collection(Regulation), semesters: collection(Semester), subjects: collection(Subject) },
      options
    );

    if (args.apply) {
      for (const Model of [University, Department, Regulation, Semester, Subject]) {
        const dropped = await Model.syncIndexes();
        logger.info(`${Model.collection.name}: indexes in sync${dropped.length ? ` (dropped: ${dropped.join(', ')})` : ''}.`);
      }
    }

    console.log(JSON.stringify(report, null, 2));
    logger.info(args.apply ? 'Migration applied. No document was deleted.' : 'Dry run only: nothing was changed. Re-run with --apply to migrate.');
    if (report.needsAttention) {
      logger.warn('Some records need a decision (see needLevel, needRegulationName, orphaned, conflicts and missingTypeOrCategory above). They were left untouched.');
    }
  } catch (err) {
    logger.error(`Migration failed: ${err.message}`);
    exitCode = 1;
  } finally {
    await disconnectDB();
  }
  return exitCode;
};

main().then((code) => process.exit(code));

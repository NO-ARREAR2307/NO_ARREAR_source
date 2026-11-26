'use strict';

// One-time creation of the initial admin account. Run from the project folder:
//   1. Put ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD in .env (see .env.example).
//   2. npm run seed:admin
//   3. Delete ADMIN_PASSWORD from .env.
//
// Safe to run again: if an admin already exists, nothing is changed and no second admin is created.
// Optional flag: --promote-existing  makes an EXISTING account with ADMIN_EMAIL an admin
//                                    (only when no admin exists yet; its password is not changed).
// The password is never printed or logged.

const { config } = require('../config/env');
const logger = require('../utils/logger');
const { connectDB, disconnectDB } = require('../config/db');
const User = require('../models/User');
const { seedAdmin, SeedError } = require('../services/adminSeedService');

const KNOWN_FLAGS = ['--promote-existing'];

const main = async () => {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => !KNOWN_FLAGS.includes(arg));
  if (unknown.length > 0) {
    logger.error(`Unknown argument(s): ${unknown.join(', ')}. Allowed: ${KNOWN_FLAGS.join(', ')}`);
    return 1;
  }

  try {
    await connectDB(); // logs the reason and a hint, then throws, if the database is unreachable
  } catch (err) {
    return 1;
  }

  try {
    const result = await seedAdmin({
      User,
      input: config.adminSeed,
      promoteExisting: args.includes('--promote-existing'),
    });

    if (result.status === 'admin-exists') {
      logger.info('An admin account already exists. Nothing was changed.');
    } else if (result.status === 'promoted') {
      logger.info(`Existing account ${result.email} is now an admin. Its password was not changed.`);
    } else {
      logger.info(`Admin account created for ${result.email}.`);
    }
    if (result.status === 'created') {
      logger.warn('Now remove ADMIN_PASSWORD from your .env file.');
    }
    return 0;
  } catch (err) {
    if (err instanceof SeedError) {
      logger.error(err.message);
    } else {
      logger.error(`Admin setup failed: ${err && err.message ? err.message : err}`);
    }
    return 1;
  } finally {
    await disconnectDB().catch(() => {});
  }
};

main().then((code) => process.exit(code));

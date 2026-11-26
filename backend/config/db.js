'use strict';

const mongoose = require('mongoose');
const { config } = require('./env');
const logger = require('../utils/logger');

// Holds the in-flight/finished connection attempt so connectDB() never opens a second connection.
let connectionPromise = null;
let closing = false;
let hasConnected = false;

mongoose.connection.on('disconnected', () => {
  // Only report drops of an established connection, not a failed first attempt or a deliberate close.
  if (hasConnected && !closing) logger.warn('MongoDB disconnected.');
});
mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected.'));
mongoose.connection.on('error', (error) => logger.error(`MongoDB error: ${redact(error.message)}`));

// Never let credentials from a connection string reach the logs.
function redact(message) {
  return String(message || '').replace(/\/\/[^@\s/]+@/g, '//***@');
}

function getConnectionHint(error) {
  const message = String((error && error.message) || '');

  if (/bad auth|authentication failed/i.test(message)) {
    return 'Authentication failed. Check the database username and password in MONGO_URI (URL-encode special characters in the password).';
  }
  if (/ENOTFOUND|querySrv|EAI_AGAIN/i.test(message)) {
    return 'The cluster address could not be resolved. Check the host name in MONGO_URI and your internet connection.';
  }
  if ((error && error.name === 'MongooseServerSelectionError') || /ECONNREFUSED|timed out/i.test(message)) {
    return 'Could not reach the database. In Atlas, open Network Access and add your current IP address, and make sure the cluster is running.';
  }
  return 'Check MONGO_URI and your Atlas settings.';
}

/**
 * Connects to MongoDB using MONGO_URI. Safe to call more than once:
 * repeated calls reuse the same connection. Throws if the connection fails.
 */
const connectDB = async () => {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (connectionPromise) return connectionPromise;

  if (!config.mongoUri) {
    throw new Error('MONGO_URI is not set. Add it to your .env file.');
  }

  closing = false;
  connectionPromise = mongoose
    .connect(config.mongoUri, {
      serverSelectionTimeoutMS: 10000,
      // autoIndex stays on (Mongoose default) in every environment: it is what creates the
      // unique index on User.email, which prevents duplicate accounts.
    })
    .then(() => {
      hasConnected = true;
      const { host, name } = mongoose.connection;
      logger.info(`MongoDB connected: ${host} (database: ${name})`);
      return mongoose.connection;
    })
    .catch((error) => {
      connectionPromise = null; // allow a later retry
      logger.error(`MongoDB connection failed: ${redact(error.message)}`);
      logger.error(getConnectionHint(error));
      throw error;
    });

  return connectionPromise;
};

const disconnectDB = async () => {
  connectionPromise = null;
  if (mongoose.connection.readyState === 0) return;

  closing = true;
  await mongoose.connection.close();
  logger.info('MongoDB connection closed.');
};

module.exports = { connectDB, disconnectDB };

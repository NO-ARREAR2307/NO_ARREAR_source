'use strict';

// Importing config first loads the .env file (dotenv) before anything else reads process.env.
const { config, validateEnv } = require('./config/env');
const logger = require('./utils/logger');
const { isEmailConfigured } = require('./services/emailService');

// Stop early with a clear message if the environment is misconfigured.
const envProblems = validateEnv();
if (envProblems.length > 0) {
  logger.error('Configuration problem(s) found:');
  envProblems.forEach((problem) => logger.error(`  - ${problem}`));
  logger.error('Fix them in your .env file (create it with: Copy-Item .env.example .env).');
  process.exit(1);
}

if (!config.gemini.apiKey) {
  logger.warn('GEMINI_API_KEY is not set: POST /api/questions/ask will answer 503 until it is added to .env.');
} else {
  logger.info(
    `Gemini AI configured (model: ${config.gemini.model}, timeout: ${config.gemini.timeoutMs} ms, ` +
      `thinking: ${config.gemini.thinkingLevel}, max output tokens: ${config.gemini.maxOutputTokens}).`
  );
}

if (isEmailConfigured()) {
  logger.info(`Brevo SMTP configured (host: ${config.email.host}, port: ${config.email.port}, sender: ${config.email.fromAddress}).`);
} else {
  logger.warn('Brevo SMTP is not configured: verification emails cannot be sent (registration still works; resending a code answers 503) until BREVO_SMTP_USER, BREVO_SMTP_PASS and EMAIL_FROM_ADDRESS are added to .env.');
}

const app = require('./app');
const { connectDB, disconnectDB } = require('./config/db');

let server;

const startServer = async () => {
  // The HTTP server only starts listening after the database is connected.
  try {
    await connectDB();
  } catch (error) {
    // connectDB() has already logged the reason and a hint.
    logger.error('Server not started because the database connection failed.');
    process.exit(1);
  }

  server = app.listen(config.port, () => {
    logger.info(`StudyWise AI API running in ${config.nodeEnv} mode at http://localhost:${config.port}${config.apiPrefix}`);
    logger.info(`Health check: http://localhost:${config.port}${config.apiPrefix}/health`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      logger.error(`Port ${config.port} is already in use. Change PORT in .env or stop the other process.`);
    } else if (error.code === 'EACCES') {
      logger.error(`Permission denied for port ${config.port}. Choose a different PORT in .env.`);
    } else {
      logger.error(`Server error: ${error.message}`);
    }
    process.exit(1);
  });
};

let shuttingDown = false;

const shutdown = async (reason, exitCode = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${reason} - shutting down gracefully...`);

  // Safety net: force exit if open connections keep the server from closing.
  const forceExit = setTimeout(() => {
    logger.error('Shutdown timed out. Forcing exit.');
    process.exit(1);
  }, 10000);
  forceExit.unref();

  try {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      logger.info('HTTP server closed.');
    }
    await disconnectDB();
    process.exit(exitCode);
  } catch (error) {
    logger.error(`Error during shutdown: ${error.message}`);
    process.exit(1);
  }
};

process.on('SIGINT', () => shutdown('SIGINT received'));
process.on('SIGTERM', () => shutdown('SIGTERM received'));
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection:', reason);
  shutdown('Unhandled rejection', 1);
});
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  shutdown('Uncaught exception', 1);
});

startServer();

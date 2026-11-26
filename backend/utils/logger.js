'use strict';

const { config } = require('../config/env');

const write = (level, output, args) => {
  output(`[${new Date().toISOString()}] [${level}]`, ...args);
};

const logger = {
  info: (...args) => write('INFO', console.log, args),
  warn: (...args) => write('WARN', console.warn, args),
  error: (...args) => write('ERROR', console.error, args),
  debug: (...args) => {
    if (!config.isProduction) write('DEBUG', console.log, args);
  },
};

module.exports = logger;

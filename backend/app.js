'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const { config } = require('./config/env');
const routes = require('./routes');
const { apiLimiter } = require('./middleware/rateLimiter');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');
const { redactShareTokens } = require('./utils/shareToken');

const app = express();

// Needed to read the real client IP when deployed behind a proxy/load balancer.
if (config.isProduction) app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: config.corsOrigins, credentials: true }));
// Share tokens are part of public URLs (/api/shared/materials/<token>); the access log must not keep working links.
morgan.token('url', (req) => redactShareTokens(req.originalUrl || req.url));
app.use(morgan(config.isProduction ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use(config.apiPrefix, apiLimiter, routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;

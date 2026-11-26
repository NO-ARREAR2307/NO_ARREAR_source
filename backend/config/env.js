'use strict';

const path = require('path');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');

// Load variables from the .env file in the project root (if it exists).
dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

// Same pattern as models/User.js.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

const nodeEnv = process.env.NODE_ENV || 'development';

const config = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  port: toInt(process.env.PORT, 5000),
  apiPrefix: '/api',
  mongoUri: (process.env.MONGO_URI || '').trim(),
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  // Used by utils/generateToken.js and middleware/authMiddleware.js.
  jwt: {
    secret: process.env.JWT_SECRET || '',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  // Phase 2C: base URL of the frontend page that shows a shared question set (https://<app>/shared/<token>).
  // Optional; defaults to the first CORS origin.
  share: {
    publicBaseUrl: (process.env.SHARE_BASE_URL || '').trim().replace(/\/+$/, ''),
    // Phase 4.3A: per-IP limit for the public, login-free study material links (GET /api/shared/materials/...).
    // It counts every request, valid token or not, so one client cannot try tokens at speed. Optional.
    publicLimitWindowMs: toInt(process.env.SHARED_ACCESS_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    publicLimitMax: toInt(process.env.SHARED_ACCESS_LIMIT_MAX, 100),
  },
  // Phase 2E: server-enforced ceiling for the number of questions one generation request (and one saved set) may hold.
  questionGeneration: {
    maxTotalQuestions: Math.min(50, Math.max(1, toInt(process.env.MAX_QUESTIONS_PER_REQUEST, 30))),
    // Phase 3C-2: uploaded-material limits for POST /api/questions/important. The material is NEVER cut to fit:
    // a request whose combined text is over maxMaterialChars is refused with a clear message instead.
    maxPapers: 3,
    maxMaterialChars: Math.min(400000, Math.max(5000, toInt(process.env.MAX_MATERIAL_CHARS_PER_REQUEST, 120000))),
    minMaterialChars: 100,
  },
  bcryptSaltRounds: toInt(process.env.BCRYPT_SALT_ROUNDS, 10),
  rateLimit: {
    windowMs: toInt(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    max: toInt(process.env.RATE_LIMIT_MAX, 300),
  },
  // Text extraction (PDF) and OCR (images). All values are optional; the defaults are safe.
  extraction: {
    pdfTimeoutMs: toInt(process.env.PDF_TIMEOUT_MS, 60 * 1000),
    maxPdfPages: toInt(process.env.MAX_PDF_PAGES, 200),
    ocrTimeoutMs: toInt(process.env.OCR_TIMEOUT_MS, 90 * 1000),
    ocrLang: (process.env.OCR_LANG || 'eng').trim(),
    // Optional folder holding an UNCOMPRESSED <lang>.traineddata file for fully offline OCR.
    ocrLangPath: (process.env.OCR_LANG_PATH || '').trim(),
    ocrCachePath: path.join(__dirname, '..', '.ocr-cache'),
    maxQueuedOcrJobs: toInt(process.env.OCR_MAX_QUEUE, 5),
    maxTextChars: toInt(process.env.MAX_EXTRACTED_TEXT_CHARS, 1000000),
    // Per-user limit for the (expensive) extract endpoint.
    userLimitWindowMs: toInt(process.env.EXTRACT_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    userLimitMax: toInt(process.env.EXTRACT_LIMIT_MAX, 20),
  },
  // Initial admin account, read ONLY by scripts/seedAdmin.js (never by the running server).
  // Remove ADMIN_PASSWORD from .env after the admin has been created.
  adminSeed: {
    name: (process.env.ADMIN_NAME || '').trim(),
    email: (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
    password: process.env.ADMIN_PASSWORD || '',
  },
  // Gemini AI (used by services/geminiService.js). The key is optional at startup so the rest of
  // the API keeps working without it; the questions endpoint answers 503 until it is set.
  gemini: {
    apiKey: (process.env.GEMINI_API_KEY || '').trim(),
    // Accept both "gemini-3.8-flash" and "models/gemini-3.8-flash" (the API itself reports the latter).
    model: (process.env.GEMINI_MODEL || 'gemini-3.8-flash').trim().replace(/^models\//i, ''),
    baseUrl: (process.env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').trim().replace(/\/+$/, ''),
    timeoutMs: toInt(process.env.GEMINI_TIMEOUT_MS, 45 * 1000),
    // Gemini 3 models count their internal "thinking" tokens in this limit, so keep it generous.
    maxOutputTokens: toInt(process.env.GEMINI_MAX_OUTPUT_TOKENS, 8192),
    // "low", "medium" or "high" (Gemini 3.x). Low keeps answers fast. Set to "none" to not send it.
    thinkingLevel: (process.env.GEMINI_THINKING_LEVEL || 'low').trim().toLowerCase(),
  },
  // Outgoing email through Brevo SMTP (used by services/emailService.js). Everything is optional at
  // startup so the rest of the API keeps working; sending a verification email answers 503 until the
  // three credentials below are set. The values only ever come from the environment.
  email: {
    host: (process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com').trim(),
    port: toInt(process.env.BREVO_SMTP_PORT, 587),
    user: (process.env.BREVO_SMTP_USER || '').trim(), // the SMTP login shown in Brevo (not your account email)
    pass: process.env.BREVO_SMTP_PASS || '', // the Brevo SMTP key
    fromAddress: (process.env.EMAIL_FROM_ADDRESS || '').trim(), // must be a verified sender in Brevo
    fromName: (process.env.EMAIL_FROM_NAME || 'STUDYWISE AI').trim(),
    timeoutMs: toInt(process.env.EMAIL_TIMEOUT_MS, 15 * 1000),
  },
  // Student email verification codes (services/otpService.js). The 6-digit length and the 5-minute
  // lifetime are fixed in the service on purpose; only the resend limits are configurable.
  emailOtp: {
    resendCooldownSeconds: toInt(process.env.OTP_RESEND_COOLDOWN_SECONDS, 60),
    // Per-IP cap on resend requests (per 15 minutes), on top of the per-account cooldown.
    resendLimitMax: toInt(process.env.OTP_RESEND_LIMIT_MAX, 10),
    resendLimitWindowMs: 15 * 60 * 1000,
    // Key for hashing codes. Optional: when empty, a key derived from JWT_SECRET is used.
    hashSecret: process.env.OTP_HASH_SECRET || '',
    // Wrong guesses allowed per code. After this many the code is locked until a new one is requested.
    maxAttempts: toInt(process.env.OTP_MAX_ATTEMPTS, 5),
    // Per-IP cap on POST /api/auth/verify-email (per 15 minutes), on top of the per-code attempt limit.
    verifyLimitMax: toInt(process.env.OTP_VERIFY_LIMIT_MAX, 20),
    verifyLimitWindowMs: 15 * 60 * 1000,
  },
};

/**
 * Returns a list of human-readable problems with the current configuration.
 * An empty list means the server is safe to start.
 */
const validateEnv = () => {
  const problems = [];

  if (!config.mongoUri) {
    problems.push('MONGO_URI is not set. Add your MongoDB Atlas connection string to .env.');
  } else if (!/^mongodb(\+srv)?:\/\//.test(config.mongoUri)) {
    problems.push('MONGO_URI must start with "mongodb://" or "mongodb+srv://".');
  } else if (/[<>]/.test(config.mongoUri)) {
    problems.push('MONGO_URI still contains <placeholders>. Replace <username>, <password> and <cluster-url> with your Atlas values.');
  }

  if (!['development', 'production', 'test'].includes(config.nodeEnv)) {
    problems.push(`NODE_ENV must be "development", "production" or "test" (received "${config.nodeEnv}").`);
  }

  const rawPort = process.env.PORT;
  if (rawPort !== undefined && rawPort.trim() !== '') {
    const port = Number(rawPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      problems.push(`PORT must be a whole number between 1 and 65535 (received "${rawPort}").`);
    }
  }

  // bcryptjs silently clamps out-of-range values (for example 1 becomes 4), so reject them here.
  const rawRounds = process.env.BCRYPT_SALT_ROUNDS;
  if (rawRounds !== undefined && rawRounds.trim() !== '') {
    const rounds = Number(rawRounds);
    if (!Number.isInteger(rounds) || rounds < 10 || rounds > 15) {
      problems.push(`BCRYPT_SALT_ROUNDS must be a whole number between 10 and 15 (received "${rawRounds}").`);
    }
  }

  // Authentication is active, so a missing/weak secret or invalid lifetime must stop startup
  // (otherwise login would only fail later with a generic 500).
  if (!config.jwt.secret) {
    problems.push('JWT_SECRET is not set. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  } else if (config.jwt.secret.length < 32) {
    problems.push('JWT_SECRET must be at least 32 characters long. Generate a strong one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  } else {
    try {
      jwt.sign({}, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
    } catch (error) {
      problems.push(`JWT_EXPIRES_IN is invalid (received "${config.jwt.expiresIn}"). Use values like "7d", "12h" or "3600".`);
    }
  }

  // ----- Email (Brevo SMTP) and email OTP: all optional, but a half-filled setup is a mistake -----
  const rawSmtpPort = process.env.BREVO_SMTP_PORT;
  if (rawSmtpPort !== undefined && rawSmtpPort.trim() !== '') {
    const smtpPort = Number(rawSmtpPort);
    if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
      problems.push(`BREVO_SMTP_PORT must be a whole number between 1 and 65535 (received "${rawSmtpPort}").`);
    }
  }
  const smtpPartsSet = [config.email.user, config.email.pass, config.email.fromAddress].filter(Boolean).length;
  if (smtpPartsSet > 0 && smtpPartsSet < 3) {
    problems.push('Brevo SMTP is only partly configured. Set BREVO_SMTP_USER, BREVO_SMTP_PASS and EMAIL_FROM_ADDRESS together, or leave all three empty.');
  }
  if (config.email.fromAddress && !EMAIL_PATTERN.test(config.email.fromAddress)) {
    problems.push('EMAIL_FROM_ADDRESS is not a valid email address.');
  }
  const rawCooldown = process.env.OTP_RESEND_COOLDOWN_SECONDS;
  if (rawCooldown !== undefined && rawCooldown.trim() !== '') {
    const cooldown = Number(rawCooldown);
    if (!Number.isInteger(cooldown) || cooldown < 10 || cooldown > 3600) {
      problems.push(`OTP_RESEND_COOLDOWN_SECONDS must be a whole number between 10 and 3600 (received "${rawCooldown}").`);
    }
  }
  const rawResendMax = process.env.OTP_RESEND_LIMIT_MAX;
  if (rawResendMax !== undefined && rawResendMax.trim() !== '') {
    const resendMax = Number(rawResendMax);
    if (!Number.isInteger(resendMax) || resendMax < 1) {
      problems.push(`OTP_RESEND_LIMIT_MAX must be a whole number of at least 1 (received "${rawResendMax}").`);
    }
  }
  const rawMaxAttempts = process.env.OTP_MAX_ATTEMPTS;
  if (rawMaxAttempts !== undefined && rawMaxAttempts.trim() !== '') {
    const maxAttempts = Number(rawMaxAttempts);
    if (!Number.isInteger(maxAttempts) || maxAttempts < 3 || maxAttempts > 10) {
      problems.push(`OTP_MAX_ATTEMPTS must be a whole number between 3 and 10 (received "${rawMaxAttempts}").`);
    }
  }
  const rawVerifyMax = process.env.OTP_VERIFY_LIMIT_MAX;
  if (rawVerifyMax !== undefined && rawVerifyMax.trim() !== '') {
    const verifyMax = Number(rawVerifyMax);
    if (!Number.isInteger(verifyMax) || verifyMax < 1) {
      problems.push(`OTP_VERIFY_LIMIT_MAX must be a whole number of at least 1 (received "${rawVerifyMax}").`);
    }
  }
  if (config.emailOtp.hashSecret && config.emailOtp.hashSecret.length < 32) {
    problems.push('OTP_HASH_SECRET must be at least 32 characters long (or leave it empty to derive the key from JWT_SECRET).');
  }

  if (config.share.publicBaseUrl && !/^https?:\/\/[^\s/]+/i.test(config.share.publicBaseUrl)) {
    problems.push('SHARE_BASE_URL must start with http:// or https:// (for example https://studywise.example.com).');
  }

  const rawMaxQuestions = process.env.MAX_QUESTIONS_PER_REQUEST;
  if (rawMaxQuestions !== undefined && rawMaxQuestions.trim() !== '') {
    const maxQuestions = Number(rawMaxQuestions);
    if (!Number.isInteger(maxQuestions) || maxQuestions < 1 || maxQuestions > 50) {
      problems.push(`MAX_QUESTIONS_PER_REQUEST must be a whole number between 1 and 50 (received "${rawMaxQuestions}").`);
    }
  }

  const rawMaterialChars = process.env.MAX_MATERIAL_CHARS_PER_REQUEST;
  if (rawMaterialChars !== undefined && rawMaterialChars.trim() !== '') {
    const materialChars = Number(rawMaterialChars);
    if (!Number.isInteger(materialChars) || materialChars < 5000 || materialChars > 400000) {
      problems.push(`MAX_MATERIAL_CHARS_PER_REQUEST must be a whole number between 5000 and 400000 (received "${rawMaterialChars}").`);
    }
  }

  if (config.corsOrigins.length === 0) {
    problems.push('CORS_ORIGIN must contain at least one allowed origin, for example http://localhost:5173.');
  }

  return problems;
};

module.exports = { config, validateEnv };

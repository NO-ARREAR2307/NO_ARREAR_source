'use strict';

const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { sendSuccess } = require('../utils/apiResponse');
const { generateAnswer, streamAnswer } = require('../services/geminiService');

const MAX_QUESTION_LENGTH = 10000;
// An SSE comment line is sent this often while the stream is open so proxies do not close an idle connection.
const SSE_HEARTBEAT_MS = 15 * 1000;

// Validates req.body.question and returns the trimmed text. Throws a 400 ApiError with details.
const validateQuestion = (body) => {
  const question = body && typeof body === 'object' ? body.question : undefined;

  if (question === undefined || question === null) {
    throw ApiError.badRequest('Validation failed', [{ field: 'question', message: 'Question is required' }]);
  }
  if (typeof question !== 'string') {
    throw ApiError.badRequest('Validation failed', [{ field: 'question', message: 'Question must be plain text' }]);
  }

  const trimmed = question.trim();
  if (trimmed.length === 0) {
    throw ApiError.badRequest('Validation failed', [{ field: 'question', message: 'Question cannot be empty' }]);
  }
  if (trimmed.length > MAX_QUESTION_LENGTH) {
    throw ApiError.badRequest('Validation failed', [
      { field: 'question', message: `Question cannot exceed ${MAX_QUESTION_LENGTH.toLocaleString('en-US')} characters` },
    ]);
  }
  return trimmed;
};

// POST /api/questions/ask   (protected by middleware/authMiddleware.js)
// Express 5 forwards rejected promises from async handlers to the error handler.
const askQuestion = async (req, res) => {
  const question = validateQuestion(req.body);
  const { answer } = await generateAnswer(question);

  return sendSuccess(res, {
    message: 'Answer generated successfully',
    data: { question, answer },
  });
};

// ---------- Streaming: POST /api/questions/ask/stream ----------

// Resolves when the response is writable again (or the connection is gone).
const waitForDrain = (res) =>
  new Promise((resolve) => {
    const done = () => {
      res.off('drain', done);
      res.off('close', done);
      resolve();
    };
    res.once('drain', done);
    res.once('close', done);
  });

// Writes one Server-Sent Event: "event: <name>" + one "data:" line of JSON + blank line.
// JSON.stringify never emits a raw newline, so one data line is always enough.
const writeEvent = async (res, event, data) => {
  if (res.writableEnded || res.destroyed) return;
  const flushed = res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  if (!flushed) await waitForDrain(res);
};

// POST /api/questions/ask/stream   (protected by middleware/authMiddleware.js)
//
// Validation, authentication and every failure that happens BEFORE Gemini starts answering (bad key,
// quota, timeout, unreachable...) are answered exactly like the JSON endpoint: a normal JSON error with
// the proper HTTP status, through the central error handler. Only once Gemini has produced its first
// text does the response switch to text/event-stream. From then on a failure can no longer change the
// HTTP status, so it is sent as an "error" event instead.
//
// Events (each: "event: <name>" and "data: <one line of JSON>"):
//   start  { question }
//   chunk  { text }                        repeated, in order; concatenating text gives the answer
//   done   { success: true, message: "Answer generated successfully",
//            data: { finishReason, chunks, characters, truncated } }
//   error  { success: false, message, status }   only if generation fails after the stream started
const askQuestionStream = async (req, res) => {
  const question = validateQuestion(req.body);

  // Client disconnect: "close" fires on the response; if it was not finished, the client went away.
  const abortController = new AbortController();
  let clientClosed = false;
  res.on('close', () => {
    if (!res.writableFinished) {
      clientClosed = true;
      abortController.abort(); // cancels the request to Gemini
    }
  });

  const iterator = streamAnswer(question, { signal: abortController.signal });

  let step;
  try {
    step = await iterator.next(); // waits for Gemini's first text; nothing has been sent to the client yet
  } catch (err) {
    if (clientClosed) {
      logger.info('Client disconnected before the answer started; the Gemini request was cancelled.');
      return undefined;
    }
    throw err; // headers not sent yet: the central error handler answers with a normal JSON error
  }
  if (clientClosed) {
    await iterator.return();
    logger.info('Client disconnected before the answer started; the Gemini request was cancelled.');
    return undefined;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // tells nginx-style proxies not to buffer the stream
  res.flushHeaders();

  const heartbeat = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) res.write(': keep-alive\n\n');
  }, SSE_HEARTBEAT_MS);
  heartbeat.unref();

  try {
    await writeEvent(res, 'start', { question });
    while (!step.done) {
      if (clientClosed) break;
      await writeEvent(res, 'chunk', { text: step.value.text });
      step = await iterator.next();
    }
    if (!clientClosed) {
      const summary = step.value || {};
      await writeEvent(res, 'done', {
        success: true,
        message: 'Answer generated successfully',
        data: {
          finishReason: summary.finishReason || null,
          chunks: summary.chunks || 0,
          characters: summary.characters || 0,
          truncated: summary.finishReason === 'MAX_TOKENS',
        },
      });
    }
  } catch (err) {
    if (clientClosed) {
      logger.info('Client disconnected while the answer was streaming; the Gemini request was cancelled.');
    } else {
      // Only ApiError messages (already client-safe) are sent; anything else is logged, not shown.
      const apiError = err instanceof ApiError ? err : null;
      if (!apiError) logger.error('Unexpected error while streaming an answer', err && err.stack ? err.stack : err);
      await writeEvent(res, 'error', {
        success: false,
        message: apiError ? apiError.message : 'Something went wrong while generating the answer.',
        status: apiError ? apiError.statusCode : 500,
      });
    }
  } finally {
    clearInterval(heartbeat);
    await iterator.return(); // releases the Gemini connection if it is still open (no-op when finished)
    if (!res.writableEnded && !res.destroyed) res.end();
  }
  return undefined;
};

module.exports = { askQuestion, askQuestionStream, validateQuestion, MAX_QUESTION_LENGTH };

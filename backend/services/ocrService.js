'use strict';

const { config } = require('../config/env');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

// OCR runs locally with Tesseract.js (WebAssembly, no external/paid API). Images are first cleaned
// up with sharp (auto-rotate from EXIF, greyscale, contrast, sharpen, resize). If the first pass
// reads poorly, the image is also tried rotated by 90/270/180 degrees and the best result is kept.

const MAX_INPUT_PIXELS = 40 * 1000 * 1000; // refuse "decompression bomb" images (about 40 megapixels)
const MIN_WIDTH = 1200; // smaller images are enlarged: Tesseract reads small text poorly
const TARGET_SMALL_WIDTH = 1600;
const MAX_WIDTH = 3000; // larger images are reduced: saves time and memory
const ROTATION_ANGLES = [90, 270, 180];
const GOOD_ENOUGH_CONFIDENCE = 60; // stop trying other rotations at or above this
const IDLE_TERMINATE_MS = 60 * 1000; // free the OCR worker's memory after a minute of no use

// "Readable" thresholds: below any of these the image is reported as having no readable text.
const MIN_READABLE_CHARS = 15;
const MIN_READABLE_WORDS = 3;
const MIN_CONFIDENCE = 30;

// ---------- engine handling (one shared worker, jobs run one at a time) ----------

// An engine is { recognize(buffer) -> { text, confidence }, terminate() }.
const createTesseractEngine = async () => {
  const { createWorker } = require('tesseract.js');
  const { ocrLang, ocrLangPath, ocrCachePath } = config.extraction;

  const options = {
    cachePath: ocrCachePath,
    errorHandler: (err) => logger.error(`OCR worker error: ${(err && err.message) || err}`),
  };
  if (ocrLangPath) {
    options.langPath = ocrLangPath; // folder with an uncompressed <lang>.traineddata
    options.gzip = false;
  }

  const worker = await createWorker(ocrLang, 1, options); // 1 = LSTM engine
  return {
    recognize: async (buffer) => {
      const { data } = await worker.recognize(buffer);
      return { text: data.text || '', confidence: Number(data.confidence) || 0 };
    },
    terminate: () => worker.terminate(),
  };
};

let engineFactory = createTesseractEngine;
let enginePromise = null;
let idleTimer = null;
let waitingJobs = 0;
let queueTail = Promise.resolve();

const resetEngine = async () => {
  clearTimeout(idleTimer);
  const current = enginePromise;
  enginePromise = null;
  if (!current) return;
  try {
    const engine = await current;
    await engine.terminate();
  } catch (err) {
    // Nothing useful to do: the engine is gone either way.
  }
};

const getEngine = async () => {
  clearTimeout(idleTimer);
  if (!enginePromise) {
    enginePromise = Promise.resolve()
      .then(engineFactory)
      .catch((err) => {
        enginePromise = null;
        logger.error(`OCR engine failed to start: ${(err && err.message) || err}`);
        throw new ApiError(
          503,
          'The OCR engine could not start. If this is the first OCR run, the server needs internet access once ' +
            'to download the language data (see the README), or OCR_LANG_PATH must point to a valid .traineddata file.'
        );
      });
  }
  return enginePromise;
};

const scheduleIdleTerminate = () => {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => resetEngine(), IDLE_TERMINATE_MS);
  idleTimer.unref();
};

// Runs `job` after all earlier OCR jobs finish. Refuses new work if too many are already waiting,
// so a burst of requests cannot pile up unbounded memory/CPU use.
const enqueue = (job) => {
  if (waitingJobs >= config.extraction.maxQueuedOcrJobs) {
    throw new ApiError(503, 'The OCR service is busy. Please try again in a minute.');
  }
  waitingJobs += 1;
  const run = queueTail.then(() => {
    waitingJobs -= 1;
    return job();
  });
  queueTail = run.catch(() => {});
  return run;
};

class OcrTimeout extends Error {}

// One recognize() call that gives up at `deadline`. On timeout the worker is killed (the only way
// to stop Tesseract) and a fresh one is created for the next job.
const recognizeBefore = async (engine, buffer, deadline) => {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new OcrTimeout();

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new OcrTimeout()), remaining);
  });
  const attempt = engine.recognize(buffer);
  attempt.catch(() => {}); // a late failure after a timeout must not become an unhandled rejection
  try {
    return await Promise.race([attempt, timeout]);
  } catch (err) {
    if (err instanceof OcrTimeout) await resetEngine();
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

// ---------- image preparation ----------

let sharpModule = null;
const getSharp = () => {
  if (!sharpModule) sharpModule = require('sharp');
  return sharpModule;
};

const toImageError = (err) => {
  const message = String((err && err.message) || '');
  if (/pixel limit/i.test(message)) {
    return new ApiError(422, 'This image is too large to process. Please upload a smaller or lower-resolution image.');
  }
  logger.warn(`Image could not be decoded: ${message}`);
  return new ApiError(422, 'This image is corrupted or could not be read. Please upload a valid JPG or PNG.');
};

// Returns a greyscale, contrast-stretched, sharpened PNG of a sensible size.
const prepareImage = async (buffer) => {
  const sharp = getSharp();
  const options = { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' };
  try {
    const meta = await sharp(buffer, options).metadata();
    // EXIF orientations 5-8 are sideways, so width and height swap after auto-rotation.
    const sideways = meta.orientation >= 5 && meta.orientation <= 8;
    const width = (sideways ? meta.height : meta.width) || 0;

    let pipeline = sharp(buffer, options)
      .rotate() // applies the EXIF orientation (phone photos)
      .flatten({ background: '#ffffff' }) // transparent PNG -> white background
      .greyscale();

    if (width > 0 && width < MIN_WIDTH) {
      pipeline = pipeline.resize({ width: Math.min(TARGET_SMALL_WIDTH, width * 4), kernel: 'lanczos3' });
    } else if (width > MAX_WIDTH) {
      pipeline = pipeline.resize({ width: MAX_WIDTH });
    }

    return await pipeline.normalise().sharpen({ sigma: 1 }).png().toBuffer();
  } catch (err) {
    throw toImageError(err);
  }
};

const rotateImage = async (preparedPng, angle) => getSharp()(preparedPng).rotate(angle).png().toBuffer();

// ---------- result evaluation ----------

const cleanOcrText = (text) =>
  String(text || '')
    .replace(/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/g, '')
    .replace(/\f/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const analyse = (rawText, confidence, angle) => {
  const text = cleanOcrText(rawText);
  const chars = (text.match(/[\p{L}\p{N}]/gu) || []).length;
  const words = (text.match(/[\p{L}\p{N}]{2,}/gu) || []).length;
  return {
    text,
    confidence,
    angle,
    readable: chars >= MIN_READABLE_CHARS && words >= MIN_READABLE_WORDS && confidence >= MIN_CONFIDENCE,
    // Favours results that are both confident and long. Sideways text gives short, low-confidence junk.
    score: confidence * Math.log(1 + chars),
  };
};

// ---------- public API ----------

/**
 * Reads the text in a JPG/PNG image.
 * @param {Buffer} buffer the image file content
 * @returns {Promise<{ text: string, confidence: number, pageCount: 1, rotation: number }>}
 * Throws ApiError: 422 (corrupted image / no readable text / too slow), 503 (OCR busy or unavailable).
 */
const recognizeImage = async (buffer) => {
  const prepared = await prepareImage(buffer);

  const best = await enqueue(async () => {
    const deadline = Date.now() + config.extraction.ocrTimeoutMs;
    let bestResult = null;
    try {
      const engine = await getEngine();

      const first = await recognizeBefore(engine, prepared, deadline);
      bestResult = analyse(first.text, first.confidence, 0);

      // Poor first pass: the page may be sideways or upside down. Try the other orientations.
      if (!(bestResult.readable && bestResult.confidence >= GOOD_ENOUGH_CONFIDENCE)) {
        for (const angle of ROTATION_ANGLES) {
          const candidateImage = await rotateImage(prepared, angle);
          const result = await recognizeBefore(await getEngine(), candidateImage, deadline);
          const candidate = analyse(result.text, result.confidence, angle);
          if (candidate.score > bestResult.score) bestResult = candidate;
          if (bestResult.readable && bestResult.confidence >= GOOD_ENOUGH_CONFIDENCE) break;
        }
      }
      return bestResult;
    } catch (err) {
      if (err instanceof OcrTimeout) {
        // Out of time: keep what we already have if it is readable, otherwise report the timeout.
        if (bestResult && bestResult.readable) return bestResult;
        throw new ApiError(422, 'Reading this image took too long and was stopped. Try a clearer or smaller image.');
      }
      throw err;
    } finally {
      scheduleIdleTerminate();
    }
  });

  if (!best.readable) {
    throw new ApiError(
      422,
      'No readable text was found in this image. Upload a clear, well-lit, upright photo or scan of the question paper.'
    );
  }

  return {
    text: best.text,
    confidence: Math.round(best.confidence * 10) / 10,
    pageCount: 1,
    rotation: best.angle,
  };
};

// Stops the OCR worker (used on shutdown and by tests).
const shutdownOcr = () => resetEngine();

// Test hook: swap the OCR engine (the real one needs the Tesseract.js package and language data).
const _setEngineFactoryForTests = async (factory) => {
  await resetEngine();
  engineFactory = factory || createTesseractEngine;
};

module.exports = { recognizeImage, shutdownOcr, _setEngineFactoryForTests };

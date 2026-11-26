'use strict';

// Diagnostic for the Gemini integration. Run from the project folder:
//   npm run check:gemini                 (uses your .env as the server does)
//   npm run check:gemini -- --compare    (also compares thinking low / not sent)
//   npm run check:gemini -- --timeout=120000
// It prints settings (never the key), checks that the model exists and supports generateContent,
// then asks "What is DBMS?" and reports how long Gemini really takes.

const { config } = require('../config/env');
const { generateAnswer } = require('../services/geminiService');

const args = process.argv.slice(2);
const compare = args.includes('--compare');
const timeoutArg = args.find((a) => a.startsWith('--timeout='));
const probeTimeoutMs = timeoutArg ? Number(timeoutArg.split('=')[1]) : 120000;
const QUESTION = 'What is DBMS?';

const ms = (n) => `${n} ms`;
const line = (text = '') => console.log(text);

const checkModel = async () => {
  const { apiKey, baseUrl, model } = config.gemini;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${baseUrl}/models/${encodeURIComponent(model)}`, {
      headers: { 'x-goog-api-key': apiKey },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    const took = Date.now() - started;
    if (response.ok) {
      const methods = Array.isArray(body && body.supportedGenerationMethods) ? body.supportedGenerationMethods : [];
      const supported = methods.includes('generateContent');
      line(`  Model lookup: HTTP ${response.status} in ${ms(took)} - "${model}" ${supported ? 'exists and supports generateContent' : 'exists but does NOT list generateContent'}`);
      return supported;
    }
    const message = body && body.error && body.error.message ? String(body.error.message).slice(0, 200) : '';
    line(`  Model lookup: HTTP ${response.status} in ${ms(took)}${message ? ` - ${message}` : ''}`);
    if (response.status === 404) line('  -> The model name is not available for this key. Set GEMINI_MODEL to a current model.');
    if ([400, 401, 403].includes(response.status)) line('  -> The API key was rejected. Check GEMINI_API_KEY.');
    return false;
  } catch (err) {
    const reason = err && err.name === 'AbortError' ? 'no response within 20 s' : (err && err.cause && err.cause.code) || (err && err.name) || 'unknown';
    line(`  Model lookup: FAILED (${reason}) after ${ms(Date.now() - started)}`);
    line('  -> Cannot reach generativelanguage.googleapis.com. Check internet, VPN, proxy, firewall or antivirus HTTPS scanning.');
    return false;
  } finally {
    clearTimeout(timer);
  }
};

const ask = async (label, options) => {
  process.stdout.write(`  ${label}: `);
  const started = Date.now();
  try {
    const result = await generateAnswer(QUESTION, { timeoutMs: probeTimeoutMs, ...options });
    line(`OK in ${ms(result.elapsedMs)} (finishReason ${result.finishReason}, thinking tokens ${result.usage.thoughtsTokenCount ?? 0}, answer tokens ${result.usage.candidatesTokenCount ?? '?'})`);
    return result;
  } catch (err) {
    line(`FAILED after ${ms(Date.now() - started)} - HTTP ${err.statusCode || '?'}: ${err.message}`);
    return null;
  }
};

(async () => {
  const { apiKey, model, baseUrl, timeoutMs, maxOutputTokens, thinkingLevel } = config.gemini;
  line('Gemini check');
  line(`  API key set: ${apiKey ? `yes (${apiKey.length} characters)` : 'NO'}`);
  line(`  Model: ${model}`);
  line(`  Endpoint: ${baseUrl}`);
  line(`  Server timeout setting: ${ms(timeoutMs)}   thinking: ${thinkingLevel}   max output tokens: ${maxOutputTokens}`);
  line(`  Probe timeout (this script only): ${ms(probeTimeoutMs)}`);
  line();

  if (!apiKey) {
    line('GEMINI_API_KEY is empty. Put it in .env (next to package.json) as GEMINI_API_KEY=your_key');
    process.exit(1);
  }

  const modelOk = await checkModel();
  line();
  line(`Asking: "${QUESTION}"`);
  const main = await ask(`with current settings (thinking ${thinkingLevel})`, {});
  let low = null;
  let none = null;
  if (compare) {
    if (thinkingLevel !== 'low') low = await ask('thinking low', { thinkingLevel: 'low' });
    none = await ask('thinking not sent (model default)', { thinkingLevel: 'none' });
  }

  line();
  if (main) {
    line('--- Answer preview ---');
    line(main.answer.slice(0, 400) + (main.answer.length > 400 ? '...' : ''));
    line('----------------------');
    line();
    line(`Result: Gemini works. It took ${ms(main.elapsedMs)}; the server timeout is ${ms(timeoutMs)}.`);
    if (main.elapsedMs > timeoutMs * 0.7) line('Warning: this is close to the server timeout. Lower GEMINI_THINKING_LEVEL or use a faster model.');
  } else {
    line('Result: the request failed. Read the line above and the [ERROR] log lines for the cause.');
    if (modelOk && !main) line('The model exists, so the problem is the generate request itself (slow generation, thinking setting, or network).');
  }
  if (compare && none && main && none.elapsedMs > main.elapsedMs * 2) {
    line(`Note: without the low-thinking setting it was ${ms(none.elapsedMs)} vs ${ms(main.elapsedMs)}: long "thinking" is a cause of slowness.`);
  }
  process.exit(main ? 0 : 1);
})();

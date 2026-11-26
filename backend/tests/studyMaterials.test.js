'use strict';

// Phase 4.1 - study material management: permissions and CRUD on /api/papers.
// Run with:  npm test   (or: node --test tests/studyMaterials.test.js)
//
// No database or internet is needed. The real Express app, JWT auth, role middleware, Multer upload handling and
// controllers run; only the Paper model queries (tests/helpers/fakePaperStore.js), the user lookup and the text
// extraction are replaced by test doubles. Uploads go to a temporary folder, never to backend/uploads/papers.

const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Environment must be set BEFORE the app (and config/env.js, uploadMiddleware.js) is loaded.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'unit-test-secret-unit-test-secret-1234567890';
process.env.MONGO_URI = 'mongodb://localhost:27017/studywise_ai_test';
process.env.RATE_LIMIT_MAX = '100000';
const UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studywise-materials-'));
process.env.PAPERS_UPLOAD_DIR = UPLOAD_DIR;

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const User = require('../models/User');
const Paper = require('../models/Paper');
const generateToken = require('../utils/generateToken');
const fake = require('./helpers/fakePaperStore');

// Text extraction is replaced BEFORE the app is loaded (the controller picks the function up when it is required).
const extraction = require('../services/extractionService');
let extractCalls = [];
let extractHook = null; // a test can set this to run code in the middle of an extraction
extraction.extractText = async ({ kind }) => {
  extractCalls.push(kind);
  if (extractHook) await extractHook();
  return {
    text: kind === 'pdf' ? 'Extracted PDF text of the study material.' : 'Recognized text of the image.',
    method: kind === 'pdf' ? 'pdf-text' : 'ocr',
    pageCount: 1,
    confidence: kind === 'pdf' ? null : 88,
    truncated: false,
    warnings: [],
  };
};

const app = require('../app');

fake.install();

// ----- accounts -----
const newId = () => new mongoose.Types.ObjectId().toString();
const ALICE = newId(); // student
const BOB = newId(); // another student
const ADMIN = newId();
const GUEST = newId(); // an account whose role is neither student nor admin
const accounts = {
  [ALICE]: { _id: ALICE, name: 'Alice', email: 'alice@example.com', role: 'student', emailVerified: true },
  [BOB]: { _id: BOB, name: 'Bob', email: 'bob@example.com', role: 'student', emailVerified: true },
  [ADMIN]: { _id: ADMIN, name: 'Admin', email: 'admin@example.com', role: 'admin' },
  [GUEST]: { _id: GUEST, name: 'Guest', email: 'guest@example.com', role: 'guest', emailVerified: true },
};
User.findById = async (id) => accounts[String(id)] || null;
const tokens = { alice: generateToken(ALICE), bob: generateToken(BOB), admin: generateToken(ADMIN), guest: generateToken(GUEST) };

// ----- server -----
let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
});

const storedFiles = () => fs.readdirSync(UPLOAD_DIR).filter((name) => name !== '.gitkeep');

test.beforeEach(() => {
  fake.reset();
  extractCalls = [];
  extractHook = null;
  storedFiles().forEach((name) => fs.rmSync(path.join(UPLOAD_DIR, name), { force: true }));
});

// ----- file bytes -----
const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png-body')]);
const JPG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpg-body')]);
const KINDS = {
  pdf: { bytes: PDF_BYTES, ext: 'pdf', mime: 'application/pdf', fileType: 'pdf' },
  jpg: { bytes: JPG_BYTES, ext: 'jpg', mime: 'image/jpeg', fileType: 'image' },
  png: { bytes: PNG_BYTES, ext: 'png', mime: 'image/png', fileType: 'image' },
};
const MAX_BYTES = 10 * 1024 * 1024;

// ----- helpers -----
const call = async (method, urlPath, { token, json, form, rawBody, contentType } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (rawBody !== undefined) {
    headers['Content-Type'] = contentType || 'text/plain';
    body = rawBody;
  } else if (form) {
    body = form;
  }
  const response = await fetch(`${baseUrl}${urlPath}`, { method, headers, body });
  const buffer = Buffer.from(await response.arrayBuffer());
  const isJson = (response.headers.get('content-type') || '').includes('application/json');
  return { status: response.status, headers: response.headers, buffer, text: buffer.toString('utf8'), body: isJson ? JSON.parse(buffer.toString('utf8')) : null };
};

const makeForm = ({ bytes = PDF_BYTES, filename = 'DS Model Paper.pdf', type = 'application/pdf', fields = {}, withFile = true } = {}) => {
  const form = new FormData();
  Object.entries(fields).forEach(([key, value]) => form.append(key, value));
  if (withFile) form.append('file', new Blob([bytes], { type }), filename);
  return form;
};

const upload = (token, options) => call('POST', '/api/papers/upload', { token, form: makeForm(options) });

// Puts a paper in the store together with a real stored file (a uuid name, like the upload middleware creates).
const seed = ({ owner, kind = 'pdf', writeFile = true, ...rest }) => {
  const spec = KINDS[kind];
  const storedName = `${crypto.randomUUID()}.${spec.ext}`;
  if (writeFile) fs.writeFileSync(path.join(UPLOAD_DIR, storedName), spec.bytes);
  const id = fake.add({ owner, storedName, mimeType: spec.mime, fileType: spec.fileType, size: spec.bytes.length, originalName: `file.${spec.ext}`, ...rest });
  return { id, storedName };
};

const FORBIDDEN_KEYS = ['storedName', 'extractedText', 'extractionWarnings', 'extractionStartedAt', '__v'];
const assertNoInternals = (result) => {
  FORBIDDEN_KEYS.forEach((key) => assert.ok(!result.text.includes(`"${key}"`), `"${key}" must not be returned`));
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png)/.test(result.text), 'a stored file name leaked');
  assert.ok(!result.text.includes(UPLOAD_DIR), 'a server path leaked');
};

// ======================================================================= 1. authentication and role guard on EVERY endpoint

const everyEndpoint = (id) => [
  ['GET', '/api/papers'],
  ['POST', '/api/papers/upload'],
  ['GET', `/api/papers/${id}`],
  ['PATCH', `/api/papers/${id}`],
  ['DELETE', `/api/papers/${id}`],
  ['GET', `/api/papers/${id}/file`],
  ['POST', `/api/papers/${id}/extract`],
];

const callEndpoint = (method, urlPath, token) => {
  if (urlPath.endsWith('/upload')) return call(method, urlPath, { token, form: makeForm() });
  if (method === 'PATCH') return call(method, urlPath, { token, json: { title: 'Hacked' } });
  return call(method, urlPath, { token });
};

test('every endpoint rejects a request without a login (401) and changes nothing', async () => {
  const { id } = seed({ owner: ALICE });
  const before = fake.get(id);
  for (const [method, urlPath] of everyEndpoint(id)) {
    const result = await callEndpoint(method, urlPath, null);
    assert.equal(result.status, 401, `${method} ${urlPath}`);
    assert.equal(result.body.success, false);
  }
  assert.deepEqual(fake.get(id), before);
  assert.equal(storedFiles().length, 1, 'no upload may be stored for an anonymous request');
  assert.equal(extractCalls.length, 0);
});

test('every endpoint rejects a token signed with another secret or a malformed token (401)', async () => {
  const { id } = seed({ owner: ALICE });
  const forged = jwt.sign({ id: ALICE }, 'some-other-secret-some-other-secret-123456');
  for (const token of [forged, 'not-a-jwt', '']) {
    for (const [method, urlPath] of everyEndpoint(id)) {
      const result = await callEndpoint(method, urlPath, token || null);
      assert.equal(result.status, 401, `${method} ${urlPath} with ${token.slice(0, 10)}`);
    }
  }
});

test('every endpoint rejects an account whose role is neither student nor admin (403)', async () => {
  const { id } = seed({ owner: GUEST }); // even a material the account "owns" is out of reach without a valid role
  const before = fake.get(id);
  for (const [method, urlPath] of everyEndpoint(id)) {
    const result = await callEndpoint(method, urlPath, tokens.guest);
    assert.equal(result.status, 403, `${method} ${urlPath}`);
  }
  assert.deepEqual(fake.get(id), before);
  assert.equal(storedFiles().length, 1);
  assert.equal(extractCalls.length, 0);
});

test('the role is read from the database on every request: a deleted account loses access at once', async () => {
  const token = generateToken(newId()); // valid signature, but no such account
  const result = await call('GET', '/api/papers', { token });
  assert.equal(result.status, 401);
});

// ======================================================================= 2. upload

test('a student can upload a PDF, a JPG and a PNG; the owner comes from the token', async () => {
  for (const [kind, filename] of [['pdf', 'Unit 1 Notes.pdf'], ['jpg', 'scan.jpeg'], ['png', 'photo.PNG']]) {
    const spec = KINDS[kind];
    const result = await upload(tokens.alice, { bytes: spec.bytes, filename, type: spec.mime });
    assert.equal(result.status, 201, `${kind}: ${result.text}`);
    const { paper } = result.body.data;
    assert.equal(paper.uploadedBy, ALICE);
    assert.equal(paper.mimeType, spec.mime);
    assert.equal(paper.fileType, spec.fileType);
    assert.equal(paper.size, spec.bytes.length);
    assert.equal(paper.originalName, filename);
    assert.equal(paper.title, filename.replace(/\.[^.]+$/, ''), 'the title defaults to the file name without its extension');
    assert.equal(paper.materialType, 'question_paper');
    assert.equal(paper.description, '');
    assert.equal(paper.extractionStatus, 'pending');
    assertNoInternals(result);
  }
  assert.equal(storedFiles().length, 3);
  assert.ok(storedFiles().every((name) => /^[0-9a-f-]{36}\.(pdf|jpg|png)$/.test(name)), 'stored names are server-generated uuids');
  assert.ok(fake.all().every((raw) => String(raw.uploadedBy) === ALICE));
});

test('upload accepts and cleans the metadata fields', async () => {
  const result = await upload(tokens.alice, {
    fields: { title: '  Operating   Systems\nNotes ', description: 'Unit 1 to 3', materialType: 'notes' },
  });
  assert.equal(result.status, 201, result.text);
  const { paper } = result.body.data;
  assert.equal(paper.title, 'Operating Systems Notes');
  assert.equal(paper.description, 'Unit 1 to 3');
  assert.equal(paper.materialType, 'notes');
});

test('an admin can upload too, and owns the upload', async () => {
  const result = await upload(tokens.admin, { filename: 'Syllabus.pdf', fields: { materialType: 'syllabus' } });
  assert.equal(result.status, 201, result.text);
  assert.equal(result.body.data.paper.uploadedBy, ADMIN);
  assert.equal(result.body.data.paper.materialType, 'syllabus');
});

test('the 10 MB limit is kept: exactly 10 MB is accepted, one byte more is refused', async () => {
  const exact = await upload(tokens.alice, { bytes: Buffer.concat([PDF_BYTES, Buffer.alloc(MAX_BYTES - PDF_BYTES.length)]) });
  assert.equal(exact.status, 201, exact.text);
  assert.equal(exact.body.data.paper.size, MAX_BYTES);

  const before = storedFiles().length;
  const tooBig = await upload(tokens.alice, { bytes: Buffer.concat([PDF_BYTES, Buffer.alloc(MAX_BYTES + 1 - PDF_BYTES.length)]) });
  assert.equal(tooBig.status, 413, tooBig.text);
  assert.equal(storedFiles().length, before, 'the oversized upload must not stay on disk');
  assert.equal(fake.all().length, 1);
});

test('refused uploads leave neither a record nor a file behind', async () => {
  const cases = [
    ['no file at all', { withFile: false }, 400],
    ['a .txt file', { bytes: Buffer.from('hello'), filename: 'notes.txt', type: 'text/plain' }, 415],
    ['an .exe renamed to .pdf with the wrong type', { bytes: Buffer.from('MZ-binary'), filename: 'a.pdf', type: 'application/x-msdownload' }, 415],
    ['a PDF named .png (extension and type disagree)', { bytes: PDF_BYTES, filename: 'x.png', type: 'application/pdf' }, 415],
    ['text content pretending to be a PDF', { bytes: Buffer.from('<script>alert(1)</script>'), filename: 'evil.pdf', type: 'application/pdf' }, 400],
    ['a PNG whose bytes are a PDF', { bytes: PDF_BYTES, filename: 'x.png', type: 'image/png' }, 400],
    ['an empty file', { bytes: Buffer.alloc(0), filename: 'empty.pdf', type: 'application/pdf' }, 400],
  ];
  for (const [label, options, status] of cases) {
    const result = await upload(tokens.alice, options);
    assert.equal(result.status, status, `${label}: ${result.text}`);
    assert.equal(result.body.success, false);
  }
  assert.equal(storedFiles().length, 0, 'no orphaned file');
  assert.equal(fake.all().length, 0, 'no record');
});

test('refused metadata on upload removes the stored file again', async () => {
  const cases = [
    { title: 'x'.repeat(151) },
    { title: '   ' },
    { description: 'd'.repeat(1001) },
    { materialType: 'exam' },
    { uploadedBy: BOB }, // ownership can never be chosen by the client
    { storedName: '../../etc/passwd' },
    { extractionStatus: 'completed' },
  ];
  for (const fields of cases) {
    const result = await upload(tokens.alice, { fields });
    assert.equal(result.status, 400, JSON.stringify(fields));
    assert.ok(Array.isArray(result.body.errors) && result.body.errors.length > 0);
  }
  assert.equal(storedFiles().length, 0);
  assert.equal(fake.all().length, 0);
});

test('a path in the client file name never reaches the storage path or the metadata', async () => {
  const result = await upload(tokens.alice, { filename: '../../../etc/passwd.pdf' });
  assert.equal(result.status, 201, result.text);
  assert.ok(!result.body.data.paper.originalName.includes('/'));
  assert.equal(storedFiles().length, 1);
  assert.ok(!fs.existsSync(path.join(UPLOAD_DIR, '..', '..', 'etc')));
});

// ======================================================================= 3. list

const seedMixed = () => {
  const a1 = seed({ owner: ALICE, title: 'Alice DS Paper', materialType: 'question_paper', uploadedAt: new Date('2026-01-01') }).id;
  const a2 = seed({ owner: ALICE, kind: 'png', title: 'Alice OS Notes', materialType: 'notes', extractionStatus: 'completed', uploadedAt: new Date('2026-02-01') }).id;
  const b1 = seed({ owner: BOB, title: 'Bob Syllabus', materialType: 'syllabus', uploadedAt: new Date('2026-03-01') }).id;
  const legacy = seed({ owner: ALICE, legacy: true, originalName: 'old-paper.pdf', uploadedAt: new Date('2025-12-01') }).id;
  return { a1, a2, b1, legacy };
};

test('a student lists only their own materials; an admin lists everybody\'s', async () => {
  const { a1, a2, b1, legacy } = seedMixed();

  const alice = await call('GET', '/api/papers', { token: tokens.alice });
  assert.equal(alice.status, 200, alice.text);
  assert.deepEqual(alice.body.data.papers.map((p) => p._id).sort(), [a1, a2, legacy].sort());
  assert.ok(alice.body.data.papers.every((p) => p.uploadedBy === ALICE));
  assert.deepEqual(alice.body.meta, { page: 1, limit: 20, total: 3, totalPages: 1 });
  assertNoInternals(alice);

  const bob = await call('GET', '/api/papers', { token: tokens.bob });
  assert.deepEqual(bob.body.data.papers.map((p) => p._id), [b1]);

  const admin = await call('GET', '/api/papers', { token: tokens.admin });
  assert.equal(admin.body.meta.total, 4);
  assert.deepEqual(admin.body.data.papers.map((p) => p._id).sort(), [a1, a2, b1, legacy].sort());
});

test('a student cannot widen the list with query parameters (uploadedBy is an admin-only filter)', async () => {
  const { b1 } = seedMixed();
  for (const query of [`uploadedBy=${BOB}`, `uploadedBy[$ne]=${ALICE}`, 'uploadedBy=garbage']) {
    const result = await call('GET', `/api/papers?${query}`, { token: tokens.alice });
    assert.equal(result.status, 200, `${query}: ${result.text}`);
    assert.ok(result.body.data.papers.every((p) => p.uploadedBy === ALICE), query);
    assert.ok(!result.body.data.papers.some((p) => p._id === b1));
  }
  // Every query the controller ran for those requests carried the student's own id.
  fake.filters().forEach((filter) => assert.equal(String(filter.uploadedBy), ALICE));
});

test('an admin can filter the list by uploader', async () => {
  const { b1 } = seedMixed();
  const result = await call('GET', `/api/papers?uploadedBy=${BOB}`, { token: tokens.admin });
  assert.equal(result.status, 200, result.text);
  assert.deepEqual(result.body.data.papers.map((p) => p._id), [b1]);
  assert.equal((await call('GET', '/api/papers?uploadedBy=nope', { token: tokens.admin })).status, 400);
});

test('list filters: materialType (older papers count as question papers), extractionStatus, search, sort, pagination', async () => {
  const { a1, a2, legacy } = seedMixed();
  const ids = (result) => result.body.data.papers.map((p) => p._id);

  assert.deepEqual(ids(await call('GET', '/api/papers?materialType=notes', { token: tokens.alice })), [a2]);
  assert.deepEqual(ids(await call('GET', '/api/papers?materialType=question_paper', { token: tokens.alice })).sort(), [a1, legacy].sort());
  assert.deepEqual(ids(await call('GET', '/api/papers?extractionStatus=completed', { token: tokens.alice })), [a2]);

  assert.deepEqual(ids(await call('GET', '/api/papers?search=os%20notes', { token: tokens.alice })), [a2]);
  assert.deepEqual(ids(await call('GET', '/api/papers?search=OLD-PAPER', { token: tokens.alice })), [legacy], 'matches the file name too');
  assert.deepEqual(ids(await call('GET', '/api/papers?search=.*', { token: tokens.alice })), [], 'a search is literal text, not a regular expression');

  assert.deepEqual(ids(await call('GET', '/api/papers', { token: tokens.alice })), [a2, a1, legacy], 'newest first by default');
  assert.deepEqual(ids(await call('GET', '/api/papers?sort=oldest', { token: tokens.alice })), [legacy, a1, a2]);

  const page = await call('GET', '/api/papers?limit=2&page=2', { token: tokens.alice });
  assert.deepEqual(ids(page), [legacy]);
  assert.deepEqual(page.body.meta, { page: 2, limit: 2, total: 3, totalPages: 2 });
});

test('bad list parameters are refused with 400', async () => {
  for (const query of ['page=0', 'limit=101', 'limit=abc', 'materialType=exam', 'extractionStatus=done', 'sort=random', `search=${'x'.repeat(101)}`, 'search=a&search=b', 'materialType=notes&materialType=syllabus']) {
    const result = await call('GET', `/api/papers?${query}`, { token: tokens.alice });
    assert.equal(result.status, 400, query);
  }
});

test('an older paper (saved before Phase 4.1) is listed with its file name as title and the default type', async () => {
  const { legacy } = seedMixed();
  const result = await call('GET', `/api/papers/${legacy}`, { token: tokens.alice });
  assert.equal(result.status, 200, result.text);
  assert.equal(result.body.data.paper.title, 'old-paper.pdf');
  assert.equal(result.body.data.paper.materialType, 'question_paper');
  assert.equal(result.body.data.paper.description, '');
});

// ======================================================================= 4. view (metadata and file)

test('view: the owner and an admin can read a material, another student gets the same 404 as for a missing one', async () => {
  const { id } = seed({ owner: ALICE, title: 'Private notes', extractedText: 'secret extracted text', extractionWarnings: ['w'] });

  const owner = await call('GET', `/api/papers/${id}`, { token: tokens.alice });
  assert.equal(owner.status, 200, owner.text);
  assert.equal(owner.body.data.paper._id, id);
  assert.equal(owner.body.data.paper.title, 'Private notes');
  assertNoInternals(owner);
  assert.ok(!owner.text.includes('secret extracted text'));

  const admin = await call('GET', `/api/papers/${id}`, { token: tokens.admin });
  assert.equal(admin.status, 200);
  assert.equal(admin.body.data.paper.uploadedBy, ALICE);

  const other = await call('GET', `/api/papers/${id}`, { token: tokens.bob });
  const missing = await call('GET', `/api/papers/${newId()}`, { token: tokens.bob });
  assert.equal(other.status, 404);
  assert.equal(missing.status, 404);
  assert.equal(other.body.message, missing.body.message, 'a 404 must not reveal that the paper exists');
  assert.ok(!other.text.includes('Private notes'));
});

test('an invalid id is refused with 400 on every id route', async () => {
  for (const [method, suffix] of [['GET', ''], ['PATCH', ''], ['DELETE', ''], ['GET', '/file'], ['POST', '/extract']]) {
    const result = await call(method, `/api/papers/not-an-id${suffix}`, { token: tokens.alice, ...(method === 'PATCH' ? { json: { title: 'x' } } : {}) });
    assert.equal(result.status, 400, `${method} ${suffix}`);
  }
});

test('file view: the owner and an admin get the real bytes with the verified content type; others get 404', async () => {
  const { id } = seed({ owner: ALICE, kind: 'pdf', originalName: 'Unit 1.pdf' });

  const owner = await call('GET', `/api/papers/${id}/file`, { token: tokens.alice });
  assert.equal(owner.status, 200);
  assert.equal(owner.headers.get('content-type'), 'application/pdf');
  assert.equal(owner.headers.get('x-content-type-options'), 'nosniff');
  assert.match(owner.headers.get('content-disposition'), /^inline; filename="Unit 1\.pdf"/);
  assert.equal(owner.headers.get('cache-control'), 'private, no-store');
  assert.ok(owner.buffer.equals(PDF_BYTES));

  const download = await call('GET', `/api/papers/${id}/file?download=true`, { token: tokens.admin });
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /^attachment;/);

  const other = await call('GET', `/api/papers/${id}/file`, { token: tokens.bob });
  assert.equal(other.status, 404);
  assert.equal(other.buffer.includes(PDF_BYTES), false, 'no file bytes may be sent to another student');
});

test('file view: images keep their type; a non-ASCII file name is sent safely', async () => {
  const { id } = seed({ owner: ALICE, kind: 'png', originalName: 'பாடம்"; x=y.png' });
  const result = await call('GET', `/api/papers/${id}/file`, { token: tokens.alice });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('content-type'), 'image/png');
  const disposition = result.headers.get('content-disposition');
  assert.match(disposition, /filename\*=UTF-8''/);
  assert.ok(!/filename="[^"]*"[^;]*"/.test(disposition), 'a quote in the file name must not break out of the header');
});

test('file view: a record whose file is missing or was replaced by other content is not served', async () => {
  const missing = seed({ owner: ALICE, writeFile: false });
  assert.equal((await call('GET', `/api/papers/${missing.id}/file`, { token: tokens.alice })).status, 404);

  const tampered = seed({ owner: ALICE });
  fs.writeFileSync(path.join(UPLOAD_DIR, tampered.storedName), '<html><script>alert(1)</script></html>');
  const result = await call('GET', `/api/papers/${tampered.id}/file`, { token: tokens.alice });
  assert.equal(result.status, 422);
  assert.ok(!result.text.includes('<script>'));

  const badName = seed({ owner: ALICE, storedName: '../../secret.pdf', writeFile: false });
  assert.equal((await call('GET', `/api/papers/${badName.id}/file`, { token: tokens.alice })).status, 500);
});

// ======================================================================= 5. edit

test('edit: the owner can change title, description and type; nothing else changes', async () => {
  const { id } = seed({ owner: ALICE, title: 'Old title', description: 'old', materialType: 'question_paper', extractionStatus: 'completed', extractedText: 'kept text' });
  const before = fake.get(id);

  const result = await call('PATCH', `/api/papers/${id}`, { token: tokens.alice, json: { title: '  New   title ', description: 'New description', materialType: 'notes' } });
  assert.equal(result.status, 200, result.text);
  const { paper } = result.body.data;
  assert.equal(paper.title, 'New title');
  assert.equal(paper.description, 'New description');
  assert.equal(paper.materialType, 'notes');
  assert.ok(paper.updatedAt, 'updatedAt is set');
  assertNoInternals(result);

  const after = fake.get(id);
  for (const field of ['uploadedBy', 'storedName', 'size', 'mimeType', 'fileType', 'originalName', 'extractionStatus', 'extractedText', 'uploadedAt']) {
    assert.deepEqual(after[field], before[field], `${field} must not change`);
  }
});

test('edit: a partial update changes only the fields that were sent; an empty description clears it', async () => {
  const { id } = seed({ owner: ALICE, title: 'Keep me', description: 'to be cleared', materialType: 'notes' });
  const one = await call('PATCH', `/api/papers/${id}`, { token: tokens.alice, json: { materialType: 'syllabus' } });
  assert.equal(one.status, 200, one.text);
  assert.equal(one.body.data.paper.title, 'Keep me');
  assert.equal(one.body.data.paper.materialType, 'syllabus');

  const cleared = await call('PATCH', `/api/papers/${id}`, { token: tokens.alice, json: { description: '' } });
  assert.equal(cleared.status, 200, cleared.text);
  assert.equal(cleared.body.data.paper.description, '');
  assert.equal('description' in fake.get(id), false, 'the field is removed, not stored as an empty string');
});

test('edit: another student gets 404 and nothing changes; an admin can edit anyone\'s material', async () => {
  const { id } = seed({ owner: ALICE, title: 'Alice title' });
  const before = fake.get(id);

  const other = await call('PATCH', `/api/papers/${id}`, { token: tokens.bob, json: { title: 'Bob was here' } });
  assert.equal(other.status, 404);
  assert.deepEqual(fake.get(id), before);

  const admin = await call('PATCH', `/api/papers/${id}`, { token: tokens.admin, json: { title: 'Fixed by admin' } });
  assert.equal(admin.status, 200, admin.text);
  assert.equal(admin.body.data.paper.title, 'Fixed by admin');
  assert.equal(admin.body.data.paper.uploadedBy, ALICE, 'an admin edit does not take over ownership');
  assert.equal(String(fake.get(id).uploadedBy), ALICE);
});

test('edit: ownership, storage and extraction fields cannot be set (mass assignment) and nothing changes', async () => {
  const { id } = seed({ owner: ALICE });
  const before = fake.get(id);
  const attempts = [
    { uploadedBy: BOB },
    { storedName: '../../etc/passwd' },
    { size: 1 },
    { mimeType: 'text/html' },
    { fileType: 'image' },
    { originalName: 'x.exe' },
    { extractionStatus: 'completed' },
    { extractedText: 'forged text' },
    { _id: newId() },
    { role: 'admin' },
    { title: 'ok', uploadedBy: BOB }, // mixed with a valid field: the whole request is refused
  ];
  for (const body of attempts) {
    const result = await call('PATCH', `/api/papers/${id}`, { token: tokens.alice, json: body });
    assert.equal(result.status, 400, JSON.stringify(body));
  }
  assert.deepEqual(fake.get(id), before);
});

test('edit: invalid values are refused (operators, wrong types, empty, too long, unknown type)', async () => {
  const { id } = seed({ owner: ALICE });
  const before = fake.get(id);
  const bodies = [
    {}, [], { title: '' }, { title: '   ' }, { title: 'x'.repeat(151) }, { title: 123 }, { title: { $gt: '' } }, { title: ['a'] },
    { description: 'x'.repeat(1001) }, { description: { $ne: null } }, { description: 5 },
    { materialType: 'exam' }, { materialType: { $ne: 'notes' } }, { materialType: null },
  ];
  for (const body of bodies) {
    const result = await call('PATCH', `/api/papers/${id}`, { token: tokens.alice, json: body });
    assert.equal(result.status, 400, JSON.stringify(body));
  }
  const notJson = await call('PATCH', `/api/papers/${id}`, { token: tokens.alice, rawBody: 'title=x', contentType: 'text/plain' });
  assert.equal(notJson.status, 400);
  const brokenJson = await call('PATCH', `/api/papers/${id}`, { token: tokens.alice, rawBody: '{"title":', contentType: 'application/json' });
  assert.equal(brokenJson.status, 400);
  assert.deepEqual(fake.get(id), before);
});

test('edit: a missing paper is a 404', async () => {
  const result = await call('PATCH', `/api/papers/${newId()}`, { token: tokens.admin, json: { title: 'x' } });
  assert.equal(result.status, 404);
});

// ======================================================================= 6. delete

test('delete: the owner removes the record and the stored file; a second delete is a 404', async () => {
  const { id, storedName } = seed({ owner: ALICE });
  assert.ok(fs.existsSync(path.join(UPLOAD_DIR, storedName)));

  const result = await call('DELETE', `/api/papers/${id}`, { token: tokens.alice });
  assert.equal(result.status, 200, result.text);
  assert.equal(result.body.data._id, id);
  assert.equal(fake.get(id), null);
  assert.equal(fs.existsSync(path.join(UPLOAD_DIR, storedName)), false, 'the file is deleted from disk');

  assert.equal((await call('DELETE', `/api/papers/${id}`, { token: tokens.alice })).status, 404);
  assert.equal((await call('GET', `/api/papers/${id}`, { token: tokens.alice })).status, 404);
  assert.equal((await call('GET', `/api/papers/${id}/file`, { token: tokens.alice })).status, 404);
});

test('delete: another student gets 404 and the record and file stay; an admin can delete anyone\'s material', async () => {
  const { id, storedName } = seed({ owner: ALICE });
  const before = fake.get(id);

  const other = await call('DELETE', `/api/papers/${id}`, { token: tokens.bob });
  assert.equal(other.status, 404);
  assert.deepEqual(fake.get(id), before);
  assert.ok(fs.existsSync(path.join(UPLOAD_DIR, storedName)));

  const admin = await call('DELETE', `/api/papers/${id}`, { token: tokens.admin });
  assert.equal(admin.status, 200, admin.text);
  assert.equal(fake.get(id), null);
  assert.equal(fs.existsSync(path.join(UPLOAD_DIR, storedName)), false);
});

test('delete only touches the requested material', async () => {
  const keep = seed({ owner: ALICE });
  const drop = seed({ owner: ALICE });
  assert.equal((await call('DELETE', `/api/papers/${drop.id}`, { token: tokens.alice })).status, 200);
  assert.ok(fake.get(keep.id));
  assert.ok(fs.existsSync(path.join(UPLOAD_DIR, keep.storedName)));
});

test('delete still succeeds when the stored file is already gone', async () => {
  const { id } = seed({ owner: ALICE, writeFile: false });
  const result = await call('DELETE', `/api/papers/${id}`, { token: tokens.alice });
  assert.equal(result.status, 200, result.text);
  assert.equal(fake.get(id), null);
});

test('delete never removes a file outside the uploads folder, even if the stored name was tampered with', async () => {
  const outside = path.join(os.tmpdir(), `outside-${crypto.randomUUID()}.pdf`);
  fs.writeFileSync(outside, PDF_BYTES);
  try {
    const { id } = seed({ owner: ALICE, storedName: path.relative(UPLOAD_DIR, outside), writeFile: false });
    const result = await call('DELETE', `/api/papers/${id}`, { token: tokens.alice });
    assert.equal(result.status, 200, result.text); // the record is removed ...
    assert.ok(fs.existsSync(outside), '... but a path outside the uploads folder is never touched');
  } finally {
    fs.rmSync(outside, { force: true });
  }
});

// ======================================================================= 7. a full life cycle through the API

test('life cycle: upload, list, view, edit, view file, delete (student), then the admin sees nothing left', async () => {
  const created = await upload(tokens.alice, { filename: 'Maths.pdf', fields: { title: 'Maths paper' } });
  assert.equal(created.status, 201, created.text);
  const id = created.body.data.paper._id;

  assert.deepEqual((await call('GET', '/api/papers', { token: tokens.alice })).body.data.papers.map((p) => p._id), [id]);
  assert.equal((await call('GET', `/api/papers/${id}`, { token: tokens.alice })).body.data.paper.title, 'Maths paper');
  assert.equal((await call('PATCH', `/api/papers/${id}`, { token: tokens.alice, json: { title: 'Maths paper (2024)' } })).status, 200);
  assert.ok((await call('GET', `/api/papers/${id}/file`, { token: tokens.alice })).buffer.equals(PDF_BYTES));
  assert.equal((await call('DELETE', `/api/papers/${id}`, { token: tokens.alice })).status, 200);

  assert.equal((await call('GET', '/api/papers', { token: tokens.admin })).body.meta.total, 0);
  assert.equal(storedFiles().length, 0);
});

// ======================================================================= 8. extraction still works (regression)

test('extraction: the owner can still extract a PDF and an image; a second call is served from the saved text', async () => {
  const pdf = seed({ owner: ALICE, kind: 'pdf' });
  const first = await call('POST', `/api/papers/${pdf.id}/extract`, { token: tokens.alice });
  assert.equal(first.status, 200, first.text);
  assert.equal(first.body.data.extractedText, 'Extracted PDF text of the study material.');
  assert.equal(first.body.data.paper.extractionStatus, 'completed');
  assert.equal(first.body.data.paper.extractionMethod, 'pdf-text');
  assertNoInternals({ text: JSON.stringify(first.body.data.paper) });
  assert.deepEqual(extractCalls, ['pdf']);

  const again = await call('POST', `/api/papers/${pdf.id}/extract`, { token: tokens.alice });
  assert.equal(again.status, 200, again.text);
  assert.equal(again.body.data.cached, true);
  assert.equal(again.body.data.extractedText, 'Extracted PDF text of the study material.');
  assert.deepEqual(extractCalls, ['pdf'], 'no second extraction');

  const forced = await call('POST', `/api/papers/${pdf.id}/extract?force=true`, { token: tokens.alice });
  assert.equal(forced.status, 200, forced.text);
  assert.deepEqual(extractCalls, ['pdf', 'pdf']);

  const image = seed({ owner: ALICE, kind: 'jpg' });
  const ocr = await call('POST', `/api/papers/${image.id}/extract`, { token: tokens.alice });
  assert.equal(ocr.status, 200, ocr.text);
  assert.equal(ocr.body.data.paper.extractionMethod, 'ocr');
  assert.equal(ocr.body.data.paper.ocrConfidence, 88);

  // The text itself is never part of a metadata response.
  const view = await call('GET', `/api/papers/${pdf.id}`, { token: tokens.alice });
  assert.ok(!view.text.includes('Extracted PDF text'));
});

test('extraction: another student gets 404 and nothing runs; an admin may extract any material', async () => {
  const { id } = seed({ owner: ALICE });
  const before = fake.get(id);

  const other = await call('POST', `/api/papers/${id}/extract`, { token: tokens.bob });
  assert.equal(other.status, 404);
  assert.equal(extractCalls.length, 0);
  assert.deepEqual(fake.get(id), before);

  const admin = await call('POST', `/api/papers/${id}/extract`, { token: tokens.admin });
  assert.equal(admin.status, 200, admin.text);
  assert.equal(admin.body.data.paper.uploadedBy, ALICE);
  assert.deepEqual(extractCalls, ['pdf']);
});

test('extraction: a paper deleted while it is being extracted answers 404 instead of crashing', async () => {
  const { id } = seed({ owner: ALICE });
  extractHook = async () => {
    await Paper.findOneAndDelete({ _id: id }); // the owner deletes the paper in the middle of the extraction
  };
  const result = await call('POST', `/api/papers/${id}/extract`, { token: tokens.alice });
  assert.equal(result.status, 404, result.text);
  assert.equal(fake.get(id), null);
});

// ======================================================================= 9. model

test('the Paper model: papers saved before Phase 4.1 are still valid; new metadata is validated', () => {
  const base = { uploadedBy: new mongoose.Types.ObjectId(), originalName: 'a.pdf', storedName: `${crypto.randomUUID()}.pdf`, size: 10, mimeType: 'application/pdf' };

  const legacy = new Paper(base);
  assert.equal(legacy.validateSync(), undefined);
  assert.equal(legacy.materialType, 'question_paper', 'the default for papers without a type');
  assert.equal(legacy.title, undefined);

  assert.ok(new Paper({ ...base, materialType: 'exam' }).validateSync().errors.materialType);
  assert.ok(new Paper({ ...base, title: 'x'.repeat(151) }).validateSync().errors.title);
  assert.ok(new Paper({ ...base, description: 'x'.repeat(1001) }).validateSync().errors.description);
  assert.equal(new Paper({ ...base, title: 'x'.repeat(150), description: 'y'.repeat(1000), materialType: 'notes' }).validateSync(), undefined);

  const json = new Paper(base).toJSON();
  assert.equal(json.storedName, undefined, 'storedName stays out of toJSON');
});

'use strict';

// Phase 4.3A - secure sharing of study materials:
//   POST/GET/DELETE /api/papers/:paperId/share   (owner or admin)
//   GET /api/shared/materials/:token[/file]      (public, no login)
// Run with:  npm test   (or: node --test tests/paperSharing.test.js)
//
// Same set-up as tests/studyMaterials.test.js: the real Express app, JWT auth, role middleware, controllers, services and
// error handler run; only the Paper model queries (tests/helpers/fakePaperStore.js) and the user lookup are replaced by
// test doubles. No database or internet is needed. Stored files live in a temporary folder.

const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'unit-test-secret-unit-test-secret-1234567890';
process.env.MONGO_URI = 'mongodb://localhost:27017/studywise_ai_test';
process.env.RATE_LIMIT_MAX = '100000';
process.env.SHARED_ACCESS_LIMIT_MAX = '100000';
process.env.SHARE_BASE_URL = 'https://studywise.example.com';
const UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studywise-sharing-'));
process.env.PAPERS_UPLOAD_DIR = UPLOAD_DIR;

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const User = require('../models/User');
const generateToken = require('../utils/generateToken');
const { hashShareToken, isWellFormedShareToken } = require('../utils/shareToken');
const fake = require('./helpers/fakePaperStore');

const app = require('../app');
fake.install();

// ----- accounts -----
const newId = () => new mongoose.Types.ObjectId().toString();
const ALICE = newId(); // student, owns the materials
const BOB = newId(); // another student
const ADMIN = newId();
const GUEST = newId(); // role neither student nor admin
const accounts = {
  [ALICE]: { _id: ALICE, name: 'Alice', email: 'alice@example.com', role: 'student', emailVerified: true },
  [BOB]: { _id: BOB, name: 'Bob', email: 'bob@example.com', role: 'student', emailVerified: true },
  [ADMIN]: { _id: ADMIN, name: 'Admin', email: 'admin@example.com', role: 'admin' },
  [GUEST]: { _id: GUEST, name: 'Guest', email: 'guest@example.com', role: 'guest', emailVerified: true },
};
User.findById = async (id) => accounts[String(id)] || null;
const tokens = { alice: generateToken(ALICE), bob: generateToken(BOB), admin: generateToken(ADMIN), guest: generateToken(GUEST) };

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
test.beforeEach(() => {
  fake.reset();
  fs.readdirSync(UPLOAD_DIR).forEach((name) => fs.rmSync(path.join(UPLOAD_DIR, name), { force: true }));
});

// ----- helpers -----
const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png-body')]);

const call = async (method, urlPath, { token, json } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }
  const response = await fetch(`${baseUrl}${urlPath}`, { method, headers, body });
  const buffer = Buffer.from(await response.arrayBuffer());
  const isJson = (response.headers.get('content-type') || '').includes('application/json');
  return { status: response.status, headers: response.headers, buffer, text: buffer.toString('utf8'), body: isJson ? JSON.parse(buffer.toString('utf8')) : null };
};

// A material in the store together with a real stored file (a uuid name, like the upload middleware creates).
const seed = ({ owner, kind = 'pdf', writeFile = true, ...rest }) => {
  const bytes = kind === 'png' ? PNG_BYTES : PDF_BYTES;
  const storedName = `${crypto.randomUUID()}.${kind}`;
  if (writeFile) fs.writeFileSync(path.join(UPLOAD_DIR, storedName), bytes);
  const id = fake.add({
    owner,
    storedName,
    mimeType: kind === 'png' ? 'image/png' : 'application/pdf',
    fileType: kind === 'png' ? 'image' : 'pdf',
    size: bytes.length,
    originalName: `notes.${kind}`,
    description: 'Unit 1 to 3',
    ...rest,
  });
  return { id, storedName, bytes };
};

const tokenOf = (shareUrl) => shareUrl.split('/').pop();
const publicPath = (token) => `/api/shared/materials/${token}`;
const share = (id, who = 'alice', query = '') => call('POST', `/api/papers/${id}/share${query}`, { token: tokens[who] });
const revoke = (id, who = 'alice') => call('DELETE', `/api/papers/${id}/share`, { token: tokens[who] });
const status = (id, who = 'alice') => call('GET', `/api/papers/${id}/share`, { token: tokens[who] });

// What a visitor may never see, in any shared response.
const PRIVATE_KEYS = ['uploadedBy', 'storedName', 'extractedText', 'extractionWarnings', 'extractionStatus', 'extractionError', 'sharedBy', 'shareTokenHash', 'isShared', '_id', '__v'];
const assertNoPrivateData = (result, { id, storedName } = {}) => {
  PRIVATE_KEYS.forEach((key) => assert.ok(!result.text.includes(`"${key}"`), `"${key}" must not be returned to a visitor`));
  if (id) assert.ok(!result.text.includes(id), 'the material id leaked');
  if (storedName) assert.ok(!result.text.includes(storedName), 'the stored file name leaked');
  assert.ok(!result.text.includes(ALICE), 'the owner id leaked');
  assert.ok(!result.text.includes(UPLOAD_DIR), 'a server path leaked');
};

// ======================================================================= 1. who may create / see / revoke a link

test('the share endpoints reject a request without a login (401) and change nothing', async () => {
  const { id } = seed({ owner: ALICE });
  const before = fake.get(id);
  for (const method of ['GET', 'POST', 'DELETE']) {
    const result = await call(method, `/api/papers/${id}/share`);
    assert.equal(result.status, 401, method);
    assert.equal(result.body.success, false);
  }
  assert.deepEqual(fake.get(id), before);
});

test('the share endpoints reject an account whose role is neither student nor admin (403)', async () => {
  const { id } = seed({ owner: GUEST });
  const before = fake.get(id);
  for (const method of ['GET', 'POST', 'DELETE']) {
    assert.equal((await call(method, `/api/papers/${id}/share`, { token: tokens.guest })).status, 403, method);
  }
  assert.deepEqual(fake.get(id), before);
});

test('a malformed material id is a 400 and an unknown one a 404', async () => {
  for (const method of ['GET', 'POST', 'DELETE']) {
    assert.equal((await call(method, '/api/papers/not-an-id/share', { token: tokens.alice })).status, 400, method);
    const unknown = await call(method, `/api/papers/${newId()}/share`, { token: tokens.alice });
    assert.equal(unknown.status, 404, method);
    assert.equal(unknown.body.message, 'Paper not found');
  }
});

test('the OWNER can create a link: 201 with the URLs, and nothing else about the token is returned', async () => {
  const { id } = seed({ owner: ALICE });
  const result = await share(id);
  assert.equal(result.status, 201);
  assert.equal(result.body.success, true);
  const data = result.body.data;
  assert.deepEqual(Object.keys(data).sort(), ['_id', 'apiUrl', 'fileUrl', 'isShared', 'shareUrl', 'sharedAt']);
  assert.equal(data._id, id);
  assert.equal(data.isShared, true);
  assert.ok(!Number.isNaN(Date.parse(data.sharedAt)));
  const token = tokenOf(data.shareUrl);
  assert.equal(isWellFormedShareToken(token), true);
  assert.equal(data.shareUrl, `https://studywise.example.com/shared/materials/${token}`);
  assert.equal(data.apiUrl, `/api/shared/materials/${token}`);
  assert.equal(data.fileUrl, `/api/shared/materials/${token}/file`);
  assert.equal(result.headers.get('cache-control'), 'no-store', 'the only copy of the link must not be cached');
});

test('an ADMIN can create a link for a material somebody else uploaded', async () => {
  const { id } = seed({ owner: ALICE });
  const result = await share(id, 'admin');
  assert.equal(result.status, 201);
  assert.equal((await call('GET', publicPath(tokenOf(result.body.data.shareUrl)))).status, 200);
  assert.equal(String(fake.get(id).sharedBy), ADMIN, 'the audit trail records the admin');
});

test('ANOTHER STUDENT cannot create, see or revoke a link: always 404, and the material is not touched', async () => {
  const { id } = seed({ owner: ALICE });
  const link = await share(id);
  const token = tokenOf(link.body.data.shareUrl);
  const before = fake.get(id);

  for (const result of [await share(id, 'bob'), await share(id, 'bob', '?replace=true'), await status(id, 'bob'), await revoke(id, 'bob')]) {
    assert.equal(result.status, 404, 'a 403 would confirm that the material exists');
    assert.equal(result.body.message, 'Paper not found');
  }
  assert.deepEqual(fake.get(id), before);
  assert.equal((await call('GET', publicPath(token))).status, 200, "Bob's attempts must not have revoked Alice's link");

  // ... and Bob cannot start sharing a private material of Alice either.
  const { id: privateId } = seed({ owner: ALICE });
  assert.equal((await share(privateId, 'bob')).status, 404);
  assert.notEqual(fake.get(privateId).isShared, true);
  assert.equal(fake.get(privateId).shareTokenHash, undefined);
});

test('a student can share their own material, but an admin-owned material is not theirs to share', async () => {
  const { id } = seed({ owner: ADMIN });
  assert.equal((await share(id, 'alice')).status, 404);
  assert.equal((await share(id, 'admin')).status, 201);
});

test('the sharing status tells the owner whether a link is active, never the link or the token', async () => {
  const { id } = seed({ owner: ALICE });
  const off = await status(id);
  assert.equal(off.status, 200);
  assert.deepEqual(off.body.data, { _id: id, isShared: false, sharedAt: null, sharedBy: null });

  const link = await share(id);
  const token = tokenOf(link.body.data.shareUrl);
  const on = await status(id);
  assert.equal(on.status, 200);
  assert.equal(on.body.data.isShared, true);
  assert.equal(on.body.data.sharedBy, ALICE);
  assert.ok(!on.text.includes(token), 'the token must never be readable again');
  assert.ok(!on.text.includes(hashShareToken(token)), 'the stored hash must never be returned');
  assert.ok(!/shareUrl|apiUrl|fileUrl/.test(on.text));
  assert.equal((await status(id, 'admin')).body.data.isShared, true);
});

// ======================================================================= 2. secure token handling

test('only the SHA-256 hash of the token is stored: the token is nowhere in the stored record', async () => {
  const { id } = seed({ owner: ALICE });
  const token = tokenOf((await share(id)).body.data.shareUrl);
  const stored = fake.get(id);
  assert.equal(stored.shareTokenHash, hashShareToken(token));
  assert.equal(stored.isShared, true);
  assert.ok(!JSON.stringify(stored).includes(token), 'the plain token must not be stored');
});

test('every link is different, and different materials get different tokens', async () => {
  const a = seed({ owner: ALICE });
  const b = seed({ owner: ALICE });
  const tokenA = tokenOf((await share(a.id)).body.data.shareUrl);
  const tokenB = tokenOf((await share(b.id)).body.data.shareUrl);
  assert.notEqual(tokenA, tokenB);
  assert.ok(!tokenA.includes(a.id) && !tokenB.includes(b.id), 'a token is not derived from the material id');
  assert.equal(fake.get(a.id).shareTokenHash === fake.get(b.id).shareTokenHash, false);
  assert.equal((await call('GET', publicPath(tokenA))).body.data.title, 'Sample material');
});

test("the owner's normal responses never contain the token, the hash or who made the link", async () => {
  const { id } = seed({ owner: ALICE });
  const token = tokenOf((await share(id)).body.data.shareUrl);
  const hash = hashShareToken(token);
  for (const result of [await call('GET', `/api/papers/${id}`, { token: tokens.alice }), await call('GET', '/api/papers', { token: tokens.alice }), await call('PATCH', `/api/papers/${id}`, { token: tokens.alice, json: { title: 'Renamed' } })]) {
    assert.equal(result.status, 200);
    assert.ok(!result.text.includes(token) && !result.text.includes(hash), 'token or hash leaked');
    assert.ok(!result.text.includes('shareTokenHash') && !result.text.includes('sharedBy'));
  }
  // The owner does see the state itself.
  const one = (await call('GET', `/api/papers/${id}`, { token: tokens.alice })).body.data.paper;
  assert.equal(one.isShared, true);
  assert.ok(!Number.isNaN(Date.parse(one.sharedAt)));
});

test('a material that is not shared shows isShared=false, sharedAt=null (also one saved before Phase 4.3A)', async () => {
  const { id } = seed({ owner: ALICE });
  const legacy = fake.add({ owner: ALICE, legacy: true });
  for (const paperId of [id, legacy]) {
    const paper = (await call('GET', `/api/papers/${paperId}`, { token: tokens.alice })).body.data.paper;
    assert.equal(paper.isShared, false);
    assert.equal(paper.sharedAt, null);
  }
});

test('the share fields cannot be set through upload or edit: PATCH refuses them (400) and nothing changes', async () => {
  const { id } = seed({ owner: ALICE });
  const before = fake.get(id);
  for (const field of ['isShared', 'shareTokenHash', 'sharedAt', 'sharedBy']) {
    const result = await call('PATCH', `/api/papers/${id}`, { token: tokens.alice, json: { title: 'x', [field]: field === 'isShared' ? true : 'abc' } });
    assert.equal(result.status, 400, field);
  }
  assert.deepEqual(fake.get(id), before);
});

// ======================================================================= 3. public access without login

test('a shared material can be opened WITHOUT a login: only a whitelist of metadata, no private data', async () => {
  const { id, storedName } = seed({ owner: ALICE, title: 'OS Unit Notes', materialType: 'notes', extractionStatus: 'completed', extractedText: 'SECRET EXTRACTED TEXT', pageCount: 4 });
  const link = (await share(id)).body.data;
  const token = tokenOf(link.shareUrl);

  const result = await call('GET', link.apiUrl); // no Authorization header
  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.deepEqual(Object.keys(result.body.data).sort(), ['description', 'fileName', 'fileType', 'fileUrl', 'materialType', 'mimeType', 'pageCount', 'sharedAt', 'size', 'title', 'uploadedAt']);
  assert.equal(result.body.data.title, 'OS Unit Notes');
  assert.equal(result.body.data.materialType, 'notes');
  assert.equal(result.body.data.fileName, 'notes.pdf');
  assert.equal(result.body.data.pageCount, 4);
  assert.equal(result.body.data.fileUrl, `/api/shared/materials/${token}/file`);
  assertNoPrivateData(result, { id, storedName });
  assert.ok(!result.text.includes('SECRET EXTRACTED TEXT'));

  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(result.headers.get('referrer-policy'), 'no-referrer');
  assert.match(result.headers.get('x-robots-tag'), /noindex/);
});

test('the shared FILE can be opened without a login, inline or as a download, with safe headers', async () => {
  const pdf = seed({ owner: ALICE });
  const png = seed({ owner: ALICE, kind: 'png' });
  const pdfToken = tokenOf((await share(pdf.id)).body.data.shareUrl);
  const pngToken = tokenOf((await share(png.id)).body.data.shareUrl);

  const inline = await call('GET', `${publicPath(pdfToken)}/file`);
  assert.equal(inline.status, 200);
  assert.ok(inline.buffer.equals(PDF_BYTES));
  assert.equal(inline.headers.get('content-type'), 'application/pdf');
  assert.equal(inline.headers.get('content-length'), String(PDF_BYTES.length));
  assert.match(inline.headers.get('content-disposition'), /^inline;/);
  assert.equal(inline.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(inline.headers.get('cache-control'), 'no-store');
  assert.equal(inline.headers.get('referrer-policy'), 'no-referrer');

  const download = await call('GET', `${publicPath(pdfToken)}/file?download=true`);
  assert.match(download.headers.get('content-disposition'), /^attachment;/);

  const image = await call('GET', `${publicPath(pngToken)}/file`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.ok(image.buffer.equals(PNG_BYTES));
});

test('a link opens exactly one material: it gives no access to the owner\'s other materials or to the private API', async () => {
  const shared = seed({ owner: ALICE });
  const other = seed({ owner: ALICE });
  const token = tokenOf((await share(shared.id)).body.data.shareUrl);

  assert.equal((await call('GET', `/api/papers/${other.id}/file`)).status, 401);
  assert.equal((await call('GET', `/api/papers/${shared.id}/file`)).status, 401, 'the private routes still need a login');
  assert.equal((await call('GET', `/api/shared/materials/${other.id}`)).status, 404, 'a material id is not a token');
  assert.equal((await call('GET', `/api/shared/materials/${other.id}/file`)).status, 404);
  assert.equal((await call('GET', '/api/shared/materials')).status, 404, 'there is no list of shared materials');
  assert.equal((await call('GET', '/api/shared/materials/')).status, 404);
  // The token of one material does not work for the other one.
  const view = await call('GET', publicPath(token));
  assert.equal(view.body.data.fileUrl, `/api/shared/materials/${token}/file`);
});

test('the shared view of a material saved before Phase 4.1 (no title, no type) still works', async () => {
  const { id } = seed({ owner: ALICE, title: undefined, materialType: undefined, description: undefined });
  const token = tokenOf((await share(id)).body.data.shareUrl);
  const result = await call('GET', publicPath(token));
  assert.equal(result.status, 200);
  assert.equal(result.body.data.title, 'notes.pdf', 'falls back to the file name');
  assert.equal(result.body.data.materialType, 'question_paper');
  assert.equal(result.body.data.description, '');
});

// ======================================================================= 4. unshared materials stay private

test('a material that was never shared cannot be reached with any token, and guessing fails the same way every time', async () => {
  const { id } = seed({ owner: ALICE });
  const message = 'Shared material not found';
  const guesses = [crypto.randomBytes(32).toString('base64url'), crypto.randomBytes(32).toString('base64url'), hashShareToken('x'), 'A'.repeat(43), id, ALICE];
  for (const guess of guesses) {
    for (const suffix of ['', '/file']) {
      const result = await call('GET', `${publicPath(guess)}${suffix}`);
      assert.equal(result.status, 404, guess);
      assert.equal(result.body.message, message);
      assertNoPrivateData(result, { id });
    }
  }
  assert.notEqual(fake.get(id).isShared, true);
  assert.equal(fake.get(id).shareTokenHash, undefined);
});

test("a stored hash alone is not a working link: only the token works, not the hash of it", async () => {
  const { id } = seed({ owner: ALICE });
  const token = tokenOf((await share(id)).body.data.shareUrl);
  const hash = fake.get(id).shareTokenHash;
  assert.equal((await call('GET', publicPath(hash))).status, 404, 'a leaked hash must not open the material');
  assert.equal((await call('GET', publicPath(token))).status, 200);
});

test('a material whose isShared flag is off does not open, even if a hash were still stored', async () => {
  const token = crypto.randomBytes(32).toString('base64url');
  const { id } = seed({ owner: ALICE, isShared: false, shareTokenHash: hashShareToken(token) });
  const result = await call('GET', publicPath(token));
  assert.equal(result.status, 404);
  assert.equal((await call('GET', `${publicPath(token)}/file`)).status, 404);
  assert.ok(fake.get(id));
});

test('malformed tokens are refused with the same 404 BEFORE any database query', async () => {
  const bad = ['short', 'a'.repeat(42), 'a'.repeat(44), `${'a'.repeat(42)}!`, `${'a'.repeat(42)}%2F`, '..%2f..%2f..%2fetc%2fpasswd', '%24ne', 'a'.repeat(200), '%00'];
  const queriesBefore = fake.filters().length;
  for (const token of bad) {
    for (const suffix of ['', '/file']) {
      const result = await call('GET', `/api/shared/materials/${token}${suffix}`);
      assert.equal(result.status, 404, token);
      assert.equal(result.body.message, 'Shared material not found');
    }
  }
  assert.equal(fake.filters().length, queriesBefore, 'a malformed token must not reach the database');
});

test('opening a link changes nothing (read-only): every method except GET/HEAD answers 405', async () => {
  const { id } = seed({ owner: ALICE });
  const token = tokenOf((await share(id)).body.data.shareUrl);
  const before = fake.get(id);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const suffix of ['', '/file']) {
      const result = await call(method, `${publicPath(token)}${suffix}`, { json: method === 'GET' ? undefined : { title: 'Hacked', isShared: false } });
      assert.equal(result.status, 405, `${method} ${suffix}`);
      assert.equal(result.headers.get('allow'), 'GET, HEAD');
    }
  }
  assert.deepEqual(fake.get(id), before);
  const head = await fetch(`${baseUrl}${publicPath(token)}`, { method: 'HEAD' });
  assert.equal(head.status, 200);
});

// ======================================================================= 5. revocation

test('REVOKING stops the link at once (metadata and file), and removes the token hash from the record', async () => {
  const { id } = seed({ owner: ALICE });
  const token = tokenOf((await share(id)).body.data.shareUrl);
  assert.equal((await call('GET', publicPath(token))).status, 200);
  assert.equal((await call('GET', `${publicPath(token)}/file`)).status, 200);

  const result = await revoke(id);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data, { _id: id, isShared: false, sharedAt: null });
  assert.match(result.body.message, /revoked/i);
  assert.equal(result.headers.get('cache-control'), 'no-store');

  for (const suffix of ['', '/file', '/file?download=true']) {
    const dead = await call('GET', `${publicPath(token)}${suffix}`);
    assert.equal(dead.status, 404, suffix);
    assert.equal(dead.body.message, 'Shared material not found');
  }
  const stored = fake.get(id);
  assert.equal(stored.isShared, false);
  assert.equal(stored.sharedAt, null);
  assert.equal(stored.shareTokenHash, undefined, 'the hash is removed, not just ignored');
  assert.equal(stored.sharedBy, undefined);
  assert.deepEqual((await status(id)).body.data, { _id: id, isShared: false, sharedAt: null, sharedBy: null });
  assert.equal((await call('GET', `/api/papers/${id}`, { token: tokens.alice })).body.data.paper.isShared, false);
});

test('an ADMIN can revoke a link the student created', async () => {
  const { id } = seed({ owner: ALICE });
  const token = tokenOf((await share(id)).body.data.shareUrl);
  assert.equal((await revoke(id, 'admin')).status, 200);
  assert.equal((await call('GET', publicPath(token))).status, 404);
});

test('revoking a material that is not shared is harmless (200) and changes nothing', async () => {
  const { id } = seed({ owner: ALICE });
  const before = fake.get(id);
  const result = await revoke(id);
  assert.equal(result.status, 200);
  assert.equal(result.body.message, 'This material was not shared');
  assert.equal(result.body.data.isShared, false);
  assert.equal(fake.get(id).isShared === true, false);

  const token = tokenOf((await share(id)).body.data.shareUrl);
  assert.equal((await revoke(id)).status, 200);
  assert.equal((await revoke(id)).status, 200, 'revoking twice is fine');
  assert.equal((await call('GET', publicPath(token))).status, 404);
  assert.equal(fake.get(id).title, before.title);
});

test('sharing again after a revoke makes a BRAND-NEW link; the old one stays dead', async () => {
  const { id } = seed({ owner: ALICE });
  const first = tokenOf((await share(id)).body.data.shareUrl);
  await revoke(id);
  const again = await share(id);
  assert.equal(again.status, 201, 'a new link, not a replacement');
  const second = tokenOf(again.body.data.shareUrl);
  assert.notEqual(first, second);
  assert.equal((await call('GET', publicPath(first))).status, 404);
  assert.equal((await call('GET', publicPath(second))).status, 200);
});

test('creating a link while one is active is a 409 and does NOT replace it; ?replace=true issues a new one and kills the old', async () => {
  const { id } = seed({ owner: ALICE });
  const first = (await share(id)).body.data;
  const firstToken = tokenOf(first.shareUrl);

  const second = await share(id);
  assert.equal(second.status, 409);
  assert.equal(second.body.success, false);
  assert.ok(!second.text.includes(firstToken), 'the 409 must not repeat the existing link');
  assert.equal((await call('GET', publicPath(firstToken))).status, 200, 'the existing link keeps working');
  assert.equal(fake.get(id).shareTokenHash, hashShareToken(firstToken));

  const replaced = await share(id, 'alice', '?replace=true');
  assert.equal(replaced.status, 200);
  assert.match(replaced.body.message, /replaced/i);
  const newToken = tokenOf(replaced.body.data.shareUrl);
  assert.notEqual(newToken, firstToken);
  assert.equal((await call('GET', publicPath(firstToken))).status, 404, 'the old link is dead');
  assert.equal((await call('GET', publicPath(newToken))).status, 200);
  assert.equal(fake.get(id).shareTokenHash, hashShareToken(newToken));
  assert.ok(replaced.body.data.sharedAt >= first.sharedAt);

  // ?replace=true on a material that is not shared simply creates the link.
  const { id: other } = seed({ owner: ALICE });
  assert.equal((await share(other, 'alice', '?replace=true')).status, 201);
});

test('two simultaneous requests cannot both create a link: exactly one wins and its link is the one that works', async () => {
  const { id } = seed({ owner: ALICE });
  const results = await Promise.all([share(id), share(id), share(id)]);
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [201, 409, 409]);
  const winner = results.find((r) => r.status === 201);
  assert.equal((await call('GET', publicPath(tokenOf(winner.body.data.shareUrl)))).status, 200);
  assert.equal(fake.get(id).shareTokenHash, hashShareToken(tokenOf(winner.body.data.shareUrl)));
});

test('deleting a shared material kills its link', async () => {
  const { id, storedName } = seed({ owner: ALICE });
  const token = tokenOf((await share(id)).body.data.shareUrl);
  assert.equal((await call('DELETE', `/api/papers/${id}`, { token: tokens.alice })).status, 200);
  assert.equal((await call('GET', publicPath(token))).status, 404);
  assert.equal((await call('GET', `${publicPath(token)}/file`)).status, 404);
  assert.equal(fs.existsSync(path.join(UPLOAD_DIR, storedName)), false);
});

test('a shared material whose stored file is gone answers a plain 404 to visitors, without any server detail', async () => {
  const { id, storedName } = seed({ owner: ALICE, writeFile: false });
  const token = tokenOf((await share(id)).body.data.shareUrl);
  assert.equal((await call('GET', publicPath(token))).status, 200, 'the metadata is still there');
  const file = await call('GET', `${publicPath(token)}/file`);
  assert.equal(file.status, 404);
  assert.equal(file.body.message, 'Shared material not found');
  assertNoPrivateData(file, { id, storedName });
  assert.ok(!/upload/i.test(file.body.message), 'the owner-facing hint must not reach a visitor');
});

test('a stored file whose bytes no longer match its type is not sent to visitors', async () => {
  const { id, storedName } = seed({ owner: ALICE });
  fs.writeFileSync(path.join(UPLOAD_DIR, storedName), Buffer.from('MZ not a pdf at all'));
  const token = tokenOf((await share(id)).body.data.shareUrl);
  const file = await call('GET', `${publicPath(token)}/file`);
  assert.equal(file.status, 404);
  assert.ok(!file.text.includes('MZ not a pdf'));
});

// ======================================================================= 6. existing behaviour is preserved

test('existing endpoints still work for owners, admins and other students exactly as before', async () => {
  const a = seed({ owner: ALICE });
  const b = seed({ owner: BOB });
  assert.equal((await call('GET', `/api/papers/${a.id}`, { token: tokens.alice })).status, 200);
  assert.equal((await call('GET', `/api/papers/${a.id}`, { token: tokens.bob })).status, 404);
  assert.equal((await call('GET', `/api/papers/${b.id}`, { token: tokens.admin })).status, 200);
  const file = await call('GET', `/api/papers/${a.id}/file`, { token: tokens.alice });
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual((await call('GET', '/api/papers', { token: tokens.alice })).body.data.papers.map((p) => p._id), [a.id]);
  assert.equal((await call('PATCH', `/api/papers/${a.id}`, { token: tokens.alice, json: { title: 'Renamed' } })).body.data.paper.title, 'Renamed');
  // Sharing and editing are independent: editing a shared material keeps the link.
  const token = tokenOf((await share(a.id)).body.data.shareUrl);
  await call('PATCH', `/api/papers/${a.id}`, { token: tokens.alice, json: { title: 'Renamed again' } });
  assert.equal((await call('GET', publicPath(token))).body.data.title, 'Renamed again');
});

test('the Phase 2C question-set sharing route is untouched', async () => {
  const result = await call('GET', `/api/shared/question-sets/${crypto.randomBytes(32).toString('base64url')}`);
  assert.equal(result.status, 404);
});

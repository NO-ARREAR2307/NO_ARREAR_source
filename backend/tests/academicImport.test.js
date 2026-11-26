'use strict';

// Academic Subject Bulk Import, Part 1: POST /api/admin/academic-imports/subjects.
// Same approach as tests/academicAdmin.test.js: no database or internet. The five academic models run against
// the in-memory stand-in (tests/helpers/fakeAcademicDb.js) that keeps their real schemas, enums and unique
// indexes, and the User lookup used by the JWT middleware is replaced. Express, JWT, role middleware, the
// import validators, the import service and the error handler are the real code.

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'unit-test-secret-unit-test-secret-1234567890';
process.env.MONGO_URI = 'mongodb://localhost:27017/studywise_ai_test';
process.env.RATE_LIMIT_MAX = '100000';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const User = require('../models/User');
const { University, Department, Regulation, Semester, Subject } = require('../models');
const generateToken = require('../utils/generateToken');
const { MAX_SUBJECTS_PER_IMPORT } = require('../validators/academicImportValidators');
const fakeDb = require('./helpers/fakeAcademicDb');
const app = require('../app');

fakeDb.install();
// The in-memory save installed above; tests that simulate a database failure wrap it and always restore it.
const fakeSave = Subject.prototype.save;

const ADMIN_ID = new mongoose.Types.ObjectId().toString();
const STUDENT_ID = new mongoose.Types.ObjectId().toString();
const accounts = {
  [ADMIN_ID]: { _id: ADMIN_ID, name: 'Admin', email: 'admin@example.com', role: 'admin' },
  [STUDENT_ID]: { _id: STUDENT_ID, name: 'Student', email: 'student@example.com', role: 'student', emailVerified: true },
};
User.findById = async (id) => accounts[String(id)] || null;

const adminToken = generateToken(ADMIN_ID);
const studentToken = generateToken(STUDENT_ID);
const MISSING_ID = new mongoose.Types.ObjectId().toString();
const IMPORT_URL = '/api/admin/academic-imports/subjects';

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
});
test.beforeEach(() => {
  fakeDb.reset();
  Subject.prototype.save = fakeSave;
});

const call = async (path, { method = 'GET', token = adminToken, body, rawBody } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const payload = rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined;
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: payload });
  return { status: response.status, json: await response.json() };
};

const post = (path, body, token) => call(path, { method: 'POST', body, token });
const del = (path, token) => call(path, { method: 'DELETE', token });

const makeUniversity = async (over = {}) => (await post('/api/admin/universities', { name: 'Test University', ...over })).json.data.university;
const makeDepartment = async (university, over = {}) =>
  (await post('/api/admin/departments', { name: 'Computer Applications', code: 'CA', university, level: 'UG', ...over })).json.data.department;
const makeRegulation = async (department, over = {}) =>
  (await post('/api/admin/regulations', { name: 'Test Regulation', department, ...over })).json.data.regulation;
const makeSemester = async (regulation, semesterNumber) =>
  (await post('/api/admin/semesters', { semesterNumber, regulation })).json.data.semester;
const makeSubject = async (semester, over = {}) =>
  (await post('/api/admin/subjects', { name: 'Existing Subject', subjectCode: 'EX101', subjectType: 'theory', category: 'core', semester, ...over })).json.data.subject;

// University -> Department -> Regulation with semesters 1, 2 and 3 (no subjects). Only made-up test names.
const makeSetup = async () => {
  const university = await makeUniversity({ code: 'TU' });
  const department = await makeDepartment(university._id);
  const regulation = await makeRegulation(department._id);
  const semesters = {};
  for (const number of [1, 2, 3]) semesters[number] = await makeSemester(regulation._id, number);
  return { university, department, regulation, semesters };
};

const record = (over = {}) => ({ semesterNumber: 1, name: 'Sample Subject', subjectCode: 'SMP101', subjectType: 'theory', category: 'core', ...over });

const importBody = (setup, subjects, over = {}) => ({ departmentId: setup.department._id, regulationId: setup.regulation._id, subjects, ...over });
const runImport = (setup, subjects, over = {}, token) => post(IMPORT_URL, importBody(setup, subjects, over), token);

const MODELS = [University, Department, Regulation, Semester, Subject];
const snapshot = () => JSON.stringify(MODELS.map((Model) => fakeDb.rawDocs(Model)));
const subjectDocs = () => fakeDb.rawDocs(Subject);

// ---------------------------------------------------------------- security

test('no token: 401 and nothing is written', async () => {
  const setup = await makeSetup();
  const before = snapshot();
  const result = await call(IMPORT_URL, { method: 'POST', token: null, body: importBody(setup, [record()], { dryRun: false }) });
  assert.equal(result.status, 401);
  assert.equal(result.json.success, false);
  assert.equal(snapshot(), before);
});

test('a malformed or tampered token gets 401', async () => {
  const setup = await makeSetup();
  const result = await post(IMPORT_URL, importBody(setup, [record()], { dryRun: false }), 'not-a-token');
  assert.equal(result.status, 401);
});

test('a student gets 403 (dry run and real import) and nothing is written', async () => {
  const setup = await makeSetup();
  const before = snapshot();
  for (const dryRun of [true, false]) {
    const result = await runImport(setup, [record()], { dryRun }, studentToken);
    assert.equal(result.status, 403);
    assert.equal(result.json.success, false);
  }
  assert.equal(snapshot(), before);
});

test('an admin can use the endpoint', async () => {
  const setup = await makeSetup();
  const result = await runImport(setup, [record()]);
  assert.equal(result.status, 200);
  assert.equal(result.json.success, true);
});

// ---------------------------------------------------------------- dry run

test('dryRun defaults to true when omitted: a preview is returned and nothing is written', async () => {
  const setup = await makeSetup();
  const before = snapshot();
  let saves = 0;
  Subject.prototype.save = function countingSave(...args) {
    saves += 1;
    return fakeSave.apply(this, args);
  };

  const result = await runImport(setup, [
    record({ name: 'Subject One', subjectCode: 'S1' }),
    record({ name: 'Subject Two', subjectCode: 'S2', semesterNumber: 2, subjectType: 'practical', category: 'skill_enhancement' }),
  ]);

  assert.equal(result.status, 200);
  const { data } = result.json;
  assert.equal(data.dryRun, true);
  assert.equal(data.totalReceived, 2);
  assert.equal(data.validRecords, 2);
  assert.equal(data.newRecords, 2);
  assert.equal(data.duplicates, 0);
  assert.equal(data.invalidRecords, 0);
  assert.equal(data.imported, 0);
  assert.equal(data.skipped, 0);
  assert.equal(data.failed, 0);
  assert.deepEqual(data.results.map((r) => r.status), ['new', 'new']);
  assert.equal(saves, 0, 'a dry run must never call save');
  assert.equal(fakeDb.count(Subject), 0);
  assert.equal(snapshot(), before);
});

test('explicit dryRun:true behaves the same and reports the resolved department and regulation', async () => {
  const setup = await makeSetup();
  const result = await runImport(setup, [record()], { dryRun: true });
  assert.equal(result.status, 200);
  assert.equal(result.json.data.dryRun, true);
  assert.equal(result.json.data.department.id, setup.department._id);
  assert.equal(result.json.data.regulation.id, setup.regulation._id);
  assert.equal(fakeDb.count(Subject), 0);
});

test('dryRun must be a real boolean: the text "false" is rejected and nothing is written', async () => {
  const setup = await makeSetup();
  for (const dryRun of ['false', 0, null, 'no']) {
    const result = await runImport(setup, [record()], { dryRun });
    assert.equal(result.status, 400);
    assert.ok(result.json.errors.some((e) => e.field === 'dryRun'));
  }
  assert.equal(fakeDb.count(Subject), 0);
});

test('a dry run previews exactly what the real import then does', async () => {
  const setup = await makeSetup();
  await makeSubject(setup.semesters[1]._id, { subjectCode: 'DUP1', name: 'Already There' });
  const subjects = [
    record({ name: 'Fresh', subjectCode: 'NEW1' }),
    record({ name: 'Again', subjectCode: 'DUP1' }),
    record({ name: 'Broken', subjectType: 'nonsense' }),
  ];

  const preview = (await runImport(setup, subjects, { dryRun: true })).json.data;
  const real = (await runImport(setup, subjects, { dryRun: false })).json.data;

  assert.equal(preview.newRecords, 1);
  assert.equal(preview.duplicates, 1);
  assert.equal(preview.invalidRecords, 1);
  assert.equal(real.imported, preview.newRecords);
  assert.equal(real.skipped, preview.duplicates);
  assert.equal(real.failed, preview.invalidRecords);
  assert.equal(real.validRecords, preview.validRecords);
});

// ---------------------------------------------------------------- successful import

test('a real import creates the subjects in the semesters resolved from regulationId + semesterNumber', async () => {
  const setup = await makeSetup();
  const result = await runImport(
    setup,
    [
      record({ name: 'Subject One', subjectCode: 'S1', semesterNumber: 1 }),
      record({ name: ' Subject Two ', subjectCode: ' s2 ', semesterNumber: 2, subjectType: 'Practical', category: 'Skill_Enhancement' }),
    ],
    { dryRun: false }
  );

  assert.equal(result.status, 200);
  const { data } = result.json;
  assert.equal(data.dryRun, false);
  assert.equal(data.totalReceived, 2);
  assert.equal(data.imported, 2);
  assert.equal(data.skipped, 0);
  assert.equal(data.failed, 0);
  assert.deepEqual(data.results.map((r) => r.status), ['imported', 'imported']);
  assert.ok(data.results.every((r) => typeof r.subjectId === 'string'));

  const docs = subjectDocs();
  assert.equal(docs.length, 2);
  const one = docs.find((d) => d.subjectCode === 'S1');
  const two = docs.find((d) => d.subjectCode === 'S2'); // trimmed + upper-cased like the normal API
  assert.equal(String(one.semester), setup.semesters[1]._id);
  assert.equal(String(two.semester), setup.semesters[2]._id);
  assert.equal(two.name, 'Subject Two');
  assert.equal(two.subjectType, 'practical');
  assert.equal(two.category, 'skill_enhancement');
  assert.equal(one.isActive, true);
  assert.deepEqual(data.results.map((r) => r.subjectId), docs.map((d) => String(d._id)));

  // The imported subjects are visible through the normal admin API.
  const listed = await call(`/api/admin/subjects?semester=${setup.semesters[1]._id}`);
  assert.equal(listed.json.data.subjects.length, 1);
});

test('the import creates no university, department, regulation or semester', async () => {
  const setup = await makeSetup();
  const before = MODELS.slice(0, 4).map(fakeDb.count);
  await runImport(setup, [record({ semesterNumber: 3 })], { dryRun: false });
  assert.deepEqual(MODELS.slice(0, 4).map(fakeDb.count), before);
});

// ---------------------------------------------------------------- duplicates

test('a code that already exists in the same semester is a duplicate and the existing subject is untouched', async () => {
  const setup = await makeSetup();
  const existing = await makeSubject(setup.semesters[1]._id, { subjectCode: 'CS101', name: 'Original Name', subjectType: 'theory', category: 'core' });
  const before = JSON.stringify(subjectDocs());

  const dry = (await runImport(setup, [record({ subjectCode: 'cs101 ', name: 'Different Name', subjectType: 'practical', category: 'other' })])).json.data;
  assert.equal(dry.duplicates, 1);
  assert.equal(dry.newRecords, 0);
  assert.equal(dry.results[0].status, 'duplicate');
  assert.equal(dry.results[0].existingSubjectId, existing._id);
  assert.match(dry.results[0].reason, /CS101/);

  const real = (await runImport(setup, [record({ subjectCode: 'cs101 ', name: 'Different Name', subjectType: 'practical', category: 'other' })], { dryRun: false })).json.data;
  assert.equal(real.imported, 0);
  assert.equal(real.skipped, 1);
  assert.equal(real.failed, 0);
  assert.equal(real.results[0].status, 'skipped');
  assert.equal(JSON.stringify(subjectDocs()), before, 'the existing subject is neither overwritten nor deactivated');
});

test('an inactive existing subject with the same code is still a duplicate and is not re-activated', async () => {
  const setup = await makeSetup();
  const existing = await makeSubject(setup.semesters[1]._id, { subjectCode: 'OLD1' });
  await del(`/api/admin/subjects/${existing._id}`);

  const result = (await runImport(setup, [record({ subjectCode: 'OLD1' })], { dryRun: false })).json.data;
  assert.equal(result.skipped, 1);
  assert.equal(result.results[0].existingIsActive, false);
  assert.equal(subjectDocs().length, 1);
  assert.equal(subjectDocs()[0].isActive, false);
});

test('the same code twice inside one request: the first is new, the second a duplicate of it', async () => {
  const setup = await makeSetup();
  const subjects = [record({ name: 'First', subjectCode: 'DUP' }), record({ name: 'Second', subjectCode: 'dup' })];

  const dry = (await runImport(setup, subjects)).json.data;
  assert.deepEqual(dry.results.map((r) => r.status), ['new', 'duplicate']);
  assert.equal(dry.results[1].duplicateOfIndex, 0);

  const real = (await runImport(setup, subjects, { dryRun: false })).json.data;
  assert.equal(real.imported, 1);
  assert.equal(real.skipped, 1);
  assert.deepEqual(subjectDocs().map((d) => d.name), ['First']);
});

test('the same code in different semesters is NOT a duplicate', async () => {
  const setup = await makeSetup();
  await makeSubject(setup.semesters[1]._id, { subjectCode: 'SHARED' });

  const subjects = [
    record({ name: 'In Semester Two', subjectCode: 'SHARED', semesterNumber: 2 }),
    record({ name: 'In Semester Three', subjectCode: 'SHARED', semesterNumber: 3 }),
  ];
  const dry = (await runImport(setup, subjects)).json.data;
  assert.equal(dry.newRecords, 2);
  assert.equal(dry.duplicates, 0);

  const real = (await runImport(setup, subjects, { dryRun: false })).json.data;
  assert.equal(real.imported, 2);
  assert.equal(subjectDocs().filter((d) => d.subjectCode === 'SHARED').length, 3);
});

test('a subject code from another regulation does not count as a duplicate', async () => {
  const setup = await makeSetup();
  const otherRegulation = await makeRegulation(setup.department._id, { name: 'Other Regulation' });
  const otherSemester = await makeSemester(otherRegulation._id, 1);
  await makeSubject(otherSemester._id, { subjectCode: 'SMP101' });

  const result = (await runImport(setup, [record({ subjectCode: 'SMP101' })], { dryRun: false })).json.data;
  assert.equal(result.imported, 1);
  assert.equal(subjectDocs().length, 2);
});

// ---------------------------------------------------------------- subjects without codes

test('subjects without a code (missing, null or blank) import safely, several per semester', async () => {
  const setup = await makeSetup();
  const noCode = { semesterNumber: 1, subjectType: 'theory', category: 'language' };
  const subjects = [
    { ...noCode, name: 'No Code A' },
    { ...noCode, name: 'No Code B', subjectCode: null },
    { ...noCode, name: 'No Code C', subjectCode: '' },
    { ...noCode, name: 'No Code D', subjectCode: '   ' },
  ];

  const result = (await runImport(setup, subjects, { dryRun: false })).json.data;
  assert.equal(result.imported, 4);
  assert.equal(result.failed, 0);
  assert.ok(subjectDocs().every((d) => d.subjectCode === undefined), 'no code is stored at all');
  assert.ok(result.results.every((r) => r.subjectCode === null));
});

test('a code-less subject is identified by its name: same name (any case/spacing) in the semester is a duplicate', async () => {
  const setup = await makeSetup();
  const inOtherSemester = { semesterNumber: 2, name: 'Environmental Studies', subjectType: 'theory', category: 'ability_enhancement' };
  const subjects = [
    { semesterNumber: 1, name: 'Environmental Studies', subjectType: 'theory', category: 'ability_enhancement' },
    { semesterNumber: 1, name: '  environmental   STUDIES ', subjectType: 'theory', category: 'ability_enhancement' },
    inOtherSemester,
  ];

  const dry = (await runImport(setup, subjects)).json.data;
  assert.deepEqual(dry.results.map((r) => r.status), ['new', 'duplicate', 'new']);
  assert.equal(dry.results[1].duplicateOfIndex, 0);

  const real = (await runImport(setup, subjects, { dryRun: false })).json.data;
  assert.equal(real.imported, 2);
  assert.equal(real.skipped, 1);
  assert.equal(subjectDocs().length, 2);
});

test('a code-less subject whose name matches an existing coded subject of the semester is skipped', async () => {
  const setup = await makeSetup();
  await makeSubject(setup.semesters[1]._id, { subjectCode: 'MA101', name: 'Mathematics' });
  const result = (await runImport(setup, [{ semesterNumber: 1, name: 'mathematics', subjectType: 'theory', category: 'core' }], { dryRun: false })).json.data;
  assert.equal(result.imported, 0);
  assert.equal(result.skipped, 1);
  assert.equal(subjectDocs().length, 1);
});

test('two different coded subjects may share a name', async () => {
  const setup = await makeSetup();
  const subjects = [record({ name: 'Practical', subjectCode: 'P1' }), record({ name: 'Practical', subjectCode: 'P2' })];
  const result = (await runImport(setup, subjects, { dryRun: false })).json.data;
  assert.equal(result.imported, 2);
});

// ---------------------------------------------------------------- idempotency

test('repeating the same import inserts nothing again (coded and code-less records)', async () => {
  const setup = await makeSetup();
  const subjects = [
    record({ name: 'Coded One', subjectCode: 'C1' }),
    record({ name: 'Coded Two', subjectCode: 'C2', semesterNumber: 2 }),
    { semesterNumber: 3, name: 'Uncoded One', subjectType: 'project', category: 'other' },
  ];

  const first = (await runImport(setup, subjects, { dryRun: false })).json.data;
  assert.equal(first.imported, 3);
  const afterFirst = JSON.stringify(subjectDocs());

  const second = (await runImport(setup, subjects, { dryRun: false })).json.data;
  assert.equal(second.imported, 0);
  assert.equal(second.skipped, 3);
  assert.equal(second.failed, 0);
  assert.deepEqual(second.results.map((r) => r.status), ['skipped', 'skipped', 'skipped']);
  assert.equal(JSON.stringify(subjectDocs()), afterFirst, 'the second run changes nothing');

  const dry = (await runImport(setup, subjects)).json.data;
  assert.equal(dry.newRecords, 0);
  assert.equal(dry.duplicates, 3);
});

test('importing a superset later only adds the missing subjects', async () => {
  const setup = await makeSetup();
  const base = [record({ name: 'A', subjectCode: 'A1' }), record({ name: 'B', subjectCode: 'B1' })];
  await runImport(setup, base, { dryRun: false });
  const result = (await runImport(setup, [...base, record({ name: 'C', subjectCode: 'C1' })], { dryRun: false })).json.data;
  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 2);
  assert.equal(subjectDocs().length, 3);
});

// ---------------------------------------------------------------- semester resolution

test('a semester that does not exist under the regulation makes that record invalid (others still import)', async () => {
  const setup = await makeSetup(); // semesters 1-3 only
  const result = await runImport(setup, [record({ name: 'Fine', subjectCode: 'OK1' }), record({ name: 'Orphan', subjectCode: 'OR1', semesterNumber: 6 })], { dryRun: false });
  assert.equal(result.status, 200);
  const { data } = result.json;
  assert.equal(data.imported, 1);
  assert.equal(data.failed, 1);
  assert.equal(data.results[1].status, 'failed');
  assert.ok(data.results[1].errors.some((e) => e.field === 'semesterNumber' && /Semester 6 does not exist/.test(e.message)));
  assert.equal(fakeDb.count(Semester), 3, 'a missing semester is never created');
  assert.equal(subjectDocs().length, 1);
});

test('semesters of ANOTHER regulation are not used even when the number matches', async () => {
  const setup = await makeSetup();
  const other = await makeRegulation(setup.department._id, { name: 'Other Regulation' });
  await makeSemester(other._id, 5); // exists, but not under the regulation being imported into
  const dry = (await runImport(setup, [record({ semesterNumber: 5 })])).json.data;
  assert.equal(dry.invalidRecords, 1);
  assert.equal(dry.results[0].status, 'invalid');
});

test('a semester id sent by the client is never trusted (unknown field) and nothing is written', async () => {
  const setup = await makeSetup();
  const result = await runImport(setup, [record({ semester: setup.semesters[1]._id }), record({ semesterId: setup.semesters[2]._id, subjectCode: 'X2' })], { dryRun: false });
  assert.equal(result.status, 200);
  assert.equal(result.json.data.imported, 0);
  assert.equal(result.json.data.failed, 2);
  assert.ok(result.json.data.results[0].errors.some((e) => e.field === 'semester' && /not accepted/.test(e.message)));
  assert.ok(result.json.data.results[1].errors.some((e) => e.field === 'semesterId'));
  assert.equal(fakeDb.count(Subject), 0);
});

test('an inactive semester makes the record invalid', async () => {
  const setup = await makeSetup();
  await del(`/api/admin/semesters/${setup.semesters[2]._id}`);
  const result = (await runImport(setup, [record({ semesterNumber: 2 })], { dryRun: false })).json.data;
  assert.equal(result.imported, 0);
  assert.equal(result.failed, 1);
  assert.ok(result.results[0].errors[0].message.includes('inactive'));
  assert.equal(fakeDb.count(Subject), 0);
});

// ---------------------------------------------------------------- department / regulation checks

test('a regulation that belongs to a different department is rejected (400) and nothing is written', async () => {
  const setup = await makeSetup();
  const otherDepartment = await makeDepartment(setup.university._id, { name: 'Other Department', code: 'OD' });
  const before = snapshot();
  const result = await post(IMPORT_URL, { departmentId: otherDepartment._id, regulationId: setup.regulation._id, dryRun: false, subjects: [record()] });
  assert.equal(result.status, 400);
  assert.ok(result.json.errors.some((e) => e.field === 'regulationId' && /does not belong/.test(e.message)));
  assert.equal(snapshot(), before);
});

test('an unknown department or regulation id (valid format) is rejected with a field error', async () => {
  const setup = await makeSetup();
  const noDepartment = await post(IMPORT_URL, { departmentId: MISSING_ID, regulationId: setup.regulation._id, subjects: [record()] });
  assert.equal(noDepartment.status, 400);
  assert.ok(noDepartment.json.errors.some((e) => e.field === 'departmentId'));

  const noRegulation = await post(IMPORT_URL, { departmentId: setup.department._id, regulationId: MISSING_ID, subjects: [record()] });
  assert.equal(noRegulation.status, 400);
  assert.ok(noRegulation.json.errors.some((e) => e.field === 'regulationId'));
});

test('malformed or missing departmentId / regulationId are rejected', async () => {
  const setup = await makeSetup();
  const bad = await post(IMPORT_URL, { departmentId: 'abc', regulationId: { $ne: null }, subjects: [record()] });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.json.errors.map((e) => e.field).sort(), ['departmentId', 'regulationId']);

  const missing = await post(IMPORT_URL, { subjects: [record()] });
  assert.equal(missing.status, 400);
  assert.ok(missing.json.errors.some((e) => e.field === 'departmentId' && /required/.test(e.message)));
  assert.ok(missing.json.errors.some((e) => e.field === 'regulationId' && /required/.test(e.message)));
  assert.equal(setup.department._id.length, 24);
});

test('an inactive regulation is rejected with 409', async () => {
  const setup = await makeSetup();
  // A regulation can only be deactivated once its semesters are inactive.
  for (const number of [1, 2, 3]) await del(`/api/admin/semesters/${setup.semesters[number]._id}`);
  assert.equal((await del(`/api/admin/regulations/${setup.regulation._id}`)).status, 200);

  const result = await runImport(setup, [record()], { dryRun: false });
  assert.equal(result.status, 409);
  assert.match(result.json.message, /regulation is inactive/);
  assert.equal(fakeDb.count(Subject), 0);
});

test('an inactive department is rejected with 409', async () => {
  const university = await makeUniversity({ code: 'TU' });
  const department = await makeDepartment(university._id);
  const regulation = await makeRegulation(department._id);
  assert.equal((await del(`/api/admin/regulations/${regulation._id}`)).status, 200);
  assert.equal((await del(`/api/admin/departments/${department._id}`)).status, 200);

  const result = await post(IMPORT_URL, { departmentId: department._id, regulationId: regulation._id, dryRun: false, subjects: [record()] });
  assert.equal(result.status, 409);
  assert.match(result.json.message, /department is inactive/);
});

// ---------------------------------------------------------------- record validation

test('invalid subjectType and category values are reported per record with the allowed values', async () => {
  const setup = await makeSetup();
  const result = (await runImport(setup, [record({ subjectType: 'lab', category: 'optional', subjectCode: 'E1' }), record({ subjectType: 5, category: null, subjectCode: 'E2' })])).json.data;
  assert.equal(result.invalidRecords, 2);
  const first = result.results[0];
  assert.equal(first.status, 'invalid');
  assert.ok(first.errors.some((e) => e.field === 'subjectType' && e.message.includes('theory, practical, project, internship')));
  assert.ok(first.errors.some((e) => e.field === 'category' && e.message.includes('skill_enhancement')));
  assert.ok(result.results[1].errors.some((e) => e.field === 'subjectType'));
  assert.ok(result.results[1].errors.some((e) => e.field === 'category'));
});

test('enum values are accepted case-insensitively and stored normalised', async () => {
  const setup = await makeSetup();
  await runImport(setup, [record({ subjectType: 'PROJECT', category: 'Non_Major_Elective' })], { dryRun: false });
  assert.equal(subjectDocs()[0].subjectType, 'project');
  assert.equal(subjectDocs()[0].category, 'non_major_elective');
});

test('missing required fields (name, subjectType, category, semesterNumber) get one field error each', async () => {
  const setup = await makeSetup();
  const result = (await runImport(setup, [{}, { subjectCode: 'ONLYCODE' }])).json.data;
  assert.equal(result.invalidRecords, 2);
  for (const entry of result.results) {
    assert.equal(entry.status, 'invalid');
    assert.deepEqual(entry.errors.map((e) => e.field).sort(), ['category', 'name', 'semesterNumber', 'subjectType']);
    assert.ok(entry.errors.every((e) => /is required/.test(e.message)));
  }
});

test('bad field values: blank name, name too long, code too long, semester out of range, wrong types', async () => {
  const setup = await makeSetup();
  const subjects = [
    record({ name: '   ' }),
    record({ name: 'x'.repeat(151) }),
    record({ subjectCode: 'C'.repeat(21) }),
    record({ semesterNumber: 0 }),
    record({ semesterNumber: 9 }),
    record({ semesterNumber: 1.5 }),
    record({ name: { $ne: null } }),
    record({ subjectCode: 123 }),
    'not an object',
    null,
    ['array'],
  ];
  const result = (await runImport(setup, subjects, { dryRun: false })).json.data;
  assert.equal(result.totalReceived, subjects.length);
  assert.equal(result.invalidRecords, subjects.length);
  assert.equal(result.failed, subjects.length);
  assert.equal(result.imported, 0);
  assert.ok(result.results.every((r) => r.status === 'failed' && Array.isArray(r.errors) && r.errors.length > 0));
  assert.equal(fakeDb.count(Subject), 0);
});

test('unknown fields inside a record are rejected, never silently ignored', async () => {
  const setup = await makeSetup();
  const result = (await runImport(setup, [record({ isActive: false, credits: 4, _id: MISSING_ID })], { dryRun: false })).json.data;
  assert.equal(result.imported, 0);
  assert.deepEqual(result.results[0].errors.map((e) => e.field).sort(), ['_id', 'credits', 'isActive']);
  assert.ok(result.results[0].errors.every((e) => e.message.length > 0));
});

test('unknown top-level fields are rejected with 400', async () => {
  const setup = await makeSetup();
  const result = await post(IMPORT_URL, { ...importBody(setup, [record()]), universityId: MISSING_ID, force: true });
  assert.equal(result.status, 400);
  assert.deepEqual(result.json.errors.map((e) => e.field).sort(), ['force', 'universityId']);
});

test('a missing, empty or non-array subjects value is rejected with 400', async () => {
  const setup = await makeSetup();
  for (const subjects of [undefined, [], 'text', { 0: record() }, null]) {
    const body = { departmentId: setup.department._id, regulationId: setup.regulation._id };
    if (subjects !== undefined) body.subjects = subjects;
    const result = await post(IMPORT_URL, body);
    assert.equal(result.status, 400, JSON.stringify(subjects));
    assert.ok(result.json.errors.some((e) => e.field === 'subjects'));
  }
});

test('a request body that is not a JSON object is rejected', async () => {
  const result = await call(IMPORT_URL, { method: 'POST', rawBody: '[1,2,3]' });
  assert.equal(result.status, 400);
  const broken = await call(IMPORT_URL, { method: 'POST', rawBody: '{not json' });
  assert.equal(broken.status, 400);
  assert.equal(broken.json.success, false);
});

// ---------------------------------------------------------------- mixed records and partial failures

test('mixed valid, duplicate and invalid records: each one is reported exactly', async () => {
  const setup = await makeSetup();
  await makeSubject(setup.semesters[1]._id, { subjectCode: 'HAVE1', name: 'Have One' });
  const subjects = [
    record({ name: 'Good One', subjectCode: 'G1' }), // 0 new
    record({ name: 'Have One Again', subjectCode: 'HAVE1' }), // 1 duplicate
    record({ name: 'Bad Type', subjectCode: 'B1', subjectType: 'seminar' }), // 2 invalid
    record({ name: 'Good Two', subjectCode: 'G2', semesterNumber: 2 }), // 3 new
    record({ name: 'No Semester', subjectCode: 'N1', semesterNumber: 8 }), // 4 invalid
    { semesterNumber: 3, name: 'Good Uncoded', subjectType: 'internship', category: 'other' }, // 5 new
  ];

  const dry = (await runImport(setup, subjects)).json.data;
  assert.equal(dry.totalReceived, 6);
  assert.equal(dry.validRecords, 4);
  assert.equal(dry.newRecords, 3);
  assert.equal(dry.duplicates, 1);
  assert.equal(dry.invalidRecords, 2);
  assert.deepEqual(dry.results.map((r) => r.status), ['new', 'duplicate', 'invalid', 'new', 'invalid', 'new']);
  assert.deepEqual(dry.results.map((r) => r.index), [0, 1, 2, 3, 4, 5]);
  assert.equal(fakeDb.count(Subject), 1);

  const real = (await runImport(setup, subjects, { dryRun: false })).json.data;
  assert.equal(real.imported, 3);
  assert.equal(real.skipped, 1);
  assert.equal(real.failed, 2);
  assert.deepEqual(real.results.map((r) => r.status), ['imported', 'skipped', 'failed', 'imported', 'failed', 'imported']);
  assert.equal(fakeDb.count(Subject), 4);
  assert.deepEqual(subjectDocs().map((d) => d.name).sort(), ['Good One', 'Good Two', 'Good Uncoded', 'Have One'].sort());
});

test('a database failure on one record is reported for that record only; the others are still imported', async () => {
  const setup = await makeSetup();
  Subject.prototype.save = function failingSave(...args) {
    if (this.name === 'Will Fail') throw new Error('SECRET connection string mongodb://user:pass@host exploded');
    return fakeSave.apply(this, args);
  };

  const result = await runImport(setup, [record({ name: 'Before', subjectCode: 'B1' }), record({ name: 'Will Fail', subjectCode: 'F1' }), record({ name: 'After', subjectCode: 'A1' })], { dryRun: false });
  assert.equal(result.status, 200);
  const { data } = result.json;
  assert.deepEqual(data.results.map((r) => r.status), ['imported', 'failed', 'imported']);
  assert.equal(data.imported, 2);
  assert.equal(data.failed, 1);
  assert.deepEqual(subjectDocs().map((d) => d.name).sort(), ['After', 'Before']);

  const text = JSON.stringify(result.json);
  assert.ok(!text.includes('SECRET'), 'internal error text must not reach the client');
  assert.ok(!text.includes('mongodb://'));
  assert.ok(!/\bat .*\.js/.test(text), 'no stack trace');
  assert.equal(result.json.stack, undefined);
});

test('a duplicate-key error at insert time (a concurrent request won) is reported as skipped, not failed', async () => {
  const setup = await makeSetup();
  Subject.prototype.save = function racingSave() {
    const error = new Error('E11000 duplicate key error');
    error.code = 11000;
    throw error;
  };
  const { data } = (await runImport(setup, [record()], { dryRun: false })).json;
  assert.equal(data.results[0].status, 'skipped');
  assert.equal(data.imported, 0);
  assert.equal(data.skipped, 1);
  assert.equal(data.failed, 0);
});

test('a database validation error on save is reported with field errors', async () => {
  const setup = await makeSetup();
  Subject.prototype.save = function validationFailingSave() {
    const error = new mongoose.Error.ValidationError();
    error.addError('name', new mongoose.Error.ValidatorError({ message: 'Subject name is required', path: 'name' }));
    throw error;
  };
  const { data } = (await runImport(setup, [record()], { dryRun: false })).json;
  assert.equal(data.results[0].status, 'failed');
  assert.deepEqual(data.results[0].errors, [{ field: 'name', message: 'Subject name is required' }]);
});

// ---------------------------------------------------------------- limits

test('more than the maximum batch size is rejected with 400 and nothing is written or looked up', async () => {
  const setup = await makeSetup();
  const subjects = Array.from({ length: MAX_SUBJECTS_PER_IMPORT + 1 }, (_, i) => record({ name: `Subject ${i}`, subjectCode: `C${i}` }));
  const result = await runImport(setup, subjects, { dryRun: false });
  assert.equal(result.status, 400);
  assert.ok(result.json.errors.some((e) => e.field === 'subjects' && e.message.includes(String(MAX_SUBJECTS_PER_IMPORT))));
  assert.equal(fakeDb.count(Subject), 0);
});

test('exactly the maximum batch size is accepted', async () => {
  const setup = await makeSetup();
  const subjects = Array.from({ length: MAX_SUBJECTS_PER_IMPORT }, (_, i) => record({ name: `Subject ${i}`, subjectCode: `C${i}`, semesterNumber: (i % 3) + 1 }));
  const result = await runImport(setup, subjects, { dryRun: false });
  assert.equal(result.status, 200);
  assert.equal(result.json.data.imported, MAX_SUBJECTS_PER_IMPORT);
  assert.equal(fakeDb.count(Subject), MAX_SUBJECTS_PER_IMPORT);
});

test('an oversized request body is rejected with 413 before anything runs', async () => {
  const setup = await makeSetup();
  const result = await runImport(setup, [record({ name: 'x'.repeat(200 * 1024) })], { dryRun: false });
  assert.equal(result.status, 413);
  assert.equal(result.json.success, false);
  assert.equal(fakeDb.count(Subject), 0);
});

// ---------------------------------------------------------------- safety guarantees

test('existing records of every kind are never modified, deactivated or deleted by an import', async () => {
  const setup = await makeSetup();
  await makeSubject(setup.semesters[1]._id, { subjectCode: 'KEEP1' });
  await makeSubject(setup.semesters[2]._id, { subjectCode: 'KEEP2', name: 'Keep Two' });
  const parents = JSON.stringify(MODELS.slice(0, 4).map((Model) => fakeDb.rawDocs(Model)));
  const subjectsBefore = subjectDocs();

  await runImport(setup, [record({ subjectCode: 'KEEP1', name: 'Overwrite attempt' }), record({ subjectCode: 'NEW9', name: 'Brand New' })], { dryRun: false });

  assert.equal(JSON.stringify(MODELS.slice(0, 4).map((Model) => fakeDb.rawDocs(Model))), parents);
  subjectsBefore.forEach((before) => {
    const after = subjectDocs().find((d) => String(d._id) === String(before._id));
    assert.deepEqual(after, before);
  });
  assert.equal(subjectDocs().length, 3);
});

test('error responses carry no stack trace or secrets', async () => {
  const setup = await makeSetup();
  const results = await Promise.all([
    post(IMPORT_URL, { departmentId: 'bad', regulationId: 'bad', subjects: [] }),
    post(IMPORT_URL, { departmentId: MISSING_ID, regulationId: setup.regulation._id, subjects: [record()] }),
    call(IMPORT_URL, { method: 'POST', rawBody: '{broken' }),
  ]);
  results.forEach((result) => {
    assert.equal(result.json.success, false);
    assert.equal(result.json.stack, undefined);
    assert.ok(!JSON.stringify(result.json).includes(process.env.JWT_SECRET));
  });
});

test('the response has the documented shape', async () => {
  const setup = await makeSetup();
  const { json } = await runImport(setup, [record()], { dryRun: false });
  assert.equal(json.success, true);
  assert.equal(typeof json.message, 'string');
  assert.deepEqual(
    Object.keys(json.data).sort(),
    ['department', 'dryRun', 'duplicates', 'failed', 'imported', 'invalidRecords', 'newRecords', 'regulation', 'results', 'skipped', 'totalReceived', 'validRecords'].sort()
  );
  assert.deepEqual(Object.keys(json.data.results[0]).sort(), ['category', 'index', 'name', 'semesterNumber', 'status', 'subjectCode', 'subjectId', 'subjectType'].sort());
});

test('the existing subject API keeps working next to the import (no regression)', async () => {
  const setup = await makeSetup();
  const created = await post('/api/admin/subjects', { name: 'Manual', subjectType: 'theory', category: 'core', semester: setup.semesters[1]._id });
  assert.equal(created.status, 201);
  const duplicate = await post('/api/admin/subjects', { name: 'Manual 2', subjectCode: 'M1', subjectType: 'theory', category: 'core', semester: setup.semesters[1]._id });
  assert.equal(duplicate.status, 201);
  const again = await post('/api/admin/subjects', { name: 'Manual 3', subjectCode: 'M1', subjectType: 'theory', category: 'core', semester: setup.semesters[1]._id });
  assert.equal(again.status, 409);
});

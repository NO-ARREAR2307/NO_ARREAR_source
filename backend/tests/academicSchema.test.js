'use strict';

// Phase 1C: UG/PG departments, regulations, semester-to-regulation links, subject type/category, optional
// subject codes, academic API filters, authorization, API compatibility and records saved before Phase 1C.
// No database or internet is needed: the five academic models run against an in-memory stand-in that
// keeps their real validation and unique indexes (tests/helpers/fakeAcademicDb.js), and the User lookup
// used by the JWT middleware is replaced. Express, JWT, role middleware, validators, services and the
// error handler are the real code.

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'unit-test-secret-unit-test-secret-1234567890';
process.env.MONGO_URI = 'mongodb://localhost:27017/studywise_ai_test';
process.env.RATE_LIMIT_MAX = '100000';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const User = require('../models/User');
const { University, Department, Regulation, Semester, Subject } = require('../models');
const { SUBJECT_TYPES, SUBJECT_CATEGORIES } = require('../utils/academicEnums');
const generateToken = require('../utils/generateToken');
const fakeDb = require('./helpers/fakeAcademicDb');
const app = require('../app');

fakeDb.install();

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
test.beforeEach(() => fakeDb.reset());

const call = async (path, { method = 'GET', token = adminToken, body, rawBody } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const payload = rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined;
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: payload });
  return { status: response.status, json: await response.json() };
};

// Small builders (no records exist until a test creates them).
const post = (path, body, token) => call(path, { method: 'POST', body, token });
const put = (path, body, token) => call(path, { method: 'PUT', body, token });
const del = (path, token) => call(path, { method: 'DELETE', token });

const student = (path, options = {}) => call(path, { token: studentToken, ...options });
const MODELS = [University, Department, Regulation, Semester, Subject];

const makeUniversity = async (over = {}) => (await post('/api/admin/universities', { name: 'University of Madras', code: 'UNOM', ...over })).json.data.university;
const makeDepartment = async (university, over = {}) =>
  (await post('/api/admin/departments', { name: 'Computer Science', code: 'CS', university, level: 'UG', ...over })).json.data.department;
const makeRegulation = async (department, over = {}) =>
  (await post('/api/admin/regulations', { name: '2023-2024', department, ...over })).json.data.regulation;
const makeSemester = async (regulation, over = {}) =>
  (await post('/api/admin/semesters', { semesterNumber: 1, regulation, ...over })).json.data.semester;
const subjectBody = (semester, over = {}) => ({ name: 'Data Structures', subjectCode: 'CS101', subjectType: 'theory', category: 'core', semester, ...over });
const makeSubject = async (semester, over = {}) => (await post('/api/admin/subjects', subjectBody(semester, over))).json.data.subject;

const fieldsOf = (result) => result.json.errors.map((e) => e.field).sort();

// ---------------------------------------------------------------- UG and PG departments

test('UG and PG departments can both be created, and level is normalised', async () => {
  const university = await makeUniversity();
  const ug = await post('/api/admin/departments', { name: 'B.Sc Computer Science', code: 'BSCCS', university: university._id, level: 'UG' });
  const pg = await post('/api/admin/departments', { name: 'M.Sc Computer Science', code: 'MSCCS', university: university._id, level: 'pg' });
  assert.equal(ug.status, 201);
  assert.equal(pg.status, 201);
  assert.equal(ug.json.data.department.level, 'UG');
  assert.equal(pg.json.data.department.level, 'PG');
  assert.equal(pg.json.message, 'Department created successfully');
});

test('a department needs a valid level; anything other than UG or PG is a 400', async () => {
  const university = await makeUniversity();
  const missing = await post('/api/admin/departments', { name: 'X', code: 'X', university: university._id });
  assert.equal(missing.status, 400);
  assert.deepEqual(fieldsOf(missing), ['level']);
  for (const level of ['PhD', 'diploma', '', 3, null, { $ne: null }, ['UG']]) {
    const result = await post('/api/admin/departments', { name: 'X', code: 'X', university: university._id, level });
    assert.equal(result.status, 400, JSON.stringify(level));
    assert.deepEqual(fieldsOf(result), ['level']);
  }
  assert.equal(fakeDb.count(Department), 0);
});

test('a department level can be changed by an update, and an invalid one is refused', async () => {
  const university = await makeUniversity();
  const department = await makeDepartment(university._id);
  assert.equal((await put(`/api/admin/departments/${department._id}`, { level: 'PG' })).json.data.department.level, 'PG');
  assert.equal((await put(`/api/admin/departments/${department._id}`, { level: 'XX' })).status, 400);
  assert.equal((await call(`/api/admin/departments/${department._id}`)).json.data.department.level, 'PG');
});

test('the same department code stays unique per university regardless of level', async () => {
  const university = await makeUniversity();
  await makeDepartment(university._id, { code: 'CS', level: 'UG' });
  assert.equal((await post('/api/admin/departments', { name: 'MSc CS', code: 'cs', university: university._id, level: 'PG' })).status, 409);
});

// ---------------------------------------------------------------- regulations

test('a regulation is created under a department and reads back with its reference', async () => {
  const university = await makeUniversity();
  const department = await makeDepartment(university._id);
  const created = await post('/api/admin/regulations', { name: '  2023-2024 ', department: department._id });
  assert.equal(created.status, 201);
  assert.equal(created.json.success, true);
  assert.equal(created.json.message, 'Regulation created successfully');
  const regulation = created.json.data.regulation;
  assert.equal(regulation.name, '2023-2024');
  assert.equal(regulation.department, department._id);
  assert.equal(regulation.isActive, true);
  assert.ok(regulation.createdAt && regulation.updatedAt);
  assert.equal((await call(`/api/admin/regulations/${regulation._id}`)).json.data.regulation._id, regulation._id);
});

test('a duplicate regulation name in the same department is refused (409); other departments may reuse it', async () => {
  const university = await makeUniversity();
  const cs = await makeDepartment(university._id);
  const maths = await makeDepartment(university._id, { name: 'Mathematics', code: 'MA' });
  await makeRegulation(cs._id, { name: '2023-2024' });

  const duplicate = await post('/api/admin/regulations', { name: '2023-2024', department: cs._id });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.json.message, 'A regulation with this name already exists in this department');
  assert.equal((await post('/api/admin/regulations', { name: ' 2023-2024 ', department: cs._id })).status, 409, 'spaces do not make a new name');
  assert.equal((await post('/api/admin/regulations', { name: '2023-2024', department: maths._id })).status, 201);
  assert.equal((await post('/api/admin/regulations', { name: '2024-2025', department: cs._id })).status, 201);
  assert.equal(fakeDb.count(Regulation), 3);
});

test('regulation references are validated: missing, malformed, wrong-level and inactive parents', async () => {
  const university = await makeUniversity();
  const department = await makeDepartment(university._id);
  const missing = await post('/api/admin/regulations', { name: 'R', department: MISSING_ID });
  assert.equal(missing.status, 400);
  assert.deepEqual(missing.json.errors, [{ field: 'department', message: 'Department not found' }]);
  assert.equal((await post('/api/admin/regulations', { name: 'R', department: 'nope' })).status, 400);
  assert.equal((await post('/api/admin/regulations', { name: 'R', department: university._id })).status, 400, 'a university id is not a department');

  await del(`/api/admin/departments/${department._id}`);
  const inactive = await post('/api/admin/regulations', { name: 'R', department: department._id });
  assert.equal(inactive.status, 409);
  assert.match(inactive.json.message, /inactive/i);
  assert.equal(fakeDb.count(Regulation), 0);
});

test('regulation list: paginated, filterable by department and isActive, sorted by name', async () => {
  const university = await makeUniversity();
  const cs = await makeDepartment(university._id);
  const maths = await makeDepartment(university._id, { name: 'Mathematics', code: 'MA' });
  await makeRegulation(cs._id, { name: 'R2024' });
  const r2021 = await makeRegulation(cs._id, { name: 'R2021' });
  await makeRegulation(maths._id, { name: 'R2022' });

  const byDepartment = await call(`/api/admin/regulations?department=${cs._id}`);
  assert.deepEqual(byDepartment.json.data.regulations.map((r) => r.name), ['R2021', 'R2024']);
  assert.deepEqual(byDepartment.json.meta, { page: 1, limit: 20, total: 2, totalPages: 1 });
  assert.equal((await call('/api/admin/regulations')).json.meta.total, 3);
  assert.equal((await call(`/api/admin/regulations?department=${cs._id}&limit=1&page=2`)).json.data.regulations[0].name, 'R2024');

  await del(`/api/admin/regulations/${r2021._id}`);
  assert.equal((await call(`/api/admin/regulations?department=${cs._id}&isActive=false`)).json.data.regulations.length, 1);
  assert.equal((await call(`/api/admin/regulations?department=${cs._id}&isActive=true`)).json.data.regulations.length, 1);
  assert.equal((await call(`/api/admin/regulations?department=${MISSING_ID}`)).json.data.regulations.length, 0);
  assert.equal((await call('/api/admin/regulations?department=abc')).status, 400);
  assert.equal((await call('/api/admin/regulations?isActive=maybe')).status, 400);
});

test('a regulation with active semesters cannot be deactivated; a department with active regulations cannot either', async () => {
  const university = await makeUniversity();
  const department = await makeDepartment(university._id);
  const regulation = await makeRegulation(department._id);
  const semester = await makeSemester(regulation._id);

  const blockedDepartment = await del(`/api/admin/departments/${department._id}`);
  assert.equal(blockedDepartment.status, 409);
  assert.match(blockedDepartment.json.message, /1 active regulation/);
  const blockedRegulation = await del(`/api/admin/regulations/${regulation._id}`);
  assert.equal(blockedRegulation.status, 409);
  assert.match(blockedRegulation.json.message, /1 active semester/);

  await del(`/api/admin/semesters/${semester._id}`);
  assert.equal((await del(`/api/admin/regulations/${regulation._id}`)).status, 200);
  assert.equal(fakeDb.count(Regulation), 1, 'deactivated, not removed');
  assert.equal((await del(`/api/admin/departments/${department._id}`)).status, 200);
});

// ---------------------------------------------------------------- semester -> regulation

test('semesters belong to a regulation: unique number per regulation, reusable across regulations', async () => {
  const university = await makeUniversity();
  const department = await makeDepartment(university._id);
  const r1 = await makeRegulation(department._id, { name: 'R1' });
  const r2 = await makeRegulation(department._id, { name: 'R2' });

  const created = await post('/api/admin/semesters', { semesterNumber: 1, regulation: r1._id });
  assert.equal(created.status, 201);
  assert.equal(created.json.data.semester.regulation, r1._id);
  assert.equal(created.json.data.semester.department, undefined);

  const duplicate = await post('/api/admin/semesters', { semesterNumber: 1, regulation: r1._id });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.json.message, 'This semester number already exists in this regulation');
  assert.equal((await post('/api/admin/semesters', { semesterNumber: 1, regulation: r2._id })).status, 201);
  for (const semesterNumber of [2, 3, 4, 5, 6, 7, 8]) assert.equal((await post('/api/admin/semesters', { semesterNumber, regulation: r1._id })).status, 201);
  assert.equal((await post('/api/admin/semesters', { semesterNumber: 9, regulation: r1._id })).status, 400);
});

test('semester references are validated: the old department reference is refused and the regulation must exist and be active', async () => {
  const university = await makeUniversity();
  const department = await makeDepartment(university._id);
  const regulation = await makeRegulation(department._id);

  const old = await post('/api/admin/semesters', { semesterNumber: 1, department: department._id });
  assert.equal(old.status, 400);
  assert.deepEqual(fieldsOf(old), ['department', 'regulation']);
  const missing = await post('/api/admin/semesters', { semesterNumber: 1, regulation: MISSING_ID });
  assert.deepEqual(missing.json.errors, [{ field: 'regulation', message: 'Regulation not found' }]);
  assert.equal((await post('/api/admin/semesters', { semesterNumber: 1, regulation: department._id })).status, 400);

  await del(`/api/admin/regulations/${regulation._id}`);
  assert.equal((await post('/api/admin/semesters', { semesterNumber: 1, regulation: regulation._id })).status, 409);
  assert.equal(fakeDb.count(Semester), 0);
});

test('semester list filters: regulation, semesterNumber, isActive, and the old department filter', async () => {
  const university = await makeUniversity();
  const cs = await makeDepartment(university._id);
  const maths = await makeDepartment(university._id, { name: 'Mathematics', code: 'MA' });
  const csR1 = await makeRegulation(cs._id, { name: 'R1' });
  const csR2 = await makeRegulation(cs._id, { name: 'R2' });
  const mathsR1 = await makeRegulation(maths._id, { name: 'R1' });
  await makeSemester(csR1._id, { semesterNumber: 1 });
  await makeSemester(csR1._id, { semesterNumber: 2 });
  await makeSemester(csR2._id, { semesterNumber: 1 });
  await makeSemester(mathsR1._id, { semesterNumber: 1 });

  const count = async (query) => (await call(`/api/admin/semesters?${query}`)).json.data.semesters.length;
  assert.equal(await count(`regulation=${csR1._id}`), 2);
  assert.equal(await count(`regulation=${csR2._id}`), 1);
  assert.equal(await count(`regulation=${csR1._id}&semesterNumber=2`), 1);
  assert.equal(await count(`semesterNumber=1`), 3);
  assert.equal(await count(`department=${cs._id}`), 3, 'old filter: every regulation of the department');
  assert.equal(await count(`department=${maths._id}`), 1);
  assert.equal(await count(`department=${cs._id}&regulation=${csR2._id}`), 1);
  assert.equal(await count(`department=${cs._id}&regulation=${mathsR1._id}`), 0, 'a regulation of another department matches nothing');
  assert.equal(await count(`department=${MISSING_ID}`), 0);
  assert.equal(await count('isActive=true'), 4);
  assert.equal((await call(`/api/admin/semesters?department=${cs._id}`)).json.meta.total, 3);
  for (const query of ['regulation=abc', 'department=abc', 'semesterNumber=9', 'semesterNumber=x']) {
    assert.equal((await call(`/api/admin/semesters?${query}`)).status, 400, query);
  }
});

// ---------------------------------------------------------------- subject type, category, code

const subjectSetup = async () => {
  const university = await makeUniversity();
  const department = await makeDepartment(university._id);
  const regulation = await makeRegulation(department._id);
  const semester = await makeSemester(regulation._id);
  return { university, department, regulation, semester };
};

test('every subject type and category is accepted and stored normalised', async () => {
  const { semester } = await subjectSetup();
  let n = 0;
  for (const subjectType of SUBJECT_TYPES) {
    n += 1;
    const result = await post('/api/admin/subjects', subjectBody(semester._id, { subjectCode: `T${n}`, subjectType: subjectType.toUpperCase() }));
    assert.equal(result.status, 201, subjectType);
    assert.equal(result.json.data.subject.subjectType, subjectType);
  }
  for (const category of SUBJECT_CATEGORIES) {
    n += 1;
    const result = await post('/api/admin/subjects', subjectBody(semester._id, { subjectCode: `C${n}`, category: ` ${category} ` }));
    assert.equal(result.status, 201, category);
    assert.equal(result.json.data.subject.category, category);
  }
});

test('an invalid or missing subject type or category is a 400 with per-field errors', async () => {
  const { semester } = await subjectSetup();
  const noType = await post('/api/admin/subjects', { name: 'X', category: 'core', semester: semester._id });
  assert.deepEqual(fieldsOf(noType), ['subjectType']);
  const noCategory = await post('/api/admin/subjects', { name: 'X', subjectType: 'theory', semester: semester._id });
  assert.deepEqual(fieldsOf(noCategory), ['category']);
  for (const bad of ['lab', '', 5, null, { $ne: null }, ['theory']]) {
    const type = await post('/api/admin/subjects', subjectBody(semester._id, { subjectType: bad }));
    assert.equal(type.status, 400, `type ${JSON.stringify(bad)}`);
    assert.deepEqual(fieldsOf(type), ['subjectType']);
    const category = await post('/api/admin/subjects', subjectBody(semester._id, { category: bad }));
    assert.equal(category.status, 400, `category ${JSON.stringify(bad)}`);
    assert.deepEqual(fieldsOf(category), ['category']);
  }
  assert.match((await post('/api/admin/subjects', subjectBody(semester._id, { subjectType: 'lab' }))).json.errors[0].message, /theory, practical, project, internship/);
  assert.equal(fakeDb.count(Subject), 0);
});

test('a subject code is optional: omitted, null and blank codes all create a subject with no code', async () => {
  const { semester } = await subjectSetup();
  const omitted = await post('/api/admin/subjects', { name: 'Environmental Studies', subjectType: 'theory', category: 'ability_enhancement', semester: semester._id });
  assert.equal(omitted.status, 201);
  assert.equal(omitted.json.data.subject.subjectCode, undefined);
  for (const [index, subjectCode] of [null, '', '   '].entries()) {
    const result = await post('/api/admin/subjects', subjectBody(semester._id, { name: `No code ${index}`, subjectCode }));
    assert.equal(result.status, 201, JSON.stringify(subjectCode));
    assert.equal(result.json.data.subject.subjectCode, undefined);
  }
  assert.equal(fakeDb.count(Subject), 4, 'any number of code-less subjects may share a semester');
  assert.equal((await post('/api/admin/subjects', subjectBody(semester._id, { subjectCode: 'C'.repeat(21) }))).status, 400);
});

test('subject codes stay unique per semester when present (case-insensitive) and may repeat across semesters', async () => {
  const { regulation, semester } = await subjectSetup();
  const other = await makeSemester(regulation._id, { semesterNumber: 2 });
  await makeSubject(semester._id, { subjectCode: 'cs101' });
  const duplicate = await post('/api/admin/subjects', subjectBody(semester._id, { name: 'Clone', subjectCode: 'CS101' }));
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.json.message, 'A subject with this code already exists in this semester');
  assert.equal((await post('/api/admin/subjects', subjectBody(other._id, { subjectCode: 'CS101' }))).status, 201);
});

test('a subject code can be added later or cleared; clearing never collides with other code-less subjects', async () => {
  const { semester } = await subjectSetup();
  const withCode = await makeSubject(semester._id, { subjectCode: 'CS101' });
  const noCode = await makeSubject(semester._id, { name: 'Soft Skills', subjectCode: undefined });
  assert.equal(noCode.subjectCode, undefined);

  const added = await put(`/api/admin/subjects/${noCode._id}`, { subjectCode: ' sk1 ' });
  assert.equal(added.json.data.subject.subjectCode, 'SK1');
  assert.equal((await put(`/api/admin/subjects/${noCode._id}`, { subjectCode: 'cs101' })).status, 409);
  const cleared = await put(`/api/admin/subjects/${withCode._id}`, { subjectCode: null });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.json.data.subject.subjectCode, undefined);
  const clearedAgain = await put(`/api/admin/subjects/${noCode._id}`, { subjectCode: '' });
  assert.equal(clearedAgain.status, 200, 'two subjects without a code are fine');
});

test('subject type and category can be changed, and an invalid change is refused', async () => {
  const { semester } = await subjectSetup();
  const subject = await makeSubject(semester._id);
  const changed = await put(`/api/admin/subjects/${subject._id}`, { subjectType: 'practical', category: 'skill_enhancement' });
  assert.deepEqual([changed.json.data.subject.subjectType, changed.json.data.subject.category], ['practical', 'skill_enhancement']);
  assert.equal((await put(`/api/admin/subjects/${subject._id}`, { subjectType: 'nope' })).status, 400);
  assert.equal((await call(`/api/admin/subjects/${subject._id}`)).json.data.subject.subjectType, 'practical');
});

// ---------------------------------------------------------------- admin filters

test('admin department filters: university and level (and isActive) combine', async () => {
  const madras = await makeUniversity();
  const anna = await makeUniversity({ name: 'Anna', code: 'AU' });
  await makeDepartment(madras._id, { name: 'BSc CS', code: 'BCS', level: 'UG' });
  await makeDepartment(madras._id, { name: 'MSc CS', code: 'MCS', level: 'PG' });
  const retired = await makeDepartment(madras._id, { name: 'BA Eco', code: 'BEC', level: 'UG' });
  await makeDepartment(anna._id, { name: 'MSc Maths', code: 'MMA', level: 'PG' });
  await del(`/api/admin/departments/${retired._id}`);

  const names = async (query) => (await call(`/api/admin/departments?${query}`)).json.data.departments.map((d) => d.code).sort();
  assert.deepEqual(await names(`university=${madras._id}&level=UG`), ['BCS', 'BEC']);
  assert.deepEqual(await names(`university=${madras._id}&level=pg`), ['MCS']);
  assert.deepEqual(await names('level=PG'), ['MCS', 'MMA']);
  assert.deepEqual(await names(`university=${madras._id}&level=UG&isActive=true`), ['BCS']);
  assert.equal((await call('/api/admin/departments?level=PhD')).status, 400);
  assert.equal((await call('/api/admin/departments?level=UG&level=PG')).status, 400);
});

test('admin subject filters: semester, subjectType and category combine', async () => {
  const { regulation, semester } = await subjectSetup();
  const other = await makeSemester(regulation._id, { semesterNumber: 2 });
  await makeSubject(semester._id, { name: 'A', subjectCode: 'A1', subjectType: 'theory', category: 'core' });
  await makeSubject(semester._id, { name: 'B', subjectCode: 'B1', subjectType: 'practical', category: 'core' });
  await makeSubject(semester._id, { name: 'C', subjectCode: undefined, subjectType: 'theory', category: 'elective' });
  await makeSubject(other._id, { name: 'D', subjectCode: 'D1', subjectType: 'theory', category: 'core' });

  const names = async (query) => (await call(`/api/admin/subjects?${query}`)).json.data.subjects.map((s) => s.name).sort();
  assert.deepEqual(await names(`semester=${semester._id}`), ['A', 'B', 'C']);
  assert.deepEqual(await names(`semester=${semester._id}&subjectType=theory`), ['A', 'C']);
  assert.deepEqual(await names(`semester=${semester._id}&category=core`), ['A', 'B']);
  assert.deepEqual(await names(`semester=${semester._id}&subjectType=theory&category=core`), ['A']);
  assert.deepEqual(await names('subjectType=THEORY'), ['A', 'C', 'D']);
  assert.deepEqual(await names('category=elective'), ['C']);
  assert.deepEqual(await names('category=allied'), []);
  for (const query of ['subjectType=lab', 'category=zzz', 'semester=abc']) assert.equal((await call(`/api/admin/subjects?${query}`)).status, 400, query);
});

test('admin subject list orders by code (code-less first) then name, deterministically', async () => {
  const { semester } = await subjectSetup();
  await makeSubject(semester._id, { name: 'Zeta', subjectCode: 'B2' });
  await makeSubject(semester._id, { name: 'Beta', subjectCode: undefined });
  await makeSubject(semester._id, { name: 'Alpha', subjectCode: undefined });
  await makeSubject(semester._id, { name: 'Gamma', subjectCode: 'A1' });
  const result = await call(`/api/admin/subjects?semester=${semester._id}`);
  assert.deepEqual(result.json.data.subjects.map((s) => s.name), ['Alpha', 'Beta', 'Gamma', 'Zeta']);
});

// ---------------------------------------------------------------- authorization

test('regulations: 401 without a token, 403 for students on every method, nothing written', async () => {
  const { department, regulation } = await subjectSetup();
  const before = MODELS.map(fakeDb.count);
  const base = '/api/admin/regulations';
  const noToken = await Promise.all([
    call(base, { token: null }),
    call(base, { method: 'POST', token: null, body: {} }),
    call(`${base}/${regulation._id}`, { token: null }),
    call(`${base}/${regulation._id}`, { method: 'PUT', token: null, body: {} }),
    call(`${base}/${regulation._id}`, { method: 'DELETE', token: null }),
  ]);
  noToken.forEach((result) => assert.equal(result.status, 401));
  const asStudent = await Promise.all([
    student(base),
    student(`${base}?department=${department._id}`),
    student(base, { method: 'POST', body: { name: 'Hack', department: department._id } }),
    student(`${base}/${regulation._id}`),
    student(`${base}/${regulation._id}`, { method: 'PUT', body: { isActive: false } }),
    student(`${base}/${regulation._id}`, { method: 'DELETE' }),
  ]);
  asStudent.forEach((result) => {
    assert.equal(result.status, 403);
    assert.equal(result.json.success, false);
  });
  assert.deepEqual(MODELS.map(fakeDb.count), before);
  assert.equal(fakeDb.rawDocs(Regulation)[0].isActive, true);
});

test('the new admin filters are admin-only too: students get 403 even with a valid filter', async () => {
  const { department, regulation, semester } = await subjectSetup();
  for (const path of [
    `/api/admin/departments?level=UG`,
    `/api/admin/regulations?department=${department._id}`,
    `/api/admin/semesters?regulation=${regulation._id}`,
    `/api/admin/subjects?semester=${semester._id}&subjectType=theory&category=core`,
  ]) {
    assert.equal((await student(path)).status, 403, path);
    assert.equal((await call(path)).status, 200, path);
  }
});

// ---------------------------------------------------------------- student APIs

const studentTree = async () => {
  const madras = await makeUniversity();
  const ugCs = await makeDepartment(madras._id, { name: 'BSc Computer Science', code: 'BCS', level: 'UG' });
  const pgCs = await makeDepartment(madras._id, { name: 'MSc Computer Science', code: 'MCS', level: 'PG' });
  const r2021 = await makeRegulation(ugCs._id, { name: '2021-2022' });
  const r2023 = await makeRegulation(ugCs._id, { name: '2023-2024' });
  const pgReg = await makeRegulation(pgCs._id, { name: '2023-2024' });
  const sem1 = await makeSemester(r2023._id, { semesterNumber: 1 });
  const sem2 = await makeSemester(r2023._id, { semesterNumber: 2 });
  const oldSem1 = await makeSemester(r2021._id, { semesterNumber: 1 });
  await makeSemester(pgReg._id, { semesterNumber: 1 });
  const ds = await makeSubject(sem1._id, { name: 'Data Structures', subjectCode: 'CS101', subjectType: 'theory', category: 'core' });
  const lab = await makeSubject(sem1._id, { name: 'Programming Lab', subjectCode: 'CS1P', subjectType: 'practical', category: 'core' });
  const evs = await makeSubject(sem1._id, { name: 'Environmental Studies', subjectCode: undefined, subjectType: 'theory', category: 'ability_enhancement' });
  return { madras, ugCs, pgCs, r2021, r2023, pgReg, sem1, sem2, oldSem1, ds, lab, evs };
};

test('student departments: level and university are returned, ?level= filters, invalid level is 400', async () => {
  const { madras, ugCs, pgCs } = await studentTree();
  const all = await student(`/api/academic/universities/${madras._id}/departments`);
  assert.deepEqual(all.json.data.departments.map((d) => [d.code, d.level]), [['BCS', 'UG'], ['MCS', 'PG']]);
  assert.equal(all.json.meta.total, 2);

  const ug = await student(`/api/academic/universities/${madras._id}/departments?level=UG`);
  assert.deepEqual(ug.json.data.departments.map((d) => d._id), [ugCs._id]);
  const pg = await student(`/api/academic/universities/${madras._id}/departments?level=pg`);
  assert.deepEqual(pg.json.data.departments.map((d) => d._id), [pgCs._id]);
  assert.equal((await student(`/api/academic/universities/${madras._id}/departments?level=PhD`)).status, 400);
  assert.equal((await student(`/api/academic/universities/${madras._id}/departments?level=UG&level=PG`)).status, 400);
});

test('student regulations: listed per department, sorted by name, public fields only, inactive hidden', async () => {
  const { ugCs, pgCs, r2021, r2023 } = await studentTree();
  const result = await student(`/api/academic/departments/${ugCs._id}/regulations`);
  assert.equal(result.status, 200);
  assert.equal(result.json.message, 'Regulations retrieved successfully');
  assert.deepEqual(result.json.data.regulations.map((r) => r._id), [r2021._id, r2023._id]);
  result.json.data.regulations.forEach((r) => assert.deepEqual(Object.keys(r).sort(), ['_id', 'department', 'name']));
  assert.equal(result.json.meta.total, 2);
  assert.equal((await student(`/api/academic/departments/${pgCs._id}/regulations`)).json.data.regulations.length, 1);

  // Deactivate bottom-up through the admin API; the regulation then disappears for students.
  const emptyRegulation = await makeRegulation(pgCs._id, { name: 'R-empty' });
  await del(`/api/admin/regulations/${emptyRegulation._id}`);
  assert.equal((await student(`/api/academic/departments/${pgCs._id}/regulations`)).json.data.regulations.length, 1);
  assert.equal((await student(`/api/academic/regulations/${emptyRegulation._id}/semesters`)).status, 404);
});

test('student semesters by regulation: only that regulation, sorted, with regulation and department references', async () => {
  const { ugCs, r2021, r2023, sem1, sem2, oldSem1 } = await studentTree();
  const result = await student(`/api/academic/regulations/${r2023._id}/semesters`);
  assert.equal(result.status, 200);
  assert.deepEqual(result.json.data.semesters.map((s) => s._id), [sem1._id, sem2._id]);
  result.json.data.semesters.forEach((s) => {
    assert.deepEqual(Object.keys(s).sort(), ['_id', 'department', 'regulation', 'semesterNumber']);
    assert.equal(s.regulation, r2023._id);
    assert.equal(s.department, ugCs._id);
  });
  assert.deepEqual((await student(`/api/academic/regulations/${r2021._id}/semesters`)).json.data.semesters.map((s) => s._id), [oldSem1._id]);
});

test('student semesters by department (existing route): all active regulations, optional ?regulation= filter', async () => {
  const { ugCs, pgCs, r2021, r2023, pgReg, sem1, sem2, oldSem1 } = await studentTree();
  const all = await student(`/api/academic/departments/${ugCs._id}/semesters`);
  assert.equal(all.status, 200);
  assert.equal(all.json.message, 'Semesters retrieved successfully');
  assert.deepEqual(all.json.data.semesters.map((s) => s._id).sort(), [sem1._id, sem2._id, oldSem1._id].sort());
  assert.equal(all.json.meta.total, 3);

  const one = await student(`/api/academic/departments/${ugCs._id}/semesters?regulation=${r2023._id}`);
  assert.deepEqual(one.json.data.semesters.map((s) => s._id), [sem1._id, sem2._id]);
  assert.equal((await student(`/api/academic/departments/${ugCs._id}/semesters?regulation=${pgReg._id}`)).status, 404, 'another department\'s regulation');
  assert.equal((await student(`/api/academic/departments/${ugCs._id}/semesters?regulation=${MISSING_ID}`)).status, 404);
  assert.equal((await student(`/api/academic/departments/${ugCs._id}/semesters?regulation=abc`)).status, 400);

  await del(`/api/admin/semesters/${oldSem1._id}`);
  await del(`/api/admin/regulations/${r2021._id}`);
  assert.equal((await student(`/api/academic/departments/${ugCs._id}/semesters?regulation=${r2021._id}`)).status, 404, 'inactive regulation');
  assert.equal((await student(`/api/academic/departments/${pgCs._id}/semesters`)).json.data.semesters.length, 1);
});

test('student subjects: type and category are returned, code is absent when there is none, filters work', async () => {
  const { sem1, ds, lab, evs } = await studentTree();
  const all = await student(`/api/academic/semesters/${sem1._id}/subjects`);
  assert.deepEqual(all.json.data.subjects.map((s) => s.name), ['Data Structures', 'Environmental Studies', 'Programming Lab']);
  assert.deepEqual(Object.keys(all.json.data.subjects[0]).sort(), ['_id', 'category', 'name', 'semester', 'subjectCode', 'subjectType']);
  const noCode = all.json.data.subjects.find((s) => s._id === evs._id);
  assert.deepEqual(Object.keys(noCode).sort(), ['_id', 'category', 'name', 'semester', 'subjectType']);
  assert.equal(noCode.category, 'ability_enhancement');

  const ids = async (query) => (await student(`/api/academic/semesters/${sem1._id}/subjects?${query}`)).json.data.subjects.map((s) => s._id).sort();
  assert.deepEqual(await ids('subjectType=practical'), [lab._id]);
  assert.deepEqual(await ids('subjectType=theory'), [ds._id, evs._id].sort());
  assert.deepEqual(await ids('category=core'), [ds._id, lab._id].sort());
  assert.deepEqual(await ids('subjectType=theory&category=core'), [ds._id]);
  assert.deepEqual(await ids('category=elective'), []);
  assert.equal((await student(`/api/academic/semesters/${sem1._id}/subjects?subjectType=lab`)).status, 400);
  assert.equal((await student(`/api/academic/semesters/${sem1._id}/subjects?category=zzz`)).status, 400);
});

test('student subjects are hidden beneath an inactive regulation even if everything below is still active', async () => {
  const university = await new University({ name: 'U', code: 'U' }).save();
  const department = await new Department({ name: 'D', code: 'D', university: university._id, level: 'UG' }).save();
  const regulation = await new Regulation({ name: 'R', department: department._id, isActive: false }).save();
  const semester = await new Semester({ semesterNumber: 1, regulation: regulation._id }).save();
  await new Subject({ name: 'S', subjectType: 'theory', category: 'core', semester: semester._id }).save();

  assert.equal((await student(`/api/academic/semesters/${semester._id}/subjects`)).status, 404);
  assert.equal((await student(`/api/academic/regulations/${regulation._id}/semesters`)).status, 404);
  assert.deepEqual((await student(`/api/academic/departments/${department._id}/semesters`)).json.data.semesters, []);
});

test('students still cannot write: 405 on the new academic routes, nothing changes', async () => {
  const { ugCs, r2023 } = await studentTree();
  const snapshot = JSON.stringify(MODELS.map(fakeDb.rawDocs));
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const path of [`/api/academic/departments/${ugCs._id}/regulations`, `/api/academic/regulations/${r2023._id}/semesters`]) {
      const result = await student(path, { method, body: { name: 'Hack' } });
      assert.equal(result.status, 405, `${method} ${path}`);
    }
  }
  assert.equal(JSON.stringify(MODELS.map(fakeDb.rawDocs)), snapshot);
});

// ---------------------------------------------------------------- existing API compatibility

test('response conventions are unchanged: envelope, single-record keys, list keys and pagination meta', async () => {
  const { ugCs, r2023, sem1, ds } = await studentTree();

  const single = await call(`/api/admin/departments/${ugCs._id}`);
  assert.deepEqual(Object.keys(single.json).sort(), ['data', 'message', 'success']);
  assert.equal(single.json.message, 'Department retrieved successfully');
  assert.deepEqual(Object.keys(single.json.data), ['department']);

  const list = await call('/api/admin/subjects');
  assert.deepEqual(Object.keys(list.json).sort(), ['data', 'message', 'meta', 'success']);
  assert.equal(list.json.message, 'Subject list retrieved successfully');
  assert.deepEqual(Object.keys(list.json.data), ['subjects']);
  assert.deepEqual(Object.keys(list.json.meta).sort(), ['limit', 'page', 'total', 'totalPages']);
  assert.equal((await call(`/api/admin/regulations/${r2023._id}`)).json.message, 'Regulation retrieved successfully');
  assert.equal((await call('/api/admin/regulations')).json.message, 'Regulation list retrieved successfully');

  const created = await post('/api/admin/subjects', subjectBody(sem1._id, { name: 'New', subjectCode: 'NEW1' }));
  assert.equal(created.status, 201);
  assert.equal(created.json.message, 'Subject created successfully');
  assert.equal((await put(`/api/admin/subjects/${ds._id}`, { name: 'Renamed' })).json.message, 'Subject updated successfully');
  assert.equal((await del(`/api/admin/subjects/${ds._id}`)).json.message, 'Subject deactivated successfully');
  assert.equal((await del(`/api/admin/subjects/${ds._id}`)).json.message, 'Subject was already deactivated');

  const universities = await student('/api/academic/universities');
  assert.deepEqual(Object.keys(universities.json).sort(), ['data', 'message', 'meta', 'success']);
  assert.deepEqual(Object.keys(universities.json.meta), ['total']);
  const error = await call(`/api/admin/regulations/${MISSING_ID}`);
  assert.equal(error.status, 404);
  assert.deepEqual(Object.keys(error.json).sort(), ['message', 'success']);
  assert.equal(error.json.message, 'Regulation not found');
});

test('the University API and the portal link are untouched by the new hierarchy', async () => {
  const university = await makeUniversity();
  assert.deepEqual(Object.keys(university).sort(), ['_id', 'code', 'createdAt', 'isActive', 'name', 'updatedAt']);
  const portal = await student('/api/academic/official-question-paper-portal');
  assert.equal(portal.status, 200);
  assert.equal(portal.json.data.portal.url, 'https://egovernance.unom.ac.in/qpregular/FrmStudDownloadQP.ASPX?IDE_REG=REG');
});

test('there is no College model or college field anywhere in the academic schema', async () => {
  const mongoose = require('mongoose');
  assert.equal(mongoose.modelNames().some((name) => /college/i.test(name)), false);
  for (const Model of MODELS) {
    assert.equal(Object.keys(Model.schema.paths).some((path) => /college/i.test(path)), false, Model.modelName);
  }
});

// ---------------------------------------------------------------- records saved before Phase 1C

test('a pre-Phase-1C department (no level) and subject (no type or category) can still be deactivated, not deleted', async () => {
  const university = await makeUniversity();
  // Created straight in the store, as an old document would exist in the database.
  const legacyDepartment = new Department({ name: 'Old Dept', code: 'OLD', university: university._id, level: 'UG' });
  await legacyDepartment.save();
  const raw = fakeDb.rawDocs(Department).find((doc) => doc.code === 'OLD');
  delete raw.level;

  assert.equal((await call(`/api/admin/departments/${legacyDepartment._id}`)).status, 200);
  const deactivated = await del(`/api/admin/departments/${legacyDepartment._id}`);
  assert.equal(deactivated.status, 200, 'validation does not force the missing level');
  assert.equal(deactivated.json.data.department.isActive, false);
  assert.equal(fakeDb.count(Department), 1);

  // An admin who supplies the level gets it validated like any other value.
  assert.equal((await put(`/api/admin/departments/${legacyDepartment._id}`, { level: 'XX' })).status, 400);
  const fixed = await put(`/api/admin/departments/${legacyDepartment._id}`, { level: 'PG' });
  assert.equal(fixed.status, 200);
  assert.equal(fixed.json.data.department.level, 'PG');
});

test('a pre-Phase-1C subject (no type or category) is still readable and can be deactivated through the API', async () => {
  const { semester } = await subjectSetup();
  const subject = await makeSubject(semester._id);
  const raw = fakeDb.rawDocs(Subject).find((doc) => String(doc._id) === subject._id);
  delete raw.subjectType;
  delete raw.category;

  const fetched = await call(`/api/admin/subjects/${subject._id}`);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.json.data.subject.subjectType, undefined);
  const deactivated = await del(`/api/admin/subjects/${subject._id}`);
  assert.equal(deactivated.status, 200);
  assert.equal(deactivated.json.data.subject.isActive, false);
  assert.equal(fakeDb.count(Subject), 1, 'kept, only deactivated');
  const completed = await put(`/api/admin/subjects/${subject._id}`, { subjectType: 'theory', category: 'core', isActive: true });
  assert.equal(completed.status, 200);
  assert.equal(completed.json.data.subject.category, 'core');
});

test('un-migrated semesters (no regulation) are invisible to students and never block new semesters', async () => {
  const { regulation } = await (async () => {
    const university = await makeUniversity();
    const department = await makeDepartment(university._id);
    return { regulation: await makeRegulation(department._id) };
  })();
  // Two legacy semesters with the same number and no regulation: the partial index ignores them.
  for (let i = 0; i < 2; i += 1) {
    const legacy = new Semester({ semesterNumber: 1, regulation: regulation._id });
    await legacy.save();
    delete fakeDb.rawDocs(Semester).find((doc) => String(doc._id) === String(legacy._id)).regulation;
  }
  assert.equal(fakeDb.count(Semester), 2);
  const created = await post('/api/admin/semesters', { semesterNumber: 1, regulation: regulation._id });
  assert.equal(created.status, 201, 'a new semester is not blocked by the legacy ones');
  const visible = await student(`/api/academic/regulations/${regulation._id}/semesters`);
  assert.equal(visible.json.data.semesters.length, 1);
});

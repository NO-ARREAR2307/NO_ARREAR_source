'use strict';

// Admin-only CRUD APIs for University, Department, Regulation, Semester and Subject (Phase 1B, updated for Phase 1C).
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

const makeUniversity = async (over = {}) => (await post('/api/admin/universities', { name: 'Test University', ...over })).json.data.university;
const makeDepartment = async (university, over = {}) =>
  (await post('/api/admin/departments', { name: 'Computer Science', code: 'CSE', university, level: 'UG', ...over })).json.data.department;
const makeRegulation = async (department, over = {}) =>
  (await post('/api/admin/regulations', { name: '2023-2024', department, ...over })).json.data.regulation;
const makeSemester = async (regulation, over = {}) =>
  (await post('/api/admin/semesters', { semesterNumber: 1, regulation, ...over })).json.data.semester;
const makeSubject = async (semester, over = {}) =>
  (await post('/api/admin/subjects', { name: 'Data Structures', subjectCode: 'CS201', subjectType: 'theory', category: 'core', semester, ...over })).json.data.subject;

// A full chain University -> Department -> Regulation -> Semester -> Subject.
const makeChain = async () => {
  const university = await makeUniversity({ code: 'TU' });
  const department = await makeDepartment(university._id);
  const regulation = await makeRegulation(department._id);
  const semester = await makeSemester(regulation._id);
  const subject = await makeSubject(semester._id);
  return { university, department, regulation, semester, subject };
};

const MODELS = [University, Department, Regulation, Semester, Subject];
const RESOURCES = ['universities', 'departments', 'regulations', 'semesters', 'subjects'];

// ---------------------------------------------------------------- authorization

test('every endpoint rejects a missing token with 401', async () => {
  for (const resource of RESOURCES) {
    const base = `/api/admin/${resource}`;
    const calls = [
      call(base, { method: 'POST', token: null, body: {} }),
      call(base, { token: null }),
      call(`${base}/${MISSING_ID}`, { token: null }),
      call(`${base}/${MISSING_ID}`, { method: 'PUT', token: null, body: {} }),
      call(`${base}/${MISSING_ID}`, { method: 'DELETE', token: null }),
    ];
    for (const result of await Promise.all(calls)) assert.equal(result.status, 401, `${resource}`);
  }
});

test('students are rejected with 403 on every endpoint (reads too) and nothing is written', async () => {
  const chain = await makeChain();
  const before = MODELS.map(fakeDb.count);
  const ids = {
    universities: chain.university._id,
    departments: chain.department._id,
    regulations: chain.regulation._id,
    semesters: chain.semester._id,
    subjects: chain.subject._id,
  };

  for (const resource of RESOURCES) {
    const base = `/api/admin/${resource}`;
    const results = await Promise.all([
      call(base, { method: 'POST', token: studentToken, body: { name: 'Hack', code: 'X' } }),
      call(base, { token: studentToken }),
      call(`${base}/${ids[resource]}`, { token: studentToken }),
      call(`${base}/${ids[resource]}`, { method: 'PUT', token: studentToken, body: { isActive: false } }),
      call(`${base}/${ids[resource]}`, { method: 'DELETE', token: studentToken }),
    ]);
    results.forEach((result) => {
      assert.equal(result.status, 403, resource);
      assert.equal(result.json.success, false);
    });
  }
  assert.deepEqual(MODELS.map(fakeDb.count), before);
  assert.ok(fakeDb.rawDocs(University).every((doc) => doc.isActive === true), 'a student must not deactivate anything');
});

test('a malformed or tampered token gets 401', async () => {
  assert.equal((await call('/api/admin/universities', { token: 'not-a-token' })).status, 401);
});

test('no academic records exist until an admin creates them (nothing is seeded)', async () => {
  for (const resource of RESOURCES) {
    const result = await call(`/api/admin/${resource}`);
    assert.equal(result.status, 200);
    assert.deepEqual(result.json.data[resource], []);
    assert.equal(result.json.meta.total, 0);
  }
});

// ---------------------------------------------------------------- creation and retrieval

test('admin creates the full chain and reads each record back', async () => {
  const { university, department, regulation, semester, subject } = await makeChain();

  assert.equal(university.name, 'Test University');
  assert.equal(university.code, 'TU');
  assert.equal(university.isActive, true);
  assert.ok(university.createdAt && university.updatedAt);
  assert.equal(department.university, university._id);
  assert.equal(department.code, 'CSE');
  assert.equal(department.level, 'UG');
  assert.equal(regulation.department, department._id);
  assert.equal(regulation.name, '2023-2024');
  assert.equal(semester.regulation, regulation._id);
  assert.equal(semester.department, undefined, 'a semester no longer references a department');
  assert.equal(semester.semesterNumber, 1);
  assert.equal(subject.semester, semester._id);
  assert.equal(subject.subjectCode, 'CS201');
  assert.equal(subject.subjectType, 'theory');
  assert.equal(subject.category, 'core');

  const created = await post('/api/admin/universities', { name: 'Another' });
  assert.equal(created.status, 201);
  assert.equal(created.json.success, true);
  assert.equal(created.json.message, 'University created successfully');

  for (const [resource, record] of [['universities', university], ['departments', department], ['regulations', regulation], ['semesters', semester], ['subjects', subject]]) {
    const fetched = await call(`/api/admin/${resource}/${record._id}`);
    assert.equal(fetched.status, 200);
    assert.equal(fetched.json.success, true);
    assert.equal(fetched.json.data[resource.replace(/ies$/, 'y').replace(/s$/, '')]._id, record._id);
  }
});

test('codes are normalised, text is trimmed and the semester number may be sent as a numeric string', async () => {
  const university = await makeUniversity({ name: '  Spaced Name  ', code: ' sp ', description: ' hello ' });
  assert.deepEqual([university.name, university.code, university.description], ['Spaced Name', 'SP', 'hello']);
  const department = await makeDepartment(university._id, { code: ' ece ' });
  assert.equal(department.code, 'ECE');
  const regulation = await makeRegulation(department._id, { name: '  R2023  ' });
  assert.equal(regulation.name, 'R2023');
  const semester = await post('/api/admin/semesters', { semesterNumber: '3', regulation: regulation._id });
  assert.equal(semester.status, 201);
  assert.equal(semester.json.data.semester.semesterNumber, 3);
});

test('lists are paginated and filterable by parent, isActive and semesterNumber', async () => {
  const u1 = await makeUniversity({ name: 'U1', code: 'U1' });
  const u2 = await makeUniversity({ name: 'U2', code: 'U2' });
  const d1 = await makeDepartment(u1._id, { code: 'A', name: 'A dept' });
  await makeDepartment(u1._id, { code: 'B', name: 'B dept' });
  const d3 = await makeDepartment(u2._id, { code: 'A', name: 'C dept' });
  const r1 = await makeRegulation(d1._id);
  const r3 = await makeRegulation(d3._id);
  const s1 = await makeSemester(r1._id, { semesterNumber: 1 });
  await makeSemester(r1._id, { semesterNumber: 2 });
  await makeSemester(r3._id, { semesterNumber: 1 });
  await makeSubject(s1._id, { subjectCode: 'S1', name: 'One' });
  await makeSubject(s1._id, { subjectCode: 'S2', name: 'Two' });

  const all = await call('/api/admin/departments');
  assert.equal(all.json.data.departments.length, 3);
  assert.deepEqual(all.json.meta, { page: 1, limit: 20, total: 3, totalPages: 1 });

  const byUniversity = await call(`/api/admin/departments?university=${u1._id}`);
  assert.deepEqual(byUniversity.json.data.departments.map((d) => d.code), ['A', 'B']);

  // The pre-Phase-1C ?department= filter still works: it matches the semesters of the department's regulations.
  const bySemesterNumber = await call(`/api/admin/semesters?department=${d1._id}&semesterNumber=2`);
  assert.equal(bySemesterNumber.json.data.semesters.length, 1);
  assert.equal(bySemesterNumber.json.data.semesters[0].semesterNumber, 2);
  const byRegulation = await call(`/api/admin/semesters?regulation=${r1._id}`);
  assert.deepEqual(byRegulation.json.data.semesters.map((x) => x.semesterNumber), [1, 2]);

  const subjects = await call(`/api/admin/subjects?semester=${s1._id}&limit=1&page=2`);
  assert.equal(subjects.json.data.subjects.length, 1);
  assert.equal(subjects.json.data.subjects[0].subjectCode, 'S2');
  assert.deepEqual(subjects.json.meta, { page: 2, limit: 1, total: 2, totalPages: 2 });

  await del(`/api/admin/subjects/${(await call(`/api/admin/subjects?semester=${s1._id}`)).json.data.subjects[0]._id}`);
  assert.equal((await call(`/api/admin/subjects?semester=${s1._id}&isActive=true`)).json.data.subjects.length, 1);
  assert.equal((await call(`/api/admin/subjects?semester=${s1._id}&isActive=false`)).json.data.subjects.length, 1);
  assert.equal((await call('/api/admin/subjects?semester=' + s1._id)).json.meta.total, 2);
});

test('a filter that matches nothing returns an empty list, a missing record returns 404', async () => {
  const result = await call(`/api/admin/departments?university=${MISSING_ID}`);
  assert.equal(result.status, 200);
  assert.deepEqual(result.json.data.departments, []);
  for (const resource of RESOURCES) assert.equal((await call(`/api/admin/${resource}/${MISSING_ID}`)).status, 404);
});

// ---------------------------------------------------------------- invalid input

test('required fields are enforced on create (400 with per-field errors)', async () => {
  const cases = {
    universities: ['name'],
    departments: ['name', 'code', 'university', 'level'],
    regulations: ['name', 'department'],
    semesters: ['semesterNumber', 'regulation'],
    subjects: ['name', 'subjectType', 'category', 'semester'], // subjectCode is optional
  };
  for (const [resource, fields] of Object.entries(cases)) {
    const result = await post(`/api/admin/${resource}`, {});
    assert.equal(result.status, 400, resource);
    assert.deepEqual(result.json.errors.map((e) => e.field).sort(), [...fields].sort());
  }
  assert.equal(fakeDb.count(University), 0);
});

test('wrong types, blanks, bad ranges, unknown fields and non-object bodies are rejected', async () => {
  const university = await makeUniversity();
  const department = await makeDepartment(university._id);
  const regulation = await makeRegulation(department._id);
  const bad = [
    ['/api/admin/universities', { name: '   ' }],
    ['/api/admin/universities', { name: { $ne: null } }],
    ['/api/admin/universities', { name: 'X', code: 123 }],
    ['/api/admin/universities', { name: 'X'.repeat(151) }],
    ['/api/admin/universities', { name: 'X', isActive: 'yes' }],
    ['/api/admin/universities', { name: 'X', role: 'admin' }],
    ['/api/admin/departments', { name: 'X', code: 'C'.repeat(21), university: university._id, level: 'UG' }],
    ['/api/admin/departments', { name: 'X', code: 'C', university: 'not-an-id', level: 'UG' }],
    ['/api/admin/departments', { name: 'X', code: 'C', university: { $ne: null }, level: 'UG' }],
    ['/api/admin/regulations', { name: '   ', department: department._id }],
    ['/api/admin/regulations', { name: 'R', department: 'not-an-id' }],
    ['/api/admin/regulations', { name: { $ne: null }, department: department._id }],
    ['/api/admin/semesters', { semesterNumber: 0, regulation: regulation._id }],
    ['/api/admin/semesters', { semesterNumber: 9, regulation: regulation._id }],
    ['/api/admin/semesters', { semesterNumber: 2.5, regulation: regulation._id }],
    ['/api/admin/semesters', { semesterNumber: 'abc', regulation: regulation._id }],
    ['/api/admin/semesters', { semesterNumber: null, regulation: regulation._id }],
    ['/api/admin/semesters', { semesterNumber: 1, department: department._id }], // the old reference is no longer accepted
    ['/api/admin/subjects', { name: 'X', subjectCode: '', semester: MISSING_ID }],
  ];
  for (const [path, body] of bad) {
    const result = await post(path, body);
    assert.equal(result.status, 400, `${path} ${JSON.stringify(body)}`);
    assert.equal(result.json.success, false);
    assert.ok(Array.isArray(result.json.errors) && result.json.errors.length > 0);
  }
  for (const rawBody of ['[]', '"text"', '{not json']) {
    assert.equal((await call('/api/admin/universities', { method: 'POST', rawBody })).status, 400, rawBody);
  }
  assert.equal(fakeDb.count(Semester), 0);
});

test('invalid ids in the path and invalid query values are rejected with 400', async () => {
  for (const resource of RESOURCES) {
    const base = `/api/admin/${resource}`;
    assert.equal((await call(`${base}/not-an-id`)).status, 400);
    assert.equal((await call(`${base}/not-an-id`, { method: 'PUT', body: { isActive: true } })).status, 400);
    assert.equal((await call(`${base}/not-an-id`, { method: 'DELETE' })).status, 400);
  }
  for (const query of ['departments?university=abc', 'regulations?department=abc', 'semesters?department=abc', 'semesters?regulation=abc', 'subjects?semester=abc', 'semesters?semesterNumber=9', 'universities?isActive=maybe', 'universities?page=0', 'universities?limit=1000']) {
    assert.equal((await call(`/api/admin/${query}`)).status, 400, query);
  }
});

// ---------------------------------------------------------------- invalid references

test('creating a child with a missing or malformed parent is rejected', async () => {
  const cases = [
    ['/api/admin/departments', { name: 'D', code: 'D', university: MISSING_ID, level: 'UG' }, 'university'],
    ['/api/admin/regulations', { name: 'R', department: MISSING_ID }, 'department'],
    ['/api/admin/semesters', { semesterNumber: 1, regulation: MISSING_ID }, 'regulation'],
    ['/api/admin/subjects', { name: 'S', subjectCode: 'S', subjectType: 'theory', category: 'core', semester: MISSING_ID }, 'semester'],
  ];
  for (const [path, body, field] of cases) {
    const result = await post(path, body);
    assert.equal(result.status, 400, path);
    assert.deepEqual(result.json.errors, [{ field, message: `${field[0].toUpperCase()}${field.slice(1)} not found` }]);
  }
  assert.equal(fakeDb.count(Department) + fakeDb.count(Regulation) + fakeDb.count(Semester) + fakeDb.count(Subject), 0);
});

test('a parent of the wrong level is not accepted as a reference', async () => {
  const { university, department } = await makeChain();
  // A department id is not a university, and a university id is not a department.
  assert.equal((await post('/api/admin/departments', { name: 'D', code: 'X', university: department._id, level: 'UG' })).status, 400);
  assert.equal((await post('/api/admin/regulations', { name: 'R2', department: university._id })).status, 400);
  assert.equal((await post('/api/admin/semesters', { semesterNumber: 2, regulation: university._id })).status, 400);
  assert.equal((await post('/api/admin/semesters', { semesterNumber: 2, regulation: department._id })).status, 400);
});

test('updating a child to a missing parent is rejected and leaves the record unchanged', async () => {
  const { department, regulation, semester, subject } = await makeChain();
  assert.equal((await put(`/api/admin/departments/${department._id}`, { university: MISSING_ID })).status, 400);
  assert.equal((await put(`/api/admin/regulations/${regulation._id}`, { department: MISSING_ID })).status, 400);
  assert.equal((await put(`/api/admin/semesters/${semester._id}`, { regulation: MISSING_ID })).status, 400);
  assert.equal((await put(`/api/admin/subjects/${subject._id}`, { semester: MISSING_ID })).status, 400);
  assert.equal((await call(`/api/admin/subjects/${subject._id}`)).json.data.subject.semester, semester._id);
});

// ---------------------------------------------------------------- duplicates

test('duplicates are refused per the unique indexes (409)', async () => {
  const u1 = await makeUniversity({ code: 'U1' });
  const u2 = await makeUniversity({ name: 'Second', code: 'U2' });

  // University code is unique (case-insensitive because it is stored upper-case).
  assert.equal((await post('/api/admin/universities', { name: 'Clone', code: 'u1' })).status, 409);
  // ...but universities without a code never collide.
  assert.equal((await post('/api/admin/universities', { name: 'No code A' })).status, 201);
  assert.equal((await post('/api/admin/universities', { name: 'No code B' })).status, 201);

  // Department code: unique inside one university, reusable in another.
  const d1 = await makeDepartment(u1._id, { code: 'CSE' });
  const dup = await post('/api/admin/departments', { name: 'Other name', code: 'cse', university: u1._id, level: 'UG' });
  assert.equal(dup.status, 409);
  assert.match(dup.json.message, /department with this code already exists/i);
  assert.equal((await post('/api/admin/departments', { name: 'CS', code: 'CSE', university: u2._id, level: 'UG' })).status, 201);

  // Regulation name: unique inside one department, reusable in another.
  const r1 = await makeRegulation(d1._id, { name: 'R2023' });
  const dupRegulation = await post('/api/admin/regulations', { name: 'R2023', department: d1._id });
  assert.equal(dupRegulation.status, 409);
  assert.match(dupRegulation.json.message, /regulation with this name already exists/i);
  const d2 = (await post('/api/admin/departments', { name: 'Maths', code: 'MA', university: u1._id, level: 'UG' })).json.data.department;
  assert.equal((await post('/api/admin/regulations', { name: 'R2023', department: d2._id })).status, 201);

  // Semester number: unique inside one regulation, reusable in another.
  const s1 = await makeSemester(r1._id, { semesterNumber: 1 });
  assert.equal((await post('/api/admin/semesters', { semesterNumber: 1, regulation: r1._id })).status, 409);
  assert.equal((await post('/api/admin/semesters', { semesterNumber: 2, regulation: r1._id })).status, 201);
  const r1b = await makeRegulation(d1._id, { name: 'R2024' });
  assert.equal((await post('/api/admin/semesters', { semesterNumber: 1, regulation: r1b._id })).status, 201);

  // Subject code: unique inside one semester.
  await makeSubject(s1._id, { subjectCode: 'CS101' });
  assert.equal((await post('/api/admin/subjects', { name: 'Again', subjectCode: 'cs101', subjectType: 'theory', category: 'core', semester: s1._id })).status, 409);
  const s2 = await makeSemester(r1._id, { semesterNumber: 3 });
  assert.equal((await post('/api/admin/subjects', { name: 'Same code, other semester', subjectCode: 'CS101', subjectType: 'theory', category: 'core', semester: s2._id })).status, 201);

  assert.equal(fakeDb.count(Department), 3);
});

test('an update that would create a duplicate is refused (409) and changes nothing', async () => {
  const u = await makeUniversity({ code: 'A' });
  const other = await makeUniversity({ name: 'B', code: 'B' });
  assert.equal((await put(`/api/admin/universities/${other._id}`, { code: 'a' })).status, 409);
  assert.equal((await call(`/api/admin/universities/${other._id}`)).json.data.university.code, 'B');

  const d1 = await makeDepartment(u._id, { code: 'X' });
  const d2 = await makeDepartment(u._id, { code: 'Y' });
  assert.equal((await put(`/api/admin/departments/${d2._id}`, { code: 'x' })).status, 409);

  const r1 = await makeRegulation(d1._id, { name: 'R1' });
  assert.equal((await put(`/api/admin/regulations/${(await makeRegulation(d1._id, { name: 'R2' }))._id}`, { name: 'r1' })).status, 200, 'names are case-sensitive text');
  const r1dup = await makeRegulation(d1._id, { name: 'R3' });
  assert.equal((await put(`/api/admin/regulations/${r1dup._id}`, { name: 'R1' })).status, 409);
  assert.equal((await call(`/api/admin/regulations/${r1dup._id}`)).json.data.regulation.name, 'R3');

  await makeSemester(r1._id, { semesterNumber: 1 });
  const s2 = await makeSemester(r1._id, { semesterNumber: 2 });
  assert.equal((await put(`/api/admin/semesters/${s2._id}`, { semesterNumber: 1 })).status, 409);

  const r2 = await makeRegulation(d2._id);
  const sem = await makeSemester(r2._id, { semesterNumber: 1 });
  await makeSubject(sem._id, { subjectCode: 'Z1' });
  const z2 = await makeSubject(sem._id, { subjectCode: 'Z2' });
  assert.equal((await put(`/api/admin/subjects/${z2._id}`, { subjectCode: 'z1' })).status, 409);
});

// ---------------------------------------------------------------- updates

test('PUT updates only the fields that are sent and returns the saved record', async () => {
  const { university, department, regulation, semester, subject } = await makeChain();

  const u = await put(`/api/admin/universities/${university._id}`, { name: 'Renamed', description: 'About us' });
  assert.equal(u.status, 200);
  assert.equal(u.json.message, 'University updated successfully');
  assert.deepEqual([u.json.data.university.name, u.json.data.university.code, u.json.data.university.description], ['Renamed', 'TU', 'About us']);

  const cleared = await put(`/api/admin/universities/${university._id}`, { code: null, description: '' });
  assert.equal(cleared.json.data.university.code, undefined);
  assert.equal(cleared.json.data.university.description, undefined);
  assert.equal(cleared.json.data.university.name, 'Renamed');

  const d = await put(`/api/admin/departments/${department._id}`, { name: 'Computer Engineering', code: 'ce' });
  assert.deepEqual([d.json.data.department.name, d.json.data.department.code], ['Computer Engineering', 'CE']);

  const r = await put(`/api/admin/regulations/${regulation._id}`, { name: ' R2025 ' });
  assert.equal(r.json.data.regulation.name, 'R2025');
  const lvl = await put(`/api/admin/departments/${department._id}`, { level: 'pg' });
  assert.equal(lvl.json.data.department.level, 'PG');

  const s = await put(`/api/admin/semesters/${semester._id}`, { semesterNumber: 5 });
  assert.equal(s.json.data.semester.semesterNumber, 5);

  const sub = await put(`/api/admin/subjects/${subject._id}`, { name: 'Algorithms', subjectCode: 'cs301' });
  assert.deepEqual([sub.json.data.subject.name, sub.json.data.subject.subjectCode], ['Algorithms', 'CS301']);

  assert.equal((await call(`/api/admin/subjects/${subject._id}`)).json.data.subject.name, 'Algorithms');
});

test('a child can be moved to another active parent; unknown records, empty bodies and bad fields are rejected', async () => {
  const { university, department, regulation, semester, subject } = await makeChain();
  const otherUniversity = await makeUniversity({ name: 'Other', code: 'OT' });
  const moved = await put(`/api/admin/departments/${department._id}`, { university: otherUniversity._id });
  assert.equal(moved.status, 200);
  assert.equal(moved.json.data.department.university, otherUniversity._id);
  assert.notEqual(university._id, otherUniversity._id);

  const otherDepartment = await makeDepartment(otherUniversity._id, { code: 'PHY', name: 'Physics' });
  const movedRegulation = await put(`/api/admin/regulations/${regulation._id}`, { department: otherDepartment._id });
  assert.equal(movedRegulation.status, 200);
  assert.equal(movedRegulation.json.data.regulation.department, otherDepartment._id);
  const secondRegulation = await makeRegulation(department._id, { name: '2024-2025' });
  const movedSemester = await put(`/api/admin/semesters/${semester._id}`, { regulation: secondRegulation._id });
  assert.equal(movedSemester.json.data.semester.regulation, secondRegulation._id);

  const secondSemester = await makeSemester(secondRegulation._id, { semesterNumber: 2 });
  assert.equal((await put(`/api/admin/subjects/${subject._id}`, { semester: secondSemester._id })).json.data.subject.semester, secondSemester._id);
  assert.notEqual(semester._id, secondSemester._id);

  for (const resource of RESOURCES) {
    assert.equal((await put(`/api/admin/${resource}/${MISSING_ID}`, { isActive: true })).status, 404);
  }
  assert.equal((await put(`/api/admin/universities/${otherUniversity._id}`, {})).status, 400);
  assert.equal((await put(`/api/admin/universities/${otherUniversity._id}`, { name: '' })).status, 400);
  assert.equal((await put(`/api/admin/universities/${otherUniversity._id}`, { _id: MISSING_ID, name: 'x' })).status, 400);
  assert.equal((await put(`/api/admin/semesters/${secondSemester._id}`, { semesterNumber: 12 })).status, 400);
});

// ---------------------------------------------------------------- safe deactivation

test('DELETE deactivates instead of removing, and the record stays readable', async () => {
  const { subject } = await makeChain();
  const result = await del(`/api/admin/subjects/${subject._id}`);
  assert.equal(result.status, 200);
  assert.equal(result.json.message, 'Subject deactivated successfully');
  assert.equal(result.json.data.subject.isActive, false);

  assert.equal(fakeDb.count(Subject), 1, 'the document must still exist');
  const fetched = await call(`/api/admin/subjects/${subject._id}`);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.json.data.subject.isActive, false);

  const again = await del(`/api/admin/subjects/${subject._id}`);
  assert.equal(again.status, 200);
  assert.equal(again.json.message, 'Subject was already deactivated');
  assert.equal((await del(`/api/admin/subjects/${MISSING_ID}`)).status, 404);
});

test('a parent with active children cannot be deactivated (409), bottom-up it can', async () => {
  const { university, department, regulation, semester, subject } = await makeChain();

  for (const [path, id, text] of [
    ['universities', university._id, /1 active department/],
    ['departments', department._id, /1 active regulation/],
    ['regulations', regulation._id, /1 active semester/],
    ['semesters', semester._id, /1 active subject/],
  ]) {
    const blocked = await del(`/api/admin/${path}/${id}`);
    assert.equal(blocked.status, 409, path);
    assert.match(blocked.json.message, text);
    const viaPut = await put(`/api/admin/${path}/${id}`, { isActive: false });
    assert.equal(viaPut.status, 409, `${path} via PUT`);
    assert.equal((await call(`/api/admin/${path}/${id}`)).json.data[path.replace(/ies$/, 'y').replace(/s$/, '')].isActive, true);
  }

  assert.equal((await del(`/api/admin/subjects/${subject._id}`)).status, 200);
  assert.equal((await del(`/api/admin/semesters/${semester._id}`)).status, 200);
  assert.equal((await del(`/api/admin/regulations/${regulation._id}`)).status, 200);
  assert.equal((await put(`/api/admin/departments/${department._id}`, { isActive: false })).status, 200);
  assert.equal((await del(`/api/admin/universities/${university._id}`)).status, 200);

  for (const Model of MODELS) {
    assert.equal(fakeDb.count(Model), 1);
    assert.equal(fakeDb.rawDocs(Model)[0].isActive, false);
  }
});

test('inactive children do not block deactivating the parent', async () => {
  const { department, regulation, semester, subject } = await makeChain();
  await del(`/api/admin/subjects/${subject._id}`);
  assert.equal((await del(`/api/admin/semesters/${semester._id}`)).status, 200);
  assert.equal((await del(`/api/admin/regulations/${regulation._id}`)).status, 200);
  assert.equal((await del(`/api/admin/departments/${department._id}`)).status, 200);
});

test('nothing can be created under, moved to, or re-activated beneath an inactive parent', async () => {
  const { university, department, regulation, semester, subject } = await makeChain();
  await del(`/api/admin/subjects/${subject._id}`);
  await del(`/api/admin/semesters/${semester._id}`);

  // Create under an inactive semester.
  const create = await post('/api/admin/subjects', { name: 'New', subjectCode: 'N1', subjectType: 'theory', category: 'core', semester: semester._id });
  assert.equal(create.status, 409);
  assert.match(create.json.message, /inactive/i);

  // Re-activate a subject while its semester is inactive.
  assert.equal((await put(`/api/admin/subjects/${subject._id}`, { isActive: true })).status, 409);

  // Move a subject to an inactive semester.
  const other = await makeSemester(regulation._id, { semesterNumber: 2 });
  const movable = await makeSubject(other._id, { subjectCode: 'M1' });
  assert.equal((await put(`/api/admin/subjects/${movable._id}`, { semester: semester._id })).status, 409);

  // Re-activating in the right order works: semester first, then its subject.
  assert.equal((await put(`/api/admin/semesters/${semester._id}`, { isActive: true })).status, 200);
  const back = await put(`/api/admin/subjects/${subject._id}`, { isActive: true });
  assert.equal(back.status, 200);
  assert.equal(back.json.data.subject.isActive, true);

  // Same rule one level up: a department cannot be created under an inactive university.
  await del(`/api/admin/subjects/${subject._id}`);
  await del(`/api/admin/subjects/${movable._id}`);
  await del(`/api/admin/semesters/${semester._id}`);
  await del(`/api/admin/semesters/${other._id}`);

  // A semester cannot be created under an inactive regulation, nor a regulation under an inactive department.
  await del(`/api/admin/regulations/${regulation._id}`);
  assert.equal((await post('/api/admin/semesters', { semesterNumber: 6, regulation: regulation._id })).status, 409);
  await del(`/api/admin/departments/${department._id}`);
  assert.equal((await post('/api/admin/regulations', { name: 'R-late', department: department._id })).status, 409);
  await del(`/api/admin/universities/${university._id}`);
  assert.equal((await post('/api/admin/departments', { name: 'D2', code: 'D2', university: university._id, level: 'UG' })).status, 409);
});

test('API error responses never include stack traces or internals', async () => {
  const result = await post('/api/admin/departments', { name: 'D', code: 'D', university: MISSING_ID, level: 'UG' });
  assert.equal(result.json.stack, undefined);
  assert.deepEqual(Object.keys(result.json).sort(), ['errors', 'message', 'success']);
});

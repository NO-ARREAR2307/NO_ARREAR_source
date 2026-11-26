'use strict';

// Read-only academic APIs for students and admins (/api/academic/*), Phase 1B Part 2, updated for Phase 1C.
// No database is needed: the academic models run against the in-memory stand-in in
// tests/helpers/fakeAcademicDb.js and the User lookup of the JWT middleware is replaced.

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
const UNVERIFIED_ID = new mongoose.Types.ObjectId().toString();
const accounts = {
  [ADMIN_ID]: { _id: ADMIN_ID, name: 'Admin', email: 'admin@example.com', role: 'admin' },
  [STUDENT_ID]: { _id: STUDENT_ID, name: 'Student', email: 'student@example.com', role: 'student', emailVerified: true },
  [UNVERIFIED_ID]: { _id: UNVERIFIED_ID, name: 'New', email: 'new@example.com', role: 'student', emailVerified: false },
};
User.findById = async (id) => accounts[String(id)] || null;

const adminToken = generateToken(ADMIN_ID);
const studentToken = generateToken(STUDENT_ID);
const unverifiedToken = generateToken(UNVERIFIED_ID);
const MISSING_ID = new mongoose.Types.ObjectId().toString();
const PORTAL_URL = 'https://egovernance.unom.ac.in/qpregular/FrmStudDownloadQP.ASPX?IDE_REG=REG';

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

const call = async (path, { method = 'GET', token = studentToken, body } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, headers: response.headers, json: await response.json() };
};
const adminPost = async (path, body) => (await call(path, { method: 'POST', token: adminToken, body })).json.data;
const adminDelete = (path) => call(path, { method: 'DELETE', token: adminToken });

// Records are created through the real admin API (no data exists unless a test creates it).
const makeUniversity = async (name, code, extra = {}) => (await adminPost('/api/admin/universities', { name, code, ...extra })).university;
const makeDepartment = async (university, name, code, extra = {}) => (await adminPost('/api/admin/departments', { name, code, university, level: 'UG', ...extra })).department;
const makeRegulation = async (department, name, extra = {}) => (await adminPost('/api/admin/regulations', { name, department, ...extra })).regulation;
const makeSemester = async (regulation, semesterNumber, extra = {}) => (await adminPost('/api/admin/semesters', { semesterNumber, regulation, ...extra })).semester;
const makeSubject = async (semester, name, subjectCode, extra = {}) =>
  (await adminPost('/api/admin/subjects', { name, subjectCode, subjectType: 'theory', category: 'core', semester, ...extra })).subject;

const MODELS = [University, Department, Regulation, Semester, Subject];

// A little hierarchy: two universities, each with departments, regulations, semesters and subjects.
const buildData = async () => {
  const madras = await makeUniversity('University of Madras', 'UNOM', { description: 'Chennai' });
  const anna = await makeUniversity('Anna University', 'AU');
  const cs = await makeDepartment(madras._id, 'Computer Science', 'CS');
  const maths = await makeDepartment(madras._id, 'Mathematics', 'MA');
  const annaCs = await makeDepartment(anna._id, 'Computer Science', 'CS');
  const csReg = await makeRegulation(cs._id, '2023-2024');
  const annaReg = await makeRegulation(annaCs._id, '2023-2024');
  const sem1 = await makeSemester(csReg._id, 1);
  const sem2 = await makeSemester(csReg._id, 2);
  const annaSem1 = await makeSemester(annaReg._id, 1);
  const ds = await makeSubject(sem1._id, 'Data Structures', 'CS101');
  const algo = await makeSubject(sem1._id, 'Algorithms', 'CS102');
  await makeSubject(annaSem1._id, 'Other University Subject', 'XX1');
  return { madras, anna, cs, maths, annaCs, csReg, annaReg, sem1, sem2, annaSem1, ds, algo };
};

// ---------------------------------------------------------------- authentication

test('every academic endpoint rejects a missing or invalid token with 401', async () => {
  const paths = [
    '/api/academic/universities',
    `/api/academic/universities/${MISSING_ID}/departments`,
    `/api/academic/departments/${MISSING_ID}/regulations`,
    `/api/academic/regulations/${MISSING_ID}/semesters`,
    `/api/academic/departments/${MISSING_ID}/semesters`,
    `/api/academic/semesters/${MISSING_ID}/subjects`,
    '/api/academic/official-question-paper-portal',
  ];
  for (const path of paths) {
    assert.equal((await call(path, { token: null })).status, 401, path);
    assert.equal((await call(path, { token: 'garbage' })).status, 401, path);
  }
});

test('a student who has not verified their email is refused (403 EMAIL_NOT_VERIFIED)', async () => {
  const result = await call('/api/academic/universities', { token: unverifiedToken });
  assert.equal(result.status, 403);
  assert.equal(result.json.code, 'EMAIL_NOT_VERIFIED');
});

// ---------------------------------------------------------------- students and admins can read

test('university list: students and admins both read it, with only the public fields', async () => {
  await buildData();
  for (const token of [studentToken, adminToken]) {
    const result = await call('/api/academic/universities', { token });
    assert.equal(result.status, 200);
    assert.equal(result.json.success, true);
    assert.equal(result.json.message, 'Universities retrieved successfully');
    assert.equal(result.json.meta.total, 2);
    const [first, second] = result.json.data.universities;
    // No isActive, timestamps or other internal fields; an unset description is simply absent.
    assert.deepEqual(Object.keys(first).sort(), ['_id', 'code', 'name']);
    assert.deepEqual(Object.keys(second).sort(), ['_id', 'code', 'description', 'name']);
    assert.deepEqual([first.name, first.code], ['Anna University', 'AU']);
    assert.deepEqual([second.name, second.code, second.description], ['University of Madras', 'UNOM', 'Chennai']);
    assert.match(first._id, /^[0-9a-f]{24}$/);
  }
});

test('departments are filtered by university and carry the university reference', async () => {
  const { madras, anna, cs, maths, annaCs } = await buildData();
  const result = await call(`/api/academic/universities/${madras._id}/departments`);
  assert.equal(result.status, 200);
  const departments = result.json.data.departments;
  assert.deepEqual(departments.map((d) => d.name), ['Computer Science', 'Mathematics']);
  assert.deepEqual(departments.map((d) => d._id), [cs._id, maths._id]);
  departments.forEach((d) => {
    assert.deepEqual(Object.keys(d).sort(), ['_id', 'code', 'level', 'name', 'university']);
    assert.equal(d.university, madras._id);
  });
  assert.ok(!departments.some((d) => d._id === annaCs._id), 'another university department must not appear');

  const other = await call(`/api/academic/universities/${anna._id}/departments`, { token: adminToken });
  assert.deepEqual(other.json.data.departments.map((d) => d._id), [annaCs._id]);
});

test('semesters are filtered by department (via its regulations), sorted by number, with the department reference', async () => {
  const { cs, annaCs, sem1, sem2 } = await buildData();
  const result = await call(`/api/academic/departments/${cs._id}/semesters`);
  assert.equal(result.status, 200);
  const semesters = result.json.data.semesters;
  assert.deepEqual(semesters.map((s) => s.semesterNumber), [1, 2]);
  assert.deepEqual(semesters.map((s) => s._id), [sem1._id, sem2._id]);
  semesters.forEach((s) => {
    assert.deepEqual(Object.keys(s).sort(), ['_id', 'department', 'regulation', 'semesterNumber']);
    assert.equal(s.department, cs._id);
  });
  const other = await call(`/api/academic/departments/${annaCs._id}/semesters`);
  assert.equal(other.json.data.semesters.length, 1);
});

test('subjects are filtered by semester, sorted by name, with the semester reference', async () => {
  const { sem1, sem2, ds, algo } = await buildData();
  const result = await call(`/api/academic/semesters/${sem1._id}/subjects`, { token: adminToken });
  assert.equal(result.status, 200);
  const subjects = result.json.data.subjects;
  assert.deepEqual(subjects.map((s) => s.name), ['Algorithms', 'Data Structures']);
  assert.deepEqual(subjects.map((s) => s._id), [algo._id, ds._id]);
  subjects.forEach((s) => {
    assert.deepEqual(Object.keys(s).sort(), ['_id', 'category', 'name', 'semester', 'subjectCode', 'subjectType']);
    assert.equal(s.semester, sem1._id);
  });
  assert.equal(result.json.meta.total, 2);
  // Another semester of the same department is empty, not mixed in.
  assert.deepEqual((await call(`/api/academic/semesters/${sem2._id}/subjects`)).json.data.subjects, []);
});

test('sorting is alphabetical regardless of letter case', async () => {
  await makeUniversity('beta college', 'B');
  await makeUniversity('Alpha Institute', 'A');
  await makeUniversity('gamma University', 'G');
  const names = (await call('/api/academic/universities')).json.data.universities.map((u) => u.name);
  assert.deepEqual(names, ['Alpha Institute', 'beta college', 'gamma University']);
});

// ---------------------------------------------------------------- empty results

test('empty results are a normal 200 with an empty list', async () => {
  const empty = await call('/api/academic/universities');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.json.data.universities, []);
  assert.equal(empty.json.meta.total, 0);

  const university = await makeUniversity('Lonely University', 'LU');
  const department = await makeDepartment(university._id, 'Empty Dept', 'ED');
  assert.deepEqual((await call(`/api/academic/departments/${department._id}/regulations`)).json.data.regulations, []);
  assert.deepEqual((await call(`/api/academic/departments/${department._id}/semesters`)).json.data.semesters, []);
  const regulation = await makeRegulation(department._id, 'R1');
  assert.deepEqual((await call(`/api/academic/regulations/${regulation._id}/semesters`)).json.data.semesters, []);
  const semester = await makeSemester(regulation._id, 1);
  assert.deepEqual((await call(`/api/academic/universities/${university._id}/departments`)).json.data.departments.length, 1);
  assert.deepEqual((await call(`/api/academic/departments/${department._id}/semesters`)).json.data.semesters.length, 1);
  const subjects = await call(`/api/academic/semesters/${semester._id}/subjects`);
  assert.equal(subjects.status, 200);
  assert.deepEqual(subjects.json.data.subjects, []);
});

// ---------------------------------------------------------------- inactive records

test('inactive records are never returned, to students or admins', async () => {
  const { madras, cs, csReg, maths, sem1, sem2, ds, algo } = await buildData();
  // Deactivate bottom-up through the admin API (it refuses to deactivate a parent with active children).
  assert.equal((await adminDelete(`/api/admin/subjects/${algo._id}`)).status, 200);
  assert.equal((await adminDelete(`/api/admin/semesters/${sem2._id}`)).status, 200);
  assert.equal((await adminDelete(`/api/admin/departments/${maths._id}`)).status, 200);

  for (const token of [studentToken, adminToken]) {
    assert.deepEqual((await call(`/api/academic/semesters/${sem1._id}/subjects`, { token })).json.data.subjects.map((s) => s._id), [ds._id]);
    assert.deepEqual((await call(`/api/academic/departments/${cs._id}/semesters`, { token })).json.data.semesters.map((s) => s._id), [sem1._id]);
    assert.deepEqual((await call(`/api/academic/universities/${madras._id}/departments`, { token })).json.data.departments.map((d) => d._id), [cs._id]);
  }

  // An inactive university disappears from the list.
  await adminDelete(`/api/admin/subjects/${ds._id}`);
  await adminDelete(`/api/admin/semesters/${sem1._id}`);
  await adminDelete(`/api/admin/regulations/${csReg._id}`);
  await adminDelete(`/api/admin/departments/${cs._id}`);
  await adminDelete(`/api/admin/universities/${madras._id}`);
  const universities = (await call('/api/academic/universities')).json.data.universities;
  assert.deepEqual(universities.map((u) => u.name), ['Anna University']);
  assert.equal(fakeDb.count(University), 2, 'deactivated records are kept, only hidden');
});

test('an inactive parent is reported as not found (404), like a missing one', async () => {
  const { madras, cs, csReg, sem1, ds, algo, sem2, maths } = await buildData();
  await adminDelete(`/api/admin/subjects/${ds._id}`);
  await adminDelete(`/api/admin/subjects/${algo._id}`);
  await adminDelete(`/api/admin/semesters/${sem1._id}`);
  await adminDelete(`/api/admin/semesters/${sem2._id}`);
  await adminDelete(`/api/admin/regulations/${csReg._id}`);
  await adminDelete(`/api/admin/departments/${cs._id}`);
  await adminDelete(`/api/admin/departments/${maths._id}`);
  await adminDelete(`/api/admin/universities/${madras._id}`);

  assert.equal((await call(`/api/academic/semesters/${sem1._id}/subjects`)).status, 404);
  assert.equal((await call(`/api/academic/departments/${cs._id}/semesters`)).status, 404);
  assert.equal((await call(`/api/academic/departments/${cs._id}/regulations`)).status, 404);
  assert.equal((await call(`/api/academic/regulations/${csReg._id}/semesters`)).status, 404);
  const university = await call(`/api/academic/universities/${madras._id}/departments`);
  assert.equal(university.status, 404);
  assert.equal(university.json.message, 'University not found');
});

test('nothing is exposed beneath an inactive ancestor even if a child is still marked active', async () => {
  // Possible only through direct database edits (the admin API refuses it), but must stay hidden.
  const university = await new University({ name: 'Hidden U', code: 'HU', isActive: false }).save();
  const department = await new Department({ name: 'Active Dept', code: 'AD', university: university._id, level: 'UG' }).save();
  const regulation = await new Regulation({ name: 'R1', department: department._id }).save();
  const semester = await new Semester({ semesterNumber: 1, regulation: regulation._id }).save();
  await new Subject({ name: 'Active Subject', subjectCode: 'AS1', subjectType: 'theory', category: 'core', semester: semester._id }).save();

  assert.equal((await call(`/api/academic/departments/${department._id}/semesters`)).status, 404);
  assert.equal((await call(`/api/academic/departments/${department._id}/regulations`)).status, 404);
  assert.equal((await call(`/api/academic/regulations/${regulation._id}/semesters`)).status, 404);
  assert.equal((await call(`/api/academic/semesters/${semester._id}/subjects`)).status, 404);
  assert.equal((await call(`/api/academic/universities/${university._id}/departments`)).status, 404);
});

// ---------------------------------------------------------------- invalid ids and missing parents

test('invalid ObjectIds are rejected with 400', async () => {
  for (const path of [
    '/api/academic/universities/not-an-id/departments',
    '/api/academic/departments/123/semesters',
    '/api/academic/departments/123/regulations',
    '/api/academic/regulations/abc/semesters',
    '/api/academic/semesters/%7B%22%24ne%22%3Anull%7D/subjects',
    `/api/academic/semesters/${MISSING_ID}zz/subjects`,
  ]) {
    const result = await call(path);
    assert.equal(result.status, 400, path);
    assert.equal(result.json.success, false);
    assert.match(result.json.message, /valid MongoDB ObjectId/);
  }
});

test('a well-formed id that does not exist is 404 for every level', async () => {
  const cases = [
    [`/api/academic/universities/${MISSING_ID}/departments`, 'University not found'],
    [`/api/academic/departments/${MISSING_ID}/semesters`, 'Department not found'],
    [`/api/academic/departments/${MISSING_ID}/regulations`, 'Department not found'],
    [`/api/academic/regulations/${MISSING_ID}/semesters`, 'Regulation not found'],
    [`/api/academic/semesters/${MISSING_ID}/subjects`, 'Semester not found'],
  ];
  for (const [path, message] of cases) {
    const result = await call(path);
    assert.equal(result.status, 404, path);
    assert.equal(result.json.message, message);
    assert.equal(result.json.stack, undefined);
  }
});

test('incorrect parent-child combinations never leak records of another parent', async () => {
  const { madras, cs, sem1, annaCs, annaSem1 } = await buildData();
  // An id of the wrong level is just an unknown id for that level.
  assert.equal((await call(`/api/academic/universities/${cs._id}/departments`)).status, 404);
  assert.equal((await call(`/api/academic/departments/${madras._id}/semesters`)).status, 404);
  assert.equal((await call(`/api/academic/semesters/${cs._id}/subjects`)).status, 404);
  assert.equal((await call(`/api/academic/regulations/${sem1._id}/semesters`)).status, 404);
  assert.equal((await call(`/api/academic/departments/${sem1._id}/regulations`)).status, 404);

  // Each parent only ever lists its own children.
  const csSemesters = (await call(`/api/academic/departments/${cs._id}/semesters`)).json.data.semesters;
  assert.ok(csSemesters.every((s) => s.department === cs._id));
  assert.ok(!csSemesters.some((s) => s._id === annaSem1._id));
  const sem1Subjects = (await call(`/api/academic/semesters/${sem1._id}/subjects`)).json.data.subjects;
  assert.ok(sem1Subjects.every((s) => s.semester === sem1._id));
  assert.ok(!sem1Subjects.some((s) => s.subjectCode === 'XX1'));
  const annaDepartments = (await call(`/api/academic/universities/${madras._id}/departments`)).json.data.departments;
  assert.ok(!annaDepartments.some((d) => d._id === annaCs._id));
});

// ---------------------------------------------------------------- write access is rejected

test('students cannot create, change or delete academic records (read-only API and admin API)', async () => {
  const { madras, cs, csReg, sem1, ds } = await buildData();
  const before = MODELS.map(fakeDb.count);
  const snapshot = JSON.stringify(MODELS.map(fakeDb.rawDocs));

  // Under /api/academic nothing but GET exists: 405, even for an authenticated student.
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const path of ['/api/academic/universities', `/api/academic/universities/${madras._id}/departments`, `/api/academic/departments/${cs._id}/regulations`, `/api/academic/regulations/${csReg._id}/semesters`, `/api/academic/semesters/${sem1._id}/subjects`]) {
      const result = await call(path, { method, body: { name: 'Hack', isActive: false } });
      assert.equal(result.status, 405, `${method} ${path}`);
      assert.equal(result.headers.get('allow'), 'GET, HEAD');
    }
  }

  // The admin write endpoints stay closed to students (403), for every level.
  const adminTargets = [
    ['universities', madras._id, { name: 'Hack' }],
    ['departments', cs._id, { name: 'Hack', code: 'H', university: madras._id, level: 'UG' }],
    ['regulations', csReg._id, { name: 'Hack', department: cs._id }],
    ['semesters', sem1._id, { semesterNumber: 4, regulation: csReg._id }],
    ['subjects', ds._id, { name: 'Hack', subjectCode: 'H1', subjectType: 'theory', category: 'core', semester: sem1._id }],
  ];
  for (const [resource, id, body] of adminTargets) {
    assert.equal((await call(`/api/admin/${resource}`, { method: 'POST', body })).status, 403, `POST ${resource}`);
    assert.equal((await call(`/api/admin/${resource}/${id}`, { method: 'PUT', body: { isActive: false } })).status, 403, `PUT ${resource}`);
    assert.equal((await call(`/api/admin/${resource}/${id}`, { method: 'DELETE' })).status, 403, `DELETE ${resource}`);
  }

  assert.deepEqual(MODELS.map(fakeDb.count), before);
  assert.equal(JSON.stringify(MODELS.map(fakeDb.rawDocs)), snapshot, 'no record changed');
});

test('unauthenticated writes are 401, and unknown academic paths are 404', async () => {
  assert.equal((await call('/api/academic/universities', { method: 'POST', token: null, body: { name: 'x' } })).status, 401);
  assert.equal((await call('/api/academic/does-not-exist')).status, 404);
});

test('the Part 1 admin APIs still work for admins and still reject students', async () => {
  const created = await call('/api/admin/universities', { method: 'POST', token: adminToken, body: { name: 'Admin Made', code: 'AM' } });
  assert.equal(created.status, 201);
  assert.equal((await call('/api/admin/universities', { token: adminToken })).json.meta.total, 1);
  assert.equal((await call('/api/admin/universities')).status, 403);
});

// ---------------------------------------------------------------- official portal

test('official question paper portal configuration is returned exactly as specified', async () => {
  for (const token of [studentToken, adminToken]) {
    const result = await call('/api/academic/official-question-paper-portal', { token });
    assert.equal(result.status, 200);
    assert.equal(result.json.success, true);
    assert.deepEqual(result.json.data.portal, {
      name: 'University of Madras Official Question Paper Portal',
      url: PORTAL_URL,
      description: 'Access official model and previous-year question papers.',
    });
  }
});

test('the portal is only a link: no database access, and writes are refused', async () => {
  const result = await call('/api/academic/official-question-paper-portal', { method: 'POST', body: { url: 'https://evil.example' } });
  assert.equal(result.status, 405);
  const again = await call('/api/academic/official-question-paper-portal');
  assert.equal(again.json.data.portal.url, PORTAL_URL);
  assert.equal(Object.isFrozen(require('../config/academicPortal').OFFICIAL_QUESTION_PAPER_PORTAL), true);
});

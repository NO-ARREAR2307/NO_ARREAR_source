'use strict';

// Elective / conditional subject choice groups (choiceGroup, choiceGroupLabel, choiceRule).
// Same approach as the other academic tests: no database or internet. The academic models run against the
// in-memory stand-in (tests/helpers/fakeAcademicDb.js) that keeps their real schemas; Express, JWT, role
// middleware, validators, services and the error handler are the real code.

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

const call = async (path, { method = 'GET', token = adminToken, body } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: response.status, json: await response.json() };
};
const post = (path, body, token) => call(path, { method: 'POST', body, token });
const put = (path, body) => call(path, { method: 'PUT', body });
const studentGet = (path) => call(path, { token: studentToken });

const IMPORT_URL = '/api/admin/academic-imports/subjects';
const MODELS = [University, Department, Regulation, Semester, Subject];
const snapshot = () => JSON.stringify(MODELS.map((Model) => fakeDb.rawDocs(Model)));
const subjectDocs = () => fakeDb.rawDocs(Subject);
const fieldsOf = (result) => (result.json.errors || []).map((e) => e.field).sort();

// University -> Department -> Regulation -> semesters 1 and 2 (made-up names only).
const makeSetup = async () => {
  const university = (await post('/api/admin/universities', { name: 'Test University', code: 'TU' })).json.data.university;
  const department = (await post('/api/admin/departments', { name: 'Computer Applications', code: 'CA', university: university._id, level: 'UG' })).json.data.department;
  const regulation = (await post('/api/admin/regulations', { name: 'Test Regulation', department: department._id })).json.data.regulation;
  const sem1 = (await post('/api/admin/semesters', { semesterNumber: 1, regulation: regulation._id })).json.data.semester;
  const sem2 = (await post('/api/admin/semesters', { semesterNumber: 2, regulation: regulation._id })).json.data.semester;
  return { university, department, regulation, sem1, sem2 };
};

const subjectBody = (semester, over = {}) => ({ name: 'Sample Subject', subjectCode: 'SMP101', subjectType: 'theory', category: 'core', semester, ...over });
const createSubject = (semester, over) => post('/api/admin/subjects', subjectBody(semester, over));
const electiveBody = (semester, n, over = {}) =>
  subjectBody(semester, { name: `Elective ${n}`, subjectCode: `EL10${n}`, category: 'elective', choiceGroup: 'elective-1', choiceGroupLabel: 'Elective I', ...over });

const record = (over = {}) => ({ semesterNumber: 1, name: 'Sample Subject', subjectCode: 'SMP101', subjectType: 'theory', category: 'core', ...over });
const electiveRecord = (n, over = {}) =>
  record({ name: `Elective ${n}`, subjectCode: `EL10${n}`, category: 'elective', choiceGroup: 'elective-1', choiceGroupLabel: 'Elective I', ...over });
const runImport = (setup, subjects, over = {}) =>
  post(IMPORT_URL, { departmentId: setup.department._id, regulationId: setup.regulation._id, subjects, ...over });

// ---------------------------------------------------------------- model

test('model: a choice group defaults the rule to choose_one; a subject without a group gets no choice fields', async () => {
  const semester = new mongoose.Types.ObjectId();
  const grouped = new Subject({ name: 'A', subjectType: 'theory', category: 'elective', semester, choiceGroup: ' Elective-1 ' });
  await grouped.validate();
  assert.equal(grouped.choiceGroup, 'elective-1');
  assert.equal(grouped.choiceRule, 'choose_one');
  assert.equal(grouped.choiceGroupLabel, undefined);

  const plain = new Subject({ name: 'B', subjectType: 'theory', category: 'core', semester });
  await plain.validate();
  assert.equal(plain.choiceGroup, undefined);
  assert.equal(plain.choiceGroupLabel, undefined);
  assert.equal(plain.choiceRule, undefined);
});

test('model: a label or rule without a group, a bad rule or a bad group identifier fails validation', async () => {
  const semester = new mongoose.Types.ObjectId();
  const base = { name: 'A', subjectType: 'theory', category: 'core', semester };
  await assert.rejects(new Subject({ ...base, choiceGroupLabel: 'Label only' }).validate(), (err) => 'choiceGroupLabel' in err.errors);
  await assert.rejects(new Subject({ ...base, choiceRule: 'choose_one' }).validate(), (err) => 'choiceRule' in err.errors);
  await assert.rejects(new Subject({ ...base, choiceGroup: 'g', choiceRule: 'pick_any' }).validate(), (err) => 'choiceRule' in err.errors);
  await assert.rejects(new Subject({ ...base, choiceGroup: 'has space' }).validate(), (err) => 'choiceGroup' in err.errors);
});

// ---------------------------------------------------------------- admin: create

test('create without a choice group works exactly as before (no choice fields stored or returned)', async () => {
  const { sem1 } = await makeSetup();
  const result = await createSubject(sem1._id);
  assert.equal(result.status, 201);
  const subject = result.json.data.subject;
  for (const field of ['choiceGroup', 'choiceGroupLabel', 'choiceRule']) assert.equal(field in subject, false, field);
  assert.equal(subject.name, 'Sample Subject');
  assert.equal(subject.isActive, true);
  assert.equal('choiceGroup' in subjectDocs()[0], false);
});

test('null or blank choice fields are the same as leaving them out', async () => {
  const { sem1 } = await makeSetup();
  const result = await createSubject(sem1._id, { choiceGroup: null, choiceGroupLabel: '  ', choiceRule: null });
  assert.equal(result.status, 201);
  assert.equal('choiceGroup' in result.json.data.subject, false);
  assert.equal('choiceRule' in result.json.data.subject, false);
});

test('create with a choice group: identifier is normalised and the rule defaults to choose_one', async () => {
  const { sem1 } = await makeSetup();
  const result = await createSubject(sem1._id, { choiceGroup: '  Elective-1 ', choiceGroupLabel: '  Elective   I  ', category: 'elective' });
  assert.equal(result.status, 201);
  const subject = result.json.data.subject;
  assert.equal(subject.choiceGroup, 'elective-1');
  assert.equal(subject.choiceGroupLabel, 'Elective I');
  assert.equal(subject.choiceRule, 'choose_one');
});

test('create with choose_multiple and without a label', async () => {
  const { sem1 } = await makeSetup();
  const result = await createSubject(sem1._id, { choiceGroup: 'skill-pool', choiceRule: ' CHOOSE_MULTIPLE ' });
  assert.equal(result.status, 201);
  assert.equal(result.json.data.subject.choiceRule, 'choose_multiple');
  assert.equal('choiceGroupLabel' in result.json.data.subject, false);
});

test('elective alternatives share one group; compulsory and other-group subjects live beside them', async () => {
  const { sem1 } = await makeSetup();
  for (const n of [1, 2, 3]) assert.equal((await post('/api/admin/subjects', electiveBody(sem1._id, n))).status, 201);
  assert.equal((await createSubject(sem1._id, { name: 'Compulsory', subjectCode: 'CP1' })).status, 201);
  assert.equal((await post('/api/admin/subjects', electiveBody(sem1._id, 4, { choiceGroup: 'elective-2', choiceGroupLabel: 'Elective II', choiceRule: 'choose_multiple' }))).status, 201);

  const list = await call(`/api/admin/subjects?semester=${sem1._id}`);
  const grouped = list.json.data.subjects.filter((s) => s.choiceGroup === 'elective-1');
  assert.equal(grouped.length, 3);
  assert.deepEqual([...new Set(grouped.map((s) => `${s.choiceGroupLabel}|${s.choiceRule}`))], ['Elective I|choose_one']);
});

test('the same group identifier may be reused in another semester with its own label and rule', async () => {
  const { sem1, sem2 } = await makeSetup();
  assert.equal((await post('/api/admin/subjects', electiveBody(sem1._id, 1))).status, 201);
  const other = await post('/api/admin/subjects', electiveBody(sem2._id, 1, { choiceGroupLabel: 'Something else', choiceRule: 'choose_multiple' }));
  assert.equal(other.status, 201);
});

// ---------------------------------------------------------------- admin: invalid data

test('invalid choice-group values are rejected with per-field 400 errors and nothing is stored', async () => {
  const { sem1 } = await makeSetup();
  const cases = [
    [{ choiceGroupLabel: 'Label only' }, ['choiceGroupLabel']],
    [{ choiceRule: 'choose_one' }, ['choiceRule']],
    [{ choiceGroupLabel: 'L', choiceRule: 'choose_one' }, ['choiceGroupLabel', 'choiceRule']],
    [{ choiceGroup: 'g1', choiceRule: 'pick_any' }, ['choiceRule']],
    [{ choiceGroup: 'g1', choiceRule: 5 }, ['choiceRule']],
    [{ choiceGroup: 'has space' }, ['choiceGroup']],
    [{ choiceGroup: 'bad/slash' }, ['choiceGroup']],
    [{ choiceGroup: '-leading' }, ['choiceGroup']],
    [{ choiceGroup: 'x'.repeat(51) }, ['choiceGroup']],
    [{ choiceGroup: 123 }, ['choiceGroup']],
    [{ choiceGroup: { $ne: null } }, ['choiceGroup']],
    [{ choiceGroup: 'g1', choiceGroupLabel: 'x'.repeat(101) }, ['choiceGroupLabel']],
    [{ choiceGroup: 'g1', choiceGroupLabel: ['a'] }, ['choiceGroupLabel']],
  ];
  for (const [over, fields] of cases) {
    const result = await createSubject(sem1._id, over);
    assert.equal(result.status, 400, JSON.stringify(over));
    assert.deepEqual(fieldsOf(result), fields, JSON.stringify(over));
  }
  assert.equal(subjectDocs().length, 0);
});

test('a subject that disagrees with its group on label or rule is rejected (400) and not stored', async () => {
  const { sem1 } = await makeSetup();
  await post('/api/admin/subjects', electiveBody(sem1._id, 1));

  const label = await post('/api/admin/subjects', electiveBody(sem1._id, 2, { choiceGroupLabel: 'Different label' }));
  assert.equal(label.status, 400);
  assert.deepEqual(fieldsOf(label), ['choiceGroupLabel']);

  const noLabel = await post('/api/admin/subjects', electiveBody(sem1._id, 2, { choiceGroupLabel: null }));
  assert.equal(noLabel.status, 400);

  const rule = await post('/api/admin/subjects', electiveBody(sem1._id, 2, { choiceRule: 'choose_multiple' }));
  assert.equal(rule.status, 400);
  assert.deepEqual(fieldsOf(rule), ['choiceRule']);

  const both = await post('/api/admin/subjects', electiveBody(sem1._id, 2, { choiceGroupLabel: 'X', choiceRule: 'choose_multiple' }));
  assert.deepEqual(fieldsOf(both), ['choiceGroupLabel', 'choiceRule']);

  // Label comparison ignores case and repeated spaces.
  const sameLabel = await post('/api/admin/subjects', electiveBody(sem1._id, 2, { choiceGroupLabel: '  elective   i ' }));
  assert.equal(sameLabel.status, 201);
  assert.equal(subjectDocs().length, 2);
});

test('the default rule counts: a later subject cannot silently switch a choose_multiple group to choose_one', async () => {
  const { sem1 } = await makeSetup();
  await post('/api/admin/subjects', electiveBody(sem1._id, 1, { choiceRule: 'choose_multiple' }));
  const result = await post('/api/admin/subjects', electiveBody(sem1._id, 2)); // rule omitted -> choose_one
  assert.equal(result.status, 400);
  assert.deepEqual(fieldsOf(result), ['choiceRule']);
});

test('unknown fields are still refused on subjects', async () => {
  const { sem1 } = await makeSetup();
  const result = await createSubject(sem1._id, { choiceGroups: 'x' });
  assert.equal(result.status, 400);
  assert.deepEqual(fieldsOf(result), ['choiceGroups']);
});

// ---------------------------------------------------------------- admin: update

test('update: add a subject to a group, change it, then clear it (clearing also clears label and rule)', async () => {
  const { sem1 } = await makeSetup();
  const id = (await createSubject(sem1._id)).json.data.subject._id;

  const added = await put(`/api/admin/subjects/${id}`, { choiceGroup: 'elective-1', choiceGroupLabel: 'Elective I', choiceRule: 'choose_multiple' });
  assert.equal(added.status, 200);
  assert.deepEqual(
    [added.json.data.subject.choiceGroup, added.json.data.subject.choiceGroupLabel, added.json.data.subject.choiceRule],
    ['elective-1', 'Elective I', 'choose_multiple']
  );

  const renamed = await put(`/api/admin/subjects/${id}`, { name: 'Renamed' });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.json.data.subject.choiceGroup, 'elective-1');

  const cleared = await put(`/api/admin/subjects/${id}`, { choiceGroup: null });
  assert.equal(cleared.status, 200);
  for (const field of ['choiceGroup', 'choiceGroupLabel', 'choiceRule']) assert.equal(field in cleared.json.data.subject, false, field);
  assert.equal(cleared.json.data.subject.name, 'Renamed');
});

test('update: label or rule on a subject without a group is rejected; a group alone defaults the rule', async () => {
  const { sem1 } = await makeSetup();
  const id = (await createSubject(sem1._id)).json.data.subject._id;
  const label = await put(`/api/admin/subjects/${id}`, { choiceGroupLabel: 'Label only' });
  assert.equal(label.status, 400);
  assert.deepEqual(fieldsOf(label), ['choiceGroupLabel']);
  const rule = await put(`/api/admin/subjects/${id}`, { choiceRule: 'choose_one' });
  assert.equal(rule.status, 400);

  const grouped = await put(`/api/admin/subjects/${id}`, { choiceGroup: 'pool' });
  assert.equal(grouped.status, 200);
  assert.equal(grouped.json.data.subject.choiceRule, 'choose_one');
});

test('update: changing the label or rule of ONE member to disagree with the group is rejected', async () => {
  const { sem1 } = await makeSetup();
  const a = (await post('/api/admin/subjects', electiveBody(sem1._id, 1))).json.data.subject;
  const b = (await post('/api/admin/subjects', electiveBody(sem1._id, 2))).json.data.subject;

  const label = await put(`/api/admin/subjects/${b._id}`, { choiceGroupLabel: 'Other' });
  assert.equal(label.status, 400);
  const rule = await put(`/api/admin/subjects/${b._id}`, { choiceRule: 'choose_multiple' });
  assert.equal(rule.status, 400);
  const joinWrong = await put(`/api/admin/subjects/${(await createSubject(sem1._id, { name: 'Z', subjectCode: 'Z1' })).json.data.subject._id}`, { choiceGroup: 'elective-1', choiceGroupLabel: 'Nope' });
  assert.equal(joinWrong.status, 400);

  // Nothing changed in the database.
  assert.equal(subjectDocs().find((d) => String(d._id) === b._id).choiceGroupLabel, 'Elective I');
  assert.equal(subjectDocs().find((d) => String(d._id) === a._id).choiceRule, 'choose_one');
});

test('update: a lone member may change the whole group definition; inactive members do not constrain a group', async () => {
  const { sem1 } = await makeSetup();
  const a = (await post('/api/admin/subjects', electiveBody(sem1._id, 1))).json.data.subject;
  const solo = await put(`/api/admin/subjects/${a._id}`, { choiceGroupLabel: 'Renamed group', choiceRule: 'choose_multiple' });
  assert.equal(solo.status, 200);

  assert.equal((await call(`/api/admin/subjects/${a._id}`, { method: 'DELETE' })).status, 200);
  const fresh = await post('/api/admin/subjects', electiveBody(sem1._id, 2, { choiceGroupLabel: 'Brand new label', choiceRule: 'choose_one' }));
  assert.equal(fresh.status, 201);

  // Re-activating the old member would now contradict the new definition of the group.
  const reactivate = await put(`/api/admin/subjects/${a._id}`, { isActive: true });
  assert.equal(reactivate.status, 400);
  assert.deepEqual(fieldsOf(reactivate), ['choiceGroupLabel', 'choiceRule']);
});

test('update: moving a subject to another semester checks the group of that semester', async () => {
  const { sem1, sem2 } = await makeSetup();
  await post('/api/admin/subjects', electiveBody(sem2._id, 1, { choiceGroupLabel: 'Semester 2 label' }));
  const mover = (await post('/api/admin/subjects', electiveBody(sem1._id, 2))).json.data.subject;
  const moved = await put(`/api/admin/subjects/${mover._id}`, { semester: sem2._id });
  assert.equal(moved.status, 400);
  assert.deepEqual(fieldsOf(moved), ['choiceGroupLabel']);
});

// ---------------------------------------------------------------- bulk import + dry run

test('dry run validates choice-group data and writes nothing', async () => {
  const setup = await makeSetup();
  const before = snapshot();
  let saves = 0;
  Subject.prototype.save = function countingSave(...args) {
    saves += 1;
    return fakeSave.apply(this, args);
  };
  const result = await runImport(setup, [
    electiveRecord(1),
    electiveRecord(2),
    electiveRecord(3, { choiceGroupLabel: 'Not the same' }),
    record({ name: 'Compulsory', subjectCode: 'CP1' }),
    electiveRecord(4, { subjectCode: 'EL104', choiceRule: 'pick_any' }),
  ]);
  assert.equal(result.status, 200);
  const data = result.json.data;
  assert.equal(data.dryRun, true);
  assert.deepEqual(data.results.map((r) => r.status), ['new', 'new', 'invalid', 'new', 'invalid']);
  assert.deepEqual(data.results[2].errors.map((e) => e.field), ['choiceGroupLabel']);
  assert.deepEqual(data.results[4].errors.map((e) => e.field), ['choiceRule']);
  assert.equal(data.newRecords, 3);
  assert.equal(data.invalidRecords, 2);
  assert.equal(data.imported, 0);
  assert.equal(saves, 0);
  assert.equal(snapshot(), before);
});

test('dry-run report echoes the choice fields only for grouped records (default rule applied)', async () => {
  const setup = await makeSetup();
  const data = (await runImport(setup, [electiveRecord(1), record({ name: 'Plain', subjectCode: 'PL1' })])).json.data;
  assert.deepEqual(
    [data.results[0].choiceGroup, data.results[0].choiceGroupLabel, data.results[0].choiceRule],
    ['elective-1', 'Elective I', 'choose_one']
  );
  for (const field of ['choiceGroup', 'choiceGroupLabel', 'choiceRule']) assert.equal(field in data.results[1], false, field);
});

test('real import stores the choice fields; a dry run before it predicted the same outcome', async () => {
  const setup = await makeSetup();
  const subjects = [
    electiveRecord(1, { choiceGroup: ' Elective-1 ' }),
    electiveRecord(2),
    electiveRecord(3, { choiceGroup: 'skill-pool', choiceGroupLabel: null, choiceRule: 'choose_multiple' }),
    record({ name: 'Compulsory', subjectCode: 'CP1' }),
  ];
  const dry = (await runImport(setup, subjects)).json.data;
  assert.deepEqual(dry.results.map((r) => r.status), ['new', 'new', 'new', 'new']);
  assert.equal(subjectDocs().length, 0);

  const real = (await runImport(setup, subjects, { dryRun: false })).json.data;
  assert.deepEqual(real.results.map((r) => r.status), ['imported', 'imported', 'imported', 'imported']);
  const docs = subjectDocs();
  assert.equal(docs.length, 4);
  const byCode = Object.fromEntries(docs.map((d) => [d.subjectCode, d]));
  assert.deepEqual([byCode.EL101.choiceGroup, byCode.EL101.choiceGroupLabel, byCode.EL101.choiceRule], ['elective-1', 'Elective I', 'choose_one']);
  assert.deepEqual([byCode.EL102.choiceGroup, byCode.EL102.choiceRule], ['elective-1', 'choose_one']);
  assert.deepEqual([byCode.EL103.choiceGroup, byCode.EL103.choiceRule], ['skill-pool', 'choose_multiple']);
  assert.equal('choiceGroupLabel' in byCode.EL103, false);
  for (const field of ['choiceGroup', 'choiceGroupLabel', 'choiceRule']) assert.equal(field in byCode.CP1, false, field);
});

test('real import: an inconsistent record is failed, the consistent ones are still imported', async () => {
  const setup = await makeSetup();
  const real = (await runImport(setup, [electiveRecord(1), electiveRecord(2, { choiceRule: 'choose_multiple' }), electiveRecord(3)], { dryRun: false })).json.data;
  assert.deepEqual(real.results.map((r) => r.status), ['imported', 'failed', 'imported']);
  assert.deepEqual(real.results[1].errors.map((e) => e.field), ['choiceRule']);
  assert.match(real.results[1].errors[0].message, /record 0/);
  assert.deepEqual(subjectDocs().map((d) => d.subjectCode).sort(), ['EL101', 'EL103']);
});

test('import checks a group against subjects already stored in that semester (and never changes them)', async () => {
  const setup = await makeSetup();
  const existing = (await post('/api/admin/subjects', electiveBody(setup.sem1._id, 9, { choiceRule: 'choose_multiple' }))).json.data.subject;
  const before = JSON.stringify(subjectDocs());

  const result = (await runImport(setup, [electiveRecord(1), electiveRecord(2, { choiceRule: 'choose_multiple' })], { dryRun: false })).json.data;
  assert.deepEqual(result.results.map((r) => r.status), ['failed', 'imported']);
  assert.match(result.results[0].errors[0].message, /existing subjects/);

  const stored = subjectDocs();
  assert.equal(stored.length, 2);
  assert.equal(JSON.stringify(stored.filter((d) => String(d._id) === existing._id)), JSON.stringify(JSON.parse(before)));
});

test('the same group id in another semester of the import has its own definition', async () => {
  const setup = await makeSetup();
  const data = (await runImport(setup, [
    electiveRecord(1),
    electiveRecord(2, { semesterNumber: 2, choiceGroupLabel: 'Other label', choiceRule: 'choose_multiple' }),
  ], { dryRun: false })).json.data;
  assert.deepEqual(data.results.map((r) => r.status), ['imported', 'imported']);
});

test('import: malformed choice fields invalidate only that record', async () => {
  const setup = await makeSetup();
  const data = (await runImport(setup, [
    record({ name: 'Label only', subjectCode: 'A1', choiceGroupLabel: 'Orphan' }),
    record({ name: 'Rule only', subjectCode: 'A2', choiceRule: 'choose_one' }),
    record({ name: 'Bad id', subjectCode: 'A3', choiceGroup: 'two words' }),
    record({ name: 'Bad rule', subjectCode: 'A4', choiceGroup: 'g', choiceRule: 'all' }),
    record({ name: 'Object', subjectCode: 'A5', choiceGroup: { $gt: '' } }),
    record({ name: 'Fine', subjectCode: 'A6', choiceGroup: 'g' }),
  ])).json.data;
  assert.deepEqual(data.results.map((r) => r.status), ['invalid', 'invalid', 'invalid', 'invalid', 'invalid', 'new']);
  assert.deepEqual(data.results.slice(0, 5).map((r) => r.errors.map((e) => e.field)), [['choiceGroupLabel'], ['choiceRule'], ['choiceGroup'], ['choiceRule'], ['choiceGroup']]);
  assert.equal(subjectDocs().length, 0);
});

test('import: duplicates are skipped before the group check, so re-running an import only skips', async () => {
  const setup = await makeSetup();
  const subjects = [electiveRecord(1), electiveRecord(2)];
  await runImport(setup, subjects, { dryRun: false });
  const before = snapshot();
  const again = (await runImport(setup, subjects, { dryRun: false })).json.data;
  assert.deepEqual(again.results.map((r) => r.status), ['skipped', 'skipped']);
  assert.equal(again.imported, 0);
  assert.equal(snapshot(), before);

  // A duplicate whose group data differs is still just a duplicate (the stored subject is never overwritten).
  const changed = (await runImport(setup, [electiveRecord(1, { choiceGroupLabel: 'Changed' })], { dryRun: false })).json.data;
  assert.equal(changed.results[0].status, 'skipped');
  assert.equal(snapshot(), before);
});

test('import without any choice fields behaves exactly as before', async () => {
  const setup = await makeSetup();
  const data = (await runImport(setup, [record(), record({ name: 'Other', subjectCode: 'OT1' })], { dryRun: false })).json.data;
  assert.deepEqual(data.results.map((r) => r.status), ['imported', 'imported']);
  assert.deepEqual(Object.keys(data.results[0]).sort(), ['category', 'index', 'name', 'semesterNumber', 'status', 'subjectCode', 'subjectId', 'subjectType']);
  for (const doc of subjectDocs()) {
    for (const field of ['choiceGroup', 'choiceGroupLabel', 'choiceRule']) assert.equal(field in doc, false, field);
  }
});

// ---------------------------------------------------------------- student API

test('student API: ungrouped subjects keep their exact payload and choiceGroups is empty', async () => {
  const { sem1 } = await makeSetup();
  await createSubject(sem1._id);
  const result = await studentGet(`/api/academic/semesters/${sem1._id}/subjects`);
  assert.equal(result.status, 200);
  assert.deepEqual(Object.keys(result.json.data.subjects[0]).sort(), ['_id', 'category', 'name', 'semester', 'subjectCode', 'subjectType']);
  assert.deepEqual(result.json.data.choiceGroups, []);
  assert.equal(result.json.meta.total, 1);
});

test('student API: grouped subjects carry their choice information and a per-group summary', async () => {
  const { sem1 } = await makeSetup();
  const ids = [];
  for (const n of [1, 2]) ids.push((await post('/api/admin/subjects', electiveBody(sem1._id, n))).json.data.subject._id);
  const pool = (await post('/api/admin/subjects', electiveBody(sem1._id, 3, { choiceGroup: 'skill-pool', choiceGroupLabel: null, choiceRule: 'choose_multiple' }))).json.data.subject._id;
  const plain = (await createSubject(sem1._id, { name: 'Compulsory', subjectCode: 'CP1' })).json.data.subject._id;

  const result = await studentGet(`/api/academic/semesters/${sem1._id}/subjects`);
  assert.equal(result.status, 200);
  const subjects = Object.fromEntries(result.json.data.subjects.map((s) => [s._id, s]));
  assert.equal(result.json.data.subjects.length, 4);

  assert.deepEqual(
    [subjects[ids[0]].choiceGroup, subjects[ids[0]].choiceGroupLabel, subjects[ids[0]].choiceRule],
    ['elective-1', 'Elective I', 'choose_one']
  );
  assert.equal(subjects[pool].choiceGroupLabel, null);
  assert.equal(subjects[pool].choiceRule, 'choose_multiple');
  for (const field of ['choiceGroup', 'choiceGroupLabel', 'choiceRule']) assert.equal(field in subjects[plain], false, field);
  assert.equal('isActive' in subjects[ids[0]], false);

  const groups = Object.fromEntries(result.json.data.choiceGroups.map((g) => [g.choiceGroup, g]));
  assert.equal(result.json.data.choiceGroups.length, 2);
  assert.deepEqual([...groups['elective-1'].subjectIds].sort(), [...ids].sort());
  assert.deepEqual(
    [groups['elective-1'].choiceGroupLabel, groups['elective-1'].choiceRule, groups['skill-pool'].choiceRule, groups['skill-pool'].choiceGroupLabel],
    ['Elective I', 'choose_one', 'choose_multiple', null]
  );
});

test('student API: inactive alternatives disappear from the list and the group summary; filters still work', async () => {
  const { sem1 } = await makeSetup();
  const a = (await post('/api/admin/subjects', electiveBody(sem1._id, 1))).json.data.subject._id;
  const b = (await post('/api/admin/subjects', electiveBody(sem1._id, 2))).json.data.subject._id;
  await createSubject(sem1._id, { name: 'Compulsory', subjectCode: 'CP1' });
  await call(`/api/admin/subjects/${b}`, { method: 'DELETE' });

  const all = (await studentGet(`/api/academic/semesters/${sem1._id}/subjects`)).json.data;
  assert.equal(all.subjects.length, 2);
  assert.deepEqual(all.choiceGroups[0].subjectIds, [a]);

  const electives = (await studentGet(`/api/academic/semesters/${sem1._id}/subjects?category=elective`)).json.data;
  assert.deepEqual(electives.subjects.map((s) => s._id), [a]);
  const core = (await studentGet(`/api/academic/semesters/${sem1._id}/subjects?category=core`)).json.data;
  assert.deepEqual(core.choiceGroups, []);
});

test('student API stays read-only and a student cannot touch the choice fields', async () => {
  const { sem1 } = await makeSetup();
  assert.equal((await call('/api/admin/subjects', { method: 'POST', token: studentToken, body: electiveBody(sem1._id, 1) })).status, 403);
  assert.equal((await call(`/api/academic/semesters/${sem1._id}/subjects`, { method: 'POST', token: studentToken, body: {} })).status, 405);
  assert.equal(subjectDocs().length, 0);
});

// ---------------------------------------------------------------- regression

test('regression: duplicate subject codes, deactivation and legacy-style subjects behave as before', async () => {
  const { sem1 } = await makeSetup();
  const first = await createSubject(sem1._id);
  assert.equal(first.status, 201);
  assert.equal((await createSubject(sem1._id)).status, 409);

  // Two code-less subjects in one semester are still fine; one with a group, one without.
  assert.equal((await createSubject(sem1._id, { subjectCode: undefined, name: 'No code A' })).status, 201);
  assert.equal((await createSubject(sem1._id, { subjectCode: undefined, name: 'No code B', choiceGroup: 'g' })).status, 201);

  // Deactivating a grouped / ungrouped subject works; a duplicate code is still a duplicate across groups.
  const del = await call(`/api/admin/subjects/${first.json.data.subject._id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal(del.json.data.subject.isActive, false);
  assert.equal((await createSubject(sem1._id, { choiceGroup: 'g' })).status, 409);
});

test('regression: a subject stored before this feature (no choice fields) can still be read, updated and deactivated', async () => {
  const { sem1 } = await makeSetup();
  const legacy = new Subject({ name: 'Legacy', subjectCode: 'LG1', subjectType: 'theory', category: 'core', semester: sem1._id });
  await legacy.save();
  const id = String(legacy._id);

  assert.equal((await call(`/api/admin/subjects/${id}`)).status, 200);
  const renamed = await put(`/api/admin/subjects/${id}`, { name: 'Legacy renamed' });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.json.data.subject._id, id);
  assert.equal('choiceGroup' in renamed.json.data.subject, false);
  assert.equal((await call(`/api/admin/subjects/${id}`, { method: 'DELETE' })).status, 200);
  assert.equal(subjectDocs().length, 1);
});

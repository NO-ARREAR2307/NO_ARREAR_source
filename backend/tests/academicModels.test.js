'use strict';

// Academic models (Phase 1A, updated for Phase 1C): University, Department, Regulation, Semester and Subject.
// No database is needed: validation runs in memory and the declared indexes are inspected.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'unit-test-secret-unit-test-secret-1234567890';
process.env.MONGO_URI = 'mongodb://localhost:27017/studywise_ai_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { University, Department, Regulation, Semester, Subject } = require('../models');
const { DEPARTMENT_LEVELS, SUBJECT_TYPES, SUBJECT_CATEGORIES } = require('../utils/academicEnums');

const id = () => new mongoose.Types.ObjectId();
const errorsOf = (doc) => {
  const err = doc.validateSync();
  return err ? Object.keys(err.errors) : [];
};
const indexOf = (Model, keys) =>
  Model.schema.indexes().find(([fields]) => JSON.stringify(fields) === JSON.stringify(keys));

test('each model has its own collection', () => {
  assert.equal(University.collection.name, 'universities');
  assert.equal(Department.collection.name, 'departments');
  assert.equal(Regulation.collection.name, 'regulations');
  assert.equal(Semester.collection.name, 'semesters');
  assert.equal(Subject.collection.name, 'subjects');
});

test('University: name required, code optional and normalised, defaults', () => {
  assert.deepEqual(errorsOf(new University({})), ['name']);
  const u = new University({ name: '  Anna University ', code: ' au ' });
  assert.deepEqual(errorsOf(u), []);
  assert.equal(u.name, 'Anna University');
  assert.equal(u.code, 'AU');
  assert.equal(u.isActive, true);
  assert.equal(new University({ name: 'X', code: '   ' }).code, undefined);
  assert.equal(new University({ name: 'X' }).description, undefined);
});

test('University: code is unique only when present', () => {
  const [, options] = indexOf(University, { code: 1 });
  assert.equal(options.unique, true);
  assert.deepEqual(options.partialFilterExpression, { code: { $type: 'string' } });
});

test('Department: requires name, code, university and level; unique code per university', () => {
  assert.deepEqual(errorsOf(new Department({})).sort(), ['code', 'level', 'name', 'university']);
  const d = new Department({ name: 'Computer Science', code: ' cse ', university: id(), level: 'UG' });
  assert.deepEqual(errorsOf(d), []);
  assert.equal(d.code, 'CSE');
  assert.equal(d.isActive, true);
  assert.equal(Department.schema.path('university').options.ref, 'University');
  assert.equal(indexOf(Department, { university: 1, code: 1 })[1].unique, true);
});

test('Department: level is UG or PG (case and spaces are normalised), anything else is rejected', () => {
  assert.deepEqual(DEPARTMENT_LEVELS, ['UG', 'PG']);
  for (const good of ['UG', 'PG', 'ug', ' pg ']) {
    const d = new Department({ name: 'X', code: 'X', university: id(), level: good });
    assert.deepEqual(errorsOf(d), [], `accept ${good}`);
    assert.equal(d.level, good.trim().toUpperCase());
  }
  for (const bad of ['', 'PhD', 'UGG', 'diploma', 5, null]) {
    assert.ok(errorsOf(new Department({ name: 'X', code: 'X', university: id(), level: bad })).includes('level'), `reject ${bad}`);
  }
});

test('Regulation: requires department and name; unique name per department; timestamps and isActive', () => {
  assert.deepEqual(errorsOf(new Regulation({})).sort(), ['department', 'name']);
  const r = new Regulation({ department: id(), name: '  2023-2024  ' });
  assert.deepEqual(errorsOf(r), []);
  assert.equal(r.name, '2023-2024');
  assert.equal(r.isActive, true);
  assert.ok(Regulation.schema.options.timestamps);
  assert.equal(Regulation.schema.path('department').options.ref, 'Department');
  assert.equal(indexOf(Regulation, { department: 1, name: 1 })[1].unique, true);
  assert.ok(errorsOf(new Regulation({ department: id(), name: 'R'.repeat(101) })).includes('name'));
  assert.ok(errorsOf(new Regulation({ department: id(), name: '   ' })).includes('name'));
});

test('Semester: number 1-8 whole, regulation required (not department), unique per regulation', () => {
  assert.deepEqual(errorsOf(new Semester({})).sort(), ['regulation', 'semesterNumber']);
  for (const bad of [0, 9, -1, 2.5, 'abc']) {
    assert.ok(errorsOf(new Semester({ semesterNumber: bad, regulation: id() })).includes('semesterNumber'), `reject ${bad}`);
  }
  for (const good of [1, 4, 8, '3']) {
    assert.deepEqual(errorsOf(new Semester({ semesterNumber: good, regulation: id() })), [], `accept ${good}`);
  }
  assert.equal(Semester.schema.path('regulation').options.ref, 'Regulation');
  assert.equal(Semester.schema.path('department'), undefined, 'the old department reference is gone');
  assert.equal(indexOf(Semester, { regulation: 1, semesterNumber: 1 })[1].unique, true);
  assert.equal(indexOf(Semester, { department: 1, semesterNumber: 1 }), undefined, 'the old index is no longer declared');
});

test('Semester: the unique index is partial so un-migrated legacy semesters never collide', () => {
  const [, options] = indexOf(Semester, { regulation: 1, semesterNumber: 1 });
  assert.deepEqual(options.partialFilterExpression, { regulation: { $type: 'objectId' } });
});

test('Subject: requires name, type, category and semester; the code is optional', () => {
  assert.deepEqual(errorsOf(new Subject({})).sort(), ['category', 'name', 'semester', 'subjectType']);
  const s = new Subject({ name: ' Data Structures ', subjectCode: ' cs201 ', subjectType: 'Theory', category: ' CORE ', semester: id() });
  assert.deepEqual(errorsOf(s), []);
  assert.equal(s.subjectCode, 'CS201');
  assert.equal(s.subjectType, 'theory');
  assert.equal(s.category, 'core');
  assert.equal(s.isActive, true);
  assert.equal(Subject.schema.path('semester').options.ref, 'Semester');
  assert.equal(indexOf(Subject, { semester: 1, subjectCode: 1 })[1].unique, true);
});

test('Subject: subjectCode is optional; blank and missing codes are stored as "no code"', () => {
  const base = { name: 'Environmental Studies', subjectType: 'theory', category: 'ability_enhancement', semester: id() };
  for (const code of [undefined, '', '   ', null]) {
    const s = new Subject({ ...base, subjectCode: code });
    assert.deepEqual(errorsOf(s), [], `accept ${JSON.stringify(code)}`);
    assert.equal(s.subjectCode == null, true, `no code stored for ${JSON.stringify(code)}`);
  }
  assert.ok(errorsOf(new Subject({ ...base, subjectCode: 'C'.repeat(21) })).includes('subjectCode'));
});

test('Subject: the unique index is partial, covering only subjects that have a code', () => {
  const [, options] = indexOf(Subject, { semester: 1, subjectCode: 1 });
  assert.equal(options.unique, true);
  assert.deepEqual(options.partialFilterExpression, { subjectCode: { $type: 'string' } });
});

test('Subject: every allowed type and category is accepted, anything else is rejected', () => {
  const base = { name: 'X', semester: id() };
  for (const subjectType of SUBJECT_TYPES) {
    assert.deepEqual(errorsOf(new Subject({ ...base, subjectType, category: 'core' })), [], subjectType);
  }
  for (const category of SUBJECT_CATEGORIES) {
    assert.deepEqual(errorsOf(new Subject({ ...base, subjectType: 'theory', category })), [], category);
  }
  for (const bad of ['', 'lab', 'THEORY2', 7, null]) {
    assert.ok(errorsOf(new Subject({ ...base, subjectType: bad, category: 'core' })).includes('subjectType'), `type ${bad}`);
    assert.ok(errorsOf(new Subject({ ...base, subjectType: 'theory', category: bad })).includes('category'), `category ${bad}`);
  }
});

test('references are ObjectIds and nothing academic is embedded', () => {
  const ObjectIdType = mongoose.Schema.Types.ObjectId;
  assert.ok(Department.schema.path('university') instanceof ObjectIdType);
  assert.ok(Regulation.schema.path('department') instanceof ObjectIdType);
  assert.ok(Semester.schema.path('regulation') instanceof ObjectIdType);
  assert.ok(Subject.schema.path('semester') instanceof ObjectIdType);
  for (const Model of [University, Department, Regulation, Semester, Subject]) {
    for (const [name, type] of Object.entries(Model.schema.paths)) {
      assert.ok(!['Array', 'Embedded', 'DocumentArray', 'Subdocument'].includes(type.instance), `${Model.modelName}.${name} must not be embedded`);
    }
    assert.ok(Model.schema.options.timestamps);
  }
});

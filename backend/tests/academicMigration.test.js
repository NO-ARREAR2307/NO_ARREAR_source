'use strict';

// Migration safety (Phase 1C): services/academicMigrationService.js moves pre-Phase-1C academic data to
// the regulation structure. No database is needed: native collections are replaced by an in-memory
// stand-in that records every write.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'unit-test-secret-unit-test-secret-1234567890';
process.env.MONGO_URI = 'mongodb://localhost:27017/studywise_ai_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const FakeNativeCollection = require('./helpers/fakeNativeCollection');
const { migrateAcademicData, LEGACY_SEMESTER_INDEX } = require('../services/academicMigrationService');

const id = () => new mongoose.Types.ObjectId();
const snapshot = (db) => JSON.stringify(Object.values(db).map((collection) => collection.docs));
const writesOf = (db) => Object.values(db).flatMap((collection) => collection.writes);

// A pre-Phase-1C database: departments without a level, semesters pointing at a department, subjects
// without a type or category. Built in the test, never seeded by the application.
const legacyDb = () => {
  const universityId = id();
  const cs = { _id: id(), name: 'Computer Science', code: 'CS', university: universityId, isActive: true };
  const maths = { _id: id(), name: 'Mathematics', code: 'MA', university: universityId, isActive: true };
  const csSem1 = { _id: id(), semesterNumber: 1, department: cs._id, isActive: true };
  const csSem2 = { _id: id(), semesterNumber: 2, department: cs._id, isActive: true };
  const mathsSem1 = { _id: id(), semesterNumber: 1, department: maths._id, isActive: true };
  const subjectA = { _id: id(), name: 'Data Structures', subjectCode: 'CS101', semester: csSem1._id, isActive: true };
  const subjectB = { _id: id(), name: 'Calculus', subjectCode: '  ', semester: mathsSem1._id, isActive: true };
  const db = {
    departments: new FakeNativeCollection([cs, maths]),
    regulations: new FakeNativeCollection([]),
    semesters: new FakeNativeCollection([csSem1, csSem2, mathsSem1], [LEGACY_SEMESTER_INDEX]),
    subjects: new FakeNativeCollection([subjectA, subjectB]),
  };
  return { db, cs, maths, csSem1, csSem2, mathsSem1, subjectA, subjectB };
};

test('a dry run (the default) reports everything and writes nothing', async () => {
  const { db, cs } = legacyDb();
  const before = snapshot(db);
  const report = await migrateAcademicData(db, { defaultLevel: 'UG', defaultRegulation: '2023-2024' });

  assert.equal(report.mode, 'dry-run');
  assert.equal(snapshot(db), before, 'documents are untouched');
  assert.deepEqual(writesOf(db), [], 'no write of any kind');
  assert.equal(report.departments.levelSet.length, 2);
  assert.equal(report.regulations.created.length, 2);
  assert.equal(report.semesters.migrated.length, 3);
  assert.equal(report.indexes.legacySemesterIndexPresent, true);
  assert.equal(report.indexes.legacySemesterIndexDropped, false);
  assert.equal(db.semesters.indexNames.includes(LEGACY_SEMESTER_INDEX), true);
  assert.ok(cs);
});

test('nothing is guessed: without a level or regulation name the records are reported and left untouched', async () => {
  const { db, cs } = legacyDb();
  const before = snapshot(db);
  const report = await migrateAcademicData(db, { apply: true });

  assert.equal(report.departments.needLevel.length, 2);
  assert.equal(report.semesters.needRegulationName.length, 2);
  assert.deepEqual(report.semesters.needRegulationName.find((x) => x.department === String(cs._id)).semesters, [1, 2]);
  assert.equal(report.regulations.created.length, 0, 'no regulation is invented');
  assert.equal(report.needsAttention, true);
  // Only the blank-code normalisation and the obsolete index drop are allowed to happen.
  assert.deepEqual(db.departments.writes, []);
  assert.deepEqual(db.regulations.writes, []);
  assert.deepEqual(db.semesters.writes.map((w) => w.op), ['dropIndex']);
  assert.deepEqual(db.semesters.docs.filter((s) => s.regulation), []);
  assert.notEqual(snapshot(db), before, 'the blank subject code was normalised');
});

test('apply with explicit values: regulations are created per department and semesters are attached, nothing is deleted', async () => {
  const { db, cs, maths, csSem1, csSem2, mathsSem1 } = legacyDb();
  const counts = Object.fromEntries(Object.entries(db).map(([name, c]) => [name, c.docs.length]));

  const report = await migrateAcademicData(db, {
    apply: true,
    levelMap: { [cs._id]: 'ug', [maths._id]: 'PG' },
    regulationMap: { [cs._id]: ' 2023-2024 ', [maths._id]: 'R2021' },
  });

  assert.equal(report.mode, 'apply');
  assert.equal(report.needsAttention, true, 'subjects still lack a type and category');
  assert.equal(db.departments.docs.find((d) => String(d._id) === String(cs._id)).level, 'UG');
  assert.equal(db.departments.docs.find((d) => String(d._id) === String(maths._id)).level, 'PG');

  assert.equal(db.regulations.docs.length, 2);
  const csReg = db.regulations.docs.find((r) => String(r.department) === String(cs._id));
  const mathsReg = db.regulations.docs.find((r) => String(r.department) === String(maths._id));
  assert.equal(csReg.name, '2023-2024');
  assert.equal(mathsReg.name, 'R2021');
  assert.equal(csReg.isActive, true);

  const semester = (doc) => db.semesters.docs.find((s) => String(s._id) === String(doc._id));
  assert.equal(String(semester(csSem1).regulation), String(csReg._id));
  assert.equal(String(semester(csSem2).regulation), String(csReg._id));
  assert.equal(String(semester(mathsSem1).regulation), String(mathsReg._id));
  // The legacy reference is kept, never removed.
  assert.equal(String(semester(csSem1).department), String(cs._id));

  assert.equal(db.departments.docs.length, counts.departments);
  assert.equal(db.semesters.docs.length, counts.semesters);
  assert.equal(db.subjects.docs.length, counts.subjects);
  assert.equal(writesOf(db).filter((w) => w.op.startsWith('delete')).length, 0);

  assert.equal(report.indexes.legacySemesterIndexDropped, true);
  assert.equal(db.semesters.indexNames.includes(LEGACY_SEMESTER_INDEX), false);
});

test('subjects without a type or category are only reported, never filled in; blank codes are cleared', async () => {
  const { db, subjectA, subjectB } = legacyDb();
  const report = await migrateAcademicData(db, { apply: true });

  assert.deepEqual(report.subjects.missingTypeOrCategory.map((s) => s.subject).sort(), [String(subjectA._id), String(subjectB._id)].sort());
  assert.ok(db.subjects.docs.every((s) => s.subjectType === undefined && s.category === undefined), 'no fake type or category');
  const a = db.subjects.docs.find((s) => String(s._id) === String(subjectA._id));
  const b = db.subjects.docs.find((s) => String(s._id) === String(subjectB._id));
  assert.equal(a.subjectCode, 'CS101', 'real codes are never changed');
  assert.equal('subjectCode' in b, false, 'a blank code is stored as "no code"');
  assert.equal(db.subjects.docs.length, 2);
});

test('the migration is idempotent: a second run changes nothing', async () => {
  const { db, cs, maths } = legacyDb();
  const options = { apply: true, defaultLevel: 'UG', regulationMap: { [cs._id]: 'R1', [maths._id]: 'R1' } };
  await migrateAcademicData(db, options);
  const after = snapshot(db);
  const writes = writesOf(db).length;

  const again = await migrateAcademicData(db, options);
  assert.equal(snapshot(db), after);
  assert.equal(writesOf(db).length, writes, 'no new write');
  assert.equal(again.semesters.legacy, 0);
  assert.equal(again.regulations.created.length, 0);
  assert.equal(again.indexes.legacySemesterIndexPresent, false);
});

test('an existing regulation is reused, and a semester number that already exists there is a conflict, not an overwrite', async () => {
  const { db, cs, csSem1, csSem2 } = legacyDb();
  const existing = { _id: id(), department: cs._id, name: 'R1', isActive: true };
  const alreadyThere = { _id: id(), semesterNumber: 1, regulation: existing._id, isActive: true };
  db.regulations = new FakeNativeCollection([existing]);
  db.semesters = new FakeNativeCollection([...db.semesters.docs, alreadyThere], [LEGACY_SEMESTER_INDEX]);

  const report = await migrateAcademicData(db, { apply: true, regulationMap: { [cs._id]: 'R1' } });

  assert.equal(db.regulations.docs.filter((r) => String(r.department) === String(cs._id)).length, 1, 'no duplicate regulation');
  assert.equal(report.regulations.reused.length, 1);
  assert.deepEqual(report.semesters.conflicts.map((c) => c.semester), [String(csSem1._id)]);
  assert.equal(db.semesters.docs.find((s) => String(s._id) === String(csSem1._id)).regulation, undefined, 'the conflicting semester is untouched');
  assert.equal(String(db.semesters.docs.find((s) => String(s._id) === String(csSem2._id)).regulation), String(existing._id));
  assert.equal(report.needsAttention, true);
});

test('semesters whose department no longer exists are reported as orphaned and left untouched', async () => {
  const { db } = legacyDb();
  const orphan = { _id: id(), semesterNumber: 3, department: id(), isActive: true };
  db.semesters = new FakeNativeCollection([...db.semesters.docs, orphan], [LEGACY_SEMESTER_INDEX]);
  const report = await migrateAcademicData(db, { apply: true, defaultLevel: 'UG', defaultRegulation: 'R1' });

  assert.deepEqual(report.semesters.orphaned.map((o) => o.semester), [String(orphan._id)]);
  assert.equal(db.semesters.docs.find((s) => String(s._id) === String(orphan._id)).regulation, undefined);
  assert.equal(report.semesters.migrated.length, 3);
});

test('an invalid level or regulation name aborts before anything is written', async () => {
  const { db, cs } = legacyDb();
  const bad = [
    { apply: true, defaultLevel: 'PhD' },
    { apply: true, levelMap: { [cs._id]: 'xx' } },
    { apply: true, defaultRegulation: '   ' },
    { apply: true, regulationMap: { [cs._id]: 'R'.repeat(101) } },
  ];
  for (const options of bad) {
    await assert.rejects(migrateAcademicData(db, options), (err) => err.code === 'INVALID_MIGRATION_OPTIONS');
  }
  assert.deepEqual(writesOf(db), []);
});

test('an inactive department gets an inactive regulation, so nothing becomes visible by migrating', async () => {
  const { db, cs } = legacyDb();
  db.departments = new FakeNativeCollection(db.departments.docs.map((d) => (String(d._id) === String(cs._id) ? { ...d, isActive: false } : d)));
  await migrateAcademicData(db, { apply: true, defaultLevel: 'UG', defaultRegulation: 'R1' });
  const csReg = db.regulations.docs.find((r) => String(r.department) === String(cs._id));
  assert.equal(csReg.isActive, false);
});

test('an empty database migrates cleanly and creates nothing (no seed data)', async () => {
  const db = {
    departments: new FakeNativeCollection([]),
    regulations: new FakeNativeCollection([]),
    semesters: new FakeNativeCollection([]),
    subjects: new FakeNativeCollection([]),
  };
  const report = await migrateAcademicData(db, { apply: true });
  assert.equal(report.needsAttention, false);
  assert.deepEqual(writesOf(db), []);
  assert.ok(Object.values(db).every((collection) => collection.docs.length === 0));
});

test('migrated data satisfies the new Mongoose schemas once type and category are supplied', async () => {
  const { Department, Regulation, Semester } = require('../models');
  const { db, cs, csSem1 } = legacyDb();
  await migrateAcademicData(db, { apply: true, defaultLevel: 'UG', defaultRegulation: 'R1' });
  const department = Department.hydrate(db.departments.docs.find((d) => String(d._id) === String(cs._id)));
  const semester = Semester.hydrate(db.semesters.docs.find((s) => String(s._id) === String(csSem1._id)));
  const regulation = Regulation.hydrate(db.regulations.docs.find((r) => String(r.department) === String(cs._id)));
  for (const doc of [department, semester, regulation]) assert.equal(doc.validateSync(), undefined);
});

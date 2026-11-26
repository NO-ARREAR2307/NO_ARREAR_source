'use strict';

const { DEPARTMENT_LEVELS, SUBJECT_TYPES, SUBJECT_CATEGORIES } = require('../utils/academicEnums');

// Migration of pre-Phase-1C academic data to the University -> Department -> Regulation -> Semester ->
// Subject structure. Used by scripts/migrateAcademicSchema.js.
//
// Safety rules (all enforced here and covered by tests/academicMigration.test.js):
//  - DRY RUN by default: nothing is written unless { apply: true }.
//  - Nothing is ever deleted. Documents are only updated; the legacy `department` field of an old
//    semester is left in place. Only the obsolete semester index is dropped (an index, not data).
//  - Nothing is guessed or invented. A department level and a regulation name must be supplied by the
//    operator (per department, or one explicit value for all). Without them the record is reported and
//    left untouched. Subject type and category are never filled in; such subjects are only reported.
//  - A semester is never overwritten or merged: if the target regulation already has that semester
//    number, the old semester is reported as a conflict and left untouched.
//  - Re-running is safe: already migrated records are recognised and skipped.
//
// `db` is { departments, regulations, semesters, subjects }: native MongoDB collections (for example
// mongoose.connection.collection('semesters')). Native access is used on purpose, because the legacy
// fields are no longer part of the Mongoose schemas.

const LEGACY_SEMESTER_INDEX = 'department_1_semesterNumber_1';

const isBlank = (value) => typeof value === 'string' && value.trim() === '';
const idOf = (value) => String(value);

const validateOptions = (options) => {
  const problems = [];
  const checkLevel = (level, where) => {
    if (typeof level !== 'string' || !DEPARTMENT_LEVELS.includes(level.trim().toUpperCase())) {
      problems.push(`${where}: level must be one of ${DEPARTMENT_LEVELS.join(', ')}`);
    }
  };
  const checkName = (name, where) => {
    if (typeof name !== 'string' || name.trim() === '' || name.trim().length > 100) {
      problems.push(`${where}: regulation name must be 1-100 characters`);
    }
  };
  if (options.defaultLevel !== undefined) checkLevel(options.defaultLevel, 'defaultLevel');
  Object.entries(options.levelMap || {}).forEach(([id, level]) => checkLevel(level, `levelMap[${id}]`));
  if (options.defaultRegulation !== undefined) checkName(options.defaultRegulation, 'defaultRegulation');
  Object.entries(options.regulationMap || {}).forEach(([id, name]) => checkName(name, `regulationMap[${id}]`));
  if (problems.length > 0) {
    const error = new Error(`Invalid migration options:\n - ${problems.join('\n - ')}`);
    error.code = 'INVALID_MIGRATION_OPTIONS';
    throw error;
  }
};

const migrateAcademicData = async (db, options = {}) => {
  validateOptions(options);
  const apply = options.apply === true;
  const now = options.now || new Date();
  const levelMap = options.levelMap || {};
  const regulationMap = options.regulationMap || {};

  const report = {
    mode: apply ? 'apply' : 'dry-run',
    departments: { total: 0, needLevel: [], levelSet: [] },
    regulations: { created: [], reused: [] },
    semesters: { legacy: 0, migrated: [], needRegulationName: [], orphaned: [], conflicts: [] },
    subjects: { missingTypeOrCategory: [], blankCodesCleared: [], orphaned: [] },
    indexes: { legacySemesterIndexPresent: false, legacySemesterIndexDropped: false },
  };

  const departments = await db.departments.find({}).toArray();
  const departmentById = new Map(departments.map((d) => [idOf(d._id), d]));
  report.departments.total = departments.length;

  // 1. Department level: only from an explicit mapping, never guessed.
  for (const department of departments) {
    if (typeof department.level === 'string' && DEPARTMENT_LEVELS.includes(department.level)) continue;
    const chosen = levelMap[idOf(department._id)] !== undefined ? levelMap[idOf(department._id)] : options.defaultLevel;
    if (chosen === undefined) {
      report.departments.needLevel.push({ department: idOf(department._id), name: department.name });
      continue;
    }
    const level = chosen.trim().toUpperCase();
    if (apply) await db.departments.updateOne({ _id: department._id }, { $set: { level, updatedAt: now } });
    department.level = level;
    report.departments.levelSet.push({ department: idOf(department._id), level });
  }

  // 2. Semesters without a regulation: attach them to a regulation named by the operator.
  const semesters = await db.semesters.find({}).toArray();
  const legacySemesters = semesters.filter((s) => !s.regulation);
  report.semesters.legacy = legacySemesters.length;

  const byDepartment = new Map();
  for (const semester of legacySemesters) {
    const key = semester.department ? idOf(semester.department) : '';
    if (!byDepartment.has(key)) byDepartment.set(key, []);
    byDepartment.get(key).push(semester);
  }

  const regulations = await db.regulations.find({}).toArray();

  for (const [departmentKey, group] of byDepartment) {
    const department = departmentById.get(departmentKey);
    if (!department) {
      group.forEach((s) => report.semesters.orphaned.push({ semester: idOf(s._id), semesterNumber: s.semesterNumber, department: departmentKey || null }));
      continue;
    }
    const chosenName = regulationMap[departmentKey] !== undefined ? regulationMap[departmentKey] : options.defaultRegulation;
    if (chosenName === undefined) {
      report.semesters.needRegulationName.push({
        department: departmentKey,
        name: department.name,
        semesters: group.map((s) => s.semesterNumber).sort((a, b) => a - b),
      });
      continue;
    }

    const name = chosenName.trim();
    let regulation = regulations.find((r) => idOf(r.department) === departmentKey && r.name === name);
    if (regulation) {
      report.regulations.reused.push({ regulation: idOf(regulation._id), department: departmentKey, name });
    } else {
      regulation = {
        department: department._id,
        name,
        isActive: department.isActive !== false,
        createdAt: now,
        updatedAt: now,
      };
      if (apply) {
        const result = await db.regulations.insertOne(regulation);
        regulation._id = result.insertedId;
      }
      regulations.push(regulation);
      report.regulations.created.push({ regulation: regulation._id ? idOf(regulation._id) : null, department: departmentKey, name });
    }

    for (const semester of group) {
      const clash = semesters.find(
        (other) => other.regulation && regulation._id && idOf(other.regulation) === idOf(regulation._id) && other.semesterNumber === semester.semesterNumber
      );
      if (clash) {
        report.semesters.conflicts.push({ semester: idOf(semester._id), semesterNumber: semester.semesterNumber, existingSemester: idOf(clash._id) });
        continue;
      }
      if (apply) await db.semesters.updateOne({ _id: semester._id }, { $set: { regulation: regulation._id, updatedAt: now } });
      if (regulation._id) semester.regulation = regulation._id;
      report.semesters.migrated.push({ semester: idOf(semester._id), semesterNumber: semester.semesterNumber, regulation: regulation._id ? idOf(regulation._id) : null });
    }
  }

  // 3. Subjects: report what needs an admin decision; only normalise blank codes (a blank string would
  // otherwise be indexed as a real code and clash with other blanks).
  const semesterIds = new Set(semesters.map((s) => idOf(s._id)));
  const subjects = await db.subjects.find({}).toArray();
  for (const subject of subjects) {
    if (!SUBJECT_TYPES.includes(subject.subjectType) || !SUBJECT_CATEGORIES.includes(subject.category)) {
      report.subjects.missingTypeOrCategory.push({ subject: idOf(subject._id), name: subject.name });
    }
    if (!subject.semester || !semesterIds.has(idOf(subject.semester))) {
      report.subjects.orphaned.push({ subject: idOf(subject._id), name: subject.name });
    }
    if (isBlank(subject.subjectCode)) {
      if (apply) await db.subjects.updateOne({ _id: subject._id }, { $unset: { subjectCode: '' }, $set: { updatedAt: now } });
      report.subjects.blankCodesCleared.push({ subject: idOf(subject._id) });
    }
  }

  // 4. The obsolete {department, semesterNumber} unique index would reject new semesters (they have no
  // department). Dropping an index never touches documents.
  const indexes = await db.semesters.indexes();
  if (indexes.some((index) => index.name === LEGACY_SEMESTER_INDEX)) {
    report.indexes.legacySemesterIndexPresent = true;
    if (apply) {
      await db.semesters.dropIndex(LEGACY_SEMESTER_INDEX);
      report.indexes.legacySemesterIndexDropped = true;
    }
  }

  report.needsAttention =
    report.departments.needLevel.length +
      report.semesters.needRegulationName.length +
      report.semesters.orphaned.length +
      report.semesters.conflicts.length +
      report.subjects.missingTypeOrCategory.length +
      report.subjects.orphaned.length >
    0;
  return report;
};

module.exports = { migrateAcademicData, LEGACY_SEMESTER_INDEX };

'use strict';

const { Department, Regulation, Semester, Subject } = require('../models');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { validateImportRecord } = require('../validators/academicImportValidators');
const { groupConflicts } = require('../utils/choiceGroups');

// Academic Subject Bulk Import (Part 1): subjects only. University, department, regulation and semesters
// must already exist; this service never creates, changes, deactivates or deletes any of them, and it
// never touches an existing subject. The ONLY write it can make is inserting a new Subject.
//
// Both modes run the exact same analysis, so a dry-run preview and the real import can never disagree:
//   1. department / regulation checks (exist, regulation belongs to the department, both active)
//   2. every record is validated (shape, enums, lengths, unknown fields)
//   3. its semester is resolved from regulationId + semesterNumber (client-supplied semester ids do not exist)
//   4. duplicates are detected against the database AND earlier records of the same request
// A dry run stops after the analysis. An import then inserts the records classified as "new", one by one,
// so one failing record never stops or rolls back the others, and reports exactly what happened to each.
//
// Duplicate rules (always within ONE semester; the same code in another semester is NOT a duplicate):
//   - record WITH a code:    duplicate when the semester already has that code (case-insensitive; inactive
//                            subjects count too, matching the unique index).
//   - record WITHOUT a code: its identity is its name. Duplicate when the semester already has a subject
//                            with the same name (ignoring case and repeated spaces), coded or not.
// Because an existing subject is never overwritten, importing the same payload again only skips.
//
// Choice groups (optional choiceGroup / choiceGroupLabel / choiceRule): a record that is NOT a duplicate is also
// checked against its group. Every active subject of one (semester, choiceGroup) must share the same label and
// rule, whether the other members are already stored or come earlier in the same request; a record that
// disagrees is reported as invalid with per-field errors. Duplicates are skipped before this check.

const normalizeName = (name) => name.trim().replace(/\s+/g, ' ').toLowerCase();

const normalizeExistingCode = (code) => {
  if (typeof code !== 'string') return null;
  const cleaned = code.trim().toUpperCase();
  return cleaned === '' ? null : cleaned;
};

// Short, safe echo of what the client sent for a record that failed validation (never an object).
const echo = (value, max = 150) => {
  if (typeof value === 'string') return value.slice(0, max);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
};

const fieldError = (field, message) => ({ field, message });

// ------------------------------------------------------------------ context (department + regulation)

const resolveContext = async (departmentId, regulationId) => {
  const department = await Department.findById(departmentId);
  if (!department) throw ApiError.badRequest('Validation failed', [fieldError('departmentId', 'Department not found')]);

  const regulation = await Regulation.findById(regulationId);
  if (!regulation) throw ApiError.badRequest('Validation failed', [fieldError('regulationId', 'Regulation not found')]);

  if (String(regulation.department) !== String(department._id)) {
    throw ApiError.badRequest('Validation failed', [
      fieldError('regulationId', 'This regulation does not belong to the supplied department'),
    ]);
  }

  // Same convention as the academic admin APIs: a missing isActive on a legacy record counts as active.
  if (department.isActive === false) {
    throw ApiError.conflict('The department is inactive. Activate it first or choose another one.');
  }
  if (regulation.isActive === false) {
    throw ApiError.conflict('The regulation is inactive. Activate it first or choose another one.');
  }
  return { department, regulation };
};

// ------------------------------------------------------------------ analysis (identical for dry run and import)

const indexExistingSubjects = (subjects) => {
  const bySemester = new Map();
  subjects.forEach((subject) => {
    const key = String(subject.semester);
    if (!bySemester.has(key)) bySemester.set(key, { codes: new Map(), names: new Map(), groups: new Map() });
    const entry = bySemester.get(key);
    // Reference of each choice group = its first ACTIVE stored subject (inactive subjects do not define a group).
    if (typeof subject.choiceGroup === 'string' && subject.choiceGroup !== '' && subject.isActive !== false && !entry.groups.has(subject.choiceGroup)) {
      entry.groups.set(subject.choiceGroup, { choiceGroupLabel: subject.choiceGroupLabel, choiceRule: subject.choiceRule, source: 'existing' });
    }
    const code = normalizeExistingCode(subject.subjectCode);
    if (code && !entry.codes.has(code)) entry.codes.set(code, subject);
    if (typeof subject.name === 'string') {
      const name = normalizeName(subject.name);
      if (!entry.names.has(name)) entry.names.set(name, subject);
    }
  });
  return bySemester;
};

/**
 * Returns one entry per received record, in the original order:
 *   { result, data?, semester? }  where result.status is 'new' | 'duplicate' | 'invalid'.
 * Reads only; never writes.
 */
const analyzeRecords = async (regulation, records) => {
  const semesters = await Semester.find({ regulation: regulation._id });
  const semesterByNumber = new Map(semesters.map((semester) => [semester.semesterNumber, semester]));

  // Steps 2 + 3: record validation and semester resolution.
  const entries = records.map((raw, index) => {
    const checked = validateImportRecord(raw);
    if (checked.errors) {
      const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
      return {
        result: {
          index,
          semesterNumber: echo(source.semesterNumber),
          name: echo(source.name),
          subjectCode: echo(source.subjectCode, 40),
          status: 'invalid',
          errors: checked.errors,
        },
      };
    }

    const data = checked.value;
    const result = {
      index,
      semesterNumber: data.semesterNumber,
      name: data.name,
      subjectCode: data.subjectCode,
      subjectType: data.subjectType,
      category: data.category,
    };
    // Echoed only for subjects in a choice group, so reports of ungrouped subjects keep their old shape.
    if (data.choiceGroup) {
      result.choiceGroup = data.choiceGroup;
      result.choiceGroupLabel = data.choiceGroupLabel;
      result.choiceRule = data.choiceRule;
    }

    const semester = semesterByNumber.get(data.semesterNumber);
    if (!semester) {
      return {
        result: {
          ...result,
          status: 'invalid',
          errors: [fieldError('semesterNumber', `Semester ${data.semesterNumber} does not exist under this regulation. Create it first.`)],
        },
      };
    }
    if (semester.isActive === false) {
      return {
        result: {
          ...result,
          status: 'invalid',
          errors: [fieldError('semesterNumber', `Semester ${data.semesterNumber} of this regulation is inactive. Activate it first.`)],
        },
      };
    }
    return { result, data, semester, pending: true };
  });

  // Step 4: duplicates. One query for the existing subjects of every semester that is actually used.
  const usedSemesters = new Map();
  entries.forEach((entry) => {
    if (entry.pending) usedSemesters.set(String(entry.semester._id), entry.semester._id);
  });
  const existing = usedSemesters.size > 0
    ? indexExistingSubjects(await Subject.find({ semester: { $in: [...usedSemesters.values()] } }))
    : new Map();

  const batchCodes = new Map(); // "<semesterId>|<CODE>" -> index of the first record that claimed it
  const batchNames = new Map(); // "<semesterId>|<name>" -> index (names of ALL new records; looked up by uncoded ones)
  const batchGroups = new Map(); // "<semesterId>|<group>" -> { choiceGroupLabel, choiceRule, index } of the first new record

  entries.forEach((entry) => {
    if (!entry.pending) return;
    const { result, data, semester } = entry;
    const semesterKey = String(semester._id);
    const known = existing.get(semesterKey) || { codes: new Map(), names: new Map() };

    let duplicate = null;
    if (data.subjectCode) {
      const hit = known.codes.get(data.subjectCode);
      const batchHit = batchCodes.get(`${semesterKey}|${data.subjectCode}`);
      if (hit) {
        duplicate = {
          reason: `A subject with code "${data.subjectCode}" already exists in semester ${data.semesterNumber}`,
          existing: hit,
        };
      } else if (batchHit !== undefined) {
        duplicate = {
          reason: `Duplicate of record ${batchHit} in this request (code "${data.subjectCode}" in semester ${data.semesterNumber})`,
          duplicateOfIndex: batchHit,
        };
      }
    } else {
      const nameKey = normalizeName(data.name);
      const hit = known.names.get(nameKey);
      const batchHit = batchNames.get(`${semesterKey}|${nameKey}`);
      if (hit) {
        duplicate = {
          reason: `A subject named "${data.name}" already exists in semester ${data.semesterNumber} (the record has no code, so the name identifies it)`,
          existing: hit,
        };
      } else if (batchHit !== undefined) {
        duplicate = {
          reason: `Duplicate of record ${batchHit} in this request (same name in semester ${data.semesterNumber}; the record has no code)`,
          duplicateOfIndex: batchHit,
        };
      }
    }

    if (duplicate) {
      result.status = 'duplicate';
      result.reason = duplicate.reason;
      if (duplicate.existing) {
        result.existingSubjectId = String(duplicate.existing._id);
        result.existingIsActive = duplicate.existing.isActive !== false;
      }
      if (duplicate.duplicateOfIndex !== undefined) result.duplicateOfIndex = duplicate.duplicateOfIndex;
      return;
    }

    // Choice-group consistency (only for records that would actually be inserted).
    if (data.choiceGroup) {
      const groupKey = `${semesterKey}|${data.choiceGroup}`;
      const stored = known.groups ? known.groups.get(data.choiceGroup) : undefined;
      const earlier = batchGroups.get(groupKey);
      const reference = stored || earlier;
      if (reference) {
        const conflicts = groupConflicts(data.choiceGroup, data, reference);
        if (conflicts.length > 0) {
          const origin = stored ? 'the existing subjects of this semester' : `record ${earlier.index} of this request`;
          result.status = 'invalid';
          result.errors = conflicts.map((conflict) => ({ ...conflict, message: `${conflict.message} (set by ${origin})` }));
          return;
        }
      } else {
        batchGroups.set(groupKey, { choiceGroupLabel: data.choiceGroupLabel, choiceRule: data.choiceRule, index: result.index });
      }
    }

    result.status = 'new';
    if (data.subjectCode) batchCodes.set(`${semesterKey}|${data.subjectCode}`, result.index);
    batchNames.set(`${semesterKey}|${normalizeName(data.name)}`, result.index);
  });

  return entries;
};

// ------------------------------------------------------------------ writing

// Turns a failed save into a safe per-record outcome. Internal error text is logged, never returned.
const describeWriteFailure = (err, result) => {
  if (err && err.code === 11000) {
    // Another request created the same subject between our check and our insert: not an error, a duplicate.
    result.status = 'skipped';
    result.reason = 'This subject was created by another request while the import was running';
    return;
  }
  result.status = 'failed';
  if (err && err.name === 'ValidationError' && err.errors && typeof err.errors === 'object') {
    result.errors = Object.values(err.errors).map((e) => fieldError(e.path, e.message));
    result.reason = 'The subject failed database validation';
    return;
  }
  logger.error(`Academic import: could not save record ${result.index}`, err && err.stack ? err.stack : err);
  result.reason = 'The subject could not be saved because of a server error';
};

const insertNewRecords = async (entries) => {
  for (const entry of entries) {
    if (!entry.result || entry.result.status !== 'new') continue; // eslint-disable-line no-continue
    const { result, data, semester } = entry;
    const fields = { name: data.name, subjectType: data.subjectType, category: data.category, semester: semester._id };
    if (data.subjectCode) fields.subjectCode = data.subjectCode;
    if (data.choiceGroup) {
      fields.choiceGroup = data.choiceGroup;
      fields.choiceRule = data.choiceRule;
      if (data.choiceGroupLabel) fields.choiceGroupLabel = data.choiceGroupLabel;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const saved = await new Subject(fields).save();
      result.status = 'imported';
      result.subjectId = String(saved._id);
    } catch (err) {
      describeWriteFailure(err, result);
    }
  }
};

// ------------------------------------------------------------------ public API

/**
 * Previews (dryRun true) or performs (dryRun false) the subject import.
 * `input` is the output of validateImportRequest. Throws ApiError for request-level problems; record-level
 * problems are part of the returned report.
 */
const importSubjects = async ({ departmentId, regulationId, dryRun, subjects }) => {
  const { department, regulation } = await resolveContext(departmentId, regulationId);
  const entries = await analyzeRecords(regulation, subjects);

  const count = (status) => entries.filter((entry) => entry.result.status === status).length;
  // Counted BEFORE any write, so the preview numbers describe what the analysis found.
  const newRecords = count('new');
  const duplicates = count('duplicate');
  const invalidRecords = count('invalid');

  if (!dryRun) await insertNewRecords(entries);

  const imported = count('imported');
  const writeSkipped = count('skipped');
  const writeFailed = count('failed');

  return {
    dryRun,
    totalReceived: subjects.length,
    // Preview (also returned after a real import: what the analysis found before writing).
    validRecords: newRecords + duplicates,
    newRecords,
    duplicates,
    invalidRecords,
    // Outcome. In a dry run nothing is written: imported is 0, and skipped/failed are what WOULD be skipped/failed.
    imported,
    skipped: dryRun ? duplicates : duplicates + writeSkipped,
    failed: dryRun ? invalidRecords : invalidRecords + writeFailed,
    department: { id: String(department._id), name: department.name, code: department.code },
    regulation: { id: String(regulation._id), name: regulation.name },
    results: entries.map((entry) => {
      const { result } = entry;
      // Records that were skipped as duplicates during analysis keep status "duplicate" in a dry run and
      // become "skipped" in a real import, so the report uses one vocabulary per mode.
      if (!dryRun) {
        if (result.status === 'duplicate') return { ...result, status: 'skipped' };
        if (result.status === 'invalid') return { ...result, status: 'failed', reason: 'The record is invalid' };
      }
      return result;
    }),
  };
};

module.exports = { importSubjects };

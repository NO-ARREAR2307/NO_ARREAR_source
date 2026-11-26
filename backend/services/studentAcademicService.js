'use strict';

const { University, Department, Regulation, Semester, Subject } = require('../models');
const ApiError = require('../utils/ApiError');
const { DEFAULT_CHOICE_RULE } = require('../utils/academicEnums');

// Read-only academic data for students (and admins): University -> Department -> Regulation -> Semester -> Subject.
//  - Only ACTIVE records are ever returned. An inactive record is treated exactly like a missing one (404).
//  - A list is only served when its parent exists, is active, and every ancestor above it is active too,
//    so nothing is exposed beneath a deactivated university, department, regulation or semester.
//  - Children are always filtered by the parent id from the URL, so a record of another parent never appears.
//  - Only the public fields below are returned (no isActive, timestamps or internal data).
//  - Sorting is case-insensitive (collation, strength 2) with _id as a stable tie-breaker.
//  - Semesters that have not been migrated to a regulation yet (see scripts/migrateAcademicSchema.js)
//    are never returned: they cannot be reached through any regulation.

const COLLATION = { locale: 'en', strength: 2 };

const toPublicUniversity = (doc) => ({ _id: doc._id, name: doc.name, code: doc.code, description: doc.description });
const toPublicDepartment = (doc) => ({ _id: doc._id, name: doc.name, code: doc.code, level: doc.level, university: doc.university });
const toPublicRegulation = (doc) => ({ _id: doc._id, name: doc.name, department: doc.department });
// `department` stays in the semester payload (as before Phase 1C) so existing clients keep working.
const toPublicSemester = (doc, departmentId) => ({
  _id: doc._id,
  semesterNumber: doc.semesterNumber,
  regulation: doc.regulation,
  department: departmentId,
});
// Choice-group fields are only present for subjects that belong to a choice group, so a subject without one
// keeps exactly the payload it always had. choiceRule falls back to the default for a group without a rule.
const toPublicSubject = (doc) => {
  const subject = {
    _id: doc._id,
    name: doc.name,
    subjectCode: doc.subjectCode,
    subjectType: doc.subjectType,
    category: doc.category,
    semester: doc.semester,
  };
  if (doc.choiceGroup) {
    subject.choiceGroup = doc.choiceGroup;
    subject.choiceGroupLabel = doc.choiceGroupLabel === undefined ? null : doc.choiceGroupLabel;
    subject.choiceRule = doc.choiceRule || DEFAULT_CHOICE_RULE;
  }
  return subject;
};

// One entry per choice group found in the returned subjects, so a client can show "choose one of these"
// without regrouping: { choiceGroup, choiceGroupLabel, choiceRule, subjectIds } (in the subjects' order).
const buildChoiceGroups = (subjects) => {
  const groups = new Map();
  subjects.forEach((subject) => {
    if (!subject.choiceGroup) return;
    if (!groups.has(subject.choiceGroup)) {
      groups.set(subject.choiceGroup, {
        choiceGroup: subject.choiceGroup,
        choiceGroupLabel: subject.choiceGroupLabel,
        choiceRule: subject.choiceRule,
        subjectIds: [],
      });
    }
    groups.get(subject.choiceGroup).subjectIds.push(subject._id);
  });
  return [...groups.values()];
};

// Returns the record if it exists and is active, otherwise throws 404 "<label> not found".
const requireActive = async (Model, id, label) => {
  const doc = id ? await Model.findById(id) : null;
  if (!doc || doc.isActive === false) throw ApiError.notFound(`${label} not found`);
  return doc;
};

const listUniversities = async () => {
  const docs = await University.find({ isActive: true }).collation(COLLATION).sort({ name: 1, _id: 1 });
  return docs.map(toPublicUniversity);
};

const listDepartments = async (universityId, { level } = {}) => {
  await requireActive(University, universityId, 'University');
  const filter = { university: universityId, isActive: true };
  if (level) filter.level = level;
  const docs = await Department.find(filter).collation(COLLATION).sort({ name: 1, _id: 1 });
  return docs.map(toPublicDepartment);
};

const listRegulations = async (departmentId) => {
  const department = await requireActive(Department, departmentId, 'Department');
  await requireActive(University, department.university, 'Department');
  const docs = await Regulation.find({ department: departmentId, isActive: true }).collation(COLLATION).sort({ name: 1, _id: 1 });
  return docs.map(toPublicRegulation);
};

// Semesters of ONE regulation (the primary way to reach semesters).
const listSemestersOfRegulation = async (regulationId) => {
  const regulation = await requireActive(Regulation, regulationId, 'Regulation');
  const department = await requireActive(Department, regulation.department, 'Regulation');
  await requireActive(University, department.university, 'Regulation');
  const docs = await Semester.find({ regulation: regulationId, isActive: true }).sort({ semesterNumber: 1, _id: 1 });
  return docs.map((doc) => toPublicSemester(doc, department._id));
};

// Semesters of every ACTIVE regulation of a department (the pre-Phase-1C route), optionally narrowed
// to one regulation with { regulation }.
const listSemesters = async (departmentId, { regulation } = {}) => {
  const department = await requireActive(Department, departmentId, 'Department');
  await requireActive(University, department.university, 'Department');
  const regulations = await Regulation.find({ department: departmentId, isActive: true });
  let ids = regulations.map((doc) => doc._id);
  if (regulation) {
    ids = ids.filter((id) => String(id) === String(regulation));
    if (ids.length === 0) throw ApiError.notFound('Regulation not found');
  }
  if (ids.length === 0) return [];
  const docs = await Semester.find({ regulation: { $in: ids }, isActive: true }).sort({ semesterNumber: 1, _id: 1 });
  return docs.map((doc) => toPublicSemester(doc, department._id));
};

const listSubjects = async (semesterId, { subjectType, category } = {}) => {
  const semester = await requireActive(Semester, semesterId, 'Semester');
  const regulation = await requireActive(Regulation, semester.regulation, 'Semester');
  const department = await requireActive(Department, regulation.department, 'Semester');
  await requireActive(University, department.university, 'Semester');
  const filter = { semester: semesterId, isActive: true };
  if (subjectType) filter.subjectType = subjectType;
  if (category) filter.category = category;
  const docs = await Subject.find(filter).collation(COLLATION).sort({ name: 1, _id: 1 });
  return docs.map(toPublicSubject);
};

module.exports = {
  listUniversities,
  listDepartments,
  listRegulations,
  listSemestersOfRegulation,
  listSemesters,
  listSubjects,
  buildChoiceGroups,
};

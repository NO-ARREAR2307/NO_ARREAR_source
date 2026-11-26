'use strict';

const { University, Department, Regulation, Semester, Subject } = require('../models');
const ApiError = require('../utils/ApiError');
const { groupConflicts } = require('../utils/choiceGroups');
const { DEFAULT_CHOICE_RULE } = require('../utils/academicEnums');
const { choiceGroupDependencyErrors } = require('../validators/academicValidators');

// Business rules for the academic admin APIs: University -> Department -> Regulation -> Semester -> Subject.
// Records are never physically deleted: "delete" sets isActive=false.
//
//  - A child needs an EXISTING (400 if not) and ACTIVE (409 if not) parent when it is created, moved
//    to another parent, or re-activated.
//  - A record cannot be deactivated while ACTIVE children still depend on it (409): deactivate the
//    children first. Nothing is cascaded automatically.
//  - Duplicates are refused through the unique indexes of the academic models (409).
//  - Records saved before Phase 1C may lack newer required fields (department level, subject type or
//    category). Updates validate only the fields that are being changed, so such a record can still be
//    deactivated or re-parented without being forced to fill in unrelated fields.

const RESOURCES = {
  university: {
    Model: University,
    label: 'University',
    parent: null,
    child: { Model: Department, field: 'university', label: 'department' },
    duplicate: 'A university with this code already exists',
    sort: { name: 1, _id: 1 },
  },
  department: {
    Model: Department,
    label: 'Department',
    parent: { Model: University, field: 'university', label: 'University' },
    child: { Model: Regulation, field: 'department', label: 'regulation' },
    duplicate: 'A department with this code already exists in this university',
    sort: { name: 1, _id: 1 },
  },
  regulation: {
    Model: Regulation,
    label: 'Regulation',
    parent: { Model: Department, field: 'department', label: 'Department' },
    child: { Model: Semester, field: 'regulation', label: 'semester' },
    duplicate: 'A regulation with this name already exists in this department',
    sort: { name: 1, _id: 1 },
  },
  semester: {
    Model: Semester,
    label: 'Semester',
    parent: { Model: Regulation, field: 'regulation', label: 'Regulation' },
    child: { Model: Subject, field: 'semester', label: 'subject' },
    duplicate: 'This semester number already exists in this regulation',
    sort: { semesterNumber: 1, _id: 1 },
  },
  subject: {
    Model: Subject,
    label: 'Subject',
    parent: { Model: Semester, field: 'semester', label: 'Semester' },
    child: null,
    duplicate: 'A subject with this code already exists in this semester',
    sort: { subjectCode: 1, name: 1, _id: 1 },
  },
};

const getResource = (key) => {
  const resource = RESOURCES[key];
  if (!resource) throw new Error(`Unknown academic resource "${key}"`);
  return resource;
};

// Saves a document; a duplicate-key error from MongoDB becomes a clear 409.
const saveDocument = async (resource, doc, options) => {
  try {
    return await doc.save(options);
  } catch (err) {
    if (err && err.code === 11000) throw ApiError.conflict(resource.duplicate);
    throw err;
  }
};

// The parent must exist (400, invalid reference) and be active (409).
const assertParentUsable = async (resource, parentId) => {
  const { Model, field, label } = resource.parent;
  const parent = await Model.findById(parentId);
  if (!parent) throw ApiError.badRequest('Validation failed', [{ field, message: `${label} not found` }]);
  if (parent.isActive === false) {
    throw ApiError.conflict(`The ${label.toLowerCase()} is inactive. Activate it first or choose another one.`);
  }
};

// A record with active children cannot be deactivated.
const assertNoActiveChildren = async (resource, id) => {
  if (!resource.child) return;
  const { Model, field, label } = resource.child;
  const count = await Model.countDocuments({ [field]: id, isActive: true });
  if (count > 0) {
    throw ApiError.conflict(
      `Cannot deactivate this ${resource.label.toLowerCase()}: it still has ${count} active ${label}${count === 1 ? '' : 's'}. Deactivate them first.`
    );
  }
};

const findOrFail = async (resource, id) => {
  const doc = await resource.Model.findById(id);
  if (!doc) throw ApiError.notFound(`${resource.label} not found`);
  return doc;
};

// Choice groups: every ACTIVE subject of one (semester, choiceGroup) must share the same label and rule.
// `candidate` holds the values the subject will have; `excludeId` is the subject being updated.
// Throws a 400 with per-field errors when it disagrees with the group's existing subjects.
const assertChoiceGroupConsistent = async (candidate, excludeId) => {
  if (!candidate.choiceGroup || candidate.isActive === false) return;
  const members = await Subject.find({ semester: candidate.semester, choiceGroup: candidate.choiceGroup });
  const reference = members.find((member) => member.isActive !== false && String(member._id) !== String(excludeId || ''));
  if (!reference) return;
  const errors = groupConflicts(candidate.choiceGroup, candidate, reference);
  if (errors.length > 0) throw ApiError.badRequest('Validation failed', errors);
};

const createRecord = async (key, input) => {
  const resource = getResource(key);
  if (resource.parent) await assertParentUsable(resource, input[resource.parent.field]);
  if (key === 'subject') {
    await assertChoiceGroupConsistent({
      semester: input.semester,
      choiceGroup: input.choiceGroup,
      choiceGroupLabel: input.choiceGroupLabel,
      choiceRule: input.choiceRule || (input.choiceGroup ? DEFAULT_CHOICE_RULE : undefined),
      isActive: input.isActive,
    });
  }

  // Nullable optional fields sent as null/blank are simply left out on create.
  const data = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== null));
  return saveDocument(resource, new resource.Model(data));
};

// Pre-Phase-1C clients listed semesters with ?department=. A semester now belongs to a regulation, so
// that filter is translated to "semesters of any regulation of this department" (combined with an
// explicit ?regulation= when both are sent).
const resolveSemesterDepartmentFilter = async (filter) => {
  if (filter.department === undefined) return filter;
  const { department, ...rest } = filter;
  const regulations = await Regulation.find({ department });
  let ids = regulations.map((regulation) => regulation._id);
  if (rest.regulation !== undefined) ids = ids.filter((id) => String(id) === String(rest.regulation));
  return { ...rest, regulation: { $in: ids } };
};

const listRecords = async (key, rawFilter, { page, limit, skip }) => {
  const resource = getResource(key);
  const filter = key === 'semester' ? await resolveSemesterDepartmentFilter(rawFilter) : rawFilter;
  const [records, total] = await Promise.all([
    resource.Model.find(filter).sort(resource.sort).skip(skip).limit(limit),
    resource.Model.countDocuments(filter),
  ]);
  return { records, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
};

const getRecord = (key, id) => findOrFail(getResource(key), id);

// Subject updates that touch (or could break) the choice group: clearing the group also clears its label and
// rule, a label/rule needs a group, and the resulting subject must agree with the rest of its group.
// May add fields to `input` (the group's label/rule are cleared together with the group).
const prepareSubjectChoiceUpdate = async (doc, input, willBeActive, wasActive) => {
  if (input.choiceGroup === null) {
    if (input.choiceGroupLabel === undefined) input.choiceGroupLabel = null;
    if (input.choiceRule === undefined) input.choiceRule = null;
  }
  const pick = (field) => (input[field] === undefined ? doc[field] : input[field] === null ? undefined : input[field]);
  const next = {
    semester: input.semester !== undefined ? input.semester : doc.semester,
    choiceGroup: pick('choiceGroup'),
    choiceGroupLabel: pick('choiceGroupLabel'),
    choiceRule: pick('choiceRule'),
    isActive: willBeActive,
  };
  if (next.choiceGroup && !next.choiceRule) next.choiceRule = DEFAULT_CHOICE_RULE;

  const dependencyErrors = choiceGroupDependencyErrors(next);
  if (dependencyErrors.length > 0) throw ApiError.badRequest('Validation failed', dependencyErrors);

  const touched = ['choiceGroup', 'choiceGroupLabel', 'choiceRule', 'semester'].some((field) => input[field] !== undefined);
  const reactivated = !wasActive && willBeActive;
  if (touched || reactivated) await assertChoiceGroupConsistent(next, doc._id);
};

// Partial update: only the fields that were sent change. null/blank on an optional field clears it.
const updateRecord = async (key, id, input) => {
  const resource = getResource(key);
  const doc = await findOrFail(resource, id);

  const wasActive = doc.isActive !== false;
  const willBeActive = input.isActive === undefined ? wasActive : input.isActive;

  if (resource.parent) {
    const { field } = resource.parent;
    const parentChanged = input[field] !== undefined && String(input[field]) !== String(doc[field]);
    const reactivated = !wasActive && willBeActive;
    if (parentChanged) await assertParentUsable(resource, input[field]);
    else if (reactivated) await assertParentUsable(resource, doc[field]);
  }
  if (wasActive && !willBeActive) await assertNoActiveChildren(resource, doc._id);

  if (key === 'subject') await prepareSubjectChoiceUpdate(doc, input, willBeActive, wasActive);

  Object.entries(input).forEach(([field, value]) => {
    doc.set(field, value === null ? undefined : value);
  });
  return saveDocument(resource, doc, { validateModifiedOnly: true });
};

// "DELETE": safe deactivation (isActive=false). Repeating it on an inactive record changes nothing.
const deactivateRecord = async (key, id) => {
  const resource = getResource(key);
  const doc = await findOrFail(resource, id);
  if (doc.isActive === false) return { record: doc, alreadyInactive: true };

  await assertNoActiveChildren(resource, doc._id);
  doc.isActive = false;
  return { record: await saveDocument(resource, doc, { validateModifiedOnly: true }), alreadyInactive: false };
};

module.exports = { createRecord, listRecords, getRecord, updateRecord, deactivateRecord };

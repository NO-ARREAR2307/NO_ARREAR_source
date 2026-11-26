'use strict';

const { DEFAULT_CHOICE_RULE } = require('./academicEnums');

// Shared consistency rules for subject choice groups, used by the admin subject API and the bulk import so
// both enforce exactly the same thing.
//
// A choice group is identified by (semester, choiceGroup). Every ACTIVE subject of one group must carry the
// same label and the same rule. Inactive subjects are ignored, so a retired group can be re-created freely.
// A missing rule counts as the default (choose_one); a missing label is its own value (null), so a subject
// without a label does not match a group whose other subjects have one.

// Case- and spacing-insensitive key for comparing labels.
const labelKey = (label) => (typeof label === 'string' && label.trim() !== '' ? label.trim().replace(/\s+/g, ' ').toLowerCase() : null);

const effectiveRule = (rule) => (typeof rule === 'string' && rule !== '' ? rule : DEFAULT_CHOICE_RULE);

/**
 * Compares a subject's { choiceGroupLabel, choiceRule } with the reference of its group
 * ({ choiceGroupLabel, choiceRule }, e.g. an existing active subject). Returns [{ field, message }]; empty = consistent.
 */
const groupConflicts = (group, candidate, reference) => {
  const errors = [];
  if (labelKey(candidate.choiceGroupLabel) !== labelKey(reference.choiceGroupLabel)) {
    const expected = labelKey(reference.choiceGroupLabel) === null ? 'no label' : `the label \"${reference.choiceGroupLabel}\"`;
    errors.push({ field: 'choiceGroupLabel', message: `Choice group \"${group}\" already uses ${expected} in this semester; every subject of a group must use the same label` });
  }
  if (effectiveRule(candidate.choiceRule) !== effectiveRule(reference.choiceRule)) {
    errors.push({
      field: 'choiceRule',
      message: `Choice group \"${group}\" already uses the rule \"${effectiveRule(reference.choiceRule)}\" in this semester; every subject of a group must use the same rule`,
    });
  }
  return errors;
};

module.exports = { labelKey, effectiveRule, groupConflicts };

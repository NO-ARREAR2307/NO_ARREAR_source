'use strict';

// Allowed values for the controlled academic fields. Kept in one place so the Mongoose models, the
// request validators and the tests can never drift apart.
//
// DEPARTMENT_LEVELS: whether a department (programme) is an undergraduate or postgraduate one.
// SUBJECT_TYPES / SUBJECT_CATEGORIES: how a subject is taught and where it sits in the curriculum
// (these follow the usual CBCS grouping used by University of Madras affiliated colleges).
const DEPARTMENT_LEVELS = Object.freeze(['UG', 'PG']);

const SUBJECT_TYPES = Object.freeze(['theory', 'practical', 'project', 'internship']);

const SUBJECT_CATEGORIES = Object.freeze([
  'core',
  'elective',
  'allied',
  'language',
  'skill_enhancement',
  'ability_enhancement',
  'non_major_elective',
  'value_added',
  'extra_credit',
  'other',
]);

// CHOICE_RULES: how a student picks from a choice group of alternative subjects (electives / conditional
// subjects): exactly one of them, or one or more of them. Used only when a subject has a choiceGroup.
const CHOICE_RULES = Object.freeze(['choose_one', 'choose_multiple']);
const DEFAULT_CHOICE_RULE = 'choose_one';

// A choice group is a stable, machine-friendly identifier shared by the alternative subjects of ONE
// semester (e.g. "elective-1"): lower-case letters, digits, hyphen and underscore, starting with a letter or digit.
const CHOICE_GROUP_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const CHOICE_GROUP_MAX = 50;
const CHOICE_GROUP_LABEL_MAX = 100;

module.exports = {
  DEPARTMENT_LEVELS,
  SUBJECT_TYPES,
  SUBJECT_CATEGORIES,
  CHOICE_RULES,
  DEFAULT_CHOICE_RULE,
  CHOICE_GROUP_PATTERN,
  CHOICE_GROUP_MAX,
  CHOICE_GROUP_LABEL_MAX,
};

import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSemester, resolveSemester, withResolvedSemester, semesterLabel } from '../src/utils/semester.js'

// Minimal localStorage so the storage helpers can be exercised in Node.
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}
const { loadSemesterPref, saveSemesterPref, clearSemesterPref, getUserKey } = await import('../src/services/authStorage.js')

test('normalizeSemester accepts 1-6 only, no defaults', () => {
  assert.equal(normalizeSemester('3'), 3)
  assert.equal(normalizeSemester(6), 6)
  for (const bad of [0, 7, '', null, undefined, 'x', 2.5]) assert.equal(normalizeSemester(bad), null)
})

test('server value is used when nothing is pending', () => {
  assert.equal(resolveSemester({ semester: 2 }, null), 2)
  assert.equal(resolveSemester({ semester: 2 }, { semester: 2, synced: true }), 2)
})

test('pending local change beats the stale login/server value', () => {
  assert.equal(resolveSemester({ semester: 1 }, { semester: 4, synced: false }), 4)
})

test('once synced, a newer server value wins over an old local copy', () => {
  assert.equal(resolveSemester({ semester: 5 }, { semester: 4, synced: true }), 5)
})

test('no data anywhere -> null (no hardcoded default)', () => {
  assert.equal(resolveSemester({}, null), null)
  assert.equal(resolveSemester(null, null), null)
  assert.equal(semesterLabel(null), null)
  assert.equal(semesterLabel(3), 'Semester 3')
})

test('withResolvedSemester overrides user.semester', () => {
  assert.equal(withResolvedSemester({ name: 'A', semester: 1 }, { semester: 3, synced: false }).semester, 3)
  assert.equal(withResolvedSemester(null, null), null)
})

test('persistence: survives "refresh" and "re-login" for the same user, isolated between users', () => {
  const alice = { _id: 'a1', email: 'a@x.com' }
  const bob = { _id: 'b1', email: 'b@x.com' }
  saveSemesterPref(getUserKey(alice), { semester: 4, synced: false })
  // refresh / re-login = fresh read from storage with a stale login payload (semester 1)
  const pref = loadSemesterPref(getUserKey(alice))
  assert.equal(resolveSemester({ ...alice, semester: 1 }, pref), 4)
  assert.equal(loadSemesterPref(getUserKey(bob)), null)
  assert.equal(resolveSemester({ ...bob, semester: 2 }, loadSemesterPref(getUserKey(bob))), 2)
  clearSemesterPref(getUserKey(alice))
  assert.equal(loadSemesterPref(getUserKey(alice)), null)
})

const { withAcademicProfile } = await import('../src/utils/academic.js')

test('course and department stay separate; a copied course value is replaced by the mapped department', () => {
  assert.deepEqual(
    (({ course, department }) => ({ course, department }))(withAcademicProfile({ course: 'BCA', department: 'Computer Applications' })),
    { course: 'BCA', department: 'Computer Applications' },
  )
  assert.equal(withAcademicProfile({ course: 'BCA', department: 'BCA' }).department, 'Computer Applications')
  assert.equal(withAcademicProfile({ course: 'B.Sc.', department: '' }).department, 'Computer Science')
  assert.equal(withAcademicProfile({ course: 'B.Sc.', department: { name: 'Computer Science' } }).department, 'Computer Science')
  assert.equal(withAcademicProfile({ course: 'MBA', department: '' }).department, '')
  assert.equal(withAcademicProfile(null), null)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SOURCE_MANUAL, SOURCE_MIXED, SOURCE_PAPERS, MAX_SAVED_QUESTIONS, academicLine, buildSavePayload, correctOptionText, countAnswered, defaultTitle,
  groupsToSavedQuestions, hasAnswer, inferSource, loadSourceCache, readBackendSource, rememberSource, resolveSource, savedToGroups, subjectLine,
  isOwnSet, studentAcademicLine, studentName, toSavedQuestion, validateSave,
} from '../src/utils/savedQuestions.js'
import { uploaderLabel } from '../src/utils/materials.js'

const ID = '64b7f0c2a1b2c3d4e5f60718'
const memoryStorage = () => {
  const data = new Map()
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)) }
}

test('inferSource tells typed questions (no difficulty) from generated ones (always a difficulty)', () => {
  assert.equal(inferSource([{ difficulty: 'easy' }, { difficulty: 'hard' }]), SOURCE_PAPERS)
  assert.equal(inferSource([{ question: 'a' }, { question: 'b' }]), SOURCE_MANUAL)
  assert.equal(inferSource([{ difficulty: 'easy' }, { question: 'b' }]), SOURCE_MIXED)
  assert.equal(inferSource([]), null)
  assert.equal(inferSource(undefined), null)
})

test('resolveSource prefers a backend field, then the questions, then the cache', () => {
  assert.equal(readBackendSource({ source: 'pdf' }), SOURCE_PAPERS)
  assert.equal(readBackendSource({ sourceType: 'manual' }), SOURCE_MANUAL)
  assert.equal(readBackendSource({}), null)
  assert.equal(resolveSource({ _id: 'a', source: 'manual', questions: [{ difficulty: 'easy' }] }, { a: 'papers' }), SOURCE_MANUAL)
  assert.equal(resolveSource({ _id: 'a', questions: [{ difficulty: 'easy' }] }, { a: 'manual' }), SOURCE_PAPERS)
  assert.equal(resolveSource({ _id: 'a' }, { a: 'manual' }), SOURCE_MANUAL)
  assert.equal(resolveSource({ _id: 'a' }, {}), null)
})

test('the origin cache is per user, ignores junk and can forget a set', () => {
  const storage = memoryStorage()
  rememberSource('u1', 's1', SOURCE_MANUAL, storage)
  rememberSource('u1', 's2', SOURCE_PAPERS, storage)
  assert.deepEqual(loadSourceCache('u1', storage), { s1: SOURCE_MANUAL, s2: SOURCE_PAPERS })
  assert.deepEqual(loadSourceCache('u2', storage), {})
  rememberSource('u1', 's1', null, storage)
  assert.deepEqual(loadSourceCache('u1', storage), { s2: SOURCE_PAPERS })
  storage.setItem('noarrear:saved-set-sources:bad', '{"x":"nonsense","y":"manual"}')
  assert.deepEqual(loadSourceCache('bad', storage), { y: SOURCE_MANUAL })
  storage.setItem('noarrear:saved-set-sources:broken', 'not json')
  assert.deepEqual(loadSourceCache('broken', storage), {})
  assert.deepEqual(loadSourceCache('u1', null), {})
})

test('toSavedQuestion keeps only what the backend stores', () => {
  const generated = toSavedQuestion(
    { questionId: 'x', question: '  What is a stack?  ', difficulty: 'medium', options: [{ label: 'A', text: 'LIFO' }, { label: 'B', text: 'FIFO' }, { label: 'C', text: '' }] },
    { questionType: 'mcq', marks: 2 },
  )
  assert.deepEqual(generated, { questionType: 'mcq', marks: 2, question: 'What is a stack?', difficulty: 'medium', options: [{ label: 'A', text: 'LIFO' }, { label: 'B', text: 'FIFO' }] })
  const typed = toSavedQuestion({ questionId: 'm1', question: 'Explain paging.' }, { questionType: 'short_answer', marks: 5 }, [' Pages ', '', 'Frames'])
  assert.deepEqual(typed, { questionType: 'short_answer', marks: 5, question: 'Explain paging.', answerPoints: ['Pages', 'Frames'] })
  assert.equal('difficulty' in typed, false)
  assert.equal('difficulty' in toSavedQuestion({ question: 'q', difficulty: 'balanced' }, { questionType: 'essay', marks: 10 }), false)
})

test('groupsToSavedQuestions reads the typed answers by question id', () => {
  const groups = [{ questionType: 'short_answer', marks: 5, questions: [{ questionId: 'm1', question: 'One?' }, { questionId: 'm2', question: 'Two?' }] }]
  const list = groupsToSavedQuestions(groups, { m2: ['Because'] })
  assert.equal(list.length, 2)
  assert.equal(list[0].answerPoints, undefined)
  assert.deepEqual(list[1].answerPoints, ['Because'])
  assert.equal(inferSource(list), SOURCE_MANUAL)
})

test('validateSave and buildSavePayload follow the backend rules', () => {
  const questions = [{ questionType: 'short_answer', marks: 5, question: 'Q?' }]
  const ok = { title: ' Unit 1 ', subjectId: ID, semesterId: ID, regulationId: ID, questions }
  assert.deepEqual(validateSave(ok), {})
  assert.deepEqual(buildSavePayload(ok), { subjectId: ID, semesterId: ID, regulationId: ID, title: 'Unit 1', questions })
  assert.match(validateSave({ ...ok, title: '   ' }).title, /title/i)
  assert.match(validateSave({ ...ok, title: 'x'.repeat(151) }).title, /150/)
  assert.ok(validateSave({ ...ok, subjectId: '' }).subjectId)
  assert.ok(validateSave({ ...ok, semesterId: '' }).semesterId)
  assert.ok(validateSave({ ...ok, regulationId: '' }).regulationId)
  assert.ok(validateSave({ ...ok, questions: [] }).questions)
  assert.match(validateSave({ ...ok, questions: new Array(MAX_SAVED_QUESTIONS + 1).fill(questions[0]) }).questions, /at most/)
})

test('defaultTitle names the subject and stays within the title limit', () => {
  assert.equal(defaultTitle('Data Structures', SOURCE_PAPERS), 'Data Structures – Important questions')
  assert.equal(defaultTitle('Data Structures', SOURCE_MANUAL), 'Data Structures – My questions')
  assert.equal(defaultTitle('', SOURCE_MANUAL), 'My questions')
  assert.ok(defaultTitle('x'.repeat(400), SOURCE_PAPERS).length <= 150)
})

test('savedToGroups groups by type then marks and gives every question a stable id', () => {
  const groups = savedToGroups([
    { questionType: 'essay', marks: 10, question: 'E' },
    { questionType: 'mcq', marks: 2, question: 'M1' },
    { questionType: 'mcq', marks: 2, question: 'M2' },
    { questionType: 'short_answer', marks: 5, question: 'S' },
  ])
  assert.deepEqual(groups.map((g) => `${g.questionType}:${g.marks}:${g.questions.length}`), ['mcq:2:2', 'short_answer:5:1', 'essay:10:1'])
  assert.deepEqual(groups[0].questions.map((q) => q.questionId), ['saved-1', 'saved-2'])
  assert.deepEqual(savedToGroups(undefined), [])
})

test('answers: MCQ key, explanation and answer points all count', () => {
  const mcq = { options: [{ label: 'A', text: 'LIFO' }, { label: 'B', text: 'FIFO' }], correctAnswer: 'A', explanation: 'Last in, first out.' }
  assert.equal(hasAnswer(mcq), true)
  assert.equal(correctOptionText(mcq), 'A) LIFO')
  assert.equal(correctOptionText({ correctAnswer: 'D', options: [] }), '')
  assert.equal(hasAnswer({ answerPoints: ['x'] }), true)
  assert.equal(hasAnswer({ answerPoints: [] }), false)
  assert.equal(hasAnswer({}), false)
  assert.equal(countAnswered([mcq, {}, { answerPoints: ['x'] }]), 2)
})

test('academic details cope with removed records', () => {
  const set = { subject: { name: 'OS', subjectCode: 'BCA31' }, semester: { semesterNumber: 3 }, regulation: { name: '2023' }, department: { code: 'BCA', name: 'Computer Applications' } }
  assert.equal(subjectLine(set), 'BCA31 · OS')
  assert.equal(academicLine(set), 'Semester 3 · 2023 · BCA')
  assert.equal(subjectLine({ subject: { _id: ID, name: null } }), 'Subject unavailable')
  assert.equal(academicLine({ semester: { _id: ID }, regulation: { _id: ID, name: null }, department: null }), '')
})

test('isOwnSet and studentName tell the admin\'s own sets from students\' sets', () => {
  const mine = { student: { _id: 'a1', name: 'Admin' } }
  const theirs = { student: { _id: 's1', name: ' Asha  ' } }
  assert.equal(isOwnSet(mine, 'a1'), true)
  assert.equal(isOwnSet(theirs, 'a1'), false)
  assert.equal(isOwnSet(theirs, ''), false)
  assert.equal(isOwnSet({}, 'a1'), false)
  assert.equal(studentName(mine, 'a1'), 'You')
  assert.equal(studentName(theirs, 'a1'), 'Asha')
  assert.equal(studentName({ student: { _id: 's2', name: null } }, 'a1'), 'Student unavailable')
  assert.equal(studentName({}, 'a1'), '')
})

test('studentAcademicLine joins the student profile and leaves out missing parts', () => {
  assert.equal(studentAcademicLine({ course: 'BCA', department: 'Computer Applications', semester: 3 }), 'BCA · Computer Applications · Semester 3')
  assert.equal(studentAcademicLine({ course: 'BCA', semester: null }), 'BCA')
  assert.equal(studentAcademicLine({ semester: 0 }), 'Semester 0')
  assert.equal(studentAcademicLine({}), '')
  assert.equal(studentAcademicLine(undefined), '')
})

test('uploaderLabel names who uploaded a material for the admin\'s paper picker', () => {
  assert.equal(uploaderLabel({ uploadedBy: 'a1' }, 'a1'), 'Uploaded by you')
  assert.equal(uploaderLabel({ uploadedBy: 's1', uploader: { name: 'Asha', course: 'BCA', semester: 3 } }, 'a1'), 'Uploaded by Asha · BCA · Semester 3')
  assert.equal(uploaderLabel({ uploadedBy: 's1', uploader: { name: 'Ravi' } }, 'a1'), 'Uploaded by Ravi')
  assert.equal(uploaderLabel({ uploadedBy: 's1', uploader: null }, 'a1'), 'Uploader unavailable')
  assert.equal(uploaderLabel({ uploadedBy: 's1' }, ''), 'Uploader unavailable')
})

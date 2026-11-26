import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildRequest, describeServerErrors, describeUnmet, effectiveCounts, groupByType, marksEnabled, normalizeResult, parseCount,
  unusedTypes, validateGeneration, MAX_PAPERS, MAX_TOTAL_QUESTIONS,
  countQuestions, defaultPaperSelection, extractionNote, filterGroups, paperEligibility, formatQuestionForCopy, formatQuestionsForCopy,
} from '../src/utils/questionGeneration.js'
import { manualToGroups, marksForType, sanitizeManualQuestions, toManualQuestion, validateManualQuestion } from '../src/utils/manualQuestions.js'

const ID = '64b7f0c2a1b2c3d4e5f60718'
const base = () => ({
  subjectId: ID, semesterId: ID, regulationId: ID, paperIds: [ID], questionTypes: ['short_answer'], difficulty: 'balanced',
  counts: { 2: '', 5: '3', 10: '', 15: '' },
})

test('buildRequest sends exactly the backend fields, in backend order, without units, topics or answers', () => {
  const body = buildRequest({ ...base(), questionTypes: ['essay', 'mcq', 'short_answer'], counts: { 2: '4', 5: '3', 10: '2', 15: '' } })
  assert.deepEqual(Object.keys(body).sort(), ['difficulty', 'marksDistribution', 'paperIds', 'questionCount', 'questionTypes', 'regulationId', 'semesterId', 'subjectId'])
  assert.deepEqual(body.questionTypes, ['mcq', 'short_answer', 'essay'])
  assert.deepEqual(body.marksDistribution, [{ marks: 2, count: 4 }, { marks: 5, count: 3 }, { marks: 10, count: 2 }])
  assert.equal(body.questionCount, 9)
  assert.equal(body.difficulty, 'balanced')
})

test('MCQ is 2 marks only and Essay is 10 or 15 marks only', () => {
  assert.equal(marksEnabled(2, ['mcq']), true)
  assert.equal(marksEnabled(5, ['mcq']), false)
  assert.equal(marksEnabled(5, ['essay']), false)
  assert.equal(marksEnabled(10, ['essay']), true)
  assert.equal(marksEnabled(15, ['essay']), true)
  assert.equal(marksEnabled(2, ['essay']), false)
  assert.equal(marksEnabled(5, ['mcq', 'short_answer']), true)
})

test('rows no selected type can fill count as 0 and are not sent', () => {
  const counts = { 2: '2', 5: '4', 10: '', 15: '' }
  assert.deepEqual(effectiveCounts(counts, ['mcq']), { 2: 2, 5: 0, 10: 0, 15: 0 })
  const body = buildRequest({ ...base(), questionTypes: ['mcq'], counts })
  assert.deepEqual(body.marksDistribution, [{ marks: 2, count: 2 }])
  assert.equal(body.questionCount, 2)
})

test('parseCount accepts whole numbers only', () => {
  assert.equal(parseCount(''), 0)
  assert.equal(parseCount('7'), 7)
  assert.ok(Number.isNaN(parseCount('2.5')))
  assert.ok(Number.isNaN(parseCount('-1')))
  assert.ok(Number.isNaN(parseCount('abc')))
})

test('validateGeneration passes a good form and reports each problem under the backend field name', () => {
  assert.deepEqual(validateGeneration(base()), {})
  const bad = validateGeneration({ ...base(), subjectId: '', paperIds: [], questionTypes: [], counts: { 2: '', 5: '', 10: '', 15: '' } })
  assert.match(bad.subjectId, /subject/i)
  assert.match(bad.paperIds, /at least 1/i)
  assert.match(bad.questionTypes, /at least one/i)
  assert.match(bad.marksDistribution, /at least one marks/i)
  assert.match(validateGeneration({ ...base(), paperIds: Array(MAX_PAPERS + 1).fill(ID) }).paperIds, /at most/i)
  assert.match(validateGeneration({ ...base(), counts: { 2: '', 5: String(MAX_TOTAL_QUESTIONS + 1), 10: '', 15: '' } })['marks:5'], /at most/i)
  assert.match(validateGeneration({ ...base(), counts: { 2: '', 5: '1.5', 10: '', 15: '' } })['marks:5'], /whole number/i)
  assert.match(validateGeneration({ ...base(), counts: { 2: '', 5: '20', 10: '15', 15: '' } }).marksDistribution, /at most/i)
})

test('only-MCQ with counts on other marks is rejected; MCQ at 2 marks is accepted', () => {
  assert.match(validateGeneration({ ...base(), questionTypes: ['mcq'] }).marksDistribution, /at least one marks/i)
  assert.deepEqual(validateGeneration({ ...base(), questionTypes: ['mcq'], counts: { 2: '5', 5: '', 10: '', 15: '' } }), {})
})

test('unusedTypes lists selected types that no filled marks row can use', () => {
  assert.deepEqual(unusedTypes({ 2: '3', 5: '', 10: '', 15: '' }, ['mcq', 'essay']), ['essay'])
  assert.deepEqual(unusedTypes({ 2: '3', 5: '', 10: '2', 15: '' }, ['mcq', 'essay']), [])
})

test('normalizeResult reads groups, partial generation and warnings', () => {
  const result = normalizeResult({
    data: {
      generationId: 'g1', disclaimer: 'D', difficulty: 'balanced',
      groups: [
        { questionType: 'short_answer', marks: 5, questions: [{ questionId: 'a', question: 'Q?' }] },
        { questionType: 'mcq', marks: 2, questions: [] },
      ],
    },
    meta: {
      requested: 4, generated: 1, shortfall: 3, distributionSatisfied: false,
      unmet: [{ marks: 5, questionType: null, requested: 4, generated: 1 }],
      warnings: ['Only 1 of the 4 requested questions could be produced.'],
      extractionWarnings: [{ message: 'Page 2 was unclear' }, 'Low text', ''],
    },
  })
  assert.equal(result.groups.length, 1)
  assert.equal(result.partial, true)
  assert.equal(result.shortfall, 3)
  assert.deepEqual(result.extractionWarnings, ['Page 2 was unclear', 'Low text'])
  assert.equal(result.disclaimer, 'D')
  assert.equal(describeUnmet(result.unmet[0]), '5-mark questions: 1 of 4 generated')
  const full = normalizeResult({ data: { groups: [{ questionType: 'mcq', marks: 2, questions: [{}] }] }, meta: { requested: 1, generated: 1, distributionSatisfied: true } })
  assert.equal(full.partial, false)
})

test('groupByType folds groups into one section per type, in backend type order and marks ascending', () => {
  const sections = groupByType([
    { questionType: 'essay', marks: 15, questions: [1] },
    { questionType: 'mcq', marks: 2, questions: [1, 2] },
    { questionType: 'essay', marks: 10, questions: [1, 2, 3] },
  ])
  assert.deepEqual(sections.map((s) => [s.questionType, s.total]), [['mcq', 2], ['essay', 4]])
  assert.deepEqual(sections[1].byMarks.map((m) => m.marks), [10, 15])
})

test('describeServerErrors names the marks row an indexed error belongs to', () => {
  const request = { marksDistribution: [{ marks: 2, count: 1 }, { marks: 10, count: 2 }] }
  assert.deepEqual(
    describeServerErrors([{ field: 'marksDistribution[1].count', message: 'Count is bad' }, { field: 'paperIds', message: 'Select at least 1 uploaded paper' }], request),
    ['10-mark row: Count is bad', 'Select at least 1 uploaded paper'],
  )
  assert.deepEqual(describeServerErrors(undefined, request), [])
})

test('default paper selection: newest eligible papers, at most the backend maximum', () => {
  const papers = [
    { _id: 'a', title: 'A' },
    { _id: 'b', title: 'B', extractionStatus: 'failed' },
    { _id: 'c', title: 'C', extractionStatus: 'completed' },
    { _id: 'd', title: 'D', extraction: { status: 'processing' } },
    { _id: 'e', title: 'E' },
    { _id: 'f', title: 'F' },
  ]
  // 'd' is still being read: it is waited for, so it is a normal choice. Only the failed one is left out.
  assert.deepEqual(Object.keys(defaultPaperSelection(papers)), ['a', 'c', 'd'])
  assert.equal(Object.keys(defaultPaperSelection(papers)).length <= MAX_PAPERS, true)
  assert.deepEqual(defaultPaperSelection([]), {})
  assert.deepEqual(defaultPaperSelection(undefined), {})
  assert.equal(paperEligibility({ extractionStatus: 'FAILED' }).eligible, false)
  assert.match(paperEligibility({ extractionStatus: 'failed' }).reason, /retried/i)
  // a paper that has not been read yet is a normal choice: its text is extracted when generating
  assert.equal(paperEligibility({ extractionStatus: 'pending' }).eligible, true)
  assert.equal(paperEligibility({ extractionStatus: 'processing' }).eligible, true)
  assert.equal(paperEligibility({}).eligible, true)
})

test('filterGroups searches question text and type, keeps grouping, and is instant for any case', () => {
  const groups = [
    { questionType: 'mcq', marks: 2, questions: [{ question: 'Which data structure uses LIFO?' }, { question: 'What does CPU stand for?' }] },
    { questionType: 'short_answer', marks: 5, questions: [{ question: 'Define a stack and its operations.' }] },
    { questionType: 'essay', marks: 10, questions: [{ question: 'Discuss process scheduling.' }] },
  ]
  assert.equal(filterGroups(groups, '   '), groups)
  assert.equal(countQuestions(filterGroups(groups, 'STACK')), 1)
  const mcq = filterGroups(groups, 'mcq')
  assert.deepEqual(mcq.map((g) => [g.questionType, g.marks, g.questions.length]), [['mcq', 2, 2]])
  assert.equal(countQuestions(filterGroups(groups, 'short answer')), 1)
  assert.equal(countQuestions(filterGroups(groups, 'short_answer')), 1)
  assert.equal(countQuestions(filterGroups(groups, 'mcq cpu')), 1)
  assert.deepEqual(filterGroups(groups, 'zzz'), [])
  assert.equal(groups[0].questions.length, 2) // the original is not changed
})

test('manual questions follow the same type / marks rules as generated ones', () => {
  assert.deepEqual(marksForType('mcq'), [2])
  assert.deepEqual(marksForType('essay'), [10, 15])
  assert.deepEqual(marksForType('short_answer'), [2, 5, 10, 15])
  const draft = { question: 'Define a stack and give one use.', questionType: 'short_answer', marks: '5' }
  assert.deepEqual(validateManualQuestion(draft), {})
  assert.match(validateManualQuestion({ ...draft, questionType: 'mcq' }).marks, /only be 2 marks/i)
  assert.match(validateManualQuestion({ ...draft, questionType: 'essay' }).marks, /10 or 15/)
  assert.deepEqual(validateManualQuestion({ ...draft, questionType: 'mcq', marks: '2' }), {})
  assert.match(validateManualQuestion({ ...draft, questionType: '' }).questionType, /select/i)
})

test('manual question text is validated: required, length limits, no duplicates', () => {
  const ok = { question: 'What is normalisation in DBMS?', questionType: 'short_answer', marks: 5 }
  assert.match(validateManualQuestion({ ...ok, question: '   ' }).question, /enter/i)
  assert.match(validateManualQuestion({ ...ok, question: 'too short' }).question, /at least 10/)
  assert.match(validateManualQuestion({ ...ok, question: 'x'.repeat(1001) }).question, /1000/)
  const existing = [{ id: 'a', ...ok }]
  assert.match(validateManualQuestion({ ...ok, question: '  what is   NORMALISATION in dbms? ' }, existing).question, /already/i)
  assert.deepEqual(validateManualQuestion(ok, existing, 'a'), {}) // editing a question does not clash with itself
})

test('manual questions are grouped like generated ones and keep their order; stored data is sanitised', () => {
  const list = [
    { id: '1', question: 'Question one here', questionType: 'essay', marks: 10 },
    { id: '2', question: 'Question two here', questionType: 'mcq', marks: 2 },
    { id: '3', question: 'Question three here', questionType: 'essay', marks: 10 },
  ]
  const groups = manualToGroups(list)
  assert.deepEqual(groups.map((g) => [g.questionType, g.marks, g.questions.map((q) => q.questionId)]), [['essay', 10, ['1', '3']], ['mcq', 2, ['2']]])
  assert.deepEqual(toManualQuestion({ question: '  a   b  c d e f g h ', questionType: 'mcq', marks: '2' }), { question: 'a b c d e f g h', questionType: 'mcq', marks: 2 })
  const clean = sanitizeManualQuestions([...list, { id: '1', question: 'Duplicate id question', questionType: 'essay', marks: 10 }, { id: '9', question: 'bad', questionType: 'mcq', marks: 5 }, null])
  assert.deepEqual(clean.map((q) => q.id), ['1', '2', '3'])
  assert.deepEqual(sanitizeManualQuestions('nope'), [])
})

test('the ids of the selected papers are sent as paperIds, in selection order, without blanks or repeats', () => {
  const a = '64b7f0c2a1b2c3d4e5f60718'
  const b = '64b7f0c2a1b2c3d4e5f60719'
  const c = '64b7f0c2a1b2c3d4e5f6071a'
  const selected = { [b]: { _id: b, title: 'B' }, [a]: { _id: a, title: 'A' }, [c]: { _id: c, title: 'C' } }
  const body = buildRequest({ ...base(), paperIds: Object.keys(selected) })
  assert.deepEqual(body.paperIds, [b, a, c])
  assert.deepEqual(buildRequest({ ...base(), paperIds: [a, a, '', b] }).paperIds, [a, b])
  assert.deepEqual(JSON.parse(JSON.stringify(body)).paperIds, [b, a, c])
  assert.deepEqual(validateGeneration({ ...base(), paperIds: [a, b, c] }), {})
  assert.match(validateGeneration({ ...base(), paperIds: [] }).paperIds, /at least 1/i)
})

test('manual answers: the request carries text, type and marks unchanged and is split into batches', async () => {
  const { toAnswerRequest, toBatches, ANSWER_BATCH_SIZE } = await import('../src/utils/manualQuestions.js')
  const q = { id: 'a1', question: 'What is a stack in data structures?', questionType: 'short_answer', marks: 5 }
  assert.deepEqual(toAnswerRequest([q]), { questions: [q] })
  const many = Array.from({ length: ANSWER_BATCH_SIZE * 2 + 1 }, (_, i) => ({ ...q, id: `q${i}` }))
  assert.deepEqual(toBatches(many).map((b) => b.length), [ANSWER_BATCH_SIZE, ANSWER_BATCH_SIZE, 1])
})

test('manual answers stay attached only while their question is unchanged', async () => {
  const { answersFor, sanitizeStoredAnswers } = await import('../src/utils/manualQuestions.js')
  const q = { id: 'a1', question: 'What is a stack in data structures?', questionType: 'short_answer', marks: 5 }
  const { id: _id, ...snapshot } = q
  const stored = { a1: { ...snapshot, answerPoints: ['LIFO structure'] } }
  assert.deepEqual(answersFor([q], stored), { a1: ['LIFO structure'] })
  assert.deepEqual(answersFor([{ ...q, marks: 10 }], stored), {}) // marks changed
  assert.deepEqual(answersFor([{ ...q, question: 'What is a queue in data structures?' }], stored), {}) // text changed
  assert.deepEqual(answersFor([{ ...q, id: 'a2' }], stored), {}) // another question
  assert.deepEqual(sanitizeStoredAnswers({ a1: stored.a1, bad: { question: 1 }, empty: { ...snapshot, answerPoints: [] } }), { a1: stored.a1 })
  assert.deepEqual(sanitizeStoredAnswers(null), {})
})

test('extractionNote explains the state of a paper text, and is empty when it is ready', () => {
  assert.equal(extractionNote({ extractionStatus: 'completed' }), '')
  assert.equal(extractionNote({}), '')
  assert.match(extractionNote({ extractionStatus: 'pending' }), /automatically/i)
  assert.match(extractionNote({ extractionStatus: 'processing' }), /wait/i)
  assert.match(extractionNote({ extractionStatus: 'failed' }), /retried/i)
})

test('defaultPaperSelection keeps pending papers and remembers their extraction status', () => {
  const picked = defaultPaperSelection([
    { _id: 'a', title: 'A', extractionStatus: 'pending' },
    { _id: 'b', title: 'B', extractionStatus: 'failed' },
    { _id: 'c', title: 'C', extractionStatus: 'completed' },
  ])
  assert.deepEqual(Object.keys(picked), ['a', 'c'])
  assert.equal(picked.a.extractionStatus, 'pending')
})

test('needsExtraction: only papers that are not completed (or not read in this visit) are extracted', async () => {
  const { needsExtraction } = await import('../src/utils/paperExtraction.js')
  assert.equal(needsExtraction({ _id: 'a', extractionStatus: 'pending' }), true)
  assert.equal(needsExtraction({ _id: 'a', extractionStatus: 'failed' }), true)
  assert.equal(needsExtraction({ _id: 'a' }), true)
  assert.equal(needsExtraction({ _id: 'a', extractionStatus: 'completed' }), false)
  assert.equal(needsExtraction({ _id: 'a', extractionStatus: 'pending' }, new Set(['a'])), false)
})

const noWait = { sleep: async () => {}, pollMs: 0 }

test('extractPapers extracts in order, reports progress and finishes before returning', async () => {
  const { extractPapers, initialProgress } = await import('../src/utils/paperExtraction.js')
  const papers = [{ _id: 'a', title: 'A' }, { _id: 'b', title: 'B' }]
  const calls = []
  const progress = Object.fromEntries(initialProgress(papers).map((p) => [p._id, [p.state]]))
  const done = []
  await extractPapers(papers, {
    extract: async (id) => { calls.push(id) },
    fetchPaper: async () => { throw new Error('not needed') },
    onProgress: (id, state) => progress[id].push(state),
    onDone: (id) => done.push(id),
    ...noWait,
  })
  assert.deepEqual(calls, ['a', 'b'])
  assert.deepEqual(progress, { a: ['waiting', 'running', 'done'], b: ['waiting', 'running', 'done'] })
  assert.deepEqual(done, ['a', 'b'])
})

test('extractPapers stops at the first failure with the backend message and does not touch later papers', async () => {
  const { extractPapers } = await import('../src/utils/paperExtraction.js')
  const calls = []
  const states = []
  await assert.rejects(
    extractPapers([{ _id: 'a', title: 'Scan.pdf' }, { _id: 'b', title: 'B' }], {
      extract: async (id) => { calls.push(id); throw { message: 'No readable text was found in this PDF.', status: 422 } },
      fetchPaper: async () => null,
      onProgress: (id, state, message) => states.push([id, state, message]),
      ...noWait,
    }),
    (err) => err.paperId === 'a' && err.title === 'Scan.pdf' && /No readable text/.test(err.message) && err.status === 422,
  )
  assert.deepEqual(calls, ['a'])
  assert.deepEqual(states[states.length - 1], ['a', 'failed', 'No readable text was found in this PDF.'])
})

test('a paper already being extracted (409) is waited for until it completes', async () => {
  const { ensureExtracted } = await import('../src/utils/paperExtraction.js')
  const statuses = ['processing', 'processing', 'completed']
  let fetches = 0
  await ensureExtracted({ _id: 'a' }, {
    extract: async () => { throw { message: 'Extraction for this paper is already in progress.', status: 409 } },
    fetchPaper: async () => ({ extractionStatus: statuses[fetches++] }),
    ...noWait,
  })
  assert.equal(fetches, 3)
})

test('waiting for a paper that fails, or never finishes, ends with a clear message', async () => {
  const { ensureExtracted } = await import('../src/utils/paperExtraction.js')
  const busy = async () => { throw { message: 'in progress', status: 409 } }
  await assert.rejects(
    ensureExtracted({ _id: 'a' }, { extract: busy, fetchPaper: async () => ({ extractionStatus: 'failed', extractionError: 'The PDF is corrupted.' }), ...noWait }),
    (err) => /corrupted/.test(err.message) && err.status === 422,
  )
  await assert.rejects(
    ensureExtracted({ _id: 'a' }, { extract: busy, fetchPaper: async () => ({ extractionStatus: 'processing' }), maxWaitMs: 0, ...noWait }),
    (err) => /longer than expected/.test(err.message) && err.status === 504,
  )
})

test('other extraction errors (for example a rate limit) are passed on unchanged', async () => {
  const { ensureExtracted } = await import('../src/utils/paperExtraction.js')
  await assert.rejects(
    ensureExtracted({ _id: 'a' }, { extract: async () => { throw { message: 'Too many extraction requests.', status: 429 } }, fetchPaper: async () => null, ...noWait }),
    (err) => err.status === 429 && /Too many/.test(err.message),
  )
})

test('copy text includes type, marks, question and MCQ options', () => {
  const mcq = { question: 'Which data structure uses LIFO?', options: [{ label: 'A', text: 'Queue' }, { label: 'B', text: 'Stack' }, { label: 'C', text: 'Tree' }, { label: 'D', text: 'Graph' }] }
  assert.equal(
    formatQuestionForCopy(mcq, { questionType: 'mcq', marks: 2 }),
    '[MCQ · 2 marks]\nWhich data structure uses LIFO?\nA) Queue\nB) Stack\nC) Tree\nD) Graph',
  )
  assert.equal(formatQuestionForCopy({ question: 'Define a stack.' }, { questionType: 'short_answer', marks: 5 }, 3), '3. [Short Answer · 5 marks]\nDefine a stack.')
})

test('copy all numbers the questions in the order shown and separates them with blank lines', () => {
  const groups = [
    { questionType: 'short_answer', marks: 5, questions: [{ question: 'Define a stack.' }] },
    { questionType: 'mcq', marks: 2, questions: [{ question: 'What does CPU stand for?', options: [{ label: 'A', text: 'Central Processing Unit' }] }] },
  ]
  assert.equal(
    formatQuestionsForCopy(groups),
    '1. [MCQ · 2 marks]\nWhat does CPU stand for?\nA) Central Processing Unit\n\n2. [Short Answer · 5 marks]\nDefine a stack.',
  )
  assert.equal(formatQuestionsForCopy([]), '')
})

test('formatAnswerForCopy copies only the answer text', async () => {
  const { formatAnswerForCopy } = await import('../src/utils/questionGeneration.js')
  assert.equal(formatAnswerForCopy({ points: ['First point', ' Second point '] }), '- First point\n- Second point')
  assert.equal(formatAnswerForCopy({ key: 'B) Stack', explanation: 'LIFO.', points: ['Push', 'Pop'] }), 'Correct answer: B) Stack\nLIFO.\n- Push\n- Pop')
  assert.equal(formatAnswerForCopy({}), '')
})

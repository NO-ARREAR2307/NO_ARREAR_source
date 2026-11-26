import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_ANSWER_POINTS, MAX_POINT_LENGTH, answerManualQuestions, answerToPoints, buildAskPrompt, toAnswerRequest } from '../src/utils/manualQuestions.js'

const q = (id, question = `Explain topic number ${id} in detail`, questionType = 'short_answer', marks = 5) => ({ id, question, questionType, marks })

test('buildAskPrompt sends the question text plus a note about the type, marks and depth', () => {
  const text = buildAskPrompt(q('1', '  What is   a stack? ', 'short_answer', 5))
  assert.ok(text.startsWith('What is a stack?\n\n'))
  assert.match(text, /Short Answer, 5 marks/)
  assert.match(text, /4 to 5 short bullet points/)
  assert.match(buildAskPrompt(q('2', 'Which is LIFO?', 'mcq', 2)), /correct option/)
  assert.match(buildAskPrompt(q('3', 'Discuss paging in OS', 'essay', 15)), /6 to 8 short bullet points/)
  assert.ok(buildAskPrompt(q('4', 'x'.repeat(1000))).length < 10000) // far below the backend's limit for /questions/ask
})

test('answerToPoints turns a Markdown answer into plain points', () => {
  const markdown = [
    '## Stack',
    'A **stack** is a linear structure that follows LIFO.',
    '',
    'Key points:',
    '- Push adds an item on top',
    '* Pop removes the top item',
    '1. Peek reads the top without removing it',
    '2) `isEmpty` checks for an empty stack',
    '',
    '```c',
    '```',
    'See [the notes](https://example.com) for more.',
  ].join('\n')
  assert.deepEqual(answerToPoints(markdown), [
    'A stack is a linear structure that follows LIFO.',
    'Push adds an item on top',
    'Pop removes the top item',
    'Peek reads the top without removing it',
    'isEmpty checks for an empty stack',
    'See the notes for more.',
  ])
})

test('answerToPoints joins wrapped lines, drops duplicates and respects the backend limits', () => {
  assert.deepEqual(answerToPoints('- first part\n  continues here\n- First part continues here'), ['first part continues here'])
  const many = Array.from({ length: 12 }, (_, i) => `- point number ${i}`).join('\n')
  assert.equal(answerToPoints(many).length, MAX_ANSWER_POINTS)

  const sentence = (n) => `Sentence ${n} ${'word '.repeat(20)}ends here.`
  const long = answerToPoints(`- ${[1, 2, 3, 4, 5].map(sentence).join(' ')}`)
  assert.ok(long.length > 1)
  assert.ok(long.every((point) => point.length <= MAX_POINT_LENGTH))
  const endless = answerToPoints(`- ${'word '.repeat(120)}`)
  assert.equal(endless.length, 1)
  assert.ok(endless[0].length <= MAX_POINT_LENGTH && endless[0].endsWith('\u2026'))

  assert.deepEqual(answerToPoints(''), [])
  assert.deepEqual(answerToPoints(undefined), [])
  assert.deepEqual(answerToPoints('## Only a heading\n---\n```\n```'), [])
})

test('answerManualQuestions sends each question to ask() and returns the answers in order', async () => {
  const sent = []
  const ask = async (text) => {
    sent.push(text)
    await new Promise((resolve) => setTimeout(resolve, sent.length === 1 ? 20 : 1)) // the first one finishes last
    return { data: { answer: `- answer for ${text.split('\n')[0]}` } }
  }
  const list = [q('a', 'First question here'), q('b', 'Second question here'), q('c', 'Third question here'), q('d', 'Fourth question here')]
  const body = await answerManualQuestions({ questions: toAnswerRequest(list).questions, ask })
  assert.equal(sent.length, 4)
  assert.deepEqual(body.data.questions.map((item) => item.id), ['a', 'b', 'c', 'd'])
  assert.deepEqual(body.data.questions[0], { id: 'a', question: 'First question here', questionType: 'short_answer', marks: 5, answerPoints: ['answer for First question here'] })
  assert.deepEqual(body.meta, { requested: 4, generated: 4, warnings: [] })
})

test('answerManualQuestions keeps what was answered when one question is declined', async () => {
  const ask = async (text) => {
    if (text.startsWith('Bad')) throw { message: 'The AI could not answer this question. Please rephrase it and try again.', status: 422, data: null }
    return { data: { answer: '- fine' } }
  }
  const body = await answerManualQuestions({ questions: [q('1', 'Good question one'), q('2', 'Bad question two'), q('3', 'Good question three')], ask })
  assert.deepEqual(body.data.questions.map((item) => item.id), ['1', '3'])
  assert.equal(body.meta.generated, 2)
  assert.match(body.meta.warnings[0], /1 of 3 questions could not be answered/)
  assert.match(body.meta.warnings[0], /rephrase/)
})

test('answerManualQuestions stops after a failure that is not about one question, and throws when nothing was answered', async () => {
  let calls = 0
  const ask = async () => {
    calls += 1
    throw { message: 'The AI service is not available right now. Please try again later.', status: 503, data: null }
  }
  const list = Array.from({ length: 10 }, (_, i) => q(String(i)))
  await assert.rejects(answerManualQuestions({ questions: list, ask, concurrency: 2 }), (err) => err.status === 503)
  assert.ok(calls <= 2, `expected at most 2 calls, got ${calls}`)
})

test('answerManualQuestions treats an empty answer as unusable and handles cancelling', async () => {
  await assert.rejects(answerManualQuestions({ questions: [q('1')], ask: async () => ({ data: { answer: '## Heading only' } }) }), (err) => /usable answer/.test(err.message))
  await assert.rejects(answerManualQuestions({ questions: [q('1')], ask: async () => ({}) }), (err) => /usable answer/.test(err.message))

  const controller = new AbortController()
  const ask = async () => {
    controller.abort()
    return { data: { answer: '- late' } }
  }
  await assert.rejects(answerManualQuestions({ questions: [q('1'), q('2')], ask, signal: controller.signal }), (err) => err.cancelled === true)
  assert.deepEqual((await answerManualQuestions({ questions: [], ask })).data.questions, [])
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { editRules, formatSize, typeLabel, typeOptions, validateFile } from '../src/utils/materials.js'

test('validateFile accepts PDF/JPG/PNG within 10 MB and rejects the rest', () => {
  assert.equal(validateFile({ name: 'notes.PDF', size: 1000 }), '')
  assert.equal(validateFile({ name: 'scan.jpeg', size: 1000 }), '')
  assert.match(validateFile(null), /choose a file/i)
  assert.match(validateFile({ name: 'a.docx', size: 10 }), /unsupported/i)
  assert.match(validateFile({ name: 'noext', size: 10 }), /unsupported/i)
  assert.match(validateFile({ name: 'a.pdf', size: 0 }), /empty/i)
  assert.match(validateFile({ name: 'a.pdf', size: 11 * 1024 * 1024 }), /too large/i)
})

test('formatSize and typeLabel', () => {
  assert.equal(formatSize(512), '512 B')
  assert.equal(formatSize(2048), '2.0 KB')
  assert.equal(formatSize(5 * 1024 * 1024), '5.0 MB')
  assert.equal(formatSize(undefined), '—')
  assert.equal(typeLabel('question_paper'), 'Question paper')
  assert.equal(typeLabel('lab_manual'), 'Lab manual')
})

test('typeOptions keeps an unknown current type selectable', () => {
  assert.ok(typeOptions('lab_manual').some((t) => t.value === 'lab_manual'))
  assert.equal(typeOptions('notes').filter((t) => t.value === 'notes').length, 1)
})

test('edit rules require a title and cap lengths', () => {
  assert.match(editRules.title('   '), /required/i)
  assert.match(editRules.title('x'.repeat(151)), /150/)
  assert.equal(editRules.title('ok'), '')
  assert.match(editRules.description('x'.repeat(1001)), /1000/)
})

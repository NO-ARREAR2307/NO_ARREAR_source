import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPublicShareUrl, buildWhatsAppUrl, extractShareToken } from '../src/utils/sharing.js'

test('extractShareToken reads the token from a share URL', () => {
  assert.equal(extractShareToken('http://localhost:5173/shared/materials/abc_DEF-123'), 'abc_DEF-123')
  assert.equal(extractShareToken('https://x.app/shared/materials/tok/?a=1#h'), 'tok')
  assert.equal(extractShareToken('https://x.app/other/path'), '')
  assert.equal(extractShareToken(undefined), '')
})

test('buildPublicShareUrl uses the given origin', () => {
  assert.equal(buildPublicShareUrl('tok', 'https://noarrear.app/'), 'https://noarrear.app/shared/materials/tok')
  assert.equal(buildPublicShareUrl('', 'https://noarrear.app'), '')
})

test('buildWhatsAppUrl encodes the message', () => {
  const url = buildWhatsAppUrl('Maths notes', 'https://noarrear.app/shared/materials/tok')
  assert.ok(url.startsWith('https://wa.me/?text='))
  const text = decodeURIComponent(url.split('?text=')[1])
  assert.match(text, /Maths notes/)
  assert.match(text, /https:\/\/noarrear\.app\/shared\/materials\/tok$/)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { isActiveCodexTitleDuplicate } from '../src/chat-codex-duplicate.ts'

test('archived same-title Codex entries do not block ordinary Chat creation', () => {
  assert.equal(isActiveCodexTitleDuplicate({ title: 'Mara Vale', archivedAt: Date.now() }, 'Mara Vale'), false)
})

test('active same-title Codex entries still block ordinary Chat creation', () => {
  assert.equal(isActiveCodexTitleDuplicate({ title: '  Mara   Vale  ' }, 'mara vale'), true)
})

test('restored entries immediately become normal active duplicates again', () => {
  assert.equal(isActiveCodexTitleDuplicate({ title: 'Mara Vale' }, 'Mara Vale'), true)
})

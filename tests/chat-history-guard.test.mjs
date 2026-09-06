import test from 'node:test'
import assert from 'node:assert/strict'
import { chatHistoryPrefixMatches } from '../src/chat-history-guard.ts'

const base = [
  { id: 'u1', order: 0, role: 'user', content: 'Go left' },
  { id: 'a1', order: 1, role: 'assistant', content: 'Okay', thoughts: 'reasoning' },
]

test('accepts the exact source prefix plus generated trailing rounds', () => {
  assert.equal(chatHistoryPrefixMatches(base, [...base, { id: 'a2', order: 2, role: 'assistant', content: 'later' }]), true)
})

test('rejects deletion of a source turn', () => {
  assert.equal(chatHistoryPrefixMatches(base, [base[1]]), false)
})

test('rejects edits to source content', () => {
  assert.equal(chatHistoryPrefixMatches(base, [{ ...base[0], content: 'Go right' }, base[1]]), false)
})

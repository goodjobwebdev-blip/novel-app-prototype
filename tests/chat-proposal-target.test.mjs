import assert from 'node:assert/strict'
import test from 'node:test'
import { loadProposalTargetOrMarkStale } from '../src/chat-proposal-target.ts'

test('missing proposal target is marked stale before the lookup error is rethrown', async () => {
  const events = []
  const missing = new Error('missing target')
  await assert.rejects(
    loadProposalTargetOrMarkStale(
      async () => { events.push('load'); throw missing },
      async () => { events.push('stale') },
    ),
    (error) => error === missing,
  )
  assert.deepEqual(events, ['load', 'stale'])
})

test('valid proposal target does not alter proposal status', async () => {
  let stale = false
  const target = { id: 'codex-a' }
  const result = await loadProposalTargetOrMarkStale(async () => target, async () => { stale = true })
  assert.equal(result, target)
  assert.equal(stale, false)
})

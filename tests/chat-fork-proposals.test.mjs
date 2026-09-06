import test from 'node:test'
import assert from 'node:assert/strict'
import { snapshotProposalForFork, snapshotProposalListForFork } from '../src/chat-fork-proposals.ts'

test('pending and applying proposals become stale in fork history', () => {
  assert.equal(snapshotProposalForFork({ id: 'p1', status: 'proposed' }).status, 'stale')
  assert.equal(snapshotProposalForFork({ id: 'p2', status: 'applying' }).status, 'stale')
})

test('terminal proposal states remain accurate', () => {
  for (const status of ['applied', 'created', 'rejected', 'duplicate', 'stale']) {
    assert.equal(snapshotProposalForFork({ id: status, status }).status, status)
  }
})

test('fork snapshots clone each proposal instead of sharing objects', () => {
  const source = [{ id: 'p1', status: 'proposed', title: 'Arrival' }]
  const copy = snapshotProposalListForFork(source)
  assert.notEqual(copy?.[0], source[0])
  assert.equal(copy?.[0].status, 'stale')
  assert.equal(source[0].status, 'proposed')
})

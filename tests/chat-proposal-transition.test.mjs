import assert from 'node:assert/strict'
import test from 'node:test'
import { transitionProposalList } from '../src/chat-proposal-transition.ts'

test('sibling proposal transitions merge against the latest proposal array', () => {
  const initial = [
    { id: 'p1', status: 'proposed' },
    { id: 'p2', status: 'proposed' },
  ]
  const first = transitionProposalList(initial, 'p1', ['proposed'], { status: 'applied' })
  const second = transitionProposalList(first.proposals, 'p2', ['proposed'], { status: 'applied' })
  assert.deepEqual(second.proposals.map((proposal) => proposal.status), ['applied', 'applied'])
})

test('an atomic claim allows only one concurrent approval to own a proposal', () => {
  const initial = [{ id: 'create-1', status: 'proposed' }]
  const first = transitionProposalList(initial, 'create-1', ['proposed'], { status: 'applying' })
  assert.equal(first.changed, true)
  const second = transitionProposalList(first.proposals, 'create-1', ['proposed'], { status: 'applying' })
  assert.equal(second.changed, false)
  assert.equal(second.proposal.status, 'applying')
})

test('reject cannot overwrite an already claimed or successful proposal', () => {
  const applying = [{ id: 'p1', status: 'applying' }]
  const rejected = transitionProposalList(applying, 'p1', ['proposed'], { status: 'rejected' })
  assert.equal(rejected.changed, false)
  assert.equal(rejected.proposal.status, 'applying')

  const applied = transitionProposalList(applying, 'p1', ['applying'], { status: 'applied' })
  const lateReject = transitionProposalList(applied.proposals, 'p1', ['proposed'], { status: 'rejected' })
  assert.equal(lateReject.changed, false)
  assert.equal(lateReject.proposal.status, 'applied')
})

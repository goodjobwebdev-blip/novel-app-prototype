import assert from 'node:assert/strict'
import test from 'node:test'
import { applyIfStillCurrent } from '../src/async-state-guard.ts'

test('late mutation cannot reclaim active state after navigation', async () => {
  let activeId = 'codex-a'
  let activeValue = 'A'
  let resolveMutation
  const mutation = new Promise((resolve) => { resolveMutation = resolve })

  const completion = mutation.then((updated) => {
    applyIfStillCurrent(updated.id, () => activeId, () => { activeValue = updated.value })
  })

  activeId = 'scene-b'
  activeValue = 'B'
  resolveMutation({ id: 'codex-a', value: 'A saved' })
  await completion

  assert.equal(activeId, 'scene-b')
  assert.equal(activeValue, 'B')
})

test('same active entity receives normalized mutation result', () => {
  let activeId = 'codex-a'
  let activeValue = 'A'
  const applied = applyIfStillCurrent('codex-a', () => activeId, () => { activeValue = 'A saved' })
  assert.equal(applied, true)
  assert.equal(activeValue, 'A saved')
})

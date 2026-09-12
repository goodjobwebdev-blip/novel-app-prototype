import test from 'node:test'
import assert from 'node:assert/strict'
import { createBufferedWordRenderer } from '../src/buffered-word-renderer.ts'

const turn = () => new Promise(resolve => setTimeout(resolve, 10))

test('an insertion error remains a rejection when onError aborts synchronously', async () => {
  const controller = new AbortController()
  const failure = new Error('Editor changed')
  const renderer = createBufferedWordRenderer({
    delayMs: 0,
    signal: controller.signal,
    onInsert() { throw failure },
    onError() { controller.abort() },
  })
  renderer.push('One word ')
  await assert.rejects(renderer.finish(), error => error === failure)
  assert.equal(renderer.error(), failure)
  assert.equal(controller.signal.aborted, true)
})

test('Stop discards buffered words and releases a pending finish without another insertion', async () => {
  const controller = new AbortController(), inserted = []
  const renderer = createBufferedWordRenderer({ delayMs: 60000, signal: controller.signal, onInsert: text => inserted.push(text) })
  renderer.push('First second third ')
  await turn()
  assert.deepEqual(inserted, ['First '])
  const finished = renderer.finish()
  controller.abort()
  await finished
  renderer.push('Late content ')
  await renderer.flush()
  assert.deepEqual(inserted, ['First '])
  assert.equal(renderer.error(), null)
})

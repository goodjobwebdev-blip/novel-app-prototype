import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/deletion-save-barrier.ts', import.meta.url), 'utf8')
const js = source
  .replace(/export async function runDeletionSaveBarrier<T>\(/, 'export async function runDeletionSaveBarrier(')
  .replace(/\n  ids: string\[],\n  deletingIds: Set<string>,\n  waitForIdle: \(id: string\) => Promise<void>,\n  action: \(\) => Promise<T>,\n\): Promise<T> \{/, '\n  ids,\n  deletingIds,\n  waitForIdle,\n  action,\n) {')
const moduleUrl = `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
const { runDeletionSaveBarrier } = await import(moduleUrl)

function deferred() {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}

test('marks ids deleting before waiting and does not delete until saves are idle', async () => {
  const gate = deferred()
  const deleting = new Set()
  let deleted = false

  const task = runDeletionSaveBarrier(
    ['scene-a', 'summary-a', 'scene-a'],
    deleting,
    async (id) => { if (id === 'scene-a') await gate.promise },
    async () => { deleted = true; return ['scene-a', 'summary-a'] },
  )

  await Promise.resolve()
  assert.equal(deleting.has('scene-a'), true)
  assert.equal(deleting.has('summary-a'), true)
  assert.equal(deleted, false)

  gate.resolve()
  assert.deepEqual(await task, ['scene-a', 'summary-a'])
  assert.equal(deleted, true)
  assert.equal(deleting.size, 0)
})

test('clears deletion marks when deletion itself fails', async () => {
  const deleting = new Set()
  await assert.rejects(
    runDeletionSaveBarrier(['a'], deleting, async () => undefined, async () => { throw new Error('delete failed') }),
    /delete failed/,
  )
  assert.equal(deleting.size, 0)
})

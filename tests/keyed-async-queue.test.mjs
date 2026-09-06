import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/keyed-async-queue.ts', import.meta.url), 'utf8')
const js = source
  .replace('private tails = new Map<string, Promise<void>>()', 'tails = new Map()')
  .replace(/async run<T>\(key: string, task: \(\) => Promise<T>\): Promise<T>/, 'async run(key, task)')
  .replace(/let release!: \(\) => void/, 'let release')
  .replace(/new Promise<void>/g, 'new Promise')
  .replace(/async whenIdle\(key: string\): Promise<void>/, 'async whenIdle(key)')
const moduleUrl = `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
const { KeyedAsyncQueue } = await import(moduleUrl)

function deferred() {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}

test('serializes tasks for one document while allowing another document to proceed', async () => {
  const queue = new KeyedAsyncQueue()
  const gate = deferred()
  const events = []

  const first = queue.run('A', async () => {
    events.push('A1:start')
    await gate.promise
    events.push('A1:end')
  })
  const second = queue.run('A', async () => { events.push('A2') })
  const other = queue.run('B', async () => { events.push('B') })

  await other
  assert.deepEqual(events, ['A1:start', 'B'])
  gate.resolve()
  await Promise.all([first, second])
  assert.deepEqual(events, ['A1:start', 'B', 'A1:end', 'A2'])
})

test('a failed task does not block the next save for that document', async () => {
  const queue = new KeyedAsyncQueue()
  await assert.rejects(queue.run('A', async () => { throw new Error('boom') }), /boom/)
  let ran = false
  await queue.run('A', async () => { ran = true })
  assert.equal(ran, true)
  await queue.whenIdle('A')
})

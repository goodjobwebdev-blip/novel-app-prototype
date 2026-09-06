import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { KeyedAsyncQueue } from '../src/keyed-async-queue.ts'

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

function block(startText, endText) {
  const start = appSource.indexOf(startText)
  const end = appSource.indexOf(endText, start)
  assert.ok(start >= 0 && end > start, `${startText} block exists`)
  return appSource.slice(start, end)
}

test('AI autosaves and explicit reset share the same per-scope FIFO queue', () => {
  assert.match(appSource, /const aiSaveQueueRef = useRef\(new KeyedAsyncQueue\(\)\)/)
  const persist = block('  function persistAiSettings(', '\n  function scheduleAiSettingsSave')
  const reset = block('  async function resetFromDefaults()', '\n  async function saveContextDefaults')
  assert.match(persist, /aiSaveQueueRef\.current\.run\(scope/)
  assert.match(reset, /aiSaveQueueRef\.current\.run\(scope/)
})

test('reset cancels pending debounce and reserves its revision before entering the queue', () => {
  const reset = block('  async function resetFromDefaults()', '\n  async function saveContextDefaults')
  const clearTimer = reset.indexOf('window.clearTimeout(aiSaveTimerRef.current)')
  const reserveVersion = reset.indexOf('const version = ++aiSaveVersionRef.current')
  const optimisticDefaults = reset.indexOf('latestAiSettingsRef.current = defaults')
  const enqueue = reset.indexOf('aiSaveQueueRef.current.run(scope')
  assert.ok(clearTimer >= 0 && reserveVersion > clearTimer, 'pending debounce is cancelled before Reset reserves a revision')
  assert.ok(optimisticDefaults > reserveVersion && enqueue > optimisticDefaults, 'Reset becomes the local latest revision before its durable write queues')
})

test('older in-flight autosave cannot overwrite a later queued reset', async () => {
  const queue = new KeyedAsyncQueue()
  let persisted = 'O'
  let releaseAutosave
  let resetCompleted = false
  const autosaveGate = new Promise((resolve) => { releaseAutosave = resolve })

  const autosaveA = queue.run('book-a', async () => {
    await autosaveGate
    persisted = 'A'
  })
  const resetD = queue.run('book-a', async () => {
    persisted = 'D'
    resetCompleted = true
  })

  await Promise.resolve()
  assert.equal(resetCompleted, false, 'Reset waits behind the already-started autosave')
  releaseAutosave()
  await Promise.all([autosaveA, resetD])
  assert.equal(persisted, 'D', 'Reset is the latest durable revision')
})

test('post-reset edit intentionally supersedes the reset', async () => {
  const queue = new KeyedAsyncQueue()
  let persisted = 'O'
  let releaseAutosave
  const autosaveGate = new Promise((resolve) => { releaseAutosave = resolve })

  const autosaveA = queue.run('book-a', async () => {
    await autosaveGate
    persisted = 'A'
  })
  const resetD = queue.run('book-a', async () => { persisted = 'D' })
  const editB = queue.run('book-a', async () => { persisted = 'B' })

  releaseAutosave()
  await Promise.all([autosaveA, resetD, editB])
  assert.equal(persisted, 'B')
})

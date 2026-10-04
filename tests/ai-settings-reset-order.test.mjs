import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { KeyedAsyncQueue } from '../src/shared/utils/keyed-async-queue.ts'

const appSource = readFileSync(new URL('../src/app/App.tsx', import.meta.url), 'utf8')
const profilesSource = readFileSync(new URL('../src/features/settings/SettingsProfilesPanel.tsx', import.meta.url), 'utf8')

function block(startText, endText) {
  const start = profilesSource.indexOf(startText)
  const end = profilesSource.indexOf(endText, start)
  assert.ok(start >= 0 && end > start, `${startText} block exists`)
  return profilesSource.slice(start, end)
}

test('profile writes are explicit and serialized; old AI autosave/reset cannot race a profile edit', () => {
  assert.doesNotMatch(appSource, /scheduleAiSettingsSave|resetFromDefaults|copyDefaultAiSettingsToBook|saveBookAiSettings/)
  const run = block('  async function run(', '\n  function notifySaved')
  assert.match(run, /if \(busyRef\.current\) return/)
  assert.ok(run.indexOf('busyRef.current = true') < run.indexOf('await action()'))
  assert.match(run, /finally \{ busyRef\.current = false; setBusy\(false\)/)
  const save = block('  async function save()', '\n  function discard')
  assert.match(save, /await run\(async \(\) =>/)
  assert.match(save, /await saveSettingsProfile\(clean\)/)
  assert.doesNotMatch(save, /setTimeout|setInterval/)
})

test('Discard restores the saved profile and does not reserve an optimistic durable write', () => {
  const discard = block('  function discard()', '\n  function create')
  assert.match(discard, /if \(busyRef\.current\) return false/)
  assert.ok(discard.indexOf('loadSettingsProfiles()') < discard.indexOf('setDraft(savedProfile)'))
  assert.match(discard, /setBaseline\(JSON\.stringify\(savedProfile\)\)/)
  assert.match(discard, /catch \(failure\) \{ reportError\(failure\); return false/)
  assert.doesNotMatch(discard, /saveSettingsProfile|saveAiSettings|setDefaultSettingsProfile/)
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

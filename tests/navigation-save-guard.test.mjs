import assert from 'node:assert/strict'
import test from 'node:test'
import { navigateAfterRequiredSave, saveRequiredBeforeNavigation } from '../src/navigation-save-guard.ts'
import { triggerMatchesText } from '../src/codex-trigger-service.ts'

test('Chat navigation waits for the dirty Scene save before becoming sendable', async () => {
  let persistedScene = 'old text'
  let navigated = false
  let resolveWrite
  const delayedWrite = new Promise((resolve) => { resolveWrite = resolve })

  const navigation = navigateAfterRequiredSave(true, async () => {
    await delayedWrite
    persistedScene = 'new text mentioning Mara'
    return true
  }, () => { navigated = true })

  await Promise.resolve()
  assert.equal(navigated, false, 'Chat must not open while the Scene write is pending')
  assert.equal(persistedScene, 'old text')

  resolveWrite()
  assert.equal(await navigation, true)
  assert.equal(navigated, true)
  assert.equal(persistedScene, 'new text mentioning Mara')
  assert.equal(triggerMatchesText(persistedScene, 'Mara'), true, 'automatic Codex matching sees the saved latest Scene')
})

test('failed Scene save blocks Chat navigation', async () => {
  let navigated = false
  const result = await navigateAfterRequiredSave(true, async () => false, () => { navigated = true })
  assert.equal(result, false)
  assert.equal(navigated, false)
})

test('dirty document/book navigation treats failed persistence as a hard barrier', async () => {
  const inMemory = { id: 'scene-a', text: 'unsaved manuscript text', dirty: true, saveState: 'error' }
  const allowed = await saveRequiredBeforeNavigation(true, async () => false)
  if (allowed) {
    inMemory.id = 'scene-b'
    inMemory.text = 'other document'
    inMemory.dirty = false
    inMemory.saveState = 'saved'
  }
  assert.equal(allowed, false)
  assert.deepEqual(inMemory, { id: 'scene-a', text: 'unsaved manuscript text', dirty: true, saveState: 'error' })
})

test('successful required save allows document/book replacement', async () => {
  assert.equal(await saveRequiredBeforeNavigation(true, async () => true), true)
})

test('clean editor can navigate without a redundant save', async () => {
  let saves = 0
  let navigated = false
  const result = await navigateAfterRequiredSave(false, async () => { saves += 1; return true }, () => { navigated = true })
  assert.equal(result, true)
  assert.equal(saves, 0)
  assert.equal(navigated, true)
})

import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import 'fake-indexeddb/auto'
import { assignBookTestProfiles } from './settings-profile-fixture.mjs'

const storage = new Map()
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) }
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const url = new URL(specifier + '.ts', context.parentURL)
    if (existsSync(fileURLToPath(url))) return nextResolve(url.href, context)
  }
  return nextResolve(specifier, context)
} })
const settings = await import('../src/shared/ai/ai-settings.ts')
const db = await import('../src/data/persistence.ts')
const profiles = await import('../src/features/settings/settings-profiles.ts')
const { createChat, getChat, updateChat } = await import('../src/features/chat/chat-service.ts')
after(async () => (await db.database()).close())

test('legacy global Chat seeds the default text profile; explicit shared profile saves affect only future chat snapshots', async () => {
  settings.saveAiSettings({ ...settings.initialAiSettings, mainModel: 'writer', mainModelContextLength: 32000, mainEffectiveContextLimit: '16k', chatModel: 'assistant', chatModelContextLength: 64000 })
  const defaults = settings.loadAiSettings()
  assert.equal(defaults.chatModel, 'assistant')
  assert.equal(defaults.chatModelContextLength, 64000)
  const { book } = await db.createBook(defaults, 'Chat defaults')
  const chat = await createChat(book.id)
  assert.equal(chat.model, 'assistant')
  assert.equal(chat.modelContextLength, 64000)
  assert.equal(chat.effectiveContextLimit, '')
  assert.equal((await db.getBookAiSettings(book.id, [])).mainModel, 'writer')

  await updateChat(chat.id, { model: 'individual-choice', modelContextLength: 96000 })
  const selections = await db.getBookProfileSelections(book.id)
  const selected = profiles.loadSettingsProfiles().profiles.find(profile => profile.id === selections.text)
  await db.saveBookAiSettings(book.id, { ...defaults, chatModel: 'ignored-legacy-write' })
  assert.equal((await createChat(book.id)).model, 'assistant')
  profiles.saveSettingsProfile({ ...selected, settings: { ...selected.settings, chatModel: 'book-assistant', chatModelContextLength: 128000 } })
  const nextChat = await createChat(book.id)
  assert.equal(nextChat.model, 'book-assistant')
  assert.equal(nextChat.modelContextLength, 128000)
  const originalChat = await getChat(chat.id)
  assert.equal(originalChat.model, 'individual-choice')
  assert.equal(originalChat.modelContextLength, 96000)
  assert.equal(settings.loadAiSettings().chatModel, 'assistant')
})

test('legacy and blank Chat defaults preserve the Main fallback', async () => {
  for (const chatModel of [undefined, '', '  ']) {
    const legacy = settings.normalizeAiSettings({ mainModel: 'writer', mainModelContextLength: 32000, mainEffectiveContextLimit: '16k', chatModel, chatModelContextLength: 99999 })
    const { book } = await db.createBook(legacy, 'Legacy defaults')
    await assignBookTestProfiles({ persistence: db, ai: settings, profiles }, book.id, legacy)
    const chat = await createChat(book.id)
    assert.equal(chat.model, 'writer')
    assert.equal(chat.modelContextLength, 32000)
    assert.equal(chat.effectiveContextLimit, '16k')
  }
})

test('a custom Chat model with unknown context does not inherit the writing model window', async () => {
  const configured = settings.normalizeAiSettings({ mainModel: 'writer', mainModelContextLength: 128000, chatModel: 'custom-assistant' })
  const { book } = await db.createBook(configured, 'Custom model')
  await assignBookTestProfiles({ persistence: db, ai: settings, profiles }, book.id, configured)
  const chat = await createChat(book.id)
  assert.equal(chat.model, 'custom-assistant')
  assert.equal(chat.modelContextLength, undefined)
})

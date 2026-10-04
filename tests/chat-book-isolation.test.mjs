import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  chatMatchesBookSelection,
  onlyChatsForBook,
  reloadMatchesBookSelection,
} from '../src/features/chat/chat-book-guard.ts'

test('late Book A sidebar reload cannot replace Book B state', async () => {
  let currentBookId = 'book-a'
  let currentVersion = 1
  let items = [{ id: 'chat-a', bookId: 'book-a' }]
  let resolveA
  const delayedA = new Promise((resolve) => { resolveA = resolve })

  const completion = delayedA.then((next) => {
    if (reloadMatchesBookSelection('book-a', 1, currentBookId, currentVersion)) {
      items = onlyChatsForBook(next, 'book-a')
    }
  })

  currentBookId = 'book-b'
  currentVersion = 2
  items = [{ id: 'chat-b', bookId: 'book-b' }]
  resolveA([{ id: 'chat-a', bookId: 'book-a' }])
  await completion

  assert.deepEqual(items, [{ id: 'chat-b', bookId: 'book-b' }])
})

test('older same-book reload is rejected after a newer reload starts', () => {
  assert.equal(reloadMatchesBookSelection('book-b', 2, 'book-b', 3), false)
  assert.equal(reloadMatchesBookSelection('book-b', 3, 'book-b', 3), true)
})

test('Chat A cannot be treated as selected while Book B is authoritative', () => {
  const chatA = { id: 'chat-a1', bookId: 'book-a' }
  assert.equal(chatMatchesBookSelection(chatA, 'book-b', 'chat-a1'), false)
  assert.equal(chatMatchesBookSelection(chatA, 'book-a', 'chat-a1'), true)
})

test('books share only the active global text connection and live selected profiles, while chats keep book-role snapshots', async () => {
  await import('fake-indexeddb/auto')
  const storage = new Map()
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) }
  registerHooks({ resolve(specifier, context, next) { if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) { const url = new URL(specifier + '.ts', context.parentURL); if (existsSync(fileURLToPath(url))) return next(url.href, context) } return next(specifier, context) } })
  const ai = await import('../src/shared/ai/ai-settings.ts'), p = await import('../src/data/persistence.ts'), profiles = await import('../src/features/settings/settings-profiles.ts'), chats = await import('../src/features/chat/chat-service.ts')
  try {
    ai.saveAiSettings({ ...ai.initialAiSettings, provider: 'nanogpt', apiKey: 'nano-local', mainModel: 'shared-writer', chatModel: 'shared-assistant', chatThinkingEffort: 'high' })
    const first = await p.createBook(ai.initialAiSettings, 'Book A'), second = await p.createBook({ ...ai.initialAiSettings, provider: 'openai', apiKey: 'ignored-per-book-key' }, 'Book B')
    const selection = await p.getBookProfileSelections(first.book.id), selected = profiles.loadSettingsProfiles().profiles.find(profile => profile.id === selection.text)
    const snapshot = await chats.createChat(first.book.id)
    profiles.saveSettingsProfile({ ...selected, settings: { ...selected.settings, mainModel: 'shared-edited', chatModel: 'assistant-edited' } })
    ai.saveAiSettings({ ...ai.loadAiSettings(), provider: 'litellm', apiKey: 'one-active-key', baseUrl: 'https://local-gateway.test/v1' })
    for (const fixture of [first, second]) {
      const settings = await p.getBookAiSettings(fixture.book.id, [])
      assert.equal(settings.provider, 'litellm'); assert.equal(settings.apiKey, 'one-active-key'); assert.equal(settings.baseUrl, 'https://local-gateway.test/v1')
      assert.equal(settings.mainModel, 'shared-edited'); assert.equal(settings.chatThinkingEffort, 'high')
    }
    const duplicate = profiles.createSettingsProfile('text', 'Book B independently', selected.id)
    profiles.saveSettingsProfile({ ...duplicate, settings: { ...duplicate.settings, mainModel: 'book-b-writer', chatModel: 'book-b-assistant' } })
    await p.saveBookProfileSelections(second.book.id, { ...selection, text: duplicate.id })
    assert.equal((await p.getBookAiSettings(first.book.id, [])).mainModel, 'shared-edited')
    assert.equal((await p.getBookAiSettings(second.book.id, [])).mainModel, 'book-b-writer')
    assert.equal((await chats.createChat(second.book.id)).model, 'book-b-assistant')
    assert.deepEqual(await chats.getChat(snapshot.id), snapshot)
    assert.doesNotMatch(storage.get(profiles.SETTINGS_PROFILES_STORAGE_KEY), /one-active-key|nano-local|ignored-per-book-key|local-gateway/)
  } finally { (await p.database()).close() }
})

test('malformed chat lists are filtered to the current Book', () => {
  const items = onlyChatsForBook([
    { id: 'chat-a', bookId: 'book-a' },
    { id: 'chat-b', bookId: 'book-b' },
  ], 'book-b')

  assert.deepEqual(items, [{ id: 'chat-b', bookId: 'book-b' }])
})

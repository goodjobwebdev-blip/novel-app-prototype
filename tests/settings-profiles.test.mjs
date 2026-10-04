import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import 'fake-indexeddb/auto'
const storage = new Map()
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) }
globalThis.window = new EventTarget()
window.localStorage = localStorage
registerHooks({ resolve(specifier, context, next) { if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) { const url = new URL(specifier + '.ts', context.parentURL); if (existsSync(fileURLToPath(url))) return next(url.href, context) } return next(specifier, context) } })
const profiles = await import('../src/features/settings/settings-profiles.ts')
const ai = await import('../src/shared/ai/ai-settings.ts')
const p = await import('../src/data/persistence.ts')
const archive = await import('../src/data/book-archive.ts')
const chats = await import('../src/features/chat/chat-service.ts')
const characters = await import('../src/features/chat/character-chat.ts')
const sync = await import('../src/features/sync/sync-persistence.ts')
after(async () => (await p.database()).close())
const safe = value => assert.doesNotMatch(JSON.stringify(value), /apiKey|baseUrl|providerProfiles|connectionId|accountId|localConnectionFingerprint|SECRET|private-endpoint/)
const byId = id => profiles.loadSettingsProfiles().profiles.find(profile => profile.id === id)
const edit = (profile, patch) => profiles.saveSettingsProfile({ ...profile, settings: { ...profile.settings, ...patch } })

ai.saveAiSettings({ ...ai.initialAiSettings, provider: 'litellm', apiKey: 'GLOBAL_SECRET', baseUrl: 'https://private-endpoint.test/v1', mainModel: 'global-main', providerProfiles: { nanogpt: { apiKey: 'OTHER_SECRET', baseUrl: 'https://other-private-endpoint.test' } }, speech: { ...ai.initialSpeechSettings, apiKey: 'SPEECH_SECRET', openaiApiKey: 'STT_SECRET' } })

test('seed all kinds, import legacy presets, strip credentials and preserve corrupt libraries', () => {
  storage.set('arc-prompt-composition-presets-v1', JSON.stringify({ version: 1, presets: [{ id: 'legacy-user-preset', kind: 'user', scope: 'story', name: 'User story', systemPrompt: 'Custom story.', predefinedMessages: [] }] }))
  const library = profiles.loadSettingsProfiles()
  assert.equal(library.version, 1)
  assert.equal(Object.keys(library.defaults).length, 11)
  assert.equal(byId('legacy-user-preset').settings.promptCompositions.story.systemPrompt, 'Custom story.')
  safe(library)
  const saved = storage.get(profiles.SETTINGS_PROFILES_STORAGE_KEY)
  storage.set(profiles.SETTINGS_PROFILES_STORAGE_KEY, '{corrupt')
  assert.throws(profiles.loadSettingsProfiles, /preserved/)
  assert.equal(storage.get(profiles.SETTINGS_PROFILES_STORAGE_KEY), '{corrupt')
  storage.set(profiles.SETTINGS_PROFILES_STORAGE_KEY, saved)
  const malformed = JSON.parse(saved); malformed.profiles.push(malformed.profiles[0])
  storage.set(profiles.SETTINGS_PROFILES_STORAGE_KEY, JSON.stringify(malformed))
  assert.throws(profiles.loadSettingsProfiles, /unique/)
  storage.set(profiles.SETTINGS_PROFILES_STORAGE_KEY, saved)
})

test('speech defaults reuse only the matching global provider connection; explicit overrides win and cleared active keys stay cleared', async () => {
  const original = ai.loadAiSettings(), selected = profiles.defaultBookProfileSelections()
  try {
    for (const provider of ['nanogpt', 'openai', 'fake']) {
      ai.saveAiSettings({ ...original, provider, apiKey: 'ACTIVE_SECRET', providerProfiles: { nanogpt: { apiKey: 'NANO_SECRET' }, openai: { apiKey: 'OPENAI_SECRET' } }, speech: { ...original.speech, apiKey: '  ', openaiApiKey: '' } })
      const storedBefore = storage.get(ai.AI_SETTINGS_STORAGE_KEY), settings = profiles.resolveProfileSettings(selected)
      assert.equal(settings.speech.apiKey, provider === 'nanogpt' ? 'ACTIVE_SECRET' : 'NANO_SECRET')
      assert.equal(settings.speech.openaiApiKey, provider === 'openai' ? 'ACTIVE_SECRET' : 'OPENAI_SECRET')
      assert.equal(storage.get(ai.AI_SETTINGS_STORAGE_KEY), storedBefore)
      ai.saveAiSettings({ ...ai.loadAiSettings(), speech: { ...original.speech, apiKey: ' OVERRIDE_NANO_SECRET ', openaiApiKey: 'OVERRIDE_OPENAI_SECRET' } })
      assert.equal(profiles.resolveProfileSettings(selected).speech.apiKey, 'OVERRIDE_NANO_SECRET')
      assert.equal(profiles.resolveProfileSettings(selected).speech.openaiApiKey, 'OVERRIDE_OPENAI_SECRET')
    }
    ai.saveAiSettings({ ...original, provider: 'nanogpt', apiKey: '', providerProfiles: { nanogpt: { apiKey: 'STALE_SECRET' } }, speech: { ...original.speech, apiKey: '', openaiApiKey: '' } })
    assert.equal(profiles.resolveProfileSettings(selected).speech.apiKey, '')
    safe(profiles.loadSettingsProfiles())
  } finally { ai.saveAiSettings(original) }
})

test('initial Character roles preserve legacy Chat model, thinking, rounds and context without changing explicit saved roles', () => {
  const originalAi = storage.get(ai.AI_SETTINGS_STORAGE_KEY), originalLibrary = storage.get(profiles.SETTINGS_PROFILES_STORAGE_KEY)
  try {
    for (const model of ['legacy-assistant', '']) {
      storage.delete(profiles.SETTINGS_PROFILES_STORAGE_KEY)
      ai.saveAiSettings({ ...ai.initialAiSettings, mainModel: 'legacy-writer', chatModel: model, chatThinkingEffort: 'high', chatMaxModelRounds: 11, chatModelContextLength: 64000 })
      const library = profiles.loadSettingsProfiles(), text = library.profiles.find(profile => profile.id === library.defaults.text)
      assert.equal(text.settings.characterModel, model)
      assert.equal(text.settings.characterThinkingEffort, 'high')
      assert.equal(text.settings.characterMaxModelRounds, 11)
      assert.equal(text.settings.characterModelContextLength, 64000)
      const explicit = profiles.saveSettingsProfile({ ...text, settings: { ...text.settings, characterModel: '', characterThinkingEffort: 'default', characterMaxModelRounds: 8, characterModelContextLength: undefined } })
      const runtime = profiles.resolveProfileSettings(profiles.defaultBookProfileSelections())
      assert.equal(runtime.characterModel, '')
      assert.equal(runtime.characterThinkingEffort, 'default')
      assert.equal(runtime.characterModelContextLength, undefined)
      assert.equal(explicit.settings.chatModel, model)
    }
    const custom = ai.normalizeAiSettings({ chatModel: 'chat', chatModelContextLength: 64000, characterModel: 'unknown-character' })
    assert.equal(custom.characterModelContextLength, undefined)
  } finally {
    storage.set(ai.AI_SETTINGS_STORAGE_KEY, originalAi)
    storage.set(profiles.SETTINGS_PROFILES_STORAGE_KEY, originalLibrary)
  }
})

test('invalid theme IDs, typography, model context metadata, caps, role options and default IDs never replace saved data', () => {
  const library = profiles.loadSettingsProfiles(), text = byId(library.defaults.text), ui = byId(library.defaults.ui)
  const stored = storage.get(profiles.SETTINGS_PROFILES_STORAGE_KEY)
  for (const patch of [{ mainEffectiveContextLimit: '-32k' }, { codexEffectiveContextLimit: '3k' }, { mainModelContextLength: 0 }, { characterModelContextLength: 2.5 }, { mainModelContextLength: Infinity }, { mainThinkingEffort: 'unsupported' }, { generationWordDelayMs: '0' }, { chatPromptPresetId: '' }]) {
    assert.throws(() => edit(text, patch))
    assert.equal(storage.get(profiles.SETTINGS_PROFILES_STORAGE_KEY), stored)
  }
  for (const patch of [{ activeThemeId: 'missing-theme' }, { editor: { ...ui.ui.editor, fontSize: 0 } }, { inputs: { ...ui.ui.inputs, lineHeight: 20 } }, { customThemes: [{ id: 'x', name: 'Bad theme', palette: {} }] }, { highlightDialogue: 'false' }]) assert.throws(() => profiles.saveSettingsProfile({ ...ui, ui: { ...ui.ui, ...patch } }))
  assert.throws(() => profiles.setDefaultSettingsProfile('text', ui.id), /unavailable/)
  for (const id of ['', 'missing', library.defaults.ui]) {
    const corrupt = JSON.parse(stored); corrupt.defaults.text = id
    const raw = JSON.stringify(corrupt); storage.set(profiles.SETTINGS_PROFILES_STORAGE_KEY, raw)
    assert.throws(profiles.loadSettingsProfiles, /preserved/)
    assert.equal(storage.get(profiles.SETTINGS_PROFILES_STORAGE_KEY), raw)
  }
  storage.set(profiles.SETTINGS_PROFILES_STORAGE_KEY, stored)
  const optional = profiles.saveSettingsProfile({ ...ui, ui: { ...ui.ui, sceneBeats: false, saveArcAsBeat: undefined, highlightDialogue: undefined } })
  assert.equal(optional.ui.saveArcAsBeat, false)
  assert.equal(optional.ui.highlightDialogue, false)
  storage.set(profiles.SETTINGS_PROFILES_STORAGE_KEY, stored)
})

test('book references are live, defaults affect only new books, saves are explicit and deletion guards all references', async () => {
  const first = await p.createBook(ai.initialAiSettings, 'First'), second = await p.createBook(ai.initialAiSettings, 'Second')
  const firstSelections = await p.getBookProfileSelections(first.book.id)
  const originalText = byId(firstSelections.text)
  const draft = structuredClone(originalText); draft.settings.mainModel = 'unsaved'
  assert.notEqual((await p.getBookAiSettings(first.book.id, [])).mainModel, 'unsaved')
  const saved = edit(originalText, { mainModel: 'shared-main' })
  assert.equal((await p.getBookAiSettings(second.book.id, [])).mainModel, 'shared-main')
  const duplicate = profiles.createSettingsProfile('text', 'Independent', saved.id)
  const futureDefault = profiles.createSettingsProfile('text', 'Future books', saved.id)
  profiles.setDefaultSettingsProfile('text', futureDefault.id)
  assert.equal((await p.getBookProfileSelections(second.book.id)).text, saved.id)
  assert.equal((await p.getBookProfileSelections((await p.createBook(ai.initialAiSettings)).book.id)).text, futureDefault.id)
  await p.saveBookProfileSelections(first.book.id, { ...firstSelections, text: duplicate.id })
  assert.deepEqual(await p.listSettingsProfileUsage(duplicate.id), [{ id: first.book.id, title: 'First' }])
  await assert.rejects(profiles.deleteSettingsProfile(duplicate.id), /used/)
  await assert.rejects(profiles.deleteSettingsProfile(futureDefault.id), /used|Default/)
  const role = profiles.createSettingsProfile('chat', 'Referenced role')
  edit(duplicate, { chatPromptPresetId: role.id })
  await assert.rejects(profiles.deleteSettingsProfile(role.id), /used|referenced/)
  await p.saveBookProfileSelections(first.book.id, firstSelections)
  await profiles.deleteSettingsProfile(duplicate.id)
  await profiles.deleteSettingsProfile(role.id)
  assert.throws(() => edit(saved, { characterPromptPresetId: 'missing' }), /unavailable/)
  await assert.rejects(p.saveBookProfileSelections(first.book.id, { ...firstSelections, text: 'missing' }), /unavailable/)
})

test('usage warnings include both indirect Chat and Character role references once per live book, not saved chat snapshots', async () => {
  const text = profiles.createSettingsProfile('text', 'Indirect role users'), chat = profiles.createSettingsProfile('chat', 'Indirect chat'), character = profiles.createSettingsProfile('character', 'Indirect character')
  edit(text, { chatPromptPresetId: chat.id, characterPromptPresetId: character.id })
  const books = []
  for (const title of ['Role user A', 'Role user B', 'Snapshot only']) {
    const { book } = await p.createBook(ai.initialAiSettings, title)
    await p.saveBookProfileSelections(book.id, { ...await p.getBookProfileSelections(book.id), text: text.id })
    books.push(book)
  }
  const snapshot = await chats.createChat(books[2].id)
  await p.saveBookProfileSelections(books[2].id, profiles.defaultBookProfileSelections())
  for (const role of [chat, character]) {
    const used = await p.listSettingsProfileUsage(role.id)
    assert.deepEqual(new Set(used.map(book => book.id)), new Set(books.slice(0, 2).map(book => book.id)))
    assert.equal(used.length, 2)
    await assert.rejects(profiles.deleteSettingsProfile(role.id), /used/)
  }
  for (const book of books.slice(0, 2)) await p.saveBookProfileSelections(book.id, profiles.defaultBookProfileSelections())
  assert.deepEqual(await p.listSettingsProfileUsage(chat.id), [])
  await assert.rejects(profiles.deleteSettingsProfile(chat.id), /referenced/)
  await profiles.deleteSettingsProfile(text.id)
  await profiles.deleteSettingsProfile(chat.id)
  await profiles.deleteSettingsProfile(character.id)
  assert.deepEqual(await chats.getChat(snapshot.id), snapshot)
})

test('deleted books reject settings reads/writes and chat creation instead of resurrecting orphan settings', async () => {
  const { book } = await p.createBook(ai.initialAiSettings, 'Deleted during settings work'), selections = await p.getBookProfileSelections(book.id)
  await p.deleteEntityTree(book.id)
  for (const operation of [() => p.getBookProfileSelections(book.id), () => p.saveBookProfileSelections(book.id, selections), () => p.getBookAiSettings(book.id, []), () => p.saveBookAiSettings(book.id, ai.initialAiSettings), () => p.ensureBookAiSettings(book.id, ai.initialAiSettings), () => p.getBookContextSettings(book.id), () => p.saveBookContextSettings(book.id, p.defaultBookContextSettings), () => chats.createChat(book.id)]) await assert.rejects(operation, /no longer exists/)
  assert.equal((await (await p.database()).table('entities').where('bookId').equals(book.id).toArray()).length, 0)
  assert.equal(await p.readPreservedBookAiSettings(book.id), undefined)
})

test('portable materialization is serialized with metadata updates and replacement; invalid cached metadata is rejected without mutating records', async () => {
  const { book } = await p.createBook(ai.initialAiSettings, 'Metadata and portable races'), db = await p.database()
  const data = await p.readBookArchive(book.id), record = data.entities.find(entity => entity.settingsType === 'profiles-book')
  const configured = await p.getBookAiSettings(book.id, [])
  await db.table('entities').put({ ...record, modelMetadata: { [`${configured.provider}:${configured.mainModel}`]: 72000 } })
  const views = await Promise.all(Array.from({ length: 3 }, () => p.getBookAiSettings(book.id, [])))
  assert.ok(views.every(settings => settings.mainModelContextLength === 72000))
  assert.equal((await db.table('entities').get(record.id)).definitions, undefined)
  const badRecord = { ...await db.table('entities').get(record.id), modelMetadata: { [`${configured.provider}:${configured.mainModel}`]: -1 } }
  await db.table('entities').put(badRecord)
  await assert.rejects(p.getBookAiSettings(book.id, []), /Invalid saved model metadata/)
  assert.deepEqual(await db.table('entities').get(record.id), badRecord)
  await db.table('entities').put({ ...badRecord, modelMetadata: {} })
  const deleted = await p.createBook(ai.initialAiSettings, 'Portable record deleted before install')
  const source = await p.readBookArchive(deleted.book.id)
  await db.table('entities').put(source.entities.find(entity => entity.settingsType === 'profiles-book'))
  const removal = p.deleteEntityTree(deleted.book.id)
  const reading = p.getBookProfileSelections(deleted.book.id).catch(error => assert.match(error.message, /no longer exists/))
  await Promise.all([removal, reading])
  assert.equal(await db.table('entities').get(`settings-profiles-book-${deleted.book.id}`), undefined)
})

test('late catalog results compare against the current selected role inside the write transaction', async () => {
  const { book } = await p.createBook(ai.initialAiSettings, 'Late model metadata'), db = await p.database()
  const text = profiles.createSettingsProfile('text', 'Late catalog profile')
  edit(text, { mainModel: 'catalog-old-model', mainModelContextLength: undefined })
  await p.saveBookProfileSelections(book.id, { ...await p.getBookProfileSelections(book.id), text: text.id })
  const stale = { ...await p.getBookAiSettings(book.id, []), mainModelContextLength: 64000 }
  const transaction = db.transaction
  let changed = false
  db.transaction = function (...args) {
    if (!changed && args.length === 3 && args[0] === 'rw' && args[1].name === 'entities') {
      changed = true
      edit(byId(text.id), { mainModel: 'catalog-new-model' })
    }
    return transaction.apply(this, args)
  }
  try {
    const runtime = await p.saveBookAiSettings(book.id, stale)
    assert.equal(runtime.mainModel, 'catalog-new-model')
    assert.equal(runtime.mainModelContextLength, undefined)
  } finally { db.transaction = transaction }
  assert.equal(changed, true)
  assert.deepEqual((await db.table('entities').get(`settings-profiles-book-${book.id}`)).modelMetadata, {})
})

test('archive definitions install under the book-reference write lock and deletion cannot orphan the new book', async () => {
  const { book } = await p.createBook(ai.initialAiSettings, 'Import deletion race'), db = await p.database()
  const copy = archive.copyBookArchive(await p.readBookArchive(book.id)), selected = copy.data.entities.find(entity => entity.settingsType === 'profiles-book').value.text
  const observed = []
  let deletion
  const observer = () => {
    if (!profiles.loadSettingsProfiles().profiles.some(profile => profile.id === selected)) return
    const transaction = db.constructor.currentTransaction
    observed.push(Boolean(transaction && transaction.db === db && transaction.storeNames.includes('entities')))
    deletion ??= profiles.deleteSettingsProfile(selected).then(() => 'deleted', error => error.message)
  }
  window.addEventListener(profiles.SETTINGS_PROFILES_EVENT, observer)
  try { await p.writeBookArchive(copy.data) } finally { window.removeEventListener(profiles.SETTINGS_PROFILES_EVENT, observer) }
  assert.deepEqual(observed, [true])
  assert.match(await deletion, /used/)
  assert.equal((await p.getBookProfileSelections(copy.bookId)).text, selected)
  assert.ok(byId(selected))
})

test('lazy migration preserves every legacy difference and original credentials while runtime uses the active global connection', async () => {
  const { book } = await p.createBook(ai.initialAiSettings, 'Legacy differences')
  const db = await p.database()
  await db.table('entities').delete(`settings-profiles-book-${book.id}`)
  const settings = { ...ai.initialAiSettings, provider: 'nanogpt', apiKey: 'LEGACY_SECRET', baseUrl: 'https://legacy-private-endpoint.test', mainModel: 'legacy-main', chatModel: 'legacy-chat', chatMaxModelRounds: 13, generationWordDelayMs: '99', speech: { ...ai.initialSpeechSettings, apiKey: 'LEGACY_SPEECH_SECRET', model: 'legacy-voice-model', voice: 'legacy-voice', readAloudAfterGeneration: true }, responseLengths: { story: 'Legacy length', codex: '', summary: '' }, promptCompositions: { ...ai.defaultPromptCompositions, story: { systemPrompt: 'Legacy custom story', predefinedMessages: [] }, assistant: { systemPrompt: 'Legacy custom chat', predefinedMessages: [] } } }
  const original = { id: `settings-ai-${book.id}`, type: 'settings', settingsType: 'ai', bookId: book.id, parentId: book.id, value: settings, createdAt: 1, updatedAt: 1 }
  await db.table('entities').put(original)
  const results = await Promise.all(Array.from({ length: 4 }, () => p.getBookProfileSelections(book.id)))
  assert.ok(results.every(value => JSON.stringify(value) === JSON.stringify(results[0])))
  const selections = await p.getBookProfileSelections(book.id), beforeCount = profiles.loadSettingsProfiles().profiles.length
  assert.deepEqual(await p.getBookProfileSelections(book.id), selections)
  assert.equal(profiles.loadSettingsProfiles().profiles.length, beforeCount)
  assert.deepEqual(await db.table('entities').get(original.id), original)
  assert.deepEqual(await p.readPreservedBookAiSettings(book.id), original.value)
  const runtime = await p.getBookAiSettings(book.id, ['global-favorite'])
  assert.equal(runtime.mainModel, 'legacy-main')
  assert.equal(runtime.chatModel, 'legacy-chat')
  assert.equal(runtime.chatMaxModelRounds, 13)
  assert.equal(runtime.characterModel, 'legacy-chat')
  assert.equal(runtime.characterMaxModelRounds, 13)
  assert.equal(runtime.promptCompositions.story.systemPrompt, 'Legacy custom story')
  assert.equal(runtime.promptCompositions.assistant.systemPrompt, 'Legacy custom chat')
  assert.equal(runtime.responseLengths.story, 'Legacy length')
  assert.equal(runtime.generationWordDelayMs, '99')
  assert.equal(runtime.speech.model, 'legacy-voice-model')
  assert.equal(runtime.speech.readAloudAfterGeneration, true)
  assert.equal(runtime.provider, 'litellm')
  assert.equal(runtime.apiKey, 'GLOBAL_SECRET')
  assert.equal(runtime.baseUrl, 'https://private-endpoint.test/v1')
  assert.equal(runtime.speech.apiKey, 'SPEECH_SECRET')
  safe(profiles.loadSettingsProfiles())
  const runtimeBefore = JSON.stringify(byId(selections.text))
  await p.saveBookAiSettings(book.id, { ...runtime, mainModelContextLength: 12345, mainModel: runtime.mainModel, chatMaxModelRounds: 77, apiKey: 'DO_NOT_SAVE_SECRET' })
  assert.equal(JSON.stringify(byId(selections.text)), runtimeBefore)
  assert.equal((await p.getBookAiSettings(book.id, [])).mainModelContextLength, 12345)
  assert.equal((await p.getBookAiSettings(book.id, [])).chatMaxModelRounds, 13)
  assert.deepEqual(await db.table('entities').get(original.id), original)
  const portable = await archive.decodeBookArchive(archive.encodeBookArchive(await p.readBookArchive(book.id)))
  await sync.saveSyncConnection({ bookId: book.id, remoteBookId: 'legacy-recovery-remote', endpoint: 'https://sync.test', createdAt: 1, updatedAt: 1 }, { bookId: book.id, status: 'synced', remoteETag: '1', localContentHash: 'hash', updatedAt: 1 })
  await sync.replaceConnectedBookArchive(book.id, portable, { bookId: book.id, status: 'synced', remoteETag: '2', localContentHash: 'hash2', updatedAt: 2 })
  assert.equal(await db.table('entities').get(original.id), undefined)
  assert.deepEqual(await p.readPreservedBookAiSettings(book.id), original.value)
  await p.deleteEntityTree(book.id)
  assert.equal(await p.readPreservedBookAiSettings(book.id), undefined)
})

test('migration failures retain original settings and retry safely after storage recovers', async () => {
  const { book } = await p.createBook(ai.initialAiSettings, 'Interrupted migration'), db = await p.database()
  await db.table('entities').delete(`settings-profiles-book-${book.id}`)
  const original = { id: `settings-ai-${book.id}`, type: 'settings', settingsType: 'ai', bookId: book.id, parentId: book.id, value: { ...ai.initialAiSettings, mainModel: 'migration-retry-model', apiKey: 'RETRY_SECRET' }, createdAt: 1, updatedAt: 1 }
  await db.table('entities').put(original)
  const claimed = profiles.saveSettingsProfile({ ...byId(profiles.loadSettingsProfiles().defaults.text), id: `profile-migrated-${book.id}-text`, name: 'Explicit user edit after an interrupted migration', settings: { ...byId(profiles.loadSettingsProfiles().defaults.text).settings, mainModel: 'do-not-overwrite-this-profile' } })
  const save = localStorage.setItem
  localStorage.setItem = () => { throw new Error('Simulated quota failure') }
  try { await assert.rejects(p.getBookProfileSelections(book.id), /quota/) } finally { localStorage.setItem = save }
  assert.deepEqual(await db.table('entities').get(original.id), original)
  assert.equal(await db.table('entities').get(`settings-profiles-book-${book.id}`), undefined)
  assert.deepEqual(await p.readPreservedBookAiSettings(book.id), original.value)
  const savedLibrary = storage.get(profiles.SETTINGS_PROFILES_STORAGE_KEY)
  storage.set(profiles.SETTINGS_PROFILES_STORAGE_KEY, '{corrupt')
  try { assert.deepEqual(await p.readPreservedBookAiSettings(book.id), original.value) } finally { storage.set(profiles.SETTINGS_PROFILES_STORAGE_KEY, savedLibrary) }
  await p.getBookProfileSelections(book.id)
  assert.equal((await p.getBookAiSettings(book.id, [])).mainModel, 'migration-retry-model')
  assert.equal((await p.readPreservedBookAiSettings(book.id)).apiKey, 'RETRY_SECRET')
  assert.notEqual((await p.getBookProfileSelections(book.id)).text, claimed.id)
  assert.deepEqual(byId(claimed.id), claimed)
})

test('independent speech, UI and media selections resolve parameters with only local credentials', async () => {
  const { book } = await p.createBook(ai.initialAiSettings, 'Independent role profiles'), selections = await p.getBookProfileSelections(book.id)
  const tts = profiles.createSettingsProfile('tts', 'Selected TTS'), stt = profiles.createSettingsProfile('stt', 'Selected STT'), ui = profiles.createSettingsProfile('ui', 'Selected UI')
  edit(tts, { speech: { ...tts.settings.speech, model: 'selected-tts', voice: 'selected-voice', maxParallelRequests: '3', readAloudAfterGeneration: true, apiKey: 'IGNORED_SECRET' } })
  edit(stt, { speech: { ...stt.settings.speech, transcriptionModel: 'selected-stt', transcriptionLanguage: 'ru', streamTranscription: true, openaiApiKey: 'IGNORED_SECRET' } })
  profiles.saveSettingsProfile({ ...ui, ui: { ...ui.ui, activeThemeId: 'warm-paper' }, settings: { ...ui.settings, generationWordDelayMs: '73' } })
  const imageModule = await import('../src/features/images/image-settings.ts')
  const image = profiles.createSettingsProfile('image', 'Selected images'), video = profiles.createSettingsProfile('video', 'Selected video')
  const favorite = imageModule.imageFavorite(imageModule.documentedImageModels.find(model => model.id === 'gpt-image-1'), [])
  image.media = { favorites: [favorite], defaultAlias: favorite.alias, defaultAliases: { 'text-to-image': favorite.alias } }
  profiles.saveSettingsProfile(image)
  await p.saveBookProfileSelections(book.id, { ...selections, tts: tts.id, stt: stt.id, ui: ui.id, image: image.id, video: video.id })
  const selected = await p.getBookProfileSelections(book.id), runtime = profiles.resolveProfileSettings(selected)
  assert.equal(runtime.speech.model, 'selected-tts'); assert.equal(runtime.speech.voice, 'selected-voice')
  assert.equal(runtime.speech.transcriptionModel, 'selected-stt'); assert.equal(runtime.speech.transcriptionLanguage, 'ru'); assert.equal(runtime.speech.streamTranscription, true)
  assert.equal(runtime.speech.apiKey, 'SPEECH_SECRET'); assert.equal(runtime.speech.openaiApiKey, 'STT_SECRET')
  assert.equal(runtime.generationWordDelayMs, '73')
  assert.equal(profiles.resolveProfileUiSettings(selected).activeThemeId, 'warm-paper')
  const resolved = profiles.resolveProfileMediaSettings(selected)
  assert.equal(resolved.defaultAliases['text-to-image'], favorite.alias)
  assert.equal(resolved.favorites.length, 1)
  safe(profiles.loadSettingsProfiles())
})

test('archives have no connection data anywhere, remap profiles and preserve attachments without overwriting shared definitions', async () => {
  const { book, scene } = await p.createBook(ai.initialAiSettings, 'Portable profiles')
  const selection = await p.getBookProfileSelections(book.id), text = profiles.createSettingsProfile('text', 'Portable text')
  edit(text, { mainModel: 'portable-main' })
  await p.saveBookProfileSelections(book.id, { ...selection, text: text.id })
  const entry = await p.createCodexEntry(book.id, 'Illustrated entry')
  const image = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6AAAAAElFTkSuQmCC', 'base64')], { type: 'image/png' })
  await p.saveIllustration(entry.id, { image, thumbnail: image, width: 1, height: 1 }, { caption: 'Portable', alt: 'Entry image', cropX: 50, cropY: 50 })
  await p.saveDocumentContent(scene.id, 'Portable prose')
  const data = await p.readBookArchive(book.id)
  data.entities.push({ id: 'unsafe-chat', type: 'chat', title: 'Unsafe fields', parentId: book.id, bookId: book.id, createdAt: 1, updatedAt: 1, apiKey: 'SNAPSHOT_SECRET', nested: { baseUrl: 'https://private-endpoint.test', connectionId: 'CONNECTION_SECRET', accountId: 'ACCOUNT_SECRET', localConnectionFingerprint: 'LOCAL_ACCOUNT_SECRET', clientSecret: 'CLIENT_SECRET', api_token: 'API_TOKEN_SECRET', privateKey: 'PRIVATE_KEY_SECRET', credentialsLikeParticipant: { entryId: entry.id, label: 'Not a participant', token: 'SPOOFED_TOKEN_SECRET' } }, character: { participants: [{ entryId: entry.id, label: 'Portable speaker', token: 'speaker-0123456789abcdef' }] } })
  const jobImage = { id: 'safe-job-asset', bookId: book.id, prompt: 'Job image', provider: 'openai', model: 'gpt-image-1', width: 1, height: 1, createdAt: 1, kept: true, image, thumbnail: image }
  data.galleryImages = [jobImage]
  const job = { id: 'safe-job', bookId: book.id, prompt: 'Job image', provider: 'openai', model: 'gpt-image-1', modelAlias: 'Job model', size: { value: '1024x1024', width: 1024, height: 1024 }, status: 'completed', decision: 'kept', assetId: jobImage.id, createdAt: 1, localConnectionFingerprint: 'LOCAL_JOB_SECRET', nested: { endpoint: 'https://private-endpoint.test', account: 'JOB_ACCOUNT_SECRET' } }
  data.imageJobs = [job]
  await (await p.database()).table('galleryImages').put(jobImage)
  await (await p.database()).table('imageJobs').put(job)
  assert.equal((await p.readBookArchive(book.id)).imageJobs[0].localConnectionFingerprint, undefined)
  const blob = archive.encodeBookArchive(data), length = new DataView(await blob.slice(8, 12).arrayBuffer()).getUint32(0)
  const manifest = JSON.parse(await blob.slice(12, 12 + length).text())
  safe(manifest)
  assert.equal(manifest.entities.find(entity => entity.id === 'unsafe-chat').character.participants[0].token, 'speaker-0123456789abcdef')
  assert.equal(manifest.version, 4)
  const decoded = await archive.decodeBookArchive(blob)
  safe(decoded)
  assert.equal(decoded.entities.find(entity => entity.id === 'unsafe-chat').character.participants[0].token, 'speaker-0123456789abcdef')
  const maliciousHeader = new Uint8Array(12), maliciousManifest = new TextEncoder().encode(JSON.stringify({ ...manifest, settingsProfiles: manifest.settingsProfiles.map(profile => profile.kind === 'ui' ? { ...profile, ui: { ...profile.ui, activeThemeId: 'unknown-imported-theme' } } : profile) }))
  maliciousHeader.set(new TextEncoder().encode('ARCBK001')); new DataView(maliciousHeader.buffer).setUint32(8, maliciousManifest.length)
  await assert.rejects(archive.decodeBookArchive(new Blob([maliciousHeader, maliciousManifest, blob.slice(12 + length)])), /theme.*unavailable/)
  const savedLibrary = storage.get(profiles.SETTINGS_PROFILES_STORAGE_KEY)
  edit(byId(text.id), { mainModel: 'changed-locally' })
  const localBefore = JSON.stringify(byId(text.id))
  const copy = archive.copyBookArchive(decoded)
  await p.writeBookArchive(copy.data)
  assert.equal((await p.getBookAiSettings(copy.bookId, [])).mainModel, 'portable-main')
  assert.equal(JSON.stringify(byId(text.id)), localBefore)
  assert.notEqual((await p.getBookProfileSelections(copy.bookId)).text, text.id)
  assert.equal((await p.getBookProfileSelections(copy.bookId)).text, copy.data.entities.find(entity => entity.settingsType === 'profiles-book').value.text)
  const copiedEntry = (await p.listEntitiesByBook(copy.bookId, 'codexEntry'))[0]
  assert.deepEqual(await (await p.getIllustration(copiedEntry.id)).image.arrayBuffer(), await image.arrayBuffer())
  const missing = structuredClone(decoded); missing.settingsProfiles = missing.settingsProfiles.filter(profile => profile.kind !== 'chat')
  assert.throws(() => archive.encodeBookArchive(missing), /invalid/)
  assert.notEqual(storage.get(profiles.SETTINGS_PROFILES_STORAGE_KEY), savedLibrary)
})

test('legacy response-length guidance survives archive versions 1–3 and live profile migration', async () => {
  const { responseLengths: _lengths, ...legacySettings } = ai.initialAiSettings
  const value = { ...legacySettings, responseLength: 'Keep it under 600 words.', apiKey: 'OLD_SECRET', baseUrl: 'https://old-private-endpoint.test' }
  const sanitized = profiles.sanitizeProfileSettings(value)
  assert.equal(sanitized.responseLengths.story, value.responseLength)
  assert.equal(Object.hasOwn(sanitized, 'responseLength'), false)
  safe(sanitized)
  const current = profiles.sanitizeProfileSettings({ ...value, responseLengths: { story: 'Current guidance', codex: '', summary: '' } })
  assert.equal(current.responseLengths.story, 'Current guidance')
  for (const version of [1, 2, 3]) {
    const book = { id: `legacy-length-${version}`, type: 'book', title: `Legacy length ${version}`, createdAt: 1, updatedAt: 1 }
    const legacy = { id: `settings-ai-${book.id}`, type: 'settings', settingsType: 'ai', bookId: book.id, parentId: book.id, value, createdAt: 1, updatedAt: 1 }
    const manifest = new TextEncoder().encode(JSON.stringify({ format: 'arc-book', version, entities: [book, legacy], snapshots: [], dependencies: [], illustrations: [] }))
    const header = new Uint8Array(12)
    header.set(new TextEncoder().encode('ARCBK001'))
    new DataView(header.buffer).setUint32(8, manifest.length)
    const decoded = await archive.decodeBookArchive(new Blob([header, manifest]))
    assert.equal(decoded.entities.find(entity => entity.settingsType === 'ai').value.responseLengths.story, value.responseLength)
    safe(decoded)
    const copied = archive.copyBookArchive(decoded)
    await p.writeBookArchive(copied.data)
    assert.equal((await p.getBookAiSettings(copied.bookId, [])).responseLengths.story, value.responseLength)
  }
})

test('old archives remain readable and credentials never restore from them', async () => {
  const book = { id: 'old-archive-book', type: 'book', title: 'Old archive', createdAt: 1, updatedAt: 1 }
  const legacy = { id: 'settings-ai-old-archive-book', type: 'settings', settingsType: 'ai', bookId: book.id, parentId: book.id, value: { ...ai.initialAiSettings, apiKey: 'OLD_SECRET', baseUrl: 'https://old-private-endpoint.test', mainModel: 'old-archive-model' }, createdAt: 1, updatedAt: 1 }
  const encoded = archive.encodeBookArchive({ entities: [book, legacy], snapshots: [], dependencies: [], illustrations: [] })
  const decoded = await archive.decodeBookArchive(encoded), copied = archive.copyBookArchive(decoded)
  await p.writeBookArchive(copied.data)
  const runtime = await p.getBookAiSettings(copied.bookId, [])
  assert.equal(runtime.mainModel, 'old-archive-model')
  assert.equal(runtime.apiKey, 'GLOBAL_SECRET')
  safe(decoded)
})

test('ordinary and character chats snapshot selected book roles, thinking, prompts and rounds; edits never mutate existing chats', async () => {
  const { book, scene } = await p.createBook(ai.initialAiSettings, 'Snapshots'), selection = await p.getBookProfileSelections(book.id)
  const text = profiles.createSettingsProfile('text', 'Snapshot roles'), chatPreset = profiles.createSettingsProfile('chat', 'Chat snapshot preset'), characterPreset = profiles.createSettingsProfile('character', 'Character snapshot preset')
  edit(chatPreset, { promptCompositions: { ...chatPreset.settings.promptCompositions, assistant: { systemPrompt: 'Chat initial prompt', predefinedMessages: [] } } })
  edit(characterPreset, { promptCompositions: { ...characterPreset.settings.promptCompositions, assistant: { systemPrompt: 'Character initial prompt', predefinedMessages: [] } } })
  edit(text, { chatModel: 'book-chat', chatThinkingEffort: 'high', chatMaxModelRounds: 12, characterModel: 'book-character', characterThinkingEffort: 'low', characterMaxModelRounds: 5, characterModelContextLength: 42000, chatPromptPresetId: chatPreset.id, characterPromptPresetId: characterPreset.id })
  await p.saveBookProfileSelections(book.id, { ...selection, text: text.id })
  const ordinary = await chats.createChat(book.id)
  const participant = await p.createCodexEntry(book.id, 'Mara')
  await (await p.database()).table('entities').update(participant.id, { typeId: 'lore-character', content: 'Mara is alive.' })
  const notifications = []
  const observer = event => { if (event.detail?.bookId === book.id) notifications.push(chats.listChats(book.id)) }
  window.addEventListener('arc-chat-changed', observer)
  let character
  try { character = await characters.createCharacterChat(book.id, [{ entryId: participant.id, label: 'Mara' }], { bookId: book.id, sceneId: scene.id, position: 0 }) } finally { window.removeEventListener('arc-chat-changed', observer) }
  assert.equal(notifications.length, 1)
  for (const list of await Promise.all(notifications)) assert.deepEqual(list.find(chat => chat.id === character.id).character, character.character)
  assert.equal(ordinary.model, 'book-chat'); assert.equal(ordinary.thinkingEffort, 'high'); assert.equal(ordinary.maxModelRounds, 12)
  assert.equal(ordinary.promptComposition.systemPrompt, 'Chat initial prompt')
  assert.equal(character.model, 'book-character'); assert.equal(character.thinkingEffort, 'low'); assert.equal(character.maxModelRounds, 5)
  assert.equal(character.modelContextLength, 42000)
  assert.equal(character.promptComposition.systemPrompt, 'Character initial prompt')
  const storedCharacter = await p.getEntity(character.id)
  assert.deepEqual(storedCharacter.character, character.character)
  const frame = await characters.captureCharacterFrame(character, [])
  assert.match(frame.instructions, /Workspace mutations require approval/)
  edit(byId(text.id), { chatModel: 'new-chat', characterModel: 'new-character', chatMaxModelRounds: 3, characterMaxModelRounds: 4 })
  edit(byId(chatPreset.id), { promptCompositions: { ...chatPreset.settings.promptCompositions, assistant: { systemPrompt: 'New chat prompt', predefinedMessages: [] } } })
  assert.deepEqual(await chats.getChat(ordinary.id), ordinary)
  assert.deepEqual(await chats.getChat(character.id), character)
  assert.equal((await chats.createChat(book.id)).model, 'new-chat')
  assert.equal((await chats.createChat(book.id)).promptComposition.systemPrompt, 'New chat prompt')
  edit(byId(characterPreset.id), { promptCompositions: { ...characterPreset.settings.promptCompositions, assistant: { systemPrompt: 'New character prompt', predefinedMessages: [] } } })
  assert.deepEqual(await chats.getChat(character.id), character)
  const reset = await chats.resetChatPromptComposition(character.id)
  assert.equal(reset.promptComposition.systemPrompt, 'New character prompt')
  assert.equal(reset.model, character.model)
  assert.deepEqual(reset.character, character.character)
})

test('sync preserves non-conflicting portable profile IDs so subsequent reads do not churn identities', async () => {
  const { book } = await p.createBook(ai.initialAiSettings, 'Stable sync IDs')
  const copy = archive.copyBookArchive(await p.readBookArchive(book.id))
  const portable = await archive.decodeBookArchive(archive.encodeBookArchive(copy.data))
  const expected = portable.entities.find(entity => entity.settingsType === 'profiles-book').value
  await sync.writeConnectedBookArchive(portable, { bookId: copy.bookId, remoteBookId: 'stable-profile-remote', endpoint: 'https://sync.test', createdAt: 1, updatedAt: 1 }, { bookId: copy.bookId, status: 'synced', remoteETag: '1', localContentHash: 'hash', updatedAt: 1 })
  assert.deepEqual(await p.getBookProfileSelections(copy.bookId), expected)
  assert.deepEqual(await p.getBookProfileSelections(copy.bookId), expected)
  assert.deepEqual((await p.readBookArchive(copy.bookId)).settingsProfiles.map(profile => profile.id), portable.settingsProfiles.map(profile => profile.id))
})

test('sync direct-entity replacement installs isolated profiles lazily without changing other books', async () => {
  const { book } = await p.createBook(ai.initialAiSettings, 'Sync profile book')
  const selection = await p.getBookProfileSelections(book.id), custom = profiles.createSettingsProfile('text', 'Sync text')
  const chatPreset = profiles.createSettingsProfile('chat', 'Sync chat'), characterPreset = profiles.createSettingsProfile('character', 'Sync character')
  edit(chatPreset, { promptCompositions: { ...chatPreset.settings.promptCompositions, assistant: { systemPrompt: 'Remote assistant prompt', predefinedMessages: [] } } })
  edit(characterPreset, { promptCompositions: { ...characterPreset.settings.promptCompositions, assistant: { systemPrompt: 'Remote character prompt', predefinedMessages: [] } } })
  edit(custom, { mainModel: 'remote-model', chatPromptPresetId: chatPreset.id, characterPromptPresetId: characterPreset.id })
  await p.saveBookProfileSelections(book.id, { ...selection, text: custom.id })
  const source = await p.readBookArchive(book.id), encoded = archive.encodeBookArchive(source)
  edit(byId(custom.id), { mainModel: 'other-local-book-model' })
  edit(byId(chatPreset.id), { promptCompositions: { ...chatPreset.settings.promptCompositions, assistant: { systemPrompt: 'Local assistant prompt', predefinedMessages: [] } } })
  edit(byId(characterPreset.id), { promptCompositions: { ...characterPreset.settings.promptCompositions, assistant: { systemPrompt: 'Local character prompt', predefinedMessages: [] } } })
  const other = await p.createBook(ai.initialAiSettings, 'Other local book')
  await p.saveBookProfileSelections(other.book.id, { ...selection, text: custom.id })
  const decoded = await archive.decodeBookArchive(encoded)
  await sync.saveSyncConnection({ bookId: book.id, remoteBookId: 'profile-remote', endpoint: 'https://sync.test', createdAt: 1, updatedAt: 1 }, { bookId: book.id, status: 'synced', remoteETag: '1', localContentHash: 'hash', updatedAt: 1 })
  await sync.replaceConnectedBookArchive(book.id, decoded, { bookId: book.id, status: 'synced', remoteETag: '2', localContentHash: 'hash2', updatedAt: 2 })
  assert.equal((await p.getBookAiSettings(book.id, [])).mainModel, 'remote-model')
  assert.equal((await p.getBookAiSettings(other.book.id, [])).mainModel, 'other-local-book-model')
  assert.notEqual((await p.getBookProfileSelections(book.id)).text, custom.id)
  const installed = await p.getBookProfileSelections(book.id), count = profiles.loadSettingsProfiles().profiles.length
  assert.notEqual(byId(installed.text).settings.chatPromptPresetId, chatPreset.id)
  assert.notEqual(byId(installed.text).settings.characterPromptPresetId, characterPreset.id)
  assert.equal((await p.getBookAiSettings(book.id, [])).promptCompositions.assistant.systemPrompt, 'Remote assistant prompt')
  assert.equal(profiles.resolveCharacterProfileComposition(installed).systemPrompt, 'Remote character prompt')
  assert.equal((await p.getBookAiSettings(other.book.id, [])).promptCompositions.assistant.systemPrompt, 'Local assistant prompt')
  assert.equal(profiles.resolveCharacterProfileComposition(await p.getBookProfileSelections(other.book.id)).systemPrompt, 'Local character prompt')
  const firstExport = await archive.encodeBookArchive(await p.readBookArchive(book.id)).arrayBuffer()
  await sync.replaceConnectedBookArchive(book.id, decoded, { bookId: book.id, status: 'synced', remoteETag: '3', localContentHash: 'hash3', updatedAt: 3 })
  assert.deepEqual(await p.getBookProfileSelections(book.id), installed)
  assert.equal(profiles.loadSettingsProfiles().profiles.length, count)
  assert.deepEqual(await archive.encodeBookArchive(await p.readBookArchive(book.id)).arrayBuffer(), firstExport)
})

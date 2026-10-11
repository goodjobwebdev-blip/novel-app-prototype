import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Match the runtime TypeScript loading used by the settings/profile tests.
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const url = new URL(specifier + '.ts', context.parentURL)
      if (existsSync(fileURLToPath(url))) return next(url.href, context)
    }
    return next(specifier, context)
  },
})
after(() => hooks.deregister())
const ai = await import('../src/shared/ai/ai-settings.ts')
const { PROMPT_COMPOSITION_SCHEMA_VERSION } = await import('../src/shared/ai/prompt-composition.ts')
const scopes = ['story', 'summarize', 'lore', 'assistant']
const jsonCopy = value => JSON.parse(JSON.stringify(value))
const mirror = compositions => Object.fromEntries(scopes.map(scope => [scope, compositions[scope].systemPrompt]))

function customSettings() {
  return ai.normalizeAiSettings({
    provider: 'litellm',
    apiKey: 'test-text-key',
    baseUrl: 'https://example.invalid/v1',
    providerProfiles: { litellm: { apiKey: 'test-profile-key', baseUrl: 'https://example.invalid/profile' } },
    mainModel: 'writer', supportModel: 'support', codexModel: 'codex', chatModel: 'chat', characterModel: 'character',
    mainThinkingEffort: 'high', supportThinkingEffort: 'low', codexThinkingEffort: 'medium', chatThinkingEffort: 'high',
    mainModelContextLength: 32000, chatModelContextLength: 16000,
    mainEffectiveContextLimit: '24000', codexEffectiveContextLimit: '8000',
    generationWordDelayMs: '75', chatMaxModelRounds: 12, characterMaxModelRounds: 10,
    chatPromptPresetId: 'chat-preset', characterPromptPresetId: 'character-preset',
    autocomplete: { enabled: true, model: 'completion', delayMs: 900, length: 'sentence' },
    responseLengths: { story: 'Story length', summary: 'Summary length', codex: 'Codex length' },
    speech: { ...ai.initialSpeechSettings, apiKey: 'test-speech-key', voice: 'custom-voice', readAloudAfterGeneration: true },
    favorites: ['writer', 'chat'],
    promptCompositions: Object.fromEntries(scopes.map(scope => [scope, {
      systemPrompt: `Custom ${scope} {{scene.summary_context}}`,
      predefinedMessages: [
        { id: `${scope}-example`, name: 'Example', role: 'assistant', enabled: true, template: `Example ${scope}` },
        { id: `${scope}-disabled`, role: 'user', enabled: false, template: '{{additional_context}}' },
      ],
    }])),
  })
}

function installStorage(t) {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  t.after(() => {
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
    else delete globalThis.localStorage
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else delete globalThis.window
  })
  const storage = new Map()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
  } })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() })
  return storage
}

test('normalization makes compositions authoritative and regenerates the versioned runtime mirror', () => {
  const input = customSettings()
  input.promptCompositionVersion = 0
  input.prompts = Object.fromEntries(scopes.map(scope => [scope, `Stale legacy ${scope}`]))
  input.promptCompositions.lore = {
    systemPrompt: '',
    predefinedMessages: [
      null,
      { id: ' example ', name: ' Example ', role: 'assistant', enabled: false, template: '{{additional_context}}' },
      { id: 'fallback', role: 'invalid', template: 42 },
    ],
  }
  const before = structuredClone(input)
  const normalized = ai.normalizeAiSettings(input)
  assert.equal(normalized.promptCompositionVersion, PROMPT_COMPOSITION_SCHEMA_VERSION)
  assert.deepEqual(normalized.promptCompositions.lore, {
    systemPrompt: '',
    predefinedMessages: [
      { id: 'example', name: 'Example', role: 'assistant', enabled: false, template: '{{additional_context}}' },
      { id: 'fallback', role: 'user', enabled: true, template: '' },
    ],
  })
  for (const scope of scopes.filter(scope => scope !== 'lore')) {
    assert.deepEqual(normalized.promptCompositions[scope], input.promptCompositions[scope])
  }
  assert.deepEqual(normalized.prompts, mirror(normalized.promptCompositions))
  assert.deepEqual(input, before)
  normalized.promptCompositions.story.predefinedMessages[0].template = 'Changed copy'
  assert.deepEqual(input, before, 'normalization must not share authored message objects')
})

test('custom legacy prompts migrate losslessly without rewriting aliases or changing the input', () => {
  const input = { prompts: Object.fromEntries(scopes.map(scope => [scope,
    ` Custom ${scope}\n{{scene.summary_context}} / {{additional_context}}\n`,
  ])) }
  const before = structuredClone(input)
  const normalized = ai.normalizeAiSettings(input)
  for (const scope of scopes) {
    assert.deepEqual(normalized.promptCompositions[scope], { systemPrompt: input.prompts[scope], predefinedMessages: [] })
  }
  assert.deepEqual(normalized.prompts, input.prompts)
  assert.equal(normalized.promptCompositionVersion, PROMPT_COMPOSITION_SCHEMA_VERSION)
  assert.deepEqual(input, before)
})

test('missing settings and recognized default legacy prompts upgrade to current default compositions', () => {
  assert.deepEqual(ai.normalizeAiSettings().promptCompositions, ai.defaultPromptCompositions)
  assert.deepEqual(ai.normalizeAiSettings({ prompts: { ...ai.defaultAiPrompts } }).promptCompositions, ai.defaultPromptCompositions)
  for (const historicalPrompt of ai.previousDefaultAssistantPrompts) {
    const legacy = { prompts: { story: 'Keep customized story', assistant: historicalPrompt } }
    const before = jsonCopy(legacy)
    const normalized = ai.normalizeAiSettings(legacy)
    assert.deepEqual(normalized.promptCompositions.assistant, ai.defaultPromptCompositions.assistant)
    assert.deepEqual(normalized.promptCompositions.story, { systemPrompt: 'Keep customized story', predefinedMessages: [] })
    assert.deepEqual(legacy, before)
    const storedComposition = { promptCompositions: { assistant: { systemPrompt: historicalPrompt, predefinedMessages: [] } } }
    assert.deepEqual(ai.normalizeAiSettings(storedComposition).promptCompositions.assistant, ai.defaultPromptCompositions.assistant)
  }
})

test('global persistence stores versioned compositions without the legacy mirror and reloads the runtime contract', t => {
  const storage = installStorage(t)
  const input = customSettings()
  input.promptCompositionVersion = 0
  input.prompts = Object.fromEntries(scopes.map(scope => [scope, `Stale ${scope}`]))
  const before = structuredClone(input)
  const saved = ai.saveAiSettings(input)
  const persisted = JSON.parse(storage.get(ai.AI_SETTINGS_STORAGE_KEY))
  assert.equal(Object.hasOwn(persisted, 'prompts'), false)
  assert.equal(persisted.promptCompositionVersion, PROMPT_COMPOSITION_SCHEMA_VERSION)
  assert.deepEqual(persisted.promptCompositions, input.promptCompositions)
  const { prompts: _mirror, ...expectedPersisted } = saved
  assert.deepEqual(persisted, jsonCopy(expectedPersisted))
  assert.deepEqual(saved.prompts, mirror(saved.promptCompositions))
  assert.deepEqual(ai.loadAiSettings(), saved)
  assert.deepEqual(input, before)
})

test('loading legacy storage migrates in memory without rewriting stored data until an explicit save', t => {
  const storage = installStorage(t)
  const legacy = { prompts: { story: 'Saved {{scene.summary_context}}', assistant: ai.previousDefaultAssistantPrompt }, favorites: ['kept'] }
  const raw = JSON.stringify(legacy)
  storage.set(ai.AI_SETTINGS_STORAGE_KEY, raw)
  const loaded = ai.loadAiSettings()
  assert.deepEqual(loaded.promptCompositions.story, { systemPrompt: legacy.prompts.story, predefinedMessages: [] })
  assert.deepEqual(loaded.promptCompositions.assistant, ai.defaultPromptCompositions.assistant)
  assert.deepEqual(loaded.favorites, ['kept'])
  assert.equal(storage.get(ai.AI_SETTINGS_STORAGE_KEY), raw, 'loading must not rewrite legacy storage')
  ai.saveAiSettings(loaded)
  const persisted = JSON.parse(storage.get(ai.AI_SETTINGS_STORAGE_KEY))
  assert.equal(Object.hasOwn(persisted, 'prompts'), false)
  assert.deepEqual(persisted.promptCompositions, loaded.promptCompositions)
  assert.deepEqual(ai.loadAiSettings(), loaded)
})

test('Book settings payload omits global favorites and the legacy mirror without losing compositions or other settings', () => {
  const settings = customSettings()
  const before = jsonCopy(settings)
  const book = ai.toBookAiSettings(settings)
  const { favorites: _favorites, prompts: _mirror, ...expected } = settings
  assert.equal(Object.hasOwn(book, 'favorites'), false)
  assert.equal(Object.hasOwn(book, 'prompts'), false)
  assert.equal(book.promptCompositionVersion, PROMPT_COMPOSITION_SCHEMA_VERSION)
  assert.deepEqual(book, expected)
  assert.deepEqual(ai.withGlobalFavorites(book, settings.favorites), settings)
  book.promptCompositions.story.predefinedMessages[0].template = 'Book edit'
  assert.deepEqual(jsonCopy(settings), before, 'Book payload must not alias the source composition')
})

test('System prompt updates preserve predefined messages, other scopes and unrelated settings', () => {
  for (const scope of scopes) {
    const settings = customSettings()
    const before = jsonCopy(settings)
    const systemPrompt = `Edited ${scope} {{additional_context}}`
    const updated = ai.withPromptSystemPrompt(settings, scope, systemPrompt)
    const expectedCompositions = { ...settings.promptCompositions, [scope]: { ...settings.promptCompositions[scope], systemPrompt } }
    assert.deepEqual(updated, { ...settings, promptCompositions: expectedCompositions, prompts: mirror(expectedCompositions) })
    assert.deepEqual(jsonCopy(settings), before)
    updated.promptCompositions[scope].predefinedMessages[0].template = 'Edited copy'
    assert.deepEqual(jsonCopy(settings), before)
  }
})

test('composition replacement copies authored messages and updates only its scope and runtime mirror', () => {
  const settings = customSettings()
  const before = jsonCopy(settings)
  const composition = { systemPrompt: 'Replacement {{scene.summary_context}}', predefinedMessages: [
    { id: 'replacement', role: 'system', enabled: false, template: '{{additional_context}}' },
  ] }
  const updated = ai.withPromptComposition(settings, 'assistant', composition)
  const expectedCompositions = { ...settings.promptCompositions, assistant: composition }
  assert.deepEqual(updated, { ...settings, promptCompositions: expectedCompositions, prompts: mirror(expectedCompositions) })
  updated.promptCompositions.assistant.predefinedMessages[0].template = 'Changed copy'
  assert.equal(composition.predefinedMessages[0].template, '{{additional_context}}')
  assert.deepEqual(jsonCopy(settings), before)
})

test('reset restores only the selected composition while preserving all unrelated AI settings and inputs', () => {
  const defaultsBefore = jsonCopy(ai.defaultPromptCompositions)
  for (const scope of scopes) {
    const settings = customSettings()
    const before = jsonCopy(settings)
    const reset = ai.resetPromptComposition(settings, scope)
    const expectedCompositions = { ...settings.promptCompositions, [scope]: ai.defaultPromptCompositions[scope] }
    assert.deepEqual(reset, { ...settings, promptCompositions: expectedCompositions, prompts: mirror(expectedCompositions) })
    assert.deepEqual(jsonCopy(settings), before)
    reset.promptCompositions[scope].systemPrompt = 'Edited reset copy'
    reset.promptCompositions[scope].predefinedMessages[0].template = 'Edited reset message'
    assert.deepEqual(ai.defaultPromptCompositions, defaultsBefore, 'reset must not share mutable default messages')
    assert.deepEqual(jsonCopy(settings), before)
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  PROMPT_PRESET_SCHEMA_VERSION,
  PROMPT_PRESET_STORAGE_KEY,
  applyPromptCompositionPreset,
  arcDefaultPromptPreset,
  deletePromptCompositionPreset,
  duplicatePromptCompositionPreset,
  loadUserPromptPresets,
  promptPresetsForScope,
  renamePromptCompositionPreset,
  savePromptCompositionPreset,
  validatePromptCompositionPreset,
} from '../src/prompt-presets.ts'

class MemoryStorage {
  values = new Map()
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, value) }
}

const composition = {
  systemPrompt: 'System {{book.title}}',
  predefinedMessages: [
    { id: 'first', name: 'Book', role: 'system', enabled: true, template: '{{book.title}}' },
    { id: 'disabled', name: 'Optional', role: 'user', enabled: false, template: 'Keep me' },
  ],
}

test('preset storage is versioned, device-global, and contains composition definitions only', () => {
  const storage = new MemoryStorage()
  const preset = savePromptCompositionPreset('story', 'Drafting', composition, { storage })
  const raw = JSON.parse(storage.getItem(PROMPT_PRESET_STORAGE_KEY))
  assert.equal(raw.version, PROMPT_PRESET_SCHEMA_VERSION)
  assert.deepEqual(Object.keys(raw.presets[0]).sort(), ['createdAt', 'id', 'kind', 'name', 'predefinedMessages', 'scope', 'systemPrompt', 'updatedAt'])
  assert.deepEqual(Object.keys(raw.presets[0].predefinedMessages[0]).sort(), ['enabled', 'name', 'role', 'template'])
  assert.equal(raw.presets[0].predefinedMessages[1].enabled, false)
  assert.equal(preset.scope, 'story')
})

test('user preset names are case-insensitively unique within a scope but reusable across scopes', () => {
  const storage = new MemoryStorage()
  savePromptCompositionPreset('story', 'Focused', composition, { storage })
  assert.throws(() => savePromptCompositionPreset('story', '  FOCUSED ', composition, { storage }), /already exists/)
  assert.doesNotThrow(() => savePromptCompositionPreset('chat', 'focused', composition, { storage }))
})

test('applying replaces the whole composition with fresh independent message IDs', () => {
  const storage = new MemoryStorage()
  const preset = savePromptCompositionPreset('codex', 'Canon', composition, { storage })
  const first = applyPromptCompositionPreset(preset)
  const second = applyPromptCompositionPreset(preset)
  assert.equal(first.systemPrompt, composition.systemPrompt)
  assert.deepEqual(first.predefinedMessages.map(({ id: _id, ...message }) => message), preset.predefinedMessages)
  assert.notDeepEqual(first.predefinedMessages.map((message) => message.id), second.predefinedMessages.map((message) => message.id))
  first.predefinedMessages[0].template = 'changed copy'
  assert.equal(preset.predefinedMessages[0].template, '{{book.title}}')
})

test('each scope has one immutable Arc default that can only be duplicated', () => {
  const storage = new MemoryStorage()
  for (const scope of ['story', 'chat', 'codex', 'summary']) {
    const presets = promptPresetsForScope(scope, composition, storage)
    assert.equal(presets.length, 1)
    assert.equal(presets[0].id, `arc-default:${scope}`)
    assert.equal(presets[0].kind, 'built-in')
    assert.ok(Object.isFrozen(presets[0]))
  }
  const builtIn = arcDefaultPromptPreset('summary', composition)
  assert.throws(() => deletePromptCompositionPreset(builtIn.id, storage), /cannot be deleted/)
  const copy = duplicatePromptCompositionPreset(builtIn, 'My summary', storage)
  assert.equal(copy.kind, 'user')
})

test('user presets support rename, duplicate, delete, and retain scope metadata', () => {
  const storage = new MemoryStorage()
  const original = savePromptCompositionPreset('chat', 'Interview', composition, { storage })
  const renamed = renamePromptCompositionPreset(original.id, 'Character interview', storage)
  const copy = duplicatePromptCompositionPreset(renamed, 'Character interview alt', storage)
  assert.equal(copy.scope, 'chat')
  assert.equal(loadUserPromptPresets(storage).length, 2)
  deletePromptCompositionPreset(renamed.id, storage)
  assert.deepEqual(loadUserPromptPresets(storage).map((preset) => preset.name), ['Character interview alt'])
})

test('fatal stored template or message errors block application', () => {
  const brokenTemplate = { ...arcDefaultPromptPreset('story', composition), systemPrompt: '{% if book.title %}missing end' }
  assert.match(validatePromptCompositionPreset(brokenTemplate)[0], /System prompt/)
  assert.throws(() => applyPromptCompositionPreset(brokenTemplate), /cannot be applied/)
  const brokenRole = { ...arcDefaultPromptPreset('chat', composition), predefinedMessages: [{ role: 'tool', enabled: true, template: 'bad role' }] }
  assert.ok(validatePromptCompositionPreset(brokenRole).some((error) => /invalid role/.test(error)))

  const storage = new MemoryStorage()
  storage.setItem(PROMPT_PRESET_STORAGE_KEY, JSON.stringify({ version: 1, presets: [{ id: 'broken', kind: 'user', scope: 'summary', name: 'Inspect me', systemPrompt: 42, predefinedMessages: [{ role: 'user', enabled: 'yes', template: null }] }] }))
  const stored = loadUserPromptPresets(storage)[0]
  assert.equal(stored.name, 'Inspect me')
  assert.throws(() => applyPromptCompositionPreset(stored), /cannot be applied/)
})

test('preset controls are present for Book/default scopes and individual Chat without touching generation settings', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const chat = readFileSync(new URL('../src/ChatFeature.tsx', import.meta.url), 'utf8')
  const controls = readFileSync(new URL('../src/PromptPresetControls.tsx', import.meta.url), 'utf8')
  assert.match(app, /\[\['story', 'Story'\], \['assistant', 'Chat'\], \['lore', 'Codex'\], \['summarize', 'Summary'\]\]/)
  assert.match(app, /<PromptPresetControls[\s\S]*withPromptComposition/)
  assert.match(chat, /<PromptPresetControls scope="chat"[\s\S]*onApply=\{setCompositionDraft\}/)
  assert.match(controls, /Selecting a preset does not change the composition/)
  assert.match(controls, /Replace the complete/)
  assert.doesNotMatch(controls, /model|thinking|contextProfile|history|responseLength/)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/ai-settings.ts', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

test('AI settings persist a versioned PromptComposition source of truth with a runtime legacy mirror', () => {
  assert.match(source, /promptCompositionVersion: number/)
  assert.match(source, /promptCompositions: PromptCompositions/)
  assert.match(source, /const promptCompositions = normalizePromptCompositions\(value\?\.promptCompositions, prompts\)/)
  assert.match(source, /const promptMirror = legacyPromptMirror\(promptCompositions\) as AiPrompts/)
  assert.match(source, /promptCompositionVersion: PROMPT_COMPOSITION_SCHEMA_VERSION/)
  assert.match(source, /promptCompositions,/)
  assert.match(source, /prompts: promptMirror/)
})

test('legacy customized prompts migrate before composition normalization and are not rewritten in place', () => {
  const legacyIndex = source.indexOf('const storedPrompts =')
  const historyUpgradeIndex = source.indexOf('previousDefaultAiPrompts.some')
  const compositionIndex = source.indexOf('normalizePromptCompositions(value?.promptCompositions, prompts)')
  assert.ok(legacyIndex >= 0 && historyUpgradeIndex > legacyIndex && compositionIndex > historyUpgradeIndex)
  assert.doesNotMatch(source, /replace\([^\n]*scene\.summary_context/)
})

test('new default and Book persistence omit the legacy prompts mirror but keep versioned compositions', () => {
  assert.match(source, /const \{ prompts: _legacyPromptMirror, \.\.\.persisted \} = normalized/)
  assert.match(source, /localStorage\.setItem\(AI_SETTINGS_STORAGE_KEY, JSON\.stringify\(persisted\)\)/)
  assert.match(source, /const \{ favorites: _globalFavorites, prompts: _legacyPromptMirror, \.\.\.bookSettings \} = copyAiSettings\(settings\)/)
})

test('reset mutates only the selected composition and preserves unrelated AI settings through normalizeAiSettings', () => {
  const start = source.indexOf('export function resetPromptComposition')
  const end = source.indexOf('export function withGlobalFavorites', start)
  const block = source.slice(start, end)
  assert.match(block, /\.\.\.settings,/)
  assert.match(block, /\.\.\.settings\.promptCompositions,/)
  assert.match(block, /\[scope\]: clonePromptComposition\(defaultPromptCompositions\[scope\]\)/)
})

test('existing System prompt editor now writes the composition System slot and reset is composition-scoped', () => {
  assert.match(app, /value=\{settings\.promptCompositions\[promptTab\]\.systemPrompt\}/)
  assert.match(app, /withPromptSystemPrompt\(current, promptTab, event\.target\.value\)/)
  assert.match(app, /resetPromptComposition\(current, promptTab\)/)
  assert.doesNotMatch(app, /update\('prompts'/)
})

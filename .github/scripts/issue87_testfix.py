from pathlib import Path

Path('tests/prompt-composition.test.mjs').write_text(r'''import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  assembleCompositionRequest,
  assembleNormalizedRequest,
  compositionsFromLegacyPrompts,
  dedupeAdditionalSources,
  likelyReusablePrefix,
  normalizeAppManagedPart,
  normalizePromptComposition,
  normalizedRequestDiagnosticText,
  providerCompatibilityError,
  providerMessagesFromNormalized,
  renderCompositionTemplate,
} from '../src/prompt-composition.ts'

const promptTemplateSource = readFileSync(new URL('../src/prompt-template.ts', import.meta.url), 'utf8')
const stabilityFor = (name) => name.startsWith('book.') ? 'book-state' : name === 'response.length' ? 'book-state' : 'turn-dynamic'

test('legacy single prompts migrate losslessly into System slots without invented predefined messages', () => {
  const legacy = { story: 'custom story {{scene.text}}', summarize: 'sum', lore: 'lore', assistant: 'chat' }
  const compositions = compositionsFromLegacyPrompts(legacy)
  assert.equal(compositions.story.systemPrompt, legacy.story)
  assert.deepEqual(compositions.story.predefinedMessages, [])
})

test('predefined messages preserve authored role/order and omit disabled or empty rendered rows', () => {
  const composition = normalizePromptComposition({ systemPrompt: 'System {{book.title}}', predefinedMessages: [
    { id: 'a', role: 'assistant', enabled: true, template: 'Example' },
    { id: 'b', role: 'system', enabled: false, template: 'Disabled' },
    { id: 'c', role: 'user', enabled: true, template: '{% if context.additional %}{{context.additional}}{% endif %}' },
    { id: 'd', role: 'user', enabled: true, template: 'Turn framing' },
  ]})
  const request = assembleCompositionRequest({ composition, values: { 'book.title': 'Book', 'context.additional': '' } })
  assert.deepEqual(request.providerMessages.map((message) => message.role), ['system', 'assistant', 'user'])
  assert.deepEqual(request.providerMessages.map((message) => message.content), ['System Book', 'Example', 'Turn framing'])
  assert.equal(request.parts.find((part) => part.sourceId === 'b')?.omitted, true)
  assert.equal(request.parts.find((part) => part.sourceId === 'c')?.omitted, true)
})

test('legacy aliases render canonical values without rewriting authored templates', () => {
  assert.equal(renderCompositionTemplate('{{scene.summary_context}} / {{additional_context}}', {
    'story.so_far': 'Earlier story', 'context.additional': 'Manual lore',
  }).content, 'Earlier story / Manual lore')
  assert.match(promptTemplateSource, /renderCompositionTemplate\(template, values\)\.content/)
})

test('automatic sources dedupe Additional by stable source identity, not rendered text or representation', () => {
  const automatic = [{ sourceId: 'codex-a', representation: 'Summary', content: 'same' }]
  const additional = [
    { sourceId: 'codex-a', representation: 'Full entry', content: 'different' },
    { sourceId: 'note-b', content: 'same' },
  ]
  assert.deepEqual(dedupeAdditionalSources(automatic, additional).map((source) => source.sourceId), ['note-b'])
})

test('normalized request retains ownership/source metadata and is the source for serialization and diagnostics', () => {
  const composition = normalizePromptComposition({ systemPrompt: 'S', predefinedMessages: [
    { id: 'few-shot', name: 'Example', role: 'assistant', enabled: true, template: 'A' },
  ]})
  const current = normalizeAppManagedPart({ id: 'turn', role: 'user', sourceKind: 'current-turn', ownership: 'current-turn', content: 'U' })
  const request = assembleCompositionRequest({ composition, values: {}, after: [current] })
  assert.deepEqual(request.providerMessages.map((message) => message.role), ['system', 'assistant', 'user'])
  assert.deepEqual(providerMessagesFromNormalized(request), request.providerMessages)
  assert.equal(normalizedRequestDiagnosticText(request), JSON.stringify({ messages: request.providerMessages }))
  assert.equal(request.parts[1].ownership, 'user-configuration')
  assert.equal(request.parts[2].sourceKind, 'current-turn')
})

test('provider role incompatibility is explicit and never silently rewritten', () => {
  const request = assembleCompositionRequest({
    composition: normalizePromptComposition({ systemPrompt: 'S', predefinedMessages: [{ id: 'a', role: 'assistant', enabled: true, template: 'A' }] }),
    values: {},
  })
  assert.match(providerCompatibilityError(request, { system: true, user: true, assistant: false }), /cannot represent the configured assistant message/)
  assert.throws(() => providerMessagesFromNormalized(request, { system: true, user: true, assistant: false }), /cannot represent/)
  assert.deepEqual(request.providerMessages.map((message) => message.role), ['system', 'assistant'])
})

test('dynamic source diagnostics stay attached to variables without splitting provider messages', () => {
  const composition = normalizePromptComposition({ systemPrompt: 'Use {{context.automatic}} and {{context.additional}}.' })
  const request = assembleCompositionRequest({
    composition,
    values: { 'context.automatic': 'AUTO', 'context.additional': 'ADD' },
    dynamicSources: {
      'context.automatic': [{ sourceId: 'scene-1', representation: 'Full', content: 'AUTO' }],
      'context.additional': [{ sourceId: 'note-1', representation: 'Full', content: 'ADD' }],
    },
  })
  assert.equal(request.providerMessages.length, 1)
  assert.deepEqual(request.parts[0].dynamicVariables?.map((item) => item.variable), ['context.automatic', 'context.additional'])
})

test('user-authored overlapping variables are rendered where authored without semantic deduplication', () => {
  const composition = normalizePromptComposition({ systemPrompt: '{{story.so_far}}', predefinedMessages: [{ id: 'a', role: 'user', enabled: true, template: '{{context.automatic}}' }] })
  const request = assembleCompositionRequest({ composition, values: { 'story.so_far': 'same', 'context.automatic': 'same' } })
  assert.deepEqual(request.providerMessages.map((message) => message.content), ['same', 'same'])
})

test('variable catalog advertises canonical context variables, aliases, and stability metadata', () => {
  for (const name of ['story.so_far', 'context.automatic', 'context.automatic_codex', 'context.additional']) {
    assert.match(promptTemplateSource, new RegExp(`name: '${name.replace('.', '\\.')}'.*stability: 'turn-dynamic'.*canonical: true`))
  }
  assert.match(promptTemplateSource, /name: 'scene\.summary_context'.*aliasFor: 'story\.so_far'/)
  assert.match(promptTemplateSource, /name: 'additional_context'.*aliasFor: 'context\.additional'/)
  assert.match(promptTemplateSource, /name: 'book\.title'.*stability: 'book-state'/)
})

test('likely reusable prefix stops before the first turn-dynamic authored part', () => {
  const request = assembleNormalizedRequest([
    { id: 's', role: 'system', sourceKind: 'system-prompt', ownership: 'user-configuration', content: 'stable', referencedVariables: [], enabled: true, omitted: false },
    { id: 'book', role: 'system', sourceKind: 'predefined-message', ownership: 'user-configuration', content: 'book', referencedVariables: ['book.title'], enabled: true, omitted: false },
    { id: 'scene', role: 'user', sourceKind: 'predefined-message', ownership: 'user-configuration', content: 'scene', referencedVariables: ['scene.text'], enabled: true, omitted: false },
  ])
  assert.deepEqual(likelyReusablePrefix(request.parts, stabilityFor), { partCount: 2, dynamicVariables: ['scene.text'] })
})
''')

Path('tests/ai-settings-prompt-composition.test.mjs').write_text(r'''import test from 'node:test'
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
''')

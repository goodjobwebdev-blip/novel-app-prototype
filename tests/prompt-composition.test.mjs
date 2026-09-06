import test from 'node:test'
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
  parsePromptTemplate,
  providerCompatibilityError,
  providerMessagesFromNormalized,
  referencedVariables,
  renderCompositionTemplate,
  validatePromptTemplate,
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

test('shared parser renders supported conditionals and extracts variables in authored order', () => {
  const template = 'Hello {{book.title}}\n{% if book.genre %}Genre: {{book.genre}}{% endif %}'
  assert.deepEqual(referencedVariables(template), ['book.title', 'book.genre'])
  assert.equal(renderCompositionTemplate(template, { 'book.title': 'Arc', 'book.genre': 'Fantasy' }).content, 'Hello Arc\nGenre: Fantasy')
  assert.equal(renderCompositionTemplate(template, { 'book.title': 'Arc', 'book.genre': '' }).content, 'Hello Arc')
  assert.deepEqual(parsePromptTemplate(template).diagnostics, [])
})

test('parser reports broken delimiters, control tags, condition structure, and nesting', () => {
  const cases = [
    ['Hello {{book.title', 'unclosed-variable'],
    ['Hello }}', 'unexpected-variable-close'],
    ['{% for book.title %}x{% endif %}', 'unsupported-control'],
    ['{% endif %}', 'unexpected-endif'],
    ['{% if book.title %}x', 'unclosed-condition'],
    ['{% if book.title %}{% if book.genre %}x{% endif %}{% endif %}', 'nested-condition'],
  ]
  for (const [template, code] of cases) {
    assert.ok(parsePromptTemplate(template).diagnostics.some((diagnostic) => diagnostic.code === code), `${template} should report ${code}`)
  }
})

test('scope-aware diagnostics identify typos, unavailable variables, and empty preview values', () => {
  const variables = [
    { name: 'book.overview', scopes: ['story', 'summarize'] },
    { name: 'book.genre', scopes: ['story', 'summarize'] },
    { name: 'scene.pov', scopes: ['story'] },
    { name: 'response.length', scopes: ['story', 'assistant'] },
  ]
  const diagnostics = (template, scope, values) => validatePromptTemplate({ template, variables, scope, values })
  const typo = diagnostics('{{book.overveiw}}', 'story')
  assert.equal(typo[0].code, 'unknown-variable')
  assert.equal(typo[0].suggestion, 'book.overview')
  assert.match(typo[0].message, /Did you mean \{\{book\.overview\}\}/)

  assert.equal(diagnostics('{{scene.pov}}', 'summarize')[0].code, 'out-of-scope-variable')
  assert.equal(diagnostics('{{book.genre}}', 'story', { 'book.genre': '' })[0].severity, 'warning')
  assert.deepEqual(diagnostics('{{response.length}}', 'assistant', { 'response.length': 'Brief' }), [])
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

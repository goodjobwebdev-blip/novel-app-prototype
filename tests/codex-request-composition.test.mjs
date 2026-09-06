import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  assembleCodexGenerationRequest,
  CODEX_CONTINUE_FALLBACK,
  codexRequestValues,
  defaultCodexPromptComposition,
} from '../src/codex-request.ts'

const book = { title: 'Tide', series: 'Lost Coasts', seriesOrder: '2', overview: 'A drowned city.', genre: 'Fantasy', style: 'Lyrical', pov: 'Third person', tense: 'Past', language: 'English' }
const baseContext = {
  currentSceneId: 'scene-2', currentSceneText: 'The door opened.', currentSceneTitle: 'Door',
  previousSceneId: '', previousSceneText: '', previousSceneTitle: '',
  summaryContext: 'Mara found the map.', lastSceneText: 'The door opened.', lastSceneTitle: 'Door',
  additionalContext: '', manualAdditionalContext: '', codexRepresentations: [], automaticCodex: [],
  storySoFarSources: [{ sourceId: 'summary-1', title: 'Earlier story', type: 'summary', representation: 'Summary', content: 'Mara found the map.' }],
  automaticSources: [
    { sourceId: 'entry-current', title: 'Mara', type: 'codex', category: 'Character', representation: 'Full entry', content: 'TARGET MUST NOT LEAK' },
    { sourceId: 'codex-compass', title: 'Compass', type: 'codex', category: 'Object', representation: 'Summary', content: 'Points toward remembered doors.' },
  ],
  additionalSources: [
    { sourceId: 'entry-current', title: 'Mara', type: 'codex', content: 'TARGET DUPLICATE' },
    { sourceId: 'codex-compass', title: 'Compass', type: 'codex', content: 'MANUAL DUPLICATE' },
    { sourceId: 'note-1', title: 'Door rules', type: 'note', content: 'Never answer alone.' },
  ],
}

const input = {
  composition: defaultCodexPromptComposition,
  book,
  responseLength: 'Several focused paragraphs.',
  entry: { id: 'entry-current', title: 'Mara', category: 'Character', content: 'BeforeAfter' },
  insertionPosition: 6,
  context: baseContext,
  instruction: '',
}

test('default Codex request preserves canonical order and the app-owned fallback', () => {
  const request = assembleCodexGenerationRequest(input)
  assert.deepEqual(request.providerMessages.map((message) => message.role), ['system', 'system', 'user', 'user', 'user', 'user'])
  assert.deepEqual(request.parts.map((part) => part.name), ['System prompt', 'Book', 'Current entry', 'Context', 'Response length', 'Current instruction'])
  assert.equal(request.providerMessages.at(-1).content, CODEX_CONTINUE_FALLBACK)
  assert.match(request.providerMessages[2].content, /# Before generation point\nBefore/)
  assert.match(request.providerMessages[2].content, /# After generation point\nAfter/)
})

test('Codex values expose the immutable full body/caret split and deterministic automatic order', () => {
  const values = codexRequestValues(input)
  assert.equal(values['entry.content'], 'BeforeAfter')
  assert.equal(values['entry.before_cursor'], 'Before')
  assert.equal(values['entry.after_cursor'], 'After')
  const order = ['# Story so far', '# Current scene', '# Automatically relevant Codex'].map((heading) => values['context.automatic'].indexOf(heading))
  assert.ok(order.every((position, index) => position >= 0 && (index === 0 || position > order[index - 1])))
  assert.doesNotMatch(values['context.automatic'], /TARGET MUST NOT LEAK/)
  assert.doesNotMatch(values['context.automatic_codex'], /TARGET MUST NOT LEAK/)
  assert.equal(values['context.additional'], 'Never answer alone.')
})

test('Codex target exclusion and Automatic-vs-Additional dedupe retain structured reasons', () => {
  const request = assembleCodexGenerationRequest(input)
  assert.deepEqual(request.dynamicSourceExclusions.map((item) => [item.sourceId, item.reason]), [
    ['entry-current', 'current-target'],
    ['entry-current', 'current-target'],
  ])
  assert.deepEqual(request.dynamicSourceDedupe.map((item) => [item.sourceId, item.reason]), [
    ['codex-compass', 'already-represented-automatically'],
  ])
})

test('empty anchor Scene uses the previous Scene fallback without also exposing scene.text', () => {
  const values = codexRequestValues({
    ...input,
    context: { ...baseContext, lastSceneText: '', lastSceneTitle: '', previousSceneId: 'scene-1', previousSceneText: 'The map surfaced.', previousSceneTitle: 'Map' },
  })
  assert.equal(values['scene.text'], '')
  assert.equal(values['scene.previous_text'], 'The map surfaced.')
  assert.match(values['context.automatic'], /# Previous scene\n\nThe map surfaced\./)
  assert.doesNotMatch(values['context.automatic'], /# Current scene/)
})

test('response guidance is template-owned and Assistant roles are never rewritten', () => {
  const emptyLength = assembleCodexGenerationRequest({ ...input, responseLength: '' })
  assert.equal(emptyLength.parts.find((part) => part.name === 'Response length').omitted, true)
  const authored = assembleCodexGenerationRequest({
    ...input,
    responseLength: 'Do not inject me.',
    composition: { systemPrompt: 'System', predefinedMessages: [{ id: 'example', name: 'Example', role: 'assistant', enabled: true, template: 'Example answer' }] },
    instruction: 'Expand the history.',
  })
  assert.deepEqual(authored.providerMessages.map((message) => message.role), ['system', 'assistant', 'user'])
  assert.doesNotMatch(authored.providerMessages.map((message) => message.content).join('\n'), /Do not inject me/)
})

test('legacy shared response length migrates to Story only and Codex defaults empty', () => {
  const settings = readFileSync(new URL('../src/ai-settings.ts', import.meta.url), 'utf8')
  const responseLength = readFileSync(new URL('../src/response-length.ts', import.meta.url), 'utf8')
  assert.match(settings, /normalizeResponseLengths\(value\?\.responseLengths, value\?\.responseLength\)/)
  assert.match(responseLength, /story: typeof input\?\.story === 'string' \? input\.story : typeof legacySharedValue === 'string' \? legacySharedValue : ''/)
  assert.match(responseLength, /codex: typeof input\?\.codex === 'string' \? input\.codex : ''/)
  assert.match(responseLength, /summary: typeof input\?\.summary === 'string' \? input\.summary : ''/)
  assert.match(settings, /lore: clonePromptComposition\(defaultCodexPromptComposition\)/)
})

test('Workspace and Request Preview consume the same normalized Codex assembly', () => {
  const workspace = readFileSync(new URL('../src/Workspace.tsx', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(workspace, /assembleCodexGenerationRequest\(\{[\s\S]*insertionPosition: context\.insertionPosition/)
  assert.match(workspace, /const messages = normalizedRequest\.providerMessages/)
  assert.match(workspace, /editor\?\.beginGeneration\(mode, 'append'\)/)
  assert.doesNotMatch(workspace, /renderLorePrompt|generationInstructionMessage/)
  assert.match(app, /codexNormalizedRequest = assembleCodexGenerationRequest/)
  assert.match(app, /const normalizedRequest = storyNormalizedRequest \?\? codexNormalizedRequest \?\? chatNormalizedRequest/)
})

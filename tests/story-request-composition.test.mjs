import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { assembleCompositionRequest, normalizeAppManagedPart } from '../src/prompt-composition.ts'
import { assembleStoryGenerationRequest, defaultStoryPromptComposition, upgradeDefaultStoryPromptComposition } from '../src/story-request.ts'

const book = { title: 'Tide', series: '', seriesOrder: '', overview: 'A door under the sea.', genre: 'Fantasy', style: 'Lyrical', pov: 'Third person', tense: 'Past', language: 'English' }
const context = {
  currentSceneId: 'scene-2', currentSceneText: 'BeforeAfter', currentSceneTitle: 'Door',
  previousSceneId: 'scene-1', previousSceneText: 'Previous', previousSceneTitle: 'Shore',
  summaryContext: 'Earlier', lastSceneText: '', lastSceneTitle: '', additionalContext: '',
  codexRepresentations: [], automaticCodex: [], automaticCodexContext: 'Lore',
  automaticSources: [{ sourceId: 'codex-1', title: 'Compass', type: 'codex', content: 'Lore' }],
  additionalSources: [{ sourceId: 'codex-1', content: 'Duplicate manual lore' }, { sourceId: 'note-1', content: 'Author note' }],
}

const storyRequestSource = readFileSync(new URL('../src/story-request.ts', import.meta.url), 'utf8')
const aiSettingsSource = readFileSync(new URL('../src/ai-settings.ts', import.meta.url), 'utf8')
const workspaceSource = readFileSync(new URL('../src/Workspace.tsx', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

test('default Story composition and final app-owned instruction preserve authored order', () => {
  for (const fragment of ["name: 'Book'", "name: 'Story context'", "name: 'Response length'"]) assert.match(storyRequestSource, new RegExp(fragment))
  assert.match(storyRequestSource, /STORY_CONTINUE_FALLBACK = 'Continue the story naturally from the generation point\.'/)
  const request = assembleCompositionRequest({
    composition: { systemPrompt: 'S', predefinedMessages: [{ id: 'book', role: 'system', enabled: true, template: 'B' }, { id: 'context', role: 'user', enabled: true, template: 'C' }] },
    values: {},
    after: [normalizeAppManagedPart({ id: 'turn', role: 'user', sourceKind: 'current-turn', ownership: 'current-turn', content: 'I' })],
  })
  assert.deepEqual(request.providerMessages.map((message) => message.role), ['system', 'system', 'user', 'user'])
  assert.equal(request.parts.at(-1).ownership, 'current-turn')
})

test('Story assembly exposes caret variables and deterministic automatic context headings', () => {
  assert.match(storyRequestSource, /'scene\.before_cursor': input\.sceneText\.slice\(0, insertionPosition\)/)
  assert.match(storyRequestSource, /'scene\.after_cursor': input\.sceneText\.slice\(insertionPosition\)/)
  const ordered = ['Story so far', 'Previous scene', 'Before generation point', 'After generation point', 'Automatic Codex'].map((name) => storyRequestSource.indexOf(`section('${name}'`))
  assert.ok(ordered.every((index) => index >= 0) && ordered.every((index, position) => position === 0 || index > ordered[position - 1]))
  assert.match(storyRequestSource, /dedupeDynamicSources\(automatic, input\.context\.additionalSources/)
})

test('Story migration, shared preview, and provider dispatch use the composition request', () => {
  assert.match(aiSettingsSource, /promptCompositions\.story = upgradeDefaultStoryPromptComposition\(promptCompositions\.story\)/)
  assert.match(aiSettingsSource, /storedCompositionWasHistoricalDefault/)
  assert.match(aiSettingsSource, /storedStoryWasHistoricalDefault/)
  assert.match(aiSettingsSource, /predefinedMessages: \[\]/)
  assert.match(workspaceSource, /assembleStoryGenerationRequest\(\{[\s\S]*insertionPosition: context\.insertionPosition/)
  assert.match(workspaceSource, /messages: requestSnapshot\.messages/)
  assert.match(appSource, /storyNormalizedRequest = assembleStoryGenerationRequest/)
  assert.match(appSource, /Captured generation point:/)
})

function storyRequest(sceneText = 'BeforeAfter', insertionPosition = 6, prepared = context) {
  return assembleStoryGenerationRequest({
    composition: defaultStoryPromptComposition, book, responseLength: 'One paragraph',
    sceneText, insertionPosition, context: prepared, instruction: 'Open the door.',
  })
}

test('default Story request places Codex and selected context before both manuscript sections', () => {
  const request = storyRequest()
  const text = request.providerMessages.map((message) => message.content).join('\n')
  const sections = ['# Story so far', '# Previous scene', '# Automatic Codex', '# Additional context', '# Before generation point', '# After generation point', '# Response length', 'Open the door.']
  const positions = sections.map((section) => text.indexOf(section))
  assert.ok(positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1])))
  for (const value of ['Earlier', 'Previous', 'Lore', 'Author note', 'Before', 'After']) {
    assert.equal(text.split(`\n\n${value}`).length - 1, 1, `${value} is included once`)
  }
  assert.doesNotMatch(text, /Duplicate manual lore/)
  assert.equal(request.parts.at(-1).ownership, 'current-turn')
})

test('appending manuscript preserves the request prefix through all unchanged reference context', () => {
  const before = JSON.stringify(storyRequest('Existing prose.', 15).providerMessages)
  const after = JSON.stringify(storyRequest('Existing prose. New passage.', 28).providerMessages)
  let common = 0
  while (common < before.length && before[common] === after[common]) common += 1
  assert.ok(common > before.indexOf('Lore'))
  assert.ok(common > before.indexOf('Author note'))
  assert.ok(common >= before.indexOf('Existing prose.') + 'Existing prose.'.length)
})

test('empty scenes retain previous-scene fallback and omit empty manuscript headings', () => {
  const text = storyRequest('', 0).providerMessages.map((message) => message.content).join('\n')
  assert.match(text, /# Previous scene\n\nPrevious/)
  assert.match(text, /# Automatic Codex\n\nLore/)
  assert.match(text, /# Additional context\n\nAuthor note/)
  assert.doesNotMatch(text, /# (Before|After) generation point/)
  const emptyReferences = { ...context, summaryContext: '', previousSceneText: '', automaticCodexContext: '', automaticSources: [], additionalSources: [] }
  const manuscriptOnly = storyRequest('Only prose', 10, emptyReferences).providerMessages.map((message) => message.content).join('\n')
  assert.match(manuscriptOnly, /# Before generation point\n\nOnly prose/)
  assert.doesNotMatch(manuscriptOnly, /# (Story so far|Previous scene|Automatic Codex|Additional context|After generation point)/)
})

function previousDefault() {
  const composition = structuredClone(defaultStoryPromptComposition)
  composition.predefinedMessages[1].template = `{% if context.automatic %}{{context.automatic}}{% endif %}

{% if context.additional %}# Additional context

{{context.additional}}{% endif %}`
  return composition
}

test('saved unchanged defaults upgrade without mutating input or replacing preset message IDs', () => {
  const previous = previousDefault()
  previous.predefinedMessages.forEach((message, index) => { message.id = `preset-${index}` })
  const original = structuredClone(previous)
  const upgraded = upgradeDefaultStoryPromptComposition(previous)
  assert.deepEqual(previous, original)
  assert.equal(upgraded.predefinedMessages[1].template, defaultStoryPromptComposition.predefinedMessages[1].template)
  assert.deepEqual(upgraded.predefinedMessages.map((message) => message.id), ['preset-0', 'preset-1', 'preset-2'])
  assert.deepEqual(upgradeDefaultStoryPromptComposition(upgraded), upgraded)
})

test('migration preserves customized, reordered, disabled, and extended compositions', () => {
  const edits = [
    (composition) => { composition.systemPrompt += '\nMy writing rules.' },
    (composition) => { composition.predefinedMessages[1].template += '\nMy context rules.' },
    (composition) => { composition.predefinedMessages.reverse() },
    (composition) => { composition.predefinedMessages[1].enabled = false },
    (composition) => { composition.predefinedMessages.push({ id: 'custom', role: 'user', enabled: true, template: 'Custom' }) },
  ]
  for (const edit of edits) {
    const composition = previousDefault()
    edit(composition)
    assert.deepEqual(upgradeDefaultStoryPromptComposition(composition), composition)
  }
})


test('default requests use effective scene settings while raw book variables remain available', () => {
  const input = { composition: defaultStoryPromptComposition, book, responseLength: '', sceneText: '', insertionPosition: 0, context, sceneOverrides: { pov: 'First person', tense: 'Present', language: 'French' } }
  const text = assembleStoryGenerationRequest(input).providerMessages.map((m) => m.content).join('\n')
  assert.match(text, /Point of view: First person \(Scene override\)/)
  assert.match(text, /Narrative tense: Present \(Scene override\)/)
  assert.match(text, /Writing style: Lyrical \(Book default\)/)
  const custom = { systemPrompt: '{{book.pov}} / {{scene.pov}} / {{scene.effective_pov}}', predefinedMessages: [] }
  assert.equal(assembleStoryGenerationRequest({ ...input, composition: custom }).providerMessages[0].content, 'Third person / First person / First person')
  assert.deepEqual(upgradeDefaultStoryPromptComposition(custom), custom)
})

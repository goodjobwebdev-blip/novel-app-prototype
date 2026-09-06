import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { assembleCompositionRequest, normalizeAppManagedPart } from '../src/prompt-composition.ts'

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
  assert.match(aiSettingsSource, /storedCompositionWasHistoricalDefault/)
  assert.match(aiSettingsSource, /storedStoryWasHistoricalDefault/)
  assert.match(aiSettingsSource, /predefinedMessages: \[\]/)
  assert.match(workspaceSource, /assembleStoryGenerationRequest\(\{[\s\S]*insertionPosition: context\.insertionPosition/)
  assert.match(workspaceSource, /messages: requestSnapshot\.messages/)
  assert.match(appSource, /storyNormalizedRequest = assembleStoryGenerationRequest/)
  assert.match(appSource, /Captured generation point:/)
})

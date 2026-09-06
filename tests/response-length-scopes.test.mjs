import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CODEX_RESPONSE_LENGTH_PRESETS,
  EMPTY_RESPONSE_LENGTHS,
  STORY_RESPONSE_LENGTH_PRESETS,
  SUMMARY_RESPONSE_LENGTH_PRESETS,
  normalizeResponseLengths,
} from '../src/response-length.ts'
import { assembleCodexGenerationRequest, defaultCodexPromptComposition } from '../src/codex-request.ts'
import { assembleSummaryGenerationRequest, defaultSummaryPromptComposition } from '../src/summary-request.ts'
import { promptVariables } from '../src/prompt-template.ts'

const book = { title: 'Tide', series: '', seriesOrder: '', overview: '', genre: '', style: '', pov: '', tense: '', language: 'English' }
const context = {
  currentSceneId: 'scene-1', currentSceneText: 'Scene body', currentSceneTitle: 'Scene',
  previousSceneId: '', previousSceneText: '', previousSceneTitle: '', summaryContext: '', lastSceneText: '', lastSceneTitle: '',
  additionalContext: '', manualAdditionalContext: '', codexRepresentations: [], automaticCodex: [], automaticSources: [], additionalSources: [], storySoFarSources: [],
}

test('legacy shared response length migrates to Story only and is removed from normalized state', () => {
  const migrated = normalizeResponseLengths(undefined, 'Finish this scene.')
  assert.deepEqual(migrated, { story: 'Finish this scene.', codex: '', summary: '' })
  const settings = readFileSync(new URL('../src/ai-settings.ts', import.meta.url), 'utf8')
  assert.match(settings, /normalizeResponseLengths\(value\?\.responseLengths, value\?\.responseLength\)/)
  assert.match(settings, /const \{ responseLength: _legacyResponseLength, \.\.\.storedValue \}/)
})

test('defaults and copied Book settings own independent response-length objects', () => {
  const defaults = normalizeResponseLengths({ story: 'Story guidance', codex: 'Codex guidance', summary: 'Summary guidance' })
  const bookSettings = normalizeResponseLengths(defaults)
  assert.notEqual(bookSettings, defaults)
  defaults.story = 'Changed default'
  bookSettings.summary = 'Changed book'
  assert.equal(bookSettings.story, 'Story guidance')
  assert.equal(defaults.summary, 'Summary guidance')
})

test('all three supported scopes default empty and expose their required preset families', () => {
  assert.deepEqual(EMPTY_RESPONSE_LENGTHS, { story: '', codex: '', summary: '' })
  assert.deepEqual(STORY_RESPONSE_LENGTH_PRESETS.map((preset) => preset.label), ['One paragraph', '2–3 paragraphs', 'Half scene', 'Finish scene', '≤300 words'])
  assert.deepEqual(CODEX_RESPONSE_LENGTH_PRESETS.map((preset) => preset.label), ['Brief', 'Standard', 'Detailed'])
  assert.deepEqual(SUMMARY_RESPONSE_LENGTH_PRESETS.map((preset) => preset.label), ['Compact', 'Standard', 'Detailed'])
  for (const preset of [...STORY_RESPONSE_LENGTH_PRESETS, ...CODEX_RESPONSE_LENGTH_PRESETS, ...SUMMARY_RESPONSE_LENGTH_PRESETS]) assert.ok(preset.value.trim())
})

test('response.length is one scope-local variable for Story, Codex, and Summary but not Chat', () => {
  const variable = promptVariables.find((candidate) => candidate.name === 'response.length')
  assert.deepEqual(variable.scopes, ['story', 'summarize', 'lore'])
  assert.equal(variable.stability, 'book-state')
  assert.equal(promptVariables.filter((candidate) => candidate.scopes.includes('assistant')).some((candidate) => candidate.name === 'response.length'), false)
})

test('built-in compositions place one ordinary Response length message before the final action', () => {
  const storySource = readFileSync(new URL('../src/story-request.ts', import.meta.url), 'utf8')
  assert.match(storySource, /export const defaultStoryPromptComposition[\s\S]*name: 'Response length'[\s\S]*export type StoryRequestInput/)
  assert.equal(defaultCodexPromptComposition.predefinedMessages.at(-1).name, 'Response length')
  assert.equal(defaultSummaryPromptComposition.predefinedMessages.at(-1).name, 'Response length')

  const codex = assembleCodexGenerationRequest({ composition: defaultCodexPromptComposition, book, responseLength: 'CODEX LENGTH', entry: { id: 'entry-1', title: 'Door', category: 'Place', content: 'Entry body' }, insertionPosition: 10, context })
  const summary = assembleSummaryGenerationRequest({ composition: defaultSummaryPromptComposition, book, responseLength: 'SUMMARY LENGTH', summary: { id: 'summary-1', content: '' }, target: { id: 'scene-1', type: 'scene', title: 'Scene', source: 'Scene body' } })
  for (const [request, expected] of [[codex, 'CODEX LENGTH'], [summary, 'SUMMARY LENGTH']]) {
    const part = request.parts.find((candidate) => candidate.name === 'Response length')
    assert.equal(part.omitted, false)
    assert.match(part.content, new RegExp(expected))
    assert.equal(request.parts.indexOf(part), request.parts.length - 2)
  }
})

test('empty or unreferenced guidance is never secretly injected in any generation scope', () => {
  const bareComposition = { systemPrompt: 'System only', predefinedMessages: [] }
  const requests = [
    assembleCodexGenerationRequest({ composition: bareComposition, book, responseLength: 'CODEX SECRET', entry: { id: 'entry-1', title: 'Door', category: 'Place', content: 'Entry body' }, insertionPosition: 10, context }),
    assembleSummaryGenerationRequest({ composition: bareComposition, book, responseLength: 'SUMMARY SECRET', summary: { id: 'summary-1', content: '' }, target: { id: 'scene-1', type: 'scene', title: 'Scene', source: 'Scene body' } }),
  ]
  requests.forEach((request) => assert.doesNotMatch(request.providerMessages.map((message) => message.content).join('\n'), /(?:STORY|CODEX|SUMMARY) SECRET/))
  const storySource = readFileSync(new URL('../src/story-request.ts', import.meta.url), 'utf8')
  assert.match(storySource, /values: storyRequestValues\(input\)/)
  assert.doesNotMatch(storySource, /responseLengthMessage|hiddenResponseLength/)
})

test('settings UI edits exactly the active scope and previews the same rendered provider messages', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const workspace = readFileSync(new URL('../src/Workspace.tsx', import.meta.url), 'utf8')
  assert.match(app, /promptTab === 'lore' \? 'codex' : promptTab === 'summarize' \? 'summary' : promptTab === 'story' \? 'story' : null/)
  assert.match(app, /responseLengths: \{ \.\.\.current\.responseLengths, \[responseLengthScope\]: event\.target\.value \}/)
  assert.match(app, /Available as <code>\{'\{\{response\.length\}\}'\}<\/code> only in this generation scope/)
  assert.match(app, /normalizedRequestDiagnosticText\(request\)/)
  assert.match(workspace, /settings\.responseLengths\.story/)
  assert.match(workspace, /settings\.responseLengths\.codex/)
  assert.match(workspace, /settings\.responseLengths\.summary/)
})

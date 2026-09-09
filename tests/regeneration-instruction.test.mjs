import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { replaceGenerationInstruction } from '../src/regeneration-instruction.ts'
import { assembleStoryGenerationRequest, defaultStoryPromptComposition, STORY_CONTINUE_FALLBACK } from '../src/story-request.ts'
import { assembleCodexGenerationRequest, defaultCodexPromptComposition, CODEX_CONTINUE_FALLBACK } from '../src/codex-request.ts'

const book = { title: 'Tide', series: '', seriesOrder: '', overview: 'A sunken city.', genre: '', style: '', pov: '', tense: '', language: 'English' }
const context = {
  currentSceneId: 'scene-1', currentSceneText: 'BeforeAfter', currentSceneTitle: 'Door',
  previousSceneId: '', previousSceneText: '', previousSceneTitle: '', summaryContext: 'Earlier events',
  lastSceneText: '', lastSceneTitle: '', additionalContext: '', manualAdditionalContext: '',
  codexRepresentations: [], automaticCodex: [], automaticCodexContext: 'Compass lore',
  automaticSources: [{ sourceId: 'compass', title: 'Compass', category: 'Item', content: 'Compass lore' }],
  additionalSources: [{ sourceId: 'note', content: 'Keep the door locked.' }], storySoFarSources: [],
}

const cases = [
  ['Story', () => assembleStoryGenerationRequest({ composition: defaultStoryPromptComposition, book, responseLength: 'One paragraph', sceneText: 'BeforeAfter', insertionPosition: 6, context, instruction: 'Old instruction' }), STORY_CONTINUE_FALLBACK],
  ['Codex', () => assembleCodexGenerationRequest({ composition: defaultCodexPromptComposition, book, responseLength: 'Be concise', entry: { id: 'door', title: 'Door', category: 'Place', content: 'BeforeAfter' }, insertionPosition: 6, context, instruction: 'Old instruction' }), CODEX_CONTINUE_FALLBACK],
]

for (const [scope, assemble, fallback] of cases) {
  test(`${scope} regeneration replaces only the final instruction in the assembled request`, () => {
    const saved = assemble().providerMessages
    const original = structuredClone(saved)
    const next = replaceGenerationInstruction(saved, '  New instruction\nwith details.  ', fallback)
    assert.equal(next.length, saved.length)
    assert.equal(JSON.stringify(next.slice(0, -1)), JSON.stringify(saved.slice(0, -1)))
    assert.deepEqual(next.at(-1), { role: 'user', content: 'New instruction\nwith details.' })
    assert.deepEqual(saved, original)
    next[0].content = 'Changed copy'
    assert.deepEqual(saved, original, 'the saved request must remain independently reusable')
  })

  test(`${scope} repeated regenerations use the latest instruction and an empty box uses the fallback`, () => {
    const saved = assemble().providerMessages
    const first = replaceGenerationInstruction(saved, 'First revision', fallback)
    const second = replaceGenerationInstruction(first, 'Second revision', fallback)
    const cleared = replaceGenerationInstruction(second, ' \n\t ', fallback)
    assert.equal(first.at(-1).content, 'First revision')
    assert.equal(second.at(-1).content, 'Second revision')
    assert.equal(cleared.at(-1).content, fallback)
    assert.deepEqual(cleared.slice(0, -1), saved.slice(0, -1))
  })
}

test('unchanged instructions produce the same provider payload', () => {
  const messages = cases[0][1]().providerMessages
  assert.deepEqual(replaceGenerationInstruction(messages, 'Old instruction', STORY_CONTINUE_FALLBACK), messages)
})

test('invalid saved requests fail rather than replacing context or silently appending an instruction', () => {
  for (const messages of [undefined, [], [{ role: 'system', content: 'Only system' }], [{ role: 'assistant', content: 'Output' }]]) {
    assert.throws(() => replaceGenerationInstruction(messages, 'New instruction', STORY_CONTINUE_FALLBACK), /missing its instruction/)
  }
})

test('Workspace preserves the snapshot, reads current input, and checks the revised request against saved limits', () => {
  const source = readFileSync(new URL('../src/Workspace.tsx', import.meta.url), 'utf8')
  const start = source.indexOf("if (mode === 'regenerate' && previousRequest)")
  const end = source.indexOf('\n    } else {', start)
  const regeneration = source.slice(start, end)
  assert.match(regeneration, /\.\.\.previousRequest/)
  assert.match(regeneration, /replaceGenerationInstruction\(\s*previousRequest\.messages,\s*isCodex \? lorePrompt : arcPrompt/)
  assert.match(regeneration, /isCodex \? CODEX_CONTINUE_FALLBACK : STORY_CONTINUE_FALLBACK/)
  assert.doesNotMatch(regeneration, /buildContextValues|assembleStoryGenerationRequest|assembleCodexGenerationRequest/)
  assert.match(regeneration, /generationContextDiagnostics\(\s*requestSnapshot\.model,\s*requestSnapshot\.modelContextTokens,\s*requestSnapshot\.effectiveContextLimit,\s*textProviderRequestText\(requestSnapshot\)/)
  assert.match(regeneration, /if \(!diagnostics\.fits\)/)
  assert.match(regeneration, /requestSnapshot\.estimatedRequestTokens = diagnostics\.requestTokens/)
  assert.match(regeneration, /editor\.finishGeneration\('error'\)/)
  assert.match(source, /effectiveContextLimit: effectiveLimit/)
  assert.match(source, /latestGenerationRequestRef\.current = requestSnapshot/)
})

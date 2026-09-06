import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  assembleSummaryGenerationRequest,
  defaultSummaryPromptComposition,
  SUMMARY_CREATE_ACTION,
  SUMMARY_REPLACE_ACTION,
  summaryRequestValues,
} from '../src/summary-request.ts'
import { promptVariables } from '../src/prompt-template.ts'

const book = { title: 'Tide', series: 'Lost Coasts', seriesOrder: '2', overview: 'A drowned city.', genre: 'Fantasy', style: 'Lyrical', pov: 'Third person', tense: 'Past', language: 'English' }
const baseInput = {
  composition: defaultSummaryPromptComposition,
  book,
  responseLength: 'Preserve important continuity.',
  summary: { id: 'summary-scene-1', content: '' },
  target: { id: 'scene-1', type: 'scene', title: 'The Door', source: 'AUTHORITATIVE SECRET SOURCE' },
  sourceDiagnostics: [{ sourceId: 'scene-1', title: 'The Door', type: 'scene', representation: 'Full Scene body', content: 'AUTHORITATIVE SECRET SOURCE', reason: 'Authoritative current Scene source' }],
}

test('default Summary request preserves canonical order and app-owned Summarize action', () => {
  const request = assembleSummaryGenerationRequest(baseInput)
  assert.deepEqual(request.providerMessages.map((message) => message.role), ['system', 'system', 'user', 'user', 'user'])
  assert.deepEqual(request.parts.map((part) => part.name), ['System prompt', 'Book', 'Summary input', 'Response length', 'Summarize action'])
  assert.equal(request.providerMessages.at(-1).content, SUMMARY_CREATE_ACTION)
  assert.match(request.providerMessages[2].content, /# Authoritative source\nAUTHORITATIVE SECRET SOURCE/)
})

test('Summary values expose only dedicated target data and scope-local response length', () => {
  const values = summaryRequestValues({ ...baseInput, summary: { ...baseInput.summary, content: 'Previous derived state' } })
  assert.equal(values['target.type'], 'Scene')
  assert.equal(values['target.title'], 'The Door')
  assert.equal(values['target.source'], 'AUTHORITATIVE SECRET SOURCE')
  assert.equal(values['target.previous_summary'], 'Previous derived state')
  assert.equal(values['response.length'], 'Preserve important continuity.')
  assert.equal(values['context.automatic'], undefined)
  assert.equal(values['context.additional'], undefined)
})

test('Re-summarize keeps previous derived state separate and current source authoritative', () => {
  const request = assembleSummaryGenerationRequest({ ...baseInput, summary: { ...baseInput.summary, content: 'OLD SUMMARY' } })
  assert.equal(request.parts.at(-1).name, 'Re-summarize action')
  assert.equal(request.providerMessages.at(-1).content, SUMMARY_REPLACE_ACTION)
  assert.match(request.parts.find((part) => part.name === 'Summary input').content, /# Authoritative source\nAUTHORITATIVE SECRET SOURCE[\s\S]*# Previous derived summary\nOLD SUMMARY/)
  const diagnostics = request.parts.find((part) => part.name === 'Summary input').dynamicVariables
  assert.equal(diagnostics.find((item) => item.variable === 'target.source').sources[0].representation, 'Full Scene body')
  assert.equal(diagnostics.find((item) => item.variable === 'target.previous_summary').sources[0].representation, 'Previous derived summary')
})

test('authored templates control source and response guidance without hidden reinjection', () => {
  const request = assembleSummaryGenerationRequest({
    ...baseInput,
    composition: { systemPrompt: 'Stable system', predefinedMessages: [{ id: 'example', name: 'Example', role: 'assistant', enabled: true, template: 'Example only' }] },
  })
  assert.deepEqual(request.providerMessages.map((message) => message.role), ['system', 'assistant', 'user'])
  const sent = request.providerMessages.map((message) => message.content).join('\n')
  assert.doesNotMatch(sent, /AUTHORITATIVE SECRET SOURCE/)
  assert.doesNotMatch(sent, /Preserve important continuity/)
})

test('empty Summary response length omits only the ordinary authored message', () => {
  const request = assembleSummaryGenerationRequest({ ...baseInput, responseLength: '' })
  assert.equal(request.parts.find((part) => part.name === 'Response length').omitted, true)
  assert.deepEqual(request.providerMessages.map((message) => message.role), ['system', 'system', 'user', 'user'])
})

test('Summary variable catalog excludes cursor and context namespaces', () => {
  const names = promptVariables.filter((variable) => variable.scopes.includes('summarize')).map((variable) => variable.name)
  for (const required of ['target.type', 'target.title', 'target.source', 'target.previous_summary', 'response.length']) assert.ok(names.includes(required))
  for (const excluded of ['scene.before_cursor', 'scene.after_cursor', 'context.automatic', 'context.automatic_codex', 'context.additional']) assert.ok(!names.includes(excluded))
})

test('Summary source hierarchy, settings migration, preview, and provider dispatch use the shared normalized request', () => {
  const service = readFileSync(new URL('../src/summary-service.ts', import.meta.url), 'utf8')
  const settings = readFileSync(new URL('../src/ai-settings.ts', import.meta.url), 'utf8')
  const workspace = readFileSync(new URL('../src/Workspace.tsx', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(service, /Outdated Scene summary rejected; authoritative full Scene body used/)
  assert.match(service, /Current Chapter summary/)
  assert.match(service, /Full Codex body \+ metadata/)
  assert.match(settings, /summarize: clonePromptComposition\(defaultSummaryPromptComposition\)/)
  assert.match(settings, /storedSummaryCompositionWasHistoricalDefault/)
  assert.match(workspace, /assembleSummaryGenerationRequest\(\{[\s\S]*sourceDiagnostics: source\.diagnostics/)
  assert.match(workspace, /textProviderRequestText\(\{ systemPrompt: '', contextMessage: '', userMessage: '', messages \}\)/)
  assert.match(workspace, /task: 'summary',[\s\S]*messages,/)
  assert.doesNotMatch(workspace, /renderSummaryPrompt/)
  assert.match(app, /Summary request preview/)
  assert.match(app, /Authoritative source construction/)
})

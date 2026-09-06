import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { finalizeChatProviderRequest } from '../src/chat-finalized-request.ts'

const request = readFileSync(new URL('../src/chat-request.ts', import.meta.url), 'utf8')
const finalizer = readFileSync(new URL('../src/chat-finalized-request.ts', import.meta.url), 'utf8')
const defaults = readFileSync(new URL('../src/chat-default-composition.ts', import.meta.url), 'utf8')
const feature = readFileSync(new URL('../src/ChatFeature.tsx', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const api = readFileSync(new URL('../src/chat-api.ts', import.meta.url), 'utf8')
const service = readFileSync(new URL('../src/chat-service.ts', import.meta.url), 'utf8')
const persistence = readFileSync(new URL('../src/persistence.ts', import.meta.url), 'utf8')
const promptTemplate = readFileSync(new URL('../src/prompt-template.ts', import.meta.url), 'utf8')

test('default Chat composition is System, Workspace tools, Book, then Book context', () => {
  const workspace = defaults.indexOf("name: 'Workspace tools'")
  const book = defaults.indexOf("name: 'Book'")
  const context = defaults.indexOf("name: 'Book context'")
  assert.ok(workspace > defaults.indexOf('systemPrompt:') && book > workspace && context > book)
  assert.match(defaults, /template: '\{\{chat\.workspace_instructions\}\}'/)
  assert.match(defaults, /context\.automatic[\s\S]*context\.additional/)
})

test('Chat assembly owns predefined configuration, chronological history, current turn, and structured tools', () => {
  assert.match(request, /assembleCompositionRequest\(\{[\s\S]*composition: clonePromptComposition\(input\.composition\)/)
  assert.match(request, /sourceKind: index === latestUserIndex \? 'current-turn' : 'history'/)
  assert.match(request, /ownership: index === latestUserIndex \? 'current-turn' : 'conversation'/)
  assert.match(request, /after: historyParts/)
  assert.match(request, /structuredParts: \[normalizeStructuredTools/)
  assert.match(feature, /const finalizedRequest = finalizeChatProviderRequest\(normalizedRequest\)/)
})

test('Chat variables omit response length and cursor variables while exposing the requested namespace', () => {
  assert.match(request, /delete bookValues\['response\.length'\]/)
  for (const name of ['scene.text', 'scene.previous_text', 'story.so_far', 'context.automatic_codex', 'context.automatic', 'context.additional', 'chat.workspace_instructions']) {
    assert.match(request, new RegExp(`'${name.replaceAll('.', '\\.')}'`))
  }
  assert.doesNotMatch(request, /'scene\.before_cursor'|'scene\.after_cursor'/)
  assert.doesNotMatch(promptTemplate, /RESPONSE_LENGTH_VARIABLE[^\n]*assistant/)
})

test('automatic Chat context order and stable identity deduplication are explicit', () => {
  const story = request.indexOf("section('Story so far'")
  const current = request.indexOf('section(`Current scene')
  const previous = request.indexOf('section(`Previous scene')
  const codex = request.indexOf("section('Automatic Codex'")
  assert.ok(story >= 0 && current > story && previous > current && codex > previous)
  assert.match(request, /dedupeDynamicSources\(automaticSources, input\.context\.additionalSources/)
  assert.match(request, /dynamicSourceDedupe: dedupe\.decisions/)
})

test('tool rounds keep the finalized prefix and append normalized app-managed chronology', () => {
  assert.match(request, /assembleNormalizedRequest\(\[\.\.\.base\.parts, \.\.\.runtimeParts\]/)
  assert.match(feature, /const baseRequest = buildNormalizedRequest/)
  assert.match(feature, /runtimeParts\.push\(normalizeRuntimeMessagePart/)
  assert.match(feature, /role: 'tool', tool_call_id: call\.id/)
  assert.match(feature, /roundDiagnostics[\s\S]*finalizedRequest\.diagnosticText/)
  assert.match(feature, /messages: finalizedRequest\.messages[\s\S]*tools: finalizedRequest\.tools/)
})

test('one finalized Chat request drives diagnostics, preview, and every provider send', () => {
  assert.match(finalizer, /function finalizeChatProviderRequest[\s\S]*const messages = structuredClone\(request\.providerMessages\)[\s\S]*const tools = structuredClone\(request\.providerTools\)[\s\S]*diagnosticText: JSON\.stringify/)
  assert.match(feature, /setLastFinalizedRequest\(finalizedRequest\)/)
  assert.match(feature, /previewFinalizedRequest = previewRequest \? finalizeChatProviderRequest\(previewRequest\)/)
  assert.match(feature, /generationContextDiagnostics\([\s\S]*finalizedRequest\.diagnosticText/)
  assert.doesNotMatch(feature, /chatProviderMessages|chatProviderTools|serializeChatModelInput/)
})

test('finalized payload preserves exact chronology and stays identical at a near-limit boundary', () => {
  const normalized = {
    providerMessages: [
      { role: 'system', content: 'Stable prefix' },
      { role: 'user', content: 'Current turn' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'read_entity', arguments: '{"id":"scene-1"}' } }] },
      { role: 'tool', tool_call_id: 'call-1', content: 'Tool result' },
    ],
    providerTools: [{ type: 'function', function: { name: 'read_entity', description: 'Read one entity', parameters: { type: 'object' } } }],
  }
  const finalized = finalizeChatProviderRequest(normalized)
  const sentBody = JSON.stringify({ messages: finalized.messages, tools: finalized.tools })
  assert.equal(finalized.diagnosticText, sentBody)
  assert.deepEqual(finalized.messages.map((message) => message.role), ['system', 'user', 'assistant', 'tool'])

  const nearLimitCharacters = sentBody.length
  assert.equal(finalized.diagnosticText.length <= nearLimitCharacters, sentBody.length <= nearLimitCharacters)
  normalized.providerMessages[0].content = `${normalized.providerMessages[0].content} hidden transport mutation`
  assert.equal(finalized.diagnosticText, sentBody)
})

test('workspace instruction omission warns without hidden reinjection', () => {
  assert.match(request, /Workspace tools are enabled, but their Arc instructions are not included/)
  assert.match(feature, /if \(instructionsWarning\) onToast\(instructionsWarning\)/)
  assert.doesNotMatch(feature, /CHAT_WORKSPACE_INSTRUCTIONS/)
})

test('new, reset, and forked Chats clone the correct composition', () => {
  assert.match(service, /promptComposition: clonePromptComposition\(settings\.promptCompositions\.assistant\)/)
  assert.match(service, /resetChatPromptComposition[\s\S]*settings\.promptCompositions\.assistant/)
  assert.match(service, /title: `\$\{source\.title\} — fork`,[\s\S]*promptComposition: clonePromptComposition\(source\.promptComposition\)/)
  assert.match(feature, /Reset copies the current Book Chat defaults/)
})

test('Book and individual Chat settings expose the complete composition editor and preview', () => {
  assert.match(app, /<PredefinedMessages\s+[\s\S]*scope=\{promptTab\}/)
  assert.match(feature, /ChatPredefinedMessages/)
  assert.match(feature, /Variables & syntax/)
  assert.match(feature, /Request Preview/)
  assert.match(feature, /estimated input tokens/)
  assert.match(feature, /Last sent provider payload/)
})

test('legacy hidden context, response length, and transport reordering are removed', () => {
  assert.doesNotMatch(feature, /responseLengthMessage|# Selected book context|chat-response-length/)
  assert.doesNotMatch(api, /cacheFriendlyMessages|reorderSelectedBookContext/)
})

test('prototype migration removes legacy Chat and ChatMessage entities together only', () => {
  assert.match(persistence, /db\.version\(3\)/)
  assert.match(persistence, /entity\.type === 'chat' \|\| entity\.type === 'chatMessage'/)
})

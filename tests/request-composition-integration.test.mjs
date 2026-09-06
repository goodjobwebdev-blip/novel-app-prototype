import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const app = read('App.tsx')
const workspace = read('Workspace.tsx')
const chat = read('ChatFeature.tsx')
const chatApi = read('chat-api.ts')
const chatRequest = read('chat-request.ts')
const context = read('context-service.ts')
const scopeRequest = read('scope-request.ts')
const promptTemplate = read('prompt-template.ts')
const textProvider = read('text-provider.ts')

test('Story, Codex, and Summary assemble one normalized request used for send and budgeting', () => {
  assert.match(workspace, /assembleStoryGenerationRequest/)
  assert.match(workspace, /assembleCodexGenerationRequest/)
  assert.match(workspace, /assembleSummaryGenerationRequest/)
  assert.match(workspace, /textProviderRequestText\(\{ normalizedRequest \}\)/)
  assert.match(workspace, /normalizedRequest: requestSnapshot\.normalizedRequest/)
  assert.match(textProvider, /providerMessagesFromNormalized\(request\.normalizedRequest/)
  assert.match(textProvider, /normalizedRequestDiagnosticText\(request\.normalizedRequest\)/)
})

test('Request Preview uses the same scope assemblers and normalized provider messages', () => {
  assert.match(app, /normalizedRequest = assembleStoryGenerationRequest/)
  assert.match(app, /normalizedRequest = assembleCodexGenerationRequest/)
  assert.match(app, /normalizedRequest = assembleChatRequest/)
  assert.match(app, /normalizedRequest\?\.providerMessages\.map/)
  assert.match(app, /normalizedRequestDiagnosticText\(normalizedRequest!\)/)
})

test('Chat send, tool rounds, preview, and diagnostics retain one normalized request', () => {
  assert.match(chat, /let workingRequest = buildProviderRequest/)
  assert.match(chat, /normalizedRequest: workingRequest/)
  assert.match(chat, /appendNormalizedRequestPart\(workingRequest/)
  assert.match(chatRequest, /assembleChatRequest/)
  assert.match(chatRequest, /serializeChatModelInput\(request: NormalizedAssembledRequest\)/)
  assert.match(chatApi, /providerMessagesFromNormalized\(request\.normalizedRequest/)
  assert.doesNotMatch(chatApi, /cacheFriendlyMessages/)
})

test('Automatic and Additional sources stay distinct and dedupe by stable source identity', () => {
  assert.match(context, /manualAdditionalContext:/)
  assert.match(context, /automaticCodexContext:/)
  assert.match(context, /automaticSources:/)
  assert.match(context, /additionalSources:/)
  assert.match(scopeRequest, /dedupeDynamicSources\(automaticSources, context\.additionalSources/)
  assert.match(scopeRequest, /'context\.automatic': automaticSources/)
  assert.match(scopeRequest, /'context\.additional': additionalSources/)
})

test('legacy hidden context and response-length injection paths are removed', () => {
  for (const source of [app, workspace, chat, promptTemplate]) {
    assert.doesNotMatch(source, /responseLengthMessage|generationInstructionMessage|selectedContextIsTemplated/)
  }
  assert.doesNotMatch(workspace, /contextMessage =/)
  assert.doesNotMatch(app, /key: 'chat-response-length'|key: 'story-context'|key: 'codex-context'/)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const aiSettings = readFileSync(new URL('../src/ai-settings.ts', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const workspace = readFileSync(new URL('../src/Workspace.tsx', import.meta.url), 'utf8')
const chatApi = readFileSync(new URL('../src/chat-api.ts', import.meta.url), 'utf8')
const chatService = readFileSync(new URL('../src/chat-service.ts', import.meta.url), 'utf8')
const chatFeature = readFileSync(new URL('../src/ChatFeature.tsx', import.meta.url), 'utf8')
const autotitle = readFileSync(new URL('../src/autotitle-service.ts', import.meta.url), 'utf8')
const textProvider = readFileSync(new URL('../src/text-provider.ts', import.meta.url), 'utf8')

test('Fake is a text-only provider and clears text connection credentials in normalized settings', () => {
  assert.match(aiSettings, /export type AiProvider = [^\n]*'fake'/)
  assert.match(aiSettings, /export type SpeechProvider = 'nanogpt'/)
  assert.match(aiSettings, /apiKey: value\?\.provider === 'fake' \? ''/)
  assert.match(aiSettings, /baseUrl: value\?\.provider === 'fake' \? ''/)
  assert.match(aiSettings, /settings\.provider === 'fake'.*settings\.mainModel\.trim\(\) === 'fake\/test'/s)
})

test('AI settings expose one local Fake model without API key or endpoint fields and keep a persistent warning', () => {
  assert.match(app, /fake: 'Fake \(testing\)'/)
  assert.match(app, /settings\.provider === 'fake' \? \{ models: \[FAKE_PROVIDER_MODEL\] \}/)
  assert.match(app, /if \(requestSettings\.provider === 'fake'\) \{[\s\S]*setModels\(\[FAKE_PROVIDER_MODEL\]\)[\s\S]*No network request was made/)
  assert.match(app, /settings\.provider !== 'fake' && <label><span>API key/)
  assert.doesNotMatch(app, /settings\.provider === 'fake'.*Endpoint URL/)
  assert.match(app, /Testing provider — responses, errors, reasoning, and tool calls are generated locally and deterministically\. No text-AI network request is sent\./)
  assert.match(app, /Session only · last 20 Fake requests/)
  assert.match(app, /onClick=\{clearFakeProviderTrace\}/)
})

test('Story, Codex, and Summary use the shared text provider boundary and diagnostics serialize that same message representation', () => {
  assert.match(workspace, /fetchTextProviderModelContextLength/)
  assert.match(workspace, /const requestText = textProviderRequestText\(\{ normalizedRequest \}\)/)
  assert.match(workspace, /streamTextProviderCompletion\(\{[\s\S]*task: isCodex \? 'codex' : 'story'/)
  assert.match(workspace, /streamTextProviderCompletion\(\{[\s\S]*task: 'summary'/)
  assert.match(textProvider, /return normalizedRequestDiagnosticText\(request\.normalizedRequest\)/)
  assert.match(textProvider, /providerMessagesFromNormalized\(request\.normalizedRequest/)
})

test('Autotitle accepts Fake and routes through the same local text provider boundary', () => {
  assert.match(autotitle, /settings\.provider !== 'nanogpt' && settings\.provider !== 'fake'/)
  assert.match(autotitle, /fetchTextProviderModelContextLength/)
  assert.match(autotitle, /streamTextProviderCompletion\(\{[\s\S]*task: 'autotitle'/)
})

test('Chat loads Fake locally, skips key validation, and dispatches Fake before any fetch', () => {
  assert.match(chatService, /if \(settings\.provider === 'fake'\) return \[\{ \.\.\.FAKE_PROVIDER_MODEL \}\]/)
  assert.match(chatFeature, /settings\.provider !== 'fake' && !settings\.apiKey\.trim\(\)/)
  const fakeBranch = chatApi.indexOf("if (request.provider === 'fake')")
  const networkFetch = chatApi.indexOf('const response = await fetch(')
  assert.ok(fakeBranch >= 0 && networkFetch > fakeBranch)
  assert.match(chatApi, /const providerMessages = providerMessagesFromNormalized\(request\.normalizedRequest[\s\S]*const providerTools = request\.normalizedRequest\.providerTools[\s\S]*streamFakeProvider\(\{[\s\S]*messages: providerMessages,[\s\S]*tools: providerTools,[\s\S]*thinking: request\.thinking/)
})

test('unsupported real providers remain unsupported for Story/Codex/Summary while Chat keeps existing provider behavior', () => {
  assert.match(textProvider, /if \(request\.provider !== 'nanogpt'\) \{\n    throw new Error\('Text generation currently supports NanoGPT or Fake \(testing\) only\.'\)/)
  assert.match(workspace, /settings\.provider !== 'nanogpt' && settings\.provider !== 'fake'/)
})

import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const compiled = await build({
  stdin: { contents: `export * as ai from './src/shared/ai/ai-settings.ts'; export * as profiles from './src/features/settings/provider-profiles.ts'; export { providerModelEndpoint } from './src/shared/ai/model-catalog.ts'; export { streamChatCompletion } from './src/features/chat/chat-api.ts';`, resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', write: false,
})
const bundled = { exports: {} }
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports)
const { ai, profiles, providerModelEndpoint } = bundled.exports
const direct = 'https://api.nano-gpt.com/api/v1'
const legacy = 'https://nano-gpt.com/api/v1'

test('NanoGPT defaults and model discovery use the direct API host', () => {
  assert.equal(ai.initialAiSettings.baseUrl, direct)
  assert.equal(profiles.switchProviderProfile({ ...ai.initialAiSettings, provider: 'openai' }, 'nanogpt').baseUrl, direct)
  assert.equal(providerModelEndpoint({ provider: 'nanogpt', baseUrl: '' }), `${direct}/models?detailed=true&sort=favorites`)
})

test('existing NanoGPT connections migrate without losing credentials or models', () => {
  for (const baseUrl of [legacy, `${legacy}/`, ` ${legacy} `]) {
    const stored = { provider: 'nanogpt', baseUrl, apiKey: 'test-key', mainModel: 'writer', providerProfiles: { nanogpt: { baseUrl, apiKey: 'saved-key', mainModel: 'saved-writer' } } }
    const before = JSON.stringify(stored)
    const normalized = ai.normalizeAiSettings(stored)
    assert.equal(normalized.baseUrl, direct)
    assert.equal(normalized.apiKey, 'test-key')
    assert.equal(normalized.mainModel, 'writer')
    assert.equal(normalized.providerProfiles.nanogpt.baseUrl, direct)
    assert.equal(normalized.providerProfiles.nanogpt.apiKey, 'saved-key')
    assert.equal(normalized.providerProfiles.nanogpt.mainModel, 'saved-writer')
    assert.equal(JSON.stringify(stored), before)
    assert.deepEqual(ai.normalizeAiSettings(normalized), normalized)
  }
})

test('inactive NanoGPT profiles migrate and restore the direct host', () => {
  const stored = { ...ai.initialAiSettings, provider: 'openai', baseUrl: 'https://api.openai.com/v1', providerProfiles: { nanogpt: { baseUrl: legacy, apiKey: 'saved-key', mainModel: 'writer' } } }
  const normalized = ai.normalizeAiSettings(stored)
  assert.equal(normalized.baseUrl, stored.baseUrl)
  assert.equal(profiles.switchProviderProfile(normalized, 'nanogpt').baseUrl, direct)
  assert.equal(profiles.switchProviderProfile(stored, 'nanogpt').baseUrl, direct)
})

test('chat tool requests migrate the old host before fetch', async t => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  for (const [provider, baseUrl, expected] of [
    ['nanogpt', legacy, direct], ['nanogpt', '', direct],
    ['nanogpt', 'https://private.example/v1', 'https://private.example/v1'],
    ['compatible', legacy, legacy],
  ]) {
    let requestedUrl
    globalThis.fetch = async url => {
      requestedUrl = url
      return new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: 'scene', type: 'function', function: { name: 'propose_outline_create', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }), { headers: { 'content-type': 'application/json' } })
    }
    const result = await bundled.exports.streamChatCompletion({ provider, baseUrl, apiKey: 'test-key', model: 'writer', thinking: false, messages: [{ role: 'user', content: 'Create a scene' }] }, () => {}, new AbortController().signal)
    assert.equal(requestedUrl, `${expected}/chat/completions`)
    assert.equal(result.toolCalls[0].function.name, 'propose_outline_create')
  }
})

test('custom endpoints and other providers are not migrated', () => {
  for (const baseUrl of ['https://private.example/v1', `${legacy}/custom`, 'https://nano-gpt.com.example/api/v1']) {
    assert.equal(ai.normalizeAiSettings({ provider: 'nanogpt', baseUrl }).baseUrl, baseUrl)
  }
  assert.equal(ai.normalizeAiSettings({ provider: 'compatible', baseUrl: legacy }).baseUrl, legacy)
  assert.equal(providerModelEndpoint({ provider: 'nanogpt', baseUrl: 'https://private.example/v1' }), 'https://private.example/v1/models?detailed=true&sort=favorites')
})

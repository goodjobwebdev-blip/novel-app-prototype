import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_LITELLM_BASE_URL, switchProviderProfile } from '../src/features/settings/provider-profiles.ts'
const initialAiSettings = { provider: 'nanogpt', baseUrl: 'https://nano-gpt.com/api/v1', codexModel: '', codexEffectiveContextLimit: '' }
test('provider profiles isolate credentials and restore model choices after a persistence round trip', () => {
  const original = { ...initialAiSettings, apiKey: 'nano-test-key', mainModel: 'writer', supportModel: 'helper', chatModel: 'assistant', chatModelContextLength: 64000, mainModelContextLength: 32000, mainEffectiveContextLimit: '16k' }
  const openai = switchProviderProfile(original, 'openai')
  assert.equal(openai.apiKey, '')
  assert.equal(openai.mainModel, '')
  assert.equal(openai.chatModel, '')
  assert.equal(openai.chatModelContextLength, undefined)
  assert.equal(openai.mainModelContextLength, undefined)
  const configured = { ...openai, apiKey: 'openai-test-key', mainModel: 'second-writer' }
  const restored = switchProviderProfile(JSON.parse(JSON.stringify(configured)), 'nanogpt')
  assert.equal(restored.apiKey, original.apiKey)
  assert.equal(restored.mainModel, 'writer')
  assert.equal(restored.supportModel, 'helper')
  assert.equal(restored.chatModel, 'assistant')
  assert.equal(restored.chatModelContextLength, 64000)
  assert.equal(restored.mainModelContextLength, 32000)
  assert.equal(restored.mainEffectiveContextLimit, '16k')
  assert.equal(switchProviderProfile(restored, 'openai').apiKey, 'openai-test-key')
  assert.equal(switchProviderProfile(restored, 'fake').apiKey, '')
  assert.equal(original.providerProfiles, undefined)
})

test('LiteLLM starts with the hosted default and preserves its URL, key, and models independently', () => {
  const original = { ...initialAiSettings, apiKey: 'nano-key', mainModel: 'nano-writer', supportModel: 'nano-helper', chatModel: 'nano-chat' }
  const litellm = switchProviderProfile(original, 'litellm')
  assert.equal(litellm.baseUrl, DEFAULT_LITELLM_BASE_URL)
  assert.equal(litellm.apiKey, '')
  const configured = { ...litellm, baseUrl: 'https://gateway.example/v1', apiKey: 'virtual-key', mainModel: 'llm-writer', supportModel: 'llm-helper', chatModel: 'llm-chat' }
  const nano = switchProviderProfile(configured, 'nanogpt')
  assert.equal(nano.apiKey, 'nano-key')
  assert.equal(nano.mainModel, 'nano-writer')
  const restored = switchProviderProfile(JSON.parse(JSON.stringify(nano)), 'litellm')
  assert.equal(restored.baseUrl, 'https://gateway.example/v1')
  assert.equal(restored.apiKey, 'virtual-key')
  assert.equal(restored.mainModel, 'llm-writer')
  assert.equal(restored.supportModel, 'llm-helper')
  assert.equal(restored.chatModel, 'llm-chat')
})

test('legacy provider profiles clear the outgoing Chat choice', () => {
  const switched = switchProviderProfile({
    ...initialAiSettings, chatModel: 'assistant', chatModelContextLength: 64000,
    providerProfiles: { openai: { apiKey: 'test', mainModel: 'legacy-writer' } },
  }, 'openai')
  assert.equal(switched.chatModel, '')
  assert.equal(switched.chatModelContextLength, undefined)
})

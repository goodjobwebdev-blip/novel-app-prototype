import test from 'node:test'
import assert from 'node:assert/strict'
import { switchProviderProfile } from '../src/provider-profiles.ts'
const initialAiSettings = { provider: 'nanogpt', baseUrl: 'https://nano-gpt.com/api/v1', codexModel: '', codexEffectiveContextLimit: '' }
test('provider profiles isolate credentials and restore model choices after a persistence round trip', () => {
  const original = { ...initialAiSettings, apiKey: 'nano-test-key', mainModel: 'writer', supportModel: 'helper', mainModelContextLength: 32000, mainEffectiveContextLimit: '16k' }
  const openai = switchProviderProfile(original, 'openai')
  assert.equal(openai.apiKey, '')
  assert.equal(openai.mainModel, '')
  assert.equal(openai.mainModelContextLength, undefined)
  const configured = { ...openai, apiKey: 'openai-test-key', mainModel: 'second-writer' }
  const restored = switchProviderProfile(JSON.parse(JSON.stringify(configured)), 'nanogpt')
  assert.equal(restored.apiKey, original.apiKey)
  assert.equal(restored.mainModel, 'writer')
  assert.equal(restored.supportModel, 'helper')
  assert.equal(restored.mainModelContextLength, 32000)
  assert.equal(restored.mainEffectiveContextLimit, '16k')
  assert.equal(switchProviderProfile(restored, 'openai').apiKey, 'openai-test-key')
  assert.equal(switchProviderProfile(restored, 'fake').apiKey, '')
  assert.equal(original.providerProfiles, undefined)
})

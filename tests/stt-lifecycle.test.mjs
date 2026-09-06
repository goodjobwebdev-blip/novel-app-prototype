import test from 'node:test'
import assert from 'node:assert/strict'
import { cancelSttSession, dismissSttState, getSttState, startSttSession } from '../src/stt-service.ts'

const speech = {
  provider: 'nanogpt',
  apiKey: '',
  model: 'Kokoro-82m',
  voice: 'af_bella',
  readAloudAfterGeneration: false,
  maxParallelRequests: '1',
  openaiApiKey: 'openai-test-key',
  transcriptionModel: 'openai:whisper-1',
  transcriptionLanguage: 'auto',
  streamTranscription: false,
}

test('Cancel works while microphone permission is pending and late permission cannot revive the session', async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const originalFetch = globalThis.fetch
  let resolvePermission
  let permissionRequested = false
  let stoppedTracks = 0
  let cancelled = 0
  let finalized = 0
  const permission = new Promise((resolve) => { resolvePermission = resolve })

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: () => { permissionRequested = true; return permission } } },
  })
  globalThis.fetch = async (url) => {
    const text = String(url)
    if (text.includes('api.openai.com/v1/models')) return new Response(JSON.stringify({ data: [{ id: 'whisper-1' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    if (text.includes('nano-gpt.com/api/v1/audio-models')) return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    throw new Error(`Unexpected fetch ${text}`)
  }

  try {
    const pending = startSttSession(speech, {
      kind: 'chat',
      label: 'Dictate message',
      isValid: () => true,
      onFinal: () => { finalized += 1 },
      onCancel: () => { cancelled += 1 },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(permissionRequested, true)
    assert.equal(getSttState().status, 'requesting-permission')

    cancelSttSession()
    assert.equal(getSttState().status, 'cancelled')
    assert.equal(cancelled, 1)

    resolvePermission({ getTracks: () => [{ stop: () => { stoppedTracks += 1 } }] })
    await pending
    assert.equal(stoppedTracks, 1)
    assert.equal(finalized, 0)
    assert.equal(getSttState().status, 'cancelled')
  } finally {
    dismissSttState()
    globalThis.fetch = originalFetch
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
    else delete globalThis.navigator
  }
})

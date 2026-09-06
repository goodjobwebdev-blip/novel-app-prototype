import assert from 'node:assert/strict'
import test from 'node:test'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

async function waitFor(check) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (check()) return
    await tick()
  }
  throw new Error('Timed out waiting for mocked audio playback')
}

test('completed TTS can seek and replay without another paid request', async () => {
  globalThis.window = {
    dispatchEvent() {},
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
    clearTimeout,
  }
  if (typeof globalThis.CustomEvent === 'undefined') {
    globalThis.CustomEvent = class CustomEvent {
      constructor(type, init = {}) { this.type = type; this.detail = init.detail }
    }
  }

  const audioInstances = []
  globalThis.Audio = class Audio {
    constructor(src) {
      this.src = src
      this.currentTime = 0
      this.duration = 42
      audioInstances.push(this)
    }
    pause() {}
    play() {
      queueMicrotask(() => this.onloadedmetadata?.())
      return Promise.resolve()
    }
    finish() {
      this.currentTime = this.duration
      this.ontimeupdate?.()
      this.onended?.()
    }
  }

  const originalCreateObjectUrl = URL.createObjectURL
  const originalRevokeObjectUrl = URL.revokeObjectURL
  const revoked = []
  URL.createObjectURL = () => 'blob:retained-tts'
  URL.revokeObjectURL = (url) => revoked.push(url)

  let paidRequests = 0
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.includes('/audio-models')) {
      return new Response(JSON.stringify({ data: [{ id: 'Kokoro-82m', name: 'Kokoro', voices: ['af_bella'], max_chars: 5000 }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.endsWith('/api/tts')) {
      paidRequests += 1
      return new Response(new Blob(['audio']), { status: 200, headers: { 'content-type': 'audio/mpeg' } })
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  try {
    const tts = await import(`../src/tts-service.ts?playback-controls=${Date.now()}`)
    const settings = { provider: 'nanogpt', apiKey: 'test-key', model: 'Kokoro-82m', voice: 'af_bella', maxParallelRequests: '1' }
    const firstPlay = tts.startTtsSession(settings, 'A reusable generated passage.', 'Replay test')
    await waitFor(() => audioInstances.length === 1)

    audioInstances[0].currentTime = 12
    audioInstances[0].ontimeupdate?.()
    assert.equal(tts.getTtsState().currentTime, 12)
    assert.equal(tts.getTtsState().duration, 42)
    tts.seekTtsBy(10)
    assert.equal(audioInstances[0].currentTime, 22)
    tts.seekTtsTo(5)
    assert.equal(audioInstances[0].currentTime, 5)

    audioInstances[0].finish()
    await firstPlay
    assert.equal(tts.getTtsState().status, 'complete')
    assert.equal(tts.getTtsState().canReplay, true)
    assert.equal(paidRequests, 1)
    assert.deepEqual(revoked, [], 'retained audio remains available while the player is open')

    const replay = tts.replayTtsSession()
    await waitFor(() => audioInstances.length === 2)
    assert.equal(audioInstances[1].src, 'blob:retained-tts')
    assert.equal(paidRequests, 1, 'Replay reuses generated audio instead of calling TTS again')
    audioInstances[1].finish()
    await replay

    tts.dismissTtsState()
    assert.equal(tts.getTtsState().status, 'idle')
    assert.deepEqual(revoked, ['blob:retained-tts'])
  } finally {
    URL.createObjectURL = originalCreateObjectUrl
    URL.revokeObjectURL = originalRevokeObjectUrl
  }
})

import assert from 'node:assert/strict'
import test from 'node:test'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function browserGlobals() {
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
}

test('Stop during model lookup keeps TTS stopped and sends no chunk request', async () => {
  browserGlobals()
  let chunkRequests = 0
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    if (url.includes('/audio-models')) {
      return new Promise((resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
    }
    chunkRequests += 1
    throw new Error('TTS chunk request should not run after Stop')
  }

  const tts = await import(`../src/tts-service.ts?stop-preparing=${Date.now()}`)
  const settings = {
    provider: 'nanogpt',
    apiKey: 'test-key',
    model: 'Kokoro-82m',
    voice: 'af_bella',
    maxParallelRequests: '1',
  }

  const start = tts.startTtsSession(settings, 'Hello world.', 'Test read')
  await sleep(0)
  assert.equal(tts.getTtsState().status, 'preparing')

  tts.stopTtsSession()
  await Promise.race([
    start,
    sleep(250).then(() => { throw new Error('Cancelled startTtsSession did not settle promptly') }),
  ])

  assert.equal(tts.getTtsState().status, 'stopped')
  assert.equal(chunkRequests, 0)
})

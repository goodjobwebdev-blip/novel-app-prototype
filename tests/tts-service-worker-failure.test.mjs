import assert from 'node:assert/strict'
import test from 'node:test'

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
  globalThis.Audio = class Audio {
    pause() {}
    play() { return Promise.resolve() }
    set src(_) {}
  }
}

test('fatal parallel TTS chunk failure aborts siblings and starts no later chunks', async () => {
  browserGlobals()
  let chunkRequests = 0
  let siblingObservedAbort = false

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    if (url.includes('/audio-models')) {
      return new Response(JSON.stringify({ data: [{ id: 'Kokoro-82m', name: 'Kokoro', voices: ['af_bella'], max_chars: 500 }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.endsWith('/api/tts')) {
      const requestNumber = ++chunkRequests
      if (requestNumber === 1) {
        return new Response(JSON.stringify({ error: 'deterministic chunk failure' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (requestNumber === 2) {
        return new Promise((resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            siblingObservedAbort = true
            reject(new DOMException('Aborted', 'AbortError'))
          }, { once: true })
        })
      }
      throw new Error(`Unexpected paid chunk request ${requestNumber}`)
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  const tts = await import(`../src/tts-service.ts?worker-failure=${Date.now()}`)
  const settings = {
    provider: 'nanogpt',
    apiKey: 'test-key',
    model: 'Kokoro-82m',
    voice: 'af_bella',
    maxParallelRequests: '2',
  }
  const paragraph = 'Lore '.repeat(80).trim()
  const text = [paragraph, paragraph, paragraph, paragraph].join('\n\n')

  await assert.rejects(tts.startTtsSession(settings, text, 'Parallel failure'), /deterministic chunk failure/)
  assert.equal(tts.getTtsState().status, 'failed')
  assert.equal(siblingObservedAbort, true)
  assert.equal(chunkRequests, 2, 'no worker should claim a later chunk after fatal failure')
})

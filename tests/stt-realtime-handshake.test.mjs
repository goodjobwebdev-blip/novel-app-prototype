import test from 'node:test'
import assert from 'node:assert/strict'
import { startSttSession, stopSttSession, cancelSttSession, dismissSttState, getSttState } from '../src/stt-service.ts'

const settings = { apiKey: '', openaiApiKey: 'test-user-key', transcriptionModel: 'openai:gpt-live-transcribe', transcriptionLanguage: 'en', streamTranscription: true }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function harness(t, route) {
  const originals = Object.fromEntries(['navigator', 'window', 'RTCPeerConnection', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const calls = []
  let peer
  let stopped = 0
  class Peer {
    channel = { readyState: 'open', sent: [], send(value) { this.sent.push(JSON.parse(value)) }, close() {} }
    closed = false
    addTrack() {}
    createDataChannel() { return this.channel }
    async createOffer() { return { type: 'offer', sdp: 'v=0\r\na=offer\r\n' } }
    async setLocalDescription() {}
    async setRemoteDescription(value) { this.answer = value }
    close() { this.closed = true }
    constructor() { peer = this }
  }
  const win = new EventTarget()
  win.setTimeout = setTimeout
  win.clearTimeout = clearTimeout
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() { stopped++ } }] }) } } })
  Object.defineProperty(globalThis, 'RTCPeerConnection', { configurable: true, value: Peer })
  globalThis.fetch = async (url, init) => {
    if (url.endsWith('/models')) return json({ data: [{ id: settings.transcriptionModel.slice(7) }] })
    if (url.includes('/audio-models')) return json({ data: [] })
    calls.push({ url, ...init })
    return route(url, init)
  }
  t.after(() => {
    cancelSttSession()
    dismissSttState()
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  return { calls, get peer() { return peer }, get stopped() { return stopped } }
}

const target = { kind: 'instruction', label: 'Dictate instruction', isValid: () => true, onFinal() {} }

test('live transcription configures the selected model with JSON then negotiates raw SDP using an ephemeral token', async t => {
  const h = harness(t, async url => url.endsWith('/client_secrets') ? json({ value: 'test-ephemeral' }) : new Response('v=0\r\na=answer\r\n'))
  const provisional = []
  const final = []
  await startSttSession(settings, { ...target, onProvisional: text => provisional.push(text), onFinal: text => final.push(text) })
  assert.equal(h.calls.length, 2)
  const [token, call] = h.calls
  assert.equal(token.url, 'https://api.openai.com/v1/realtime/client_secrets')
  assert.equal(token.headers['Content-Type'], 'application/json')
  assert.equal(token.headers.Authorization, 'Bearer test-user-key')
  assert.deepEqual(JSON.parse(token.body).session, {
    type: 'transcription', audio: { input: { turn_detection: null, transcription: { model: 'gpt-live-transcribe', languages: ['en'] } } },
  })
  assert.equal(call.url, 'https://api.openai.com/v1/realtime/calls')
  assert.equal(call.headers['Content-Type'], 'application/sdp')
  assert.equal(call.headers.Authorization, 'Bearer test-ephemeral')
  assert.equal(call.body, 'v=0\r\na=offer\r\n')
  assert.deepEqual(h.peer.answer, { type: 'answer', sdp: 'v=0\r\na=answer\r\n' })
  assert.equal(getSttState().status, 'recording-live')
  const event = payload => h.peer.channel.onmessage({ data: JSON.stringify(payload) })
  event({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'one', delta: 'Hello' })
  event({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'one', delta: ' world' })
  assert.equal(provisional.at(-1), 'Hello world', 'delta whitespace must survive concatenation')
  stopSttSession()
  stopSttSession()
  assert.deepEqual(h.peer.channel.sent, [{ type: 'input_audio_buffer.commit' }])
  await new Promise(resolve => setTimeout(resolve, 400))
  assert.deepEqual(final, [], 'partial text must not finalize before commit and completion')
  event({ type: 'input_audio_buffer.committed', item_id: 'one' })
  event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'one', transcript: 'Hello world.' })
  await new Promise(resolve => setTimeout(resolve, 400))
  assert.deepEqual(final, ['Hello world.'])
  assert.equal(getSttState().status, 'completed')
  assert.equal(h.peer.closed, true)
})

test('a rejected session token cleans up the microphone and never attempts the SDP call', async t => {
  const h = harness(t, async () => json({ error: { message: 'Invalid test key' } }, 401))
  await assert.rejects(startSttSession(settings, target), /Invalid test key/)
  assert.equal(getSttState().status, 'failed')
  assert.equal(h.calls.length, 1)
  assert.ok(h.stopped > 0)
  assert.equal(h.peer.closed, true)
})

test('cancellation during token creation prevents a late response from opening a call', async t => {
  let resolveToken
  const h = harness(t, () => new Promise(resolve => { resolveToken = resolve }))
  const pending = startSttSession(settings, target)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(h.calls.length, 1)
  cancelSttSession()
  resolveToken(json({ value: 'late-token' }))
  await pending
  assert.equal(h.calls.length, 1)
  assert.equal(getSttState().status, 'cancelled')
  assert.equal(h.peer.answer, undefined)
})

test('older transcription models retain the singular language field', async t => {
  const previous = settings.transcriptionModel
  settings.transcriptionModel = 'openai:gpt-4o-mini-transcribe'
  t.after(() => { settings.transcriptionModel = previous })
  const h = harness(t, async url => url.endsWith('/client_secrets') ? json({ value: 'ephemeral' }) : new Response('answer'))
  await startSttSession(settings, target)
  assert.deepEqual(JSON.parse(h.calls[0].body).session.audio.input.turn_detection, { type: 'server_vad' })
  stopSttSession()
  assert.deepEqual(h.peer.channel.sent, [])
  assert.deepEqual(JSON.parse(h.calls[0].body).session.audio.input.transcription, { model: 'gpt-4o-mini-transcribe', language: 'en' })
})

test('realtime-whisper also disables turn detection and commits on Stop', async t => {
  const previous = settings.transcriptionModel
  settings.transcriptionModel = 'openai:gpt-realtime-whisper'
  t.after(() => { settings.transcriptionModel = previous })
  const h = harness(t, async url => url.endsWith('/client_secrets') ? json({ value: 'ephemeral' }) : new Response('answer'))
  await startSttSession(settings, target)
  assert.equal(JSON.parse(h.calls[0].body).session.audio.input.turn_detection, null)
  stopSttSession()
  assert.deepEqual(h.peer.channel.sent, [{ type: 'input_audio_buffer.commit' }])
})

test('Stop handles a disconnected data channel without losing cleanup', async t => {
  const h = harness(t, async url => url.endsWith('/client_secrets') ? json({ value: 'ephemeral' }) : new Response('answer'))
  await startSttSession(settings, target)
  h.peer.channel.readyState = 'closed'
  stopSttSession()
  assert.equal(getSttState().status, 'failed')
  assert.match(getSttState().error, /not ready/)
  assert.ok(h.stopped > 0)
  assert.equal(h.peer.closed, true)
})

from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'{label} not found in {path}')
    p.write_text(text.replace(old, new, 1))

p = Path('src/stt-service.ts')
text = p.read_text()

text = text.replace("""  model: SttModel\n  stream: MediaStream\n  recorder?: MediaRecorder\n""", """  model: SttModel\n  stream?: MediaStream\n  recorder?: MediaRecorder\n""", 1)
text = text.replace("""  liveStopRequested?: boolean\n  liveFinalizeTimer?: number\n}\n""", """  liveStopRequested?: boolean\n  liveSettleTimer?: number\n  liveDeadlineTimer?: number\n}\n""", 1)
text = text.replace("""function openAiLiveModel(modelId: string) {\n  return /(?:^|[-_/])(live-transcribe|realtime-whisper)(?:$|[-_/])/i.test(modelId)\n}\n""", """export function openAiSupportsLiveTranscription(modelId: string) {\n  const normalized = modelId.toLowerCase()\n  if (normalized.startsWith('gpt-live-transcribe')) return true\n  if (normalized.startsWith('gpt-realtime-whisper')) return true\n  if (normalized.startsWith('gpt-4o-mini-transcribe')) return true\n  if (normalized.startsWith('gpt-4o-transcribe') && !normalized.startsWith('gpt-4o-transcribe-diarize')) return true\n  return false\n}\n""", 1)
text = text.replace("supportsLive: openAiLiveModel(modelId),", "supportsLive: openAiSupportsLiveTranscription(modelId),", 1)
text = text.replace("""  const live = bool(capabilities.live_transcription) || bool(capabilities.realtime_transcription) || bool(capabilities.streaming_stt) || bool(value.supports_live)\n  return {\n""", """  // NanoGPT currently documents synchronous file/URL transcription only. Keep live=false\n  // even if upstream metadata exposes a provider-specific streaming hint; Arc has no NanoGPT\n  // live transport in v1 and must not advertise a mode it cannot actually run.\n  return {\n""", 1)
text = text.replace("    supportsLive: live,", "    supportsLive: false,", 1)

old_cleanup = """function cleanupSession(session: ActiveSession) {\n  if (session.liveFinalizeTimer !== undefined) window.clearTimeout(session.liveFinalizeTimer)\n  session.recorder?.stream?.getTracks().forEach((track) => track.stop())\n  session.stream.getTracks().forEach((track) => track.stop())\n  try { session.channel?.close() } catch { /* noop */ }\n  try { session.peer?.close() } catch { /* noop */ }\n  if (active?.id === session.id) active = null\n}\n"""
new_cleanup = """function cleanupSession(session: ActiveSession) {\n  if (session.liveSettleTimer !== undefined && typeof window !== 'undefined') window.clearTimeout(session.liveSettleTimer)\n  if (session.liveDeadlineTimer !== undefined && typeof window !== 'undefined') window.clearTimeout(session.liveDeadlineTimer)\n  session.recorder?.stream?.getTracks().forEach((track) => track.stop())\n  session.stream?.getTracks().forEach((track) => track.stop())\n  try { session.channel?.close() } catch { /* noop */ }\n  try { session.peer?.close() } catch { /* noop */ }\n  if (active?.id === session.id) active = null\n}\n\nfunction sessionIsCurrent(session: ActiveSession) {\n  return session.id === currentSession && active?.id === session.id && !session.controller.signal.aborted\n}\n"""
if old_cleanup not in text: raise SystemExit('cleanup block not found')
text = text.replace(old_cleanup, new_cleanup, 1)

text = text.replace("""async function startRecordedSession(session: ActiveSession) {\n  const mimeType = chooseRecorderMime()\n""", """async function startRecordedSession(session: ActiveSession) {\n  if (!session.stream) throw new Error('The microphone stream is no longer available.')\n  if (typeof MediaRecorder === 'undefined') throw new Error('This browser does not support recorded transcription.')\n  const mimeType = chooseRecorderMime()\n""", 1)

old_live = """function liveCombinedText(session: ActiveSession) {\n  return [...(session.liveItems?.values() ?? [])].map((item) => item.text).filter(Boolean).join(' ').replace(/\\s+/g, ' ').trim()\n}\n\nfunction scheduleLiveFinish(session: ActiveSession) {\n  if (!session.liveStopRequested || session.id !== currentSession) return\n  if (session.liveFinalizeTimer !== undefined) window.clearTimeout(session.liveFinalizeTimer)\n  session.liveFinalizeTimer = window.setTimeout(() => {\n    const text = liveCombinedText(session)\n    if (!text) { failSession(session, new Error('The realtime transcription returned no text.')); return }\n    void finalize(session, text).catch((error) => failSession(session, error))\n  }, 900)\n}\n"""
new_live = """function liveCombinedText(session: ActiveSession) {\n  return [...(session.liveItems?.values() ?? [])].map((item) => item.text).filter(Boolean).join(' ').replace(/\\s+/g, ' ').trim()\n}\n\nfunction allLiveItemsCompleted(session: ActiveSession) {\n  const items = [...(session.liveItems?.values() ?? [])]\n  return items.length > 0 && items.every((item) => item.completed)\n}\n\nfunction clearLiveSettleTimer(session: ActiveSession) {\n  if (session.liveSettleTimer === undefined || typeof window === 'undefined') return\n  window.clearTimeout(session.liveSettleTimer)\n  session.liveSettleTimer = undefined\n}\n\nfunction scheduleLiveSettle(session: ActiveSession) {\n  if (!session.liveStopRequested || !sessionIsCurrent(session) || !allLiveItemsCompleted(session) || typeof window === 'undefined') return\n  clearLiveSettleTimer(session)\n  session.liveSettleTimer = window.setTimeout(() => {\n    if (!sessionIsCurrent(session) || !session.liveStopRequested || !allLiveItemsCompleted(session)) return\n    const transcript = liveCombinedText(session)\n    if (!transcript) { failSession(session, new Error('The realtime transcription returned no text.')); return }\n    void finalize(session, transcript).catch((error) => failSession(session, error))\n  }, 350)\n}\n\nfunction armLiveDeadline(session: ActiveSession) {\n  if (!sessionIsCurrent(session) || typeof window === 'undefined' || session.liveDeadlineTimer !== undefined) return\n  session.liveDeadlineTimer = window.setTimeout(() => {\n    if (!sessionIsCurrent(session) || !session.liveStopRequested) return\n    const transcript = liveCombinedText(session)\n    if (!transcript) { failSession(session, new Error('Timed out waiting for the final realtime transcript.')); return }\n    void finalize(session, transcript).catch((error) => failSession(session, error))\n  }, 10_000)\n}\n"""
if old_live not in text: raise SystemExit('live finish block not found')
text = text.replace(old_live, new_live, 1)

old_events = """  const itemId = stringValue(event.item_id) || stringValue(event.itemId) || 'current'\n  if (!session.liveItems) session.liveItems = new Map()\n  const current = session.liveItems.get(itemId) ?? { text: '', completed: false }\n  if (type === 'conversation.item.input_audio_transcription.delta') {\n    const delta = stringValue(event.delta) ?? ''\n    current.text += delta\n    session.liveItems.set(itemId, current)\n    if (session.target.isValid()) session.target.onProvisional?.(liveCombinedText(session))\n    return\n  }\n  if (type === 'conversation.item.input_audio_transcription.completed') {\n    current.text = stringValue(event.transcript) || current.text\n    current.completed = true\n    session.liveItems.set(itemId, current)\n    if (session.target.isValid()) session.target.onProvisional?.(liveCombinedText(session))\n    scheduleLiveFinish(session)\n  }\n"""
new_events = """  if (!session.target.isValid()) {\n    failSession(session, new Error('The original dictation target is no longer available.'))\n    return\n  }\n  const itemId = stringValue(event.item_id) || stringValue(event.itemId) || 'current'\n  if (!session.liveItems) session.liveItems = new Map()\n  const current = session.liveItems.get(itemId) ?? { text: '', completed: false }\n  if (type === 'conversation.item.input_audio_transcription.delta') {\n    clearLiveSettleTimer(session)\n    const delta = stringValue(event.delta) ?? ''\n    current.text += delta\n    current.completed = false\n    session.liveItems.set(itemId, current)\n    session.target.onProvisional?.(liveCombinedText(session))\n    return\n  }\n  if (type === 'conversation.item.input_audio_transcription.completed') {\n    current.text = stringValue(event.transcript) || current.text\n    current.completed = true\n    session.liveItems.set(itemId, current)\n    session.target.onProvisional?.(liveCombinedText(session))\n    scheduleLiveSettle(session)\n  }\n"""
if old_events not in text: raise SystemExit('realtime event block not found')
text = text.replace(old_events, new_events, 1)

text = text.replace("""async function startOpenAiRealtime(session: ActiveSession) {\n  if (typeof RTCPeerConnection === 'undefined') throw new Error('Realtime transcription is not supported by this browser.')\n  const peer = new RTCPeerConnection()\n  session.peer = peer\n  session.stream.getTracks().forEach((track) => peer.addTrack(track, session.stream))\n""", """async function startOpenAiRealtime(session: ActiveSession) {\n  if (!session.stream) throw new Error('The microphone stream is no longer available.')\n  if (typeof RTCPeerConnection === 'undefined') throw new Error('Realtime transcription is not supported by this browser.')\n  const peer = new RTCPeerConnection()\n  session.peer = peer\n  session.stream.getTracks().forEach((track) => peer.addTrack(track, session.stream!))\n""", 1)

start = text.index('export async function startSttSession(')
stop = text.index('export function stopSttSession()', start)
new_start = r'''export async function startSttSession(settings: SpeechSettings, target: SttTarget) {
  if (active) throw new Error('Another dictation session is already active.')
  const selected = parseTranscriptionModelId(settings.transcriptionModel)
  if (!selected) throw new Error('Choose a transcription model in Speech settings.')
  const key = selectedKey(settings, selected.provider)
  if (!key) throw new Error(`Add a ${selected.provider === 'openai' ? 'OpenAI' : 'NanoGPT'} Speech API key in Speech settings before dictating.`)
  if (!target.isValid()) throw new Error('The dictation target is no longer available.')
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser does not support microphone recording.')

  const id = ++currentSession
  const controller = new AbortController()
  const fallbackModel: SttModel = {
    id: settings.transcriptionModel,
    provider: selected.provider,
    modelId: selected.modelId,
    name: selected.modelId,
    supportsFile: true,
    supportsLive: selected.provider === 'openai' && openAiSupportsLiveTranscription(selected.modelId),
    maxFileSizeMb: selected.provider === 'openai' ? 25 : undefined,
  }
  const session: ActiveSession = { id, controller, target, settings, model: fallbackModel, chunks: [] }
  active = session
  emit({ status: 'requesting-permission', label: target.label, target: target.kind, provider: fallbackModel.provider, model: fallbackModel.modelId, live: settings.streamTranscription && fallbackModel.supportsLive, startedAt: Date.now() })

  let catalog: SttModel[] = []
  try {
    catalog = await fetchTranscriptionModels(settings, controller.signal)
  } catch (error) {
    if (!sessionIsCurrent(session)) return
    // A catalog failure is recoverable: attempt the explicitly saved provider-qualified model.
  }
  if (!sessionIsCurrent(session)) return
  const catalogModel = catalog.find((model) => model.id === settings.transcriptionModel)
  if (catalog.length && !catalogModel) {
    const error = new Error(`Saved transcription model “${settings.transcriptionModel}” is unavailable. Choose another model in Speech settings.`)
    failSession(session, error)
    throw error
  }
  if (catalogModel) session.model = catalogModel

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (error) {
    if (!sessionIsCurrent(session)) return
    const message = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')
      ? 'Microphone permission was denied. Allow microphone access to use dictation.'
      : error instanceof Error ? error.message : 'Microphone access failed.'
    const failure = new Error(message)
    failSession(session, failure)
    throw failure
  }
  if (!sessionIsCurrent(session)) {
    stream.getTracks().forEach((track) => track.stop())
    return
  }
  session.stream = stream

  try {
    if (settings.streamTranscription && session.model.supportsLive && session.model.provider === 'openai') await startOpenAiRealtime(session)
    else await startRecordedSession(session)
  } catch (error) {
    if (!sessionIsCurrent(session)) return
    failSession(session, error)
    throw error
  }
}

'''
text = text[:start] + new_start + text[stop:]

old_stop = """  if (state.status === 'recording-live') {\n    sessionState(session, 'finalizing')\n    session.liveStopRequested = true\n    session.stream.getTracks().forEach((track) => track.stop())\n    if (session.channel?.readyState === 'open') session.channel.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))\n    scheduleLiveFinish(session)\n  }\n"""
new_stop = """  if (state.status === 'recording-live') {\n    sessionState(session, 'finalizing')\n    session.liveStopRequested = true\n    session.stream?.getTracks().forEach((track) => track.stop())\n    // WebRTC microphone audio is carried by the media track, not the client input-audio\n    // buffer. Stopping the track lets the transcription session flush its final item.\n    // Wait for the provider's completed event, with a bounded fallback instead of\n    // finalizing after an arbitrary sub-second delay.\n    armLiveDeadline(session)\n    scheduleLiveSettle(session)\n  }\n"""
if old_stop not in text: raise SystemExit('live stop block not found')
text = text.replace(old_stop, new_stop, 1)

p.write_text(text)

# Extend focused service tests with the documented partial-transcription capability map.
p = Path('tests/stt-service.test.mjs')
test_text = p.read_text()
test_text = test_text.replace(
    "import { normalizeTranscriptForInsertion, parseTranscriptionModelId } from '../src/stt-service.ts'",
    "import { normalizeTranscriptForInsertion, openAiSupportsLiveTranscription, parseTranscriptionModelId } from '../src/stt-service.ts'",
    1,
)
test_text += r'''

test('OpenAI live capability only advertises models Arc can stream as partial dictation', () => {
  for (const model of ['gpt-live-transcribe', 'gpt-realtime-whisper', 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe']) {
    assert.equal(openAiSupportsLiveTranscription(model), true, model)
  }
  for (const model of ['whisper-1', 'gpt-transcribe', 'gpt-4o-transcribe-diarize']) {
    assert.equal(openAiSupportsLiveTranscription(model), false, model)
  }
})
'''
p.write_text(test_text)

# Lifecycle regression: reserve the session before permission resolves, allow Cancel,
# and stop a late stream instead of reviving the cancelled session.
Path('tests/stt-lifecycle.test.mjs').write_text(r'''import test from 'node:test'
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
''')

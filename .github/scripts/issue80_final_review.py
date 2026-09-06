from pathlib import Path

p = Path('src/stt-service.ts')
text = p.read_text()
text = text.replace(
    "const NANOGPT_AUDIO_MODELS = `${NANOGPT_BASE}/audio-models?detailed=true&type=stt`",
    "const NANOGPT_AUDIO_MODELS = `${NANOGPT_BASE}/audio-models?detailed=true&type=speech-to-text`",
    1,
)

old = """function normalizeNanoModel(raw: unknown): SttModel | null {\n  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}\n  const modelId = stringValue(value.id) || stringValue(value.model) || stringValue(value.slug)\n  if (!modelId) return null\n  const capabilities = value.capabilities && typeof value.capabilities === 'object' ? value.capabilities as Record<string, unknown> : {}\n"""
new = """function normalizeNanoModel(raw: unknown): SttModel | null {\n  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}\n  const modelId = stringValue(value.id) || stringValue(value.model) || stringValue(value.slug)\n  if (!modelId) return null\n  const modelType = stringValue(value.type) || stringValue(value.model_type) || stringValue(value.category)\n  if (modelType && !/(?:speech[-_ ]?to[-_ ]?text|\\bstt\\b)/i.test(modelType)) return null\n  const capabilities = value.capabilities && typeof value.capabilities === 'object' ? value.capabilities as Record<string, unknown> : {}\n"""
if old not in text: raise SystemExit('Nano model normalization anchor missing')
text = text.replace(old, new, 1)

anchor = """export function normalizeTranscriptForInsertion(transcript: string, before = '', after = '') {\n"""
helper = """export function transcriptionModelUnavailable(catalog: SttModel[], provider: SttProvider, selectedId: string) {\n  const providerModels = catalog.filter((model) => model.provider === provider)\n  return providerModels.length > 0 && !providerModels.some((model) => model.id === selectedId)\n}\n\n"""
if anchor not in text: raise SystemExit('transcript normalization anchor missing')
text = text.replace(anchor, helper + anchor, 1)

text = text.replace(
    """async function finalize(session: ActiveSession, transcript: string) {\n  if (session.id !== currentSession || session.controller.signal.aborted) return\n""",
    """async function finalize(session: ActiveSession, transcript: string) {\n  if (!sessionIsCurrent(session)) return\n""",
    1,
)
text = text.replace(
    """function failSession(session: ActiveSession, error: unknown) {\n  if (session.id !== currentSession) return\n""",
    """function failSession(session: ActiveSession, error: unknown) {\n  if (session.id !== currentSession || active?.id !== session.id) return\n""",
    1,
)
text = text.replace(
    """  const catalogModel = catalog.find((model) => model.id === settings.transcriptionModel)\n  if (catalog.length && !catalogModel) {\n""",
    """  const catalogModel = catalog.find((model) => model.id === settings.transcriptionModel)\n  if (transcriptionModelUnavailable(catalog, selected.provider, settings.transcriptionModel)) {\n""",
    1,
)

# Browser WebRTC transcription uses server turn detection so stopping the microphone can
# let the provider close/finalize the last audio turn without relying on the client-buffer
# commit event used by WebSocket PCM streaming. Make that intent explicit and deterministic.
text = text.replace(
    """      input: {\n        transcription: {\n""",
    """      input: {\n        turn_detection: { type: 'server_vad' },\n        transcription: {\n""",
    1,
)

p.write_text(text)

p = Path('tests/stt-service.test.mjs')
t = p.read_text()
t = t.replace(
    "import { normalizeTranscriptForInsertion, openAiSupportsLiveTranscription, parseTranscriptionModelId } from '../src/stt-service.ts'",
    "import { normalizeTranscriptForInsertion, openAiSupportsLiveTranscription, parseTranscriptionModelId, transcriptionModelUnavailable } from '../src/stt-service.ts'",
    1,
)
t += r'''

test('model unavailability is scoped to the selected provider catalog', () => {
  const nanoOnly = [{ id: 'nanogpt:whisper-large-v3', provider: 'nanogpt', modelId: 'whisper-large-v3', name: 'Whisper Large V3', supportsFile: true, supportsLive: false }]
  assert.equal(transcriptionModelUnavailable(nanoOnly, 'openai', 'openai:whisper-1'), false)
  assert.equal(transcriptionModelUnavailable(nanoOnly, 'nanogpt', 'nanogpt:missing'), true)
  assert.equal(transcriptionModelUnavailable(nanoOnly, 'nanogpt', 'nanogpt:whisper-large-v3'), false)
})
'''
p.write_text(t)

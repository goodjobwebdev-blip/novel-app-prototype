import type { SpeechSettings } from './ai-settings'

export type SttProvider = 'openai' | 'nanogpt'
export type SttModel = {
  id: string
  provider: SttProvider
  modelId: string
  name: string
  price?: string
  supportsFile: boolean
  supportsLive: boolean
  maxFileSizeMb?: number
  supportedFormats?: string[]
  supportedLanguages?: string[]
}

export type SttTargetKind = 'editor' | 'instruction' | 'chat'
export type SttStatus = 'idle' | 'requesting-permission' | 'recording' | 'recording-live' | 'stopping' | 'transcribing' | 'finalizing' | 'cancelled' | 'failed' | 'completed'
export type SttState = {
  status: SttStatus
  label: string
  target: SttTargetKind | null
  provider?: SttProvider
  model?: string
  live: boolean
  startedAt?: number
  error?: string
}

export type SttTarget = {
  kind: SttTargetKind
  label: string
  isValid: () => boolean
  onProvisional?: (text: string) => void
  onFinal: (text: string) => void
  onCancel?: () => void
}

const STT_EVENT = 'arc-stt-state'
const OPENAI_BASE = 'https://api.openai.com/v1'
const NANOGPT_BASE = 'https://nano-gpt.com/api/v1'
const NANOGPT_AUDIO_MODELS = `${NANOGPT_BASE}/audio-models?detailed=true&type=stt`
const OPENAI_TRANSCRIPTION_IDS = /(?:whisper|transcribe)/i

let state: SttState = { status: 'idle', label: '', target: null, live: false }
let currentSession = 0
let active: ActiveSession | null = null

type ActiveSession = {
  id: number
  controller: AbortController
  target: SttTarget
  settings: SpeechSettings
  model: SttModel
  stream: MediaStream
  recorder?: MediaRecorder
  chunks: BlobPart[]
  peer?: RTCPeerConnection
  channel?: RTCDataChannel
  liveItems?: Map<string, { text: string; completed: boolean }>
  liveStopRequested?: boolean
  liveFinalizeTimer?: number
}

function emit(next: SttState) {
  state = next
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(STT_EVENT, { detail: next }))
}

export function getSttState() { return state }
export function subscribeSttState(listener: (value: SttState) => void) {
  if (typeof window === 'undefined') return () => undefined
  const handler = (event: Event) => listener((event as CustomEvent<SttState>).detail)
  window.addEventListener(STT_EVENT, handler)
  listener(state)
  return () => window.removeEventListener(STT_EVENT, handler)
}
export function dismissSttState() {
  if (active) return
  emit({ status: 'idle', label: '', target: null, live: false })
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function finite(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number > 0 ? number : undefined
}

function bool(value: unknown) { return value === true || value === 'true' || value === 1 }

export function parseTranscriptionModelId(value: string): { provider: SttProvider; modelId: string } | null {
  const separator = value.indexOf(':')
  if (separator <= 0) return null
  const provider = value.slice(0, separator)
  const modelId = value.slice(separator + 1).trim()
  if ((provider !== 'openai' && provider !== 'nanogpt') || !modelId) return null
  return { provider, modelId }
}

function openAiLiveModel(modelId: string) {
  return /(?:^|[-_/])(live-transcribe|realtime-whisper)(?:$|[-_/])/i.test(modelId)
}

function normalizeOpenAiModel(raw: unknown): SttModel | null {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const modelId = stringValue(value.id)
  if (!modelId || !OPENAI_TRANSCRIPTION_IDS.test(modelId)) return null
  return {
    id: `openai:${modelId}`,
    provider: 'openai',
    modelId,
    name: modelId,
    supportsFile: true,
    supportsLive: openAiLiveModel(modelId),
    maxFileSizeMb: 25,
    supportedFormats: ['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm'],
  }
}

function nanoPrice(value: Record<string, unknown>) {
  const pricing = value.pricing && typeof value.pricing === 'object' ? value.pricing as Record<string, unknown> : {}
  const numeric = finite(pricing.per_minute) ?? finite(pricing.perMinute) ?? finite(value.price_per_minute)
  if (numeric !== undefined) return `$${numeric} / min`
  const display = stringValue(pricing.display) || stringValue(value.average_price) || stringValue(value.price)
  return display
}

function normalizeNanoModel(raw: unknown): SttModel | null {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const modelId = stringValue(value.id) || stringValue(value.model) || stringValue(value.slug)
  if (!modelId) return null
  const capabilities = value.capabilities && typeof value.capabilities === 'object' ? value.capabilities as Record<string, unknown> : {}
  const parameters = value.supported_parameters && typeof value.supported_parameters === 'object' ? value.supported_parameters as Record<string, unknown> : {}
  const formatsRaw = value.supported_formats ?? parameters.supported_formats
  const languagesRaw = value.supported_languages ?? parameters.supported_languages
  const live = bool(capabilities.live_transcription) || bool(capabilities.realtime_transcription) || bool(capabilities.streaming_stt) || bool(value.supports_live)
  return {
    id: `nanogpt:${modelId}`,
    provider: 'nanogpt',
    modelId,
    name: stringValue(value.name) || modelId,
    price: nanoPrice(value),
    supportsFile: capabilities.speech_to_text === undefined ? true : bool(capabilities.speech_to_text),
    supportsLive: live,
    maxFileSizeMb: finite(parameters.max_file_size_mb) ?? finite(value.max_file_size_mb),
    supportedFormats: Array.isArray(formatsRaw) ? formatsRaw.filter((item): item is string => typeof item === 'string') : undefined,
    supportedLanguages: Array.isArray(languagesRaw) ? languagesRaw.filter((item): item is string => typeof item === 'string') : undefined,
  }
}

async function fetchNanoModels(apiKey: string, signal?: AbortSignal) {
  const response = await fetch(NANOGPT_AUDIO_MODELS, {
    headers: { Accept: 'application/json', ...(apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {}) },
    signal,
  })
  if (!response.ok) throw new Error(`NanoGPT transcription model list failed (${response.status}).`)
  const payload = await response.json().catch(() => ({})) as { data?: unknown[] }
  return (Array.isArray(payload.data) ? payload.data : []).map(normalizeNanoModel).filter((model): model is SttModel => Boolean(model))
}

async function fetchOpenAiModels(apiKey: string, signal?: AbortSignal) {
  if (!apiKey.trim()) return []
  const response = await fetch(`${OPENAI_BASE}/models`, { headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey.trim()}` }, signal })
  if (!response.ok) throw new Error(`OpenAI transcription model list failed (${response.status}).`)
  const payload = await response.json().catch(() => ({})) as { data?: unknown[] }
  return (Array.isArray(payload.data) ? payload.data : []).map(normalizeOpenAiModel).filter((model): model is SttModel => Boolean(model))
}

export async function fetchTranscriptionModels(settings: SpeechSettings, signal?: AbortSignal): Promise<SttModel[]> {
  const [openai, nanogpt] = await Promise.allSettled([
    fetchOpenAiModels(settings.openaiApiKey, signal),
    fetchNanoModels(settings.apiKey, signal),
  ])
  const models = [
    ...(openai.status === 'fulfilled' ? openai.value : []),
    ...(nanogpt.status === 'fulfilled' ? nanogpt.value : []),
  ]
  if (!models.length) {
    const errors = [openai, nanogpt].filter((result): result is PromiseRejectedResult => result.status === 'rejected').map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason))
    if (errors.length) throw new Error(errors.join(' '))
  }
  return models.sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name))
}

export function normalizeTranscriptForInsertion(transcript: string, before = '', after = '') {
  const trimmed = transcript.trim()
  if (!trimmed) return ''
  const beforeChar = before.slice(-1)
  const afterChar = after.slice(0, 1)
  const first = trimmed.slice(0, 1)
  const last = trimmed.slice(-1)
  const word = /[\p{L}\p{N}]/u
  const leading = word.test(beforeChar) && word.test(first) ? ' ' : ''
  const trailing = word.test(last) && word.test(afterChar) ? ' ' : ''
  return `${leading}${trimmed}${trailing}`
}

function safeError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') return fallback
  const value = payload as Record<string, unknown>
  if (typeof value.error === 'string' && value.error.trim()) return value.error.slice(0, 300)
  if (value.error && typeof value.error === 'object' && typeof (value.error as Record<string, unknown>).message === 'string') return String((value.error as Record<string, unknown>).message).slice(0, 300)
  if (typeof value.message === 'string' && value.message.trim()) return value.message.slice(0, 300)
  return fallback
}

function selectedKey(settings: SpeechSettings, provider: SttProvider) {
  return provider === 'openai' ? settings.openaiApiKey.trim() : settings.apiKey.trim()
}

function chooseRecorderMime() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  return candidates.find((candidate) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(candidate)) ?? ''
}

function extensionForMime(mime: string) {
  if (mime.includes('mp4')) return 'm4a'
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('wav')) return 'wav'
  return 'webm'
}

async function transcribeBlob(session: ActiveSession, blob: Blob) {
  const { provider, modelId } = session.model
  const key = selectedKey(session.settings, provider)
  const form = new FormData()
  form.append('file', new File([blob], `dictation.${extensionForMime(blob.type)}`, { type: blob.type || 'audio/webm' }))
  form.append('model', modelId)
  form.append('response_format', 'json')
  if (session.settings.transcriptionLanguage !== 'auto' && session.settings.transcriptionLanguage.trim()) form.append('language', session.settings.transcriptionLanguage.trim())
  const endpoint = provider === 'openai' ? `${OPENAI_BASE}/audio/transcriptions` : `${NANOGPT_BASE}/audio/transcriptions`
  const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: session.controller.signal })
  const contentType = response.headers.get('content-type') ?? ''
  const payload = contentType.includes('application/json') ? await response.json().catch(() => ({})) : await response.text()
  if (!response.ok) throw new Error(safeError(payload, `${provider === 'openai' ? 'OpenAI' : 'NanoGPT'} transcription failed (${response.status}).`))
  if (typeof payload === 'string') return payload.trim()
  const text = payload && typeof payload === 'object' ? stringValue((payload as Record<string, unknown>).text) || stringValue((payload as Record<string, unknown>).transcript) : undefined
  if (!text) throw new Error('The transcription provider returned no text.')
  return text
}

function cleanupSession(session: ActiveSession) {
  if (session.liveFinalizeTimer !== undefined) window.clearTimeout(session.liveFinalizeTimer)
  session.recorder?.stream?.getTracks().forEach((track) => track.stop())
  session.stream.getTracks().forEach((track) => track.stop())
  try { session.channel?.close() } catch { /* noop */ }
  try { session.peer?.close() } catch { /* noop */ }
  if (active?.id === session.id) active = null
}

function sessionState(session: ActiveSession, status: SttStatus, patch: Partial<SttState> = {}) {
  emit({
    status,
    label: session.target.label,
    target: session.target.kind,
    provider: session.model.provider,
    model: session.model.modelId,
    live: session.model.supportsLive && session.settings.streamTranscription,
    startedAt: state.startedAt,
    ...patch,
  })
}

async function finalize(session: ActiveSession, transcript: string) {
  if (session.id !== currentSession || session.controller.signal.aborted) return
  if (!session.target.isValid()) throw new Error('The original dictation target is no longer available.')
  session.target.onFinal(transcript)
  cleanupSession(session)
  sessionState(session, 'completed')
}

function failSession(session: ActiveSession, error: unknown) {
  if (session.id !== currentSession) return
  const aborted = session.controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')
  if (aborted) return
  session.target.onCancel?.()
  cleanupSession(session)
  const message = error instanceof Error ? error.message : 'Speech transcription failed.'
  sessionState(session, 'failed', { error: message })
}

async function startRecordedSession(session: ActiveSession) {
  const mimeType = chooseRecorderMime()
  const recorder = mimeType ? new MediaRecorder(session.stream, { mimeType }) : new MediaRecorder(session.stream)
  session.recorder = recorder
  recorder.ondataavailable = (event) => { if (event.data.size) session.chunks.push(event.data) }
  recorder.onerror = (event) => failSession(session, new Error((event as Event & { error?: DOMException }).error?.message || 'Microphone recording failed.'))
  recorder.onstop = () => {
    if (session.id !== currentSession || session.controller.signal.aborted) return
    const blob = new Blob(session.chunks, { type: recorder.mimeType || mimeType || 'audio/webm' })
    session.stream.getTracks().forEach((track) => track.stop())
    sessionState(session, 'transcribing')
    void transcribeBlob(session, blob).then((text) => finalize(session, text)).catch((error) => failSession(session, error))
  }
  recorder.start(250)
  sessionState(session, 'recording')
}

function liveCombinedText(session: ActiveSession) {
  return [...(session.liveItems?.values() ?? [])].map((item) => item.text).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}

function scheduleLiveFinish(session: ActiveSession) {
  if (!session.liveStopRequested || session.id !== currentSession) return
  if (session.liveFinalizeTimer !== undefined) window.clearTimeout(session.liveFinalizeTimer)
  session.liveFinalizeTimer = window.setTimeout(() => {
    const text = liveCombinedText(session)
    if (!text) { failSession(session, new Error('The realtime transcription returned no text.')); return }
    void finalize(session, text).catch((error) => failSession(session, error))
  }, 900)
}

function handleRealtimeEvent(session: ActiveSession, raw: unknown) {
  if (!raw || typeof raw !== 'object') return
  const event = raw as Record<string, unknown>
  const type = stringValue(event.type) ?? ''
  if (type === 'error') {
    failSession(session, new Error(safeError(event, 'OpenAI realtime transcription failed.')))
    return
  }
  const itemId = stringValue(event.item_id) || stringValue(event.itemId) || 'current'
  if (!session.liveItems) session.liveItems = new Map()
  const current = session.liveItems.get(itemId) ?? { text: '', completed: false }
  if (type === 'conversation.item.input_audio_transcription.delta') {
    const delta = stringValue(event.delta) ?? ''
    current.text += delta
    session.liveItems.set(itemId, current)
    if (session.target.isValid()) session.target.onProvisional?.(liveCombinedText(session))
    return
  }
  if (type === 'conversation.item.input_audio_transcription.completed') {
    current.text = stringValue(event.transcript) || current.text
    current.completed = true
    session.liveItems.set(itemId, current)
    if (session.target.isValid()) session.target.onProvisional?.(liveCombinedText(session))
    scheduleLiveFinish(session)
  }
}

async function startOpenAiRealtime(session: ActiveSession) {
  if (typeof RTCPeerConnection === 'undefined') throw new Error('Realtime transcription is not supported by this browser.')
  const peer = new RTCPeerConnection()
  session.peer = peer
  session.stream.getTracks().forEach((track) => peer.addTrack(track, session.stream))
  const channel = peer.createDataChannel('oai-events')
  session.channel = channel
  channel.onmessage = (event) => {
    try { handleRealtimeEvent(session, JSON.parse(event.data)) } catch { /* ignore malformed provider events */ }
  }
  channel.onerror = () => failSession(session, new Error('The OpenAI realtime transcription connection failed.'))
  const offer = await peer.createOffer()
  await peer.setLocalDescription(offer)
  const sessionConfig: Record<string, unknown> = {
    type: 'transcription',
    audio: {
      input: {
        transcription: {
          model: session.model.modelId,
          ...(session.settings.transcriptionLanguage !== 'auto' && session.settings.transcriptionLanguage.trim() ? { language: session.settings.transcriptionLanguage.trim() } : {}),
        },
      },
    },
  }
  const response = await fetch(`${OPENAI_BASE}/realtime/calls`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.settings.openaiApiKey.trim()}`, 'Content-Type': 'application/json', Accept: 'application/sdp' },
    body: JSON.stringify({ sdp: offer.sdp, session: sessionConfig }),
    signal: session.controller.signal,
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(safeError(payload, `OpenAI realtime transcription setup failed (${response.status}).`))
  }
  const answer = await response.text()
  await peer.setRemoteDescription({ type: 'answer', sdp: answer })
  sessionState(session, 'recording-live')
}

export async function startSttSession(settings: SpeechSettings, target: SttTarget) {
  if (active) throw new Error('Another dictation session is already active.')
  const selected = parseTranscriptionModelId(settings.transcriptionModel)
  if (!selected) throw new Error('Choose a transcription model in Speech settings.')
  const key = selectedKey(settings, selected.provider)
  if (!key) throw new Error(`Add a ${selected.provider === 'openai' ? 'OpenAI' : 'NanoGPT'} Speech API key in Speech settings before dictating.`)
  if (!target.isValid()) throw new Error('The dictation target is no longer available.')
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('This browser does not support microphone recording.')

  let catalog: SttModel[] = []
  try { catalog = await fetchTranscriptionModels(settings) } catch { /* saved model can still be attempted */ }
  const catalogModel = catalog.find((model) => model.id === settings.transcriptionModel)
  const model: SttModel = catalogModel ?? {
    id: settings.transcriptionModel,
    provider: selected.provider,
    modelId: selected.modelId,
    name: selected.modelId,
    supportsFile: true,
    supportsLive: selected.provider === 'openai' && openAiLiveModel(selected.modelId),
    maxFileSizeMb: selected.provider === 'openai' ? 25 : undefined,
  }
  if (catalog.length && !catalogModel) throw new Error(`Saved transcription model “${settings.transcriptionModel}” is unavailable. Choose another model in Speech settings.`)
  if (settings.streamTranscription && model.supportsLive && model.provider !== 'openai') throw new Error('This transcription provider does not have a live adapter in this version.')

  const id = ++currentSession
  const controller = new AbortController()
  emit({ status: 'requesting-permission', label: target.label, target: target.kind, provider: model.provider, model: model.modelId, live: settings.streamTranscription && model.supportsLive, startedAt: Date.now() })
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (error) {
    const message = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')
      ? 'Microphone permission was denied. Allow microphone access to use dictation.'
      : error instanceof Error ? error.message : 'Microphone access failed.'
    emit({ status: 'failed', label: target.label, target: target.kind, provider: model.provider, model: model.modelId, live: false, error: message })
    throw new Error(message)
  }
  const session: ActiveSession = { id, controller, target, settings, model, stream, chunks: [] }
  active = session
  try {
    if (settings.streamTranscription && model.supportsLive && model.provider === 'openai') await startOpenAiRealtime(session)
    else await startRecordedSession(session)
  } catch (error) {
    failSession(session, error)
    throw error
  }
}

export function stopSttSession() {
  const session = active
  if (!session) return
  if (state.status === 'recording') {
    sessionState(session, 'stopping')
    if (session.recorder?.state === 'recording') session.recorder.stop()
    return
  }
  if (state.status === 'recording-live') {
    sessionState(session, 'finalizing')
    session.liveStopRequested = true
    session.stream.getTracks().forEach((track) => track.stop())
    if (session.channel?.readyState === 'open') session.channel.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
    scheduleLiveFinish(session)
  }
}

export function cancelSttSession() {
  const session = active
  if (!session) return
  currentSession += 1
  session.controller.abort()
  try { if (session.recorder?.state === 'recording') session.recorder.stop() } catch { /* noop */ }
  session.target.onCancel?.()
  cleanupSession(session)
  emit({ status: 'cancelled', label: session.target.label, target: session.target.kind, provider: session.model.provider, model: session.model.modelId, live: session.model.supportsLive && session.settings.streamTranscription })
}

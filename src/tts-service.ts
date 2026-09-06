import type { SpeechSettings } from './ai-settings'

export type SpeechModel = {
  id: string
  name: string
  voices: string[]
  price?: string
  maxChars?: number
}

export type TtsStatus = 'idle' | 'preparing' | 'generating' | 'playing' | 'paused' | 'waiting' | 'stopping' | 'stopped' | 'complete' | 'failed'
export type TtsState = {
  status: TtsStatus
  label: string
  chunkIndex: number
  chunkCount: number
  currentTime?: number
  duration?: number
  canReplay?: boolean
  error?: string
}

type GeneratedAudio = { url: string; objectUrl: boolean }
type RetainedPlayback = { label: string; items: GeneratedAudio[] }

const TTS_EVENT = 'arc-tts-state'
const TTS_BASE = 'https://nano-gpt.com/api'
const AUDIO_MODELS_URL = 'https://nano-gpt.com/api/v1/audio-models?detailed=true&type=tts'

let state: TtsState = { status: 'idle', label: '', chunkIndex: 0, chunkCount: 0 }
let sessionId = 0
let activeController: AbortController | null = null
let activeAudio: HTMLAudioElement | null = null
let finishActiveAudio: (() => void) | null = null
let retainedPlayback: RetainedPlayback | null = null
let objectUrls = new Set<string>()

function emit(next: TtsState) {
  state = next
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(TTS_EVENT, { detail: next }))
}

export function getTtsState() { return state }
export function dismissTtsState() {
  if (activeController || activeAudio) return
  retainedPlayback = null
  cleanupObjectUrls()
  emit({ status: 'idle', label: '', chunkIndex: 0, chunkCount: 0 })
}
export function subscribeTtsState(listener: (value: TtsState) => void) {
  if (typeof window === 'undefined') return () => undefined
  const handler = (event: Event) => listener((event as CustomEvent<TtsState>).detail)
  window.addEventListener(TTS_EVENT, handler)
  listener(state)
  return () => window.removeEventListener(TTS_EVENT, handler)
}

function finite(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number > 0 ? number : undefined
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function recordValue(value: unknown) {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function bool(value: unknown) {
  return value === true || value === 'true' || value === 1
}

function extractVoices(model: Record<string, unknown>) {
  const supported = recordValue(model.supported_parameters)
  const metadata = recordValue(model.metadata)
  const raw = supported.voices ?? supported.available_voices ?? supported.voice_options ?? model.voices ?? model.available_voices ?? model.voice_options ?? metadata.voices
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.map((item) => typeof item === 'string' ? item : item && typeof item === 'object' ? stringValue((item as Record<string, unknown>).id) || stringValue((item as Record<string, unknown>).name) : undefined).filter((item): item is string => Boolean(item)))]
}

function extractPrice(model: Record<string, unknown>) {
  const pricing = recordValue(model.pricing)
  const value = stringValue(pricing.display) || stringValue(model.average_price) || stringValue(model.avg_price) || stringValue(model.price) || stringValue(pricing.average)
  if (value) return value
  const currency = (stringValue(pricing.currency) || 'USD').toUpperCase()
  const rates: Array<[unknown, string]> = [
    [pricing.per_thousand_chars, ' / 1k chars'],
    [pricing.per_generation, ' / generation'],
    [pricing.per_second, ' / second'],
    [pricing.per_minute, ' / minute'],
    [pricing.per_character, ' / character'],
  ]
  for (const [raw, unit] of rates) {
    const numeric = finite(raw)
    if (numeric === undefined) continue
    const amount = String(Number(numeric.toFixed(6)))
    return `${currency === 'USD' ? '$' : `${currency} `}${amount}${unit}`
  }
  const numeric = finite(model.average_price) ?? finite(model.avg_price) ?? finite(pricing.average)
  return numeric !== undefined ? String(numeric) : undefined
}

function isTextToSpeechModel(model: Record<string, unknown>) {
  const capabilities = recordValue(model.capabilities)
  if ('text_to_speech' in capabilities) return bool(capabilities.text_to_speech)
  if (Object.keys(capabilities).length) return false
  const modelType = stringValue(model.type) || stringValue(model.model_type) || stringValue(model.category)
  return modelType ? /(?:text[-_ ]?to[-_ ]?speech|\btts\b)/i.test(modelType) : true
}

export async function fetchSpeechModels(apiKey = '', signal?: AbortSignal): Promise<SpeechModel[]> {
  const response = await fetch(AUDIO_MODELS_URL, {
    headers: { Accept: 'application/json', ...(apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {}) },
    signal,
  })
  if (!response.ok) throw new Error(`NanoGPT audio model list failed (${response.status}).`)
  const payload = await response.json().catch(() => ({})) as { data?: unknown[] }
  return (Array.isArray(payload.data) ? payload.data : []).map((raw): SpeechModel | null => {
    const model = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
    if (!isTextToSpeechModel(model)) return null
    const id = stringValue(model.id) || stringValue(model.model) || stringValue(model.slug) || ''
    const name = stringValue(model.name) || id
    const supported = recordValue(model.supported_parameters)
    const metadata = recordValue(model.metadata)
    const maxChars = finite(supported.max_chars) ?? finite(supported.max_input_chars) ?? finite(model.max_chars) ?? finite(model.max_input_chars) ?? finite(metadata.max_chars) ?? finite(metadata.max_input_chars)
    return id ? { id, name, voices: extractVoices(model), price: extractPrice(model), maxChars } : null
  }).filter((model): model is SpeechModel => Boolean(model))
}

export function normalizeSpeakableText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/gm, '')
    .replace(/[*_~`]+/g, '')
    .replace(/<[^>]+>/g, ' ')
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n')
}

function knownMaxChars(model: string) {
  if (model.toLowerCase() === 'kokoro-82m') return 10_000
  if (/^(tts-1|tts-1-hd|gpt-4o-mini-tts)$/i.test(model)) return 4_096
  return 8_000
}

function sentenceUnits(text: string) {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    try {
      const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' })
      return [...segmenter.segment(text)].map((part) => part.segment.trim()).filter(Boolean)
    } catch { /* fallback below */ }
  }
  return text.match(/[^.!?]+[.!?]+(?:[”’"']+)?|[^.!?]+$/g)?.map((value) => value.trim()).filter(Boolean) ?? [text]
}

function splitOversizedUnit(text: string, maxChars: number) {
  const sentences = sentenceUnits(text)
  const chunks: string[] = []
  let current = ''
  const push = () => { if (current.trim()) chunks.push(current.trim()); current = '' }
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      push()
      for (let start = 0; start < sentence.length; start += maxChars) chunks.push(sentence.slice(start, start + maxChars).trim())
      continue
    }
    const candidate = current ? `${current} ${sentence}` : sentence
    if (candidate.length > maxChars) push()
    current = current ? `${current} ${sentence}` : sentence
  }
  push()
  return chunks
}

export function buildTtsChunks(markdown: string, model: string, modelInfo?: SpeechModel) {
  const normalized = normalizeSpeakableText(markdown)
  if (!normalized) return []
  const hardMax = Math.max(500, Math.floor(modelInfo?.maxChars ?? knownMaxChars(model)))
  const preferred = Math.max(500, Math.min(hardMax, Math.floor(hardMax * 0.72)))
  const units = normalized.split(/\n\n+/).flatMap((paragraph) => paragraph.length > hardMax ? splitOversizedUnit(paragraph, hardMax) : [paragraph])
  const chunks: string[] = []
  let current = ''
  for (const unit of units) {
    const candidate = current ? `${current}\n\n${unit}` : unit
    if (current && candidate.length > preferred) {
      chunks.push(current)
      current = unit
    } else current = candidate
  }
  if (current) chunks.push(current)
  return chunks
}

export function estimateSpeechRequest(settings: SpeechSettings, markdown: string, modelInfo?: SpeechModel) {
  const text = normalizeSpeakableText(markdown)
  const chunks = buildTtsChunks(markdown, settings.model, modelInfo)
  return {
    characters: text.length,
    words: text ? text.split(/\s+/).length : 0,
    chunks: chunks.length,
    price: modelInfo?.price,
  }
}

function safeError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') return fallback
  const value = payload as Record<string, unknown>
  const error = value.error
  if (typeof error === 'string' && error.trim()) return error.slice(0, 240)
  if (error && typeof error === 'object' && typeof (error as Record<string, unknown>).message === 'string') return String((error as Record<string, unknown>).message).slice(0, 240)
  if (typeof value.message === 'string' && value.message.trim()) return value.message.slice(0, 240)
  return fallback
}

async function pollAudioUrl(ticket: Record<string, unknown>, apiKey: string, signal: AbortSignal) {
  const runId = stringValue(ticket.runId)
  const model = stringValue(ticket.model)
  if (!runId || !model) throw new Error('NanoGPT queued TTS without a usable run identifier.')
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    const params = new URLSearchParams({ runId, model })
    if (typeof ticket.cost === 'number') params.set('cost', String(ticket.cost))
    if (typeof ticket.paymentSource === 'string') params.set('paymentSource', ticket.paymentSource)
    if (typeof ticket.isApiRequest === 'boolean') params.set('isApiRequest', String(ticket.isApiRequest))
    const response = await fetch(`${TTS_BASE}/tts/status?${params}`, { headers: { 'x-api-key': apiKey }, signal })
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>
    if (!response.ok) throw new Error(safeError(payload, `NanoGPT TTS status failed (${response.status}).`))
    if (payload.status === 'completed' && typeof payload.audioUrl === 'string') return payload.audioUrl
    if (payload.status === 'error' || payload.status === 'failed') throw new Error(safeError(payload, 'NanoGPT TTS generation failed.'))
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(resolve, 2500)
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
    })
  }
  throw new Error('NanoGPT TTS timed out while waiting for generated audio.')
}

async function requestChunk(settings: SpeechSettings, text: string, signal: AbortSignal): Promise<{ url: string; objectUrl: boolean }> {
  const response = await fetch(`${TTS_BASE}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': settings.apiKey.trim() },
    body: JSON.stringify({ text, model: settings.model, ...(settings.voice.trim() ? { voice: settings.voice.trim() } : {}), response_format: 'mp3' }),
    signal,
  })
  if (response.status === 202) {
    const ticket = await response.json().catch(() => ({})) as Record<string, unknown>
    return { url: await pollAudioUrl(ticket, settings.apiKey.trim(), signal), objectUrl: false }
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(safeError(payload, `NanoGPT TTS failed (${response.status}).`))
  }
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>
    if (typeof payload.audioUrl !== 'string' || !payload.audioUrl) throw new Error('NanoGPT TTS returned no audio URL.')
    return { url: payload.audioUrl, objectUrl: false }
  }
  const blob = await response.blob()
  if (!blob.size) throw new Error('NanoGPT TTS returned empty audio.')
  const url = URL.createObjectURL(blob)
  objectUrls.add(url)
  return { url, objectUrl: true }
}

function cleanupObjectUrls() {
  objectUrls.forEach((url) => URL.revokeObjectURL(url))
  objectUrls = new Set()
}

export function stopTtsSession() {
  if (!activeController && !activeAudio) return
  emit({ ...state, status: 'stopping' })
  const canReplay = Boolean(retainedPlayback?.items.length)
  sessionId += 1
  activeController?.abort()
  activeController = null
  if (activeAudio) {
    activeAudio.pause()
    activeAudio.src = ''
    activeAudio = null
  }
  finishActiveAudio?.()
  finishActiveAudio = null
  if (!canReplay) cleanupObjectUrls()
  emit({ ...state, status: 'stopped', canReplay, error: undefined })
}

export function pauseTtsSession() {
  if (!activeAudio || state.status !== 'playing') return
  activeAudio.pause()
  emit({ ...state, status: 'paused' })
}

export async function resumeTtsSession() {
  if (!activeAudio || state.status !== 'paused') return
  await activeAudio.play()
  emit({ ...state, status: 'playing' })
}

function playableDuration(audio: HTMLAudioElement) {
  return Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0
}

function emitPlaybackProgress(audio: HTMLAudioElement) {
  if (activeAudio !== audio) return
  emit({
    ...state,
    currentTime: Math.max(0, Number.isFinite(audio.currentTime) ? audio.currentTime : 0),
    duration: playableDuration(audio),
  })
}

export function seekTtsTo(seconds: number) {
  if (!activeAudio || !Number.isFinite(seconds)) return
  const duration = playableDuration(activeAudio)
  activeAudio.currentTime = Math.max(0, Math.min(duration || seconds, seconds))
  emitPlaybackProgress(activeAudio)
}

export function seekTtsBy(seconds: number) {
  if (!activeAudio || !Number.isFinite(seconds)) return
  seekTtsTo((Number.isFinite(activeAudio.currentTime) ? activeAudio.currentTime : 0) + seconds)
}

async function playAudio(url: string, currentSession: number, chunkIndex: number, chunkCount: number, label: string) {
  if (currentSession !== sessionId) return
  const audio = new Audio(url)
  activeAudio = audio
  emit({ status: 'playing', label, chunkIndex, chunkCount, currentTime: 0, duration: 0, canReplay: Boolean(retainedPlayback) })
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      if (finishActiveAudio === stop) finishActiveAudio = null
      if (activeAudio === audio) activeAudio = null
      if (error) reject(error); else resolve()
    }
    const stop = () => finish()
    finishActiveAudio = stop
    audio.onloadedmetadata = () => emitPlaybackProgress(audio)
    audio.ondurationchange = () => emitPlaybackProgress(audio)
    audio.ontimeupdate = () => emitPlaybackProgress(audio)
    audio.onended = () => { emitPlaybackProgress(audio); finish() }
    audio.onerror = () => finish(new Error('The browser could not play generated audio.'))
    audio.play().catch((error) => finish(error instanceof Error ? error : new Error('The browser could not play generated audio.')))
  })
}

async function playRetained(currentSession: number, playback: RetainedPlayback) {
  const controller = new AbortController()
  activeController = controller
  try {
    for (let index = 0; index < playback.items.length; index += 1) {
      if (controller.signal.aborted || currentSession !== sessionId) return
      await playAudio(playback.items[index].url, currentSession, index + 1, playback.items.length, playback.label)
    }
    if (currentSession === sessionId) emit({ ...state, status: 'complete', canReplay: true, error: undefined })
  } catch (error) {
    if (controller.signal.aborted || currentSession !== sessionId) return
    emit({ ...state, status: 'failed', canReplay: true, error: error instanceof Error ? error.message : 'The browser could not replay generated audio.' })
  } finally {
    if (currentSession === sessionId) {
      activeController = null
      activeAudio = null
      finishActiveAudio = null
    }
  }
}

export async function replayTtsSession() {
  if (!retainedPlayback?.items.length || activeController || activeAudio) return
  const currentSession = ++sessionId
  await playRetained(currentSession, retainedPlayback)
}

export async function startTtsSession(settings: SpeechSettings, markdown: string, label = 'Read aloud') {
  stopTtsSession()
  retainedPlayback = null
  cleanupObjectUrls()
  const text = normalizeSpeakableText(markdown)
  if (!text) throw new Error('There is no readable text for this action.')
  if (settings.provider !== 'nanogpt') throw new Error('NanoGPT is the only supported TTS provider in this version.')
  if (!settings.apiKey.trim()) throw new Error('Add a NanoGPT Speech API key in Speech settings.')
  if (!settings.model.trim()) throw new Error('Choose a TTS model in Speech settings.')
  if (!settings.voice.trim()) throw new Error('Choose a TTS voice in Speech settings.')

  const currentSession = ++sessionId
  const controller = new AbortController()
  activeController = controller
  emit({ status: 'preparing', label, chunkIndex: 0, chunkCount: 0, currentTime: 0, duration: 0, canReplay: false })
  let models: SpeechModel[] = []
  try {
    models = await fetchSpeechModels(settings.apiKey, controller.signal)
  } catch (error) {
    if (controller.signal.aborted || currentSession !== sessionId) return
    // A catalog failure is recoverable because generation can still use the saved model.
  }
  if (controller.signal.aborted || currentSession !== sessionId) return
  const modelInfo = models.find((model) => model.id === settings.model)
  if (models.length && !modelInfo) {
    activeController = null
    emit({ status: 'failed', label, chunkIndex: 0, chunkCount: 0, error: `Saved TTS model “${settings.model}” is unavailable. Choose another model in Speech settings.` })
    throw new Error(`Saved TTS model “${settings.model}” is unavailable.`)
  }
  if (modelInfo?.voices.length && !modelInfo.voices.includes(settings.voice)) {
    activeController = null
    emit({ status: 'failed', label, chunkIndex: 0, chunkCount: 0, error: `Saved voice “${settings.voice}” is unavailable for ${settings.model}.` })
    throw new Error(`Saved voice “${settings.voice}” is unavailable for ${settings.model}.`)
  }

  const chunks = buildTtsChunks(text, settings.model, modelInfo)
  const count = chunks.length
  emit({ status: 'generating', label, chunkIndex: 0, chunkCount: count, currentTime: 0, duration: 0, canReplay: false })
  const generatedItems: GeneratedAudio[] = new Array(count)
  const deferred = chunks.map(() => {
    let resolve!: (value: { url: string; objectUrl: boolean }) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<{ url: string; objectUrl: boolean }>((res, rej) => { resolve = res; reject = rej })
    // Workers may reject chunks that the ordered playback loop never reaches after a fatal failure.
    // Mark every deferred rejection as observed while preserving rejection for later awaiters.
    void promise.catch(() => undefined)
    return { promise, resolve, reject, ready: false }
  })
  let nextIndex = 0
  let fatalError: unknown
  const concurrency = Math.max(1, Math.min(8, Number.parseInt(settings.maxParallelRequests, 10) || 1))
  const worker = async () => {
    while (currentSession === sessionId && !controller.signal.aborted) {
      const index = nextIndex++
      if (index >= chunks.length) return
      try {
        const result = await requestChunk(settings, chunks[index], controller.signal)
        if (controller.signal.aborted || currentSession !== sessionId || fatalError !== undefined) {
          if (result.objectUrl) {
            URL.revokeObjectURL(result.url)
            objectUrls.delete(result.url)
          }
          return
        }
        generatedItems[index] = result
        deferred[index].ready = true
        deferred[index].resolve(result)
      } catch (error) {
        deferred[index].reject(error)
        if (!controller.signal.aborted && currentSession === sessionId && fatalError === undefined) {
          fatalError = error
          controller.abort()
        }
        return
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, chunks.length) }, () => worker())

  let completed = false
  try {
    for (let index = 0; index < deferred.length; index += 1) {
      if (!deferred[index].ready && index > 0) emit({ status: 'waiting', label, chunkIndex: index, chunkCount: count, currentTime: 0, duration: 0, canReplay: false })
      const generated = await deferred[index].promise
      await playAudio(generated.url, currentSession, index + 1, count, label)
      if (controller.signal.aborted || currentSession !== sessionId) return
    }
    await Promise.allSettled(workers)
    if (currentSession === sessionId) {
      retainedPlayback = { label, items: generatedItems }
      completed = true
      emit({ ...state, status: 'complete', label, chunkIndex: count, chunkCount: count, canReplay: true, error: undefined })
    }
  } catch (error) {
    const userCancelled = currentSession !== sessionId || (controller.signal.aborted && fatalError === undefined)
    if (!userCancelled && fatalError === undefined) {
      fatalError = error
      controller.abort()
    }
    await Promise.allSettled(workers)
    if (userCancelled) return
    const failure = fatalError ?? error
    const message = failure instanceof Error ? failure.message : 'Text-to-speech failed.'
    if (currentSession === sessionId) emit({ status: 'failed', label, chunkIndex: state.chunkIndex, chunkCount: count, error: message })
    throw failure
  } finally {
    if (currentSession === sessionId) {
      activeController = null
      activeAudio = null
      finishActiveAudio = null
      if (!completed) {
        retainedPlayback = null
        cleanupObjectUrls()
      }
    }
  }
}

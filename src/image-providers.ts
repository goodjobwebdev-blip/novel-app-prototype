import { documentedImageModels, imageRatio, imageSize, prunaImageModels } from './image-settings'
import { generationTask, modelTasks, outputKind, type GenerationSource, type ImageJob, type ImageModel, type ImageProvider, type ImageSize } from './image-generation-types'
import { assertImageFile, makeThumbnail } from './illustration-image'
export type ImageOutput = { image: Blob; thumbnail: Blob; width: number; height: number; kind?: 'image' | 'video'; mediaDurationMs?: number; seed?: number; cost?: number; revisedPrompt?: string }
export type ProviderResult = { image: Blob; kind?: 'image' | 'video'; seed?: number; cost?: number; revisedPrompt?: string }
const PRUNA = 'https://api.pruna.ai'
const NANO = 'https://nano-gpt.com'
const MB = 1024 * 1024
export function safeImageError(error: unknown, key = '') {
  const text = error instanceof Error ? error.message : 'Media generation failed.'
  return (key ? text.split(key).join('[redacted]') : text).slice(0, 1000)
}
function providerError(data: any, fallback: string) {
  const value = data?.error ?? data?.detail ?? data?.message
  if (typeof value === 'string') return value
  if (typeof value?.message === 'string') return value.message
  if (value != null) try { return JSON.stringify(value) } catch { /* Use fallback. */ }
  return fallback
}
async function jsonResponse(response: Response, key = '') {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(safeImageError(new Error(`Generation provider (${response.status}): ${providerError(data, response.statusText)}`), key))
  return data
}
function uniqueSizes(values: unknown[]): ImageSize[] {
  return [...new Map(values.map((value) => typeof value === 'string' ? imageSize(value) : undefined).filter(Boolean).map((size) => [(size as ImageSize).value, size as ImageSize])).values()]
}
function nanoImageTasks(model: any) {
  const capabilities = model?.capabilities ?? {}
  const edit = capabilities.image_editing === true || capabilities.image_to_image === true || capabilities.image_edit === true
  const generate = capabilities.image_generation === true || capabilities.text_to_image === true
  return [...(generate ? ['text-to-image' as const] : []), ...(edit ? ['image-to-image' as const] : [])]
}
export function normalizeNanoImageModels(payload: any): ImageModel[] {
  return (Array.isArray(payload?.data) ? payload.data : []).map((model: any): ImageModel | undefined => {
    const tasks = nanoImageTasks(model)
    const resolutions = model?.supported_parameters?.resolutions ?? model?.supported_parameters?.parameters?.size?.options?.map((option: any) => option?.value) ?? []
    const modelSizes = uniqueSizes(Array.isArray(resolutions) ? resolutions : [])
    if (!tasks.length || !modelSizes.length || (model.supported_parameters?.fixed_image_count && model.supported_parameters.fixed_image_count !== 1)) return
    const maxSourceImages = tasks.includes('image-to-image') ? Number(model?.capabilities?.max_input_images ?? model?.supported_parameters?.max_input_images) || 4 : undefined
    return { id: String(model.id), name: String(model.name || model.id), provider: 'nanogpt', source: 'https://docs.nano-gpt.com/api-reference/endpoint/image-models', sizes: modelSizes, tasks, maxSourceImages }
  }).filter((model: ImageModel | undefined): model is ImageModel => Boolean(model))
}
export function normalizeNanoVideoModels(payload: any): ImageModel[] {
  return (Array.isArray(payload?.data) ? payload.data : []).map((model: any): ImageModel | undefined => {
    const capabilities = model?.capabilities ?? {}
    const modalities = Array.isArray(model?.architecture?.input_modalities) ? model.architecture.input_modalities : []
    const tasks = [...(capabilities.text_to_video === true ? ['text-to-video' as const] : []), ...(capabilities.image_to_video === true || modalities.includes('image') ? ['image-to-video' as const] : [])]
    if (!tasks.length) return
    const parameters = model?.supported_parameters?.parameters ?? {}
    const options = (name: string) => Array.isArray(parameters[name]?.options) ? parameters[name].options.map((option: any) => String(option?.value ?? option)).filter(Boolean) : []
    const resolutions = options('resolution')
    const aspectRatios = options('aspect_ratio')
    const durations = options('duration').map(Number).filter(Number.isFinite)
    const sizes = resolutions.map((resolution: string) => resolution === '1080p' ? imageSize('1920x1080') : resolution === '720p' ? imageSize('1280x720') : imageSize('854x480')).filter(Boolean) as ImageSize[]
    return { id: String(model.id), name: String(model.name || model.id), description: typeof model.description === 'string' ? model.description : undefined, provider: 'nanogpt', source: 'https://docs.nano-gpt.com/api-reference/endpoint/video-models', sizes: sizes.length ? sizes : [imageSize('1280x720')!], tasks, maxSourceImages: tasks.includes('image-to-video') ? 1 : undefined, videoResolutions: resolutions.length ? resolutions : ['720p'], videoDurations: durations.length ? durations : undefined, aspectRatios: aspectRatios.length ? aspectRatios : ['16:9'] }
  }).filter((model: ImageModel | undefined): model is ImageModel => Boolean(model))
}
export async function fetchImageModels(provider: ImageProvider, key: string, fetcher = fetch): Promise<ImageModel[]> {
  if (provider === 'pruna') return documentedImageModels.filter((model) => model.provider === provider)
  if (provider === 'nanogpt') {
    const imagePromise = jsonResponse(await fetcher(`${NANO}/api/v1/image-models?detailed=true`, { credentials: 'omit', signal: AbortSignal.timeout(30000) }))
    const videoPromise = key ? fetcher(`${NANO}/api/v1/video-models?detailed=true`, { headers: { Authorization: `Bearer ${key}` }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30000) }).then((response) => jsonResponse(response, key)).catch(() => ({ data: [] })) : Promise.resolve({ data: [] })
    const [images, videos] = await Promise.all([imagePromise, videoPromise])
    return [...normalizeNanoImageModels(images), ...normalizeNanoVideoModels(videos)]
  }
  if (!key) return documentedImageModels.filter((model) => model.provider === provider)
  const data = await jsonResponse(await fetcher('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30000) }), key)
  const documented = documentedImageModels.filter((model) => model.provider === 'openai')
  return (data.data ?? []).filter((model: any) => /^gpt-image-/.test(model.id)).map((model: any) => documented.find((item) => item.id === model.id) ?? ({ id: model.id, name: model.id, provider, sizes: documented[0].sizes, tasks: ['text-to-image', 'image-to-image'], maxSourceImages: 4, source: documented[0].source }))
}
function deliveryUrl(value: string, provider: ImageProvider) {
  const url = new URL(value, provider === 'pruna' ? PRUNA : undefined)
  if (url.protocol !== 'https:' || url.username || url.password || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[)/i.test(url.hostname)) throw new Error('The provider returned an invalid media URL.')
  if (provider === 'pruna' && (url.origin !== PRUNA || !url.pathname.startsWith('/v1/predictions/delivery/'))) throw new Error('Pruna returned an unexpected delivery URL.')
  return url.href
}
async function boundedResponse(response: Response, kind: 'image' | 'video') {
  if (!response.ok) throw new Error(`The generated ${kind} could not be downloaded (${response.status}).`)
  const limit = kind === 'video' ? 200 * MB : 20 * MB
  const declared = Number(response.headers.get('content-length'))
  if (declared > limit) throw new Error(`Generated ${kind} exceeds the ${kind === 'video' ? 200 : 20} MB limit.`)
  const reader = response.body?.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let length = 0
  if (reader) {
    try { while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > limit) throw new Error(`Generated ${kind} exceeds the ${kind === 'video' ? 200 : 20} MB limit.`); chunks.push(value) } }
    finally { await reader.cancel().catch(() => undefined) }
  } else {
    const blob = await response.blob()
    if (blob.size > limit) throw new Error(`Generated ${kind} exceeds the ${kind === 'video' ? 200 : 20} MB limit.`)
    return blob
  }
  return new Blob(chunks, { type: response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream' })
}
function base64Blob(encoded: string, type: string, limit: number) {
  if (encoded.length > Math.ceil(limit * 4 / 3) + 16) throw new Error('Generated media exceeds the local size limit.')
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
  return new Blob([bytes], { type })
}
async function assertVideoFile(video: Blob) {
  if (!video.size || video.size > 200 * MB) throw new Error('Generated video is empty or exceeds the 200 MB limit.')
  const bytes = new Uint8Array(await video.slice(0, 12).arrayBuffer())
  const mp4 = bytes.length >= 8 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp'
  const webm = bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3
  if (!mp4 && !webm) throw new Error('The provider returned an unsupported video file.')
  return video.slice(0, video.size, mp4 ? 'video/mp4' : 'video/webm')
}
function outputUrl(data: any, kind: 'image' | 'video', provider: ImageProvider) {
  if (provider === 'pruna') return [data.generation_url, data.output].flat().find((value) => typeof value === 'string')
  if (kind === 'video') {
    const nested = data?.output && typeof data.output === 'object' ? data.output : {}
    return [data.url, data.video, typeof data.output === 'string' ? data.output : undefined, nested.video, nested.url].find((value) => typeof value === 'string')
  }
  return data.data?.[0]?.url
}
async function decodeOutput(data: any, provider: ImageProvider, key: string, signal: AbortSignal, fetcher: typeof fetch, kind: 'image' | 'video', staticCost?: number): Promise<ProviderResult> {
  const item = provider === 'pruna' ? data : data.data?.[0] ?? data
  let media: Blob
  const encoded = kind === 'image' ? item?.b64_json : item?.b64_json ?? item?.video_base64
  if (typeof encoded === 'string') media = base64Blob(encoded, kind === 'image' ? 'image/png' : 'video/mp4', kind === 'image' ? 20 * MB : 200 * MB)
  else {
    const rawUrl = outputUrl(data, kind, provider)
    if (typeof rawUrl !== 'string') throw new Error(`The provider returned no downloadable ${kind}.`)
    const url = deliveryUrl(rawUrl, provider)
    media = await boundedResponse(await fetcher(url, { headers: provider === 'pruna' ? { apikey: key } : provider === 'nanogpt' && kind === 'video' ? { 'x-api-key': key } : {}, signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: provider === 'pruna' ? 'error' : 'follow' }), kind)
  }
  if (kind === 'image') {
    await assertImageFile(media)
    const signature = new Uint8Array(await media.slice(0, 4).arrayBuffer())
    media = media.slice(0, media.size, signature[0] === 137 ? 'image/png' : signature[0] === 255 ? 'image/jpeg' : 'image/webp')
  } else media = await assertVideoFile(media)
  return { image: media, kind, ...(Number.isFinite(data.seed ?? item?.seed) ? { seed: data.seed ?? item.seed } : {}), ...(Number.isFinite(staticCost ?? data.cost) ? { cost: staticCost ?? data.cost } : {}), ...(typeof item?.revised_prompt === 'string' ? { revisedPrompt: item.revised_prompt } : {}) }
}
function dataUrl(source: GenerationSource) {
  return source.data.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
    return `data:${source.mime};base64,${btoa(binary)}`
  })
}
function extension(mime: string) { return mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png' }
async function uploadPrunaSource(source: GenerationSource, key: string, signal: AbortSignal, fetcher: typeof fetch) {
  const form = new FormData()
  form.append('content', source.data, `${source.name || source.id}.${extension(source.mime)}`)
  const data = await jsonResponse(await fetcher(`${PRUNA}/v1/files`, { method: 'POST', headers: { apikey: key }, body: form, credentials: 'omit', redirect: 'error', signal }), key)
  const value = data?.urls?.get ?? data?.url ?? (data?.id ? `${PRUNA}/v1/files/${encodeURIComponent(data.id)}` : '')
  if (typeof value !== 'string' || !value) throw new Error('Pruna file upload returned no URL.')
  const url = new URL(value, PRUNA)
  if (url.origin !== PRUNA || !url.pathname.startsWith('/v1/files/')) throw new Error('Pruna returned an unexpected uploaded-file URL.')
  return url.href
}
const SUCCESS = ['succeeded', 'success', 'completed', 'complete']
const FAILURE = ['failed', 'error', 'canceled', 'cancelled']
function status(data: any) { return typeof data?.status === 'string' ? data.status.toLowerCase() : '' }
async function openAI(job: ImageJob, key: string, signal: AbortSignal, fetcher: typeof fetch) {
  if (generationTask(job) === 'image-to-image') {
    const form = new FormData()
    form.append('model', job.model); form.append('prompt', job.prompt); form.append('n', '1'); form.append('size', job.size.value); form.append('output_format', 'png'); form.append('quality', job.quality ?? 'low'); form.append('moderation', job.moderation ?? 'low')
    for (const source of job.sources ?? []) form.append('image[]', source.data, `${source.name || source.id}.${extension(source.mime)}`)
    return jsonResponse(await fetcher('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, credentials: 'omit', redirect: 'error', signal }), key)
  }
  return jsonResponse(await fetcher('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, credentials: 'omit', redirect: 'error', signal, body: JSON.stringify({ model: job.model, prompt: job.prompt, size: job.size.value, n: 1, output_format: 'png', quality: job.quality ?? 'low', moderation: job.moderation ?? 'low' }) }), key)
}
async function nano(job: ImageJob, key: string, signal: AbortSignal, onSubmitted: (id: string) => Promise<void>, fetcher: typeof fetch, pause: (ms: number) => Promise<void>) {
  const task = generationTask(job)
  if (!task.endsWith('video')) {
    const urls = await Promise.all((job.sources ?? []).map(dataUrl))
    return jsonResponse(await fetcher(`${NANO}/v1/images/generations`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, credentials: 'omit', redirect: 'error', signal, body: JSON.stringify({ model: job.model, prompt: job.prompt, size: job.size.value, n: 1, response_format: 'b64_json', ...(urls.length === 1 ? { imageDataUrl: urls[0] } : urls.length ? { imageDataUrls: urls } : {}) }) }), key)
  }
  let id = job.providerJobId
  if (!id) {
    const source = job.sources?.[0] ? await dataUrl(job.sources[0]) : undefined
    const request = await jsonResponse(await fetcher(`${NANO}/api/generate-video`, { method: 'POST', headers: { 'x-api-key': key, 'Content-Type': 'application/json' }, credentials: 'omit', redirect: 'error', signal, body: JSON.stringify({ model: job.model, prompt: job.prompt, ...(source ? { imageDataUrl: source } : {}), ...(job.video?.resolution ? { resolution: job.video.resolution } : {}), ...(job.video?.duration ? { duration: String(job.video.duration) } : {}), ...(job.video?.aspectRatio ? { aspect_ratio: job.video.aspectRatio } : {}), ...(job.video?.seed !== undefined ? { seed: job.video.seed } : {}) }) }), key)
    id = [request.requestId, request.runId, request.id].find((value) => typeof value === 'string' && value)
    if (!id) throw new Error('NanoGPT returned no video job ID. Check the provider before retrying.')
    await onSubmitted(id)
  }
  while (true) {
    signal.throwIfAborted()
    const data = await jsonResponse(await fetcher(`${NANO}/api/video/status?requestId=${encodeURIComponent(id)}`, { headers: { 'x-api-key': key }, credentials: 'omit', redirect: 'error', signal }), key)
    const state = status(data)
    if (SUCCESS.includes(state)) return data
    if (FAILURE.includes(state)) throw new Error(providerError(data, 'NanoGPT video generation failed.'))
    await pause(3000)
  }
}
function prunaInput(job: ImageJob, uploaded: string[]) {
  const task = generationTask(job), ratio = job.video?.aspectRatio ?? imageRatio(job.size), seed = job.video?.seed
  if (job.model === 'p-image-edit') return { prompt: job.prompt, images: uploaded, aspect_ratio: ratio, turbo: true, disable_safety_checker: true, ...(seed !== undefined ? { seed } : {}) }
  if (job.model === 'qwen-image-edit-plus') return { prompt: job.prompt, image: uploaded, aspect_ratio: ratio, go_fast: true, output_format: 'webp', output_quality: 95, disable_safety_checker: true, ...(seed !== undefined ? { seed } : {}) }
  if (job.model === 'wan-i2v') return { prompt: job.prompt, image: uploaded[0], resolution: job.video?.resolution ?? '480p', num_frames: job.video?.numFrames ?? 81, frames_per_second: job.video?.fps ?? 16, go_fast: true, ...(seed !== undefined ? { seed } : {}) }
  if (job.model === 'p-video') return { prompt: job.prompt, ...(uploaded[0] ? { image: uploaded[0] } : {}), resolution: job.video?.resolution ?? '720p', duration: job.video?.duration ?? 5, fps: job.video?.fps ?? 24, aspect_ratio: ratio, draft: job.video?.draft ?? false, ...(seed !== undefined ? { seed } : {}) }
  if (job.model === 'wan-t2v') return { prompt: job.prompt, resolution: job.video?.resolution ?? '480p', num_frames: job.video?.numFrames ?? 81, frames_per_second: job.video?.fps ?? 16, aspect_ratio: ratio, ...(seed !== undefined ? { seed } : {}) }
  const model = prunaImageModels.find((candidate) => candidate.id === job.model)
  if (!model || !modelTasks(model).includes(task)) throw new Error(`Unsupported Pruna task or model: ${task}/${job.model}`)
  return model.sizeMode === 'dimensions' ? { prompt: job.prompt, width: job.size.width, height: job.size.height } : { prompt: job.prompt, aspect_ratio: imageRatio(job.size) }
}
async function pruna(job: ImageJob, key: string, signal: AbortSignal, onSubmitted: (id: string) => Promise<void>, fetcher: typeof fetch, pause: (ms: number) => Promise<void>) {
  const model = prunaImageModels.find((candidate) => candidate.id === job.model)
  if (!model || !modelTasks(model).includes(generationTask(job))) throw new Error(`Unsupported Pruna task or model: ${generationTask(job)}/${job.model}`)
  let id = job.providerJobId
  if (!id) {
    const uploaded = await Promise.all((job.sources ?? []).map((source) => uploadPrunaSource(source, key, signal, fetcher)))
    const data = await jsonResponse(await fetcher(`${PRUNA}/v1/predictions`, { method: 'POST', headers: { apikey: key, Model: model.id, 'Try-Sync': 'true', 'Content-Type': 'application/json' }, credentials: 'omit', redirect: 'error', signal, body: JSON.stringify({ input: prunaInput(job, uploaded) }) }), key)
    const state = status(data)
    if (SUCCESS.includes(state)) return data
    if (FAILURE.includes(state)) throw new Error(safeImageError(new Error(providerError(data, 'Pruna generation failed.')), key))
    if (typeof data.id !== 'string' || !data.id || data.id.length > 200) throw new Error('Pruna returned no job ID. Check the provider before retrying.')
    const submittedId = data.id as string
    id = submittedId
    await onSubmitted(submittedId)
  }
  if (!id) throw new Error('Pruna returned no job ID. Check the provider before retrying.')
  while (true) {
    signal.throwIfAborted()
    const data = await jsonResponse(await fetcher(`${PRUNA}/v1/predictions/status/${encodeURIComponent(id)}`, { headers: { apikey: key }, signal, credentials: 'omit', redirect: 'error' }), key)
    const state = status(data)
    if (SUCCESS.includes(state)) return data
    if (FAILURE.includes(state)) throw new Error(safeImageError(new Error(providerError(data, 'Pruna generation failed.')), key))
    await pause(2000)
  }
}
export async function generateProviderImage(job: ImageJob, key: string, signal: AbortSignal, onSubmitted: (id: string) => Promise<void>, fetcher = fetch, pause = (ms: number) => new Promise<void>((resolve, reject) => {
  const abort = () => { clearTimeout(timer); reject(new DOMException('Stopped', 'AbortError')) }
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
  if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true })
})): Promise<ProviderResult> {
  if (!key.trim()) throw new Error(`Add a ${job.provider} media key or configure its AI-settings key first.`)
  signal.throwIfAborted()
  const kind = outputKind(job)
  if (job.provider === 'openai') {
    if (kind === 'video') throw new Error('OpenAI video generation is not configured in this product.')
    return decodeOutput(await openAI(job, key, signal, fetcher), 'openai', key, signal, fetcher, 'image')
  }
  if (job.provider === 'nanogpt') return decodeOutput(await nano(job, key, signal, onSubmitted, fetcher, pause), 'nanogpt', key, signal, fetcher, kind)
  const model = prunaImageModels.find((candidate) => candidate.id === job.model)
  return decodeOutput(await pruna(job, key, signal, onSubmitted, fetcher, pause), 'pruna', key, signal, fetcher, kind, model?.cost)
}
async function prepareVideo(video: Blob) {
  const url = URL.createObjectURL(video)
  try {
    const element = document.createElement('video')
    element.preload = 'metadata'; element.muted = true; element.playsInline = true; element.src = url
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Timed out reading generated video metadata.')), 15000); element.onloadedmetadata = () => { clearTimeout(timer); resolve() }; element.onerror = () => { clearTimeout(timer); reject(new Error('The generated video could not be decoded.')) } })
    const width = element.videoWidth, height = element.videoHeight
    if (!width || !height || width * height > 40_000_000) throw new Error('Generated video has invalid dimensions.')
    element.currentTime = Math.min(0.1, Number.isFinite(element.duration) ? element.duration / 2 : 0.1)
    await new Promise<void>((resolve) => { const timer = setTimeout(resolve, 3000); element.onseeked = () => { clearTimeout(timer); resolve() } })
    const scale = Math.min(1, 640 / width, 640 / height), canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale))
    canvas.getContext('2d')?.drawImage(element, 0, 0, canvas.width, canvas.height)
    const thumbnail = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not create a video poster.')), 'image/jpeg', 0.82))
    return { width, height, mediaDurationMs: Number.isFinite(element.duration) ? Math.round(element.duration * 1000) : undefined, thumbnail }
  } finally { URL.revokeObjectURL(url) }
}
export async function prepareGeneratedImage(output: ProviderResult): Promise<ImageOutput> {
  if (output.kind === 'video') return { ...output, ...(await prepareVideo(output.image)), kind: 'video' }
  const bitmap = await createImageBitmap(output.image)
  try {
    if (bitmap.width * bitmap.height > 40_000_000) throw new Error('Generated image exceeds 40 megapixels.')
    return { ...output, kind: 'image', width: bitmap.width, height: bitmap.height, thumbnail: await makeThumbnail(output.image) }
  } finally { bitmap.close() }
}

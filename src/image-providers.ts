import { documentedImageModels, imageRatio, imageSize, prunaImageModels } from './image-settings'
import type { ImageJob, ImageModel, ImageProvider, ImageSize } from './image-generation-types'
import { assertImageFile, makeThumbnail } from './illustration-image'
export type ImageOutput = { image: Blob; thumbnail: Blob; width: number; height: number; seed?: number; cost?: number; revisedPrompt?: string }
export type ProviderResult = { image: Blob; seed?: number; cost?: number; revisedPrompt?: string }
const PRUNA = 'https://api.pruna.ai'
export function safeImageError(error: unknown, key = '') {
  const text = error instanceof Error ? error.message : 'Image generation failed.'
  return (key ? text.split(key).join('[redacted]') : text).slice(0, 1000)
}
function providerError(data: any, fallback: string) {
  const value = data?.error ?? data?.detail ?? data?.message
  if (typeof value === 'string') return value
  if (typeof value?.message === 'string') return value.message
  if (value != null) try { return JSON.stringify(value) } catch { /* Use the fallback below. */ }
  return fallback
}
async function jsonResponse(response: Response, key = '') {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(safeImageError(new Error(`Image provider (${response.status}): ${providerError(data, response.statusText)}`), key))
  return data
}
export function normalizeNanoImageModels(payload: any): ImageModel[] {
  return (Array.isArray(payload?.data) ? payload.data : []).filter((m: any) => m?.capabilities?.image_generation === true && (!m.supported_parameters?.fixed_image_count || m.supported_parameters.fixed_image_count === 1)).map((m: any): ImageModel => ({
    id: String(m.id), name: String(m.name || m.id), provider: 'nanogpt', source: 'https://docs.nano-gpt.com/api-reference/endpoint/image-models',
    sizes: [...new Map((Array.isArray(m.supported_parameters?.resolutions) ? m.supported_parameters.resolutions : []).map((v: unknown) => typeof v === 'string' ? imageSize(v) : undefined).filter(Boolean).map((s: ImageSize) => [s.value, s])).values()] as ImageSize[],
  })).filter((m: ImageModel) => m.sizes.length)
}
export async function fetchImageModels(provider: ImageProvider, key: string, fetcher = fetch): Promise<ImageModel[]> {
  if (provider === 'pruna') return documentedImageModels.filter((m) => m.provider === provider)
  if (provider === 'nanogpt') return normalizeNanoImageModels(await jsonResponse(await fetcher('https://nano-gpt.com/api/v1/image-models?detailed=true', { credentials: 'omit', signal: AbortSignal.timeout(30000) })))
  if (!key) return documentedImageModels.filter((m) => m.provider === provider)
  const data = await jsonResponse(await fetcher('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30000) }), key)
  return (data.data ?? []).filter((m: any) => /^gpt-image-/.test(m.id)).map((m: any) => ({ id: m.id, name: m.id, provider, sizes: documentedImageModels[0].sizes, source: documentedImageModels[0].source }))
}
function deliveryUrl(value: string, provider: ImageProvider) {
  const url = new URL(value, provider === 'pruna' ? PRUNA : undefined)
  if (url.protocol !== 'https:' || url.username || url.password || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[)/i.test(url.hostname)) throw new Error('The provider returned an invalid image URL.')
  if (provider === 'pruna' && (url.origin !== PRUNA || !url.pathname.startsWith('/v1/predictions/delivery/'))) throw new Error('Pruna returned an unexpected delivery URL.')
  return url.href
}
async function imageResponse(response: Response) {
  if (!response.ok) throw new Error(`The generated image could not be downloaded (${response.status}).`)
  const declared = Number(response.headers.get('content-length'))
  if (declared > 20 * 1024 * 1024) throw new Error('Generated image exceeds the 20 MB limit.')
  const reader = response.body?.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let length = 0
  if (reader) {
    try { while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > 20 * 1024 * 1024) throw new Error('Generated image exceeds the 20 MB limit.'); chunks.push(value) } }
    finally { await reader.cancel().catch(() => undefined) }
  }
  return new Blob(chunks, { type: response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream' })
}
async function decodeOutput(data: any, provider: ImageProvider, key: string, signal: AbortSignal, fetcher: typeof fetch, staticCost?: number): Promise<ProviderResult> {
  const prunaOutput = [data.generation_url, data.output].flat().find((value) => typeof value === 'string')
  const item = provider === 'pruna' ? { url: prunaOutput } : data.data?.[0]
  if (!item) throw new Error('The provider returned no image.')
  let image: Blob
  if (typeof item.b64_json === 'string') {
    if (item.b64_json.length > 28_000_000) throw new Error('Generated image exceeds the 20 MB limit.')
    const bytes = Uint8Array.from(atob(item.b64_json), (c) => c.charCodeAt(0))
    image = new Blob([bytes], { type: 'image/png' })
  } else if (typeof item.url === 'string') {
    const url = deliveryUrl(item.url, provider)
    image = await imageResponse(await fetcher(url, { headers: provider === 'pruna' ? { apikey: key } : {}, signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: provider === 'pruna' ? 'error' : 'follow' }))
  } else throw new Error('The provider returned no downloadable image.')
  await assertImageFile(image)
  const signature = new Uint8Array(await image.slice(0, 4).arrayBuffer())
  image = image.slice(0, image.size, signature[0] === 137 ? 'image/png' : signature[0] === 255 ? 'image/jpeg' : 'image/webp')
  return { image, ...(Number.isFinite(data.seed ?? item.seed) ? { seed: data.seed ?? item.seed } : {}), ...(Number.isFinite(staticCost ?? data.cost) ? { cost: staticCost ?? data.cost } : {}), ...(typeof item.revised_prompt === 'string' ? { revisedPrompt: item.revised_prompt } : {}) }
}
const PRUNA_SUCCESS = ['succeeded', 'success', 'completed', 'complete']
const PRUNA_FAILURE = ['failed', 'canceled', 'cancelled']
function prunaStatus(data: any) { return typeof data?.status === 'string' ? data.status.toLowerCase() : '' }
export async function generateProviderImage(job: ImageJob, key: string, signal: AbortSignal, onSubmitted: (id: string) => Promise<void>, fetcher = fetch, pause = (ms: number) => new Promise<void>((resolve, reject) => {
  const abort = () => { clearTimeout(timer); reject(new DOMException('Stopped', 'AbortError')) }
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
  if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true })
})): Promise<ProviderResult> {
  if (!key.trim()) throw new Error(`Add a ${job.provider} image key or configure its AI-settings key first.`)
  signal.throwIfAborted()
  if (job.provider !== 'pruna') {
    const url = job.provider === 'nanogpt' ? 'https://nano-gpt.com/v1/images/generations' : 'https://api.openai.com/v1/images/generations'
    const data = await jsonResponse(await fetcher(url, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, credentials: 'omit', redirect: 'error', signal,
      body: JSON.stringify({ model: job.model, prompt: job.prompt, size: job.size.value, n: 1, ...(job.provider === 'nanogpt' ? { response_format: 'b64_json' } : { output_format: 'png', quality: job.quality ?? 'low', moderation: job.moderation ?? 'low' }) }),
    }), key)
    return decodeOutput(data, job.provider, key, signal, fetcher)
  }
  const model = prunaImageModels.find((candidate) => candidate.id === job.model)
  if (!model) throw new Error(`Unsupported Pruna image model: ${job.model}`)
  const ratio = imageRatio(job.size)
  const input = model.sizeMode === 'dimensions'
    ? model.sizes.some((size) => size.width === job.size.width && size.height === job.size.height)
      ? { prompt: job.prompt, width: job.size.width, height: job.size.height }
      : undefined
    : model.ratios?.includes(ratio)
      ? { prompt: job.prompt, aspect_ratio: ratio }
      : undefined
  if (!input) throw new Error(`Size ${job.size.value} is not supported by Pruna model ${model.id}.`)
  let id = job.providerJobId
  if (!id) {
    const data = await jsonResponse(await fetcher(`${PRUNA}/v1/predictions`, { method: 'POST', headers: { apikey: key, Model: model.id, 'Try-Sync': 'true', 'Content-Type': 'application/json' }, credentials: 'omit', redirect: 'error', signal,
      body: JSON.stringify({ input }),
    }), key)
    const status = prunaStatus(data)
    if (PRUNA_SUCCESS.includes(status)) return decodeOutput(data, 'pruna', key, signal, fetcher, model.cost)
    if (PRUNA_FAILURE.includes(status)) throw new Error(safeImageError(new Error(providerError(data, 'Pruna generation failed.')), key))
    if (typeof data.id !== 'string' || !data.id || data.id.length > 200) throw new Error('Pruna returned no job ID. Check the provider before retrying.')
    id = data.id as string
    await onSubmitted(id)
  }
  while (true) {
    signal.throwIfAborted()
    const data = await jsonResponse(await fetcher(`${PRUNA}/v1/predictions/status/${encodeURIComponent(id)}`, { headers: { apikey: key }, signal, credentials: 'omit', redirect: 'error' }), key)
    const status = prunaStatus(data)
    if (PRUNA_SUCCESS.includes(status)) return decodeOutput(data, 'pruna', key, signal, fetcher, model.cost)
    if (PRUNA_FAILURE.includes(status)) throw new Error(safeImageError(new Error(providerError(data, 'Pruna generation failed.')), key))
    await pause(1500)
  }
}
export async function prepareGeneratedImage(output: ProviderResult): Promise<ImageOutput> {
  const bitmap = await createImageBitmap(output.image)
  try {
    if (bitmap.width * bitmap.height > 40_000_000) throw new Error('Generated image exceeds 40 megapixels.')
    return { ...output, width: bitmap.width, height: bitmap.height, thumbnail: await makeThumbnail(output.image) }
  } finally { bitmap.close() }
}

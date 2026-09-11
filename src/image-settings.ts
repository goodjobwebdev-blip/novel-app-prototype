import { loadAiSettings, type AiSettings } from './ai-settings'
import { generationTask, modelTasks, type FavoriteImageModel, type GenerationSource, type GenerationTask, type ImageGenerationSpec, type ImageModel, type ImageProvider, type ImageSettings, type ImageSize, type VideoGenerationOptions } from './image-generation-types'
export const IMAGE_SETTINGS_KEY = 'arc-image-settings-v1'
export const IMAGE_SETTINGS_CHANGED = 'arc-image-settings-changed'
export const IMAGE_PROVIDERS: ImageProvider[] = ['nanogpt', 'pruna', 'openai']
export const imageProviderNames = { nanogpt: 'NanoGPT', pruna: 'Pruna', openai: 'OpenAI' }
export const generationTaskNames: Record<GenerationTask, string> = {
  'text-to-image': 'Text to image',
  'image-to-image': 'Image to image',
  'text-to-video': 'Text to video',
  'image-to-video': 'Image to video',
}
export function imageRatio(size: Pick<ImageSize, 'width' | 'height'>) {
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a
  const divisor = gcd(size.width, size.height)
  return `${size.width / divisor}:${size.height / divisor}`
}
export function imageSize(value: string): ImageSize | undefined {
  const match = /^(\d{2,5})[x*×](\d{2,5})$/.exec(value.trim())
  if (!match) return
  const width = Number(match[1]), height = Number(match[2])
  if (width < 64 || height < 64 || width * height > 40_000_000) return
  return { value: `${width}x${height}`, width, height }
}
const sizes = (...values: string[]) => values.map((value) => imageSize(value)!)
const PRUNA_SIZES = {
  '1:1': '1024x1024', '16:9': '1344x768', '9:16': '768x1344', '21:9': '1536x672', '9:21': '672x1536',
  '3:2': '1216x832', '2:3': '832x1216', '4:5': '896x1120', '5:4': '1120x896', '3:4': '896x1152', '4:3': '1152x896',
} as const
export type PrunaImageModel = ImageModel & { sizeMode: 'aspect_ratio' | 'dimensions' | 'video'; ratios?: string[] }
const prunaModel = (id: string, name: string, cost: number, ratios: (keyof typeof PRUNA_SIZES)[], description: string, sizeMode: PrunaImageModel['sizeMode'] = 'aspect_ratio', tasks: GenerationTask[] = ['text-to-image'], extra: Partial<ImageModel> = {}): PrunaImageModel => ({
  id, name, provider: 'pruna', cost, description, sizeMode, tasks, ratios: sizeMode === 'aspect_ratio' ? ratios : undefined,
  sizes: sizes(...ratios.map((ratio) => PRUNA_SIZES[ratio])), source: `https://docs.api.pruna.ai/guides/models/${id}`, ...extra,
})
export const prunaImageModels: PrunaImageModel[] = [
  prunaModel('flux-dev', 'FLUX.1 Dev', 0.005, ['1:1', '16:9', '21:9', '3:2', '2:3', '4:5', '5:4', '3:4', '4:3', '9:16', '9:21'], 'High-quality FLUX text-to-image generation.'),
  prunaModel('qwen-image', 'Qwen-Image', 0.025, ['16:9', '1:1', '9:16', '4:3', '3:4', '3:2', '2:3'], 'Qwen text-to-image generation.'),
  prunaModel('qwen-image-fast', 'Qwen-Image (fast)', 0.005, ['16:9', '1:1', '9:16', '4:3', '3:4', '3:2', '2:3'], 'Faster Qwen text-to-image generation.'),
  prunaModel('z-image-turbo', 'Z-Image Turbo', 0.005, ['1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '21:9', '9:21'], 'Fast text-to-image generation with explicit dimensions.', 'dimensions'),
  prunaModel('flux-2-klein-4b', 'FLUX.2 Klein 4B', 0.0001, ['1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '21:9', '9:21'], 'Low-cost FLUX.2 Klein text-to-image generation.'),
  prunaModel('wan-image-small', 'WAN Image (small)', 0.005, ['16:9', '1:1', '9:16', '4:3', '3:4', '21:9'], 'Small WAN text-to-image model.'),
  prunaModel('p-image', 'P-Image', 0.005, ['16:9', '1:1', '9:16', '4:3', '3:4', '3:2', '2:3'], 'Pruna’s P-Image text-to-image model.'),
  prunaModel('p-image-edit', 'P-Image Edit', 0.025, ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'], 'Edit or restyle an image using up to four ordered references.', 'aspect_ratio', ['image-to-image'], { maxSourceImages: 4 }),
  prunaModel('qwen-image-edit-plus', 'Qwen Image Edit Plus', 0.025, ['1:1', '16:9', '9:16', '4:3', '3:4'], 'Reference-guided image editing with up to three images.', 'aspect_ratio', ['image-to-image'], { maxSourceImages: 3 }),
  prunaModel('wan-i2v', 'WAN Image to Video', 0.05, ['16:9'], 'Animate one source image.', 'video', ['image-to-video'], { maxSourceImages: 1, videoResolutions: ['480p', '720p'], aspectRatios: ['16:9', '9:16'] }),
  prunaModel('p-video', 'P-Video', 0.10, ['16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '1:1'], 'Generate video from text or animate one image.', 'video', ['text-to-video', 'image-to-video'], { maxSourceImages: 1, videoResolutions: ['720p', '1080p'], videoDurations: [5, 10, 15, 20], aspectRatios: ['16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '1:1'] }),
  prunaModel('wan-t2v', 'WAN Text to Video', 0.05, ['16:9', '9:16'], 'Generate a short video from a text prompt.', 'video', ['text-to-video'], { videoResolutions: ['480p', '720p'], aspectRatios: ['16:9', '9:16'] }),
]
const openAISizes = sizes('1024x1024', '1536x1024', '1024x1536')
export const documentedImageModels: ImageModel[] = [
  ...['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare'].map((id): ImageModel => ({ id, name: id, provider: 'openai', sizes: openAISizes, tasks: ['text-to-image', 'image-to-image'], maxSourceImages: 4, source: 'https://platform.openai.com/docs/guides/images/image-generation', description: id.endsWith('sunburst') ? 'Highest editing precision and image quality.' : 'Fast, high-quality everyday image generation.' })),
  ...['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini'].map((id): ImageModel => ({ id, name: id, provider: 'openai', sizes: openAISizes, tasks: ['text-to-image', 'image-to-image'], maxSourceImages: 4, source: 'https://platform.openai.com/docs/guides/images/image-generation' })),
  ...prunaImageModels,
]
function normalizedTasks(model: ImageModel) { return modelTasks(model).filter((task, index, all) => all.indexOf(task) === index) }
export function loadImageSettings(): ImageSettings {
  const empty: ImageSettings = { keys: { nanogpt: '', openai: '', pruna: '' }, favorites: [], defaultAlias: '', defaultAliases: {} }
  try {
    const parsed = JSON.parse(localStorage.getItem(IMAGE_SETTINGS_KEY) || 'null')
    if (!parsed) return empty
    return validateImageSettings({ ...empty, ...parsed, keys: { ...empty.keys, ...parsed.keys }, defaultAliases: { ...empty.defaultAliases, ...parsed.defaultAliases } })
  } catch { return empty }
}
export function validateImageSettings(settings: ImageSettings): ImageSettings {
  const aliases = new Set<string>()
  if (!Array.isArray(settings.favorites) || settings.favorites.length > 80) throw new Error('Choose up to 80 favorite media models.')
  const favorites = settings.favorites.map((favorite) => {
    const alias = String(favorite.alias ?? '').trim()
    if (!alias || alias.length > 64 || aliases.has(alias.toLowerCase())) throw new Error('Give every favorite a unique alias, up to 64 characters.')
    aliases.add(alias.toLowerCase())
    if (!IMAGE_PROVIDERS.includes(favorite.provider) || !favorite.id?.trim() || !Array.isArray(favorite.sizes)) throw new Error('Choose a supported generation model.')
    const validSizes = favorite.sizes.map((size) => imageSize(size.value)).filter((size): size is ImageSize => Boolean(size))
    const enabled = [...new Set(favorite.enabledSizes ?? [])].filter((size) => validSizes.some((valid) => valid.value === size))
    if (!enabled.length || !enabled.includes(favorite.defaultSize)) throw new Error(`Enable at least one size and a valid default for ${alias}.`)
    const tasks = normalizedTasks(favorite)
    if (!tasks.length) throw new Error(`Choose at least one supported task for ${alias}.`)
    const base = { ...favorite, alias, tasks, sizes: validSizes, enabledSizes: enabled, maxSourceImages: Math.max(0, Math.min(10, Number(favorite.maxSourceImages) || 0)) || undefined }
    if (favorite.provider === 'openai') {
      const modern = /^gpt-image-2\.5-/.test(favorite.id)
      const quality = favorite.quality ?? (modern ? 'auto' : 'low'), moderation = favorite.moderation ?? 'low'
      if (!(modern ? ['low', 'medium', 'high', 'xhigh', 'max', 'auto'] : ['low', 'medium', 'high', 'auto']).includes(quality)) throw new Error(`Choose a valid image quality for ${alias}.`)
      if (!['low', 'auto'].includes(moderation)) throw new Error(`Choose a valid image moderation level for ${alias}.`)
      return { ...base, quality, moderation }
    }
    return base
  })
  const defaultAlias = favorites.some((favorite) => favorite.alias === settings.defaultAlias) ? settings.defaultAlias : favorites[0]?.alias || ''
  const defaultAliases = Object.fromEntries((Object.keys(generationTaskNames) as GenerationTask[]).flatMap((task) => {
    const requested = settings.defaultAliases?.[task]
    const match = favorites.find((favorite) => favorite.alias === requested && modelTasks(favorite).includes(task)) ?? favorites.find((favorite) => modelTasks(favorite).includes(task))
    return match ? [[task, match.alias]] : []
  }))
  return { keys: Object.fromEntries(IMAGE_PROVIDERS.map((provider) => [provider, String(settings.keys[provider] || '').trim()])) as ImageSettings['keys'], favorites, defaultAlias, defaultAliases }
}
export function saveImageSettings(settings: ImageSettings) {
  const clean = validateImageSettings(settings)
  localStorage.setItem(IMAGE_SETTINGS_KEY, JSON.stringify(clean))
  window.dispatchEvent(new Event(IMAGE_SETTINGS_CHANGED))
  return clean
}
export function resolveImageKey(provider: ImageProvider, settings = loadImageSettings(), ai: AiSettings = loadAiSettings()): string {
  if (settings.keys[provider]) return settings.keys[provider]
  if (provider === 'pruna') return ''
  const key = ai.provider === provider ? ai.apiKey : ai.providerProfiles?.[provider]?.apiKey
  if (key?.trim()) return key.trim()
  const global = loadAiSettings()
  return (global.provider === provider ? global.apiKey : global.providerProfiles?.[provider]?.apiKey)?.trim() || ''
}
export function resolveImageSpec(prompt: string, alias?: string, size?: string, ratio?: string, settings = loadImageSettings(), task: GenerationTask = 'text-to-image', sources: GenerationSource[] = [], video: VideoGenerationOptions = {}): ImageGenerationSpec {
  if (!prompt?.trim() || prompt.length > 32000) throw new Error('Enter a generation prompt of 1–32,000 characters.')
  const selected = alias || settings.defaultAliases?.[task] || settings.defaultAlias
  const model = settings.favorites.find((favorite) => favorite.alias.toLowerCase() === selected.toLowerCase())
  if (!model) throw new Error('Choose a favorite generation model in Images settings first.')
  if (!modelTasks(model).includes(task)) throw new Error(`${model.alias} does not support ${generationTaskNames[task].toLowerCase()}.`)
  const needsSource = task === 'image-to-image' || task === 'image-to-video'
  if (needsSource && !sources.length) throw new Error(`${generationTaskNames[task]} requires a source image.`)
  if (!needsSource && sources.length) throw new Error(`${generationTaskNames[task]} does not accept a source image.`)
  if (sources.length > (model.maxSourceImages ?? 0)) throw new Error(`${model.alias} accepts up to ${model.maxSourceImages ?? 0} source images.`)
  const enabled = model.sizes.filter((candidate) => model.enabledSizes.includes(candidate.value))
  const explicit = size ? imageSize(size)?.value : undefined
  if (size && !explicit) throw new Error('Use a size such as 1024x1024.')
  const chosen = explicit ? enabled.find((candidate) => candidate.value === explicit) : ratio ? enabled.find((candidate) => imageRatio(candidate) === ratio) : enabled.find((candidate) => candidate.value === model.defaultSize)
  if (!chosen || (ratio && imageRatio(chosen) !== ratio)) throw new Error('That size or ratio is not enabled for the selected model.')
  const isVideo = task.endsWith('video')
  const cleanVideo: VideoGenerationOptions | undefined = isVideo ? {
    resolution: model.videoResolutions?.includes(video.resolution ?? '') ? video.resolution : model.videoResolutions?.[0],
    duration: model.videoDurations?.includes(video.duration ?? -1) ? video.duration : model.videoDurations?.[0] ?? 5,
    aspectRatio: model.aspectRatios?.includes(video.aspectRatio ?? '') ? video.aspectRatio : model.aspectRatios?.[0] ?? imageRatio(chosen),
    ...(Number.isFinite(video.fps) ? { fps: Math.round(video.fps!) } : {}),
    ...(Number.isFinite(video.numFrames) ? { numFrames: Math.round(video.numFrames!) } : {}),
    ...(Number.isFinite(video.seed) ? { seed: Math.round(video.seed!) } : {}),
    ...(video.draft !== undefined ? { draft: Boolean(video.draft) } : {}),
  } : undefined
  return { prompt: prompt.trim(), modelAlias: model.alias, provider: model.provider, model: model.id, size: { ...chosen }, task, sources: sources.map((source) => ({ ...source })), ...(cleanVideo ? { video: cleanVideo } : {}), ...(model.provider === 'openai' ? { quality: model.quality ?? (/^gpt-image-2\.5-/.test(model.id) ? 'auto' : 'low'), moderation: model.moderation ?? 'low' } : {}) }
}
export function imageFavorite(model: ImageModel, used: FavoriteImageModel[]): FavoriteImageModel {
  const base = `${model.provider}/${model.id}`.slice(0, 58)
  let alias = base, suffix = 2
  while (used.some((favorite) => favorite.alias.toLowerCase() === alias.toLowerCase())) alias = `${base}-${suffix++}`
  const defaultSize = model.sizes.find((size) => size.value === '1024x1024')?.value ?? model.sizes[0]?.value ?? ''
  return { ...model, tasks: normalizedTasks(model), alias, enabledSizes: model.sizes.map((size) => size.value), defaultSize, ...(model.provider === 'openai' ? { quality: /^gpt-image-2\.5-/.test(model.id) ? 'auto' : 'low', moderation: 'low' } : {}) }
}
export function imageModelInstructions() {
  const settings = loadImageSettings()
  return `\n\nVisual generation proposals never contact a provider or incur a charge. The user must accept a proposal and press Generate. Use only configured favorite aliases and supported tasks. If none exist, ask the user to configure Images settings. Favorites: ${JSON.stringify(settings.favorites.map((favorite) => ({ alias: favorite.alias, tasks: modelTasks(favorite), maxSourceImages: favorite.maxSourceImages ?? 0, sizes: favorite.sizes.filter((size) => favorite.enabledSizes.includes(size.value)).map((size) => ({ size: size.value, ratio: imageRatio(size) })), defaultSize: favorite.defaultSize })))} `
}
export { generationTask }

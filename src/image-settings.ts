import { loadAiSettings, type AiSettings } from './ai-settings'
import type { FavoriteImageModel, ImageGenerationSpec, ImageModel, ImageProvider, ImageSettings, ImageSize } from './image-generation-types'
export const IMAGE_SETTINGS_KEY = 'arc-image-settings-v1'
export const IMAGE_SETTINGS_CHANGED = 'arc-image-settings-changed'
export const IMAGE_PROVIDERS: ImageProvider[] = ['nanogpt', 'pruna', 'openai']
export const imageProviderNames = { nanogpt: 'NanoGPT', pruna: 'Pruna', openai: 'OpenAI' }
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
const sizes = (...values: string[]) => values.map((v) => imageSize(v)!)
export const documentedImageModels: ImageModel[] = [
  ...['gpt-image-1', 'gpt-image-1-mini', 'gpt-image-1.5', 'gpt-image-2'].map((id): ImageModel => ({ id, name: id, provider: 'openai', sizes: sizes('1024x1024', '1536x1024', '1024x1536'), source: 'https://developers.openai.com/api/docs/guides/image-generation' })),
  { id: 'p-image', name: 'P-Image', provider: 'pruna', sizes: sizes('1024x1024', '1280x720', '720x1280', '1024x768', '768x1024', '1152x768', '768x1152'), source: 'https://docs.api.pruna.ai/guides/models/p-image' },
]
export function loadImageSettings(): ImageSettings {
  const empty: ImageSettings = { keys: { nanogpt: '', openai: '', pruna: '' }, favorites: [], defaultAlias: '' }
  try {
    const parsed = JSON.parse(localStorage.getItem(IMAGE_SETTINGS_KEY) || 'null')
    if (!parsed) return empty
    return validateImageSettings({ ...empty, ...parsed, keys: { ...empty.keys, ...parsed.keys } })
  } catch { return empty }
}
export function validateImageSettings(settings: ImageSettings): ImageSettings {
  const aliases = new Set<string>()
  if (!Array.isArray(settings.favorites) || settings.favorites.length > 50) throw new Error('Choose up to 50 favorite image models.')
  const favorites = settings.favorites.map((f) => {
    const alias = String(f.alias ?? '').trim()
    if (!alias || alias.length > 64 || aliases.has(alias.toLowerCase())) throw new Error('Give every favorite a unique alias, up to 64 characters.')
    aliases.add(alias.toLowerCase())
    if (!IMAGE_PROVIDERS.includes(f.provider) || !f.id?.trim() || !Array.isArray(f.sizes)) throw new Error('Choose a supported image model.')
    const validSizes = f.sizes.map((s) => imageSize(s.value)).filter((s): s is ImageSize => Boolean(s))
    const enabled = [...new Set(f.enabledSizes)].filter((s) => validSizes.some((v) => v.value === s))
    if (!enabled.length || !enabled.includes(f.defaultSize)) throw new Error(`Enable at least one size and a valid default for ${alias}.`)
    return { ...f, alias, sizes: validSizes, enabledSizes: enabled }
  })
  return { keys: Object.fromEntries(IMAGE_PROVIDERS.map((p) => [p, String(settings.keys[p] || '').trim()])) as ImageSettings['keys'], favorites, defaultAlias: favorites.some((f) => f.alias === settings.defaultAlias) ? settings.defaultAlias : favorites[0]?.alias || '' }
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
export function resolveImageSpec(prompt: string, alias?: string, size?: string, ratio?: string, settings = loadImageSettings()): ImageGenerationSpec {
  if (!prompt?.trim() || prompt.length > 32000) throw new Error('Enter an image prompt of 1–32,000 characters.')
  const selected = alias || settings.defaultAlias
  const model = settings.favorites.find((f) => f.alias.toLowerCase() === selected.toLowerCase())
  if (!model) throw new Error('Choose a favorite image model in Images settings first.')
  const enabled = model.sizes.filter((s) => model.enabledSizes.includes(s.value))
  const explicit = size ? imageSize(size)?.value : undefined
  if (size && !explicit) throw new Error('Use a size such as 1024x1024.')
  const chosen = explicit ? enabled.find((s) => s.value === explicit) : ratio ? enabled.find((s) => imageRatio(s) === ratio) : enabled.find((s) => s.value === model.defaultSize)
  if (!chosen || (ratio && imageRatio(chosen) !== ratio)) throw new Error('That size or ratio is not enabled for the selected model.')
  return { prompt: prompt.trim(), modelAlias: model.alias, provider: model.provider, model: model.id, size: { ...chosen } }
}
export function imageFavorite(model: ImageModel, used: FavoriteImageModel[]): FavoriteImageModel {
  const base = `${model.provider}/${model.id}`.slice(0, 58)
  let alias = base, suffix = 2
  while (used.some((f) => f.alias.toLowerCase() === alias.toLowerCase())) alias = `${base}-${suffix++}`
  const defaultSize = model.sizes.find((s) => s.value === '1024x1024')?.value ?? model.sizes[0]?.value ?? ''
  return { ...model, alias, enabledSizes: model.sizes.map((s) => s.value), defaultSize }
}
export function imageModelInstructions() {
  const settings = loadImageSettings()
  return `\n\nImage generation: propose_image_generation only creates an editable proposal; never claim an image was generated. The user accepts the proposal, then presses Generate for each image. Text-to-image only. Use only the following favorite model aliases and enabled sizes. If none exist, ask the user to configure Images settings. Default alias: ${JSON.stringify(settings.defaultAlias)}. Favorites: ${JSON.stringify(settings.favorites.map((f) => ({ alias: f.alias, sizes: f.sizes.filter((s) => f.enabledSizes.includes(s.value)).map((s) => ({ size: s.value, ratio: imageRatio(s) })), defaultSize: f.defaultSize })))}`
}

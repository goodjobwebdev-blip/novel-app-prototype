import type { ImageGenerationSpec, ImageModel, ImageSize } from './image-generation-types'
export const LEONARDO_API = 'https://cloud.leonardo.ai/api/rest'
export const LEONARDO_CONTRACT_VERSION = 1
export const LEONARDO_DYNAMIC = '111dc692-d470-4eec-b791-3475abac4c46'
const NONE = '556c1ee5-ec38-42e8-955a-1e82dad0ffa1'
export type LeonardoOptions = { prompt_enhance?: 'OFF' | 'AUTO' | 'ON'; mode?: 'FAST' | 'ULTRA'; quality?: 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH'; style_ids?: string[]; seed?: number }
type Contract = { name: string; promptMax: number; widthMax: number; heightMax: number; dimensions?: number[]; modes?: LeonardoOptions['mode'][]; qualities?: LeonardoOptions['quality'][]; seedMax?: number; styles?: Record<string, string>; source: string; checkedAt: string; version: number }
// Each model has its own allowlist, including the conservative verified style subset.
// API credit costs and account availability are not model prices/capabilities.
export const leonardoContracts: Record<string, Contract> = {
  'lucid-origin': { name: 'Lucid Origin', promptMax: 2000, widthMax: 3840, heightMax: 3616, modes: ['FAST', 'ULTRA'], seedMax: 2147483647, styles: { Dynamic: LEONARDO_DYNAMIC, None: NONE }, source: 'https://docs.leonardo.ai/docs/lucid-origin', checkedAt: '2026-10-11', version: 1 },
  'lucid-realism': { name: 'Lucid Realism', promptMax: 9999, widthMax: 2496, heightMax: 2496, modes: ['FAST', 'ULTRA'], seedMax: 2147483647, styles: { Dynamic: LEONARDO_DYNAMIC, None: NONE }, source: 'https://docs.leonardo.ai/docs/lucid-realism', checkedAt: '2026-10-11', version: 1 },
  'flux-schnell': { name: 'FLUX Schnell', promptMax: 2000, widthMax: 2048, heightMax: 2048, seedMax: 2147483637, styles: { Dynamic: LEONARDO_DYNAMIC, None: NONE }, source: 'https://docs.leonardo.ai/docs/flux-schnell', checkedAt: '2026-10-11', version: 1 },
  'ideogram/p-image-ideogram': { name: 'P-Image-Ideogram', promptMax: 10000, widthMax: 3456, heightMax: 3456, dimensions: [512,640,720,800,832,864,896,1024,1120,1152,1248,1280,1440,1536,1600,1664,1728,1792,2048,2240,2304,2496,2560,2880,3072,3456], qualities: ['VERY_LOW', 'LOW', 'MEDIUM', 'HIGH'], source: 'https://docs.leonardo.ai/docs/p-image-ideogram', checkedAt: '2026-10-11', version: 1 },
  'krea/krea-2': { name: 'Krea 2', promptMax: 5000, widthMax: 4096, heightMax: 4096, qualities: ['MEDIUM', 'HIGH'], seedMax: 4294967295, source: 'https://docs.leonardo.ai/reference/creategeneration', checkedAt: '2026-10-11', version: 1 },
  'krea-2-turbo': { name: 'Krea 2 Turbo', promptMax: 9999, widthMax: 4096, heightMax: 4096, source: 'https://docs.leonardo.ai/docs/krea-2-turbo', checkedAt: '2026-10-11', version: 1 },
}
export function leonardoContract(model: string): Contract {
  if (!Object.hasOwn(leonardoContracts, model)) throw new Error('Unsupported Leonardo model ID.')
  return leonardoContracts[model]
}
export function validateLeonardoSize(model: string, size: ImageSize) {
  const c = leonardoContract(model), { width, height } = size
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 64 || height < 64 || width > c.widthMax || height > c.heightMax || width * height > 40_000_000 || width % 8 || height % 8 || size.value !== `${width}x${height}` || (c.dimensions && (!c.dimensions.includes(width) || !c.dimensions.includes(height)))) throw new Error('Unsupported Leonardo image dimensions/size; values are not rounded.')
}
export const leonardoModels: ImageModel[] = Object.entries(leonardoContracts).map(([id, c]) => ({ id, name: c.name, provider: 'leonardo', sizes: [{ value: '1024x1024', width: 1024, height: 1024 }], tasks: ['text-to-image'], source: c.source, description: 'Documented; account availability and browser CORS not verified.' }))
export function leonardoDefaults(model: string): LeonardoOptions {
  const c = leonardoContract(model)
  return { prompt_enhance: 'OFF', ...(c.modes ? { mode: 'FAST' as const } : {}), ...(c.qualities ? { quality: 'MEDIUM' as const } : {}), ...(c.styles ? { style_ids: [LEONARDO_DYNAMIC] } : {}) }
}
export function validateLeonardoOptions(model: string, value: LeonardoOptions): LeonardoOptions {
  const c = leonardoContract(model)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Leonardo options.')
  const allowed = ['prompt_enhance', ...(c.modes ? ['mode'] : []), ...(c.qualities ? ['quality'] : []), ...(c.styles ? ['style_ids'] : []), ...(c.seedMax !== undefined ? ['seed'] : [])]
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unsupported Leonardo option: ${key}.`)
  if (value.prompt_enhance !== undefined && !['OFF', 'AUTO', 'ON'].includes(value.prompt_enhance)) throw new Error('Invalid Leonardo prompt enhancement option.')
  if (value.mode !== undefined && !c.modes?.includes(value.mode)) throw new Error('Invalid Leonardo mode option.')
  if (value.quality !== undefined && !c.qualities?.includes(value.quality)) throw new Error('Invalid Leonardo quality option.')
  if (value.seed !== undefined && (!Number.isInteger(value.seed) || value.seed < 0 || value.seed > c.seedMax!)) throw new Error('Invalid Leonardo seed option.')
  if (value.style_ids !== undefined && (!Array.isArray(value.style_ids) || value.style_ids.length !== 1 || !Object.values(c.styles ?? {}).includes(value.style_ids[0]))) throw new Error('Invalid Leonardo style option.')
  return structuredClone(value)
}
export function buildLeonardoRequest(spec: ImageGenerationSpec) {
  const c = leonardoContract(spec.model)
  if (spec.leonardoContractVersion !== c.version) throw new Error('Unsupported saved Leonardo contract version. Review the original request before starting a new generation.')
  if (spec.provider !== 'leonardo' || (spec.task ?? 'text-to-image') !== 'text-to-image' || spec.sources?.length || spec.video || spec.quality !== undefined || spec.moderation !== undefined) throw new Error('Leonardo supports text-to-image only, with namespaced options.')
  // Match OpenAPI string maxLength: Unicode code points, not UTF-8 bytes.
  if (typeof spec.prompt !== 'string' || !spec.prompt.trim() || Array.from(spec.prompt).length > c.promptMax) throw new Error(`Leonardo prompt must contain 1–${c.promptMax} characters.`)
  validateLeonardoSize(spec.model, spec.size)
  const options = validateLeonardoOptions(spec.model, spec.leonardoOptions!)
  if (options.prompt_enhance === undefined || (c.modes && options.mode === undefined) || (c.qualities && options.quality === undefined) || (c.styles && options.style_ids === undefined)) throw new Error('Saved Leonardo options are incomplete; review the original request.')
  // Never spread an imported favorite/job into an API payload.
  const parameters: Record<string, unknown> = { prompt: spec.prompt, width: spec.size.width, height: spec.size.height, quantity: 1, prompt_enhance: options.prompt_enhance }
  for (const key of ['mode', 'quality', 'style_ids', 'seed'] as const) if (options[key] !== undefined) parameters[key] = options[key]
  return { model: spec.model, public: false, parameters }
}

import type { ImageGenerationSpec, ImageModel } from './image-generation-types'
export const LEONARDO_API = 'https://cloud.leonardo.ai/api/rest'
export const LEONARDO_CONTRACT_VERSION = 1
export const LEONARDO_DYNAMIC = '111dc692-d470-4eec-b791-3475abac4c46'
export type LeonardoOptions = { prompt_enhance?: 'OFF' | 'AUTO' | 'ON'; mode?: 'FAST' | 'ULTRA'; quality?: 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH'; style_ids?: string[]; seed?: number }
export const leonardoModels: ImageModel[] = [
  ['lucid-origin', 'Lucid Origin'], ['lucid-realism', 'Lucid Realism'], ['flux-schnell', 'FLUX Schnell'], ['ideogram/p-image-ideogram', 'P-Image-Ideogram'], ['krea/krea-2', 'Krea 2'], ['krea-2-turbo', 'Krea 2 Turbo'],
].map(([id, name]) => ({ id, name, provider: 'leonardo', sizes: [{ value: '1024x1024', width: 1024, height: 1024 }], tasks: ['text-to-image'], source: 'https://docs.leonardo.ai/reference/creategeneration', description: 'Documented; account availability and browser CORS not verified.' }))
export function leonardoDefaults(model: string): LeonardoOptions {
  return { prompt_enhance: 'OFF', ...(model.startsWith('lucid-') ? { mode: 'FAST' as const } : {}), ...(['ideogram/p-image-ideogram', 'krea/krea-2'].includes(model) ? { quality: 'MEDIUM' as const } : {}), ...(['lucid-origin', 'lucid-realism', 'flux-schnell'].includes(model) ? { style_ids: [LEONARDO_DYNAMIC] } : {}) }
}
export function buildLeonardoRequest(spec: ImageGenerationSpec) {
  return { model: spec.model, public: false, parameters: { prompt: spec.prompt, width: spec.size.width, height: spec.size.height, quantity: 1, ...spec.leonardoOptions } }
}

import type { AiProvider, AiSettings } from './ai-settings'

export type ProviderModel = {
  id: string
  name?: string
  context_length?: number
  pricing?: { prompt?: string; completion?: string }
  architecture?: { modality?: string }
}

export type ModelCatalogCache = {
  version: 1
  provider: AiProvider
  baseUrl: string
  connectionFingerprint: string
  loadedAt: number
  models: ProviderModel[]
}

const MODEL_CATALOG_STORAGE_KEY = 'arc-provider-model-catalog-v1'
const MAX_CATALOGS = 8

function normalizeBaseUrl(settings: Pick<AiSettings, 'provider' | 'baseUrl'>) {
  if (settings.provider === 'openrouter') return 'https://openrouter.ai/api/v1'
  if (settings.provider === 'openai') return 'https://api.openai.com/v1'
  if (settings.provider === 'nanogpt') return 'https://nano-gpt.com/api/v1'
  return settings.baseUrl.trim().replace(/\/+$/, '')
}

function hashConnection(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function fingerprint(settings: Pick<AiSettings, 'provider' | 'baseUrl' | 'apiKey'>) {
  return hashConnection(`${settings.provider}\n${normalizeBaseUrl(settings)}\n${settings.apiKey}`)
}

function cacheId(settings: Pick<AiSettings, 'provider' | 'baseUrl' | 'apiKey'>) {
  return `${settings.provider}:${normalizeBaseUrl(settings)}:${fingerprint(settings)}`
}

function readCatalogs(): Record<string, ModelCatalogCache> {
  try {
    const stored = localStorage.getItem(MODEL_CATALOG_STORAGE_KEY)
    if (!stored) return {}
    const parsed = JSON.parse(stored) as Record<string, ModelCatalogCache>
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed
  } catch {
    return {}
  }
}

function writeCatalogs(catalogs: Record<string, ModelCatalogCache>) {
  try {
    const trimmed = Object.fromEntries(
      Object.entries(catalogs)
        .sort(([, a], [, b]) => (b.loadedAt ?? 0) - (a.loadedAt ?? 0))
        .slice(0, MAX_CATALOGS),
    )
    localStorage.setItem(MODEL_CATALOG_STORAGE_KEY, JSON.stringify(trimmed))
    return true
  } catch {
    return false
  }
}

function normalizeModels(models: ProviderModel[]) {
  return models
    .filter((model) => typeof model?.id === 'string' && model.id.length > 0)
    .map((model) => ({
      id: model.id,
      name: typeof model.name === 'string' ? model.name : undefined,
      context_length: Number.isFinite(model.context_length) ? model.context_length : undefined,
      pricing: model.pricing && typeof model.pricing === 'object'
        ? { prompt: model.pricing.prompt, completion: model.pricing.completion }
        : undefined,
      architecture: model.architecture && typeof model.architecture === 'object'
        ? { modality: model.architecture.modality }
        : undefined,
    }))
}

export function providerModelEndpoint(settings: Pick<AiSettings, 'provider' | 'baseUrl'>) {
  const baseUrl = normalizeBaseUrl(settings)
  if (settings.provider === 'nanogpt') return `${baseUrl}/models?detailed=true&sort=favorites`
  return `${baseUrl}/models`
}

export function getCachedModelCatalog(settings: Pick<AiSettings, 'provider' | 'baseUrl' | 'apiKey'>): ModelCatalogCache | undefined {
  if (!settings.apiKey.trim()) return undefined
  const cached = readCatalogs()[cacheId(settings)]
  if (!cached || cached.version !== 1 || cached.connectionFingerprint !== fingerprint(settings)) return undefined
  return { ...cached, models: normalizeModels(cached.models ?? []) }
}

export function saveModelCatalog(settings: Pick<AiSettings, 'provider' | 'baseUrl' | 'apiKey'>, models: ProviderModel[]) {
  const catalogs = readCatalogs()
  const id = cacheId(settings)
  const catalog: ModelCatalogCache = {
    version: 1,
    provider: settings.provider,
    baseUrl: normalizeBaseUrl(settings),
    connectionFingerprint: fingerprint(settings),
    loadedAt: Date.now(),
    models: normalizeModels(models),
  }
  catalogs[id] = catalog
  return { catalog, persisted: writeCatalogs(catalogs) }
}

export function clearModelCatalog(settings: Pick<AiSettings, 'provider' | 'baseUrl' | 'apiKey'>) {
  const catalogs = readCatalogs()
  const id = cacheId(settings)
  if (!(id in catalogs)) return
  delete catalogs[id]
  writeCatalogs(catalogs)
}

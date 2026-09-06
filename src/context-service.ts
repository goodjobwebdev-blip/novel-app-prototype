import { isCodexEntryArchived, listEntitiesByBook, type ArcEntity, type GenerationContextProfile, type GenerationContextType, type StructuralEntity, type SummaryEntity } from './persistence'

export type PreparedContextValues = {
  currentSceneText: string
  currentSceneTitle: string
  previousSceneText: string
  previousSceneTitle: string
  summaryContext: string
  lastSceneText: string
  lastSceneTitle: string
  additionalContext: string
}
export type ContextDiagnostics = {
  modelId: string
  modelContextTokens: number
  modelContextKnown: boolean
  configuredContextTokens?: number
  effectiveContextTokens: number
  usableInputTokens: number
  requestTokens: number
  responseReserveTokens: number
  usageRatio: number
  warning: boolean
  fits: boolean
  limitValid: boolean
  limitError?: string
  wasClamped: boolean
}
type BuildOptions = { bookId: string; type: GenerationContextType; currentSceneId?: string; currentSceneText?: string; currentDocumentId?: string; profile: GenerationContextProfile }
type AdditionalContextSection = {
  text: string
  id: string
  updatedAt: number
  stabilityRank: number
  typeRank: number
  outlineIndex: number
}

const tokenEstimate = (text: string) => Math.max(1, Math.ceil(text.length / 4))
const section = (heading: string, content: string) => `## ${heading}\n\n${content.trim()}`
const sorted = <T extends ArcEntity>(items: T[]) => [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt - b.createdAt || a.id.localeCompare(b.id))

function orderedOutline(bookId: string, entities: ArcEntity[]) {
  const result: StructuralEntity[] = []
  const visit = (parentId: string) => sorted(entities.filter((item): item is StructuralEntity => item.parentId === parentId && ['act', 'chapter', 'scene'].includes(item.type))).forEach((item) => {
    result.push(item)
    if (item.type !== 'scene') visit(item.id)
  })
  visit(bookId)
  return result
}

function summaryMap(entities: ArcEntity[]) {
  return new Map(entities.filter((item): item is SummaryEntity => item.type === 'summary' && Boolean(String(item.content ?? '').trim())).map((item) => [item.sourceEntityId, item]))
}

function descendantScenes(source: StructuralEntity, outline: StructuralEntity[]) {
  if (source.type === 'scene') return [source]
  const result: StructuralEntity[] = []
  const visit = (id: string) => outline.filter((item) => item.parentId === id).forEach((item) => item.type === 'scene' ? result.push(item) : visit(item.id))
  visit(source.id)
  return result
}

function automaticSummaries(bookId: string, entities: ArcEntity[], outline: StructuralEntity[], currentSceneId?: string, excludedSceneId?: string) {
  if (!currentSceneId) return { text: '', ids: new Set<string>() }
  const scenes = outline.filter((item) => item.type === 'scene')
  const currentIndex = scenes.findIndex((item) => item.id === currentSceneId)
  if (currentIndex < 0) return { text: '', ids: new Set<string>() }
  const summaries = summaryMap(entities)
  const chosen: SummaryEntity[] = []
  const visit = (item: StructuralEntity) => {
    const indices = descendantScenes(item, outline).map((scene) => scenes.findIndex((candidate) => candidate.id === scene.id)).filter((index) => index >= 0)
    const entirelyBefore = indices.length > 0 && Math.max(...indices) < currentIndex
    const ownSummary = summaries.get(item.id)
    if (item.type !== 'scene' && entirelyBefore && ownSummary) { chosen.push(ownSummary); return }
    if (item.type === 'scene') {
      const index = scenes.findIndex((scene) => scene.id === item.id)
      if (index < currentIndex && item.id !== excludedSceneId && ownSummary) chosen.push(ownSummary)
      return
    }
    sorted(outline.filter((child) => child.parentId === item.id)).forEach(visit)
  }
  sorted(outline.filter((item) => item.parentId === bookId)).forEach(visit)
  return { text: chosen.map((summary) => section(summary.title, summary.content)).join('\n\n'), ids: new Set(chosen.map((summary) => summary.id)) }
}

function summaryMatches(source: StructuralEntity, outline: StructuralEntity[], currentSceneId: string | undefined, range: GenerationContextProfile['summaryRange']) {
  if (range === 'none') return false
  if (range === 'all') return true
  if (!currentSceneId) return false
  const scenes = outline.filter((item) => item.type === 'scene')
  const currentIndex = scenes.findIndex((item) => item.id === currentSceneId)
  const indices = descendantScenes(source, outline).map((scene) => scenes.findIndex((item) => item.id === scene.id)).filter((index) => index >= 0)
  if (currentIndex < 0 || !indices.length) return false
  return range === 'before' ? Math.max(...indices) < currentIndex : Math.min(...indices) > currentIndex
}

function additionalContextOrder(a: AdditionalContextSection, b: AdditionalContextSection) {
  return a.stabilityRank - b.stabilityRank
    || a.updatedAt - b.updatedAt
    || a.typeRank - b.typeRank
    || a.outlineIndex - b.outlineIndex
    || a.id.localeCompare(b.id)
}

export async function buildContextValues(options: BuildOptions): Promise<PreparedContextValues> {
  const entities = await listEntitiesByBook(options.bookId)
  const outline = orderedOutline(options.bookId, entities)
  const scenes = outline.filter((item) => item.type === 'scene')
  const outlineIndex = new Map(outline.map((item, index) => [item.id, index]))
  const currentIndex = options.currentSceneId ? scenes.findIndex((item) => item.id === options.currentSceneId) : -1
  const currentScene = currentIndex >= 0 ? scenes[currentIndex] : undefined
  const previousScene = currentIndex > 0 ? scenes[currentIndex - 1] : undefined
  const liveCurrentText = options.currentSceneText ?? String(currentScene?.content ?? '')
  const previousSceneText = options.type === 'scene' && options.profile.includePreviousSceneWhenEmpty && currentScene && !liveCurrentText.trim()
    ? String(previousScene?.content ?? '')
    : ''
  const automatic = options.type === 'scene'
    ? automaticSummaries(options.bookId, entities, outline, options.currentSceneId, previousSceneText ? previousScene?.id : undefined)
    : { text: '', ids: new Set<string>() }
  const automaticFullIds = new Set<string>()
  if (options.type === 'scene' && options.currentSceneId) automaticFullIds.add(options.currentSceneId)
  if (previousSceneText && previousScene?.id) automaticFullIds.add(previousScene.id)
  if ((options.type === 'codex' || options.type === 'chat') && options.profile.includeLastScene && options.currentSceneId) automaticFullIds.add(options.currentSceneId)

  const selectedSceneIds = new Set<string>()
  outline.filter((item) => options.profile.structuralIds.includes(item.id)).forEach((item) => descendantScenes(item, outline).forEach((scene) => {
    if (!automaticFullIds.has(scene.id)) selectedSceneIds.add(scene.id)
  }))
  const fullSections: AdditionalContextSection[] = scenes
    .filter((scene) => selectedSceneIds.has(scene.id) && String(scene.content ?? '').trim())
    .map((scene) => ({
      text: section(`Scene — ${scene.title}`, String(scene.content)),
      id: scene.id,
      updatedAt: scene.updatedAt,
      stabilityRank: 0,
      typeRank: 0,
      outlineIndex: outlineIndex.get(scene.id) ?? Number.MAX_SAFE_INTEGER,
    }))

  const summaries = summaryMap(entities)
  const summarySections: AdditionalContextSection[] = outline.filter((item) => summaryMatches(item, outline, options.currentSceneId, options.profile.summaryRange))
    .map((item) => summaries.get(item.id)).filter((item): item is SummaryEntity => Boolean(item) && !automatic.ids.has(item!.id))
    .map((summary) => ({
      text: section(summary.title, summary.content),
      id: summary.id,
      updatedAt: summary.updatedAt,
      stabilityRank: 1,
      typeRank: 1,
      outlineIndex: outlineIndex.get(summary.sourceEntityId) ?? Number.MAX_SAFE_INTEGER,
    }))
  const notes: AdditionalContextSection[] = entities.filter((item) => item.type === 'note' && options.profile.noteIds.includes(item.id) && String(item.content ?? '').trim())
    .map((item) => ({
      text: section(`Note — ${item.title ?? 'Untitled'}`, String(item.content)),
      id: item.id,
      updatedAt: item.updatedAt,
      stabilityRank: 1,
      typeRank: 2,
      outlineIndex: Number.MAX_SAFE_INTEGER,
    }))
  const codex: AdditionalContextSection[] = entities.filter((item) => item.type === 'codexEntry' && !isCodexEntryArchived(item) && item.id !== options.currentDocumentId && options.profile.codexEntryIds.includes(item.id))
    .map((item) => ({
      text: section(`Codex — ${String(item.category ?? 'Other')}: ${item.title ?? 'Untitled'}`, String(item.content ?? '').trim() || '_No description provided._'),
      id: item.id,
      updatedAt: item.updatedAt,
      stabilityRank: 1,
      typeRank: 0,
      outlineIndex: Number.MAX_SAFE_INTEGER,
    }))

  return {
    currentSceneText: liveCurrentText,
    currentSceneTitle: currentScene?.title ?? '',
    previousSceneText,
    previousSceneTitle: previousSceneText ? previousScene?.title ?? '' : '',
    summaryContext: automatic.text,
    lastSceneText: (options.type === 'codex' || options.type === 'chat') && options.profile.includeLastScene ? String(currentScene?.content ?? '') : '',
    lastSceneTitle: (options.type === 'codex' || options.type === 'chat') && options.profile.includeLastScene ? currentScene?.title ?? '' : '',
    additionalContext: [...fullSections, ...summarySections, ...notes, ...codex].sort(additionalContextOrder).map((item) => item.text).join('\n\n'),
  }
}

function modelContextLimit(modelId: string, catalogLimit?: number) {
  if (Number.isFinite(catalogLimit) && Number(catalogLimit) >= 4_096) return { tokens: Math.floor(Number(catalogLimit)), known: true }
  const explicit = [...modelId.toLowerCase().matchAll(/(?:^|[^\d.])(\d+(?:\.\d+)?)\s*([km])(?:[^a-z]|$)/g)]
    .map((match) => Number(match[1]) * (match[2] === 'm' ? 1_000_000 : 1_000)).filter((value) => Number.isFinite(value) && value >= 4_096).sort((a, b) => b - a)[0]
  if (explicit) return { tokens: explicit, known: true }
  return { tokens: 64_000, known: false }
}

function configuredContextLimit(value: string | undefined) {
  const input = String(value ?? '').trim().toLowerCase()
  if (!input) return { valid: true as const, tokens: undefined }
  const match = input.match(/^(\d+(?:\.\d+)?)\s*([km])?$/)
  if (!match) return { valid: false as const, error: 'Enter a token count such as 32000, 32k, or 1m.' }
  const multiplier = match[2] === 'm' ? 1_000_000 : match[2] === 'k' ? 1_000 : 1
  const tokens = Math.floor(Number(match[1]) * multiplier)
  if (!Number.isSafeInteger(tokens) || tokens < 4_096) return { valid: false as const, error: 'Context cap must be at least 4,096 tokens.' }
  return { valid: true as const, tokens }
}

export function contextLimitInputError(value: string | undefined) {
  const parsed = configuredContextLimit(value)
  return parsed.valid ? '' : parsed.error
}

export function generationContextDiagnostics(modelId: string, modelContextLength: number | undefined, effectiveLimitInput: string | undefined, requestText: string): ContextDiagnostics {
  const model = modelContextLimit(modelId, modelContextLength)
  const configured = configuredContextLimit(effectiveLimitInput)
  const configuredContextTokens = configured.valid ? configured.tokens : undefined
  const effectiveContextTokens = configuredContextTokens === undefined
    ? model.tokens
    : model.known ? Math.min(configuredContextTokens, model.tokens) : configuredContextTokens
  const responseReserveTokens = Math.min(16_384, Math.max(2_048, Math.floor(effectiveContextTokens * .15)))
  const usableInputTokens = Math.max(0, effectiveContextTokens - responseReserveTokens)
  const requestTokens = tokenEstimate(requestText) + 512
  const usageRatio = usableInputTokens > 0 ? requestTokens / usableInputTokens : Number.POSITIVE_INFINITY
  const limitValid = configured.valid
  const fits = limitValid && requestTokens <= usableInputTokens
  return {
    modelId,
    modelContextTokens: model.tokens,
    modelContextKnown: model.known,
    configuredContextTokens,
    effectiveContextTokens,
    usableInputTokens,
    requestTokens,
    responseReserveTokens,
    usageRatio,
    warning: limitValid && fits && usageRatio >= .85,
    fits,
    limitValid,
    limitError: configured.valid ? undefined : configured.error,
    wasClamped: Boolean(model.known && configuredContextTokens !== undefined && configuredContextTokens > model.tokens),
  }
}

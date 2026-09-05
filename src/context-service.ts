import { listEntitiesByBook, type ArcEntity, type GenerationContextProfile, type GenerationContextType, type StructuralEntity, type SummaryEntity } from './persistence'

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
export type ContextDiagnostics = { modelId: string; modelContextTokens: number; requestTokens: number; responseReserveTokens: number; fits: boolean }
type BuildOptions = { bookId: string; type: GenerationContextType; currentSceneId?: string; currentSceneText?: string; currentDocumentId?: string; profile: GenerationContextProfile }

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

export async function buildContextValues(options: BuildOptions): Promise<PreparedContextValues> {
  const entities = await listEntitiesByBook(options.bookId)
  const outline = orderedOutline(options.bookId, entities)
  const scenes = outline.filter((item) => item.type === 'scene')
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
  if (options.type === 'codex' && options.profile.includeLastScene && options.currentSceneId) automaticFullIds.add(options.currentSceneId)

  const selectedSceneIds = new Set<string>()
  outline.filter((item) => options.profile.structuralIds.includes(item.id)).forEach((item) => descendantScenes(item, outline).forEach((scene) => {
    if (!automaticFullIds.has(scene.id)) selectedSceneIds.add(scene.id)
  }))
  const fullSections = scenes.filter((scene) => selectedSceneIds.has(scene.id) && String(scene.content ?? '').trim()).map((scene) => section(`Scene — ${scene.title}`, String(scene.content)))

  const summaries = summaryMap(entities)
  const summarySections = outline.filter((item) => summaryMatches(item, outline, options.currentSceneId, options.profile.summaryRange))
    .map((item) => summaries.get(item.id)).filter((item): item is SummaryEntity => Boolean(item) && !automatic.ids.has(item!.id))
    .map((summary) => section(summary.title, summary.content))
  const notes = entities.filter((item) => item.type === 'note' && options.profile.noteIds.includes(item.id) && String(item.content ?? '').trim())
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).map((item) => section(`Note — ${item.title ?? 'Untitled'}`, String(item.content)))
  const codex = entities.filter((item) => item.type === 'codexEntry' && item.id !== options.currentDocumentId && options.profile.codexEntryIds.includes(item.id))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .map((item) => section(`Codex — ${String(item.category ?? 'Other')}: ${item.title ?? 'Untitled'}`, String(item.content ?? '').trim() || '_No description provided._'))

  return {
    currentSceneText: liveCurrentText,
    currentSceneTitle: currentScene?.title ?? '',
    previousSceneText,
    previousSceneTitle: previousSceneText ? previousScene?.title ?? '' : '',
    summaryContext: automatic.text,
    lastSceneText: options.type === 'codex' && options.profile.includeLastScene ? String(currentScene?.content ?? '') : '',
    lastSceneTitle: options.type === 'codex' && options.profile.includeLastScene ? currentScene?.title ?? '' : '',
    additionalContext: [...fullSections, ...summarySections, ...notes, ...codex].join('\n\n'),
  }
}

function modelContextLimit(modelId: string, catalogLimit?: number) {
  if (Number.isFinite(catalogLimit) && Number(catalogLimit) >= 4_096) return Math.floor(Number(catalogLimit))
  const explicit = [...modelId.toLowerCase().matchAll(/(?:^|[^\d.])(\d+(?:\.\d+)?)\s*([km])(?:[^a-z]|$)/g)]
    .map((match) => Number(match[1]) * (match[2] === 'm' ? 1_000_000 : 1_000)).filter((value) => Number.isFinite(value) && value >= 4_096).sort((a, b) => b - a)[0]
  return explicit || 64_000
}

export function generationContextDiagnostics(modelId: string, modelContextLength: number | undefined, systemPrompt: string, userMessage: string): ContextDiagnostics {
  const modelContextTokens = modelContextLimit(modelId, modelContextLength)
  const responseReserveTokens = Math.min(16_384, Math.max(2_048, Math.floor(modelContextTokens * .15)))
  const requestTokens = tokenEstimate(`${systemPrompt}\n\n${userMessage}`) + 512
  return { modelId, modelContextTokens, requestTokens, responseReserveTokens, fits: requestTokens + responseReserveTokens <= modelContextTokens }
}

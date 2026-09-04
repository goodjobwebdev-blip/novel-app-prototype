import {
  getGenerationContextSelection,
  listEntitiesByBook,
  type ArcEntity,
  type BookEntity,
  type CodexEntryEntity,
  type GenerationContextSelection,
  type NoteEntity,
  type StructuralEntity,
  type SummaryEntity,
} from './persistence'

export type ContextItemKind = 'act-summary' | 'chapter-summary' | 'note' | 'codex' | 'previous-summary' | 'previous-scene' | 'current-scene'

export type PreparedContextItem = {
  id: string
  kind: ContextItemKind
  label: string
  content: string
  estimatedTokens: number
  included: boolean
  reason?: 'budget'
}

export type ContextDiagnostics = {
  modelId: string
  modelContextTokens: number
  budgetTokens: number
  estimatedTokens: number
  droppedTokens: number
  modelLimitSource: 'catalog' | 'model-id' | 'conservative-default'
  mandatoryTextTruncated: boolean
}

export type PreparedGenerationContext = {
  message: string
  items: PreparedContextItem[]
  diagnostics: ContextDiagnostics
  selection: GenerationContextSelection
}

type BuildContextOptions = {
  book: BookEntity
  sceneId: string
  currentSceneText: string
  modelId: string
  modelContextLength?: number
  systemPrompt: string
  userInstruction: string
  selection?: GenerationContextSelection
}

type Candidate = Omit<PreparedContextItem, 'estimatedTokens' | 'included'> & {
  priority: number
  removable: boolean
  dropOrder: number
}

const tokenEstimate = (text: string) => Math.max(1, Math.ceil(text.length / 4))

function modelContextLimit(modelId: string, catalogLimit?: number) {
  if (Number.isFinite(catalogLimit) && Number(catalogLimit) >= 4_096) {
    return { tokens: Math.floor(Number(catalogLimit)), source: 'catalog' as const }
  }

  const normalized = modelId.toLowerCase()
  const explicit = [...normalized.matchAll(/(?:^|[^\d.])(\d+(?:\.\d+)?)\s*([km])(?:[^a-z]|$)/g)]
    .map((match) => Number(match[1]) * (match[2] === 'm' ? 1_000_000 : 1_000))
    .filter((value) => Number.isFinite(value) && value >= 4_096)
    .sort((left, right) => right - left)[0]
  if (explicit) return { tokens: explicit, source: 'model-id' as const }

  return { tokens: 64_000, source: 'conservative-default' as const }
}

function contextBudget(modelId: string, catalogLimit: number | undefined, systemPrompt: string, userInstruction: string) {
  const limit = modelContextLimit(modelId, catalogLimit)
  const responseReserve = Math.min(16_384, Math.max(2_048, Math.floor(limit.tokens * 0.15)))
  const requestOverhead = tokenEstimate(`${systemPrompt}\n\n${userInstruction}`) + 512
  return {
    ...limit,
    budget: Math.max(1_024, limit.tokens - responseReserve - requestOverhead),
  }
}

function sorted<T extends ArcEntity>(entities: T[]) {
  return [...entities].sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.createdAt - right.createdAt)
}

function orderedScenes(bookId: string, entities: ArcEntity[]) {
  const root = sorted(entities.filter((entity): entity is StructuralEntity => entity.parentId === bookId && (entity.type === 'act' || entity.type === 'chapter')))
  const chapters: StructuralEntity[] = []
  for (const entity of root) {
    if (entity.type === 'chapter') chapters.push(entity)
    if (entity.type === 'act') {
      chapters.push(...sorted(entities.filter((candidate): candidate is StructuralEntity => candidate.parentId === entity.id && candidate.type === 'chapter')))
    }
  }
  return chapters.flatMap((chapter) => sorted(entities.filter((entity): entity is StructuralEntity => entity.parentId === chapter.id && entity.type === 'scene')))
}

function summaryFor(sourceId: string, entities: ArcEntity[]) {
  return entities.find((entity): entity is SummaryEntity => entity.type === 'summary' && entity.sourceEntityId === sourceId && Boolean(String(entity.content ?? '').trim()))
}

function section(heading: string, content: string) {
  return `## ${heading}\n\n${content.trim() || '_No content_'}`
}

function candidate(id: string, kind: ContextItemKind, label: string, content: string, priority: number, removable: boolean, dropOrder: number): Candidate {
  return { id, kind, label, content: section(label, content), priority, removable, dropOrder }
}

function trimMandatoryItem(item: Candidate, budgetTokens: number) {
  const heading = `## ${item.label}\n\n`
  const allowance = Math.max(80, budgetTokens * 4 - heading.length)
  if (item.content.length <= budgetTokens * 4) return item.content
  const body = item.content.slice(heading.length)
  const marker = `_Earlier ${item.kind === 'previous-scene' ? 'previous-scene' : 'current-scene'} text omitted to fit this model’s context window._\n\n`
  return `${heading}${marker}${body.slice(-Math.max(0, allowance - marker.length))}`
}

export function estimateTokens(text: string) {
  return tokenEstimate(text)
}

export async function buildGenerationContext(options: BuildContextOptions): Promise<PreparedGenerationContext> {
  const entities = await listEntitiesByBook(options.book.id)
  const selection = options.selection ?? await getGenerationContextSelection(options.book.id, options.sceneId)
  const scene = entities.find((entity): entity is StructuralEntity => entity.id === options.sceneId && entity.type === 'scene')
  if (!scene) throw new Error('The current scene is no longer available.')

  const chapter = entities.find((entity): entity is StructuralEntity => entity.id === scene.parentId && entity.type === 'chapter')
  const act = chapter ? entities.find((entity): entity is StructuralEntity => entity.id === chapter.parentId && entity.type === 'act') : undefined
  const scenes = orderedScenes(options.book.id, entities)
  const sceneIndex = scenes.findIndex((candidate) => candidate.id === scene.id)
  const previousScenes = sceneIndex > 0 ? scenes.slice(0, sceneIndex) : []
  const immediatePrevious = previousScenes.at(-1)
  const currentIsEmpty = !options.currentSceneText.trim()
  const fullPreviousId = immediatePrevious && (currentIsEmpty || selection.includePreviousScene) ? immediatePrevious.id : undefined
  const candidates: Candidate[] = []

  if (selection.includeActSummary && act) {
    const summary = summaryFor(act.id, entities)
    if (summary) candidates.push(candidate(summary.id, 'act-summary', `Act summary — ${act.title}`, summary.content, 65, true, 50))
  }
  if (selection.includeChapterSummary && chapter) {
    const summary = summaryFor(chapter.id, entities)
    if (summary) candidates.push(candidate(summary.id, 'chapter-summary', `Chapter summary — ${chapter.title}`, summary.content, 70, true, 40))
  }

  for (const id of selection.codexEntryIds) {
    const entry = entities.find((entity): entity is CodexEntryEntity => entity.id === id && entity.type === 'codexEntry')
    if (entry?.content.trim()) candidates.push(candidate(entry.id, 'codex', `Codex — ${entry.category}: ${entry.title}`, entry.content, 80, true, 30))
  }
  for (const id of selection.noteIds) {
    const note = entities.find((entity): entity is NoteEntity => entity.id === id && entity.type === 'note')
    if (note?.content.trim()) candidates.push(candidate(note.id, 'note', `Note — ${note.title}`, note.content, 80, true, 30))
  }

  if (selection.includePreviousSummaries) {
    previousScenes.forEach((previous, index) => {
      if (previous.id === fullPreviousId) return
      const summary = summaryFor(previous.id, entities)
      if (summary) candidates.push(candidate(summary.id, 'previous-summary', `Previous scene summary — ${previous.title}`, summary.content, 20, true, index))
    })
  }

  if (fullPreviousId && immediatePrevious) {
    candidates.push(candidate(immediatePrevious.id, 'previous-scene', `Previous scene — ${immediatePrevious.title}`, String(immediatePrevious.content ?? ''), 90, false, 60))
  }
  candidates.push(candidate(scene.id, 'current-scene', `Current scene — ${scene.title}`, options.currentSceneText, 100, false, 100))

  const limit = contextBudget(options.modelId, options.modelContextLength, options.systemPrompt, options.userInstruction)
  const included = new Set(candidates.map((item) => item.id))
  let total = candidates.reduce((sum, item) => sum + tokenEstimate(item.content), 0)
  const droppable = candidates
    .filter((item) => item.removable)
    .sort((left, right) => left.priority - right.priority || left.dropOrder - right.dropOrder)

  for (const item of droppable) {
    if (total <= limit.budget) break
    included.delete(item.id)
    total -= tokenEstimate(item.content)
  }

  let mandatoryTextTruncated = false
  const selectedItems = candidates.filter((item) => included.has(item.id))
  const primaryText = selectedItems.find((item) => currentIsEmpty && item.kind === 'previous-scene')
    ?? selectedItems.find((item) => item.kind === 'current-scene')
  if (primaryText && total > limit.budget) {
    const otherTokens = total - tokenEstimate(primaryText.content)
    const trimmed = trimMandatoryItem(primaryText, Math.max(80, limit.budget - otherTokens))
    primaryText.content = trimmed
    total = otherTokens + tokenEstimate(trimmed)
    mandatoryTextTruncated = true
  }

  const items: PreparedContextItem[] = candidates.map((item) => ({
    id: item.id,
    kind: item.kind,
    label: item.label,
    content: item.content,
    estimatedTokens: tokenEstimate(item.content),
    included: included.has(item.id),
    ...(!included.has(item.id) ? { reason: 'budget' as const } : {}),
  }))
  const message = ['# Story context', ...selectedItems.map((item) => item.content), '# Instruction', options.userInstruction.trim() || 'Continue the story.'].join('\n\n')
  const droppedTokens = items.filter((item) => !item.included).reduce((sum, item) => sum + item.estimatedTokens, 0)

  return {
    message,
    items,
    diagnostics: {
      modelId: options.modelId,
      modelContextTokens: limit.tokens,
      budgetTokens: limit.budget,
      estimatedTokens: tokenEstimate(message),
      droppedTokens,
      modelLimitSource: limit.source,
      mandatoryTextTruncated,
    },
    selection,
  }
}

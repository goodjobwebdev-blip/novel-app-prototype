import {
  getEntity,
  listEntitiesByBook,
  type ArcEntity,
  type CodexEntryEntity,
  type StructuralEntity,
  type StructuralEntityType,
  type SummaryEntity,
  type SummarySourceType,
} from './persistence'
import { bookTemplateValues, renderPromptTemplate, type BookPromptValues } from './prompt-template'
import type { DynamicContextSource } from './prompt-composition'

export type SummaryState = 'missing' | 'current' | 'outdated'
export type SummarySourceEntity = StructuralEntity | CodexEntryEntity

export type SummarySource = {
  source: SummarySourceEntity
  content: string
  sourceRevision: number
  diagnostics: DynamicContextSource[]
}

export type CodexContextRepresentation = {
  entryId: string
  title: string
  representation: 'Full entry' | 'Summary'
  fallbackReason?: 'summary missing' | 'summary outdated'
  content: string
}

function isStructural(entity: ArcEntity): entity is StructuralEntity {
  return entity.type === 'scene' || entity.type === 'chapter' || entity.type === 'act'
}

function isSummarySource(entity: ArcEntity): entity is SummarySourceEntity {
  return isStructural(entity) || entity.type === 'codexEntry'
}

function isSummary(entity: ArcEntity): entity is SummaryEntity {
  return entity.type === 'summary'
}

function sortedChildren(entities: ArcEntity[], parentId: string, type: StructuralEntityType) {
  return entities
    .filter((entity): entity is StructuralEntity => entity.parentId === parentId && entity.type === type)
    .sort((left, right) => left.order - right.order)
}

function summariesBySource(entities: ArcEntity[]) {
  return new Map(entities.filter(isSummary).map((summary) => [summary.sourceEntityId, summary]))
}

function sourceRevision(source: SummarySourceEntity, entities: ArcEntity[], summaries: Map<string, SummaryEntity>): number {
  if (source.type === 'codexEntry') return typeof source.sourceRevision === 'number' ? source.sourceRevision : source.updatedAt
  if (source.type === 'scene') return source.updatedAt

  const chapters = source.type === 'act' ? sortedChildren(entities, source.id, 'chapter') : [source]
  const relevant: number[] = [source.updatedAt]
  for (const chapter of chapters) {
    relevant.push(chapter.updatedAt)
    const chapterSummary = summaries.get(chapter.id)
    if (source.type === 'act' && chapterSummary?.content.trim()) relevant.push(chapterSummary.updatedAt)
    for (const scene of sortedChildren(entities, chapter.id, 'scene')) {
      relevant.push(scene.updatedAt)
      const sceneSummary = summaries.get(scene.id)
      if (sceneSummary?.content.trim()) relevant.push(sceneSummary.updatedAt)
    }
  }
  return Math.max(...relevant)
}

function stateFor(source: SummarySourceEntity, summary: SummaryEntity | undefined, entities: ArcEntity[], summaries: Map<string, SummaryEntity>): SummaryState {
  if (!summary?.content.trim()) return 'missing'
  return (summary.summarizedSourceRevision ?? 0) >= sourceRevision(source, entities, summaries) ? 'current' : 'outdated'
}

export function summaryStateForSource(source: SummarySourceEntity, entities: ArcEntity[]): SummaryState {
  const summaries = summariesBySource(entities)
  return stateFor(source, summaries.get(source.id), entities, summaries)
}

export async function getSummaryStateMap(bookId: string): Promise<Record<string, SummaryState>> {
  const entities = await listEntitiesByBook(bookId)
  const summaries = summariesBySource(entities)
  return Object.fromEntries(
    entities
      .filter(isSummarySource)
      .map((source) => [source.id, stateFor(source, summaries.get(source.id), entities, summaries)]),
  )
}

function sceneSource(scene: StructuralEntity, summary: SummaryEntity | undefined, state: SummaryState) {
  const usesSummary = state === 'current' && Boolean(summary?.content.trim())
  const content = usesSummary ? summary!.content.trim() : String(scene.content ?? '').trim()
  return {
    content: `## Scene: ${scene.title}\n\n${content || '_No content_'}`,
    diagnostic: {
      sourceId: usesSummary ? summary!.id : scene.id,
      title: scene.title,
      type: usesSummary ? 'summary' : 'scene',
      representation: usesSummary ? 'Current Scene summary' : 'Full Scene body',
      content: content || '_No content_',
      reason: usesSummary ? 'Current derived representation selected by the #77 hierarchy' : state === 'outdated' ? 'Outdated Scene summary rejected; authoritative full Scene body used' : 'No current Scene summary; authoritative full Scene body used',
    } satisfies DynamicContextSource,
  }
}

function chapterSource(chapter: StructuralEntity, entities: ArcEntity[], summaries: Map<string, SummaryEntity>) {
  const scenes = sortedChildren(entities, chapter.id, 'scene')
  const selected = scenes.map((scene) => sceneSource(scene, summaries.get(scene.id), stateFor(scene, summaries.get(scene.id), entities, summaries)))
  return {
    content: [
    `# Chapter: ${chapter.title}`,
      ...selected.map((item) => item.content),
    ].join('\n\n'),
    diagnostics: selected.map((item) => item.diagnostic),
  }
}

export async function buildSummarySource(sourceId: string): Promise<SummarySource> {
  const source = await getEntity<ArcEntity>(sourceId)
  if (!source || !isSummarySource(source)) throw new Error('The summary source is no longer available.')
  const entities = await listEntitiesByBook(source.bookId)
  const summaries = summariesBySource(entities)
  let content: string
  let diagnostics: DynamicContextSource[]

  if (source.type === 'codexEntry') {
    content = `# Codex entry: ${source.title}\n\nCategory: ${source.category}\n\n${String(source.content ?? '').trim() || '_No content_'}`
    diagnostics = [{ sourceId: source.id, title: source.title, type: 'codexEntry', category: source.category, representation: 'Full Codex body + metadata', content, reason: 'Authoritative Codex source; Summary preference never replaces canon here' }]
  } else if (source.type === 'scene') {
    content = `# Scene: ${source.title}\n\n${String(source.content ?? '').trim() || '_No content_'}`
    diagnostics = [{ sourceId: source.id, title: source.title, type: 'scene', representation: 'Full Scene body', content, reason: 'Authoritative current Scene source' }]
  } else if (source.type === 'chapter') {
    const selected = chapterSource(source, entities, summaries)
    content = selected.content
    diagnostics = selected.diagnostics
  } else {
    const chapters = sortedChildren(entities, source.id, 'chapter')
    const selected = chapters.map((chapter) => {
      const summary = summaries.get(chapter.id)
      if (stateFor(chapter, summary, entities, summaries) === 'current' && summary?.content.trim()) {
        return {
          content: `## Chapter: ${chapter.title}\n\n${summary.content.trim()}`,
          diagnostics: [{ sourceId: summary.id, title: chapter.title, type: 'summary', representation: 'Current Chapter summary', content: summary.content.trim(), reason: 'Current derived Chapter representation selected by the #77 hierarchy' } satisfies DynamicContextSource],
        }
      }
      return chapterSource(chapter, entities, summaries)
    })
    content = [`# Act: ${source.title}`, ...selected.map((item) => item.content)].join('\n\n')
    diagnostics = selected.flatMap((item) => item.diagnostics)
  }

  return { source, content, sourceRevision: sourceRevision(source, entities, summaries), diagnostics }
}

export function codexContextRepresentation(entry: CodexEntryEntity, entities: ArcEntity[]): CodexContextRepresentation {
  const summaries = summariesBySource(entities)
  const summary = summaries.get(entry.id)
  const state = stateFor(entry, summary, entities, summaries)
  if (entry.preferSummaryForContext === true && state === 'current' && summary?.content.trim()) {
    return { entryId: entry.id, title: entry.title, representation: 'Summary', content: summary.content.trim() }
  }
  const fallbackReason = entry.preferSummaryForContext === true
    ? state === 'missing' ? 'summary missing' : state === 'outdated' ? 'summary outdated' : undefined
    : undefined
  return {
    entryId: entry.id,
    title: entry.title,
    representation: 'Full entry',
    ...(fallbackReason ? { fallbackReason } : {}),
    content: String(entry.content ?? '').trim() || '_No description provided._',
  }
}

export function renderSummaryPrompt(template: string, targetType: SummarySourceType, previousSummary: string, book: BookPromptValues) {
  const values: Record<string, string> = {
    ...bookTemplateValues(book),
    'target.type': targetType === 'codexEntry' ? 'Codex entry' : targetType,
    'target.previous_summary': previousSummary,
  }
  return renderPromptTemplate(template, values)
}

import {
  getEntity,
  listEntitiesByBook,
  type ArcEntity,
  type StructuralEntity,
  type StructuralEntityType,
  type SummaryEntity,
} from './persistence'
import { bookTemplateValues, renderPromptTemplate, type BookPromptValues } from './prompt-template'

export type SummaryState = 'missing' | 'current' | 'outdated'

export type SummarySource = {
  source: StructuralEntity
  content: string
  sourceRevision: number
}

function isStructural(entity: ArcEntity): entity is StructuralEntity {
  return entity.type === 'scene' || entity.type === 'chapter' || entity.type === 'act'
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

function sourceRevision(source: StructuralEntity, entities: ArcEntity[], summaries: Map<string, SummaryEntity>): number {
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

function stateFor(source: StructuralEntity, summary: SummaryEntity | undefined, entities: ArcEntity[], summaries: Map<string, SummaryEntity>): SummaryState {
  if (!summary?.content.trim()) return 'missing'
  return (summary.summarizedSourceRevision ?? 0) >= sourceRevision(source, entities, summaries) ? 'current' : 'outdated'
}

export async function getSummaryStateMap(bookId: string): Promise<Record<string, SummaryState>> {
  const entities = await listEntitiesByBook(bookId)
  const summaries = summariesBySource(entities)
  return Object.fromEntries(
    entities
      .filter(isStructural)
      .map((source) => [source.id, stateFor(source, summaries.get(source.id), entities, summaries)]),
  )
}

function sceneSource(scene: StructuralEntity, summary: SummaryEntity | undefined, state: SummaryState) {
  const content = state === 'current' && summary?.content.trim() ? summary.content.trim() : String(scene.content ?? '').trim()
  return `## Scene: ${scene.title}\n\n${content || '_No content_'}`
}

function chapterSource(chapter: StructuralEntity, entities: ArcEntity[], summaries: Map<string, SummaryEntity>) {
  const scenes = sortedChildren(entities, chapter.id, 'scene')
  return [
    `# Chapter: ${chapter.title}`,
    ...scenes.map((scene) => sceneSource(scene, summaries.get(scene.id), stateFor(scene, summaries.get(scene.id), entities, summaries))),
  ].join('\n\n')
}

export async function buildSummarySource(sourceId: string): Promise<SummarySource> {
  const source = await getEntity<StructuralEntity>(sourceId)
  if (!source || !isStructural(source)) throw new Error('The summary source is no longer available.')
  const entities = await listEntitiesByBook(source.bookId)
  const summaries = summariesBySource(entities)
  let content: string

  if (source.type === 'scene') {
    content = `# Scene: ${source.title}\n\n${String(source.content ?? '').trim() || '_No content_'}`
  } else if (source.type === 'chapter') {
    content = chapterSource(source, entities, summaries)
  } else {
    const chapters = sortedChildren(entities, source.id, 'chapter')
    content = [
      `# Act: ${source.title}`,
      ...chapters.map((chapter) => {
        const summary = summaries.get(chapter.id)
        return stateFor(chapter, summary, entities, summaries) === 'current' && summary?.content.trim()
          ? `## Chapter: ${chapter.title}\n\n${summary.content.trim()}`
          : chapterSource(chapter, entities, summaries)
      }),
    ].join('\n\n')
  }

  return { source, content, sourceRevision: sourceRevision(source, entities, summaries) }
}

export function renderSummaryPrompt(template: string, targetType: StructuralEntityType, previousSummary: string, book: BookPromptValues) {
  const values: Record<string, string> = {
    ...bookTemplateValues(book),
    'target.type': targetType,
    'target.previous_summary': previousSummary,
  }
  return renderPromptTemplate(template, values)
}

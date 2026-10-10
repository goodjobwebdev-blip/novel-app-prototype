import { isCodexEntryArchived, type ArcEntity, type CodexEntryEntity, type GenerationContextProfile, type SummaryEntity } from '../../data/persistence'
import { proseEntities, proseText } from '../editor/document-projection'
import { structuralSelectionIds } from '../../shared/context/context-source-selection'
import { entityAvailableInBook } from '../worlds/world-service'
import { codexContextRepresentation } from '../writing/summary-service'
import { resolveCodexState, timelineScenes, type StoryCutoff, type TimelineWorld } from '../codex/codex-timeline'

export type CharacterAdditionalSource = { entityId: string; title: string; kind: 'scene' | 'codex' | 'note' | 'summary'; content: string }

/** Explicit author selections may supplement the automatic story-position context. */
export function characterAdditionalSources(entities: ArcEntity[], profile: GenerationContextProfile, cutoff: StoryCutoff, world: TimelineWorld): CharacterAdditionalSource[] {
  const book = world.books.find(book => book.id === cutoff.bookId)
  const available = proseEntities(entities.filter(entity => entityAvailableInBook(entity, book)))
  const scenes = timelineScenes(world, cutoff.bookId)
  const selected = structuralSelectionIds(available, profile.structuralIds)
  const result: CharacterAdditionalSource[] = []
  const add = (entity: ArcEntity, kind: CharacterAdditionalSource['kind'], content = String(entity.content ?? '')) => {
    if (content.trim()) result.push({ entityId: entity.id, title: entity.title || 'Untitled', kind, content })
  }
  for (const scene of scenes) if (selected.has(scene.id)) add(scene, 'scene', proseText(String(scene.content ?? '')))
  for (const entity of available) {
    if (entity.type === 'note' && profile.noteIds.includes(entity.id)) add(entity, 'note')
    if (entity.type === 'codexEntry' && !isCodexEntryArchived(entity) && profile.codexEntryIds.includes(entity.id)) {
      const entry = entity as CodexEntryEntity
      const state = profile.loreAtCurrentScene ? resolveCodexState(entry, cutoff, world, 'strict') : undefined
      const resolved = state ? { ...entry, content: state.content, timelineResolved: true, timelineSummary: state.summary } : entry
      add(entity, 'codex', codexContextRepresentation(resolved, available).content)
    }
    if (entity.type !== 'summary' || profile.summaryRange === 'none') continue
    const source = available.find(item => item.id === (entity as SummaryEntity).sourceEntityId && ['act', 'chapter', 'scene'].includes(item.type))
    if (!source) continue
    const descendants = structuralSelectionIds(available, [source.id])
    const indices = scenes.flatMap((scene, index) => descendants.has(scene.id) ? [index] : [])
    const anchor = scenes.findIndex(scene => scene.id === cutoff.sceneId)
    if (profile.summaryRange === 'all' || indices.length && (profile.summaryRange === 'before' ? Math.max(...indices) < anchor : Math.min(...indices) > anchor)) add(entity, 'summary')
  }
  return result
}

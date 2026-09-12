import { isCodexEntryArchived, type ArcEntity, type CodexEntryEntity, type GenerationContextProfile, type SummaryEntity } from './persistence'
import { proseEntities, proseText } from './document-projection'
import { structuralSelectionIds } from './context-source-selection'
import { resolveCodexState, timelineScenes, type StoryCutoff, type TimelineWorld } from './codex-timeline'

export type CharacterAdditionalSource = { entityId: string; title: string; kind: 'scene' | 'codex' | 'note' | 'summary'; content: string }

/** Explicit author selections may supplement the automatic story-position context. */
export function characterAdditionalSources(entities: ArcEntity[], profile: GenerationContextProfile, cutoff: StoryCutoff, world: TimelineWorld): CharacterAdditionalSource[] {
  const available = proseEntities(entities.filter(entity => entity.bookId === cutoff.bookId))
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
      const content = profile.loreAtCurrentScene ? resolveCodexState(entity as CodexEntryEntity, cutoff, world, 'strict').content : String(entity.content ?? '')
      add(entity, 'codex', content)
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

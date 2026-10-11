import type { ArcEntity, BookEntity, WorldEntity } from '../data/persistence'
import { entityAvailableInBook, entityAvailableInOwner } from '../features/worlds/world-service'
import type { BookPromptValues } from '../shared/ai/prompt-template'

export type WorkspaceOwner = BookEntity | WorldEntity

export function entityAvailableInWorkspace(entity: ArcEntity | undefined, owner: WorkspaceOwner | undefined): boolean {
  if (owner?.type !== 'world') return entityAvailableInBook(entity, owner)
  return Boolean(entity && ['note', 'codexEntry', 'summary', 'chat'].includes(entity.type) && entityAvailableInOwner(entity, owner))
}

// A World deliberately has no Story, POV, outline or series prompt values.
export function worldPromptValues(world: WorldEntity): BookPromptValues {
  return { title: world.title, series: '', seriesOrder: '', overview: '', genre: '', style: '', pov: '', tense: '', language: '' }
}

export function lastWorldArticleKey(worldId: string) { return `arc-world-last-article-${worldId}` }

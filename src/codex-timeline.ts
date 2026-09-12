import type { ArcEntity, BookEntity, CodexEntryEntity, StructuralEntity } from './persistence'
import { proseText } from './document-projection.ts'

export type CodexCheckpoint = { id: string; label: string; anchorBookId: string; sceneId: string; content: string; revision: number }
export type TimelineMode = 'cutoff' | 'strict'
export type TimelineSummary = { checkpointId: string; sourceText: string; orderSignature: string; mode: TimelineMode; content: string }
export type StoryCutoff = { bookId: string; sceneId: string; position?: number }
export type TimelineWorld = { books: BookEntity[]; outline: ArcEntity[] }
export function timelineScenes(world: TimelineWorld, bookId: string): StructuralEntity[] {
  const result: StructuralEntity[] = [], seen = new Set<string>()
  const visit = (id: string) => {
    if (seen.has(id)) return
    seen.add(id)
    const children = world.outline.filter(e => e.bookId === bookId && e.parentId === id && ['act', 'chapter', 'scene'].includes(e.type)).sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0) || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    for (const child of children) { if (child.type === 'scene') result.push(child as StructuralEntity); else visit(child.id) }
  }
  visit(bookId); return result
}
export function timelineOrderSignature(world: TimelineWorld) {
  return JSON.stringify(world.books.map(book => [book.id, book.seriesId, book.seriesOrder, timelineScenes(world, book.id).map(scene => scene.id)]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
}
export function checkpointPlaced(checkpoint: CodexCheckpoint, world: TimelineWorld) { return timelineScenes(world, checkpoint.anchorBookId).some(scene => scene.id === checkpoint.sceneId) }
export function compareStoryPositions(a: StoryCutoff, b: StoryCutoff, world: TimelineWorld): number {
  const index = (point: StoryCutoff) => timelineScenes(world, point.bookId).findIndex(scene => scene.id === point.sceneId)
  const ai = index(a), bi = index(b)
  if (ai < 0 || bi < 0) throw new Error('The story position is unplaced. Choose an existing scene.')
  if (a.bookId === b.bookId) return ai - bi || (a.position ?? 0) - (b.position ?? 0)
  const ab = world.books.find(book => book.id === a.bookId), bb = world.books.find(book => book.id === b.bookId)
  if (!ab?.seriesId || ab.seriesId !== bb?.seriesId) throw new Error('Cross-book checkpoints must belong to the same series.')
  const books = world.books.filter(book => book.seriesId === ab.seriesId)
  const orders = books.map(book => book.seriesOrder?.trim() ? Number(book.seriesOrder) : NaN)
  if (orders.some(order => !Number.isFinite(order)) || new Set(orders).size !== orders.length) throw new Error('Set a distinct numeric series order for every book before resolving cross-book checkpoints.')
  return Number(ab.seriesOrder) - Number(bb.seriesOrder)
}
export function resolveCodexState(entry: CodexEntryEntity, cutoff: StoryCutoff, world: TimelineWorld, mode: TimelineMode = 'cutoff') {
  if (!timelineScenes(world, cutoff.bookId).some(scene => scene.id === cutoff.sceneId)) throw new Error('Choose an existing scene for the Codex cutoff.')
  const owner = world.books.find(book => book.id === cutoff.bookId)
  const allowedBook = (bookId: string) => bookId === cutoff.bookId || Boolean((entry.seriesSourceId || entry.codexScope === 'series') && owner?.seriesId && world.books.some(book => book.id === bookId && book.seriesId === owner.seriesId))
  const eligible = (entry.checkpoints ?? []).filter(point => allowedBook(point.anchorBookId) && checkpointPlaced(point, world) && compareStoryPositions({ bookId: point.anchorBookId, sceneId: point.sceneId }, cutoff, world) <= 0)
  eligible.sort((a, b) => compareStoryPositions({ bookId: a.anchorBookId, sceneId: a.sceneId }, { bookId: b.anchorBookId, sceneId: b.sceneId }, world) || a.id.localeCompare(b.id))
  const checkpoint = eligible.at(-1)
  const checkpointId = checkpoint?.id ?? 'baseline', content = proseText(checkpoint?.content ?? entry.content), orderSignature = timelineOrderSignature(world)
  const summary = entry.timelineSummaries?.find(item => item.checkpointId === checkpointId && item.sourceText === content && item.orderSignature === orderSignature && item.mode === mode)
  return { checkpointId, content, summary: summary?.content, orderSignature, mode }
}
/** Resolve once, then discard all alternate bodies and cached summaries from the request snapshot. */
export function resolveTimelineEntities(entities: ArcEntity[], cutoff: StoryCutoff, world: TimelineWorld): ArcEntity[] {
  return entities.map(entity => {
    if (entity.type !== 'codexEntry') return entity
    const entry = entity as CodexEntryEntity, state = resolveCodexState(entry, cutoff, world)
    const { checkpoints: _checkpoints, timelineSummaries: _summaries, seriesSnapshotSignature: _signature, ...safe } = entry
    return { ...safe, content: state.content, timelineResolved: true, timelineSummary: state.summary }
  })
}

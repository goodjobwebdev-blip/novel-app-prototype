import Dexie from 'dexie'
import type { ArcEntity, BookEntity, CodexDependencyEdge, CodexEntryEntity, Illustration } from './persistence'
import type { GalleryImage } from './image-generation-types'
import { documentBlocks, encodeDocumentBlock } from './document-projection.ts'

const syncing = new WeakSet<object>()
export function codexScopeLabel(entry: ArcEntity) {
  return entry.codexScope === 'series' ? 'Series source' : entry.codexScope === 'inherited' ? 'Inherited from series' : entry.codexScope === 'override' ? 'Book override' : 'Book-only'
}
export function detachedCodex(entry: CodexEntryEntity): CodexEntryEntity {
  const { seriesSourceId: _source, seriesSourceSeriesId: _series, seriesSnapshotSignature: _signature, hiddenInBook: _hidden, codexScope: _scope, ...local } = entry
  return { ...local, ...(_hidden ? { archivedAt: entry.archivedAt || Date.now() } : {}) } as CodexEntryEntity
}
export function installSeriesCodexHooks(db: Dexie) {
  db.table('entities').hook('updating', (changes, _id, current: ArcEntity, transaction) => {
    if (syncing.has(transaction) || current.type !== 'codexEntry') return
    const fields = ['title', 'content', 'category', 'autoIncludeTriggers', 'primaryImageId', 'archivedAt', 'preferSummaryForContext']
    if (!fields.some(field => Object.keys(changes).some(key => key === field || key.startsWith(field + '.')))) return
    if (current.codexScope === 'inherited' && !('codexScope' in changes)) return { codexScope: 'override' }
    if (current.codexScope === 'series') { const revision = Math.max(Date.now(), Number(current.sourceRevision ?? 0) + 1, current.updatedAt + 1); return { sourceRevision: revision, updatedAt: revision } }
  })
}
export async function seriesTransaction<T>(db: Dexie, action: () => Promise<T>): Promise<T> {
  return db.transaction('rw', [db.table('entities'), db.table('codexDependencies'), db.table('illustrations'), db.table('galleryImages'), db.table('snapshots'), db.table('illustrationUndo')], async transaction => {
    syncing.add(transaction)
    return action()
  })
}
export async function copyCodexMedia(db: Dexie, source: CodexEntryEntity, targetId: string, bookId: string) {
  let content = source.content
  for (const item of documentBlocks(source.content).reverse()) {
    if (!item.block.assetId) continue
    const asset = await db.table('galleryImages').get(item.block.assetId) as GalleryImage | undefined
    if (!asset || (asset.bookId && asset.bookId !== source.bookId)) throw new Error(`The image in “${source.title}” is missing. Restore it before sharing this entry.`)
    const id = `series-media-${bookId}-${asset.id}`
    await db.table('galleryImages').put({ ...asset, id, bookId, kept: true, sourceIds: [] })
    content = content.slice(0, item.from) + encodeDocumentBlock({ ...item.block, assetId: id }) + content.slice(item.to)
  }
  const illustration = await db.table('illustrations').where('entryId').equals(source.id).first() as Illustration | undefined
  await db.table('illustrations').where('entryId').equals(targetId).delete()
  let primaryImageId: string | undefined
  if (illustration) {
    primaryImageId = `series-image-${targetId}-${illustration.id}`
    await db.table('illustrations').put({ ...illustration, id: primaryImageId, entryId: targetId, bookId })
  }
  return { content, primaryImageId }
}
async function removeProxy(db: Dexie, entry: CodexEntryEntity) {
  await db.table('entities').delete(entry.id)
  await db.table('entities').where('parentId').equals(entry.id).filter((item: ArcEntity) => item.type === 'summary').delete()
  await db.table('codexDependencies').filter((edge: CodexDependencyEdge) => edge.sourceId === entry.id || edge.targetId === entry.id).delete()
  await db.table('illustrations').where('entryId').equals(entry.id).delete()
  await db.table('illustrationUndo').delete(entry.id)
  // Keep gallery assets and snapshots: other documents or history may still reference them.
}
export async function detachSeriesCodex(db: Dexie, bookId: string, policy: 'keep' | 'remove' = 'keep') {
  const entries = await db.table('entities').where('bookId').equals(bookId).toArray() as CodexEntryEntity[]
  for (const entry of entries.filter(item => item.type === 'codexEntry' && item.seriesSourceId)) {
    if (entry.codexScope === 'override' || (policy === 'keep' && !entry.hiddenInBook && !entry.archivedAt)) await db.table('entities').put(detachedCodex(entry))
    else await removeProxy(db, entry)
  }
}
export async function synchronizeCodexEntity(db: Dexie, entityId: string) {
  const entry = await db.table('entities').get(entityId) as CodexEntryEntity | undefined
  if (entry?.seriesSourceId && entry.bookId) await synchronizeSeriesCodex(db, entry.bookId)
}
export async function synchronizeSeriesCodex(db: Dexie, bookId: string): Promise<void> {
  if (Dexie.currentTransaction) return
  const changed: string[] = []
  await seriesTransaction(db, async () => {
    const book = await db.table('entities').get(bookId) as BookEntity | undefined
    if (book?.type !== 'book') return
    const local = (await db.table('entities').where('bookId').equals(bookId).toArray() as CodexEntryEntity[]).filter(item => item.type === 'codexEntry')
    const series = book.seriesId ? await db.table('entities').get(book.seriesId) : undefined
    const sources = series?.type === 'series' ? (await db.table('entities').where('bookId').equals(series.id).toArray() as CodexEntryEntity[]).filter(item => item.type === 'codexEntry' && item.codexScope === 'series') : []
    const bySource = new Map(sources.map(source => [source.id, source]))
    const proxies = new Map(local.filter(entry => entry.seriesSourceId && entry.seriesSourceSeriesId === book.seriesId).map(entry => [entry.seriesSourceId!, entry]))
    for (const entry of local.filter(item => item.seriesSourceId)) {
      if (entry.seriesSourceSeriesId !== book.seriesId) {
        if (entry.codexScope === 'override' || (!entry.hiddenInBook && !entry.archivedAt)) await db.table('entities').put(detachedCodex(entry))
        else await removeProxy(db, entry)
      } else if (!bySource.has(entry.seriesSourceId!)) {
        if (entry.codexScope === 'override') await db.table('entities').put(detachedCodex(entry))
        else await removeProxy(db, entry)
      }
    }
    for (const source of sources) if (!proxies.has(source.id)) {
      const id = `codex-${crypto.randomUUID()}`
      proxies.set(source.id, { ...source, id, bookId, parentId: bookId, codexScope: 'inherited', seriesSourceId: source.id, seriesSourceSeriesId: book.seriesId })
    }
    const edges = series ? await db.table('codexDependencies').where('bookId').equals(series.id).toArray() as CodexDependencyEdge[] : []
    for (const source of sources) {
      const proxy = proxies.get(source.id)!
      if (proxy.codexScope === 'override') continue
      const outgoing = edges.filter(edge => edge.sourceId === source.id && bySource.has(edge.targetId))
      const signature = JSON.stringify([source, outgoing])
      if (proxy.seriesSnapshotSignature === signature) continue
      const media = await copyCodexMedia(db, source, proxy.id, bookId)
      const next: CodexEntryEntity = { ...source, ...media, id: proxy.id, bookId, parentId: bookId, codexScope: 'inherited', seriesSourceId: source.id, seriesSourceSeriesId: book.seriesId, seriesSnapshotSignature: signature, hiddenInBook: proxy.hiddenInBook, createdAt: proxy.createdAt }
      await db.table('entities').put(next)
      changed.push(proxy.id)
      await db.table('codexDependencies').where('[bookId+sourceId]').equals([bookId, proxy.id]).delete()
      for (const edge of outgoing) await db.table('codexDependencies').put({ ...edge, id: `series-edge-${bookId}-${edge.id}`, bookId, sourceId: proxy.id, targetId: proxies.get(edge.targetId)!.id })
    }
  })
  if (typeof window !== 'undefined') for (const entryId of changed) window.dispatchEvent(new CustomEvent('arc-illustrations-changed', { detail: { entryId } }))
}

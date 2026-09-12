import { ensureLoreTypesWithDb, resolveLoreType } from './lore-types'
import { database, getEntity, type BookEntity, type CodexEntryEntity, type CodexDependencyEdge } from './persistence'
import { copyCodexMedia, detachedCodex, seriesTransaction, synchronizeSeriesCodex } from './series-codex'
const notify = (bookId: string, entityId?: string) => { if (typeof window !== 'undefined') { window.dispatchEvent(new CustomEvent('arc-entity-changed', { detail: { bookId, entityId } })); window.dispatchEvent(new Event('arc-series-codex-changed')) } }
export async function seriesCodexState(bookId: string) {
  const db = await database(); await synchronizeSeriesCodex(db, bookId)
  const book = await db.table('entities').get(bookId) as BookEntity | undefined
  const series = book?.seriesId ? await db.table('entities').get(book.seriesId) : undefined
  const sources = series ? (await db.table('entities').where('bookId').equals(series.id).toArray() as CodexEntryEntity[]).filter(item => item.type === 'codexEntry' && item.codexScope === 'series') : []
  const locals = (await db.table('entities').where('bookId').equals(bookId).toArray() as CodexEntryEntity[]).filter(item => item.type === 'codexEntry')
  const books = series ? (await db.table('entities').where('type').equals('book').toArray() as BookEntity[]).filter(item => item.seriesId === series.id) : []
  return { book, series, sources, locals, books }
}
export async function editCodexForBook(bookId: string, entryId: string) {
  const db = await database(); await synchronizeSeriesCodex(db, bookId)
  const entry = await db.transaction('rw', db.table('entities'), async () => {
    const current = await db.table('entities').get(entryId) as CodexEntryEntity | undefined
    if (current?.type !== 'codexEntry' || current.bookId !== bookId || current.hiddenInBook) throw new Error('This entry is not available in this book.')
    const next = current.seriesSourceId ? { ...current, codexScope: 'override' as const } : current
    await db.table('entities').put(next); return next
  })
  notify(bookId, entryId); return entry
}
export async function setSeriesEntryHidden(bookId: string, entryId: string, hidden: boolean) {
  const db = await database(); await synchronizeSeriesCodex(db, bookId)
  await db.transaction('rw', db.table('entities'), async () => {
    const entry = await db.table('entities').get(entryId) as CodexEntryEntity | undefined
    if (!entry?.seriesSourceId || entry.bookId !== bookId) throw new Error('This entry is not inherited by this book.')
    await db.table('entities').update(entryId, { hiddenInBook: hidden })
  }); notify(bookId, entryId)
}
export async function resetCodexToSeries(bookId: string, entryId: string, expected: string) {
  const db = await database(); await synchronizeSeriesCodex(db, bookId)
  await seriesTransaction(db, async () => {
    const entry = await db.table('entities').get(entryId) as CodexEntryEntity | undefined
    if (!entry?.seriesSourceId || entry.bookId !== bookId || JSON.stringify(entry) !== expected) throw new Error('This entry changed. Review the reset again.')
    if (!(await db.table('entities').get(entry.seriesSourceId))) throw new Error('The series source no longer exists.')
    await db.table('entities').put({ ...entry, codexScope: 'inherited', seriesSnapshotSignature: undefined })
  }); await synchronizeSeriesCodex(db, bookId); notify(bookId, entryId)
}
export async function promoteCodexToSeries(bookId: string, entryId: string) {
  const db = await database(); await synchronizeSeriesCodex(db, bookId)
  const source = await seriesTransaction(db, async () => {
    const book = await db.table('entities').get(bookId) as BookEntity | undefined
    const series = book?.seriesId ? await db.table('entities').get(book.seriesId) : undefined
    const entry = await db.table('entities').get(entryId) as CodexEntryEntity | undefined
    if (!series || series.type !== 'series' || entry?.type !== 'codexEntry' || entry.bookId !== bookId || entry.seriesSourceId) throw new Error('Choose a book-only entry in a series book.')
    const seriesType = resolveLoreType(await ensureLoreTypesWithDb(db, series.id), entry.typeId ?? entry.category)
    if (!seriesType) throw new Error('This is a book-only lore type. Assign a series type before sharing the entry.')
    const existing = await db.table('entities').where('bookId').equals(series.id).toArray() as CodexEntryEntity[]
    if (existing.some(item => item.type === 'codexEntry' && item.title.trim().toLocaleLowerCase() === entry.title.trim().toLocaleLowerCase())) throw new Error(`A series entry named “${entry.title}” already exists. Rename this local entry or use the existing source; no content was overwritten.`)
    const outgoing = await db.table('codexDependencies').where('[bookId+sourceId]').equals([bookId, entryId]).toArray() as CodexDependencyEdge[]
    const targets = new Map<string, string>()
    for (const edge of outgoing) {
      const target = await db.table('entities').get(edge.targetId) as CodexEntryEntity | undefined
      if (!target?.seriesSourceId || target.seriesSourceSeriesId !== series.id) throw new Error('Promote local dependency targets first, or remove those relationships before sharing this entry.')
      targets.set(edge.targetId, target.seriesSourceId)
    }
    const id = `codex-${crypto.randomUUID()}`, now = Date.now()
    const media = await copyCodexMedia(db, entry, id, series.id)
    const source: CodexEntryEntity = { ...detachedCodex(entry), ...media, id, bookId: series.id, parentId: series.id, codexScope: 'series', typeId: seriesType.id, category: seriesType.name, updatedAt: now, sourceRevision: now }
    await db.table('entities').put(source)
    for (const edge of outgoing) await db.table('codexDependencies').put({ ...edge, id: `dependency-${crypto.randomUUID()}`, bookId: series.id, sourceId: id, targetId: targets.get(edge.targetId)! })
    await db.table('entities').put({ ...entry, codexScope: 'inherited', seriesSourceId: source.id, seriesSourceSeriesId: series.id, seriesSnapshotSignature: undefined })
    return source
  }); await synchronizeSeriesCodex(db, bookId); notify(bookId, entryId); return source
}
export async function readSeriesSource(bookId: string, sourceId: string) {
  const state = await seriesCodexState(bookId)
  const source = state.sources.find(item => item.id === sourceId)
  if (!source) throw new Error('This source is no longer part of the book’s series.')
  const db = await database()
  const edges = await db.table('codexDependencies').where('[bookId+sourceId]').equals([source.bookId, sourceId]).toArray() as CodexDependencyEdge[]
  return { ...state, source, edges }
}
export type SeriesSourceDraft = Pick<CodexEntryEntity, 'title' | 'content' | 'category' | 'typeId' | 'autoIncludeTriggers'> & { edges: Array<Pick<CodexDependencyEdge, 'targetId' | 'relationLabel' | 'includeWithSource'>> }
export function seriesSourceDraft(source: CodexEntryEntity, edges: CodexDependencyEdge[]): SeriesSourceDraft { return { title: source.title, content: source.content, category: source.category, typeId: source.typeId, autoIncludeTriggers: [...(source.autoIncludeTriggers ?? [])], edges: edges.map(({ targetId, relationLabel, includeWithSource }) => ({ targetId, relationLabel, includeWithSource })) } }
export async function saveSeriesSource(bookId: string, sourceId: string, before: SeriesSourceDraft, draft: SeriesSourceDraft) {
  const db = await database()
  await seriesTransaction(db, async () => {
    const book = await db.table('entities').get(bookId) as BookEntity | undefined
    const source = await db.table('entities').get(sourceId) as CodexEntryEntity | undefined
    if (!source || source.codexScope !== 'series' || source.bookId !== book?.seriesId || source.archivedAt) throw new Error('This series source is unavailable or archived.')
    const edges = await db.table('codexDependencies').where('[bookId+sourceId]').equals([source.bookId, sourceId]).toArray() as CodexDependencyEdge[]
    if (JSON.stringify(seriesSourceDraft(source, edges)) !== JSON.stringify(before)) throw new Error('The series source changed. Reopen it before saving.')
    if (!draft.title.trim()) throw new Error('Enter a title.')
    const targets = new Set<string>()
    for (const edge of draft.edges) {
      const target = await db.table('entities').get(edge.targetId) as CodexEntryEntity | undefined
      if (!target || target.codexScope !== 'series' || target.bookId !== source.bookId || target.id === source.id || targets.has(target.id)) throw new Error('Relationships must target distinct entries in this series.')
      targets.add(target.id)
    }
    const type = resolveLoreType(await ensureLoreTypesWithDb(db, source.bookId), draft.typeId ?? draft.category)
    if (!type) throw new Error('Choose a series lore type. Book-only types cannot be assigned to a series source.')
    const { edges: _edges, ...fields } = draft
    const now = Math.max(Date.now(), source.updatedAt + 1, (source.sourceRevision ?? 0) + 1)
    await db.table('entities').put({ ...source, ...fields, typeId: type.id, category: type.name, title: draft.title.trim(), sourceRevision: now, updatedAt: now })
    await db.table('codexDependencies').where('[bookId+sourceId]').equals([source.bookId, sourceId]).delete()
    for (const edge of draft.edges) await db.table('codexDependencies').put({ ...edge, id: `dependency-${crypto.randomUUID()}`, bookId: source.bookId, sourceId, createdAt: now, updatedAt: now })
  }); await synchronizeSeriesCodex(db, bookId); notify(bookId)
}
export async function deleteSeriesSource(bookId: string, sourceId: string) {
  const state = await readSeriesSource(bookId, sourceId), db = await database()
  // Materialize every affected book before removing shared media. Overrides already own their copies.
  for (const book of state.books) await synchronizeSeriesCodex(db, book.id)
  await seriesTransaction(db, async () => {
    const current = await db.table('entities').get(sourceId)
    if (current?.codexScope !== 'series' || current.bookId !== state.series?.id) throw new Error('This shared source changed.')
    await db.table('entities').delete(sourceId)
    await db.table('codexDependencies').filter((edge: CodexDependencyEdge) => edge.sourceId === sourceId || edge.targetId === sourceId).delete()
    await db.table('illustrations').where('entryId').equals(sourceId).delete()
  })
  for (const book of state.books) await synchronizeSeriesCodex(db, book.id)
  notify(bookId)
}
export async function archiveSeriesSource(bookId: string, sourceId: string, archived: boolean) {
  const state = await readSeriesSource(bookId, sourceId), db = await database()
  await db.table('entities').update(state.source.id, { archivedAt: archived ? Date.now() : undefined, updatedAt: Date.now() })
  await synchronizeSeriesCodex(db, bookId); notify(bookId)
}
export async function refreshSeriesBook(bookId: string) { const db = await database(); await synchronizeSeriesCodex(db, bookId); return getEntity<BookEntity>(bookId) }

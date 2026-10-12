import { createBook, database, type ArcEntity, type BookEntity, type CodexDependencyEdge, type CodexEntryEntity, type DocumentSnapshot, type Illustration, type IllustrationUndo, type WorldEntity } from '../../data/persistence.ts'
import type { AiSettings } from '../../shared/ai/ai-settings'
import { ensureLoreTypesWithDb, resolveLoreType, storedLoreTypes, type LoreType } from '../codex/lore-types.ts'
import { documentBlocks, remapDocumentBlocks } from '../editor/document-projection.ts'
import { remapArticleLinks } from '../codex/codex-article-links.ts'
import type { GalleryImage } from '../images/image-generation-types'
import type Dexie from 'dexie'

export type { WorldEntity } from '../../data/persistence.ts'
export { getWorld } from '../../data/persistence.ts'
export type WorldTriggerConflict = { entryId: string; title: string; trigger: string; bookId?: string; bookTitle?: string }
const triggerKey = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`
const revision = (entity: ArcEntity) => Math.max(Date.now(), entity.updatedAt + 1)

/** Archived and draft entries still reserve their owner's triggers. */
export function codexTriggerConflicts(entry: CodexEntryEntity, triggers: string[], entries: CodexEntryEntity[]): WorldTriggerConflict[] {
  const wanted = new Set(triggers.map(triggerKey).filter(Boolean))
  const conflicts: WorldTriggerConflict[] = []
  for (const other of entries) {
    if (other.type !== 'codexEntry' || other.id === entry.id || other.bookId !== entry.bookId) continue
    const seen = new Set<string>()
    for (const trigger of other.autoIncludeTriggers ?? []) {
      const key = triggerKey(trigger)
      if (wanted.has(key) && !seen.has(key)) { conflicts.push({ entryId: other.id, title: other.title, trigger: trigger.trim().replace(/\s+/g, ' ') }); seen.add(key) }
    }
  }
  return conflicts
}

export function entityAvailableInBook(entity: ArcEntity | undefined, book: BookEntity | undefined): boolean {
  if (!entity || book?.type !== 'book') return false
  if (entity.worldId === undefined) return entity.bookId === book.id || (entity.type === 'book' && entity.id === book.id)
  if (!book.worldId || entity.worldId !== book.worldId || entity.bookId !== book.worldId || !['codexEntry', 'summary'].includes(entity.type)) return false
  const entryId = entity.type === 'summary' ? String(entity.sourceEntityId ?? entity.parentId ?? '') : entity.id
  return !(book.hiddenWorldEntryIds ?? []).includes(entryId)
}

export function entityAvailableInOwner(entity: ArcEntity | undefined, owner: BookEntity | WorldEntity | undefined): boolean {
  if (!entity || !owner) return false
  if (owner.type === 'book') return entityAvailableInBook(entity, owner)
  return entity.id === owner.id && entity.type === 'world' || entity.bookId === owner.id && entity.worldId === owner.id && ['codexEntry', 'summary', 'note', 'chat', 'chatMessage', 'settings'].includes(entity.type)
}
export function worldTransaction<T>(db: Dexie, action: () => Promise<T>): Promise<T> {
  return db.transaction('rw', ['entities', 'codexDependencies', 'snapshots', 'illustrations', 'illustrationUndo', 'galleryImages', 'imageJobs'].map(name => db.table(name)), action)
}
function notify(bookIds: string[]) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event('arc-worlds-changed'))
  for (const bookId of new Set(bookIds)) window.dispatchEvent(new CustomEvent('arc-entity-changed', { detail: { bookId } }))
}
async function requireWorld(db: Dexie, worldId: string): Promise<WorldEntity> {
  const world = await db.table('entities').get(worldId) as WorldEntity | undefined
  if (world?.type !== 'world') throw new Error('This World no longer exists.')
  return world
}
async function requireBook(db: Dexie, bookId: string): Promise<BookEntity> {
  const book = await db.table('entities').get(bookId) as BookEntity | undefined
  if (book?.type !== 'book') throw new Error('This Book no longer exists.')
  return book
}
async function members(db: Dexie, worldId: string): Promise<BookEntity[]> {
  return (await db.table('entities').where('worldId').equals(worldId).toArray() as BookEntity[]).filter(book => book.type === 'book')
}
async function ownedEntries(db: Dexie, ownerId: string): Promise<CodexEntryEntity[]> {
  return (await db.table('entities').where('bookId').equals(ownerId).toArray() as CodexEntryEntity[]).filter(entry => entry.type === 'codexEntry')
}
async function requireEntry(db: Dexie, entryId: string): Promise<CodexEntryEntity> {
  const entry = await db.table('entities').get(entryId) as CodexEntryEntity | undefined
  if (entry?.type !== 'codexEntry') throw new Error('This Codex entry no longer exists.')
  return entry
}
function blockConflicts(conflicts: WorldTriggerConflict[]) {
  if (conflicts.length) throw Object.assign(new Error(`Automatic trigger “${conflicts[0].trigger}” conflicts with “${conflicts[0].title}”. Resolve trigger conflicts before transferring this entry.`), { conflicts })
}
function cleanTitle(title: string) {
  const clean = title.trim()
  if (!clean) throw new Error('Enter a World title.')
  return clean
}
export async function listWorlds(): Promise<WorldEntity[]> {
  return (await (await database()).table('entities').where('type').equals('world').toArray() as WorldEntity[]).sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
}
export async function createWorld(title = 'Untitled World'): Promise<WorldEntity> {
  const db = await database(), now = Date.now()
  const world: WorldEntity = { id: id('world'), type: 'world', title: cleanTitle(title), createdAt: now, updatedAt: now }
  await db.transaction('rw', db.table('entities'), async () => { await db.table('entities').add(world); await ensureLoreTypesWithDb(db, world.id) })
  notify([])
  return (await db.table('entities').get(world.id)) as WorldEntity
}
export async function renameWorld(worldId: string, title: string, expectedUpdatedAt?: number): Promise<WorldEntity> {
  const db = await database()
  const result: { next: WorldEntity; books: BookEntity[]; changed: boolean } = await db.transaction('rw', db.table('entities'), async () => {
    const world = await requireWorld(db, worldId)
    if (expectedUpdatedAt !== undefined && world.updatedAt !== expectedUpdatedAt) throw new Error('This World changed. Read it again before renaming.')
    const nextTitle = cleanTitle(title)
    if (world.title === nextTitle) return { next: world, books: [], changed: false }
    const next = { ...world, title: nextTitle, updatedAt: revision(world) }
    await db.table('entities').put(next)
    return { next, books: await members(db, worldId), changed: true }
  })
  if (result.changed) notify(result.books.map(book => book.id))
  return result.next
}

/** Materialize inherited custom types before disconnecting; local entries/templates keep their meaning. */
async function localizeWorldTypes(db: Dexie, book: BookEntity) {
  const effective = await ensureLoreTypesWithDb(db, book.id)
  const current = await requireBook(db, book.id)
  const own = storedLoreTypes(current), ids = new Set(own.map(type => type.id))
  const inherited = effective.filter(type => !type.builtin && !ids.has(type.id))
  if (inherited.length) await db.table('entities').update(book.id, { loreTypes: [...own, ...inherited.map((type, index) => ({ ...type, ownerId: book.id, order: own.length + index }))] })
}
async function pruneUnavailableEdges(db: Dexie, book: BookEntity) {
  const entries = [...await ownedEntries(db, book.id), ...(book.worldId ? await ownedEntries(db, book.worldId) : [])]
  const available = new Set(entries.filter(entry => entityAvailableInBook(entry, book)).map(entry => entry.id))
  await db.table('codexDependencies').where('bookId').equals(book.id).filter((edge: CodexDependencyEdge) => !available.has(edge.sourceId) || !available.has(edge.targetId)).delete()
}
export type WorldDeletionImpact = { worldId: string; entries: number; notes: number; chats: number; messages: number; linkedBooks: number; canDelete: boolean }
async function worldDeletionImpactWithDb(db: Dexie, worldId: string): Promise<WorldDeletionImpact> {
  await requireWorld(db, worldId)
  const rows = await db.table('entities').where('bookId').equals(worldId).toArray() as ArcEntity[]
  const count = (type: string) => rows.filter(row => row.type === type).length
  const entries = count('codexEntry'), notes = count('note'), chats = count('chat'), messages = count('chatMessage')
  // Summaries may survive a damaged/legacy source tree; never delete authored
  // content merely because the four navigation counts happen to be zero.
  const worldRows = await db.table('entities').where('worldId').equals(worldId).toArray() as ArcEntity[]
  const hasContent = [...rows, ...worldRows].some(row => !['settings', 'book', 'world'].includes(row.type))
  return { worldId, entries, notes, chats, messages, linkedBooks: (await members(db, worldId)).length, canDelete: !hasContent }
}
export async function getWorldDeletionImpact(worldId: string): Promise<WorldDeletionImpact> {
  const db = await database()
  return db.transaction('r', db.table('entities'), () => worldDeletionImpactWithDb(db, worldId))
}
export type BookWorldChangeOptions = { confirmed?: boolean; expectedWorldId?: string }
export type BookWorldChangeImpact = {
  bookId: string; bookTitle: string; previousWorldId: string; previousWorldTitle: string; nextWorldId: string; nextWorldTitle: string;
  lostEntryIds: string[]; gainedEntryIds: string[]; unavailableDependencies: number; requiresConfirmation: boolean
}
export async function getBookWorldChangeImpact(bookId: string, worldId: string): Promise<BookWorldChangeImpact> {
  const db = await database()
  return db.transaction('r', db.table('entities'), db.table('codexDependencies'), async () => {
    const book = await requireBook(db, bookId)
    const previous = book.worldId ? await requireWorld(db, book.worldId) : undefined
    const next = worldId ? await requireWorld(db, worldId) : undefined
    const changed = (book.worldId ?? '') !== worldId
    const lostEntryIds = changed && previous ? (await ownedEntries(db, previous.id)).filter(entry => entityAvailableInBook(entry, book)).map(entry => entry.id) : []
    const gainedEntryIds = changed && next ? (await ownedEntries(db, next.id)).map(entry => entry.id) : []
    const available = new Set([...await ownedEntries(db, book.id), ...(next ? await ownedEntries(db, next.id) : [])].map(entry => entry.id))
    const edges = await db.table('codexDependencies').where('bookId').equals(book.id).toArray() as CodexDependencyEdge[]
    return { bookId, bookTitle: book.title, previousWorldId: previous?.id ?? '', previousWorldTitle: previous?.title ?? '', nextWorldId: next?.id ?? '', nextWorldTitle: next?.title ?? '', lostEntryIds, gainedEntryIds, unavailableDependencies: changed ? edges.filter(edge => !available.has(edge.sourceId) || !available.has(edge.targetId)).length : 0, requiresConfirmation: changed && Boolean(previous) }
  })
}
/** Safe interactive boundary. setBookWorld remains the explicit low-level compatibility operation. */
export async function changeBookWorld(bookId: string, worldId: string, options: BookWorldChangeOptions = {}): Promise<BookEntity> {
  return setBookWorld(bookId, worldId, options)
}
export async function listWorldBooks(worldId: string): Promise<BookEntity[]> {
  const db = await database()
  return db.transaction('r', db.table('entities'), async () => { await requireWorld(db, worldId); return members(db, worldId) })
}
export async function createBookInWorld(worldId: string, defaults: AiSettings, title = 'Untitled Book'): Promise<Awaited<ReturnType<typeof createBook>>> {
  const db = await database()
  return worldTransaction(db, async () => {
    await requireWorld(db, worldId)
    const created = await createBook(defaults, title)
    const book = await setBookWorld(created.book.id, worldId)
    return { ...created, book }
  })
}
export async function deleteWorld(worldId: string): Promise<void> {
  const db = await database()
  const affected = await worldTransaction(db, async () => {
    await requireWorld(db, worldId)
    const impact = await worldDeletionImpactWithDb(db, worldId)
    if (!impact.canDelete) throw Object.assign(new Error(`Only an empty World can be deleted. Remove its ${impact.entries} Codex entries, ${impact.notes} Notes, ${impact.chats} Chats and ${impact.messages} Chat messages first.`), { impact })
    const books = await members(db, worldId)
    for (const book of books) {
      await localizeWorldTypes(db, book)
      const current = await requireBook(db, book.id)
      const { worldId: _world, hiddenWorldEntryIds: _hidden, ...local } = current
      await db.table('entities').put({ ...local, updatedAt: revision(current) })
      await pruneUnavailableEdges(db, local)
    }
    const owned = await db.table('entities').where('bookId').equals(worldId).toArray() as ArcEntity[]
    await db.table('snapshots').where('entityId').anyOf([worldId, ...owned.map(row => row.id)]).delete()
    await db.table('entities').where('bookId').equals(worldId).delete()
    await db.table('codexDependencies').where('bookId').equals(worldId).delete()
    await db.table('illustrations').where('bookId').equals(worldId).delete()
    await db.table('illustrationUndo').where('bookId').equals(worldId).delete()
    await db.table('galleryImages').where('bookId').equals(worldId).delete()
    await db.table('imageJobs').where('bookId').equals(worldId).delete()

    await db.table('entities').delete(worldId)
    return books.map(book => book.id)
  })
  notify(affected)
}
export async function listWorldEntries(worldId: string): Promise<CodexEntryEntity[]> {
  const db = await database()
  return db.transaction('r', db.table('entities'), async () => { await requireWorld(db, worldId); return ownedEntries(db, worldId) })
}
export async function listBookCodexEntries(bookId: string, includeHidden = false): Promise<CodexEntryEntity[]> {
  const db = await database()
  return db.transaction('r', db.table('entities'), async () => {
    const book = await requireBook(db, bookId)
    return [...await ownedEntries(db, bookId), ...(book.worldId ? await ownedEntries(db, book.worldId) : [])].filter(entry => includeHidden || entityAvailableInBook(entry, book))
  })
}
export async function setBookWorld(bookId: string, worldId: string, options?: BookWorldChangeOptions): Promise<BookEntity> {
  const db = await database()
  const result = await worldTransaction(db, async () => {
    const book = await requireBook(db, bookId)
    if (options?.expectedWorldId !== undefined && (book.worldId ?? '') !== options.expectedWorldId) throw new Error('The Book World link changed. Read its impact again before confirming.')
    if (worldId) await requireWorld(db, worldId)
    if ((book.worldId ?? '') === worldId) return { book, changed: false }
    if (options && book.worldId && !options.confirmed) throw new Error('Confirm the loss of shared lore before changing this Book World link.')
    await localizeWorldTypes(db, book)
    const current = await requireBook(db, bookId)
    const { worldId: _old, hiddenWorldEntryIds: _hidden, ...local } = current
    const next: BookEntity = { ...local, ...(worldId ? { worldId } : {}), updatedAt: revision(current) }
    await db.table('entities').put(next)
    await ensureLoreTypesWithDb(db, bookId)
    await pruneUnavailableEdges(db, next)
    return { book: await requireBook(db, bookId), changed: true }
  })
  if (result.changed) notify([bookId])
  return result.book
}
export async function setWorldEntryHidden(bookId: string, entryId: string, hidden: boolean): Promise<void> {
  const db = await database()
  const changed: boolean = await db.transaction('rw', db.table('entities'), async () => {
    const book = await requireBook(db, bookId), entry = await requireEntry(db, entryId)
    if (!book.worldId || entry.worldId !== book.worldId) throw new Error('This entry does not belong to the connected World.')
    const ids = new Set(book.hiddenWorldEntryIds ?? [])
    if (ids.has(entryId) === hidden) return false
    if (hidden) ids.add(entryId); else ids.delete(entryId)
    await db.table('entities').update(bookId, { hiddenWorldEntryIds: [...ids], updatedAt: revision(book) })
    return true
  })
  if (changed) notify([bookId])
}
async function transferWithDb(db: Dexie, bookId: string, entryId: string) {
  const book = await requireBook(db, bookId), entry = await requireEntry(db, entryId)
  if (!book.worldId) throw new Error('Connect this Book to a World first.')
  await requireWorld(db, book.worldId)
  if (entry.bookId !== bookId && entry.worldId !== book.worldId) throw new Error('This entry is not owned by this Book or its connected World.')
  const ownerId = entry.worldId ? bookId : book.worldId
  const candidate = { ...entry, bookId: ownerId }
  return { book, entry, conflicts: codexTriggerConflicts(candidate, entry.autoIncludeTriggers ?? [], await ownedEntries(db, ownerId)) }
}
export async function worldTransferConflicts(bookId: string, entryId: string): Promise<WorldTriggerConflict[]> {
  const db = await database()
  return db.transaction('r', db.table('entities'), async () => (await transferWithDb(db, bookId, entryId)).conflicts)
}

async function transferType(db: Dexie, entry: CodexEntryEntity, ownerId: string): Promise<Pick<CodexEntryEntity, 'typeId' | 'category'>> {
  const sourceTypes = await ensureLoreTypesWithDb(db, entry.bookId)
  const sourceType = sourceTypes.find(type => type.id === entry.typeId) ?? resolveLoreType(sourceTypes, entry.category)
  const types = await ensureLoreTypesWithDb(db, ownerId)
  let type = types.find(type => type.id === sourceType?.id) ?? resolveLoreType(types, sourceType?.name ?? entry.category)
  if (!type) {
    const owner = await db.table('entities').get(ownerId) as ArcEntity
    const own = storedLoreTypes(owner)
    type = { ...sourceType, id: sourceType?.id ?? id('lore'), name: sourceType?.name ?? entry.category, builtin: false, ownerId, order: own.length } as LoreType
    await db.table('entities').update(ownerId, { loreTypes: [...own, type] })
  }
  return { typeId: type.id, category: type.name }
}
/** Copies referenced gallery assets rather than reassigning assets that other documents use.
 * Move keeps document/snapshot/illustration identities; copy allocates fresh identities. */
async function transferEntry(db: Dexie, source: CodexEntryEntity, ownerId: string, worldId: string | undefined, move: boolean): Promise<CodexEntryEntity> {
  const targetId = move ? source.id : id('codex'), now = revision(source)
  const summaries = await db.table('entities').where('parentId').equals(source.id).filter((row: ArcEntity) => row.type === 'summary').toArray() as ArcEntity[]
  const snapshots = await db.table('snapshots').where('entityId').anyOf([source.id, ...summaries.map(row => row.id)]).toArray() as DocumentSnapshot[]
  const ids = new Map<string, string>([[source.id, targetId]])
  for (const summary of summaries) ids.set(summary.id, move ? summary.id : `summary-${targetId}`)
  const contentRows = [source, ...summaries, ...snapshots, ...(source.checkpoints ?? [])]
  for (const row of contentRows) for (const item of documentBlocks(row.content ?? '')) {
    if (!move && !ids.has(item.block.id)) ids.set(item.block.id, id('block'))
    const assetId = item.block.assetId
    if (!assetId || ids.has(assetId)) continue
    const asset = await db.table('galleryImages').get(assetId) as GalleryImage | undefined
    if (!asset || (asset.bookId && asset.bookId !== source.bookId)) throw new Error(`The media in “${source.title}” is missing or belongs to another owner.`)
    if (move && asset.bookId === ownerId) { ids.set(assetId, assetId); continue }
    const newId = id('world-media'); ids.set(assetId, newId)
    await db.table('galleryImages').add({ ...asset, id: newId, bookId: ownerId, kept: true, sourceIds: [] })
  }
  const type = await transferType(db, source, ownerId)
  const { worldId: _world, codexScope: _scope, seriesSourceId: _source, seriesSourceSeriesId: _series, seriesSnapshotSignature: _signature, hiddenInBook: _hidden, ...local } = source
  const remapContent = (content: string) => remapArticleLinks(remapDocumentBlocks(content, ids), ids)
  const entry: CodexEntryEntity = { ...local, ...type, id: targetId, bookId: ownerId, parentId: ownerId, ...(worldId ? { worldId } : {}), content: remapContent(source.content), updatedAt: now, createdAt: move ? source.createdAt : now }
  if (entry.checkpoints) entry.checkpoints = entry.checkpoints.map(point => ({ ...point, id: move ? point.id : id('checkpoint'), content: remapContent(point.content) }))
  const illustration = await db.table('illustrations').where('entryId').equals(source.id).first() as Illustration | undefined
  if (illustration) {
    entry.primaryImageId = move ? illustration.id : id('image')
    await db.table('illustrations').put({ ...illustration, id: entry.primaryImageId, entryId: targetId, bookId: ownerId })
  } else delete entry.primaryImageId
  const undo = await db.table('illustrationUndo').get(source.id) as IllustrationUndo | undefined
  if (move && undo) await db.table('illustrationUndo').put({ ...undo, bookId: ownerId, ...(undo.before ? { before: { ...undo.before, bookId: ownerId } } : {}) })
  await db.table('entities').put(entry)
  for (const summary of summaries) {
    const { worldId: _world, ...localSummary } = summary
    await db.table('entities').put({ ...localSummary, id: ids.get(summary.id), bookId: ownerId, ...(worldId ? { worldId } : {}), parentId: targetId, sourceEntityId: targetId, content: remapContent(summary.content ?? ''), updatedAt: now })
  }
  for (const snapshot of snapshots) await db.table('snapshots').put({ ...snapshot, id: move ? snapshot.id : id('snapshot'), entityId: ids.get(snapshot.entityId), content: remapContent(snapshot.content) })
  return entry
}
async function copyOutgoingEdges(db: Dexie, source: CodexEntryEntity, target: CodexEntryEntity, book: BookEntity) {
  const edges = await db.table('codexDependencies').where('sourceId').equals(source.id).toArray() as CodexDependencyEdge[]
  for (const edge of edges) {
    const entry = await db.table('entities').get(edge.targetId) as CodexEntryEntity | undefined
    if (entry && entityAvailableInBook(entry, { ...book, hiddenWorldEntryIds: [] })) await db.table('codexDependencies').add({ ...edge, id: id('dependency'), bookId: book.id, sourceId: target.id })
  }
}
export async function moveEntryToWorld(bookId: string, entryId: string): Promise<CodexEntryEntity> {
  const db = await database()
  const result = await worldTransaction(db, async () => {
    const { book, entry, conflicts } = await transferWithDb(db, bookId, entryId)
    if (entry.worldId || entry.bookId !== bookId) throw new Error('Only a local Book entry can be moved to its connected World.')
    blockConflicts(conflicts)
    // A World must never depend on one member Book's private lore.
    const outgoing = await db.table('codexDependencies').where('sourceId').equals(entryId).toArray() as CodexDependencyEdge[]
    for (const edge of outgoing) {
      const target = await requireEntry(db, edge.targetId)
      if (target.worldId !== book.worldId) throw new Error('Move or remove dependencies on local Book entries before moving this entry to the World.')
    }
    const moved = await transferEntry(db, entry, book.worldId!, book.worldId, true)
    for (const edge of outgoing) await db.table('codexDependencies').update(edge.id, { bookId: book.worldId })
    return { moved, books: await members(db, book.worldId!) }
  })
  notify(result.books.map(book => book.id)); return result.moved
}
export async function copyWorldEntryToBook(bookId: string, entryId: string): Promise<CodexEntryEntity> {
  const db = await database()
  const copied = await worldTransaction(db, async () => {
    const { book, entry, conflicts } = await transferWithDb(db, bookId, entryId)
    if (!entry.worldId) throw new Error('Only a World entry can be copied to this Book.')
    blockConflicts(conflicts)
    const copied = await transferEntry(db, entry, bookId, undefined, false)
    await copyOutgoingEdges(db, entry, copied, book)
    return copied
  })
  notify([bookId]); return copied
}
async function demotionWithDb(db: Dexie, worldId: string, entryId: string) {
  await requireWorld(db, worldId)
  const entry = await requireEntry(db, entryId)
  if (entry.worldId !== worldId) throw new Error('This entry is not owned by this World.')
  const books = await members(db, worldId), conflicts: WorldTriggerConflict[] = []
  for (const book of books) conflicts.push(...codexTriggerConflicts({ ...entry, bookId: book.id }, entry.autoIncludeTriggers ?? [], await ownedEntries(db, book.id)).map(conflict => ({ ...conflict, bookId: book.id, bookTitle: book.title })))
  return { books, entry, conflicts }
}
export async function worldDemotionConflicts(worldId: string, entryId: string): Promise<WorldTriggerConflict[]> {
  const db = await database()
  return db.transaction('r', db.table('entities'), async () => (await demotionWithDb(db, worldId, entryId)).conflicts)
}
export async function copyWorldEntryToAllBooksAndRemove(worldId: string, entryId: string): Promise<void> {
  const db = await database()
  const bookIds = await worldTransaction(db, async () => {
    const { books, entry, conflicts } = await demotionWithDb(db, worldId, entryId)
    if (!books.length) throw new Error('Connect at least one Book before removing the World source, to avoid losing this entry.')
    blockConflicts(conflicts)
    const incoming = await db.table('codexDependencies').where('targetId').equals(entryId).toArray() as CodexDependencyEdge[]
    if (incoming.some(edge => edge.bookId === worldId)) throw new Error('Remove incoming World dependencies before demoting this entry; World edges cannot target local copies.')
    for (const book of books) {
      const copied = await transferEntry(db, entry, book.id, undefined, false)
      await copyOutgoingEdges(db, entry, copied, book)
      for (const edge of incoming.filter(edge => edge.bookId === book.id)) await db.table('codexDependencies').update(edge.id, { targetId: copied.id })
      // Explicit context selections follow the new local identity, including hidden books.
      const rows = await db.table('entities').where('bookId').equals(book.id).toArray() as ArcEntity[]
      for (const row of rows) {
        const replacement = replaceEntryReferences(row, entryId, copied.id)
        if (JSON.stringify(replacement) !== JSON.stringify(row)) {
          replacement.updatedAt = revision(row)
          if (replacement.type === 'codexEntry' && replacement.content !== row.content) replacement.sourceRevision = replacement.updatedAt
          await db.table('entities').put(replacement)
        }
      }
      // History is owned via entityId, not bookId. Keep each Book's destination
      // independent, and rewrite within this same rollback boundary.
      const snapshots = await db.table('snapshots').where('entityId').anyOf(rows.map(row => row.id)).toArray() as DocumentSnapshot[]
      for (const snapshot of snapshots) {
        const content = remapArticleLinks(snapshot.content, new Map([[entryId, copied.id]]))
        if (content !== snapshot.content) await db.table('snapshots').update(snapshot.id, { content })
      }
      await db.table('entities').update(book.id, { hiddenWorldEntryIds: (book.hiddenWorldEntryIds ?? []).filter(value => value !== entryId), updatedAt: revision(book) })
    }
    const summaries = await db.table('entities').where('parentId').equals(entryId).toArray() as ArcEntity[]
    const removedIds = [entryId, ...summaries.map(row => row.id)]
    await db.table('entities').bulkDelete(removedIds)
    await db.table('snapshots').where('entityId').anyOf(removedIds).delete()
    await db.table('codexDependencies').where('sourceId').equals(entryId).delete()
    await db.table('codexDependencies').where('targetId').equals(entryId).delete()
    await db.table('illustrations').where('entryId').equals(entryId).delete()
    await db.table('illustrationUndo').delete(entryId)
    // Unreferenced gallery records are retained: history/other documents may use them.
    return books.map(book => book.id)
  })
  notify(bookIds)
}
function replaceEntryReferences<T>(value: T, sourceId: string, targetId: string, key = ''): T {
  if (Array.isArray(value)) return value.map(item => replaceEntryReferences(item, sourceId, targetId, key)) as T
  if (value && typeof value === 'object') {
    if (value instanceof Blob) return value
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, replaceEntryReferences(item, sourceId, targetId, name)])) as T
  }
  if (typeof value === 'string' && ['entryId', 'sourceId', 'targetId', 'sourceEntityId', 'codexEntryIds', 'sourceIds', 'linkedEntityId'].includes(key) && value === sourceId) return targetId as T
  if (key === 'directImageReferenceIds' && value === `codex:${sourceId}`) return `codex:${targetId}` as T
  if (key === 'content' && typeof value === 'string') return remapArticleLinks(value, new Map([[sourceId, targetId]])) as T
  return value
}

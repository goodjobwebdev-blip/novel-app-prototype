import type { BookArchiveData, BookEntity, DocumentSnapshot, ArcEntity } from '../../data/persistence'
import Dexie from 'dexie'
import { database, listEntitiesByBook, listCodexDependencies, readBookArchive } from '../../data/persistence'
import { encodeBookArchive, portableWorldBookSnapshot } from '../../data/book-archive'
import { storedLoreTypes } from '../codex/lore-types'
import { documentBlocks } from '../editor/document-projection'
import { sanitizeSettingsProfile, settingsProfilesForSelections, type SettingsProfile, type BookProfileSelections } from '../settings/settings-profiles'
import type { GalleryImage, ImageJob } from '../images/image-generation-types'
import { archiveContentHash } from './sync-hash'

export const SYNC_CHANGED = 'arc-sync-changed'

export type SyncStatus = 'idle' | 'checking' | 'syncing' | 'synced' | 'remote-changed' | 'conflict' | 'offline' | 'error'

export type SyncLink = {
  bookId: string
  endpoint: string
  remoteBookId: string
  createdAt: number
  updatedAt: number
}

export type BookSyncState = {
  bookId: string
  status: SyncStatus
  remoteETag: string
  localContentHash: string
  lastCheckedAt?: number
  lastSyncedAt?: number
  message?: string
  /** Retries and metadata checks cannot authorize resolving divergent copies. */
  unresolvedConflict?: boolean
  updatedAt: number
}

function notify(bookId: string) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SYNC_CHANGED, { detail: { bookId } }))
}

export async function getSyncLink(bookId: string): Promise<SyncLink | undefined> {
  return (await database()).table('syncLinks').get(bookId)
}

export async function getBookSyncState(bookId: string): Promise<BookSyncState | undefined> {
  return (await database()).table('syncState').get(bookId)
}

export async function listSyncLinks(): Promise<SyncLink[]> {
  return (await database()).table('syncLinks').toArray()
}

export async function saveSyncConnection(link: SyncLink, state: BookSyncState): Promise<void> {
  const db = await database()
  await db.transaction('rw', db.table('syncLinks'), db.table('syncState'), async () => {
    await db.table('syncLinks').put(link)
    await db.table('syncState').put(state)
  })
  notify(link.bookId)
}

export async function updateBookSyncState(bookId: string, patch: Partial<BookSyncState>): Promise<BookSyncState> {
  const db = await database()
  const next = await db.transaction('rw', db.table('syncState'), async () => {
    const current = await db.table('syncState').get(bookId) as BookSyncState | undefined
    const value: BookSyncState = { bookId, status: 'idle', remoteETag: '', localContentHash: '', ...current, ...patch, updatedAt: Date.now() }
    if (value.unresolvedConflict && patch.unresolvedConflict !== false) {
      value.status = 'conflict'
      value.message = patch.message ?? current?.message ?? 'Choose a recovery action for the different local and cloud copies.'
    }
    await db.table('syncState').put(value)
    return value
  })
  notify(bookId)
  return next
}

export async function disconnectBookSync(bookId: string): Promise<void> {
  const db = await database()
  await db.transaction('rw', db.table('syncLinks'), db.table('syncState'), async () => {
    await db.table('syncLinks').delete(bookId)
    await db.table('syncState').delete(bookId)
  })
  notify(bookId)
}

function archiveBook(data: BookArchiveData): BookEntity {
  const book = data.entities.find((entity): entity is BookEntity => entity.type === 'book')
  if (!book) throw new Error('The remote archive does not contain a book.')
  return book
}

async function assertNoTableCollisions(table: any, rows: Array<{ id: string }>, label: string) {
  if (!rows.length) return
  const existing = await table.bulkGet(rows.map(row => row.id))
  if (existing.some(Boolean)) throw new Error(`The remote ${label} conflicts with data already stored on this device.`)
}

function archiveTables(db: any) {
  return [db.table('entities'), db.table('snapshots'), db.table('codexDependencies'), db.table('illustrations'), db.table('galleryImages'), db.table('imageJobs')]
}

async function addArchiveRows(db: any, data: BookArchiveData, entities: ArcEntity[]) {
  await db.table('galleryImages').bulkAdd(data.galleryImages ?? [])
  await db.table('imageJobs').bulkAdd(data.imageJobs ?? [])
  await db.table('entities').bulkAdd(entities)
  await db.table('snapshots').bulkAdd(data.snapshots)
  await db.table('codexDependencies').bulkAdd(data.dependencies)
  await db.table('illustrations').bulkAdd(data.illustrations)
}

export async function writeConnectedBookArchive(data: BookArchiveData, link: SyncLink, state: BookSyncState): Promise<string> {
  const db = await database()
  const book = archiveBook(data)
  if (book.id !== link.bookId) throw new Error('The remote book identity does not match its archive.')
  await db.transaction('rw', ...archiveTables(db), db.table('syncLinks'), db.table('syncState'), async () => {
    const existingLink = await db.table('syncLinks').where('[endpoint+remoteBookId]').equals([link.endpoint, link.remoteBookId]).first()
    if (existingLink) throw new Error('This cloud book is already connected on this device.')
    const incomingSeries = data.entities.find(entity => entity.type === 'series' && entity.id === book.seriesId)
    const ordinaryEntities = data.entities.filter(entity => entity.id !== incomingSeries?.id)
    await assertNoTableCollisions(db.table('entities'), ordinaryEntities, 'book')
    if (incomingSeries) {
      const existingSeries = await db.table('entities').get(incomingSeries.id)
      if (existingSeries && JSON.stringify(existingSeries) !== JSON.stringify(incomingSeries)) throw new Error('A different local series uses the same identity as this cloud book.')
    }
    await assertNoTableCollisions(db.table('snapshots'), data.snapshots, 'history')
    await assertNoTableCollisions(db.table('codexDependencies'), data.dependencies, 'Codex links')
    await assertNoTableCollisions(db.table('illustrations'), data.illustrations, 'illustrations')
    await assertNoTableCollisions(db.table('galleryImages'), data.galleryImages ?? [], 'gallery media')
    await assertNoTableCollisions(db.table('imageJobs'), data.imageJobs ?? [], 'media history')
    const shouldAddSeries = incomingSeries && !await db.table('entities').get(incomingSeries.id)
    await addArchiveRows(db, data, shouldAddSeries ? data.entities : ordinaryEntities)
    await db.table('syncLinks').add(link)
    await db.table('syncState').add(state)
  })
  notify(book.id)
  return book.id
}

/** Read-only counterpart of readBookArchive after its migrations have run.
 * It must stay inside the replacement transaction: calling the migration queue
 * here would escape the lock or deadlock behind an unrelated queued writer. */
async function currentArchive(db: any, book: BookEntity): Promise<BookArchiveData> {
  const bookId = book.id
  const entries = await listEntitiesByBook(bookId)
  const selections = entries.find(entry => entry.type === 'settings' && entry.settingsType === 'profiles-book')
  if (!selections) throw new Error('Book profile selections changed. Retry sync.')
  const settingsProfiles = selections.definitions !== undefined
    ? (selections.definitions as SettingsProfile[]).map(sanitizeSettingsProfile)
    : settingsProfilesForSelections(selections.value as BookProfileSelections)
  const series = book.seriesId ? await db.table('entities').get(book.seriesId) : undefined
  const world = book.worldId ? await db.table('entities').get(book.worldId) as ArcEntity | undefined : undefined
  const ownTypes = storedLoreTypes(book), inheritedTypes = world ? storedLoreTypes(world) : []
  const loreTypes = inheritedTypes.length ? [...inheritedTypes, ...ownTypes.filter(type => !type.builtin && !inheritedTypes.some(inherited => inherited.id === type.id))] : ownTypes
  const snapshots = await db.table('snapshots').where('entityId').anyOf([bookId, ...entries.map(entry => entry.id)]).toArray() as DocumentSnapshot[]
  const referencedAssets = new Set([...entries, ...snapshots, ...entries.flatMap(entry => Array.isArray(entry.checkpoints) ? entry.checkpoints : [])]
    .flatMap(entry => documentBlocks(entry.content ?? '').flatMap(item => item.block.assetId ? [item.block.assetId] : [])))
  const galleryImages = (await db.table('galleryImages').where('bookId').anyOf(book.worldId ? [bookId, book.worldId] : [bookId]).toArray() as GalleryImage[])
    .filter(asset => (asset.bookId === bookId && asset.kept) || referencedAssets.has(asset.id)).map(asset => ({ ...asset, kept: true, sourceIds: [] }))
  if ([...referencedAssets].some(id => !galleryImages.some(asset => asset.id === id))) throw new Error('The local book references unavailable media. Nothing was overwritten.')
  const keptIds = new Set(galleryImages.map(asset => asset.id))
  const imageJobs = (await db.table('imageJobs').where('bookId').equals(bookId).toArray() as ImageJob[])
    .filter(job => job.status === 'completed' && job.assetId && keptIds.has(job.assetId))
    .map(({ providerJobId: _p, owner: _o, heartbeat: _h, sources: _s, localConnectionFingerprint: _identity, ...job }: ImageJob & { localConnectionFingerprint?: string }) => job)
  return portableWorldBookSnapshot({
    entities: [{ ...book, loreTypes: loreTypes.map(type => ({ ...type, ownerId: bookId })) },
      ...entries.filter(entry => !(entry.type === 'settings' && entry.settingsType === 'ai')).map(entity => entity.settingsType === 'profiles-book' ? { ...entity, definitions: settingsProfiles } : entity), ...(series ? [series] : [])],
    settingsProfiles, snapshots, galleryImages, imageJobs,
    dependencies: await listCodexDependencies(bookId),
    illustrations: await db.table('illustrations').where('entryId').anyOf(entries.filter(entry => entry.type === 'codexEntry').map(entry => entry.id)).toArray(),
  }, bookId)
}

export type BookReplacementGuard = { expectedLocalHash: string; expectedLink?: SyncLink; expectedState?: BookSyncState }

export async function replaceConnectedBookArchive(bookId: string, data: BookArchiveData, state: BookSyncState, guard?: BookReplacementGuard): Promise<'replaced' | 'conflict'> {
  // Legacy/direct restore callers also get a compare-and-swap, never an
  // unguarded force replacement. Service callers pass the pre-download hash.
  const expectedLink = guard?.expectedLink ?? await getSyncLink(bookId)
  const expectedState = guard?.expectedState ?? await getBookSyncState(bookId)
  const expectedLocalHash = guard?.expectedLocalHash ?? await archiveContentHash(encodeBookArchive(await readBookArchive(bookId)))
  if (!expectedLink || !expectedState) throw new Error('This book is no longer connected to cloud sync.')
  const db = await database()
  const incomingBook = archiveBook(data)
  if (incomingBook.id !== bookId) throw new Error('The remote archive belongs to a different book.')
  const result = await db.transaction('rw', ...archiveTables(db), db.table('illustrationUndo'), db.table('syncLinks'), db.table('syncState'), async () => {
    const link = await db.table('syncLinks').get(bookId) as SyncLink | undefined
    if (!link) throw new Error('This book is no longer connected to cloud sync.')
    if (link.endpoint !== expectedLink.endpoint || link.remoteBookId !== expectedLink.remoteBookId || link.createdAt !== expectedLink.createdAt || link.updatedAt !== expectedLink.updatedAt) throw new Error('The sync connection changed. Retry sync before applying a cloud archive.')
    const currentBook = await db.table('entities').get(bookId) as BookEntity | undefined
    if (currentBook?.type !== 'book') throw new Error('The local book no longer exists.')
    const currentState = await db.table('syncState').get(bookId) as BookSyncState | undefined
    // WebCrypto/Blob reads are not IDB requests. Keep the transaction alive
    // exactly as World archive replacement does, while holding every write lock.
    const currentHash = await Dexie.waitFor(archiveContentHash(encodeBookArchive(await currentArchive(db, currentBook))))
    if (currentHash !== expectedLocalHash || currentState?.remoteETag !== expectedState.remoteETag ||
      currentState?.localContentHash !== expectedState.localContentHash || Boolean(currentState?.unresolvedConflict) !== Boolean(expectedState.unresolvedConflict)) {
      if (!currentState) throw new Error('The sync baseline disappeared. Nothing was overwritten.')
      await db.table('syncState').put({ ...currentState, status: 'conflict', unresolvedConflict: true, message: 'Local content or the sync baseline changed while downloading. Nothing was overwritten. Choose a recovery action.', lastCheckedAt: Date.now(), updatedAt: Date.now() })
      return 'conflict' as const
    }
    const localJobs = await db.table('imageJobs').where('bookId').equals(bookId).toArray() as ImageJob[]
    const preservedJobs = localJobs.filter(job => job.status !== 'completed' || !job.decision)
    const incomingById = new Map(data.entities.map(entity => [entity.id, entity]))
    const originIds = [...new Set(preservedJobs.flatMap(job => [job.chatId, job.messageId, job.directUserMessageId].filter((value): value is string => Boolean(value))))]
    const originRows = await db.table('entities').bulkGet(originIds) as Array<ArcEntity | undefined>
    const originChanged = originRows.some((local, index) => {
      const incoming = incomingById.get(originIds[index])
      if (!local || !incoming || local.type !== incoming.type || local.bookId !== incoming.bookId || local.parentId !== incoming.parentId) return true
      if (local.type !== 'chatMessage') return false
      return local.content !== incoming.content || JSON.stringify(local.directImageClaim) !== JSON.stringify(incoming.directImageClaim) || JSON.stringify(local.directImageRequest) !== JSON.stringify(incoming.directImageRequest)
    })
    if (originChanged) {
      if (!currentState) throw new Error('The sync baseline disappeared. Nothing was overwritten.')
      await db.table('syncState').put({ ...currentState, status: 'conflict', unresolvedConflict: true, message: 'The cloud changed the Chat origin of local media work. Nothing was overwritten. Review the local generation and choose a recovery action.', lastCheckedAt: Date.now(), updatedAt: Date.now() })
      return 'conflict' as const
    }
    const incomingSeries = data.entities.find(entity => entity.type === 'series' && entity.id === incomingBook.seriesId)
    if (incomingSeries) {
      const existingSeries = await db.table('entities').get(incomingSeries.id)
      if (existingSeries && (existingSeries.type !== 'series' || existingSeries.bookId || existingSeries.parentId)) {
        throw new Error('The cloud series identity conflicts with a different local entity. Nothing was overwritten.')
      }
      if (incomingSeries.bookId || incomingSeries.parentId) throw new Error('The cloud series has an invalid owner identity.')
      if (existingSeries && JSON.stringify(existingSeries) !== JSON.stringify(incomingSeries)) {
        const otherBooks = (await db.table('entities').where('type').equals('book').toArray() as BookEntity[]).filter(book => book.id !== bookId && book.seriesId === incomingSeries.id)
        if (otherBooks.length) throw new Error('The cloud series changed, but another local book also uses that series. Import a recovery copy instead.')
      }
    }
    const currentEntities = await db.table('entities').where('bookId').equals(bookId).toArray() as ArcEntity[]
    const ids = new Set([bookId, ...currentEntities.map(entity => entity.id)])
    const snapshots = await db.table('snapshots').toArray() as DocumentSnapshot[]
    await db.table('snapshots').bulkDelete(snapshots.filter(row => ids.has(row.entityId)).map(row => row.id))
    await db.table('codexDependencies').where('bookId').equals(bookId).delete()
    await db.table('illustrations').where('bookId').equals(bookId).delete()
    await db.table('illustrationUndo').where('bookId').equals(bookId).delete()
    // Pending/retryable work and unreviewed results are deliberately absent
    // from the portable hash. They were read under the replacement lock above;
    // leave their original IDs/worker ownership untouched.
    const preservedJobIds = new Set(preservedJobs.map(job => job.id))
    const preservedAssetIds = new Set(preservedJobs.flatMap(job => job.assetId ? [job.assetId] : []))
    const localAssets = await db.table('galleryImages').where('bookId').equals(bookId).toArray() as GalleryImage[]
    await db.table('galleryImages').bulkDelete(localAssets.filter(asset => asset.kept && !preservedAssetIds.has(asset.id)).map(asset => asset.id))
    await db.table('imageJobs').bulkDelete(localJobs.filter(job => !preservedJobIds.has(job.id)).map(job => job.id))
    if ((data.galleryImages ?? []).some(asset => asset.bookId !== bookId) || (data.imageJobs ?? []).some(job => job.bookId !== bookId)) {
      throw new Error('The remote media belongs to a different book. Nothing was overwritten.')
    }
    // A cloud row cannot replace a preserved local job/result (even under the
    // same book ID), nor media owned by another book. Failure rolls back all
    // archive deletions and leaves the old sync baseline intact.
    await assertNoTableCollisions(db.table('galleryImages'), data.galleryImages ?? [], 'gallery media')
    await assertNoTableCollisions(db.table('imageJobs'), data.imageJobs ?? [], 'media history')
    await db.table('entities').bulkDelete([...ids])
    const ordinaryEntities = data.entities.filter(entity => entity.id !== incomingSeries?.id)
    if (incomingSeries) await db.table('entities').put(incomingSeries)
    await addArchiveRows(db, data, ordinaryEntities)
    await db.table('syncState').put(state)
    return 'replaced' as const
  })
  notify(bookId)
  return result
}

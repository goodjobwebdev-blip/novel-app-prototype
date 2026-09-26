import type { BookArchiveData, BookEntity, DocumentSnapshot, ArcEntity } from '../../data/persistence'
import { database } from '../../data/persistence'

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
  const current = await db.table('syncState').get(bookId) as BookSyncState | undefined
  const next: BookSyncState = { bookId, status: 'idle', remoteETag: '', localContentHash: '', ...current, ...patch, updatedAt: Date.now() }
  await db.table('syncState').put(next)
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

export async function replaceConnectedBookArchive(bookId: string, data: BookArchiveData, state: BookSyncState): Promise<void> {
  const db = await database()
  const incomingBook = archiveBook(data)
  if (incomingBook.id !== bookId) throw new Error('The remote archive belongs to a different book.')
  await db.transaction('rw', ...archiveTables(db), db.table('illustrationUndo'), db.table('syncLinks'), db.table('syncState'), async () => {
    const link = await db.table('syncLinks').get(bookId)
    if (!link) throw new Error('This book is no longer connected to cloud sync.')
    const currentBook = await db.table('entities').get(bookId) as BookEntity | undefined
    if (currentBook?.type !== 'book') throw new Error('The local book no longer exists.')
    const incomingSeries = data.entities.find(entity => entity.type === 'series' && entity.id === incomingBook.seriesId)
    if (incomingSeries) {
      const existingSeries = await db.table('entities').get(incomingSeries.id)
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
    await db.table('galleryImages').where('bookId').equals(bookId).delete()
    await db.table('imageJobs').where('bookId').equals(bookId).delete()
    await db.table('entities').bulkDelete([...ids])
    const ordinaryEntities = data.entities.filter(entity => entity.id !== incomingSeries?.id)
    if (incomingSeries) await db.table('entities').put(incomingSeries)
    await addArchiveRows(db, data, ordinaryEntities)
    await db.table('syncState').put(state)
  })
  notify(bookId)
}

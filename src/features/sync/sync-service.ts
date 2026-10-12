import { decodeBookArchive, encodeBookArchive } from '../../data/book-archive'
import { importBookArchiveBlob } from '../../data/book-import'
import { readBookArchive } from '../../data/persistence'
import { checkStorageHeadroom } from '../images/illustration-image'
import { SyncApiError, createRemoteBook, downloadRemoteBook, getRemoteBook, listRemoteBooks, uploadRemoteBook, type RemoteBook } from './sync-api'
import { archiveContentHash } from './sync-hash'
import {
  disconnectBookSync,
  getBookSyncState,
  getSyncLink,
  listSyncLinks,
  replaceConnectedBookArchive,
  saveSyncConnection,
  updateBookSyncState,
  writeConnectedBookArchive,
  type BookSyncState,
  type SyncLink,
} from './sync-persistence'
import { loadSyncSettings, normalizeSyncEndpoint, syncIsConfigured } from './sync-settings'

export type SyncResult = { kind: 'uploaded' | 'pulled' | 'unchanged' | 'conflict'; message: string }

function deviceId(): string {
  const key = 'arc.sync.device-id.v1'
  let value = localStorage.getItem(key)
  if (!value) { value = crypto.randomUUID(); localStorage.setItem(key, value) }
  return value
}

function configuredSettings() {
  const settings = loadSyncSettings()
  if (!syncIsConfigured(settings)) throw new Error('Configure and test the sync server in global Sync settings first.')
  return settings
}

function connectionState(bookId: string, etag: string, contentHash: string, status: BookSyncState['status'] = 'synced'): BookSyncState {
  const now = Date.now()
  return { bookId, status, remoteETag: etag, localContentHash: contentHash, unresolvedConflict: false, lastCheckedAt: now, lastSyncedAt: now, updatedAt: now }
}

function assertEndpoint(link: SyncLink, endpoint: string) {
  if (link.endpoint !== endpoint) throw new Error('This book is connected to a different sync server. Restore that server URL or disconnect the book.')
}

async function localArchive(bookId: string): Promise<Blob> {
  return encodeBookArchive(await readBookArchive(bookId))
}

async function findOrCreateRemoteBook(bookId: string, title: string): Promise<{ book: RemoteBook; etag: string; existing: boolean }> {
  const settings = configuredSettings()
  try {
    return { ...await createRemoteBook(settings, bookId, title), existing: false }
  } catch (error) {
    if (!(error instanceof SyncApiError) || error.status !== 409) throw error
    const existing = (await listRemoteBooks(settings)).find(book => book.clientBookId === bookId)
    if (!existing) throw error
    return { ...await getRemoteBook(settings, existing.id), existing: true }
  }
}

export async function enableBookSync(bookId: string, title: string, beforeSync: () => Promise<void>): Promise<SyncResult> {
  const settings = configuredSettings()
  const endpoint = normalizeSyncEndpoint(settings.endpoint)
  const existing = await getSyncLink(bookId)
  if (existing) return syncBookNow(bookId, beforeSync)
  await beforeSync()
  const remote = await findOrCreateRemoteBook(bookId, title)
  if (remote.book.clientBookId !== bookId) throw new Error('The cloud book identity does not match this book.')
  const archive = await localArchive(bookId)
  const hash = await archiveContentHash(archive)
  const link: SyncLink = { bookId, endpoint, remoteBookId: remote.book.id, createdAt: Date.now(), updatedAt: Date.now() }
  if ((remote.existing && !(remote.book.currentRevision === 0 && remote.book.currentSize === 0)) || remote.book.currentRevision > 0 || remote.book.currentSize > 0) {
    // A duplicate identity plus its latest ETag is not overwrite consent.
    // Compare the actual downloaded revision, including servers without hashes.
    const downloaded = await downloadRemoteBook(settings, remote.book.id)
    if (!downloaded.etag) throw new Error('The cloud revision is missing. Nothing was overwritten.')
    const decoded = await decodeBookArchive(downloaded.archive)
    if (decoded.entities.find(entity => entity.type === 'book')?.id !== bookId) throw new Error('The cloud archive belongs to a different book.')
    const remoteHash = await archiveContentHash(downloaded.archive)
    if (hash === remoteHash) {
      await saveSyncConnection(link, connectionState(bookId, downloaded.etag, hash))
      return { kind: 'unchanged', message: 'Reconnected to the identical cloud version without uploading.' }
    }
    await saveSyncConnection(link, {
      bookId, status: 'conflict', unresolvedConflict: true, remoteETag: downloaded.etag,
      localContentHash: remoteHash, lastCheckedAt: Date.now(), updatedAt: Date.now(),
      message: 'This cloud book already exists with different content. Nothing was overwritten. Choose a recovery action.',
    })
    return { kind: 'conflict', message: 'The existing cloud version differs. Choose a recovery action before overwriting it.' }
  }
  const uploaded = await uploadRemoteBook(settings, remote.book.id, archive, remote.etag, deviceId())
  await saveSyncConnection(link, connectionState(bookId, uploaded.etag, hash))
  return { kind: 'uploaded', message: 'Cloud sync enabled and the first version was uploaded.' }
}

export async function syncBookNow(bookId: string, beforeSync: () => Promise<void>): Promise<SyncResult> {
  const settings = configuredSettings()
  const endpoint = normalizeSyncEndpoint(settings.endpoint)
  const link = await getSyncLink(bookId)
  const state = await getBookSyncState(bookId)
  if (!link || !state) throw new Error('Enable cloud sync for this book first.')
  assertEndpoint(link, endpoint)
  await beforeSync()
  if (state.unresolvedConflict || state.status === 'conflict') {
    await updateBookSyncState(bookId, { status: 'conflict', unresolvedConflict: true, message: 'Resolve the different local and cloud copies explicitly before syncing.' })
    return { kind: 'conflict', message: 'Choose a recovery action before syncing these different versions.' }
  }
  await updateBookSyncState(bookId, { status: 'syncing', message: undefined })
  try {
    const remote = await getRemoteBook(settings, link.remoteBookId)
    const archive = await localArchive(bookId)
    const hash = await archiveContentHash(archive)
    if (remote.etag !== state.remoteETag) {
      if (hash !== state.localContentHash) {
        await updateBookSyncState(bookId, { status: 'conflict', unresolvedConflict: true, message: 'This device and the cloud both changed. Choose a recovery action.', lastCheckedAt: Date.now() })
        return { kind: 'conflict', message: 'This device and the cloud both changed.' }
      }
      const downloaded = await downloadRemoteBook(settings, link.remoteBookId)
      if (!downloaded.etag) throw new Error('The cloud revision is missing. Nothing was overwritten.')
      await checkStorageHeadroom(downloaded.archive.size)
      const decoded = await decodeBookArchive(downloaded.archive)
      const replacement = await replaceConnectedBookArchive(bookId, decoded, connectionState(bookId, downloaded.etag, await archiveContentHash(downloaded.archive)), { expectedLocalHash: hash, expectedLink: link, expectedState: state })
      if (replacement === 'conflict') return { kind: 'conflict', message: 'Local content changed while downloading. Nothing was overwritten. Choose a recovery action.' }
      return { kind: 'pulled', message: 'Downloaded the newer cloud version.' }
    }
    if (hash === state.localContentHash) {
      await updateBookSyncState(bookId, { status: 'synced', message: undefined, lastCheckedAt: Date.now() })
      return { kind: 'unchanged', message: 'Already up to date.' }
    }
    const uploaded = await uploadRemoteBook(settings, link.remoteBookId, archive, state.remoteETag, deviceId())
    await updateBookSyncState(bookId, connectionState(bookId, uploaded.etag, uploaded.book.currentContentHash ?? hash))
    return { kind: 'uploaded', message: 'Uploaded local changes.' }
  } catch (error) {
    if (error instanceof SyncApiError && error.status === 412) {
      await updateBookSyncState(bookId, { status: 'conflict', unresolvedConflict: true, message: 'The cloud changed during upload. Review the conflict.', lastCheckedAt: Date.now() })
      return { kind: 'conflict', message: 'The cloud changed during upload.' }
    }
    await updateBookSyncState(bookId, { status: navigator.onLine ? 'error' : 'offline', message: error instanceof Error ? error.message : 'Sync failed.' })
    throw error
  }
}

export async function forceOverwriteRemote(bookId: string, beforeSync: () => Promise<void>): Promise<SyncResult> {
  await beforeSync()
  const settings = configuredSettings()
  const link = await getSyncLink(bookId)
  if (!link) throw new Error('This book is not connected to cloud sync.')
  assertEndpoint(link, normalizeSyncEndpoint(settings.endpoint))
  const remote = await getRemoteBook(settings, link.remoteBookId)
  const archive = await localArchive(bookId)
  const hash = await archiveContentHash(archive)
  const uploaded = await uploadRemoteBook(settings, link.remoteBookId, archive, remote.etag, deviceId())
  await updateBookSyncState(bookId, connectionState(bookId, uploaded.etag, uploaded.book.currentContentHash ?? hash))
  return { kind: 'uploaded', message: 'The cloud version was replaced with this device’s copy.' }
}

export async function importRemoteRecoveryCopy(bookId: string): Promise<string> {
  const settings = configuredSettings()
  const link = await getSyncLink(bookId)
  if (!link) throw new Error('This book is not connected to cloud sync.')
  const { archive } = await downloadRemoteBook(settings, link.remoteBookId)
  return importBookArchiveBlob(archive)
}

export async function downloadRemoteBackup(bookId: string): Promise<void> {
  const settings = configuredSettings()
  const link = await getSyncLink(bookId)
  if (!link) throw new Error('This book is not connected to cloud sync.')
  const { archive } = await downloadRemoteBook(settings, link.remoteBookId)
  const url = URL.createObjectURL(archive)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `cloud-book-${bookId}-${new Date().toISOString().slice(0, 10)}.arcbook`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export async function importCloudBook(remote: RemoteBook): Promise<string> {
  const settings = configuredSettings()
  const endpoint = normalizeSyncEndpoint(settings.endpoint)
  if ((await listSyncLinks()).some(link => link.endpoint === endpoint && link.remoteBookId === remote.id)) throw new Error('This cloud book is already connected on this device.')
  const downloaded = await downloadRemoteBook(settings, remote.id)
  await checkStorageHeadroom(downloaded.archive.size)
  const decoded = await decodeBookArchive(downloaded.archive)
  const book = decoded.entities.find(entity => entity.type === 'book')
  if (!book || book.id !== remote.clientBookId) throw new Error('The cloud book identity does not match the downloaded archive.')
  const now = Date.now()
  const link: SyncLink = { bookId: book.id, endpoint, remoteBookId: remote.id, createdAt: now, updatedAt: now }
  if (!downloaded.etag) throw new Error('The cloud revision is missing. Nothing was imported.')
  const state = connectionState(book.id, downloaded.etag, await archiveContentHash(downloaded.archive))
  return writeConnectedBookArchive(decoded, link, state)
}

export async function checkRemoteBook(bookId: string): Promise<void> {
  const link = await getSyncLink(bookId)
  const state = await getBookSyncState(bookId)
  if (!link || !state || !navigator.onLine) return
  if (state.unresolvedConflict || state.status === 'conflict') {
    await updateBookSyncState(bookId, { status: 'conflict', unresolvedConflict: true })
    return
  }
  await updateBookSyncState(bookId, { status: 'checking', message: undefined })
  try {
    const settings = configuredSettings()
    assertEndpoint(link, normalizeSyncEndpoint(settings.endpoint))
    const remote = await getRemoteBook(settings, link.remoteBookId)
    await updateBookSyncState(bookId, remote.etag === state.remoteETag
      ? { status: 'synced', message: undefined, lastCheckedAt: Date.now() }
      : { status: 'remote-changed', message: 'A newer cloud version is available. Use Sync now to review it.', lastCheckedAt: Date.now() })
  } catch (error) {
    await updateBookSyncState(bookId, { status: navigator.onLine ? 'error' : 'offline', message: error instanceof Error ? error.message : 'Could not check the cloud version.' })
  }
}

export { disconnectBookSync }

// Explicit canonical World scope; Book functions above retain detached snapshots.
export {
  enableWorldSync, syncWorldNow, getWorldSyncState, listWorldSyncStates, listDeletedWorldSyncStates,
  listCloudWorlds, importCloudWorld, resolveWorldSyncConflict, disconnectWorldSync, checkRemoteWorld,
  listWorldArchiveConflicts, getWorldArchiveConflict, WORLD_SYNC_CHANGED,
} from './world-sync-service'
export type { WorldSyncResult, WorldSyncState } from './world-sync-service'

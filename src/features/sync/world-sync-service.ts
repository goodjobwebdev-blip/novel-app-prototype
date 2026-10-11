import { database } from '../../data/persistence'
import {
  decodeWorldArchive, encodeWorldArchive, exportWorldArchiveBlob, getWorldArchiveConflict,
  importWorldArchiveBlob, listWorldArchiveConflicts, notifyWorldArchive, readWorldArchive,
  resolveWorldArchiveConflict, WORLD_ARCHIVE_CHANGED,
} from '../../data/world-archive'
import {
  createRemoteBook, downloadRemoteBook, getRemoteBook, listRemoteWorlds as providerWorlds,
  SyncApiError, uploadRemoteBook, WORLD_REMOTE_PREFIX, type RemoteBook,
} from './sync-api'
import { loadSyncSettings, normalizeSyncEndpoint, syncIsConfigured } from './sync-settings'
import type { SyncStatus } from './sync-persistence'
import { archiveContentHash } from './sync-hash'
import { KeyedAsyncQueue } from '../../shared/utils/keyed-async-queue'

export { WORLD_ARCHIVE_CHANGED as WORLD_SYNC_CHANGED, listWorldArchiveConflicts, getWorldArchiveConflict }
export type WorldSyncState = {
  worldId: string; ownerType: 'world'; status: SyncStatus; endpoint: string; remoteWorldId: string
  remoteETag: string; localContentHash: string; updatedAt: number; lastSyncedAt?: number
  conflictId?: string; message?: string
}
export type WorldSyncResult = { kind: 'uploaded' | 'pulled' | 'unchanged' | 'conflict'; message: string; conflictId?: string }
const queue = new KeyedAsyncQueue()
const stateKey = (worldId: string) => `world-sync:state:${worldId}`
function settings() {
  const value = loadSyncSettings()
  if (!syncIsConfigured(value)) throw new Error('Configure and test the sync server in global Sync settings first.')
  return value
}
function deviceId() {
  const key = 'arc.sync.device-id.v1'
  let id = localStorage.getItem(key)
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id) }
  return id
}
export async function getWorldSyncState(worldId: string): Promise<WorldSyncState | undefined> {
  return (await (await database()).table('meta').get(stateKey(worldId)))?.value
}
export async function listWorldSyncStates(): Promise<WorldSyncState[]> {
  return (await (await database()).table('meta').toArray()).filter((row: any) => row.key.startsWith('world-sync:state:')).map((row: any) => row.value)
}
async function save(state: WorldSyncState) {
  await (await database()).table('meta').put({ key: stateKey(state.worldId), value: { ...state, updatedAt: Date.now() } })
  notifyWorldArchive(state.worldId)
}
function assertEndpoint(state: WorldSyncState, endpoint: string) {
  if (state.endpoint !== normalizeSyncEndpoint(endpoint)) throw new Error('This World is connected to a different sync server. Restore that URL or disconnect it.')
}
function assertIdentity(remote: RemoteBook, worldId: string) {
  if (remote.clientBookId !== `${WORLD_REMOTE_PREFIX}${worldId}`) throw new Error('The cloud World identity does not match its canonical owner.')
}
async function acknowledged(state: WorldSyncState, etag: string, hash: string) {
  await save({ ...state, status: 'synced', remoteETag: etag, localContentHash: hash, lastSyncedAt: Date.now(), conflictId: undefined, message: undefined })
}
async function failure(state: WorldSyncState, error: unknown) {
  await save({ ...state, status: typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'error', message: error instanceof Error ? error.message : 'World sync failed. Retry the operation.' })
}
async function captureRemote(state: WorldSyncState, expectedLocalHash?: string, preserveConflict = false): Promise<WorldSyncResult> {
  const configured = settings(); assertEndpoint(state, configured.endpoint)
  const downloaded = await downloadRemoteBook(configured, state.remoteWorldId)
  if (!downloaded.etag) throw new Error('The sync server omitted the World revision. Nothing was overwritten.')
  const data = await decodeWorldArchive(downloaded.archive)
  if (data.worldId !== state.worldId) throw new Error('The remote archive belongs to a different World.')
  const normalized = encodeWorldArchive(data), hash = await archiveContentHash(normalized)
  const result = await importWorldArchiveBlob(normalized, { expectedLocalHash, preserveConflict, remoteETag: downloaded.etag })
  if (result.kind === 'conflict') {
    await save({ ...state, status: 'conflict', conflictId: result.conflictId, message: 'Both versions were preserved. Choose a version explicitly.' })
    return { kind: 'conflict', conflictId: result.conflictId, message: 'Both versions were preserved. No local content was overwritten.' }
  }
  await acknowledged(state, downloaded.etag, result.localContentHash ?? hash)
  return { kind: result.kind === 'unchanged' ? 'unchanged' : 'pulled', message: data.tombstone ? 'Downloaded the deletion tombstone.' : 'Downloaded the canonical World.' }
}
async function syncConnected(worldId: string): Promise<WorldSyncResult> {
  const configured = settings(), state = await getWorldSyncState(worldId)
  if (!state) throw new Error('Enable cloud sync for this World first.')
  assertEndpoint(state, configured.endpoint)
  await save({ ...state, status: 'syncing', message: undefined })
  try {
    const unresolved = await listWorldArchiveConflicts(worldId)
    if (unresolved.length) {
      const currentHash = await archiveContentHash(await exportWorldArchiveBlob(worldId))
      if (unresolved.some(conflict => conflict.localHash !== currentHash)) return await captureRemote(state, undefined, true)
      await save({ ...state, status: 'conflict', conflictId: unresolved[0].id, message: 'Resolve the preserved World versions before syncing.' })
      return { kind: 'conflict', conflictId: unresolved[0].id, message: 'Resolve the preserved versions first.' }
    }
    const remote = await getRemoteBook(configured, state.remoteWorldId)
    assertIdentity(remote.book, worldId)
    const archive = await exportWorldArchiveBlob(worldId), hash = await archiveContentHash(archive)
    if (remote.etag !== state.remoteETag) return await captureRemote(state, state.localContentHash, hash !== state.localContentHash)
    if (hash === state.localContentHash) {
      await acknowledged(state, state.remoteETag, hash)
      return { kind: 'unchanged', message: 'World is already up to date.' }
    }
    const uploaded = await uploadRemoteBook(configured, state.remoteWorldId, archive, state.remoteETag, deviceId())
    assertIdentity(uploaded.book, worldId)
    // Verify the exact target after a write. An intervening cloud edit is a conflict,
    // not permission to mark our copy synced or replace this device's current edits.
    const readback = await downloadRemoteBook(configured, state.remoteWorldId)
    if (readback.etag !== uploaded.etag || await archiveContentHash(encodeWorldArchive(await decodeWorldArchive(readback.archive))) !== hash) return await captureRemote(state, undefined, true)
    await acknowledged(state, uploaded.etag, hash)
    return { kind: 'uploaded', message: 'Uploaded canonical World changes.' }
  } catch (error) {
    if (error instanceof SyncApiError && error.status === 412) {
      try { return await captureRemote(state, undefined, true) } catch (captureError) { await failure(state, captureError); throw captureError }
    }
    await failure(state, error); throw error
  }
}
async function locked<T>(worldId: string, task: () => Promise<T>): Promise<T> {
  // Web Locks coordinate tabs; the queue also covers runtimes without Web Locks.
  return queue.run(worldId, async () => {
    if (typeof navigator !== 'undefined' && navigator.locks) return await navigator.locks.request(`arc-world-sync:${worldId}`, async () => await task())
    return await task()
  })
}
export async function syncWorldNow(worldId: string, beforeSync: () => Promise<void> = async () => {}): Promise<WorldSyncResult> {
  return locked(worldId, async () => { await beforeSync(); return syncConnected(worldId) })
}
export async function enableWorldSync(worldId: string, beforeSync: () => Promise<void> = async () => {}): Promise<WorldSyncResult> {
  return locked(worldId, async () => {
    await beforeSync()
    if (await getWorldSyncState(worldId)) return syncConnected(worldId)
    const configured = settings(), data = await readWorldArchive(worldId)
    const title = data.entities.find(row => row.id === worldId)?.title ?? 'Deleted World'
    let remote: Awaited<ReturnType<typeof createRemoteBook>>
    try { remote = await createRemoteBook(configured, `${WORLD_REMOTE_PREFIX}${worldId}`, String(title)) }
    catch (error) {
      if (!(error instanceof SyncApiError) || error.status !== 409) throw error
      const found = (await providerWorlds(configured)).find(row => row.clientBookId === `${WORLD_REMOTE_PREFIX}${worldId}`)
      if (!found) throw error
      remote = await getRemoteBook(configured, found.id)
    }
    assertIdentity(remote.book, worldId)
    const state: WorldSyncState = { worldId, ownerType: 'world', status: 'idle', endpoint: normalizeSyncEndpoint(configured.endpoint), remoteWorldId: remote.book.id, remoteETag: remote.etag, localContentHash: '', updatedAt: Date.now() }
    await save(state)
    if (remote.book.currentRevision > 0 || remote.book.currentSize > 0) {
      // No known common baseline: never overwrite an existing canonical owner.
      try { return await captureRemote(state) } catch (error) { await failure(state, error); throw error }
    }
    return syncConnected(worldId)
  })
}
export async function listCloudWorlds(): Promise<RemoteBook[]> { return providerWorlds(settings()) }
export async function importCloudWorld(remote: RemoteBook): Promise<WorldSyncResult & { worldId: string }> {
  if (!remote.clientBookId.startsWith(WORLD_REMOTE_PREFIX)) throw new Error('This cloud owner is not a World.')
  const worldId = remote.clientBookId.slice(WORLD_REMOTE_PREFIX.length)
  if (!worldId) throw new Error('The cloud World identity is invalid.')
  return locked(worldId, async () => {
    const configured = settings(), existing = await getWorldSyncState(worldId)
    if (existing) {
      assertEndpoint(existing, configured.endpoint)
      if (existing.remoteWorldId !== remote.id) throw new Error('This World is connected to another cloud identity.')
      return { ...await syncConnected(worldId), worldId }
    }
    const actual = await getRemoteBook(configured, remote.id); assertIdentity(actual.book, worldId)
    const state: WorldSyncState = { worldId, ownerType: 'world', status: 'idle', endpoint: normalizeSyncEndpoint(configured.endpoint), remoteWorldId: remote.id, remoteETag: '', localContentHash: '', updatedAt: Date.now() }
    // Keep enough connection information to retry even after a failed download.
    await save(state)
    try { return { ...await captureRemote(state), worldId } }
    catch (error) { await failure(state, error); throw error }
  })
}
/** Both complete blobs remain retrievable after resolution. No force-overwrite API. */
export async function resolveWorldSyncConflict(worldId: string, conflictId: string, choice: 'local' | 'incoming', beforeSync: () => Promise<void> = async () => {}): Promise<WorldSyncResult> {
  return locked(worldId, async () => {
    await beforeSync()
    const configured = settings(), state = await getWorldSyncState(worldId), conflict = await getWorldArchiveConflict(conflictId)
    if (!state || !conflict || conflict.worldId !== worldId || conflict.resolution || !conflict.remoteETag) throw new Error('Choose an unresolved cloud conflict for this World.')
    assertEndpoint(state, configured.endpoint)
    try {
      const remote = await getRemoteBook(configured, state.remoteWorldId); assertIdentity(remote.book, worldId)
      if (remote.etag !== conflict.remoteETag) return await captureRemote(state, undefined, true)
      if (choice === 'incoming') {
        const resolved = await resolveWorldArchiveConflict(conflictId, 'incoming')
        const hash = resolved.localContentHash ?? await archiveContentHash(encodeWorldArchive(await decodeWorldArchive(conflict.incoming)))
        await acknowledged(state, conflict.remoteETag, hash)
        return { kind: 'pulled', message: 'Applied the explicitly selected cloud version. The other version remains preserved.' }
      }
      if (choice !== 'local') throw new Error('Choose local or incoming explicitly.')
      const local = await exportWorldArchiveBlob(worldId), hash = await archiveContentHash(local)
      if (hash !== conflict.localHash) throw new Error('The local World changed after capture. Sync again before resolving it.')
      const uploaded = await uploadRemoteBook(configured, state.remoteWorldId, local, conflict.remoteETag, deviceId())
      const readback = await downloadRemoteBook(configured, state.remoteWorldId)
      if (readback.etag !== uploaded.etag || await archiveContentHash(encodeWorldArchive(await decodeWorldArchive(readback.archive))) !== hash) return await captureRemote(state, undefined, true)
      await resolveWorldArchiveConflict(conflictId, 'local')
      await acknowledged(state, uploaded.etag, hash)
      return { kind: 'uploaded', message: 'Uploaded the explicitly selected local version. The other version remains preserved.' }
    } catch (error) {
      if (error instanceof SyncApiError && error.status === 412) return captureRemote(state, undefined, true)
      await failure(state, error); throw error
    }
  })
}
export async function disconnectWorldSync(worldId: string): Promise<void> {
  await locked(worldId, async () => {
    await (await database()).table('meta').delete(stateKey(worldId))
    // Tombstones and conflict copies deliberately survive disconnection.
    notifyWorldArchive(worldId)
  })
}

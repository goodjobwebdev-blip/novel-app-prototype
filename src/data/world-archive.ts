import Dexie from 'dexie'
import { database, type ArcEntity, type WorldEntity, type DocumentSnapshot, type CodexDependencyEdge, type Illustration } from './persistence'
import type { GalleryImage, ImageJob } from '../features/images/image-generation-types'
import { documentBlocks } from '../features/editor/document-projection'
import { assertImageFile, checkStorageHeadroom } from '../features/images/illustration-image'
import { deleteWorld, setBookWorld, entityAvailableInBook } from '../features/worlds/world-service'
import { archiveContentHash } from '../features/sync/sync-hash'
import { ensureLoreTypesWithDb } from '../features/codex/lore-types'
import { BOOK_PROFILE_KINDS, importSettingsProfiles, sanitizeProfileSettings, sanitizeSettingsProfile, settingsProfilesForSelections, withProfileReferenceLock, type BookProfileSelections, type SettingsProfile } from '../features/settings/settings-profiles'

/** Same binary transport envelope as Book; a distinct canonical manifest contract. */
export type WorldArchiveData = {
  format: 'arc-world'; version: 1; worldId: string
  entities: ArcEntity[]; snapshots: DocumentSnapshot[]; dependencies: CodexDependencyEdge[]
  illustrations: Illustration[]; galleryImages: GalleryImage[]; imageJobs: ImageJob[]
  bookReferences: string[]
  settingsProfiles?: SettingsProfile[]
  tombstone?: { worldId: string; deletedAt: number }
}
export type WorldImportResult = { worldId: string; kind: 'imported' | 'unchanged' | 'deleted' | 'conflict'; conflictId?: string; localContentHash?: string }
export type WorldArchiveConflict = {
  id: string; worldId: string; local?: Blob; incoming: Blob; localHash: string; incomingHash: string
  createdAt: number; reason: string; resolution?: 'local' | 'incoming'; resolvedAt?: number; supersededAt?: number
  remoteETag?: string
}
export const WORLD_ARCHIVE_CHANGED = 'arc-world-sync-changed'
const MAX_ARCHIVE = 2_000_000_000, MAX_MANIFEST = 64 * 1024 * 1024
const types = new Set(['codexEntry', 'note', 'chat', 'chatMessage', 'summary', 'settings'])
export const worldArchiveTables = ['entities', 'snapshots', 'codexDependencies', 'illustrations', 'illustrationUndo', 'galleryImages', 'imageJobs', 'meta']
const key = (kind: string, worldId: string) => `world-archive:${kind}:${worldId}`
function valid(condition: unknown): asserts condition { if (!condition) throw new Error('This World archive is incomplete or invalid. Nothing was imported.') }
function unique(rows: Array<{ id: string }>) { valid(rows.every(row => row && typeof row.id === 'string' && row.id.length > 0)); valid(new Set(rows.map(row => row.id)).size === rows.length) }
function empty(worldId: string): WorldArchiveData { return { format: 'arc-world', version: 1, worldId, entities: [], snapshots: [], dependencies: [], illustrations: [], galleryImages: [], imageJobs: [], bookReferences: [] } }
export function notifyWorldArchive(worldId: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(WORLD_ARCHIVE_CHANGED, { detail: { worldId } }))
    window.dispatchEvent(new Event('arc-worlds-changed'))
    window.dispatchEvent(new CustomEvent('arc-entity-changed', { detail: { bookId: worldId, worldId } }))
  }
}
/** Never serialize provider credentials, active execution tickets or source image payloads. */
function portable(value: any, path: string[] = [], depth = 0): any {
  valid(depth <= 80)
  if (value instanceof Blob) return value
  if (Array.isArray(value)) return value.map(item => portable(item, path, depth + 1))
  if (value && typeof value === 'object') {
    const participant = path.at(-2) === 'character' && path.at(-1) === 'participants' && typeof value.entryId === 'string' && typeof value.label === 'string'
    return Object.fromEntries(Object.entries(value).filter(([name]) => {
      if (name === 'token' && participant) return true
      const normalized = name.toLowerCase().replace(/[_-]/g, '')
      return !/(apikey|credential|connection|endpoint|account|baseurl|secret|password|authorization)/i.test(name) && !['token', 'accesstoken', 'refreshtoken', 'apitoken', 'authtoken', 'bearertoken', 'sessiontoken', 'privatekey', 'clientid', 'keys', 'providerprofiles', 'owner', 'heartbeat', 'providerjobid', 'sources'].includes(normalized)
    }).map(([name, item]) => [name, portable(item, [...path, name], depth + 1)]))
  }
  return value
}
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(name => [name, canonical(value[name])]))
  return value
}
/** Match Book archive portability: selected definitions plus Text prompt dependencies. */
function portableWorldProfiles(source: WorldArchiveData): WorldArchiveData {
  const entities: ArcEntity[] = source.entities.map(entity => entity.type === 'settings' && entity.settingsType === 'ai' ? { ...entity, value: sanitizeProfileSettings(entity.value as Parameters<typeof sanitizeProfileSettings>[0]) } : { ...entity })
  const selections = entities.filter(entity => entity.type === 'settings' && ['profiles-book', 'profiles-world'].includes(String(entity.settingsType)))
  valid(selections.length <= 1)
  if (!selections.length) { valid(source.settingsProfiles === undefined); return { ...source, entities } }
  const selection = selections[0]
  const definitions = source.settingsProfiles ?? selection.definitions as SettingsProfile[] | undefined
  valid(Array.isArray(definitions) && definitions.length <= 1000)
  const clean = definitions.map(sanitizeSettingsProfile).sort((a, b) => a.id.localeCompare(b.id)), byId = new Map(clean.map(profile => [profile.id, profile]))
  valid(byId.size === clean.length)
  for (const kind of BOOK_PROFILE_KINDS) valid(byId.get((selection.value as BookProfileSelections)?.[kind])?.kind === kind)
  for (const profile of clean.filter(profile => profile.kind === 'text')) {
    valid(byId.get(profile.settings.chatPromptPresetId ?? '')?.kind === 'chat')
    valid(byId.get(profile.settings.characterPromptPresetId ?? '')?.kind === 'character')
  }
  if (selection.modelMetadata !== undefined) valid(selection.modelMetadata && typeof selection.modelMetadata === 'object' && !Array.isArray(selection.modelMetadata) && Object.entries(selection.modelMetadata).every(([name, length]) => /^(openrouter|nanogpt|openai|litellm|compatible|fake):\S/.test(name) && Number.isSafeInteger(length) && Number(length) > 0))
  selection.definitions = clean
  return { ...source, entities, settingsProfiles: clean }
}
export function validateWorldArchive(data: WorldArchiveData): void {
  valid(data?.format === 'arc-world' && data.version === 1 && typeof data.worldId === 'string' && data.worldId.length > 0)
  for (const name of ['entities', 'snapshots', 'dependencies', 'illustrations', 'galleryImages', 'imageJobs', 'bookReferences'] as const) valid(Array.isArray(data[name]) && data[name].length <= 100_000)
  for (const rows of [data.entities, data.snapshots, data.dependencies, data.illustrations, data.galleryImages, data.imageJobs]) unique(rows)
  valid(data.bookReferences.every(id => typeof id === 'string' && id.length > 0 && id !== data.worldId) && new Set(data.bookReferences).size === data.bookReferences.length)
  portableWorldProfiles(data)
  if (data.tombstone) {
    valid(data.settingsProfiles === undefined)
    valid(data.tombstone.worldId === data.worldId && Number.isFinite(data.tombstone.deletedAt))
    valid([data.entities, data.snapshots, data.dependencies, data.illustrations, data.galleryImages, data.imageJobs, data.bookReferences].every(rows => rows.length === 0))
    return
  }
  const byId = new Map(data.entities.map(entity => [entity.id, entity]))
  const world = byId.get(data.worldId)
  valid(world?.type === 'world' && typeof world.title === 'string' && !world.bookId && !world.parentId && !world.worldId)
  for (const entity of data.entities) {
    valid(Number.isFinite(entity.createdAt) && Number.isFinite(entity.updatedAt))
    if (entity.id === data.worldId) continue
    valid(types.has(entity.type) && entity.bookId === data.worldId && (!entity.worldId || entity.worldId === data.worldId))
    if (entity.type === 'codexEntry') valid(entity.worldId === data.worldId && typeof entity.category === 'string')
    if (['codexEntry', 'note', 'summary', 'chatMessage'].includes(entity.type)) valid(typeof entity.content === 'string')
    if (['codexEntry', 'note', 'chat', 'summary'].includes(entity.type)) valid(typeof entity.title === 'string')
    valid(typeof entity.parentId === 'string' && byId.has(entity.parentId))
    const seen = new Set([entity.id]); let parent = byId.get(entity.parentId)
    while (parent && parent.id !== data.worldId) { valid(!seen.has(parent.id)); seen.add(parent.id); parent = byId.get(parent.parentId ?? '') }
    valid(parent?.id === data.worldId)
    if (entity.type === 'chatMessage') valid(byId.get(entity.parentId)?.type === 'chat')
    if (entity.type === 'summary') valid(byId.get(String(entity.sourceEntityId))?.type === 'codexEntry' && entity.parentId === entity.sourceEntityId)
  }
  for (const row of data.snapshots) valid(byId.has(row.entityId) && typeof row.content === 'string' && Number.isFinite(row.createdAt) && byId.get(row.entityId)?.type === row.entityType)
  for (const row of data.dependencies) valid(row.bookId === data.worldId && row.sourceId !== row.targetId && byId.get(row.sourceId)?.type === 'codexEntry' && byId.get(row.targetId)?.type === 'codexEntry')
  const illustrated = new Set<string>()
  for (const row of data.illustrations) {
    valid(row.bookId === data.worldId && byId.get(row.entryId)?.type === 'codexEntry' && !illustrated.has(row.entryId) && byId.get(row.entryId)?.primaryImageId === row.id)
    illustrated.add(row.entryId)
  }
  for (const row of data.galleryImages) valid(row.bookId === data.worldId && !row.entryId && !row.illustrationId)
  for (const row of [...data.illustrations, ...data.galleryImages]) valid(row.image instanceof Blob && row.thumbnail instanceof Blob && row.image.size > 0 && row.thumbnail.size > 0 && Number.isSafeInteger(row.width) && row.width > 0 && Number.isSafeInteger(row.height) && row.height > 0)
  for (const row of data.imageJobs) valid(row.bookId === data.worldId && row.status === 'completed' && row.decision === 'kept' && data.galleryImages.some(asset => asset.id === row.assetId) && (!row.messageId || byId.get(row.messageId)?.type === 'chatMessage'))
  for (const entity of data.entities) if (entity.primaryImageId) valid(data.illustrations.some(row => row.id === entity.primaryImageId && row.entryId === entity.id))
  const assets = new Set(data.galleryImages.map(row => row.id))
  for (const row of [...data.entities, ...data.snapshots, ...data.entities.flatMap(entity => Array.isArray(entity.checkpoints) ? entity.checkpoints : [])]) {
    for (const block of documentBlocks(row.content ?? '')) if (block.block.assetId) valid(assets.has(block.block.assetId))
  }
}
export function encodeWorldArchive(source: WorldArchiveData): Blob {
  validateWorldArchive(source)
  const data = portable(portableWorldProfiles(source)) as WorldArchiveData
  const sorted = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id))
  const media = [...sorted(data.illustrations), ...sorted(data.galleryImages)]
  const storeMedia = (row: Illustration | GalleryImage) => {
    const { image, thumbnail, ...rest } = row
    return { ...rest, imageSize: image.size, imageType: image.type, thumbnailSize: thumbnail.size, thumbnailType: thumbnail.type }
  }
  const manifest = new TextEncoder().encode(JSON.stringify(canonical({ ...data, entities: sorted(data.entities), snapshots: sorted(data.snapshots), dependencies: sorted(data.dependencies), imageJobs: sorted(data.imageJobs), illustrations: sorted(data.illustrations).map(storeMedia), galleryImages: sorted(data.galleryImages).map(storeMedia), bookReferences: [...data.bookReferences].sort() })))
  valid(manifest.length > 0 && manifest.length <= MAX_MANIFEST)
  const header = new Uint8Array(12); header.set(new TextEncoder().encode('ARCBK001')); new DataView(header.buffer).setUint32(8, manifest.length)
  const result = new Blob([header, manifest, ...media.flatMap(row => [row.image, row.thumbnail])], { type: 'application/octet-stream' })
  valid(result.size <= MAX_ARCHIVE); return result
}
export async function decodeWorldArchive(file: Blob): Promise<WorldArchiveData> {
  valid(file.size >= 12 && file.size <= MAX_ARCHIVE)
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  valid(new TextDecoder().decode(header.slice(0, 8)) === 'ARCBK001')
  const length = new DataView(header.buffer).getUint32(8); valid(length > 0 && length <= MAX_MANIFEST && length + 12 <= file.size)
  let data: WorldArchiveData
  try { data = portable(JSON.parse(await file.slice(12, 12 + length).text())) } catch { throw new Error('This World archive could not be read. Nothing was imported.') }
  valid(Array.isArray(data.illustrations) && Array.isArray(data.galleryImages))
  let offset = 12 + length
  for (const row of [...data.illustrations, ...data.galleryImages] as any[]) {
    for (const size of [row.imageSize, row.thumbnailSize]) valid(Number.isSafeInteger(size) && size > 0 && size <= 200 * 1024 * 1024)
    valid(offset + row.imageSize + row.thumbnailSize <= file.size)
    const video = row.kind === 'video'
    valid((video ? ['video/mp4', 'video/webm'] : ['image/png', 'image/jpeg', 'image/webp']).includes(row.imageType) && ['image/png', 'image/jpeg', 'image/webp'].includes(row.thumbnailType))
    row.image = file.slice(offset, offset += row.imageSize, row.imageType)
    row.thumbnail = file.slice(offset, offset += row.thumbnailSize, row.thumbnailType)
    if (!video) await assertImageFile(row.image)
    else {
      const bytes = new Uint8Array(await row.image.slice(0, 12).arrayBuffer())
      valid(new TextDecoder().decode(bytes.slice(4, 8)) === 'ftyp' || (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3))
    }
    await assertImageFile(row.thumbnail)
    delete row.imageSize; delete row.imageType; delete row.thumbnailSize; delete row.thumbnailType
  }
  valid(offset === file.size); validateWorldArchive(data); return portableWorldProfiles(data)
}
async function capture(db: any, worldId: string): Promise<WorldArchiveData | undefined> {
  const tombstone = (await db.table('meta').get(key('tombstone', worldId)))?.value
  if (tombstone) return { ...empty(worldId), tombstone }
  const world = await db.table('entities').get(worldId) as WorldEntity | undefined
  if (!world) return undefined
  valid(world.type === 'world')
  const entities = [world, ...await db.table('entities').where('bookId').equals(worldId).toArray()] as ArcEntity[]
  const selection = entities.find(row => row.type === 'settings' && ['profiles-book', 'profiles-world'].includes(String(row.settingsType)))
  const settingsProfiles = selection ? ((selection.definitions as SettingsProfile[] | undefined)?.map(sanitizeSettingsProfile) ?? settingsProfilesForSelections(selection.value as BookProfileSelections)) : undefined
  if (selection) selection.definitions = settingsProfiles
  const ids = entities.map(row => row.id)
  const snapshots = await db.table('snapshots').where('entityId').anyOf(ids).toArray() as DocumentSnapshot[]
  const allGallery = await db.table('galleryImages').where('bookId').equals(worldId).toArray() as GalleryImage[]
  const references = new Set<string>()
  for (const row of [...entities, ...snapshots, ...entities.flatMap(entity => Array.isArray(entity.checkpoints) ? entity.checkpoints : [])]) for (const block of documentBlocks(row.content ?? '')) if (block.block.assetId) references.add(block.block.assetId)
  const galleryImages = allGallery.filter(row => row.kept || references.has(row.id))
  const assetIds = new Set(galleryImages.map(row => row.id))
  const imageJobs = (await db.table('imageJobs').where('bookId').equals(worldId).toArray() as ImageJob[]).filter(row => row.status === 'completed' && row.decision === 'kept' && assetIds.has(row.assetId ?? ''))
  const members = (await db.table('entities').where('worldId').equals(worldId).toArray() as ArcEntity[]).filter(row => row.type === 'book').map(row => row.id)
  const pending = (await db.table('meta').get(key('references', worldId)))?.value ?? []
  return { ...empty(worldId), settingsProfiles, entities, snapshots, dependencies: await db.table('codexDependencies').where('bookId').equals(worldId).toArray(), illustrations: await db.table('illustrations').where('bookId').equals(worldId).toArray(), galleryImages, imageJobs, bookReferences: [...new Set<string>([...members, ...pending])] }
}
export async function readWorldArchive(worldId: string): Promise<WorldArchiveData> {
  const db = await database()
  return db.transaction('r', worldArchiveTables.map(name => db.table(name)), async () => {
    const result = await capture(db, worldId)
    if (!result) throw new Error('This World no longer exists and has no deletion tombstone.')
    validateWorldArchive(result); return result
  })
}
async function snapshot(db: any, worldId: string) {
  const data = await capture(db, worldId), blob = data ? encodeWorldArchive(data) : undefined
  const hash = blob ? await Dexie.waitFor(archiveContentHash(blob)) : ''
  return { data, blob, hash }
}
async function storeConflict(db: any, current: Awaited<ReturnType<typeof snapshot>>, incoming: Blob, worldId: string, reason: string, remoteETag?: string): Promise<WorldImportResult> {
  const incomingHash = await Dexie.waitFor(archiveContentHash(incoming))
  const baseId = key('conflict', `${worldId}:${current.hash}:${incomingHash}:${remoteETag ?? ''}`)
  const prior = await db.table('meta').get(baseId)
  const id = prior?.value.resolution || prior?.value.supersededAt ? `${baseId}:${crypto.randomUUID()}` : baseId
  for (const row of await db.table('meta').toArray()) {
    if (row.key.startsWith('world-archive:conflict:') && row.key !== id && row.value.worldId === worldId && !row.value.resolution && !row.value.supersededAt) {
      await db.table('meta').put({ ...row, value: { ...row.value, supersededAt: Date.now() } })
    }
  }
  if (!prior || prior.value.resolution || prior.value.supersededAt) await db.table('meta').put({ key: id, value: { id, worldId, local: current.blob, incoming, localHash: current.hash, incomingHash, createdAt: Date.now(), reason, remoteETag } satisfies WorldArchiveConflict })
  return { kind: 'conflict', worldId, conflictId: id }
}
/** Called only under the archive write transaction; foreign IDs cannot be reassigned. */
async function apply(db: any, data: WorldArchiveData) {
  const worldId = data.worldId
  if ((await db.table('meta').get(key('tombstone', worldId))) && !data.tombstone) throw new Error('This World was deleted. Restore it under a new identity, not from a stale archive.')
  const existing = await db.table('entities').get(worldId)
  if (existing && existing.type !== 'world') throw new Error('The World identity collides with another owner.')
  const oldEntities = await db.table('entities').where('bookId').equals(worldId).toArray() as ArcEntity[]
  const ids = new Set([worldId, ...oldEntities.map(row => row.id)])
  const rows = [['entities', data.entities], ['snapshots', data.snapshots], ['codexDependencies', data.dependencies], ['illustrations', data.illustrations], ['galleryImages', data.galleryImages], ['imageJobs', data.imageJobs]] as const
  for (const [table, incoming] of rows) {
    const current = await db.table(table).bulkGet(incoming.map(row => row.id))
    for (const row of current.filter(Boolean)) {
      const owned = table === 'entities' ? ids.has(row.id) : table === 'snapshots' ? ids.has(row.entityId) : row.bookId === worldId
      if (!owned) throw new Error(`The World archive ${table} identity collides with another owner's data.`)
    }
  }
  if (data.tombstone) {
    if (oldEntities.some(row => ['codexEntry', 'note', 'chat', 'chatMessage', 'summary'].includes(row.type))) throw new Error('Only an empty World can be deleted. Keep the local version or remove its content first.')
    if (existing) await deleteWorld(worldId)
    await db.table('meta').put({ key: key('tombstone', worldId), value: data.tombstone })
    await db.table('meta').delete(key('references', worldId))
    return
  }
  // Use the same collision-safe, retry-idempotent profile installer as Book import.
  data = { ...data, entities: data.entities.map(entity => {
    if (entity.type !== 'settings' || !['profiles-book', 'profiles-world'].includes(String(entity.settingsType))) return entity
    const value = importSettingsProfiles(entity.definitions as SettingsProfile[], entity.value as BookProfileSelections)
    const { definitions: _portable, ...local } = entity
    return { ...local, settingsType: 'profiles-world', worldId, value }
  }) }
  // Detach against the OLD registry so inherited custom definitions survive.
  const wanted = new Set(data.bookReferences)
  const members = (await db.table('entities').where('worldId').equals(worldId).toArray() as ArcEntity[]).filter(row => row.type === 'book')
  for (const book of members) if (!wanted.has(book.id)) await setBookWorld(book.id, '')
  // Replace this owner's rows, never delete or import any Book manuscript.
  await db.table('snapshots').where('entityId').anyOf([...ids]).delete()
  for (const table of ['codexDependencies', 'illustrations', 'galleryImages', 'imageJobs', 'illustrationUndo']) await db.table(table).where('bookId').equals(worldId).delete()
  await db.table('entities').bulkDelete([...ids].filter(id => id !== worldId))
  // Root first: DBCore validates canonical owners during child insertion.
  await db.table('entities').put(data.entities.find(row => row.id === worldId))
  const children = data.entities.filter(row => row.id !== worldId)
  if (children.length) await db.table('entities').bulkAdd(children)
  // Finish legacy category/type migration before receipts or conflicts capture a
  // baseline. Otherwise getEntity() can install random custom type IDs on a read,
  // changing the archive hash despite no authored edit. Keep strict hash checks.
  await ensureLoreTypesWithDb(db, worldId)
  for (const [table, incoming] of rows) if (table !== 'entities' && incoming.length) await db.table(table).bulkAdd(incoming)
  // Retained links must not keep edges to lore removed by the selected version.
  for (const member of members.filter(book => wanted.has(book.id))) {
    const book = await db.table('entities').get(member.id)
    const available = new Set((await db.table('entities').where('bookId').anyOf([member.id, worldId]).toArray() as ArcEntity[])
      .filter(row => row.type === 'codexEntry' && entityAvailableInBook(row, book)).map(row => row.id))
    await db.table('codexDependencies').where('bookId').equals(member.id)
      .filter((edge: CodexDependencyEdge) => !available.has(edge.sourceId) || !available.has(edge.targetId)).delete()
  }
  const pending: string[] = []
  for (const bookId of data.bookReferences) {
    const book = await db.table('entities').get(bookId)
    if (book?.type !== 'book' || (book.worldId && book.worldId !== worldId)) { pending.push(bookId); continue }
    if (!book.worldId) await setBookWorld(bookId, worldId)
  }
  await db.table('meta').put({ key: key('references', worldId), value: pending })
}
export async function importWorldArchiveBlob(file: Blob, options: { expectedLocalHash?: string; preserveConflict?: boolean; remoteETag?: string } = {}): Promise<WorldImportResult> {
  const data = await decodeWorldArchive(file), incoming = encodeWorldArchive(data)
  await checkStorageHeadroom(incoming.size)
  const incomingHash = await archiveContentHash(incoming), db = await database()
  const result = await withProfileReferenceLock<WorldImportResult>(() => db.transaction('rw', worldArchiveTables.map(name => db.table(name)), async () => {
    const current = await snapshot(db, data.worldId)
    const receipt = (await db.table('meta').get(key('receipt', data.worldId)))?.value
    if (current.hash === incomingHash || (receipt?.incomingHash === incomingHash && receipt.localHash === current.hash)) return { kind: 'unchanged', worldId: data.worldId, localContentHash: current.hash } as WorldImportResult
    const blockedDeletion = data.tombstone && current.data?.entities.some(row => ['codexEntry', 'note', 'chat', 'chatMessage', 'summary'].includes(row.type))
    if (options.preserveConflict || blockedDeletion || (current.data?.tombstone && !data.tombstone) || (current.data && options.expectedLocalHash !== current.hash) || (options.expectedLocalHash !== undefined && options.expectedLocalHash !== current.hash)) {
      return storeConflict(db, current, incoming, data.worldId, current.data?.tombstone ? 'This World was deleted locally.' : 'The canonical World versions differ.', options.remoteETag)
    }
    await apply(db, data)
    const applied = await snapshot(db, data.worldId)
    await db.table('meta').put({ key: key('receipt', data.worldId), value: { incomingHash, localHash: applied.hash } })
    return { kind: data.tombstone ? 'deleted' : 'imported', worldId: data.worldId, localContentHash: applied.hash } as WorldImportResult
  }))
  notifyWorldArchive(data.worldId); return result
}
export async function getWorldArchiveConflict(id: string): Promise<WorldArchiveConflict | undefined> {
  return (await (await database()).table('meta').get(id))?.value
}
export async function listWorldArchiveConflicts(worldId: string, includeResolved = false): Promise<WorldArchiveConflict[]> {
  return (await (await database()).table('meta').toArray()).filter((row: any) => row.key.startsWith('world-archive:conflict:') && row.value.worldId === worldId && (includeResolved || (!row.value.resolution && !row.value.supersededAt))).map((row: any) => row.value)
}
/** Read-only preflight, repeated after network awaits before any cloud write. */
export async function assertWorldArchiveConflict(id: string): Promise<WorldArchiveConflict> {
  const db = await database()
  return db.transaction('r', worldArchiveTables.map(name => db.table(name)), async () => {
    const latest = (await db.table('meta').get(id))?.value as WorldArchiveConflict | undefined
    if (!latest || latest.resolution || latest.supersededAt) throw new Error('This conflict was already resolved or superseded. Sync again.')
    const current = await snapshot(db, latest.worldId)
    if (current.hash !== latest.localHash) throw new Error('The local World changed after capture. Sync again before resolving it.')
    return latest
  })
}
export async function resolveWorldArchiveConflict(id: string, choice: 'local' | 'incoming'): Promise<WorldImportResult> {
  if (!['local', 'incoming'].includes(choice)) throw new Error('Choose the local or incoming version explicitly.')
  const conflict = await getWorldArchiveConflict(id)
  if (!conflict) throw new Error('This conflict no longer exists.')
  const incoming = await decodeWorldArchive(conflict.incoming), db = await database()
  const result = await withProfileReferenceLock<WorldImportResult>(() => db.transaction('rw', worldArchiveTables.map(name => db.table(name)), async () => {
    const latest = (await db.table('meta').get(id))?.value as WorldArchiveConflict | undefined
    if (!latest || latest.resolution || latest.supersededAt) throw new Error('This conflict was already resolved or superseded. Sync again.')
    const current = await snapshot(db, conflict.worldId)
    if (current.hash !== conflict.localHash) throw new Error('The local World changed after this conflict was captured. Sync again before resolving it.')
    if (choice === 'incoming') await apply(db, incoming)
    await db.table('meta').put({ key: id, value: { ...latest, resolution: choice, resolvedAt: Date.now() } })
    const applied = await snapshot(db, conflict.worldId)
    if (choice === 'incoming') await db.table('meta').put({ key: key('receipt', conflict.worldId), value: { incomingHash: conflict.incomingHash, localHash: applied.hash } })
    return { worldId: conflict.worldId, kind: choice === 'local' ? 'unchanged' : incoming.tombstone ? 'deleted' : 'imported', localContentHash: applied.hash } as WorldImportResult
  }))
  notifyWorldArchive(conflict.worldId); return result
}
/** UI deletion entrypoint: empty-only deletion + tombstone commit atomically. */
export async function deleteWorldWithTombstone(worldId: string): Promise<void> {
  const db = await database()
  await db.transaction('rw', worldArchiveTables.map(name => db.table(name)), async () => {
    const data = await capture(db, worldId)
    if (!data) throw new Error('This World no longer exists.')
    if (data.tombstone) return
    await apply(db, { ...empty(worldId), tombstone: { worldId, deletedAt: Date.now() } })
  })
  notifyWorldArchive(worldId)
  // Commit deletion before network I/O. This attempt belongs to the durable owner,
  // not a mounted panel or the automatic-upload preference.
  const sync = await import('../features/sync/world-sync-service')
  if (await sync.getWorldSyncState(worldId)) {
    try { await sync.syncWorldNow(worldId) }
    catch { /* Sync persists error/offline state; local deletion remains successful. */ }
  }
}
/** Missing/conflicting Books stay pending; no phantom Book or forced relinking. */
export async function resolvePendingWorldBookReferences(worldId: string): Promise<string[]> {
  const db = await database()
  const pending = await db.transaction('rw', worldArchiveTables.map(name => db.table(name)), async () => {
    const data = await capture(db, worldId)
    if (!data || data.tombstone) return []
    const remaining: string[] = []
    for (const bookId of (await db.table('meta').get(key('references', worldId)))?.value ?? []) {
      const book = await db.table('entities').get(bookId)
      if (book?.type !== 'book' || (book.worldId && book.worldId !== worldId)) remaining.push(bookId)
      else if (!book.worldId) await setBookWorld(bookId, worldId)
    }
    await db.table('meta').put({ key: key('references', worldId), value: remaining }); return remaining
  })
  notifyWorldArchive(worldId); return pending
}
export async function exportWorldArchiveBlob(worldId: string): Promise<Blob> { return encodeWorldArchive(await readWorldArchive(worldId)) }

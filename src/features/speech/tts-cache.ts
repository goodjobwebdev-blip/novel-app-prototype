import Dexie from 'dexie'

export type TtsOwner = { bookId: string; entityId: string; entityIds?: string[] }
export type TtsCacheIdentity = { provider: string; profile: string; endpoint: string; model: string; voice: string; format: string; version: string; parameters: Record<string, string | number | boolean> }
export type TtsCacheSettings = { enabled: boolean; maxMiB: 64 | 256 | 512 }
type Chunk = { key: string; bookId: string; blob: Blob; bytes: number; lastUsed: number }
type Manifest = { id: string; bookId: string; entityId: string; entityIds: string[]; keys: string[]; ownedKeys: string[] }
export type TtsCachePlan = { owner: TtsOwner; keys: string[]; cached: Array<Blob | undefined>; epochs: Record<string, number>; writable: boolean }
const settingsKey = 'arc-tts-cache-v1'
export const defaultTtsOwner: TtsOwner = { bookId: 'global-speech', entityId: 'read-aloud' }
let databasePromise: Promise<Dexie | undefined> | undefined
export async function ttsCacheDatabase() {
  if (typeof indexedDB === 'undefined') return undefined
  databasePromise ??= (async () => { try { const db = new Dexie('arc-tts-cache-v1'); db.version(1).stores({ chunks: 'key,bookId,lastUsed', manifests: 'id,bookId,entityId,*entityIds', meta: 'key', leases: 'id,expiresAt' }); await db.open(); return db } catch { return undefined } })()
  return databasePromise
}
export function loadTtsCacheSettings(): TtsCacheSettings { try { const value = JSON.parse(localStorage.getItem(settingsKey) ?? '{}'); return { enabled: value.enabled !== false, maxMiB: [64, 256, 512].includes(value.maxMiB) ? value.maxMiB : 256 } } catch { return { enabled: true, maxMiB: 256 } } }
export function saveTtsCacheSettings(value: TtsCacheSettings) { if (![64, 256, 512].includes(value.maxMiB)) throw new Error('Choose 64, 256 or 512 MiB.'); const previous = loadTtsCacheSettings(); localStorage.setItem(settingsKey, JSON.stringify(value)); notifyTtsCache(); if (previous.maxMiB !== value.maxMiB) void trimTtsCache().catch(() => undefined) }
export function notifyTtsCache() { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('arc-tts-cache-changed')) }
export async function ttsChunkKey(owner: TtsOwner, identity: TtsCacheIdentity, text: string) {
  const canonical = JSON.stringify([owner.bookId, identity.provider, identity.profile, identity.endpoint, identity.model, identity.voice, identity.format, identity.version, Object.entries(identity.parameters).sort(([a], [b]) => a.localeCompare(b)), text])
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)))).map(byte => byte.toString(16).padStart(2, '0')).join('')
}
const ownerIds = (owner: TtsOwner) => [...new Set([owner.entityId, ...(owner.entityIds ?? [])])]
const epochKeys = (owner: TtsOwner) => ['epoch:all', `epoch:book:${owner.bookId}`, ...ownerIds(owner).map(id => `epoch:entity:${id}`)]
async function epochsMatch(db: Dexie, plan: TtsCachePlan) { for (const [key, value] of Object.entries(plan.epochs)) if (((await db.table('meta').get(key))?.value ?? 0) !== value) return false; for (const id of [plan.owner.bookId, ...ownerIds(plan.owner)]) if ((await db.table('meta').get(`dead:${id}`))?.value) return false; return true }
export async function readTtsCachePlan(owner: TtsOwner, identity: TtsCacheIdentity, texts: string[]): Promise<TtsCachePlan> {
  const keys = await Promise.all(texts.map(text => ttsChunkKey(owner, identity, text)))
  const plan: TtsCachePlan = { owner: structuredClone(owner), keys, cached: keys.map(() => undefined), epochs: {}, writable: false }
  if (!loadTtsCacheSettings().enabled) return plan
  try {
    const db = await ttsCacheDatabase(); if (!db) return plan
    await db.transaction('rw', db.table('chunks'), db.table('manifests'), db.table('meta'), async () => {
      for (const key of epochKeys(owner)) plan.epochs[key] = (await db.table('meta').get(key))?.value ?? 0
      if (!await epochsMatch(db, plan)) return
      const rows = await db.table('chunks').bulkGet(keys) as Array<Chunk | undefined>
      plan.cached = rows.map(row => row?.blob?.size ? row.blob : undefined)
      for (const row of rows.filter((row): row is Chunk => Boolean(row))) await db.table('chunks').update(row.key, { lastUsed: Date.now() })
      const id = JSON.stringify([owner.bookId, owner.entityId]), previous = await db.table('manifests').get(id) as Manifest | undefined
      const retainedKeys = new Set(await db.table('chunks').toCollection().primaryKeys())
      await db.table('manifests').put({ id, bookId: owner.bookId, entityId: owner.entityId, entityIds: [...new Set([...(previous?.entityIds ?? []), ...ownerIds(owner)])], keys, ownedKeys: [...new Set([...(previous?.ownedKeys ?? []).filter(key => retainedKeys.has(key)), ...keys])] } satisfies Manifest)
      plan.writable = true
    })
  } catch { plan.writable = false }
  return plan
}
async function trimWithDb(db: Dexie, maximum: number, extraBytes = 0, replacing?: string) {
  const leases = await db.table('leases').toArray(), pinned = new Set<string>(leases.filter(lease => lease.expiresAt > Date.now()).flatMap(lease => lease.keys))
  const rows = await db.table('chunks').orderBy('lastUsed').toArray() as Chunk[]
  let bytes = rows.filter(row => row.key !== replacing).reduce((sum, row) => sum + row.bytes, 0) + extraBytes
  for (const row of rows) { if (bytes <= maximum) break; if (row.key === replacing || pinned.has(row.key)) continue; await db.table('chunks').delete(row.key); bytes -= row.bytes }
  return bytes <= maximum
}
export async function writeTtsCacheChunk(plan: TtsCachePlan, index: number, blob: Blob): Promise<boolean> {
  if (!plan.writable || !blob.size || !loadTtsCacheSettings().enabled) return false
  try {
    const db = await ttsCacheDatabase(); if (!db) return false
    const written = await db.transaction('rw', db.table('chunks'), db.table('meta'), db.table('manifests'), db.table('leases'), async () => {
      if (!await epochsMatch(db, plan)) return false
      if (!await trimWithDb(db, loadTtsCacheSettings().maxMiB * 1024 ** 2, blob.size, plan.keys[index])) return false
      const manifestId = JSON.stringify([plan.owner.bookId, plan.owner.entityId]), manifest = await db.table('manifests').get(manifestId) as Manifest | undefined
      if (!manifest) return false
      await db.table('manifests').update(manifestId, { ownedKeys: [...new Set([...manifest.ownedKeys, plan.keys[index]])] })
      await db.table('chunks').put({ key: plan.keys[index], bookId: plan.owner.bookId, blob, bytes: blob.size, lastUsed: Date.now() } satisfies Chunk)
      return true
    })
    if (written) notifyTtsCache(); return written
  } catch { return false }
}
export async function pinTtsCache(plan: TtsCachePlan) {
  const db = await ttsCacheDatabase(); if (!db || !plan.writable) return () => undefined
  const id = crypto.randomUUID(), write = async () => { try { await db.table('leases').put({ id, keys: plan.keys, expiresAt: Date.now() + 60000 }) } catch { /* Temporary audio remains playable. */ } }
  await write(); const timer = setInterval(() => { void write() }, 20000)
  return () => { clearInterval(timer); void db.table('leases').delete(id).catch(() => undefined) }
}
export async function trimTtsCache() { const db = await ttsCacheDatabase(); if (db) await db.transaction('rw', db.table('chunks'), db.table('leases'), () => trimWithDb(db, loadTtsCacheSettings().maxMiB * 1024 ** 2)); notifyTtsCache() }
export async function ttsCacheUsage() { const db = await ttsCacheDatabase(); if (!db) return 0; return (await db.table('chunks').toArray() as Chunk[]).reduce((sum, row) => sum + row.bytes, 0) }
async function bump(db: Dexie, key: string) { await db.table('meta').put({ key, value: ((await db.table('meta').get(key))?.value ?? 0) + 1 }) }
export async function clearTtsCache(bookId?: string) {
  const db = await ttsCacheDatabase(); if (!db) return
  await db.transaction('rw', db.table('chunks'), db.table('manifests'), db.table('meta'), async () => {
    await bump(db, bookId ? `epoch:book:${bookId}` : 'epoch:all')
    if (bookId) { await db.table('chunks').where('bookId').equals(bookId).delete(); await db.table('manifests').where('bookId').equals(bookId).delete() }
    else { await db.table('chunks').clear(); await db.table('manifests').clear() }
  }); notifyTtsCache()
}
export async function deleteTtsCacheOwners(ids: string[]) {
  const db = await ttsCacheDatabase(); if (!db || !ids.length) return
  await db.transaction('rw', db.table('chunks'), db.table('manifests'), db.table('meta'), async () => {
    for (const id of ids) { await bump(db, `epoch:entity:${id}`); await bump(db, `epoch:book:${id}`); await db.table('meta').put({ key: `dead:${id}`, value: true }) }
    const all = await db.table('manifests').toArray() as Manifest[], deleted = all.filter(row => ids.includes(row.bookId) || row.entityIds.some(id => ids.includes(id))), remaining = all.filter(row => !deleted.includes(row))
    const stillReferenced = new Set(remaining.flatMap(row => row.ownedKeys)), removedKeys = [...new Set(deleted.flatMap(row => row.ownedKeys))].filter(key => !stillReferenced.has(key))
    await db.table('manifests').bulkDelete(deleted.map(row => row.id)); await db.table('chunks').bulkDelete(removedKeys)
    await db.table('chunks').where('bookId').anyOf(ids).delete()
  }); notifyTtsCache()
}
export async function readTtsModelInfo<T>(model: string): Promise<T | undefined> { if (!loadTtsCacheSettings().enabled) return undefined; try { return (await (await ttsCacheDatabase())?.table('meta').get(`model:${model}`))?.value as T | undefined } catch { return undefined } }
export async function saveTtsModelInfo<T>(model: string, info: T) { if (!loadTtsCacheSettings().enabled) return; try { await (await ttsCacheDatabase())?.table('meta').put({ key: `model:${model}`, value: info }) } catch { /* Catalog metadata is optional. */ } }

import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import 'fake-indexeddb/auto'
class TestCustomEvent extends Event { constructor(type, options = {}) { super(type); this.detail = options.detail } }
globalThis.CustomEvent = TestCustomEvent
globalThis.window = new EventTarget()
const storage = new Map()
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) }
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const url = new URL(specifier + '.ts', context.parentURL)
    if (existsSync(fileURLToPath(url))) return nextResolve(url.href, context)
  }
  return nextResolve(specifier, context)
} })
const p = await import('../src/data/persistence.ts')
const a = await import('../src/data/world-archive.ts')
const s = await import('../src/features/sync/world-sync-service.ts')
const worlds = await import('../src/features/worlds/world-service.ts')
after(async () => (await p.database()).close())
function fixture(id) {
  return { format: 'arc-world', version: 1, worldId: id, entities: [
    { id, type: 'world', title: 'Canonical world', createdAt: 1, updatedAt: 1 },
    { id: `${id}-entry`, type: 'codexEntry', bookId: id, worldId: id, parentId: id, title: 'Lore', category: 'Location', content: 'Original', autoIncludeTriggers: ['Lore'], createdAt: 1, updatedAt: 1 },
    { id: `${id}-note`, type: 'note', bookId: id, worldId: id, parentId: id, title: 'Note', content: 'Private world note', createdAt: 1, updatedAt: 1 },
    { id: `${id}-chat`, type: 'chat', bookId: id, worldId: id, parentId: id, title: 'Conversation', createdAt: 1, updatedAt: 1 },
    { id: `${id}-message`, type: 'chatMessage', bookId: id, worldId: id, parentId: `${id}-chat`, content: 'History', createdAt: 1, updatedAt: 1 },
  ], snapshots: [{ id: `${id}-snapshot`, entityId: `${id}-entry`, entityType: 'codexEntry', content: 'Previous', createdAt: 1, reason: 'manual' }], dependencies: [], illustrations: [], galleryImages: [], imageJobs: [], bookReferences: ['absent-book'] }
}
test('canonical World import is idempotent, includes Notes/Chat/history and never creates a missing Book', async () => {
  const data = fixture('world-archive-test')
  const blob = a.encodeWorldArchive(data)
  assert.equal((await a.importWorldArchiveBlob(blob)).kind, 'imported')
  assert.equal((await a.importWorldArchiveBlob(blob)).kind, 'unchanged')
  const captured = await a.readWorldArchive(data.worldId)
  assert.equal(captured.entities.find(e => e.type === 'chatMessage').content, 'History')
  assert.equal(captured.snapshots.length, 1)
  assert.deepEqual(captured.bookReferences, ['absent-book'])
  assert.equal(await p.getEntity('absent-book'), undefined)
})
test('different canonical version preserves both copies and requires explicit resolution', async () => {
  const data = fixture('world-conflict-test')
  await a.importWorldArchiveBlob(a.encodeWorldArchive(data))
  const incoming = structuredClone(data)
  incoming.entities[1].content = 'Remote edit'
  const result = await a.importWorldArchiveBlob(a.encodeWorldArchive(incoming))
  assert.equal(result.kind, 'conflict')
  assert.equal((await p.getEntity(data.entities[1].id)).content, 'Original')
  const conflict = await a.getWorldArchiveConflict(result.conflictId)
  assert.equal((await a.decodeWorldArchive(conflict.incoming)).entities[1].content, 'Remote edit')
  assert.equal((await a.decodeWorldArchive(conflict.local)).entities[1].content, 'Original')
  await a.resolveWorldArchiveConflict(result.conflictId, 'incoming')
  assert.equal((await p.getEntity(data.entities[1].id)).content, 'Remote edit')
  assert.equal((await a.getWorldArchiveConflict(result.conflictId)).resolution, 'incoming')
})
test('stale resolution is rejected without overwriting a subsequent local edit', async () => {
  const data = fixture('world-stale-test')
  await a.importWorldArchiveBlob(a.encodeWorldArchive(data))
  const incoming = structuredClone(data); incoming.entities[1].content = 'Remote'
  const result = await a.importWorldArchiveBlob(a.encodeWorldArchive(incoming))
  await p.saveDocumentContent(data.entities[1].id, 'Later local edit')
  await assert.rejects(a.resolveWorldArchiveConflict(result.conflictId, 'incoming'), /changed/)
  assert.equal((await p.getEntity(data.entities[1].id)).content, 'Later local edit')
})
test('empty World deletion records a durable tombstone and old archives cannot resurrect it', async () => {
  const world = await worlds.createWorld('Deleted world')
  const archive = a.encodeWorldArchive(await a.readWorldArchive(world.id))
  await a.deleteWorldWithTombstone(world.id)
  const tombstone = await a.readWorldArchive(world.id)
  assert.equal(tombstone.tombstone.worldId, world.id)
  const result = await a.importWorldArchiveBlob(archive)
  assert.equal(result.kind, 'conflict')
  assert.equal(await p.getEntity(world.id), undefined)
  await assert.rejects(a.resolveWorldArchiveConflict(result.conflictId, 'incoming'), /deleted/)
})
test('nonempty Notes/Chat World cannot be deleted through the sync deletion API', async () => {
  const data = fixture('world-delete-content-test'); data.entities = data.entities.filter(e => e.type !== 'codexEntry'); data.snapshots = []
  await a.importWorldArchiveBlob(a.encodeWorldArchive(data))
  await assert.rejects(a.deleteWorldWithTombstone(data.worldId), /empty/)
  assert.equal((await p.getEntity(data.worldId)).type, 'world')
})
test('archive rejects Book content and foreign-owner dependencies before writing', async () => {
  const data = fixture('world-invalid-test')
  data.entities.push({ id: 'foreign-scene', type: 'scene', bookId: 'foreign-book', parentId: 'foreign-book', content: 'MANUSCRIPT', createdAt: 1, updatedAt: 1 })
  assert.throws(() => a.encodeWorldArchive(data), /invalid/)
  assert.equal(await p.getEntity(data.worldId), undefined)
})
test('World sync uses existing provider auth, namespaced owner identity and conditional writes', async () => {
  const settings = await import('../src/features/sync/sync-settings.ts')
  settings.saveSyncSettings({ endpoint: 'https://sync.example.test', basicUsername: 'writer', basicPassword: 'secret', token: 'x'.repeat(32), automaticUpload: false })
  const data = fixture('world-network-test'); await a.importWorldArchiveBlob(a.encodeWorldArchive(data))
  const original = globalThis.fetch, calls = []; let stored, revision = 0
  globalThis.fetch = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers })
    const meta = { id: 'remote-world', clientBookId: `arc-world:${data.worldId}`, title: 'World', currentRevision: revision, currentEtag: `rev-${revision}`, currentSize: stored?.size ?? 0 }
    if (init.method === 'POST') {
      assert.equal(JSON.parse(init.body).clientBookId, `arc-world:${data.worldId}`)
      return new Response(JSON.stringify(meta), { headers: { ETag: '"rev-0"' } })
    }
    if (init.method === 'PUT') {
      assert.equal(init.headers.get('If-Match'), '"rev-0"'); stored = init.body; revision++
      return new Response(JSON.stringify({ ...meta, currentRevision: revision }), { headers: { ETag: '"rev-1"' } })
    }
    if (url.endsWith('/state')) return new Response(stored, { headers: { ETag: '"rev-1"' } })
    return new Response(JSON.stringify(meta), { headers: { ETag: `"rev-${revision}"` } })
  }
  try {
    assert.equal((await s.enableWorldSync(data.worldId, async () => {})).kind, 'uploaded')
    assert.equal((await s.syncWorldNow(data.worldId, async () => {})).kind, 'unchanged')
    assert.equal((await a.decodeWorldArchive(stored)).worldId, data.worldId)
    assert.match(calls[0].headers.get('Authorization'), /^Basic /)
    assert.equal(calls[0].headers.get('X-Sync-Token'), 'x'.repeat(32))
    assert.equal((await s.getWorldSyncState(data.worldId)).status, 'synced')
  } finally { globalThis.fetch = original }
})

test('superseded cloud conflict cannot authorize a conditional upload', async () => {
  const settings = await import('../src/features/sync/sync-settings.ts')
  settings.saveSyncSettings({ endpoint: 'https://sync.example.test', basicUsername: 'writer', basicPassword: 'secret', token: 'x'.repeat(32), automaticUpload: false })
  const data = fixture('world-superseded-cloud-test'); await a.importWorldArchiveBlob(a.encodeWorldArchive(data))
  const first = structuredClone(data); first.entities[1].content = 'Remote first'
  const stale = await a.importWorldArchiveBlob(a.encodeWorldArchive(first), { remoteETag: '"rev-1"' })
  const second = structuredClone(data); second.entities[1].content = 'Remote second'
  const fresh = await a.importWorldArchiveBlob(a.encodeWorldArchive(second), { remoteETag: '"rev-1"' })
  const db = await p.database()
  await db.table('meta').put({ key: `world-sync:state:${data.worldId}`, value: { worldId: data.worldId, ownerType: 'world', status: 'conflict', endpoint: 'https://sync.example.test', remoteWorldId: 'remote-superseded', remoteETag: '"rev-0"', localContentHash: '', updatedAt: 1, conflictId: fresh.conflictId } })
  const original = globalThis.fetch, writes = []
  let stored = a.encodeWorldArchive(second), revision = 1
  globalThis.fetch = async (url, init) => {
    if (init.method === 'PUT') {
      assert.equal(init.headers.get('If-Match'), '"rev-1"')
      writes.push(init.body); stored = init.body; revision++
    }
    const etag = `"rev-${revision}"`
    if (url.endsWith('/state') && init.method !== 'PUT') return new Response(stored, { headers: { ETag: etag } })
    return new Response(JSON.stringify({ id: 'remote-superseded', clientBookId: `arc-world:${data.worldId}`, currentRevision: revision, currentSize: stored.size, currentEtag: `rev-${revision}` }), { headers: { ETag: etag } })
  }
  try {
    await assert.rejects(s.resolveWorldSyncConflict(data.worldId, stale.conflictId, 'local'), /superseded|unresolved/)
    assert.equal(writes.length, 0, 'stale choices must be rejected BEFORE any cloud write')
    assert.equal((await p.getEntity(data.entities[1].id)).content, 'Original')
    assert.equal((await a.getWorldArchiveConflict(fresh.conflictId)).resolution, undefined)
  } finally { globalThis.fetch = original }
})

test('media bytes, summaries and canonical dependency identities survive a round trip', async () => {
  const data = fixture('world-resources-test'), id = data.worldId
  data.entities.push({ ...data.entities[1], id: `${id}-second`, title: 'Second', autoIncludeTriggers: ['Second'] })
  data.entities.push({ id: `${id}-summary`, type: 'summary', bookId: id, worldId: id, parentId: `${id}-entry`, sourceEntityId: `${id}-entry`, sourceType: 'codexEntry', title: 'Summary', content: 'Summary content', createdAt: 1, updatedAt: 1 })
  data.dependencies.push({ id: `${id}-edge`, bookId: id, sourceId: `${id}-entry`, targetId: `${id}-second`, relationLabel: 'near', includeWithSource: true, createdAt: 1, updatedAt: 1 })
  const pixels = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])], { type: 'image/png' })
  data.illustrations.push({ id: `${id}-image`, entryId: `${id}-entry`, bookId: id, image: pixels, thumbnail: pixels, width: 1, height: 1, caption: '', alt: '', cropX: 50, cropY: 50, createdAt: 1, updatedAt: 1 })
  data.entities[1].primaryImageId = `${id}-image`
  await a.importWorldArchiveBlob(a.encodeWorldArchive(data))
  const captured = await a.readWorldArchive(id), decoded = await a.decodeWorldArchive(a.encodeWorldArchive(captured))
  assert.equal(decoded.dependencies[0].id, `${id}-edge`)
  assert.equal(decoded.entities.find(e => e.type === 'summary').content, 'Summary content')
  assert.deepEqual(new Uint8Array(await decoded.illustrations[0].image.arrayBuffer()), new Uint8Array(await pixels.arrayBuffer()))
  assert.equal((await a.importWorldArchiveBlob(a.encodeWorldArchive(captured))).kind, 'unchanged')
})
test('pending Book references resolve when a real Book becomes available, preserving manuscript', async () => {
  const data = fixture('world-pending-test'); data.bookReferences = ['book-later']
  await a.importWorldArchiveBlob(a.encodeWorldArchive(data))
  const db = await p.database()
  await db.table('entities').add({ id: 'book-later', type: 'book', title: 'Existing Book', createdAt: 1, updatedAt: 1 })
  await db.table('entities').add({ id: 'scene-later', type: 'scene', bookId: 'book-later', parentId: 'book-later', title: 'Scene', content: 'LOCAL MANUSCRIPT', createdAt: 1, updatedAt: 1 })
  assert.deepEqual(await a.resolvePendingWorldBookReferences(data.worldId), [])
  assert.equal((await p.getEntity('book-later')).worldId, data.worldId)
  const exported = await a.readWorldArchive(data.worldId)
  assert.equal(exported.entities.some(e => e.id === 'scene-later'), false)
  assert.equal((await p.getEntity('scene-later')).content, 'LOCAL MANUSCRIPT')
})
test('colliding owner IDs roll back a canonical import without modifying the other owner', async () => {
  const data = fixture('world-collision-test'), db = await p.database()
  await db.table('entities').add({ id: data.entities[1].id, type: 'book', title: 'Unrelated Book', createdAt: 1, updatedAt: 1 })
  await assert.rejects(a.importWorldArchiveBlob(a.encodeWorldArchive(data)), /collides/)
  assert.equal(await p.getEntity(data.worldId), undefined)
  assert.equal((await p.getEntity(data.entities[1].id)).title, 'Unrelated Book')
})
test('incoming deletion preserves a populated local World as a conflict', async () => {
  const data = fixture('world-remote-delete-test'); await a.importWorldArchiveBlob(a.encodeWorldArchive(data))
  const localHash = await (await import('../src/features/sync/sync-hash.ts')).archiveContentHash(await a.exportWorldArchiveBlob(data.worldId))
  const tombstone = { ...data, entities: [], snapshots: [], dependencies: [], illustrations: [], galleryImages: [], imageJobs: [], bookReferences: [], tombstone: { worldId: data.worldId, deletedAt: 10 } }
  const result = await a.importWorldArchiveBlob(a.encodeWorldArchive(tombstone), { expectedLocalHash: localHash })
  assert.equal(result.kind, 'conflict')
  await assert.rejects(a.resolveWorldArchiveConflict(result.conflictId, 'incoming'), /empty/)
  assert.equal((await p.getEntity(data.entities[1].id)).content, 'Original')
})

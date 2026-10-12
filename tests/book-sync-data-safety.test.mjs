import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import 'fake-indexeddb/auto'

class TestCustomEvent extends Event {
  constructor(type, options = {}) { super(type); this.detail = options.detail }
}
globalThis.CustomEvent = TestCustomEvent
globalThis.window = new EventTarget()
const storage = new Map()
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
}
Object.defineProperty(globalThis.navigator, 'onLine', { configurable: true, value: true })
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const url = new URL(specifier + '.ts', context.parentURL)
    if (existsSync(fileURLToPath(url))) return nextResolve(url.href, context)
  }
  return nextResolve(specifier, context)
} })

const p = await import('../src/data/persistence.ts')
const archives = await import('../src/data/book-archive.ts')
const control = await import('../src/features/sync/sync-persistence.ts')
const service = await import('../src/features/sync/sync-service.ts')
const settings = await import('../src/features/sync/sync-settings.ts')
const { archiveContentHash } = await import('../src/features/sync/sync-hash.ts')
const { initialAiSettings } = await import('../src/shared/ai/ai-settings.ts')
after(async () => (await p.database()).close())

const endpoint = 'https://sync.example.test'
const baselineETag = '"rev-1"'
const noPendingSave = async () => {}
function configure() {
  settings.saveSyncSettings({ endpoint, basicUsername: 'writer', basicPassword: 'test-only', token: 'x'.repeat(32), automaticUpload: false })
}
function gate() {
  let enter, release
  const entered = new Promise(resolve => { enter = resolve })
  const released = new Promise(resolve => { release = resolve })
  return { entered, release, async wait() { enter(); await released } }
}
async function capture(bookId) { return archives.encodeBookArchive(await p.readBookArchive(bookId)) }
const cleanups = new WeakMap()
function cleanup(t, callback) { cleanups.get(t).push(callback) }
async function fixture(t) {
  configure()
  const { book, scene } = await p.createBook(initialAiSettings, 'Sync safety fixture')
  const callbacks = []
  cleanups.set(t, callbacks)
  t.after(async () => {
    // Drain gated I/O and restore instrumentation before deleting fixture rows.
    try { for (const callback of callbacks.reverse()) await callback() }
    finally { await p.deleteEntityTree(book.id) }
  })
  await p.saveDocumentContent(scene.id, 'BASELINE manuscript')
  const baseline = await capture(book.id)
  const hash = await archiveContentHash(baseline)
  const remoteId = `remote-${book.id}`
  const link = { bookId: book.id, endpoint, remoteBookId: remoteId, createdAt: 1, updatedAt: 1 }
  const state = { bookId: book.id, status: 'synced', remoteETag: baselineETag, localContentHash: hash, lastSyncedAt: 1, updatedAt: 1 }
  return { book, scene, baseline, hash, remoteId, link, state }
}
async function incomingArchive(f) {
  const data = await archives.decodeBookArchive(f.baseline)
  const scene = data.entities.find(row => row.id === f.scene.id)
  scene.content = 'REMOTE manuscript'
  scene.updatedAt += 100
  return archives.encodeBookArchive(data)
}

// Only the HTTP boundary is faked. Archives, hashes, services and IndexedDB are real.
// A conditional PUT actually changes the remote fixture, so readback detects overwrite.
async function bookTransport(f, options = {}) {
  let stored = options.archive
  let revision = options.revision ?? (stored ? 2 : 0)
  let exists = options.exists ?? Boolean(stored)
  let hash = stored ? await archiveContentHash(stored) : undefined
  const calls = [], writes = []
  const ownerUrl = `${endpoint}/api/v1/books/${encodeURIComponent(f.remoteId)}`
  const metadata = () => ({
    id: f.remoteId, clientBookId: f.book.id, title: f.book.title,
    currentRevision: revision, currentEtag: `rev-${revision}`,
    ...(options.omitHash ? {} : { currentContentHash: hash }),
    currentSize: stored?.size ?? 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  })
  const metadataResponse = () => new Response(JSON.stringify(metadata()), {
    headers: { 'Content-Type': 'application/json', ETag: `"rev-${revision}"` },
  })
  const fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET'
    calls.push({ url, method })
    if (url === `${endpoint}/api/v1/books`) {
      if (method === 'POST') {
        assert.equal(JSON.parse(init.body).clientBookId, f.book.id)
        if (exists) return new Response(JSON.stringify({ error: { code: 'already_exists', message: 'Book already exists' } }), { status: 409 })
        exists = true
        return metadataResponse()
      }
      assert.equal(method, 'GET')
      return new Response(JSON.stringify({ books: exists ? [metadata()] : [] }), { headers: { 'Content-Type': 'application/json' } })
    }
    if (url === ownerUrl) {
      assert.equal(method, 'GET')
      return metadataResponse()
    }
    assert.equal(url, `${ownerUrl}/state`, 'unexpected Book sync route')
    if (method === 'PUT') {
      if (init.headers.get('If-Match') !== `"rev-${revision}"`) return new Response('', { status: 412 })
      assert.ok(init.body instanceof Blob, 'upload must use the real encoded archive')
      stored = init.body
      hash = await archiveContentHash(stored)
      writes.push(stored)
      revision++
      return metadataResponse()
    }
    assert.equal(method, 'GET')
    assert.ok(stored instanceof Blob, 'download requires an existing archive')
    await options.downloadGate?.wait()
    return new Response(stored, { headers: { ETag: `"rev-${revision}"` } })
  }
  return { fetch, calls, writes, get stored() { return stored }, get revision() { return revision } }
}
function installTransport(t, transport) {
  const original = globalThis.fetch
  globalThis.fetch = transport.fetch
  cleanup(t, () => { globalThis.fetch = original })
}
async function durableEdit(f, kind) {
  if (kind === 'scene') {
    await p.saveDocumentContent(f.scene.id, 'LOCAL CHANGE DURING SYNC')
    const snapshot = await p.createSnapshot(f.scene.id, 'manual')
    return { entityId: f.scene.id, content: 'LOCAL CHANGE DURING SYNC', snapshotId: snapshot.id }
  }
  const note = await p.createNote(f.book.id, 'Concurrent Note')
  await p.saveDocumentContent(note.id, 'LOCAL NOTE DURING SYNC')
  const snapshot = await p.createSnapshot(note.id, 'manual')
  return { entityId: note.id, content: 'LOCAL NOTE DURING SYNC', snapshotId: snapshot.id }
}
async function assertPreserved(f, edit, result, transport) {
  const entity = await p.getEntity(edit.entityId)
  const snapshot = await p.readSnapshot(edit.snapshotId)
  const state = await control.getBookSyncState(f.book.id)
  assert.deepEqual({
    entityContent: entity?.content, snapshotContent: snapshot?.content,
    sceneContent: (await p.getEntity(f.scene.id))?.content,
    result: result.kind, status: state?.status,
    baselineHash: state?.localContentHash, baselineETag: state?.remoteETag,
    remoteId: (await control.getSyncLink(f.book.id))?.remoteBookId,
    remoteWrites: transport.writes.length,
  }, {
    entityContent: edit.content, snapshotContent: edit.content,
    sceneContent: edit.entityId === f.scene.id ? edit.content : 'BASELINE manuscript',
    result: 'conflict', status: 'conflict',
    baselineHash: f.hash, baselineETag: baselineETag,
    remoteId: f.remoteId, remoteWrites: 0,
  }, 'a stale incoming archive must preserve the committed edit/history and leave the old sync baseline unresolved')
}

for (const kind of ['scene', 'note']) {
  test(`BUG-01: ${kind} saved during download survives incoming Book sync as a conflict`, { timeout: 10_000 }, async t => {
    const f = await fixture(t)
    await control.saveSyncConnection(f.link, f.state)
    const downloadGate = gate()
    const transport = await bookTransport(f, { archive: await incomingArchive(f), downloadGate })
    installTransport(t, transport)
    let pending
    // Register before starting I/O: release/drain even when setup/assertions fail.
    cleanup(t, async () => { downloadGate.release(); await pending?.catch(() => {}) })
    pending = service.syncBookNow(f.book.id, noPendingSave)
    // Surface unexpected early completion instead of leaving an unresolved gate.
    await Promise.race([downloadGate.entered, pending.then(() => { throw new Error('Sync completed before download gate') })])
    const edit = await durableEdit(f, kind)
    assert.equal((await p.getEntity(edit.entityId)).content, edit.content, 'edit is durable before download resumes')
    downloadGate.release()
    await assertPreserved(f, edit, await pending, transport)
  })

  test(`BUG-01: ${kind} saved at replacement transaction boundary survives a stale preflight`, { timeout: 10_000 }, async t => {
    const f = await fixture(t)
    await control.saveSyncConnection(f.link, f.state)
    const transport = await bookTransport(f, { archive: await incomingArchive(f) })
    installTransport(t, transport)
    const db = await p.database(), replacementGate = gate()
    const transaction = db.transaction
    let paused = false, pending
    // Scheduling instrumentation only: no fake reads/writes/transaction callbacks.
    // Pause BEFORE acquisition, so normal saves can commit without deadlocking.
    const spy = t.mock.method(db, 'transaction', async function (...args) {
      const tables = args.slice(1, -1).flat()
      if (!paused && args[0] === 'rw' && tables.some(table => table.name === 'entities') && tables.some(table => table.name === 'syncLinks')) {
        paused = true
        await replacementGate.wait()
      }
      return transaction.apply(this, args)
    })
    cleanup(t, async () => { replacementGate.release(); await pending?.catch(() => {}); spy.mock.restore() })
    pending = service.syncBookNow(f.book.id, noPendingSave)
    await Promise.race([replacementGate.entered, pending.then(() => { throw new Error('Sync completed without reaching replacement transaction') })])
    const edit = await durableEdit(f, kind)
    replacementGate.release()
    await assertPreserved(f, edit, await pending, transport)
  })
}

test('Book sync still pulls a clean newer cloud archive', async t => {
  const f = await fixture(t)
  await control.saveSyncConnection(f.link, f.state)
  const incoming = await incomingArchive(f)
  const transport = await bookTransport(f, { archive: incoming })
  installTransport(t, transport)
  assert.equal((await service.syncBookNow(f.book.id, noPendingSave)).kind, 'pulled')
  assert.equal((await p.getEntity(f.scene.id)).content, 'REMOTE manuscript')
  const state = await control.getBookSyncState(f.book.id)
  assert.equal(state.status, 'synced')
  assert.equal(state.remoteETag, '"rev-2"')
  assert.equal(state.localContentHash, await archiveContentHash(incoming))
  assert.equal(transport.writes.length, 0)
})

for (const omitHash of [false, true]) {
  test(`BUG-02: re-enable refuses divergent existing cloud Book${omitHash ? ' without metadata hash' : ''} until explicit overwrite`, async t => {
    const f = await fixture(t)
    await control.saveSyncConnection(f.link, f.state)
    await service.disconnectBookSync(f.book.id)
    const incoming = await incomingArchive(f)
    const transport = await bookTransport(f, { archive: incoming, omitHash })
    installTransport(t, transport)
    await p.saveDocumentContent(f.scene.id, 'LOCAL divergent manuscript')
    const localHash = await archiveContentHash(await capture(f.book.id))
    const remoteHash = await archiveContentHash(incoming)
    assert.notEqual(localHash, remoteHash, 'fixture contains genuinely divergent archives')
    const result = await service.enableBookSync(f.book.id, f.book.title, noPendingSave)
    assert.deepEqual({ result: result.kind, writes: transport.writes.length, revision: transport.revision,
      remoteHash: await archiveContentHash(transport.stored), localContent: (await p.getEntity(f.scene.id)).content,
    }, { result: 'conflict', writes: 0, revision: 2, remoteHash, localContent: 'LOCAL divergent manuscript' },
    '409 + latest ETag is not permission to overwrite a different remote archive')
    assert.equal((await control.getBookSyncState(f.book.id)).status, 'conflict')
    assert.equal((await control.getSyncLink(f.book.id)).remoteBookId, f.remoteId, 'explicit recovery needs a durable link')
    // The existing public recovery action, not enable/retry, authorizes replacement.
    assert.equal((await service.forceOverwriteRemote(f.book.id, noPendingSave)).kind, 'uploaded')
    assert.equal(transport.writes.length, 1)
    assert.equal(await archiveContentHash(transport.stored), localHash)
    assert.equal((await control.getBookSyncState(f.book.id)).status, 'synced')
  })
}

test('BUG-02: re-enable identical existing cloud Book reconnects without creating a new revision', async t => {
  const f = await fixture(t)
  const transport = await bookTransport(f, { archive: f.baseline })
  installTransport(t, transport)
  assert.equal((await service.enableBookSync(f.book.id, f.book.title, noPendingSave)).kind, 'unchanged')
  assert.equal(transport.writes.length, 0)
  assert.equal(transport.revision, 2)
  const state = await control.getBookSyncState(f.book.id)
  assert.equal(state.status, 'synced')
  assert.equal(state.remoteETag, '"rev-2"')
  assert.equal(state.localContentHash, f.hash)
})

test('first enable still creates and uploads a previously absent cloud Book after flushing edits', async t => {
  const f = await fixture(t)
  const transport = await bookTransport(f)
  installTransport(t, transport)
  let flushed = 0
  const result = await service.enableBookSync(f.book.id, f.book.title, async () => {
    flushed++
    await p.saveDocumentContent(f.scene.id, 'FLUSHED manuscript')
  })
  assert.equal(result.kind, 'uploaded')
  assert.equal(flushed, 1)
  assert.equal(transport.writes.length, 1)
  assert.equal((await archives.decodeBookArchive(transport.stored)).entities.find(row => row.id === f.scene.id).content, 'FLUSHED manuscript')
  assert.equal((await control.getSyncLink(f.book.id)).remoteBookId, f.remoteId)
})

test('device-local Book navigation remains outside sync hashes and does not cause uploads', async t => {
  const f = await fixture(t)
  const entry = await p.createCodexEntry(f.book.id, 'Navigation target')
  const baseline = await capture(f.book.id)
  const hash = await archiveContentHash(baseline)
  await control.saveSyncConnection(f.link, { ...f.state, localContentHash: hash })
  const transport = await bookTransport(f, { archive: baseline, revision: 1 })
  installTransport(t, transport)
  await p.saveOwnerWorkspaceState(f.book.id, { lastOpenedCodexEntryId: entry.id })
  assert.equal((await p.getOwnerWorkspaceState(f.book.id)).lastOpenedCodexEntryId, entry.id)
  assert.equal(await archiveContentHash(await capture(f.book.id)), hash)
  assert.equal((await service.syncBookNow(f.book.id, noPendingSave)).kind, 'unchanged')
  assert.equal(transport.writes.length, 0)
  assert.equal((await p.getOwnerWorkspaceState(f.book.id)).lastOpenedCodexEntryId, entry.id)
})

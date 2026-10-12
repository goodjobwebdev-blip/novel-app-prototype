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
const mediaStore = await import('../src/features/images/image-store.ts')
const archives = await import('../src/data/book-archive.ts')
const control = await import('../src/features/sync/sync-persistence.ts')
const service = await import('../src/features/sync/sync-service.ts')
const settings = await import('../src/features/sync/sync-settings.ts')
const { archiveContentHash } = await import('../src/features/sync/sync-hash.ts')
const { initialAiSettings } = await import('../src/shared/ai/ai-settings.ts')
const profiles = await import('../src/features/settings/settings-profiles.ts')
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
  return { fetch, calls, writes, advanceRevision() { revision++ }, get stored() { return stored }, get revision() { return revision } }
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

// Synthetic queue rows avoid model/profile setup and never submit a paid request.
// Worker lifecycle transitions and output persistence use the real media store.
async function queuedLocalMedia(f) {
  const job = {
    id: `sync-media-${f.book.id}`, bookId: f.book.id, bookTitle: f.book.title,
    prompt: 'Synthetic sync reference', provider: 'pruna', model: 'synthetic-model',
    modelAlias: 'synthetic', size: { value: '1x1', width: 1, height: 1 },
    task: 'image-to-image', status: 'queued', createdAt: 1,
    localConnectionFingerprint: 'synthetic-device-connection',
    sources: [{ id: 'synthetic-reference', mime: 'image/png', width: 1, height: 1,
      data: new Blob(['synthetic reference bytes'], { type: 'image/png' }) }],
  }
  await (await p.database()).table('imageJobs').add(job)
  return job
}
async function runningLocalMedia(job) {
  const claimed = await mediaStore.claimImageJob('pruna', `sync-worker-${job.bookId}`)
  assert.equal(claimed?.id, job.id, 'the real worker claims the synthetic queued row')
  assert.equal(await mediaStore.patchOwnedImageJob(job.id, claimed.owner, {
    providerJobId: `synthetic-ticket-${job.id}`,
  }), true)
  return (await p.database()).table('imageJobs').get(job.id)
}
async function completeLocalMedia(job) {
  await mediaStore.completeImageJob(job, {
    image: new Blob(['synthetic output bytes'], { type: 'image/png' }),
    thumbnail: new Blob(['synthetic thumbnail bytes'], { type: 'image/png' }),
    width: 1, height: 1,
  })
  const db = await p.database()
  const completed = await db.table('imageJobs').get(job.id)
  assert.equal(completed.status, 'completed')
  assert.equal(completed.decision, undefined, 'the writer has not reviewed or kept the output')
  assert.equal((await db.table('galleryImages').get(completed.assetId)).kept, false)
  return completed
}
async function localMediaSnapshot(jobId) {
  const db = await p.database(), job = await db.table('imageJobs').get(jobId)
  if (!job) return undefined
  const sources = job.sources && await Promise.all(job.sources.map(async source => ({
    ...source, data: [...new Uint8Array(await source.data.arrayBuffer())],
  })))
  const asset = job.assetId ? await db.table('galleryImages').get(job.assetId) : undefined
  return {
    job: { ...job, sources },
    asset: asset && { ...asset,
      image: [...new Uint8Array(await asset.image.arrayBuffer())],
      thumbnail: [...new Uint8Array(await asset.thumbnail.arrayBuffer())],
    },
  }
}
async function assertLocalMediaPreserved(f, expected, result, transport) {
  assert.deepEqual(await localMediaSnapshot(expected.job.id), expected,
    'incoming Book replacement must preserve the local job, request bytes, worker ticket and unreviewed output bytes')
  assert.ok(['pulled', 'conflict'].includes(result.kind), 'preserve device-local media on pull or refuse replacement as a conflict')
  const state = await control.getBookSyncState(f.book.id)
  assert.equal((await control.getSyncLink(f.book.id)).remoteBookId, f.remoteId)
  assert.equal(transport.writes.length, 0, 'a newer cloud archive must not trigger a media-related upload')
  if (result.kind === 'conflict') {
    assert.equal((await p.getEntity(f.scene.id)).content, 'BASELINE manuscript')
    assert.equal(state.status, 'conflict')
    assert.equal(state.remoteETag, baselineETag)
    assert.equal(state.localContentHash, f.hash)
  } else {
    assert.equal((await p.getEntity(f.scene.id)).content, 'REMOTE manuscript')
    assert.equal(state.status, 'synced')
    assert.equal(state.remoteETag, '"rev-2"')
    // localContentHash is the accepted device export, which can normalize media
    // fields and remap conflicting portable profile IDs without changing ETag.
    assert.equal(state.localContentHash, await archiveContentHash(await capture(f.book.id)))
  }
}

for (const transition of ['enqueue queued job', 'advance queued job to running', 'complete running job without Keep']) {
  test(`Book sync replacement preserves local media during download: ${transition}`, { timeout: 10_000 }, async t => {
    const f = await fixture(t)
    let job
    if (transition !== 'enqueue queued job') job = await queuedLocalMedia(f)
    if (transition === 'complete running job without Keep') job = await runningLocalMedia(job)
    await control.saveSyncConnection(f.link, f.state)
    assert.equal(await archiveContentHash(await capture(f.book.id)), f.hash,
      'device-local pending work is excluded from the portable archive hash before sync')
    const downloadGate = gate()
    const transport = await bookTransport(f, { archive: await incomingArchive(f), downloadGate })
    installTransport(t, transport)
    let pending
    cleanup(t, async () => { downloadGate.release(); await pending?.catch(() => {}) })
    pending = service.syncBookNow(f.book.id, noPendingSave)
    await Promise.race([downloadGate.entered, pending.then(() => { throw new Error('Sync completed before download gate') })])
    if (transition === 'enqueue queued job') job = await queuedLocalMedia(f)
    else if (transition === 'advance queued job to running') job = await runningLocalMedia(job)
    else job = await completeLocalMedia(job)
    const expected = await localMediaSnapshot(job.id)
    assert.ok(expected, 'local media is durably committed before download resumes')
    assert.equal(await archiveContentHash(await capture(f.book.id)), f.hash,
      'queued/running jobs and unkept outputs do not change the archive hash; hash-only replacement guards cannot detect their loss')
    downloadGate.release()
    await assertLocalMediaPreserved(f, expected, await pending, transport)
  })
}

test('Book sync clean pull preserves an unreviewed local result that existed before sync', async t => {
  const f = await fixture(t)
  const job = await completeLocalMedia(await runningLocalMedia(await queuedLocalMedia(f)))
  const expected = await localMediaSnapshot(job.id)
  assert.equal(await archiveContentHash(await capture(f.book.id)), f.hash,
    'the unreviewed result is device-local and the portable archive remains clean')
  await control.saveSyncConnection(f.link, f.state)
  const transport = await bookTransport(f, { archive: await incomingArchive(f) })
  installTransport(t, transport)
  await assertLocalMediaPreserved(f, expected, await service.syncBookNow(f.book.id, noPendingSave), transport)
})

test('Book sync preserves Chat media provenance when cloud deletes its origin, and Keep still exports a valid backup', async t => {
  const f = await fixture(t)
  const chats = await import('../src/features/chat/chat-service.ts')
  const chat = await chats.createChat(f.book.id, 'Original media request')
  const user = await chats.createChatMessage(chat, 'user', 'Generate an image of the original scene.')
  const message = await chats.createChatMessage(chat, 'assistant', '')
  const db = await p.database()
  const queued = await queuedLocalMedia(f)
  const origin = { chatId: chat.id, messageId: message.id, directUserMessageId: user.id,
    submissionId: `direct-${user.id}` }
  const claim = { jobId: queued.id, messageId: message.id, callId: `call-${queued.id}` }
  await db.table('entities').update(user.id, { directImageClaim: claim })
  await db.table('entities').update(message.id, { directImageRequest: claim })
  await db.table('imageJobs').update(queued.id, origin)
  const originals = await Promise.all([chat.id, user.id, message.id].map(id => p.getEntity(id)))
  const job = await runningLocalMedia(await db.table('imageJobs').get(queued.id))
  const expected = await localMediaSnapshot(job.id)
  f.baseline = await capture(f.book.id)
  f.hash = await archiveContentHash(f.baseline)
  f.state = { ...f.state, localContentHash: f.hash }
  await control.saveSyncConnection(f.link, f.state)

  const incoming = await archives.decodeBookArchive(await incomingArchive(f))
  const deletedIds = new Set([chat.id, user.id, message.id])
  incoming.entities = incoming.entities.filter(row => !deletedIds.has(row.id))
  const incomingBlob = archives.encodeBookArchive(incoming)
  const decodedIncoming = await archives.decodeBookArchive(incomingBlob)
  assert.equal(decodedIncoming.entities.some(row => deletedIds.has(row.id)), false,
    'the valid incoming archive genuinely deletes the original Chat and both request turns')
  const transport = await bookTransport(f, { archive: incomingBlob })
  installTransport(t, transport)
  const result = await service.syncBookNow(f.book.id, noPendingSave)
  await assertLocalMediaPreserved(f, expected, result, transport)
  if (result.kind === 'conflict') {
    assert.deepEqual(await Promise.all([...deletedIds].map(id => p.getEntity(id))), originals,
      'refusing replacement must retain the original Chat, assistant origin and explicit user request')
  }
  assert.equal(await mediaStore.patchOwnedImageJob(job.id, job.owner, { heartbeat: 123 }), true,
    'the preserved worker still owns its original provider ticket')
  // Real PNG bytes ensure decoding fails on dangling origin references, not invalid media.
  const png = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6AAAAAElFTkSuQmCC', 'base64')], { type: 'image/png' })
  await mediaStore.completeImageJob(job, { image: png, thumbnail: png, width: 1, height: 1 })
  const completed = await db.table('imageJobs').get(job.id)
  assert.equal(completed.status, 'completed')
  assert.equal(completed.providerJobId, job.providerJobId)
  await mediaStore.decideImageJob(job.id, true)
  const kept = await db.table('imageJobs').get(job.id)
  assert.equal(kept.decision, 'kept')
  assert.equal((await db.table('galleryImages').get(kept.assetId)).kept, true)
  assert.deepEqual(Object.fromEntries(Object.keys(origin).map(key => [key, kept[key]])), origin,
    'pull, completion and Keep must not silently erase or rebind immutable request provenance used by retry')
  const portable = await p.readBookArchive(f.book.id)
  assert.ok(portable.imageJobs.some(row => row.id === job.id), 'Keep exports the completed job')
  assert.ok(portable.galleryImages.some(row => row.id === kept.assetId), 'Keep exports its output')
  let restored
  await assert.doesNotReject(async () => {
    restored = await archives.decodeBookArchive(archives.encodeBookArchive(portable))
  }, 'a freshly exported backup after Keep must decode without orphaned Chat/message references')
  assert.ok(restored.imageJobs.some(row => row.id === job.id && row.assetId === kept.assetId))
  const retainedUser = await p.getEntity(user.id)
  assert.equal(retainedUser?.content, user.content, 'the original explicit user request remains accessible, not rebound to another turn')
  assert.equal(retainedUser?.parentId, chat.id)
  assert.deepEqual(retainedUser?.directImageClaim, claim, 'the original user-turn authorization remains intact')
})

test('Book sync preserves a running worker so its original ticket can complete after pull', async t => {
  const f = await fixture(t)
  const job = await runningLocalMedia(await queuedLocalMedia(f))
  const expected = await localMediaSnapshot(job.id)
  await control.saveSyncConnection(f.link, f.state)
  const transport = await bookTransport(f, { archive: await incomingArchive(f) })
  installTransport(t, transport)
  const result = await service.syncBookNow(f.book.id, noPendingSave)
  await assertLocalMediaPreserved(f, expected, result, transport)
  assert.equal(result.kind, 'pulled')
  assert.equal(await mediaStore.patchOwnedImageJob(job.id, job.owner, { heartbeat: 123 }), true)
  const completed = await completeLocalMedia(job)
  assert.equal(completed.id, job.id)
  assert.equal(completed.providerJobId, job.providerJobId)
  const portable = await p.readBookArchive(f.book.id)
  assert.equal(portable.imageJobs.some(row => row.id === job.id), false)
  assert.equal(portable.galleryImages.some(row => row.id === completed.assetId), false,
    'preservation must not implicitly Keep the worker output or export pending work')
})

for (const status of ['interrupted', 'failed', 'cancelled']) {
  test(`Book sync clean pull preserves device-local ${status} work and retry bytes`, async t => {
    const f = await fixture(t)
    const job = await queuedLocalMedia(f)
    await (await p.database()).table('imageJobs').update(job.id, {
      status, providerJobId: `retry-ticket-${job.id}`, error: 'Device-local retry state', hiddenInQueue: true,
    })
    const expected = await localMediaSnapshot(job.id)
    await control.saveSyncConnection(f.link, f.state)
    const transport = await bookTransport(f, { archive: await incomingArchive(f) })
    installTransport(t, transport)
    await assertLocalMediaPreserved(f, expected, await service.syncBookNow(f.book.id, noPendingSave), transport)
  })
}

async function incomingKeptMedia(f) {
  const data = await archives.decodeBookArchive(await incomingArchive(f))
  const png = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6AAAAAElFTkSuQmCC', 'base64')], { type: 'image/png' })
  const asset = {
    id: `cloud-asset-${f.book.id}`, bookId: f.book.id, prompt: 'Cloud kept output',
    width: 1, height: 1, createdAt: 2, kept: true, image: png, thumbnail: png,
  }
  const job = {
    id: `cloud-job-${f.book.id}`, bookId: f.book.id, prompt: asset.prompt,
    provider: 'pruna', model: 'synthetic-model', modelAlias: 'synthetic',
    size: { value: '1x1', width: 1, height: 1 }, status: 'completed', decision: 'kept',
    createdAt: 1, completedAt: 2, assetId: asset.id,
  }
  data.galleryImages = [asset]
  data.imageJobs = [job]
  return { data, asset, job }
}

test('Book sync restores incoming kept media alongside preserved local pending work', async t => {
  const f = await fixture(t)
  const local = await queuedLocalMedia(f)
  const expected = await localMediaSnapshot(local.id)
  const incoming = await incomingKeptMedia(f)
  await control.saveSyncConnection(f.link, f.state)
  const archive = archives.encodeBookArchive(incoming.data)
  const transport = await bookTransport(f, { archive })
  installTransport(t, transport)
  const result = await service.syncBookNow(f.book.id, noPendingSave)
  await assertLocalMediaPreserved(f, expected, result, transport)
  assert.equal(result.kind, 'pulled')
  const stored = await localMediaSnapshot(incoming.job.id)
  assert.equal(stored.job.decision, 'kept')
  assert.equal(stored.asset.kept, true)
  assert.deepEqual(stored.asset.image, [...new Uint8Array(await incoming.asset.image.arrayBuffer())])
  const portable = await p.readBookArchive(f.book.id)
  assert.deepEqual(portable.imageJobs.map(row => row.id), [incoming.job.id])
  assert.deepEqual(portable.galleryImages.map(row => row.id), [incoming.asset.id])
})

test('Book sync replaces existing reviewed kept media at the same IDs normally', async t => {
  const f = await fixture(t)
  const incoming = await incomingKeptMedia(f)
  const db = await p.database()
  await db.table('galleryImages').add({ ...incoming.asset, prompt: 'Old kept output' })
  await db.table('imageJobs').add({ ...incoming.job, prompt: 'Old kept output' })
  const hash = await archiveContentHash(await capture(f.book.id))
  await control.saveSyncConnection(f.link, { ...f.state, localContentHash: hash })
  const archive = archives.encodeBookArchive(incoming.data)
  const transport = await bookTransport(f, { archive })
  installTransport(t, transport)
  assert.equal((await service.syncBookNow(f.book.id, noPendingSave)).kind, 'pulled')
  assert.equal((await db.table('imageJobs').get(incoming.job.id)).prompt, incoming.job.prompt)
  assert.equal((await db.table('galleryImages').get(incoming.asset.id)).prompt, incoming.asset.prompt)
  assert.equal((await control.getBookSyncState(f.book.id)).localContentHash, await archiveContentHash(await capture(f.book.id)))
  assert.equal((await service.syncBookNow(f.book.id, noPendingSave)).kind, 'unchanged', 'normalized accepted media does not produce a false upload')
  assert.equal(transport.writes.length, 0)
})

for (const collision of ['running job', 'unreviewed asset', 'foreign job', 'foreign asset', 'wrong media owner']) {
  test(`Book sync rejects ${collision} collisions and rolls replacement back atomically`, async t => {
    const f = await fixture(t)
    const local = await runningLocalMedia(await queuedLocalMedia(f))
    const completed = collision === 'unreviewed asset' ? await completeLocalMedia(local) : local
    const expected = await localMediaSnapshot(local.id)
    const incoming = await incomingKeptMedia(f)
    const db = await p.database()
    let foreignTable, foreignRow
    if (collision === 'running job') incoming.job.id = local.id
    if (collision === 'unreviewed asset') {
      incoming.asset.id = completed.assetId
      incoming.job.assetId = completed.assetId
    }
    if (collision === 'foreign job' || collision === 'foreign asset') {
      foreignTable = db.table(collision === 'foreign job' ? 'imageJobs' : 'galleryImages')
      foreignRow = { ...(collision === 'foreign job' ? incoming.job : incoming.asset), bookId: 'other-device-owner' }
      await foreignTable.add(foreignRow)
      cleanup(t, () => foreignTable.delete(foreignRow.id))
    }
    if (collision === 'wrong media owner') incoming.asset.bookId = 'other-device-owner'
    await control.saveSyncConnection(f.link, f.state)
    const snapshot = await p.createSnapshot(f.scene.id, 'manual')
    const nextState = { ...f.state, remoteETag: '"rev-2"', localContentHash: 'incoming-hash' }
    await assert.rejects(control.replaceConnectedBookArchive(f.book.id, incoming.data, nextState),
      /conflicts with data already stored|media belongs to a different book/)
    assert.deepEqual(await localMediaSnapshot(local.id), expected)
    assert.equal((await p.getEntity(f.scene.id)).content, 'BASELINE manuscript')
    assert.equal((await p.readSnapshot(snapshot.id)).content, 'BASELINE manuscript')
    assert.deepEqual(await control.getBookSyncState(f.book.id), f.state)
    assert.deepEqual(await control.getSyncLink(f.book.id), f.link)
    if (foreignRow) assert.deepEqual(await foreignTable.get(foreignRow.id), foreignRow)
    if (!['foreign asset', 'unreviewed asset'].includes(collision)) {
      assert.equal(await db.table('galleryImages').get(incoming.asset.id), undefined)
    }
  })
}

test('B3: incoming Series cannot overwrite a foreign Note and replacement rolls back', async t => {
  const f = await fixture(t)
  const other = await p.createBook(initialAiSettings, 'Other owner')
  cleanup(t, () => p.deleteEntityTree(other.book.id))
  const note = await p.createNote(other.book.id, 'Must survive')
  await p.saveDocumentContent(note.id, 'Foreign note body')
  const original = await p.getEntity(note.id)
  const snapshot = await p.createSnapshot(f.scene.id, 'manual')
  const data = await archives.decodeBookArchive(await incomingArchive(f))
  data.entities.find(row => row.id === f.book.id).seriesId = note.id
  data.entities.push({ id: note.id, type: 'series', title: 'Incoming Series', createdAt: 1, updatedAt: 2 })
  await control.saveSyncConnection(f.link, f.state)
  await assert.rejects(control.replaceConnectedBookArchive(f.book.id, data, { ...f.state, remoteETag: '"rev-2"' }), /series.*identity|series.*conflict/i)
  assert.deepEqual(await p.getEntity(note.id), original)
  assert.equal((await p.getEntity(f.scene.id)).content, 'BASELINE manuscript')
  assert.equal((await p.readSnapshot(snapshot.id)).content, 'BASELINE manuscript')
  assert.deepEqual(await control.getBookSyncState(f.book.id), f.state)
})

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

test('B7: cloud import pairs the downloaded ETag with its archive, not stale list hash', async t => {
  const f = await fixture(t)
  const incoming = await incomingArchive(f)
  const transport = await bookTransport(f, { archive: incoming })
  installTransport(t, transport)
  await p.deleteEntityTree(f.book.id)
  const remote = { id: f.remoteId, clientBookId: f.book.id, currentContentHash: f.hash }
  assert.equal(await service.importCloudBook(remote), f.book.id)
  const state = await control.getBookSyncState(f.book.id)
  assert.equal(state.remoteETag, '"rev-2"')
  assert.equal(state.localContentHash, await archiveContentHash(await capture(f.book.id)))
  assert.equal((await service.syncBookNow(f.book.id, noPendingSave)).kind, 'unchanged')
  assert.equal(transport.writes.length, 0)
})

for (const mode of ['import', 'pull']) {
  test(`B8: ${mode} accepts remapped profile and preset IDs without false dirty, but detects later edits`, async t => {
    const f = await fixture(t)
    const data = await archives.decodeBookArchive(await incomingArchive(f))
    const text = data.settingsProfiles.find(row => row.kind === 'text')
    const chat = data.settingsProfiles.find(row => row.id === text.settings.chatPromptPresetId)
    data.entities.find(row => row.settingsType === 'profiles-book').definitions = data.settingsProfiles
    // A distinct remote definition at occupied IDs forces the required clone path.
    text.name += ' remote'; chat.name += ' remote'
    const incoming = archives.encodeBookArchive(data)
    const transport = await bookTransport(f, { archive: incoming })
    installTransport(t, transport)
    let bookSelectionNotified = false
    const selectionChanged = event => { if (event.detail?.bookId === f.book.id) bookSelectionNotified = true }
    window.addEventListener(profiles.SETTINGS_PROFILES_EVENT, selectionChanged)
    cleanup(t, () => window.removeEventListener(profiles.SETTINGS_PROFILES_EVENT, selectionChanged))
    if (mode === 'import') {
      await p.deleteEntityTree(f.book.id)
      await service.importCloudBook({ id: f.remoteId, clientBookId: f.book.id })
    } else {
      await control.saveSyncConnection(f.link, f.state)
      assert.equal((await service.syncBookNow(f.book.id, noPendingSave)).kind, 'pulled')
    }
    const installed = await p.getBookProfileSelections(f.book.id)
    assert.equal(bookSelectionNotified, true, 'installed selections notify mounted book settings even though lazy migration is no longer needed')
    assert.notEqual(installed.text, text.id, 'conflicting shared text profile is cloned')
    const installedText = profiles.loadSettingsProfiles().profiles.find(row => row.id === installed.text)
    assert.notEqual(installedText.settings.chatPromptPresetId, chat.id, 'preset dependency is remapped too')
    assert.equal(profiles.loadSettingsProfiles().profiles.find(row => row.id === text.id).name.endsWith(' remote'), false)
    const state = await control.getBookSyncState(f.book.id)
    assert.equal(state.localContentHash, await archiveContentHash(await capture(f.book.id)), 'accepted local baseline includes installed IDs')
    assert.equal((await service.syncBookNow(f.book.id, noPendingSave)).kind, 'unchanged')
    assert.equal(transport.writes.length, 0)
    const profileCount = profiles.loadSettingsProfiles().profiles.length
    transport.advanceRevision()
    assert.equal((await service.syncBookNow(f.book.id, noPendingSave)).kind, 'pulled')
    assert.equal((await p.getBookProfileSelections(f.book.id)).text, installed.text, 'repeat pulls reuse conflict clones')
    assert.equal(profiles.loadSettingsProfiles().profiles.length, profileCount)
    assert.equal((await service.syncBookNow(f.book.id, noPendingSave)).kind, 'unchanged')
    await p.saveDocumentContent(f.scene.id, 'Actual edit after profile install')
    assert.equal((await service.syncBookNow(f.book.id, noPendingSave)).kind, 'uploaded')
    assert.equal(transport.writes.length, 1)
  })
}

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

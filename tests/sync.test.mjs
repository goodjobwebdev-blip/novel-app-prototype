import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import 'fake-indexeddb/auto'

class TestCustomEvent extends Event { constructor(type, options = {}) { super(type); this.detail = options.detail } }
globalThis.CustomEvent = TestCustomEvent
globalThis.window = new EventTarget()
const values = new Map()
globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) }
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const url = new URL(specifier + '.ts', context.parentURL)
    if (existsSync(fileURLToPath(url))) return nextResolve(url.href, context)
  }
  return nextResolve(specifier, context)
} })

const p = await import('../src/data/persistence.ts')
const archive = await import('../src/data/book-archive.ts')
const sync = await import('../src/features/sync/sync-persistence.ts')
const settings = await import('../src/features/sync/sync-settings.ts')
const api = await import('../src/features/sync/sync-api.ts')
const { initialAiSettings } = await import('../src/shared/ai/ai-settings.ts')
after(async () => (await p.database()).close())

function state(bookId) { return { bookId, status: 'synced', remoteETag: '"rev-1-hash"', localContentHash: 'hash', updatedAt: 1 } }
function link(bookId, remoteBookId = 'remote-1') { return { bookId, remoteBookId, endpoint: 'https://sync.example.test', createdAt: 1, updatedAt: 1 } }

async function disconnectedArchive(title = 'Cloud book') {
  const { book, scene } = await p.createBook(initialAiSettings, title)
  await p.saveDocumentContent(scene.id, 'Cloud manuscript')
  const source = await p.readBookArchive(book.id)
  await p.deleteEntityTree(book.id)
  return { data: source, bookId: book.id, sceneId: scene.id }
}

test('schema v7 stores sync control data outside book archives and deletes it with the local book', async () => {
  assert.equal((await p.database()).verno, 7)
  const fixture = await disconnectedArchive()
  await sync.writeConnectedBookArchive(fixture.data, link(fixture.bookId), state(fixture.bookId))
  assert.equal((await sync.getSyncLink(fixture.bookId)).remoteBookId, 'remote-1')
  assert.equal((await sync.getBookSyncState(fixture.bookId)).status, 'synced')
  const encoded = await archive.encodeBookArchive(await p.readBookArchive(fixture.bookId)).text()
  assert.doesNotMatch(encoded, /remote-1|sync\.example/)
  await p.deleteEntityTree(fixture.bookId)
  assert.equal(await sync.getSyncLink(fixture.bookId), undefined)
  assert.equal(await sync.getBookSyncState(fixture.bookId), undefined)
})

test('connected import and replacement are atomic and preserve remote entity identities', async () => {
  const fixture = await disconnectedArchive('Replace me')
  await sync.writeConnectedBookArchive(fixture.data, link(fixture.bookId, 'replace-remote'), state(fixture.bookId))
  const replacement = structuredClone(fixture.data)
  replacement.entities = replacement.entities.map(entity => entity.id === fixture.sceneId ? { ...entity, content: 'Remote replacement', updatedAt: 99 } : entity)
  await sync.replaceConnectedBookArchive(fixture.bookId, replacement, { ...state(fixture.bookId), remoteETag: '"rev-2-hash"', localContentHash: 'next' })
  assert.equal((await p.getEntity(fixture.sceneId)).content, 'Remote replacement')
  assert.equal((await sync.getSyncLink(fixture.bookId)).remoteBookId, 'replace-remote')
  assert.equal((await sync.getBookSyncState(fixture.bookId)).remoteETag, '"rev-2-hash"')
})

test('duplicate remote identity rolls back an entire connected import', async () => {
  const first = await disconnectedArchive('First remote')
  await sync.writeConnectedBookArchive(first.data, link(first.bookId, 'same-remote'), state(first.bookId))
  const second = await disconnectedArchive('Second remote')
  await assert.rejects(sync.writeConnectedBookArchive(second.data, link(second.bookId, 'same-remote'), state(second.bookId)), /already connected/)
  assert.equal(await p.getEntity(second.bookId), undefined)
  assert.equal(await sync.getSyncLink(second.bookId), undefined)
})

test('sync settings normalize endpoints, reject embedded credentials, and remain device-global', () => {
  const saved = settings.saveSyncSettings({ endpoint: 'https://sync.example.test/path/', basicUsername: 'writer', basicPassword: 'secret', token: 'x'.repeat(32), automaticUpload: true })
  assert.equal(saved.endpoint, 'https://sync.example.test/path')
  assert.equal(settings.loadSyncSettings().automaticUpload, true)
  assert.throws(() => settings.normalizeSyncEndpoint('https://user:pass@example.test'), /credentials/)
  assert.throws(() => settings.normalizeSyncEndpoint('http://example.test'), /HTTPS/)
  assert.equal(settings.normalizeSyncEndpoint('http://localhost:8087/'), 'http://localhost:8087')
})

test('sync API sends Basic Auth separately from the application token', async () => {
  const originalFetch = globalThis.fetch
  let captured
  globalThis.fetch = async (url, init) => {
    captured = { url, init }
    return new Response(JSON.stringify({ id: 'user-1', email: 'writer@example.test' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  try {
    const account = await api.testSyncConnection({ endpoint: 'https://sync.example.test', basicUsername: 'writer', basicPassword: 'password', token: 't'.repeat(32), automaticUpload: false })
    assert.equal(account.email, 'writer@example.test')
    assert.equal(captured.init.headers.get('X-Sync-Token'), 't'.repeat(32))
    assert.match(captured.init.headers.get('Authorization'), /^Basic /)
    assert.equal(captured.init.credentials, 'include')
    assert.equal(captured.url, 'https://sync.example.test/api/v1/me')
  } finally { globalThis.fetch = originalFetch }
})

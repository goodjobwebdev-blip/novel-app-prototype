import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import 'fake-indexeddb/auto'
import { transpileSourceTree } from './transpile-source-tree.mjs'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://arc.test/' })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'localStorage']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const directory = mkdtempSync(new URL('../node_modules/.world-sync-ui-test-', import.meta.url))
transpileSourceTree(directory)
const moduleAt = name => import(pathToFileURL(`${directory}/${name}.mjs`))
const React = await import('react'), { act } = React
const { createRoot } = await import('react-dom/client')
const p = await moduleAt('data/persistence'), a = await moduleAt('data/world-archive')
const s = await moduleAt('features/sync/world-sync-service')
const worlds = await moduleAt('features/worlds/world-service')
const settings = await moduleAt('features/sync/sync-settings')
const { DeletedWorldSync } = await moduleAt('features/sync/DeletedWorldSync')
const db = await p.database()
after(() => { db.close(); dom.window.close(); rmSync(directory, { recursive: true, force: true }) })
async function settle(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    let ready
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); ready = await predicate() })
    if (ready) return
  }
  assert.fail(`UI did not settle: ${document.body.textContent}`)
}

test('deleted owner list exposes durable error/retry and in-flight sync survives library unmount', async () => {
  settings.saveSyncSettings({ endpoint: 'https://sync.example.test', basicUsername: 'writer', basicPassword: 'secret', token: 'x'.repeat(32), automaticUpload: false })
  const world = await worlds.createWorld('Deleted owner retry')
  const remoteArchive = await a.exportWorldArchiveBlob(world.id)
  await a.deleteWorldWithTombstone(world.id)
  await db.table('meta').put({ key: `world-sync:state:${world.id}`, value: { worldId: world.id, ownerType: 'world', status: 'error', message: 'Offline deletion upload failed', endpoint: 'https://sync.example.test', remoteWorldId: 'deleted-ui-remote', remoteETag: '"rev-1"', localContentHash: 'old-live-hash', updatedAt: 1 } })
  const original = globalThis.fetch
  let stored = remoteArchive, revision = 1, release
  const calls = []
  const gate = new Promise(resolve => { release = resolve })
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET'
    const ownerUrl = 'https://sync.example.test/api/v1/books/deleted-ui-remote'
    assert.ok(url === ownerUrl || url === `${ownerUrl}/state`, `Unexpected sync URL: ${url}`)
    calls.push(method)
    if (url === ownerUrl) { assert.equal(method, 'GET'); await gate }
    else if (method === 'PUT') {
      assert.equal(init.headers.get('If-Match'), `"rev-${revision}"`)
      assert.ok(init.body instanceof Blob); stored = init.body; revision++
    } else {
      assert.equal(method, 'GET'); assert.ok(stored instanceof Blob)
      return new Response(stored, { headers: { ETag: `"rev-${revision}"` } })
    }
    const etag = `"rev-${revision}"`
    return new Response(JSON.stringify({ id: 'deleted-ui-remote', clientBookId: `arc-world:${world.id}`, currentRevision: revision, currentEtag: `rev-${revision}`, currentSize: stored.size }), { headers: { ETag: etag } })
  }
  let root = createRoot(document.getElementById('root'))
  try {
    await act(async () => { root.render(React.createElement(DeletedWorldSync)) })
    await settle(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Retry sync'))
    assert.match(document.body.textContent, /Deleted World|Deleted Worlds/)
    assert.match(document.body.textContent, /Offline deletion upload failed/)
    assert.deepEqual(calls, [], 'mounting recovery controls must not automatically sync or resolve')
    const retry = [...document.querySelectorAll('button')].find(button => button.textContent === 'Retry sync')
    await act(async () => { retry.click() })
    await settle(async () => (await s.getWorldSyncState(world.id)).status === 'syncing')
    await settle(() => calls.length === 1)
    assert.deepEqual(calls, ['GET'])
    assert.equal(stored, remoteArchive, 'upload remains gated until after unmount')
    await act(async () => { root.unmount() })
    root = undefined
    release()
    await settle(async () => (await s.getWorldSyncState(world.id)).status === 'synced')
    assert.deepEqual(calls, ['GET', 'PUT', 'GET'])
    assert.equal(revision, 2)
    assert.equal((await a.decodeWorldArchive(stored)).tombstone.worldId, world.id)
    assert.equal(await p.getEntity(world.id), undefined)
    root = createRoot(document.getElementById('root'))
    await act(async () => { root.render(React.createElement(DeletedWorldSync)) })
    await settle(() => document.body.textContent.includes('Connected · synced'))
    assert.doesNotMatch(document.body.textContent, /Offline deletion upload failed/)
  } finally {
    release(); globalThis.fetch = original
    if (root) await act(async () => { root.unmount() })
  }
})

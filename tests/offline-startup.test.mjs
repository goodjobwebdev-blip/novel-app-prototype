import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'

const origin = 'https://arc.test'
const root = '/novel-app-prototype/'
const asset = `${origin}${root}assets/index-old.js`
const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
function worker(fetch, cacheUnavailable = false) {
  const entries = new Map(), listeners = {}, deleted = []
  const key = (request) => typeof request === 'string' ? request : request.url
  const cache = { match: async (request) => entries.get(key(request))?.clone(), put: async (request, response) => entries.set(key(request), response), add: async () => {} }
  vm.runInNewContext(source, { URL, Response, fetch, caches: { open: async () => { if (cacheUnavailable) throw new Error('Cache unavailable'); return cache }, keys: async () => ['unrelated-app', 'novel-app-prototype-v0', 'novel-app-prototype-v1'], delete: async (key) => deleted.push(key) }, self: { location: { origin }, addEventListener: (name, callback) => { listeners[name] = callback }, skipWaiting() {}, clients: { claim() {} } } })
  return { entries, deleted, async activate() { let pending; listeners.activate({ waitUntil: (promise) => { pending = promise } }); await pending }, async request(url, mode = 'cors') { let pending; listeners.fetch({ request: { url, mode, method: 'GET' }, respondWith: (promise) => { pending = promise } }); return pending } }
}

test('a deployment cannot replace a cached hashed bundle with a 404', async () => {
  const w = worker(async () => new Response('Not found', { status: 404 }))
  w.entries.set(asset, new Response('working JavaScript', { headers: { 'content-type': 'application/javascript' } }))
  assert.equal(await (await w.request(asset)).text(), 'working JavaScript')
  assert.equal(await w.entries.get(asset).clone().text(), 'working JavaScript')
})

test('offline HTML fallback is only used for navigation, never for a missing JS bundle', async () => {
  const w = worker(async () => { throw new Error('Offline') })
  w.entries.set(root, new Response('<html>ARC</html>', { headers: { 'content-type': 'text/html' } }))
  assert.equal((await w.request(asset)).type, 'error')
  assert.equal(await (await w.request(`${origin}${root}`, 'navigate')).text(), '<html>ARC</html>')
})

test('failed assets are not cached and an older poisoned entry is replaced by a successful response', async () => {
  const failed = worker(async () => new Response('404', { status: 404 }))
  assert.equal((await failed.request(asset)).status, 404)
  assert.equal(failed.entries.has(asset), false)
  const recovered = worker(async () => new Response('recovered JS', { headers: { 'content-type': 'application/javascript' } }))
  recovered.entries.set(asset, new Response('<html>wrong fallback</html>', { headers: { 'content-type': 'text/html' } }))
  assert.equal(await (await recovered.request(asset)).text(), 'recovered JS')
})

test('the worker stays within the app scope and preserves unrelated caches', async () => {
  const w = worker(async () => { throw new Error('Should not fetch') })
  assert.equal(await w.request('https://api.example.com/private'), undefined)
  assert.equal(await w.request(`${origin}/other-app/`), undefined)
  await w.activate()
  assert.deepEqual(w.deleted, ['novel-app-prototype-v0'])
})

test('unavailable cache storage does not block an online app load', async () => {
  const w = worker(async () => new Response('online bundle'), true)
  assert.equal(await (await w.request(asset)).text(), 'online bundle')
})

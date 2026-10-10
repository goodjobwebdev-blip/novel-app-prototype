import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after } from 'node:test'
import { transpileSourceTree } from './transpile-source-tree.mjs'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { JSDOM } from 'jsdom'
import 'fake-indexeddb/auto'
import Dexie from 'dexie'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://arc.test/' })
for (const key of ['window', 'document', 'HTMLElement', 'CustomEvent', 'localStorage']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const directory = mkdtempSync(new URL('../node_modules/.arc-library-test-', import.meta.url))
transpileSourceTree(directory)
after(async () => {
  try { (await p.database()).close() }
  finally { dom.window.close(); rmSync(directory, { recursive: true, force: true }) }
})

const legacy = new Dexie('arc-novel-local-v1')
legacy.version(3).stores({ entities: 'id,type,bookId,parentId,[parentId+order],updatedAt', snapshots: 'id,entityId,entityType,createdAt,[entityId+createdAt],reason', codexDependencies: 'id,bookId,sourceId,targetId,[bookId+sourceId],[bookId+targetId],[sourceId+targetId],updatedAt', meta: 'key' })
await legacy.open()
const existing = [
  { id: 'old-book', type: 'book', title: 'My existing novel', createdAt: 1, updatedAt: 1 },
  { id: 'old-scene', type: 'scene', bookId: 'old-book', parentId: 'old-book', content: 'Do not lose my writing.', createdAt: 1, updatedAt: 1 },
  { id: 'old-codex', type: 'codexEntry', bookId: 'old-book', title: 'Mara', content: 'Existing lore', createdAt: 1, updatedAt: 1 },
]
await legacy.table('entities').bulkPut(existing)
await legacy.table('snapshots').put({ id: 'old-snapshot', entityId: 'old-scene', content: 'Earlier draft', createdAt: 1 })
await legacy.table('meta').bulkPut([
  { key: 'prototype-seeded-v1', value: true, createdAt: 1 },
  { key: 'prototype-content-seeded-v1', value: true, createdAt: 1 },
  { key: 'old-book-metadata', value: 'Discard with the old library', createdAt: 1 },
])
legacy.close()
const p = await import(pathToFileURL(`${directory}/data/persistence.mjs`))
const ai = await import(pathToFileURL(`${directory}/shared/ai/ai-settings.mjs`))
const { initialAiSettings } = ai
const profiles = await import(pathToFileURL(`${directory}/features/settings/settings-profiles.mjs`))
const globalSettings = () => [localStorage.getItem(ai.AI_SETTINGS_STORAGE_KEY), localStorage.getItem(profiles.SETTINGS_PROFILES_STORAGE_KEY)]
let postResetFixture
const { useBookLibrary } = await import(pathToFileURL(`${directory}/data/useBookLibrary.mjs`))
let library
function Home() {
  library = useBookLibrary('Sample story')
  return React.createElement('div', null, library.state, library.error, ...library.books.map((book) => React.createElement('p', { key: book.id }, book.title)))
}
async function settle(predicate) {
  for (let i = 0; i < 100 && !predicate(); i++) await act(async () => new Promise((resolve) => setTimeout(resolve, 10)))
  assert.ok(predicate(), document.body.textContent)
}

test('first startup retries a failed database open, intentionally resets old books and drafts, and preserves global settings', async t => {
  ai.saveAiSettings({ ...initialAiSettings, provider: 'fake', apiKey: 'global-test-key', baseUrl: 'https://provider.invalid/v1' })
  const custom = profiles.createSettingsProfile('text', 'Global profile survives reset')
  const settingsBefore = globalSettings()
  const open = t.mock.method(Dexie.prototype, 'open', function () { return Promise.reject(new Error('Temporary storage failure')) })
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await act(async () => root.unmount()) })
  await act(async () => root.render(React.createElement(Home)))
  await settle(() => library.state === 'error')
  assert.match(library.error, /Temporary storage failure/)
  open.mock.restore()
  await act(async () => library.retry())
  await settle(() => library.state === 'ready' && library.series.length > 0)
  assert.deepEqual(library.books.map(book => book.id), [p.PROTOTYPE_BOOK_ID])
  for (const entity of existing) assert.equal(await p.getEntity(entity.id), undefined, 'First startup intentionally deletes old entities')
  const db = await p.database()
  assert.equal(db.verno, 8)
  assert.equal(await db.table('snapshots').get('old-snapshot'), undefined)
  assert.equal(await db.table('meta').get('old-book-metadata'), undefined)
  for (const key of ['world-model-reset-v1', 'prototype-seeded-v1', 'prototype-content-seeded-v1']) {
    assert.equal((await db.table('meta').get(key)).value, true)
  }
  assert.equal((await p.getEntity(p.PROTOTYPE_SCENE_ID)).content, 'Sample story')
  assert.ok(await p.getEntity('note-remembered-doors'), 'Old seed markers do not prevent fresh demo content')
  assert.ok(db.tables.some(table => table.name === 'illustrationUndo'))
  assert.deepEqual(globalSettings(), settingsBefore, 'The hard reset leaves global connections and profiles unchanged')
  assert.ok(profiles.loadSettingsProfiles().profiles.some(profile => profile.id === custom.id))
})

test('after the reset marker, a failed startup read can retry without losing new books, drafts, or snapshots', async t => {
  await p.ensurePrototypeSeed('demo')
  const db = await p.database()
  const markerBefore = await db.table('meta').get('world-model-reset-v1')
  assert.equal(markerBefore.value, true)
  postResetFixture = await p.createBook(initialAiSettings, 'My post-reset novel')
  await p.saveDocumentContent(postResetFixture.scene.id, 'Keep this post-reset writing.')
  const entry = await p.createCodexEntry(postResetFixture.book.id, 'Mara', 'Other')
  await p.saveDocumentContent(entry.id, 'Post-reset lore')
  const snapshot = await p.createSnapshot(postResetFixture.scene.id, 'manual', 'Earlier post-reset draft')
  const settingsBefore = globalSettings()
  const original = IDBObjectStore.prototype.get
  const read = t.mock.method(IDBObjectStore.prototype, 'get', function (key, ...args) {
    if (this.name === 'meta' && key === 'world-model-reset-v1') throw new DOMException('Temporary storage read failure', 'UnknownError')
    return original.call(this, key, ...args)
  })
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await act(async () => root.unmount()) })
  await act(async () => root.render(React.createElement(Home)))
  await settle(() => library.state === 'error')
  assert.match(library.error, /Temporary storage read failure/)
  read.mock.restore()
  await act(async () => library.retry())
  await settle(() => library.state === 'ready' && library.series.length > 0)
  assert.ok(library.books.some(book => book.id === postResetFixture.book.id))
  assert.equal((await p.getEntity(postResetFixture.book.id)).title, postResetFixture.book.title)
  assert.equal((await p.getEntity(postResetFixture.scene.id)).content, 'Keep this post-reset writing.')
  assert.equal((await p.getEntity(entry.id)).content, 'Post-reset lore')
  assert.equal((await db.table('snapshots').get(snapshot.id)).content, 'Earlier post-reset draft')
  assert.deepEqual(await db.table('meta').get('world-model-reset-v1'), markerBefore)
  assert.equal((await p.getEntity(p.PROTOTYPE_SCENE_ID)).content, 'Sample story', 'Later startup does not reseed demo prose')
  assert.deepEqual(globalSettings(), settingsBefore)
  const created = await p.createBook(initialAiSettings, 'Created after recovery')
  assert.ok((await p.listBooks()).some(book => book.id === created.book.id))
})

test('series migration failure does not hide books or disable the ready library', async t => {
  await p.putEntity({ id: 'bad-legacy-series', type: 'series', title: null, createdAt: 1, updatedAt: 1 })
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await act(async () => root.unmount()) })
  await act(async () => root.render(React.createElement(Home)))
  await settle(() => Boolean(library.error))
  assert.equal(library.state, 'ready')
  assert.ok(library.books.some(book => book.id === postResetFixture.book.id))
})

test('the actual home screen keeps New book accessible and displays creation failures', async t => {
  const { default: Workspace } = await import(pathToFileURL(`${directory}/app/Workspace.mjs`))
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await act(async () => root.unmount()) })
  const prototype = IDBObjectStore.prototype
  const original = prototype.put
  try {
    await act(async () => root.render(React.createElement(Workspace)))
    const newBook = () => document.querySelector('button[aria-label="New book"]')
    await settle(() => newBook() && !newBook().disabled)
    assert.match(document.body.textContent, /My post-reset novel/)
    prototype.put = function (value, ...args) {
      if (value.type === 'book' && value.title === 'Untitled Book') throw new DOMException('Not enough storage to create this book', 'QuotaExceededError')
      return original.call(this, value, ...args)
    }
    await act(async () => newBook().click())
    await settle(() => document.querySelector('.arc-toast[role="alert"]')?.textContent.includes('Not enough storage'))
    assert.equal(newBook().disabled, false)
    assert.match(document.body.textContent, /My post-reset novel/)
  } finally {
    prototype.put = original
  }
})

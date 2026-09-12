import test, { after } from 'node:test'
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
for (const filename of readdirSync(new URL('../src/', import.meta.url)).filter((name) => /\.tsx?$/.test(name))) {
  const source = readFileSync(new URL(`../src/${filename}`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/import ['"][^'"]+\.css['"];?/g, '').replace(/(['"])(\.\/[^'"]+)\1/g, (_, quote, path) => `${quote}${path.replace(/\.tsx?$/, '')}.mjs${quote}`)
  writeFileSync(`${directory}/${filename.replace(/\.tsx?$/, '.mjs')}`, compiled)
}
after(() => { dom.window.close(); rmSync(directory, { recursive: true, force: true }) })

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
legacy.close()
const p = await import(pathToFileURL(`${directory}/persistence.mjs`))
const { initialAiSettings } = await import(pathToFileURL(`${directory}/ai-settings.mjs`))
const { useBookLibrary } = await import(pathToFileURL(`${directory}/useBookLibrary.mjs`))
let library
function Home() {
  library = useBookLibrary('Sample story')
  return React.createElement('div', null, library.state, library.error, ...library.books.map((book) => React.createElement('p', { key: book.id }, book.title)))
}
async function settle(predicate) {
  for (let i = 0; i < 100 && !predicate(); i++) await act(async () => new Promise((resolve) => setTimeout(resolve, 10)))
  assert.ok(predicate(), document.body.textContent)
}

test('a failed database open can retry and recover existing books, drafts, and new book creation', async () => {
  const original = Dexie.prototype.open
  Dexie.prototype.open = function () { return Promise.reject(new Error('Temporary storage failure')) }
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(React.createElement(Home)))
    await settle(() => library.state === 'error')
    assert.match(library.error, /Temporary storage failure/)
    Dexie.prototype.open = original
    await act(async () => library.retry())
    await settle(() => library.state === 'ready' && library.series.length > 0)
    assert.ok(library.books.some((book) => book.id === 'old-book'))
    for (const entity of existing) {
      const saved = await p.getEntity(entity.id)
      assert.deepEqual(Object.fromEntries(Object.keys(entity).map(key => [key, saved[key]])), entity)
      if (entity.type === 'codexEntry') { assert.equal(saved.typeId, 'lore-other'); assert.equal(saved.category, 'Other') }
    }
    const db = new Dexie('arc-novel-local-v1')
    await db.open()
    assert.equal((await db.table('snapshots').get('old-snapshot')).content, 'Earlier draft')
    assert.ok(db.tables.some((table) => table.name === 'illustrationUndo'))
    db.close()
    const created = await p.createBook(initialAiSettings, 'Created after recovery')
    assert.ok((await p.listBooks()).some((book) => book.id === created.book.id))
  } finally {
    Dexie.prototype.open = original
    await act(async () => root.unmount())
  }
})

test('series migration failure does not hide books or disable the ready library', async () => {
  await p.putEntity({ id: 'bad-legacy-series', type: 'series', title: null, createdAt: 1, updatedAt: 1 })
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(React.createElement(Home)))
    await settle(() => Boolean(library.error))
    assert.equal(library.state, 'ready')
    assert.ok(library.books.some((book) => book.id === 'old-book'))
  } finally { await act(async () => root.unmount()) }
})

test('the actual home screen keeps New book accessible and displays creation failures', async () => {
  const { default: Workspace } = await import(pathToFileURL(`${directory}/Workspace.mjs`))
  const root = createRoot(document.getElementById('root'))
  const db = new Dexie('arc-novel-local-v1')
  await db.open()
  const prototype = IDBObjectStore.prototype
  const original = prototype.put
  try {
    await act(async () => root.render(React.createElement(Workspace)))
    const newBook = () => document.querySelector('button[aria-label="New book"]')
    await settle(() => newBook() && !newBook().disabled)
    assert.match(document.body.textContent, /My existing novel/)
    prototype.put = function (value, ...args) {
      if (value.type === 'book' && value.title === 'Untitled Book') throw new DOMException('Not enough storage to create this book', 'QuotaExceededError')
      return original.call(this, value, ...args)
    }
    await act(async () => newBook().click())
    await settle(() => document.querySelector('.app-toast')?.textContent.includes('Not enough storage'))
    assert.equal(newBook().disabled, false)
    assert.match(document.body.textContent, /My existing novel/)
  } finally {
    prototype.put = original
    db.close()
    await act(async () => root.unmount())
  }
})

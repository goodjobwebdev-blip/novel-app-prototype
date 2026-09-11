import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { JSDOM } from 'jsdom'
import 'fake-indexeddb/auto'

const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'https://arc.test/' })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLDialogElement', 'sessionStorage', 'localStorage', 'Event', 'CustomEvent']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const visualViewport = new dom.window.EventTarget()
visualViewport.height = 700
visualViewport.offsetTop = 0
Object.defineProperty(dom.window, 'visualViewport', { value: visualViewport })
Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth', { get: () => 300 })
Object.defineProperty(dom.window.HTMLElement.prototype, 'clientHeight', { get: () => 300 })
dom.window.HTMLElement.prototype.setPointerCapture = function () {}
dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
globalThis.ResizeObserver = class { constructor(callback) { this.callback = callback } observe() { this.callback() } disconnect() {} }

const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { act } = React
const directory = mkdtempSync(new URL('../node_modules/.arc-image-workspace-ui-test-', import.meta.url))
for (const filename of readdirSync(new URL('../src/', import.meta.url)).filter((name) => /\.tsx?$/.test(name))) {
  const source = readFileSync(new URL(`../src/${filename}`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
    .replace(/import ['"][^'"]+\.css['"];?/g, '')
    .replace(/(['"])(\.\/[^'"]+)\1/g, (_, quote, path) => `${quote}${path.replace(/\.tsx?$/, '')}.mjs${quote}`)
  writeFileSync(`${directory}/${filename.replace(/\.tsx?$/, '.mjs')}`, compiled)
}
const moduleAt = (name) => import(pathToFileURL(`${directory}/${name}.mjs`))
const p = await moduleAt('persistence')
const settings = await moduleAt('image-settings')
const store = await moduleAt('image-store')
const { initialAiSettings } = await moduleAt('ai-settings')
const { default: ImageWorkspace, createImageWorkspaceState } = await moduleAt('ImageWorkspace')
after(async () => { (await p.database()).close(); dom.window.close(); rmSync(directory, { recursive: true, force: true }) })

const h = React.createElement
const button = (text) => [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === text || item.getAttribute('aria-label') === text)
async function click(text) {
  const target = button(text)
  assert.ok(target, `Button ${text} exists: ${document.body.textContent}`)
  await act(async () => target.click())
}
async function input(element, value) {
  await act(async () => {
    const proto = element instanceof dom.window.HTMLTextAreaElement ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value)
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
}
async function settle(predicate) {
  for (let i = 0; i < 100 && !predicate(); i++) await act(async () => new Promise((resolve) => setTimeout(resolve, 10)))
  assert.ok(predicate(), document.body.textContent)
}
async function clearImageData() {
  const db = await p.database()
  await db.table('imageJobs').clear()
  await db.table('galleryImages').clear()
  await db.table('illustrations').clear()
}
function configure() {
  const favorite = settings.imageFavorite(settings.documentedImageModels.find((model) => model.id === 'gpt-image-1'), [])
  favorite.alias = 'Portrait'
  settings.saveImageSettings({ favorites: [favorite], keys: { openai: '', nanogpt: '', pruna: '' }, defaultAlias: 'Portrait' })
}
function ControlledWorkspace({ revision = 0, bookId = 'controlled-book', bookTitle = 'The Controlled Novel', onBack = () => {}, onSettings = () => {} }) {
  const [state, setState] = React.useState(createImageWorkspaceState)
  return h(ImageWorkspace, { key: revision, bookId, bookTitle, state, onStateChange: setState, onBack, onSettings })
}

const png = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6AAAAAElFTkSuQmCC', 'base64')], { type: 'image/png' })

test('standalone workspace has Generate/Gallery tabs and wires its header', async () => {
  configure()
  const state = createImageWorkspaceState()
  let backCalls = 0, settingsCalls = 0, changed
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(h(ImageWorkspace, {
      bookTitle: 'A Book of Images', state, onStateChange: (next) => { changed = next },
      onBack: () => { backCalls++ }, onSettings: () => { settingsCalls++ },
    })))
    assert.equal(document.querySelector('#page-title').textContent, 'Images')
    assert.match(document.querySelector('.image-workspace-header').textContent, /A Book of Images/)
    assert.deepEqual([...document.querySelectorAll('[role=tab]')].map((tab) => tab.textContent.trim()), ['Generate', 'Gallery'])
    assert.equal([...document.querySelectorAll('[role=tab]')].some((tab) => tab.textContent.trim() === 'Settings'), false)
    await click('Back')
    await click('Image settings')
    await click('Gallery')
    assert.equal(backCalls, 1)
    assert.equal(settingsCalls, 1)
    assert.equal(changed.tab, 'gallery')
  } finally { await act(async () => root.unmount()) }
})

test('parent-owned workspace state preserves prompt, tab, and gallery filters across rerender and workspace remount', async () => {
  configure()
  await clearImageData()
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(h(ControlledWorkspace, { revision: 0 })))
    await input(document.querySelector('textarea'), 'Moonlit harbor concept')
    await click('Gallery')
    await click('This book')
    await input(document.querySelector('input[type=search]'), 'harbor')

    await act(async () => root.render(h(ControlledWorkspace, { revision: 1, bookTitle: 'Retitled Parent' })))
    assert.equal(document.querySelector('[role=tab][aria-selected=true]').textContent.trim(), 'Gallery')
    assert.equal(document.querySelector('input[type=search]').value, 'harbor')
    assert.equal(button('This book').getAttribute('aria-pressed'), 'true')
    assert.match(document.querySelector('.image-workspace-header').textContent, /Retitled Parent/)

    await click('Generate')
    assert.equal(document.querySelector('textarea').value, 'Moonlit harbor concept')
  } finally { await act(async () => root.unmount()) }
})

test('Generate is disabled for an empty prompt and queues a valid configured draft', async () => {
  configure()
  await clearImageData()
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(h(ControlledWorkspace, { bookId: '', bookTitle: undefined })))
    const generate = document.querySelector('.image-primary-action')
    assert.equal(generate.disabled, true)
    await input(document.querySelector('textarea'), '  ')
    assert.equal(generate.disabled, true)
    await input(document.querySelector('textarea'), 'A lighthouse above a storm')
    assert.equal(generate.disabled, false)
    await act(async () => {
      generate.click()
      for (let i = 0; i < 100 && (await store.listImageJobs()).length !== 1; i++) await new Promise((resolve) => setTimeout(resolve, 10))
    })
    assert.equal(document.querySelector('.image-queue-status').textContent, 'Queued')
    const jobs = await store.listImageJobs()
    assert.equal(jobs.length, 1)
    assert.equal(jobs[0].prompt, 'A lighthouse above a storm')
    assert.equal(jobs[0].modelAlias, 'Portrait')
  } finally { await act(async () => root.unmount()) }
})

test('generation queue renders focused status groups with counts', async () => {
  configure()
  await clearImageData()
  const db = await p.database()
  const spec = settings.resolveImageSpec('Grouped image')
  await db.table('imageJobs').bulkPut([
    { ...spec, id: 'active', status: 'queued', createdAt: 1 },
    { ...spec, id: 'review', status: 'completed', assetId: 'missing-review-asset', createdAt: 2 },
    { ...spec, id: 'attention', status: 'failed', error: 'Provider rejected request', createdAt: 3 },
    { ...spec, id: 'earlier', status: 'completed', decision: 'kept', createdAt: 4 },
  ])
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(h(ControlledWorkspace)))
    await settle(() => document.querySelectorAll('.image-job-group').length === 4)
    assert.deepEqual([...document.querySelectorAll('.image-job-group h3')].map((heading) => heading.textContent), ['Active1', 'Needs review1', 'Attention1', 'Earlier1'])
  } finally { await act(async () => root.unmount()) }
})

test('gallery card actions appear only after opening the image viewer', async () => {
  configure()
  await clearImageData()
  const { book } = await p.createBook(initialAiSettings, 'Viewer Actions Book')
  const db = await p.database()
  await db.table('galleryImages').put({
    id: 'viewer-asset', bookId: book.id, bookTitle: book.title, prompt: 'Gallery viewer image',
    provider: 'openai', model: 'gpt-image-1', modelAlias: 'Portrait', requestedSize: '1024x1024',
    width: 1, height: 1, createdAt: Date.now(), kept: true, image: png, thumbnail: png,
  })
  const state = { ...createImageWorkspaceState(), tab: 'gallery' }
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(h(ImageWorkspace, {
      bookId: book.id, bookTitle: book.title, state, onStateChange: () => {}, onBack: () => {}, onSettings: () => {},
    })))
    await settle(() => document.querySelectorAll('.image-gallery-grid article').length === 1)
    const card = document.querySelector('.image-gallery-grid article')
    assert.equal([...card.querySelectorAll('button')].some((item) => ['Delete image', 'Use in Codex'].includes(item.textContent.trim())), false)
    assert.equal(card.querySelector('.image-download'), null)

    await click('View image and prompt')
    await settle(() => Boolean(document.querySelector('dialog[open] .image-gallery-viewer-actions')))
    assert.ok(button('Delete image'))
    assert.ok(button('Use in Codex'))
    assert.ok(document.querySelector('dialog[open] .image-download'))
  } finally { await act(async () => root.unmount()) }
})

test('Workspace routes Images as a top-level screen and the Library image control does not open Settings', () => {
  const source = readFileSync(new URL('../src/Workspace.tsx', import.meta.url), 'utf8')
  assert.match(source, /type Screen = [^\n]*'images'/)

  const imagesStart = source.indexOf("if (screen === 'images')")
  const homeStart = source.indexOf("if (screen === 'home')", imagesStart)
  assert.ok(imagesStart >= 0 && homeStart > imagesStart, 'top-level images screen branch exists')
  const imagesBranch = source.slice(imagesStart, homeStart)
  assert.match(imagesBranch, /return <ImageWorkspace/)
  assert.match(imagesBranch, /onSettings=\{\(\) => openSettings\('images', 'images'\)\}/)

  const libraryStart = source.indexOf('<header className="library-top">', homeStart)
  const libraryEnd = source.indexOf('</header>', libraryStart)
  assert.ok(libraryStart >= 0 && libraryEnd > libraryStart, 'Library header exists')
  const libraryHeader = source.slice(libraryStart, libraryEnd)
  assert.match(libraryHeader, /openImages\('home'\)/)
  assert.doesNotMatch(libraryHeader, /openSettings\('home',\s*'images'\)/)
})

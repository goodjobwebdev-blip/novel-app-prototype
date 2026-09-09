import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { JSDOM } from 'jsdom'
import 'fake-indexeddb/auto'

const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'https://arc.test/' })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLDialogElement', 'sessionStorage', 'Event', 'CustomEvent']) globalThis[key] = dom.window[key]
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
const directory = mkdtempSync(new URL('../node_modules/.arc-mobile-test-', import.meta.url))
for (const filename of readdirSync(new URL('../src/', import.meta.url)).filter((name) => /\.tsx?$/.test(name))) {
  const source = readFileSync(new URL(`../src/${filename}`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
    .replace(/import ['"][^'"]+\.css['"];?/g, '')
    .replace(/(['"])(\.\/[^'"]+)\1/g, (_, quote, path) => `${quote}${path.replace(/\.tsx?$/, '')}.mjs${quote}`)
  writeFileSync(`${directory}/${filename.replace(/\.tsx?$/, '.mjs')}`, compiled)
}
const moduleAt = (name) => import(pathToFileURL(`${directory}/${name}.mjs`))
const geometry = await moduleAt('image-gestures')
const { default: Gestures } = await moduleAt('IllustrationGestures')
const { default: Modal } = await moduleAt('IllustrationModal')
const { default: Illustration } = await moduleAt('CodexIllustration')
const p = await moduleAt('persistence')
const { initialAiSettings } = await moduleAt('ai-settings')
after(() => { dom.window.close(); rmSync(directory, { recursive: true, force: true }) })
const h = React.createElement
async function mount(element) { const root = createRoot(document.getElementById('root')); await act(async () => root.render(element)); return root }
async function unmount(root) { await act(async () => root.unmount()) }
const buttons = () => [...document.querySelectorAll('button')]
const button = (text) => buttons().find((b) => b.textContent.trim() === text || b.getAttribute('aria-label') === text)
async function click(text) { const target = button(text); assert.ok(target, `Button ${text} exists`); await act(async () => target.click()) }
async function settle(predicate) { for (let i = 0; i < 30 && !predicate(); i++) await act(async () => new Promise((resolve) => setTimeout(resolve, 10))); assert.ok(predicate()) }
function pointer(target, type, id, x, y) { const event = new dom.window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }); Object.defineProperty(event, 'pointerId', { value: id }); target.dispatchEvent(event) }

test('gesture geometry keeps the pinch anchor stable, clamps edges, and fits the full image at reset', () => {
  const image = { width: 800, height: 400 }, viewport = { width: 300, height: 300 }
  const start = geometry.centeredImageView
  const moved = geometry.moveImage(image, viewport, true, start, { x: 10000, y: -10000 })
  assert.equal(moved.x, 0)
  assert.equal(moved.y, 50)
  const zoom = geometry.moveImage(image, viewport, true, start, { x: 0, y: 0 }, 2, { x: 100, y: 150 })
  const before = geometry.imageFrame(image, viewport, true, start)
  const after = geometry.imageFrame(image, viewport, true, zoom)
  assert.ok(Math.abs((100 - 150 - before.panX) / start.zoom - (100 - 150 - after.panX) / zoom.zoom) < 1e-9)
  const fit = geometry.imageFrame(image, viewport, false, start)
  assert.equal(fit.width, 300)
  assert.equal(fit.height, 150)
})

test('pointer drag, two-finger pinch, cancellation, keyboard zoom and reset update the crop', async () => {
  let state
  function Demo() { const [value, setValue] = React.useState({ ...geometry.centeredImageView }); state = value; return h(Gestures, { src: 'blob:fixture', alt: 'Fixture', image: { width: 800, height: 400 }, value, onChange: setValue, crop: true }) }
  const root = await mount(h(Demo))
  try {
    const surface = document.querySelector('.image-gesture-surface')
    await act(async () => { pointer(surface, 'pointerdown', 1, 150, 150); pointer(surface, 'pointermove', 1, 180, 150); pointer(surface, 'pointerup', 1, 180, 150) })
    assert.equal(state.x, 40)
    await click('Reset')
    await act(async () => { pointer(surface, 'pointerdown', 1, 100, 150); pointer(surface, 'pointerdown', 2, 200, 150); pointer(surface, 'pointermove', 2, 250, 150) })
    assert.equal(state.zoom, 1.5)
    await act(async () => { pointer(surface, 'pointercancel', 1, 100, 150); pointer(surface, 'pointercancel', 2, 250, 150); pointer(surface, 'pointermove', 2, 290, 150) })
    assert.equal(state.zoom, 1.5)
    await act(async () => surface.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: '+', bubbles: true })))
    assert.equal(state.zoom, 1.75)
    await click('Reset')
    assert.deepEqual(state, geometry.centeredImageView)
  } finally { await unmount(root) }
})

test('modal follows keyboard viewport, keeps footer outside scrolling content, and restores focus', async () => {
  const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus()
  let closed = false
  const root = await mount(h(Modal, { title: 'Test sheet', onClose: () => { closed = true }, footer: h('button', null, 'Save') }, h('textarea')))
  try {
    const modal = document.querySelector('dialog')
    assert.equal(document.documentElement.style.overflow, 'hidden')
    assert.equal(modal.style.getPropertyValue('--image-viewport-height'), '700px')
    visualViewport.height = 340; visualViewport.offsetTop = 12
    visualViewport.dispatchEvent(new dom.window.Event('resize'))
    assert.equal(modal.style.getPropertyValue('--image-viewport-height'), '340px')
    assert.equal(modal.style.getPropertyValue('--image-viewport-top'), '12px')
    assert.equal(document.querySelector('.image-modal-content').contains(button('Save')), false)
    await act(async () => modal.dispatchEvent(new dom.window.Event('cancel', { cancelable: true })))
    assert.equal(closed, true)
  } finally { await unmount(root) }
  assert.equal(document.documentElement.style.overflow, '')
  assert.equal(document.activeElement, trigger)
  trigger.remove()
})

test('dismissed description draft returns without saving; removal exposes Undo and restores the image', async () => {
  const { book } = await p.createBook(initialAiSettings, 'Mobile test')
  const entry = await p.createCodexEntry(book.id, 'Keeper', 'Character')
  const image = new Blob(['test pixels'], { type: 'image/png' })
  await p.saveIllustration(entry.id, { image, thumbnail: image, width: 800, height: 400 }, { caption: 'Original caption', alt: '', cropX: 50, cropY: 50 })
  const root = await mount(h(Illustration, { entry, readOnly: false }, h('h1', null, entry.title)))
  try {
    await settle(() => Boolean(button('Image actions for Keeper')))
    await click('Image actions for Keeper'); await click('Edit description')
    const input = document.querySelector('.image-description-fields input')
    await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, 'Unfinished caption'); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
    await click('Close image description')
    assert.equal((await p.getIllustration(entry.id)).caption, 'Original caption')
    await click('Image actions for Keeper'); await click('Edit description')
    assert.equal(document.querySelector('.image-description-fields input').value, 'Unfinished caption')
    await click('Save description')
    await settle(() => !document.querySelector('dialog'))
    assert.equal((await p.getIllustration(entry.id)).caption, 'Unfinished caption')
    await click('Image actions for Keeper'); await click('Remove image')
    await settle(() => !document.querySelector('dialog') && Boolean(button('Add image')))
    assert.equal(await p.getIllustration(entry.id), undefined)
    await click('Undo image change')
    await settle(() => Boolean(button('Image actions for Keeper')))
    assert.equal((await p.getIllustration(entry.id)).caption, 'Unfinished caption')
  } finally { await unmount(root) }
})

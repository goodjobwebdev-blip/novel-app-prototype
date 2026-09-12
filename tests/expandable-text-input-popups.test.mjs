import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { buildSync } from 'esbuild'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<html><head></head><body><div id="root"></div></body></html>', { url: 'https://arc.test/' })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLTextAreaElement', 'Event']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0)
globalThis.cancelAnimationFrame = clearTimeout
// JSDOM has no native top layer. Record modal entry/exit; the browser supplies
// actual stacking and inertness for dialogs opened with showModal().
const modalEntries = []
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; modalEntries.push(this) }
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
const style = document.createElement('style')
style.textContent = ['generation-controls.css', 'composer.css'].map(name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')).join('\n')
document.head.append(style)
const directory = mkdtempSync(new URL('../node_modules/.expanded-popup-test-', import.meta.url))
for (const name of ['ProseRewriteDialog', 'ExpandableTextInput', 'IllustrationModal']) buildSync({
  entryPoints: [new URL(`../src/${name}.tsx`, import.meta.url).pathname], jsx: 'automatic', bundle: true, packages: 'external', format: 'esm', outfile: `${directory}/${name}.mjs`, loader: { '.css': 'empty' }, logLevel: 'silent',
})
const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const moduleAt = name => import(pathToFileURL(`${directory}/${name}.mjs`))
const { default: RewriteDialog } = await moduleAt('ProseRewriteDialog')
const { default: ExpandableTextInput } = await moduleAt('ExpandableTextInput')
const { default: IllustrationModal } = await moduleAt('IllustrationModal')
after(() => { dom.window.close(); rmSync(directory, { recursive: true, force: true }) })
const h = React.createElement
const button = name => [...document.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === name || item.textContent.trim() === name)
const expanded = () => document.querySelector('.expandable-text-dialog textarea')
async function click(name) { const target = button(name); assert.ok(target, name); await act(async () => target.click()) }
async function input(element, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(element, value)
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
}
async function key(element, key, shiftKey = false) {
  await act(async () => element.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })))
}
async function frame() { await act(async () => new Promise(resolve => setTimeout(resolve, 10))) }
function RewriteHarness({ applied = [], closed = [], requests = [] }) {
  const [open, setOpen] = React.useState(true)
  return open && h(RewriteDialog, {
    title: 'Show, don’t tell', original: 'Original passage.', instruction: 'Keep it subtle',
    generate: async (instruction, chunk) => { requests.push(instruction); chunk('Generated replacement.') },
    apply: text => { applied.push(text); return true }, close: () => { closed.push(true); setOpen(false) },
  })
}

test('expanded guidance appears above the rewrite popup and applies locally before generation', async () => {
  const root = createRoot(document.getElementById('root')), applied = [], closed = [], requests = []
  try {
    await act(async () => root.render(h(React.StrictMode, null, h(RewriteHarness, { applied, closed, requests }))))
    await click('Expand Rewrite instruction')
    const overlay = document.querySelector('.expandable-text-backdrop')
    const parent = document.querySelector('.editor-block-backdrop')
    assert.ok(modalEntries.includes(overlay) || Number(dom.window.getComputedStyle(overlay).zIndex) > Number(dom.window.getComputedStyle(parent).zIndex), 'The expanded editor must appear above its parent popup')
    await frame()
    assert.equal(document.activeElement, expanded())
    await input(expanded(), 'Keep the dialogue unchanged')
    assert.equal(document.querySelector('[aria-label="Rewrite instruction"]').value, 'Keep it subtle')
    await click('Apply')
    await frame()
    assert.ok(document.querySelector('.prose-rewrite-dialog'))
    assert.equal(document.querySelector('[aria-label="Rewrite instruction"]').value, 'Keep the dialogue unchanged')
    assert.equal(document.activeElement, document.querySelector('[aria-label="Rewrite instruction"]'))
    assert.deepEqual(applied, [])
    await click('Generate preview')
    assert.deepEqual(requests, ['Keep the dialogue unchanged'])
    await click('Expand Replacement preview')
    assert.equal(expanded().value, 'Generated replacement.')
    await input(expanded(), 'My edited replacement.')
    await click('Apply')
    assert.equal(document.querySelector('[aria-label="Replacement preview"]').value, 'My edited replacement.')
    assert.deepEqual(applied, [])
    assert.deepEqual(closed, [])
    await click('Apply replacement')
    assert.deepEqual(applied, ['My edited replacement.'])
    assert.deepEqual(closed, [true])
  } finally { await act(async () => root.unmount()) }
})

test('Escape and Tab belong to the expanded editor; closing keeps the parent and original draft', async () => {
  const root = createRoot(document.getElementById('root')), closed = []
  try {
    await act(async () => root.render(h(RewriteHarness, { closed })))
    await click('Expand Rewrite instruction')
    await input(expanded(), 'Discard this draft')
    button('Close expanded editor').focus()
    await key(document.activeElement, 'Tab', true)
    assert.equal(document.activeElement, button('Apply'))
    await key(document.activeElement, 'Tab')
    assert.equal(document.activeElement, button('Close expanded editor'))
    await key(expanded(), 'Escape')
    await frame()
    assert.deepEqual(closed, [], 'Escape must not close the underlying rewrite popup')
    assert.equal(expanded(), null)
    assert.equal(document.querySelector('[aria-label="Rewrite instruction"]').value, 'Keep it subtle')
    assert.equal(document.activeElement, document.querySelector('[aria-label="Rewrite instruction"]'))
    await click('Expand Rewrite instruction')
    assert.equal(expanded().value, 'Keep it subtle')
    await click('Close expanded editor')
    assert.deepEqual(closed, [])
  } finally { await act(async () => root.unmount()) }
})

test('expansion inside a native image modal enters the top layer and dismisses only its own draft', async () => {
  const root = createRoot(document.getElementById('root')), closed = [], applied = []
  try {
    await act(async () => root.render(h(IllustrationModal, { title: 'Generate image', onClose: () => closed.push(true) }, h(ExpandableTextInput, { value: 'Image prompt', onChange: text => applied.push(text), 'aria-label': 'Image prompt' }))))
    const parent = document.querySelector('.image-modal')
    await click('Expand Image prompt')
    const overlay = document.querySelector('.expandable-text-backdrop')
    assert.ok(modalEntries.indexOf(overlay) > modalEntries.indexOf(parent), 'Nested expansion must enter the top layer after the image modal')
    await input(expanded(), 'Unapplied image prompt')
    await act(async () => overlay.dispatchEvent(new dom.window.Event('cancel', { cancelable: true })))
    assert.deepEqual(closed, [])
    assert.deepEqual(applied, [])
    assert.ok(parent.open)
    assert.equal(expanded(), null)
    assert.equal(overlay.open, false)
    await click('Expand Image prompt')
    await act(async () => document.querySelector('.expandable-text-backdrop').dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true })))
    assert.equal(expanded(), null)
    assert.deepEqual(closed, [])
  } finally { await act(async () => root.unmount()) }
})

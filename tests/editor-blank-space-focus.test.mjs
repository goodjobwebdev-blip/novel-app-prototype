import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { buildSync } from 'esbuild'
import { JSDOM } from 'jsdom'
import 'fake-indexeddb/auto'

const dom = new JSDOM('<html><body></body></html>', { url: 'https://arc.test/', pretendToBeVisual: true })
after(() => dom.window.close())
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'Window', 'DOMRect', 'Range']) globalThis[key] = dom.window[key]
globalThis.getComputedStyle = dom.window.getComputedStyle
globalThis.localStorage = dom.window.localStorage
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
dom.window.Range.prototype.getClientRects = () => [new dom.window.DOMRect(10, 10, 20, 20)]
dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect(10, 10, 20, 20)
const directory = mkdtempSync(new URL('../node_modules/.editor-blank-space-test-', import.meta.url))
after(() => rmSync(directory, { recursive: true, force: true }))
buildSync({ entryPoints: [new URL('../src/features/editor/MarkdownEditor.tsx', import.meta.url).pathname], jsx: 'automatic', bundle: true, packages: 'external', format: 'esm', outfile: `${directory}/editor.mjs`, loader: { '.css': 'empty' }, logLevel: 'silent' })
const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const { EditorView } = await import('@codemirror/view')
const { undoDepth } = await import('@codemirror/commands')
const { default: MarkdownEditor } = await import(pathToFileURL(`${directory}/editor.mjs`))

async function mount(t, props = {}) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  t.after(async () => { await act(async () => root.unmount()); container.remove() })
  const ref = React.createRef(), changes = []
  await act(async () => root.render(React.createElement(MarkdownEditor, { ref, value: 'A passage.', onChange: text => changes.push(text), ...props })))
  const host = container.querySelector('.markdown-editor')
  const view = EditorView.findFromDOM(container.querySelector('.cm-editor'))
  // JSDOM has no layout. Model a final rendered block ending at viewport y=140.
  Object.defineProperty(view, 'documentTop', { get: () => 100 })
  view.lineBlockAt = position => {
    assert.equal(position, view.state.doc.length)
    return { bottom: 40 }
  }
  return { container, root, ref, host, view, changes }
}

function pointer(target, type, options = {}) {
  const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: 30, clientY: 200, ...options })
  Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true }, pointerType: { value: options.pointerType ?? 'mouse' } })
  target.dispatchEvent(event)
}
function click(target, options = {}) {
  target.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, clientX: 30, clientY: 200, detail: 1, ...options }))
}
async function tap(target, options = {}) {
  await act(async () => {
    pointer(target, 'pointerdown', options)
    pointer(target, 'pointerup', options)
    if (options.pointerType === 'touch') {
      pointer(target, 'pointerout', options)
      pointer(target, 'pointerleave', options)
    }
    click(target, options)
  })
}

for (const value of ['A passage.', 'A passage.\n', '', 'Long passage.\n'.repeat(100)]) {
  test(`blank-space tap focuses the exact end without editing (${value.length} characters)`, async t => {
    const { host, view, changes } = await mount(t, { value })
    await tap(host, { pointerType: 'touch' })
    assert.equal(view.state.selection.main.head, value.length)
    assert.equal(view.state.selection.main.empty, true)
    assert.equal(view.hasFocus, true)
    assert.equal(view.state.doc.toString(), value)
    assert.equal(changes.length, 0)
    assert.equal(undoDepth(view.state), 0)
  })
}

test('all bare editor surfaces work and an existing selection collapses to the end', async t => {
  const { host, view } = await mount(t)
  for (const surface of [host, view.dom, view.scrollDOM, view.contentDOM]) {
    await act(async () => view.dispatch({ selection: { anchor: 1, head: 4 } }))
    await tap(surface)
    assert.equal(view.state.selection.main.head, view.state.doc.length)
    assert.equal(view.state.selection.main.empty, true)
  }
})

test('text, whitespace alongside text, and clicks above the last rendered block are not redirected', async t => {
  const { host, view } = await mount(t)
  const line = host.querySelector('.cm-line')
  for (const [target, clientY] of [[line, 200], [view.contentDOM, 120], [view.scrollDOM, 139], [host, 90]]) {
    await tap(target, { clientY })
    assert.equal(view.state.selection.main.head, 0)
    assert.equal(view.hasFocus, false)
  }
})

test('embedded block actions and controls outside the editor keep their clicks and selection', async t => {
  let edits = 0
  const value = 'Text.\n\n<!--arc:block {"id":"beat-1","type":"beat","text":"Plan"}-->\n'
  const { container, host, view } = await mount(t, { value, onEditBlock: () => edits++ })
  await act(async () => view.dispatch({ selection: { anchor: 0, head: 4 } }))
  await tap(host.querySelector('.editor-block button'))
  assert.equal(edits, 1)
  assert.equal(view.state.selection.main.from, 0)
  assert.equal(view.state.selection.main.to, 4)
  const drawerButton = document.createElement('button')
  let drawerClicks = 0
  drawerButton.onclick = () => drawerClicks++
  container.append(drawerButton)
  await tap(drawerButton)
  assert.equal(drawerClicks, 1)
  assert.equal(view.state.selection.main.to, 4)
})

test('read-only documents and temporarily disabled dictation editors are not focused', async t => {
  const archived = await mount(t, { readOnly: true })
  await tap(archived.host)
  assert.equal(archived.view.state.selection.main.head, 0)
  assert.equal(archived.view.hasFocus, false)
  const editable = await mount(t)
  await act(async () => assert.ok(editable.ref.current.beginDictation()))
  await tap(editable.host)
  assert.equal(editable.view.state.selection.main.head, 0)
  assert.equal(editable.view.hasFocus, false)
})

test('dragging, cancelled touches, leaving the editor, and scrolling are not taps', async t => {
  const { host, view } = await mount(t)
  for (const cancel of [
    () => { pointer(host, 'pointermove', { clientY: 220 }); pointer(host, 'pointermove') },
    () => pointer(host, 'pointercancel'),
    () => pointer(host, 'pointerleave'),
    () => window.dispatchEvent(new dom.window.Event('scroll')),
  ]) {
    await act(async () => { pointer(host, 'pointerdown', { pointerType: 'touch' }); cancel(); pointer(host, 'pointerup', { pointerType: 'touch' }); click(host) })
    assert.equal(view.state.selection.main.head, 0)
    assert.equal(view.hasFocus, false)
  }
  await act(async () => { pointer(host, 'pointerdown'); pointer(host, 'pointerup', { clientY: 220 }); click(host, { clientY: 220 }) })
  assert.equal(view.state.selection.main.head, 0)
})

test('modified, secondary, double, and prevented clicks are left alone', async t => {
  const { host, view } = await mount(t)
  for (const options of [{ shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { button: 2 }, { detail: 2 }]) {
    await tap(host, options)
    assert.equal(view.state.selection.main.head, 0)
    assert.equal(view.hasFocus, false)
  }
  host.addEventListener('click', event => event.preventDefault(), { capture: true, once: true })
  await tap(host)
  assert.equal(view.state.selection.main.head, 0)
})

test('blank-space listeners are removed on unmount', async t => {
  const { root, host, view } = await mount(t)
  await act(async () => root.unmount())
  view.dispatch = () => assert.fail('Destroyed editor must not receive a selection transaction')
  await tap(host)
})

test('long documents retain a dedicated blank-space tap area without extra document lines', () => {
  const css = readFileSync(new URL('../src/features/editor/markdown-editor.css', import.meta.url), 'utf8')
  assert.match(css, /\.markdown-editor\s*\{[^}]*padding-bottom:\s*150px;/)
})

import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { buildSync } from 'esbuild'
import { JSDOM } from 'jsdom'
import 'fake-indexeddb/auto'
const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'https://arc.test/', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'Window', 'DOMRect', 'Range']) globalThis[key] = dom.window[key]
globalThis.getComputedStyle = dom.window.getComputedStyle
globalThis.localStorage = dom.window.localStorage
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
dom.window.Range.prototype.getClientRects = () => [new dom.window.DOMRect(10, 10, 20, 20)]
dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect(10, 10, 20, 20)
const directory = mkdtempSync(new URL('../node_modules/.editor-selection-test-', import.meta.url))
buildSync({ entryPoints: [new URL('../src/features/editor/MarkdownEditor.tsx', import.meta.url).pathname], jsx: 'automatic', bundle: true, packages: 'external', format: 'esm', outfile: `${directory}/editor.mjs`, loader: { '.css': 'empty' }, logLevel: 'silent' })
const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const { EditorView } = await import('@codemirror/view')
const { default: MarkdownEditor } = await import(pathToFileURL(`${directory}/editor.mjs`))
after(() => { dom.window.close(); rmSync(directory, { recursive: true, force: true }) })
const h = React.createElement
let root

async function mount(key, value, changed, selections, historyKey = 'book:scene') {
  const ref = React.createRef()
  await act(async () => root.render(h(MarkdownEditor, { key, ref, value, historyKey, ariaLabel: 'Scene Markdown editor', onChange: text => changed.push(text), onSelectionChange: value => { if (value) selections.push(value) } })))
  return ref
}

test('reopening a document restores undo history without restoring old editor callbacks', async () => {
  root = createRoot(document.getElementById('root'))
  const firstChanges = [], firstSelections = [], changes = [], selections = []
  const first = await mount('first', 'Original passage.', firstChanges, firstSelections)
  await act(async () => assert.equal(first.current.replaceRange(first.current.captureSelection(0, 8), 'Revised'), true))
  await act(async () => root.render(null))
  const current = await mount('second', 'Revised passage.', changes, selections)
  try {
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor'))
    await act(async () => { view.dispatch({ selection: { anchor: 0, head: 7 } }); await new Promise(resolve => setTimeout(resolve, 60)) })
    assert.ok(selections.length, 'Selection must be reported to the current mounted editor')
    const snapshot = selections.at(-1).snapshot
    assert.equal(snapshot.editorId, current.current.captureSelection().editorId)
    await act(async () => assert.equal(current.current.replaceRange(snapshot, 'Better'), true))
    assert.equal(current.current.captureSelection().document, 'Better passage.')
    assert.deepEqual(changes, ['Better passage.'])
    assert.deepEqual(firstChanges, ['Revised passage.'])
    await act(async () => assert.equal(current.current.undo(), true))
    assert.equal(current.current.captureSelection().document, 'Revised passage.')
    await act(async () => assert.equal(current.current.undo(), true))
    assert.equal(current.current.captureSelection().document, 'Original passage.')
  } finally { await act(async () => root.unmount()) }
})


test('history is isolated by document identity and stale replacements remain rejected', async () => {
  root = createRoot(document.getElementById('root'))
  const changes = []
  try {
    const first = await mount('first', 'Same title.', changes, [], 'book:first')
    await act(async () => first.current.replaceRange(first.current.captureSelection(0, 4), 'Edited'))
    const second = await mount('second', 'Edited title.', changes, [], 'book:second')
    await act(async () => assert.equal(second.current.undo(), false))
    const old = second.current.captureSelection(0, 6)
    await act(async () => assert.equal(second.current.replaceRange(old, 'New'), true))
    await act(async () => assert.equal(second.current.replaceRange(old, 'Obsolete'), false))
    assert.equal(second.current.captureSelection().document, 'New title.')
    const reopened = await mount('third', 'External change.', changes, [], 'book:second')
    await act(async () => assert.equal(reopened.current.undo(), false))
    assert.equal(reopened.current.captureSelection().document, 'External change.')
  } finally { await act(async () => root.unmount()) }
})

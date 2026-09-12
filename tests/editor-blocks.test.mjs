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
dom.window.Range.prototype.getClientRects = () => []
dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect()
const directory = mkdtempSync(new URL('../node_modules/.editor-block-test-', import.meta.url))
buildSync({ entryPoints: [new URL('../src/MarkdownEditor.tsx', import.meta.url).pathname], jsx: 'automatic', bundle: true, packages: 'external', format: 'esm', outfile: `${directory}/editor.mjs`, loader: { '.css': 'empty' }, logLevel: 'silent' })
const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const { default: MarkdownEditor } = await import(pathToFileURL(`${directory}/editor.mjs`))
const { encodeDocumentBlock, proseText } = await import('../src/document-projection.ts')
after(() => { dom.window.close(); rmSync(directory, { recursive: true, force: true }) })

test('private block widgets preserve source, apply edits atomically, undo and reject stale snapshots', async () => {
  const root = createRoot(document.getElementById('root'))
  const ref = React.createRef()
  const initial = 'Before.\n\nAfter.'
  const changes = []
  await act(async () => root.render(React.createElement(MarkdownEditor, { ref, value: initial, bookId: 'book-1', onChange: (value) => changes.push(value) })))
  const snapshot = ref.current.captureSelection(9, 9)
  const block = encodeDocumentBlock({ id: 'private-1', type: 'comment', text: 'Private plan' })
  await act(async () => assert.equal(ref.current.replaceRange(snapshot, `${block}\n\n`, true), true))
  assert.equal(document.querySelector('.editor-block-comment p').textContent, 'Private plan')
  assert.ok(document.querySelector('.editor-block-comment button'))
  assert.equal(proseText(ref.current.captureSelection().document), 'Before.\n\n\n\nAfter.')
  assert.equal(ref.current.replaceRange(snapshot, 'Stale rewrite'), false)
  const source = ref.current.captureSelection().document
  const protectedSelection = ref.current.captureSelection(source.indexOf('Private plan'), source.indexOf('Private plan') + 7)
  assert.equal(ref.current.replaceRange(protectedSelection, 'AI rewrite'), false)
  await act(async () => assert.equal(ref.current.undo(), true))
  assert.equal(ref.current.captureSelection().document, initial)
  await act(async () => assert.equal(ref.current.redo(), true))
  assert.equal(ref.current.captureSelection().document, source)
  assert.equal(document.querySelectorAll('.editor-block-comment').length, 1)
  await act(async () => root.unmount())
})

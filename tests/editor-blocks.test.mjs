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

test('beat visibility preserves source and history; replacement affects only bound prose and is undoable', async () => {
  const { prepareAutomaticBeat, beatPassage } = await import('../src/scene-beats.ts')
  const prepared = prepareAutomaticBeat('Before.\n\nAfter.', 9, 'Open the door.', 'beat-one')
  const source = prepared.source.slice(0, prepared.position) + 'Old passage.' + prepared.source.slice(prepared.position)
  const root = createRoot(document.getElementById('root')), ref = React.createRef()
  const props = { ref, value: source, bookId: 'book-1', onChange: () => {} }
  await act(async () => root.render(React.createElement(MarkdownEditor, { ...props, showBeats: true })))
  assert.equal(document.querySelectorAll('.editor-block-beat').length, 1)
  await act(async () => root.render(React.createElement(MarkdownEditor, { ...props, showBeats: false })))
  assert.equal(document.querySelectorAll('.editor-block-beat').length, 0)
  assert.equal(ref.current.captureSelection().document, source)
  await act(async () => root.render(React.createElement(MarkdownEditor, { ...props, showBeats: true })))
  const passage = beatPassage(source, 'beat-one')
  const snapshot = ref.current.captureSelection(passage.from, passage.to)
  await act(async () => assert.equal(ref.current.replaceRange(snapshot, '\n\nNew passage.\n\n'), true))
  const changed = ref.current.captureSelection().document
  assert.equal(changed, source.slice(0, passage.from) + '\n\nNew passage.\n\n' + source.slice(passage.to))
  await act(async () => assert.equal(ref.current.undo(), true))
  assert.equal(ref.current.captureSelection().document, source)
  assert.equal(ref.current.replaceRange(snapshot, 'Stale preview after undo'), false)
  await act(async () => root.unmount())
})

test('an identical document mounted in a new editor cannot accept an old selection result', async () => {
  const root = createRoot(document.getElementById('root')), ref = React.createRef()
  const props = { ref, value: 'Identical prose.', bookId: 'book-1', onChange: () => {} }
  await act(async () => root.render(React.createElement(MarkdownEditor, { ...props, key: 'first' })))
  const snapshot = ref.current.captureSelection(0, 9)
  await act(async () => root.render(React.createElement(MarkdownEditor, { ...props, key: 'second' })))
  assert.notEqual(ref.current.captureSelection().editorId, snapshot.editorId)
  assert.equal(ref.current.replaceRange(snapshot, 'Obsolete'), false)
  await act(async () => root.unmount())
})

test('rewrite examples edit the instruction; Go previews without applying and result remains editable', async () => {
  buildSync({ entryPoints: [new URL('../src/ProseRewriteDialog.tsx', import.meta.url).pathname], jsx: 'automatic', bundle: true, packages: 'external', format: 'esm', outfile: `${directory}/dialog.mjs`, loader: { '.css': 'empty' }, logLevel: 'silent' })
  const { default: Dialog } = await import(pathToFileURL(`${directory}/dialog.mjs`))
  const root = createRoot(document.getElementById('root')), calls = [], applied = [], closed = []
  const click = async (label) => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent === label); assert.ok(button, label); await act(async () => button.click()) }
  await act(async () => root.render(React.createElement(Dialog, { title: 'Make it more…', original: 'Old selected text', instruction: '', examples: ['Make it darker'], generateLabel: 'Go', generate: async (instruction, chunk, signal, preview) => { calls.push(instruction); preview?.({ model: 'Main test', request: { providerMessages: [{ role: 'user', content: instruction }] } }); chunk('New selected text') }, apply: (text) => { applied.push(text); return true }, close: () => closed.push(true) })))
  await click('Make it darker')
  assert.equal(document.querySelector('[aria-label="Rewrite instruction"]').value, 'Make it darker')
  assert.deepEqual(calls, [])
  await click('Go')
  assert.deepEqual(calls, ['Make it darker'])
  assert.deepEqual(applied, [])
  assert.equal(document.querySelector('[aria-label="Replacement preview"]').value, 'New selected text')
  assert.equal(document.querySelector('[aria-label="Replacement preview"]').readOnly, false)
  assert.match(document.body.textContent, /Request preview · Main test/)
  await click('Apply replacement')
  assert.deepEqual(applied, ['New selected text'])
  assert.equal(closed.length, 1)
  await act(async () => root.unmount())
})

import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { buildSync } from 'esbuild'
import { JSDOM } from 'jsdom'
import 'fake-indexeddb/auto'

const dom = new JSDOM('<html><body><div id="root"></div><button class="autocomplete-accept">Accept</button><button class="other">Other</button></body></html>', { url: 'https://arc.test/', pretendToBeVisual: true })
const directory = mkdtempSync(new URL('../node_modules/.editor-autocomplete-test-', import.meta.url))
after(() => { dom.window.close(); rmSync(directory, { recursive: true, force: true }) })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'Window', 'DOMRect', 'Range']) globalThis[key] = dom.window[key]
globalThis.getComputedStyle = dom.window.getComputedStyle
globalThis.localStorage = dom.window.localStorage
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
dom.window.Range.prototype.getClientRects = () => []
dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect()
buildSync({ entryPoints: [new URL('../src/features/editor/MarkdownEditor.tsx', import.meta.url).pathname], jsx: 'automatic', bundle: true, packages: 'external', format: 'esm', outfile: `${directory}/editor.mjs`, loader: { '.css': 'empty' }, logLevel: 'silent' })
const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const { EditorView } = await import('@codemirror/view')
const { Transaction } = await import('@codemirror/state')
const { undoDepth } = await import('@codemirror/commands')
const { default: MarkdownEditor } = await import(pathToFileURL(`${directory}/editor.mjs`))

async function mount(t, initial = 'Original.', overrides = {}) {
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await act(async () => root.unmount()) })
  const ref = React.createRef(), events = [], inputs = [], changes = []
  const props = {
    ref, value: initial,
    onChange: value => { events.push('change'); changes.push(value) },
    onAutocompleteInvalidate: () => {
      events.push('invalidate')
      // The parent clears its editor suggestion from this callback. It must be
      // safe even when called synchronously by a CodeMirror update listener.
      ref.current?.clearAutocompleteSuggestion()
    },
    onAutocompleteInput: snapshot => { events.push('input'); inputs.push(snapshot) },
    ...overrides,
  }
  await act(async () => root.render(React.createElement(MarkdownEditor, props)))
  await act(async () => ref.current.placeCursor(initial.length))
  const view = EditorView.findFromDOM(document.querySelector('.cm-editor'))
  events.length = 0
  return { root, ref, view, props, events, inputs, changes }
}

async function suggest(ref, text = ' A continuation.') {
  const snapshot = ref.current.captureAutocompleteSnapshot()
  assert.ok(snapshot, 'A focused prose cursor at EOF should be eligible')
  await act(async () => assert.equal(ref.current.setAutocompleteSuggestion(snapshot, text), true))
  return snapshot
}

function key(view, key, shiftKey = false) {
  const event = new dom.window.KeyboardEvent('keydown', { key, code: key, keyCode: key === 'Tab' ? 9 : 27, bubbles: true, cancelable: true, shiftKey })
  view.contentDOM.dispatchEvent(event)
  return event.defaultPrevented
}

async function edit(view, text, userEvent = 'input.type') {
  const from = view.state.doc.length
  await act(async () => view.dispatch({ changes: { from, insert: text }, selection: { anchor: from + text.length }, annotations: Transaction.userEvent.of(userEvent) }))
}

test('ghost is an aria-hidden uneditable decoration, not document, change or history', async t => {
  const { ref, view, changes, inputs } = await mount(t)
  const snapshot = await suggest(ref, ' <b>literal</b>\nNext line.')
  const ghost = document.querySelector('.cm-autocomplete-ghost')
  assert.ok(ghost)
  assert.equal(ghost.textContent, ' <b>literal</b>\nNext line.')
  assert.ok(ghost.querySelector('b') === null, 'Suggestion text must not be interpreted as HTML')
  assert.equal(ghost.getAttribute('aria-hidden'), 'true')
  assert.equal(ghost.getAttribute('contenteditable'), 'false')
  assert.equal(ref.current.captureSelection().document, 'Original.')
  assert.equal(ref.current.captureGenerationContext().sceneText, 'Original.')
  assert.equal(view.state.sliceDoc(0, view.state.doc.length), 'Original.')
  assert.equal(undoDepth(view.state), 0)
  assert.equal(changes.length, 0)
  assert.equal(inputs.length, 0)
  assert.equal(ref.current.isAutocompleteSnapshotCurrent(snapshot), true)
  await act(async () => ref.current.clearAutocompleteSuggestion())
  assert.ok(document.querySelector('.cm-autocomplete-ghost') === null, 'Ghost should be cleared')
  assert.equal(undoDepth(view.state), 0)
})

test('serialized snapshots survive source mutation and suggestion state captures its own copy', async t => {
  const { ref } = await mount(t)
  const source = ref.current.captureAutocompleteSnapshot()
  assert.ok(source)
  assert.equal(typeof source.autocompleteEpoch, 'number')
  const snapshot = JSON.parse(JSON.stringify(source))
  source.document = 'Mutated source.'
  source.from = 0
  source.autocompleteEpoch += 1
  assert.equal(ref.current.isAutocompleteSnapshotCurrent(source), false)
  assert.equal(ref.current.isAutocompleteSnapshotCurrent(snapshot), true)
  const withoutEpoch = { ...snapshot }
  delete withoutEpoch.autocompleteEpoch
  assert.equal(ref.current.isAutocompleteSnapshotCurrent(withoutEpoch), false, 'Autocomplete requires a captured epoch')
  await act(async () => assert.equal(ref.current.setAutocompleteSuggestion(snapshot, ' Continued.'), true))
  const acceptedSnapshot = { ...snapshot }
  snapshot.document = 'Mutated controller clone.'
  snapshot.autocompleteEpoch += 1
  await act(async () => assert.equal(ref.current.acceptAutocompleteSuggestion(acceptedSnapshot, ' Continued.'), true))
  assert.equal(ref.current.captureSelection().document, 'Original. Continued.')
})

test('selection edits clear ghost and reject cloned stale snapshots even after returning to EOF', async t => {
  const { ref, view, inputs } = await mount(t)
  const snapshot = await suggest(ref)
  const clone = JSON.parse(JSON.stringify(snapshot))
  assert.equal(ref.current.isAutocompleteSnapshotCurrent(clone), true)
  await act(async () => view.dispatch({ selection: { anchor: 0, head: 3 } }))
  assert.ok(document.querySelector('.cm-autocomplete-ghost') === null, 'Selection edits clear ghost')
  assert.equal(ref.current.captureAutocompleteSnapshot(), null)
  assert.equal(ref.current.isAutocompleteSnapshotCurrent(snapshot), false)
  await act(async () => ref.current.placeCursor(snapshot.from))
  assert.equal(ref.current.isAutocompleteSnapshotCurrent(snapshot), false)
  assert.equal(ref.current.isAutocompleteSnapshotCurrent(clone), false)
  assert.equal(ref.current.captureSelection().document, clone.document, 'Cursor invalidation must not depend on document changes')
  await act(async () => assert.equal(ref.current.setAutocompleteSuggestion(clone, ' stale'), false))
  assert.equal(inputs.length, 0)
  const fresh = await suggest(ref)
  assert.ok(fresh.autocompleteEpoch > clone.autocompleteEpoch, 'A new capture reflects the cursor invalidation epoch')
  await edit(view, 'x')
  assert.equal(ref.current.isAutocompleteSnapshotCurrent(fresh), false)
  await act(async () => assert.equal(ref.current.acceptAutocompleteSuggestion(fresh, ' A continuation.'), false))
  assert.equal(ref.current.captureSelection().document, 'Original.x')
})

test('only focused ready Tab delegates acceptance; ShiftTab/default Tab remain untouched; Esc cancels pending and ready', async t => {
  let accepts = 0, snapshot
  const { ref, view, events, inputs } = await mount(t, 'Original.', {
    onAutocompleteAccept: () => { accepts += 1; return ref.current.acceptAutocompleteSuggestion(snapshot, ' Continued.') },
  })
  await act(async () => assert.equal(key(view, 'Tab'), false))
  snapshot = await suggest(ref, ' Continued.')
  await act(async () => assert.equal(key(view, 'Tab', true), false))
  assert.equal(accepts, 0)
  await act(async () => assert.equal(key(view, 'Tab'), true))
  assert.equal(accepts, 1)
  assert.equal(ref.current.captureSelection().document, 'Original. Continued.')
  assert.equal(inputs.length, 0)
  await suggest(ref)
  events.length = 0
  await act(async () => key(view, 'Escape'))
  assert.equal(events.includes('invalidate'), true)
  assert.ok(document.querySelector('.cm-autocomplete-ghost') === null, 'Escape clears ghost')
  events.length = 0
  await act(async () => key(view, 'Escape'))
  assert.equal(events.includes('invalidate'), true, 'Esc must also cancel a pending request without ghost')
})

test('acceptance inserts supplied spacing in one full history isolation between manual edits', async t => {
  const { ref, view, inputs } = await mount(t)
  await edit(view, ' Typed.')
  const before = ref.current.captureSelection().document
  const text = '  Accepted.\nSecond line.'
  const snapshot = await suggest(ref, text)
  const count = inputs.length
  await act(async () => assert.equal(ref.current.acceptAutocompleteSuggestion(snapshot, text), true))
  assert.equal(ref.current.captureSelection().document, before + text)
  assert.equal(ref.current.captureSelection().from, (before + text).length)
  assert.equal(inputs.length, count)
  assert.ok(document.querySelector('.cm-autocomplete-ghost') === null, 'Acceptance clears ghost')
  await edit(view, ' More.')
  await act(async () => assert.equal(ref.current.undo(), true))
  assert.equal(ref.current.captureSelection().document, before + text)
  await act(async () => assert.equal(ref.current.undo(), true))
  assert.equal(ref.current.captureSelection().document, before)
  await act(async () => assert.equal(ref.current.undo(), true))
  assert.equal(ref.current.captureSelection().document, 'Original.')
  await act(async () => { assert.equal(ref.current.redo(), true); assert.equal(ref.current.redo(), true) })
  assert.equal(ref.current.captureSelection().document, before + text)
  assert.equal(inputs.length, count + 1, 'Undo/Redo and acceptance must never request autocomplete')
})

test('input invalidation precedes manual input, while paste/drop/programmatic/external changes do not emit input', async t => {
  const { ref, view, root, props, inputs, events } = await mount(t)
  await suggest(ref)
  events.length = 0
  await edit(view, 'x')
  assert.equal(events.join(','), 'invalidate,change,input')
  assert.equal(inputs.length, 1)
  await act(async () => view.dispatch({ changes: { from: view.state.doc.length - 1, to: view.state.doc.length }, selection: { anchor: view.state.doc.length - 1 }, annotations: Transaction.userEvent.of('delete.backward') }))
  assert.equal(inputs.length, 2)
  for (const event of ['input.paste', 'input.drop', 'input.replace', 'input.type.generate', 'input.type.dictation']) {
    await suggest(ref)
    await edit(view, 'x', event)
    assert.ok(document.querySelector('.cm-autocomplete-ghost') === null, 'Non-typing edits clear ghost')
    assert.equal(inputs.length, 2, event)
  }
  await act(async () => view.dispatch({ changes: { from: view.state.doc.length, insert: ' programmatic' } }))
  await act(async () => root.render(React.createElement(MarkdownEditor, { ...props, value: 'External replacement.' })))
  assert.equal(inputs.length, 2)
  assert.equal(ref.current.captureSelection().document, 'External replacement.')
})

test('IME starts invalidate immediately and emit only once after final composition', async t => {
  const { ref, view, inputs, events } = await mount(t)
  await suggest(ref)
  events.length = 0
  await act(async () => view.contentDOM.dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true })))
  assert.equal(events.includes('invalidate'), true)
  assert.ok(document.querySelector('.cm-autocomplete-ghost') === null, 'Composition start clears ghost')
  assert.equal(ref.current.captureAutocompleteSnapshot(), null)
  await edit(view, 'あ', 'input.type.compose.start')
  await edit(view, 'い', 'input.type.compose')
  assert.equal(inputs.length, 0)
  await act(async () => {
    view.contentDOM.dispatchEvent(new dom.window.CompositionEvent('compositionend', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 90))
  })
  assert.equal(inputs.length, 1)
  assert.equal(inputs[0].document, 'Original.あい')
  await act(async () => {
    view.contentDOM.dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true }))
    view.contentDOM.dispatchEvent(new dom.window.CompositionEvent('compositionend', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 90))
  })
  assert.equal(inputs.length, 1, 'An unchanged/cancelled composition does not schedule autocomplete')
})

test('accept-button blur preserves ready suggestion; other blur invalidates and acceptance refocuses', async t => {
  const { ref, events } = await mount(t)
  const snapshot = await suggest(ref)
  events.length = 0
  await act(async () => document.querySelector('.autocomplete-accept').focus())
  assert.equal(events.includes('invalidate'), false)
  assert.equal(ref.current.isAutocompleteSnapshotCurrent(snapshot), false)
  assert.equal(ref.current.isAutocompleteSnapshotCurrent(snapshot, false), true)
  assert.ok(document.querySelector('.cm-autocomplete-ghost'))
  await act(async () => assert.equal(ref.current.acceptAutocompleteSuggestion(snapshot, ' A continuation.'), true))
  assert.ok(document.activeElement === document.querySelector('.cm-content'), 'Acceptance returns focus to the editor')
  const second = await suggest(ref)
  await act(async () => document.querySelector('.other').focus())
  assert.ok(document.querySelector('.cm-autocomplete-ghost') === null, 'Other blur clears ghost')
  assert.equal(ref.current.isAutocompleteSnapshotCurrent(second, false), false)
  await act(async () => assert.equal(ref.current.acceptAutocompleteSuggestion(second, ' A continuation.'), false))
})

test('generation and dictation defensively invalidate without any document edit', async t => {
  const { ref, inputs, events } = await mount(t)
  const snapshot = await suggest(ref)
  events.length = 0
  await act(async () => assert.ok(ref.current.beginGeneration()))
  assert.equal(events.includes('invalidate'), true)
  assert.ok(document.querySelector('.cm-autocomplete-ghost') === null, 'Generation starts clear ghost')
  assert.equal(ref.current.isAutocompleteSnapshotCurrent(snapshot, false), false)
  assert.equal(ref.current.captureAutocompleteSnapshot(), null)
  await act(async () => ref.current.finishGeneration('cancelled'))
  await suggest(ref)
  let session
  await act(async () => { session = ref.current.beginDictation() })
  assert.ok(session)
  assert.ok(document.querySelector('.cm-autocomplete-ghost') === null, 'Dictation starts clear ghost')
  assert.equal(ref.current.captureAutocompleteSnapshot(), null)
  await act(async () => { ref.current.updateDictation(session, 'Spoken.'); ref.current.finishDictation(session, 'Spoken.') })
  assert.equal(inputs.length, 0)
})

for (const value of ['```js\nconst x = 1', '    indented code', 'Text `inline code`', '<!--arc:block {"id":"b","type":"beat"}', '<!-- private -->', '![image](asset.png)']) {
  test(`EOF within a protected/code region is ineligible: ${JSON.stringify(value)}`, async t => {
    const { ref } = await mount(t, value)
    assert.equal(ref.current.captureAutocompleteSnapshot(), null)
  })
}

test('read-only and remounted editors cannot receive a cloned captured suggestion', async t => {
  const { ref, root, props } = await mount(t)
  const snapshot = JSON.parse(JSON.stringify(await suggest(ref)))
  assert.equal(ref.current.isAutocompleteSnapshotCurrent(snapshot), true)
  await act(async () => root.render(React.createElement(MarkdownEditor, { ...props, readOnly: true })))
  assert.equal(ref.current.captureAutocompleteSnapshot(), null)
  assert.equal(ref.current.isAutocompleteSnapshotCurrent(snapshot, false), false)
  await act(async () => assert.equal(ref.current.setAutocompleteSuggestion(snapshot, ' stale'), false))
  await act(async () => root.render(React.createElement(MarkdownEditor, { ...props, historyKey: 'another-scene' })))
  await act(async () => ref.current.placeCursor('Original.'.length))
  assert.notEqual(ref.current.captureSelection().editorId, snapshot.editorId)
  assert.equal(ref.current.isAutocompleteSnapshotCurrent(snapshot), false)
  await act(async () => assert.equal(ref.current.acceptAutocompleteSuggestion(snapshot, ' A continuation.'), false))
})

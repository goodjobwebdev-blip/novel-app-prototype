import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import 'fake-indexeddb/auto'
import { transpileSourceTree } from './transpile-source-tree.mjs'

const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'https://arc.test/', pretendToBeVisual: true })
after(() => dom.window.close())
// Persistence notifications must use the same event realm as dispatchEvent.
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'Window', 'DOMRect', 'Range', 'Event', 'CustomEvent', 'KeyboardEvent']) globalThis[key] = dom.window[key]
globalThis.getComputedStyle = dom.window.getComputedStyle
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: dom.window.localStorage })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
dom.window.Range.prototype.getClientRects = () => [new dom.window.DOMRect(10, 10, 20, 20)]
dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect(10, 10, 20, 20)
const directory = mkdtempSync(new URL('../node_modules/.editor-readonly-formatting-', import.meta.url))
after(() => rmSync(directory, { recursive: true, force: true }))
transpileSourceTree(directory)
const moduleAt = name => import(pathToFileURL(`${directory}/${name}.mjs`))
const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const { EditorView } = await import('@codemirror/view')
const { default: MarkdownEditor } = await moduleAt('features/editor/MarkdownEditor')
const p = await moduleAt('data/persistence')
const { initialAiSettings } = await moduleAt('shared/ai/ai-settings')
const db = await p.database()
after(() => db.close())

// The companion Mac fixture sets navigator before CodeMirror loads, so both
// Mod bindings have editable positive controls in isolated guarded test processes.
const formattingModifier = /Mac/.test(globalThis.navigator?.platform ?? '') ? 'metaKey' : 'ctrlKey'
for (const modifier of ['ctrlKey', 'metaKey']) {
  for (const key of ['b', 'i']) {
    test(`BUG-06 archived article ignores ${modifier}+${key} in editor and durable storage`, async t => {
      const { book } = await p.createBook(initialAiSettings, `Archived ${modifier} ${key}`)
      const entry = await p.createCodexEntry(book.id, 'Archived formatting fixture')
      const content = 'hello archived'
      await p.saveDocumentContent(entry.id, content)
      await p.archiveCodexEntry(entry.id)
      const before = await p.getEntity(entry.id)
      const root = createRoot(document.getElementById('root'))
      t.after(async () => { await act(async () => root.unmount()) })
      const writes = [], changes = []
      // The real persistence path is intentionally attached: a rogue onChange
      // would autosave exactly as Workspace does, even though the DOM is readonly.
      await act(async () => root.render(React.createElement(MarkdownEditor, {
        value: before.content, bookId: book.id, historyKey: `${book.id}:${entry.id}`,
        readOnly: true, ariaLabel: 'Archived article editor',
        onChange: text => { changes.push(text); writes.push(p.saveDocumentContent(entry.id, text)) },
      })))
      const view = EditorView.findFromDOM(document.querySelector('.cm-editor'))
      assert.ok(view)
      assert.equal(view.contentDOM.getAttribute('aria-readonly'), 'true')
      assert.equal(view.contentDOM.getAttribute('contenteditable'), 'false')
      await act(async () => {
        view.dispatch({ selection: { anchor: 0, head: 5 } })
        view.focus()
        view.contentDOM.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, code: `Key${key.toUpperCase()}`, [modifier]: true, bubbles: true, cancelable: true }))
        await Promise.all(writes)
        await db.transaction('rw', db.table('entities'), async () => {})
      })
      // Read back before asserting the editor to distinguish DOM-only protection
      // from a command which changed storage and then rendered stale plain text.
      const durable = await p.getEntity(entry.id)
      assert.equal(durable.content, content, 'Formatting must not persist an archived edit')
      assert.equal(durable.updatedAt, before.updatedAt)
      assert.equal(durable.sourceRevision, before.sourceRevision)
      assert.equal(durable.archivedAt, before.archivedAt)
      assert.equal(view.state.doc.toString(), content, 'CodeMirror document stays unchanged')
      assert.deepEqual(changes, [], 'Read-only commands must not emit onChange')
    })
  }
}

for (const [key, expected] of [['b', '**hello** editable'], ['i', '_hello_ editable']]) {
  test(`editable ${formattingModifier}+${key} still formats selected text`, async t => {
    const root = createRoot(document.getElementById('root'))
    t.after(async () => { await act(async () => root.unmount()) })
    const changes = []
    await act(async () => root.render(React.createElement(MarkdownEditor, { value: 'hello editable', onChange: text => changes.push(text) })))
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor'))
    await act(async () => {
      view.dispatch({ selection: { anchor: 0, head: 5 } })
      view.focus()
      view.contentDOM.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, code: `Key${key.toUpperCase()}`, [formattingModifier]: true, bubbles: true, cancelable: true }))
    })
    assert.equal(view.state.doc.toString(), expected, 'The regression must not disable formatting for editable documents')
    assert.deepEqual(changes, [expected])
  })
}

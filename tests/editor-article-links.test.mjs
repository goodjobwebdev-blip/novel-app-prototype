import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { buildSync } from 'esbuild'
import { JSDOM } from 'jsdom'
import 'fake-indexeddb/auto'
const dom = new JSDOM('<div id="root"></div>', { url: 'https://arc.test/', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'Window', 'DOMRect', 'Range']) globalThis[key] = dom.window[key]
globalThis.getComputedStyle = dom.window.getComputedStyle
globalThis.localStorage = dom.window.localStorage
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
dom.window.Range.prototype.getClientRects = () => [new dom.window.DOMRect(10, 10, 20, 20)]
dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect(10, 10, 20, 20)
const directory = mkdtempSync(new URL('../node_modules/.editor-article-links-', import.meta.url))
buildSync({ entryPoints: [new URL('../src/features/editor/MarkdownEditor.tsx', import.meta.url).pathname], jsx: 'automatic', bundle: true, packages: 'external', format: 'esm', outfile: `${directory}/editor.mjs`, loader: { '.css': 'empty' }, logLevel: 'silent' })
const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const { default: MarkdownEditor } = await import(pathToFileURL(`${directory}/editor.mjs`))
const { EditorView } = await import('@codemirror/view')
async function measureEditor(view) {
  // Resolve in CM's write phase, after pending viewport/decorations updates,
  // rather than depending on whether JSDOM's next animation frame ran in act.
  await act(async () => new Promise(resolve => view.requestMeasure({ read: () => null, write: () => resolve() })))
}
after(() => { dom.window.close(); rmSync(directory, { recursive: true, force: true }) })
test('escaped article labels navigate permanent IDs on mousedown before CodeMirror removes the preview', async () => {
  const root = createRoot(document.getElementById('root'))
  const opened = [], changes = []
  const value = 'Cursor starts here\n\n[Renamed \\[harbor\\]](arc-codex:permanent%28id%29)'
  try {
    await act(async () => root.render(React.createElement(MarkdownEditor, { value, ariaLabel: 'Article editor', onChange: content => changes.push(content), onArticleLink: id => opened.push(id) })))
    const link = document.querySelector('[data-article-id]')
    assert.ok(link, 'The escaped label renders an accessible article link')
    assert.equal(link.getAttribute('role'), 'link')
    await act(async () => link.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })))
    assert.deepEqual(opened, ['permanent(id)'])
    assert.deepEqual(changes, [])
  } finally { await act(async () => root.unmount()) }
})
test('article preview supports keyboard activation and normal external links without edits', async () => {
  const root = createRoot(document.getElementById('root'))
  const opened = [], external = [], changes = []
  const originalOpen = window.open
  window.open = (...args) => { external.push(args); return null }
  try {
    await act(async () => root.render(React.createElement(MarkdownEditor, { value: 'Cursor here\n\n[Article](arc-codex:stable-id) [Website](https://example.com)', onChange: content => changes.push(content), onArticleLink: id => opened.push(id) })))
    const article = document.querySelector('[data-article-id]')
    assert.ok(article)
    assert.equal(article.tabIndex, 0, 'Article previews are in the keyboard tab order')
    await act(async () => article.focus())
    assert.equal(document.activeElement, article, 'Keyboard users can focus the article preview')
    const enter = new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    await act(async () => article.dispatchEvent(enter))
    assert.equal(enter.defaultPrevented, true, 'Activation must not reach the editor newline command')
    assert.deepEqual(opened, ['stable-id'])
    const website = document.querySelector('[data-link-href]')
    assert.ok(website, 'Normal links retain working navigation')
    await act(async () => website.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })))
    assert.deepEqual(external, [['https://example.com', '_blank', 'noopener,noreferrer']])
    await act(async () => website.focus())
    assert.equal(document.activeElement, website)
    await act(async () => website.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
    assert.deepEqual(external, [
      ['https://example.com', '_blank', 'noopener,noreferrer'],
      ['https://example.com', '_blank', 'noopener,noreferrer'],
    ])
    assert.deepEqual(changes, [])
  } finally { window.open = originalOpen; await act(async () => root.unmount()) }
})
test('read-only article previews retain keyboard navigation and use the latest callback', async () => {
  const root = createRoot(document.getElementById('root'))
  const old = [], latest = [], changes = []
  const props = { value: 'Cursor here\n\n[Article](arc-codex:stable-id)', readOnly: true, onChange: value => changes.push(value) }
  try {
    await act(async () => root.render(React.createElement(MarkdownEditor, { ...props, onArticleLink: id => old.push(id) })))
    await act(async () => root.render(React.createElement(MarkdownEditor, { ...props, onArticleLink: id => latest.push(id) })))
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor'))
    assert.ok(view)
    await measureEditor(view)
    const link = document.querySelector('[data-article-id]')
    assert.ok(link)
    await act(async () => link.focus())
    assert.equal(document.activeElement, link)
    await measureEditor(view)
    assert.equal(link.isConnected, true, 'Measurement must not detach the focused preview')
    assert.equal(document.activeElement, link, 'Keyboard focus survives deferred measurement')
    const enter = new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    await act(async () => link.dispatchEvent(enter))
    assert.equal(enter.defaultPrevented, true, 'Activation must not reach editor commands')
    assert.deepEqual(old, [])
    assert.deepEqual(latest, ['stable-id'])
    assert.deepEqual(changes, [])
    assert.equal(view.state.doc.toString(), props.value, 'Navigation does not alter read-only content')
  } finally { await act(async () => root.unmount()) }
})

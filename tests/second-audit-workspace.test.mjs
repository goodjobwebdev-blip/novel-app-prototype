import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import 'fake-indexeddb/auto'
import { transpileSourceTree } from './transpile-source-tree.mjs'
import { assignBookTestProfiles } from './settings-profile-fixture.mjs'
const dom = new JSDOM('<div id="root"></div>', { url: 'https://arc.test/' })
for (const key of ['window', 'document', 'HTMLElement', 'CustomEvent', 'localStorage', 'sessionStorage']) globalThis[key] = dom.window[key]
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0)
globalThis.cancelAnimationFrame = clearTimeout
const React = await import('react'), { act } = React
const { createRoot } = await import('react-dom/client')
const dir = mkdtempSync(new URL('../node_modules/.second-workspace-', import.meta.url))
transpileSourceTree(dir)
// Only browser layout/editor rendering is substituted. Navigation, save queues,
// summary generation, resource policy and IndexedDB remain the actual app code.
writeFileSync(`${dir}/features/editor/MarkdownEditor.mjs`, `
import React, { forwardRef, useImperativeHandle } from 'react';
export default forwardRef(function Editor({ value, onChange, ariaLabel, readOnly }, ref) {
  useImperativeHandle(ref, () => ({ getMarkdown: () => value, captureAutocompleteSnapshot: () => null,
    clearAutocompleteSuggestion() {}, setAutocompleteSuggestion: () => false }));
  return React.createElement('textarea', { 'data-test-editor': true, 'aria-label': ariaLabel, value, readOnly,
    onChange: event => onChange(event.target.value) });
});`)
const at = name => import(pathToFileURL(`${dir}/${name}.mjs`))
const p = await at('data/persistence'), ai = await at('shared/ai/ai-settings'), profiles = await at('features/settings/settings-profiles')
const { default: Workspace } = await at('app/Workspace')
after(async () => { (await p.database()).close(); dom.window.close(); rmSync(dir, { recursive: true, force: true }) })
const button = text => [...document.querySelectorAll('button')].find(row => row.getAttribute('aria-label') === text || row.textContent.trim() === text)
const editor = () => document.querySelector('[data-test-editor]')
async function settle(predicate) { for (let i = 0; i < 200 && !predicate(); i++) await act(async () => new Promise(r => setTimeout(r, 10))); assert.ok(predicate(), document.body.textContent) }
async function click(target) { assert.ok(target, 'navigation control exists'); await act(async () => target.click()) }
async function edit(text) {
  const target = editor(); assert.ok(target && !target.readOnly, 'editor remains editable')
  await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(target, text); target.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
}
async function mount(t, beforeRender = async () => {}) {
  await p.ensurePrototypeSeed('demo')
  const settings = { ...ai.initialAiSettings, provider: 'nanogpt', apiKey: 'synthetic', baseUrl: 'https://provider.invalid/v1', supportModel: 'test', supportModelContextLength: 100000 }
  ai.saveAiSettings(settings)
  const f = await p.createBook(settings, `Audit ${crypto.randomUUID()}`)
  await assignBookTestProfiles({ persistence: p, ai, profiles }, f.book.id, settings, ['text', 'summary'])
  await p.saveDocumentContent(f.scene.id, 'Original manuscript')
  await beforeRender(f)
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await act(async () => root.unmount()) })
  await act(async () => root.render(React.createElement(Workspace)))
  await settle(() => [...document.querySelectorAll('.library-book')].some(row => row.textContent.includes(f.book.title)))
  await click([...document.querySelectorAll('.library-book')].find(row => row.textContent.includes(f.book.title)))
  await settle(() => editor()?.value === 'Original manuscript')
  return f
}
function gate() { let release, enter; const entered = new Promise(r => enter = r), held = new Promise(r => release = r); return { entered, release, async wait() { enter(); await held } } }
test('B1: edits made while loading another note are not discarded', async t => {
  let destination
  const f = await mount(t, async f => { destination = await p.createNote(f.book.id, 'Destination note') })
  await click(button('Open book workspace'))
  await click([...document.querySelectorAll('.book-panel nav button')].find(row => row.textContent === 'notes'))
  const readGate = gate(), table = (await p.database()).table('entities'), get = table.get
  let gated = false
  const spy = t.mock.method(table, 'get', async function (...args) {
    const result = await get.apply(this, args)
    if (!gated && args[0] === destination.id) { gated = true; await readGate.wait() }
    return result
  })
  t.after(async () => { await act(async () => { readGate.release(); await new Promise(r => setTimeout(r, 30)) }); spy.mock.restore() })
  await click([...document.querySelectorAll('.notes-panel .arc-resource-row__open')].find(row => row.textContent.includes(destination.title)))
  await settle(() => gated)
  await edit('Edit during destination read')
  await act(async () => readGate.release())
  await settle(() => editor()?.value !== 'Original manuscript')
  await act(async () => new Promise(r => setTimeout(r, 850)))
  assert.equal((await p.getEntity(f.scene.id)).content, 'Edit during destination read')
})

test('B2: re-summarize retains a draft edited before autosave and keeps generated text in history', async t => {
  const f = await mount(t)
  let summary
  await act(async () => { summary = await p.getOrCreateSummary(await p.getEntity(f.scene.id)); await p.saveDocumentContent(summary.id, 'Original summary') })
  await click(button('Open book workspace'))
  await click([...document.querySelectorAll('.book-panel nav button')].find(row => row.textContent === 'outline'))
  const row = [...document.querySelectorAll('.outline-row')].find(row => row.querySelector('strong')?.textContent === f.scene.title)
  await click(row.querySelector('.summary-status'))
  await settle(() => editor()?.value === 'Original summary')
  const networkGate = gate()
  t.mock.method(globalThis, 'fetch', async () => { await networkGate.wait(); return new Response('data: {"choices":[{"delta":{"content":"Generated summary"}}]}\n\ndata: [DONE]\n\n') })
  t.after(async () => { await act(async () => { networkGate.release(); await new Promise(r => setTimeout(r, 30)) }) })
  await click(button('Re-summarize'))
  await networkGate.entered
  await settle(() => button('Stop'))
  await edit('Manual summary draft')
  await act(async () => networkGate.release())
  await settle(() => !button('Stop'))
  assert.equal(editor().value, 'Manual summary draft')
  await act(async () => new Promise(r => setTimeout(r, 850)))
  assert.equal((await p.getEntity(summary.id)).content, 'Manual summary draft')
  assert.ok((await (await p.database()).table('snapshots').where('entityId').equals(summary.id).toArray()).some(row => row.content === 'Generated summary'), 'generation remains recoverable separately')
})

test('B4: deleting the active dirty book from settings permits opening another book', async t => {
  const f = await mount(t)
  let other
  await act(async () => { other = await p.createBook(ai.initialAiSettings, 'Surviving destination') })
  await edit('Unsaved text before deletion')
  await click(button('Open book workspace'))
  await click([...document.querySelectorAll('.book-panel nav button')].find(row => row.textContent === 'book'))
  await click(button('Delete book')); await click(button('Confirm delete'))
  await settle(() => [...document.querySelectorAll('.library-book')].some(row => row.textContent.includes(other.book.title)))
  await click([...document.querySelectorAll('.library-book')].find(row => row.textContent.includes(other.book.title)))
  await settle(() => editor())
  assert.equal(await p.getEntity(f.scene.id), undefined)
  assert.equal(document.querySelector('.scene-title')?.textContent, other.scene.title)
})

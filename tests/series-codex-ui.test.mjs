import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after } from 'node:test'
import { transpileSourceTree } from './transpile-source-tree.mjs'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import 'fake-indexeddb/auto'

const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'https://arc.test/', pretendToBeVisual: true })
after(() => dom.window.close())
for (const key of ['window', 'document', 'HTMLElement', 'HTMLDialogElement', 'Element', 'Node', 'MutationObserver', 'Event', 'CustomEvent', 'localStorage', 'sessionStorage']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.getComputedStyle = dom.window.getComputedStyle
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0)
globalThis.cancelAnimationFrame = clearTimeout
dom.window.HTMLElement.prototype.scrollIntoView = function () {}
dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
const directory = mkdtempSync(new URL('../node_modules/.arc-world-ownership-ui-test-', import.meta.url))
after(() => rmSync(directory, { recursive: true, force: true }))
transpileSourceTree(directory)
// Exercise real Workspace save/navigation/ownership paths without browser-only CodeMirror layout.
writeFileSync(`${directory}/features/editor/MarkdownEditor.mjs`, `
import React, { forwardRef, useImperativeHandle } from 'react';
export default forwardRef(function Editor({ value, onChange, ariaLabel, bookId, historyKey, readOnly }, ref) {
  useImperativeHandle(ref, () => ({
    getMarkdown: () => value,
    getInsertionPosition: () => value.length,
    captureAutocompleteSnapshot: () => null,
    isAutocompleteSnapshotCurrent: () => false,
    setAutocompleteSuggestion: () => false,
    clearAutocompleteSuggestion() {},
    acceptAutocompleteSuggestion: () => false,
  }));
  return React.createElement('textarea', {
    'aria-label': ariaLabel, 'data-workspace-editor': '', 'data-book-id': bookId,
    'data-history-key': historyKey, value, readOnly,
    onChange: event => onChange(event.target.value),
  });
});
`)
const moduleAt = name => import(pathToFileURL(`${directory}/${name}.mjs`))
const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const p = await moduleAt('data/persistence')
after(async () => (await p.database()).close())
// Workspace startup intentionally hard-resets old data once; seed before creating fixtures.
await p.ensurePrototypeSeed('demo')
const w = await moduleAt('features/worlds/world-service')
const { initialAiSettings } = await moduleAt('shared/ai/ai-settings')
const { metadataValues } = await moduleAt('features/chat/chat-management-schema')
const { default: Workspace } = await moduleAt('app/Workspace')
const button = text => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text)
const labeledButton = label => document.querySelector(`button[aria-label="${label}"]`)
const menuItem = text => [...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent.trim() === text)
const editor = () => document.querySelector('textarea[data-workspace-editor]')
const row = entry => [...document.querySelectorAll('.codex-dashboard-entry')].find(item => item.querySelector('strong')?.textContent === entry.title && item.textContent.includes(entry.worldId ? 'World · Active' : 'Book-only · Active'))
async function settle(predicate, description = 'Workspace reaches the expected state') {
  for (let i = 0; i < 200; i++) {
    let ready = false
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); ready = Boolean(await predicate()) })
    if (ready) return
  }
  assert.fail(`${description}\n${document.body.textContent.slice(0, 2500)}`)
}
async function click(target) { assert.ok(target, 'Requested control exists'); assert.ok(target.disabled !== true, 'Requested control is enabled'); await act(async () => target.click()) }
async function setBody(value) {
  const target = editor()
  assert.ok(target); assert.equal(target.readOnly, false)
  await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(target, value); target.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
}
async function panelTab(tab) {
  if (!document.querySelector('.book-panel')) await click(labeledButton('Open book workspace'))
  await click([...document.querySelectorAll('.book-panel nav button')].find(item => item.textContent.trim() === tab))
}
async function openEntry(entry) {
  await panelTab('codex')
  await settle(() => row(entry), `Codex lists ${entry.title}`)
  await click(row(entry).querySelector('.arc-resource-row__open, .codex-dashboard-open'))
  await settle(() => document.querySelector('.document-titlebar h1')?.textContent === entry.title && editor()?.getAttribute('data-history-key')?.endsWith(`:${entry.id}`))
}
async function entryAction(entry, label) {
  await panelTab('codex')
  await settle(() => row(entry))
  await click(row(entry).querySelector(`button[aria-label="Actions for ${entry.title}"]`))
  await settle(() => menuItem(label) && !menuItem(label).disabled)
  assert.equal([...document.querySelectorAll('[role="menuitem"]')].some(item => /series|override|reset/i.test(item.textContent)), false)
  await click(menuItem(label))
}
async function openBook(book) {
  const target = () => [...document.querySelectorAll('.library-book')].find(item => item.querySelector('strong')?.textContent === book.title)
  await settle(target)
  await click(target())
  await settle(() => editor()?.getAttribute('data-book-id') === book.id && Boolean(document.querySelector('.scene-title')))
}
async function home() {
  await panelTab('book')
  await settle(() => button('Open World Building') && !button('Open World Building').disabled)
  await click(button('Open World Building'))
  await settle(() => document.querySelector('.world-building'))
  await click(button('Home'))
  await settle(() => document.querySelector('.library-screen'))
}
test('Workspace moves and edits World canon directly, copies independently, and hides only in the viewing Book; Series stays organizational', async t => {
  const world = await w.createWorld('UI shared world'), series = await p.createSeries('UI organization')
  const books = []
  for (const title of ['First World Book', 'Second World Book']) {
    const { book } = await p.createBook(initialAiSettings, title)
    await w.setBookWorld(book.id, world.id)
    books.push(await p.updateBookMetadata(book.id, { ...metadataValues(await p.getEntity(book.id)), seriesId: series.id }))
  }
  const local = await p.createCodexEntry(books[0].id, 'UI tower', 'Place')
  await p.saveDocumentContent(local.id, 'Original local prose')
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await act(async () => root.unmount()) })
  await act(async () => root.render(React.createElement(Workspace)))
  await settle(() => labeledButton('New book') && !labeledButton('New book').disabled)
  await openBook(books[0])
  await openEntry(local)
  assert.match(document.querySelector('.codex-owner-notice').textContent, /Book-only entry/)
  await setBody('Dirty prose flushed by move')
  await entryAction(local, 'Link to World')
  await settle(async () => (await p.getEntity(local.id))?.worldId === world.id && editor()?.getAttribute('data-book-id') === world.id)
  const source = await p.getEntity(local.id)
  assert.equal(source.id, local.id); assert.equal(source.bookId, world.id); assert.equal(source.parentId, world.id)
  assert.equal(source.content, 'Dirty prose flushed by move')
  assert.match(document.querySelector('.codex-owner-notice').textContent, /saved directly to World.*shared with all linked Books/)
  await setBody('Direct canonical edit')
  await settle(async () => (await p.getEntity(source.id))?.content === 'Direct canonical edit' && document.querySelector('.save-state')?.textContent.trim() === 'Saved')
  dom.window.prompt = () => 'Shared renamed tower'
  await entryAction(source, 'Rename in World')
  await settle(async () => (await p.getEntity(source.id))?.title === 'Shared renamed tower')
  source.title = 'Shared renamed tower'
  for (const book of books) {
    const entry = (await p.listEntitiesByBook(book.id, 'codexEntry'))[0]
    assert.equal(entry.id, source.id); assert.equal(entry.title, source.title); assert.equal(entry.content, 'Direct canonical edit')
  }
  await panelTab('book')
  await click(document.querySelector('.series-trigger'))
  await settle(() => document.querySelector('[aria-label="Choose series"]'))
  assert.match(document.querySelector('[aria-label="Choose series"]').textContent, /Series organize Books.*does not change this Book’s World or Codex/)
  await click([...document.querySelectorAll('[role="option"]')].find(item => item.querySelector('strong')?.textContent === 'Standalone'))
  await settle(async () => (await p.getEntity(books[0].id)).seriesId === '')
  assert.equal((await p.getEntity(books[0].id)).worldId, world.id)
  assert.equal((await p.listEntitiesByBook(books[0].id, 'codexEntry'))[0].id, source.id)
  await entryAction(source, 'Copy to Book')
  await settle(async () => (await p.listEntitiesByBook(books[0].id, 'codexEntry')).length === 2)
  const copy = (await p.listEntitiesByBook(books[0].id, 'codexEntry')).find(entry => !entry.worldId)
  assert.notEqual(copy.id, source.id); assert.equal(copy.content, 'Direct canonical edit')
  await openEntry(copy)
  assert.match(document.querySelector('.codex-owner-notice').textContent, /Book-only entry/)
  dom.window.prompt = () => 'Private tower'
  await entryAction(copy, 'Rename')
  await settle(async () => (await p.getEntity(copy.id)).title === 'Private tower')
  copy.title = 'Private tower'
  await setBody('Independent copied prose')
  await settle(async () => (await p.getEntity(copy.id)).content === 'Independent copied prose' && document.querySelector('.save-state')?.textContent.trim() === 'Saved')
  assert.equal((await p.getEntity(source.id)).content, 'Direct canonical edit')
  await entryAction(source, 'Hide in this Book')
  await settle(() => !row(source) && Boolean(button(`Restore ${source.title} in this Book`)))
  assert.equal((await p.listEntitiesByBook(books[0].id, 'codexEntry'))[0].id, copy.id)
  assert.equal((await p.listEntitiesByBook(books[1].id, 'codexEntry'))[0].id, source.id)
  assert.equal(p.isCodexEntryArchived(await p.getEntity(source.id)), false)
  await click(button(`Restore ${source.title} in this Book`))
  await settle(() => Boolean(row(source)))
  await home()
  await openBook(books[1])
  await openEntry(source)
  assert.equal(editor().value, 'Direct canonical edit')
  assert.equal(editor().getAttribute('data-book-id'), world.id)
  assert.equal(editor().getAttribute('data-history-key'), `${books[1].id}:${source.id}`)
  await setBody('Canonical edit from another Book')
  await settle(async () => (await p.getEntity(source.id)).content === 'Canonical edit from another Book' && document.querySelector('.save-state')?.textContent.trim() === 'Saved')
  assert.equal((await p.listEntitiesByBook(books[0].id, 'codexEntry')).find(entry => entry.id === source.id).content, 'Canonical edit from another Book')
  assert.equal((await p.getEntity(copy.id)).content, 'Independent copied prose')
  assert.equal((await p.getEntity(source.id)).codexScope, undefined)
})

import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import 'fake-indexeddb/auto'
import { transpileSourceTree } from './transpile-source-tree.mjs'

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

const directory = mkdtempSync(new URL('../node_modules/.world-workspace-ui-test-', import.meta.url))
after(() => rmSync(directory, { recursive: true, force: true }))
transpileSourceTree(directory)
// Keep Workspace, metadata, menus and persistence real; CodeMirror needs browser layout.
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
    'aria-label': ariaLabel,
    'data-workspace-editor': '',
    'data-book-id': bookId,
    'data-history-key': historyKey,
    value, readOnly,
    onChange: event => onChange(event.target.value),
  });
});
`)
const moduleAt = name => import(pathToFileURL(`${directory}/${name}.mjs`))
const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const p = await moduleAt('data/persistence')
const db = await p.database()
after(() => db.close())
// Startup intentionally resets this database once. Commit that marker BEFORE fixtures.
await p.ensurePrototypeSeed('demo')
const w = await moduleAt('features/worlds/world-service')
const { initialAiSettings } = await moduleAt('shared/ai/ai-settings')
const { buildContextValues } = await moduleAt('shared/context/context-service')
const { default: Workspace } = await moduleAt('app/Workspace')
const triggerCss = readFileSync(new URL('../src/features/codex/codex-triggers.css', import.meta.url), 'utf8')

beforeEach(async () => {
  // Preserve startup markers while isolating all fixture entities, media and snapshots.
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) if (table.name !== 'meta') await table.clear()
  })
  localStorage.clear()
  sessionStorage.clear()
})

const button = text => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text)
const labeledButton = label => [...document.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === label)
const menuItem = text => [...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent.trim() === text)
const editor = () => document.querySelector('textarea[data-workspace-editor]')
const triggerInput = () => document.querySelector('textarea[aria-label="Automatic Codex triggers"]')
const codexRow = title => [...document.querySelectorAll('.codex-dashboard-entry')].find(row => row.querySelector('strong')?.textContent === title)
const titleIs = title => document.querySelector('.document-titlebar h1')?.textContent === title

async function settle(predicate, description = 'Workspace reaches the expected state') {
  for (let index = 0; index < 200; index++) {
    let ready = false
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
      ready = Boolean(await predicate())
    })
    if (ready) return
  }
  assert.fail(`${description}\n${document.body.textContent.slice(0, 2500)}`)
}
async function click(target, description = 'The requested control exists') {
  assert.ok(target, description)
  assert.ok(target.disabled !== true, `${description}: enabled`)
  await act(async () => target.click())
}
async function setTextarea(target, value) {
  assert.ok(target, 'The editable textarea exists')
  assert.equal(target.readOnly, false)
  await act(async () => {
    target.focus()
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(target, value)
    target.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  assert.equal(target.value, value)
}
async function selectWorld(worldId) {
  const select = document.querySelector('select[aria-label="Book World"]')
  assert.ok(select, 'Book settings expose the World selector')
  await settle(() => !select.disabled && [...select.options].some(option => option.value === worldId), 'World option is available')
  await act(async () => {
    select.value = worldId
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  })
  await settle(() => !select.disabled && select.value === worldId && !document.querySelector('.book-world-selector [role="status"]'), 'World link update finishes')
}
async function panelTab(tab) {
  if (!document.querySelector('.book-panel')) await click(labeledButton('Open book workspace'))
  await click([...document.querySelectorAll('.book-panel nav button')].find(item => item.textContent.trim() === tab), `Book panel ${tab} tab exists`)
}
async function openEntry(entry) {
  await panelTab('codex')
  await settle(() => codexRow(entry.title), `Codex lists ${entry.title}`)
  const row = codexRow(entry.title)
  await click(row.querySelector('.arc-resource-row__open, .codex-dashboard-open'))
  await settle(() => titleIs(entry.title) && editor()?.getAttribute('data-history-key')?.endsWith(`:${entry.id}`), 'The canonical entry opens')
}
async function entryActions(entry, action) {
  await panelTab('codex')
  await settle(() => codexRow(entry.title) && labeledButton(`Actions for ${entry.title}`), `Codex actions for ${entry.title} are available`)
  await click(labeledButton(`Actions for ${entry.title}`))
  await settle(() => menuItem(action) && !menuItem(action).disabled, `${action} passes preflight`)
  await click(menuItem(action))
}
async function mount(t) {
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await act(async () => root.unmount()) })
  await act(async () => root.render(React.createElement(Workspace)))
  await settle(() => labeledButton('New book') && !labeledButton('New book').disabled, 'Home library finishes startup')
}
async function openBook(book) {
  const target = () => [...document.querySelectorAll('.library-book')].find(item => item.querySelector('strong')?.textContent === book.title)
  await settle(target, `Home lists ${book.title}`)
  await click(target())
  await settle(() => editor()?.getAttribute('data-book-id') === book.id && Boolean(document.querySelector('.scene-title')), 'Book opens its scene')
}
async function homeViaWorldBuilding() {
  await panelTab('book')
  await settle(() => button('Open World Building') && !button('Open World Building').disabled)
  await click(button('Open World Building'))
  await settle(() => document.querySelector('.world-building'))
  await click(button('Home'))
  await settle(() => document.querySelector('.library-screen'))
}
async function fixture({ linked = true, books = 1 } = {}) {
  const world = await w.createWorld('Shared skies')
  const created = []
  for (let index = 0; index < books; index++) {
    const next = await p.createBook(initialAiSettings, `Voyage ${index + 1}`)
    if (linked) next.book = await w.setBookWorld(next.book.id, world.id)
    created.push(next)
  }
  return { world, books: created, ...created[0] }
}
async function addEntry(ownerId, title, triggers = [title], content = `${title} body`) {
  const entry = await p.createCodexEntry(ownerId, title, 'Place')
  await p.updateCodexAutoIncludeTriggers(entry.id, triggers)
  await p.saveDocumentContent(entry.id, content)
  return p.getEntity(entry.id)
}
function assertEmptyEditor(entry) {
  assert.ok(editor() === null, 'Unavailable entry has no mounted editor')
  assert.ok(document.querySelector('.codex-document-metadata') === null, 'Unavailable entry has no stale metadata controls')
  assert.ok(document.querySelector('.codex-owner-notice') === null, 'Unavailable entry has no stale ownership notice')
  assert.ok(document.querySelector('.empty-editor'), 'Workspace shows its empty document state')
  assert.equal(titleIs(entry.title), false)
}

test('Home navigates to World Building and View all without exposing a World body editor', async t => {
  const f = await fixture({ books: 2 })
  const shared = await addEntry(f.world.id, 'Sky city', ['Sky city'], 'SECRET_WORLD_BODY_NOT_A_VIEWER')
  await mount(t)
  const homeRow = () => [...document.querySelectorAll('.worlds-home-section .arc-resource-row')].find(row => row.querySelector('strong')?.textContent === f.world.title)
  await settle(homeRow)
  assert.match(homeRow().textContent, /1 Codex entry.*2 linked Books/)
  await click(homeRow().querySelector('.arc-resource-row__open'))
  await settle(() => document.querySelector('.world-detail h2')?.textContent === f.world.title && labeledButton(`Actions for ${shared.title}`))
  assert.match(document.querySelector('.world-detail').textContent, /Read-only Codex list/)
  assert.equal(document.querySelectorAll('textarea,[contenteditable="true"]').length, 0)
  assert.equal(document.body.textContent.includes(shared.content), false)
  assert.ok(button('New entry') === undefined, 'World Building cannot create entries')
  await click(labeledButton(`Actions for ${shared.title}`))
  assert.deepEqual([...document.querySelectorAll('[role="menuitem"]')].map(item => item.textContent.trim()), ['Copy to all linked books and remove from World'])
  await click(button('Home'))
  await settle(() => button('View all'))
  await click(button('View all'))
  await settle(() => document.querySelector('.world-library .arc-resource-row__open'))
  assert.match(document.querySelector('.world-detail').textContent, /Select a World to browse/)
  assert.equal(document.querySelectorAll('.world-entry-list article').length, 0)
  await click(document.querySelector('.world-library .arc-resource-row__open'))
  await settle(() => document.querySelector('.world-detail h2')?.textContent === f.world.title)
  assert.ok(editor() === null, 'World Building never mounts an entry editor')
  assert.equal(document.body.textContent.includes(shared.content), false)
})

test('Book settings link a World, the local menu moves the same edited ID, and another Book edits the canonical entry', async t => {
  const f = await fixture({ linked: false, books: 2 })
  await w.setBookWorld(f.books[1].book.id, f.world.id)
  const local = await addEntry(f.book.id, 'Local harbor')
  await mount(t)
  await openBook(f.book)
  await panelTab('book')
  await settle(() => document.querySelector('select[aria-label="Book World"]'))
  assert.equal(document.querySelector('select[aria-label="Book World"]').value, '')
  await selectWorld(f.world.id)
  assert.equal((await p.getEntity(f.book.id)).worldId, f.world.id)
  await openEntry(local)
  assert.match(document.querySelector('.codex-owner-notice').textContent, /Book-only entry/)
  await setTextarea(editor(), 'Edited locally before linking')
  await entryActions(local, 'Link to World')
  await settle(async () => (await p.getEntity(local.id))?.worldId === f.world.id && titleIs(local.title) && editor()?.getAttribute('data-book-id') === f.world.id)
  const moved = await p.getEntity(local.id)
  assert.equal(moved.id, local.id)
  assert.equal(moved.bookId, f.world.id)
  assert.equal(moved.parentId, f.world.id)
  assert.equal(moved.content, 'Edited locally before linking', 'Transfer flushes the dirty document before changing ownership')
  assert.match(document.querySelector('.codex-owner-notice').textContent, /saved directly to World.*shared with all linked Books/)
  await panelTab('codex')
  await settle(() => codexRow(local.title)?.textContent.includes('World · Active'), 'Codex refreshes the moved entry’s World scope')
  assert.match(codexRow(local.title).textContent, /World · Active/)
  assert.equal(editor().getAttribute('data-history-key'), `${f.book.id}:${local.id}`, 'History is scoped to the viewing Book; media ownership remains World')
  await setTextarea(editor(), 'Canonical body edited from first Book')
  await settle(async () => (await p.getEntity(local.id))?.content === 'Canonical body edited from first Book' && document.querySelector('.save-state')?.textContent.trim() === 'Saved', 'World edit autosaves')
  assert.deepEqual((await w.listWorldEntries(f.world.id)).map(entry => entry.id), [local.id])
  await homeViaWorldBuilding()
  await openBook(f.books[1].book)
  await openEntry(local)
  assert.equal(editor().value, 'Canonical body edited from first Book')
  assert.equal(editor().getAttribute('data-book-id'), f.world.id, 'World media lookup does not use the viewing Book ID')
  assert.equal(editor().getAttribute('data-history-key'), `${f.books[1].book.id}:${local.id}`)
  await setTextarea(editor(), 'Canonical body edited from second Book')
  await panelTab('codex')
  await settle(() => labeledButton('Return to Scene'))
  await click(labeledButton('Return to Scene'))
  await settle(async () => Boolean(document.querySelector('.scene-title')) && (await p.getEntity(local.id))?.content === 'Canonical body edited from second Book')
  for (const { book } of f.books) {
    const entries = await w.listBookCodexEntries(book.id)
    assert.equal(entries.length, 1)
    assert.equal(entries[0].id, local.id)
    assert.equal(entries[0].content, 'Canonical body edited from second Book')
  }
})

test('shared trigger uniqueness marks the editor invalid, cites even a hidden sibling, and does not persist the rejected draft', async t => {
  const f = await fixture()
  const shared = await addEntry(f.world.id, 'Sky city', ['Sky city'])
  const reserved = await addEntry(f.world.id, 'Reserved beacon', ['North Tower'])
  await w.setWorldEntryHidden(f.book.id, reserved.id, true)
  await mount(t)
  await openBook(f.book)
  await openEntry(shared)
  await settle(() => triggerInput())
  assert.ok(codexRow(reserved.title) === undefined, 'The reserving entry is not visible in this Book')
  const before = await p.getEntity(shared.id)
  await setTextarea(triggerInput(), '  NORTH\tTOWER  ')
  await settle(() => triggerInput()?.getAttribute('aria-invalid') === 'true' && document.getElementById('codex-trigger-validation')?.textContent.includes(reserved.title))
  const validation = document.getElementById('codex-trigger-validation')
  assert.equal(validation.getAttribute('role'), 'alert')
  assert.equal(triggerInput().getAttribute('aria-describedby'), validation.id)
  assert.match(validation.textContent, /North Tower.*already used.*Reserved beacon/)
  assert.equal(validation.classList.contains('codex-trigger-error'), true)
  // The transpiler strips CSS imports; verify the actual danger/red stylesheet contract,
  // rather than claiming JSDOM exercises browser paint or CSS-variable resolution.
  assert.match(triggerCss, /\.codex-trigger-editor \[aria-invalid="true"\]\s*\{[^}]*border-color:\s*var\(--danger, #c94b55\)/)
  assert.match(triggerCss, /\.codex-trigger-editor \.codex-trigger-error[^{}]*\{[^}]*color:\s*var\(--danger, #c94b55\)/)
  await act(async () => triggerInput().blur())
  const rejected = await p.getEntity(shared.id)
  assert.deepEqual(rejected.autoIncludeTriggers, before.autoIncludeTriggers)
  assert.equal(rejected.updatedAt, before.updatedAt, 'Blur does not save a duplicate trigger')
  assert.equal(rejected.sourceRevision, before.sourceRevision)
  assert.equal(triggerInput().value, '  NORTH\tTOWER  ', 'Invalid draft remains available to correct')
  await setTextarea(triggerInput(), 'Sky city\nUnique alias')
  await act(async () => triggerInput().blur())
  await settle(async () => (await p.getEntity(shared.id))?.autoIncludeTriggers?.includes('Unique alias') && triggerInput()?.getAttribute('aria-invalid') === 'false')
  assert.ok(document.getElementById('codex-trigger-validation') === null, 'No inline trigger error remains')
})

test('a local trigger overlapping World is accepted with a warning and wins automatic context priority', async t => {
  const f = await fixture()
  const local = await addEntry(f.book.id, 'Book tower', ['Local name'])
  const shared = await addEntry(f.world.id, 'World tower', ['North Tower'])
  await p.saveDocumentContent(f.scene.id, 'The North Tower rises above the harbor.')
  await mount(t)
  await openBook(f.book)
  await openEntry(local)
  await setTextarea(triggerInput(), 'North Tower')
  assert.equal(triggerInput().getAttribute('aria-invalid'), 'false', 'Different owners do not reserve each other’s triggers')
  assert.ok(document.getElementById('codex-trigger-validation') === null, 'Cross-owner overlap is not a validation error')
  await act(async () => triggerInput().blur())
  await settle(async () => (await p.getEntity(local.id))?.autoIncludeTriggers?.[0] === 'North Tower', 'Local trigger overlap saves successfully')
  await panelTab('codex')
  await settle(() => codexRow(local.title)?.textContent.includes('Active Book-only entries take automatic priority') && codexRow(shared.title), 'Reopened Codex shows the local-priority conflict warning')
  assert.match(codexRow(local.title).textContent, /Trigger conflict:.*North Tower.*World tower/)
  assert.match(codexRow(shared.title).textContent, /World · Active/)
  const context = await buildContextValues({ bookId: f.book.id, type: 'scene', currentSceneId: f.scene.id, profile: { ...p.defaultGenerationContextProfile } })
  assert.deepEqual(context.automaticCodex.map(entry => entry.entryId), [local.id])
  assert.equal(context.automaticCodexContext.includes(shared.title), false)
  assert.deepEqual((await p.getEntity(shared.id)).autoIncludeTriggers, ['North Tower'], 'Accepted local overlap never rewrites World')
})

test('hiding, changing and disconnecting World clear the opened unavailable document; restore preserves its canonical ID', async t => {
  const f = await fixture()
  const otherWorld = await w.createWorld('Other skies')
  const shared = await addEntry(f.world.id, 'Hidden harbor')
  const other = await addEntry(otherWorld.id, 'Other harbor')
  await mount(t)
  await openBook(f.book)
  await openEntry(shared)
  await setTextarea(editor(), 'Dirty World edit flushed before hiding')
  await entryActions(shared, 'Hide in this Book')
  await settle(() => Boolean(document.querySelector('.empty-editor')) && !codexRow(shared.title) && button(`Restore ${shared.title} in this Book`))
  assertEmptyEditor(shared)
  assert.equal((await p.getEntity(shared.id)).content, 'Dirty World edit flushed before hiding')
  assert.ok((await p.getEntity(f.book.id)).hiddenWorldEntryIds.includes(shared.id))
  assert.ok(labeledButton(`Actions for ${shared.title}`) === undefined, 'Hidden entries cannot open an actions/editor menu')
  const disclosure = [...document.querySelectorAll('summary')].find(item => item.textContent.includes('Hidden World entries'))
  await click(disclosure, 'Hidden World entries disclosure exists')
  assert.equal(disclosure.closest('details').open, true, 'Hidden entries are disclosed before clicking Restore')
  await settle(() => button(`Restore ${shared.title} in this Book`) && !button(`Restore ${shared.title} in this Book`).disabled)
  await click(button(`Restore ${shared.title} in this Book`))
  await settle(() => codexRow(shared.title) && !button(`Restore ${shared.title} in this Book`))
  assertEmptyEditor(shared)
  assert.equal((await p.getEntity(f.book.id)).hiddenWorldEntryIds.includes(shared.id), false)
  await openEntry(shared)
  assert.equal(editor().value, 'Dirty World edit flushed before hiding')
  assert.equal(editor().getAttribute('data-book-id'), f.world.id)
  await panelTab('book')
  await selectWorld(otherWorld.id)
  await settle(() => Boolean(document.querySelector('.empty-editor')))
  assertEmptyEditor(shared)
  assert.equal((await p.getEntity(f.book.id)).worldId, otherWorld.id)
  await panelTab('codex')
  await settle(() => codexRow(other.title))
  assert.ok(codexRow(shared.title) === undefined, 'The previous World entry is no longer listed')
  await openEntry(other)
  await panelTab('book')
  await selectWorld('')
  await settle(() => Boolean(document.querySelector('.empty-editor')))
  assertEmptyEditor(other)
  assert.equal((await p.getEntity(f.book.id)).worldId, undefined)
  await panelTab('codex')
  await settle(() => document.querySelector('.codex-dashboard') && !document.querySelector('.codex-dashboard-entry'))
  assert.ok(codexRow(other.title) === undefined, 'Disconnected World entries are no longer listed')
  for (const [entry, owner] of [[shared, f.world], [other, otherWorld]]) {
    const canonical = await p.getEntity(entry.id)
    assert.equal(canonical.id, entry.id)
    assert.equal(canonical.bookId, owner.id)
    assert.equal(canonical.worldId, owner.id, 'Changing Book links never localizes or deletes World canonicals')
  }
})

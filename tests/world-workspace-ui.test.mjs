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
const links = await moduleAt('features/codex/codex-article-links')
const chatService = await moduleAt('features/chat/chat-service')
const worldArchive = await moduleAt('data/world-archive')
const bookArchive = await moduleAt('data/book-archive')

beforeEach(async () => {
  // Preserve startup markers while isolating all fixture entities, media and snapshots.
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) if (table.name !== 'meta') await table.clear()
  })
  window.confirm = () => true
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
  if (!document.querySelector('.book-panel')) await click(labeledButton('Open World workspace') ?? labeledButton('Open book workspace'))
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

test('World without Books opens its canonical article in the shared workspace editor', async t => {
  const f = await fixture({ books: 0 })
  const shared = await addEntry(f.world.id, 'Sky city', ['Sky city'], 'WORLD_CANONICAL_BODY')
  await mount(t)
  const homeRow = () => [...document.querySelectorAll('.worlds-home-section .arc-resource-row')].find(row => row.querySelector('strong')?.textContent === f.world.title)
  await settle(homeRow)
  assert.match(homeRow().textContent, /1 Codex entry.*0 linked Books/)
  await click(homeRow().querySelector('.arc-resource-row__open'))
  await settle(() => editor()?.getAttribute('data-book-id') === f.world.id, 'World with no Books mounts the shared editor')
  assert.equal(editor().value, shared.content)
  assert.equal(titleIs(shared.title), true)
  await setTextarea(editor(), 'Canonical edit from World without a Book')
  await settle(async () => (await p.getEntity(shared.id))?.content === 'Canonical edit from World without a Book', 'World article edits persist to the canonical identity')
  assert.equal((await p.listBooks()).length, 0)
  assert.deepEqual((await w.listWorldEntries(f.world.id)).map(entry => entry.id), [shared.id])
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

test('World article navigation is durable independently of localStorage and handles a deleted remembered article', async t => {
  const world = await w.createWorld('Durable navigation')
  await addEntry(world.id, 'A first article')
  const last = await addEntry(world.id, 'Z remembered article')
  await p.saveOwnerWorkspaceState(world.id, { lastOpenedCodexEntryId: last.id })
  localStorage.clear()
  await mount(t)
  await openWorldRow(world)
  await settle(() => titleIs(last.title), 'Durable owner state restores the last article')
  await click(button('Home'))
  await settle(() => document.querySelector('.library-screen'))
  await p.deleteEntityTree(last.id)
  await openWorldRow(world)
  await settle(() => titleIs('A first article'), 'Deleted remembered article falls back within its own World')
})

test('World deletion outside the workspace navigates away without a stale owner', async t => {
  const world = await w.createWorld('Deleted World')
  await mount(t)
  await openWorldRow(world)
  await act(async () => w.deleteWorld(world.id))
  await settle(() => document.querySelector('.library-screen'), 'Deleted World returns to the library')
  assert.ok(!document.querySelector('.book-panel'))
  assert.ok(!editor())
})

async function openWorldRow(world) {
  const row = () => [...document.querySelectorAll('.worlds-home-section .arc-resource-row')].find(item => item.querySelector('strong')?.textContent === world.title)
  await settle(row)
  await click(row().querySelector('.arc-resource-row__open'))
  await settle(() => Boolean(document.querySelector('.workspace-screen.world-building')))
}
async function worldTab(label) {
  if (!document.querySelector('.book-panel')) await click(labeledButton('Open World workspace') ?? labeledButton('Open book workspace'))
  await click([...document.querySelectorAll('.book-panel nav button')].find(item => item.textContent.trim() === label))
}

test('World tabs reuse editor tools, disable Story and restore each World’s last canonical article', async t => {
  const first = await w.createWorld('First World')
  const second = await w.createWorld('Second World')
  await addEntry(first.id, 'First article')
  const last = await addEntry(first.id, 'Last article')
  const other = await addEntry(second.id, 'Other article')
  await mount(t)
  await openWorldRow(first)
  await worldTab('Codex')
  assert.deepEqual([...document.querySelectorAll('.book-panel nav button span')].map(item => item.textContent), ['World', 'Books', 'Notes', 'Codex', 'Chat'])
  assert.equal(button('Story').disabled, true)
  assert.match(document.getElementById('world-story-unavailable').textContent, /available only in Books/)
  await click(codexRow(last.title).querySelector('.arc-resource-row__open'))
  await settle(() => titleIs(last.title))
  await setTextarea(editor(), 'Saved before switching Worlds')
  await click(button('Home'))
  await settle(() => Boolean(document.querySelector('.library-screen')))
  await openWorldRow(second)
  await settle(() => titleIs(other.title))
  assert.equal(editor().value, other.content)
  await click(button('Home'))
  await settle(() => Boolean(document.querySelector('.library-screen')))
  await openWorldRow(first)
  await settle(() => titleIs(last.title))
  assert.equal(editor().value, 'Saved before switching Worlds')
  await worldTab('Codex')
  await click(labeledButton(`Actions for ${last.title}`))
  assert.ok(!menuItem('Hide in this Book'), 'World does not expose Book hiding')
  assert.ok(!menuItem('Copy to Book'), 'World does not expose current-Book transfer')
})

test('ID article links retain their target through rename and expose real backlinks', async t => {
  const world = await w.createWorld('Linked articles')
  const source = await addEntry(world.id, 'Source')
  const target = await addEntry(world.id, 'Target')
  const markdown = links.articleLink(target.id, target.title)
  await p.saveDocumentContent(source.id, markdown)
  await p.renameEntity(target.id, 'Renamed target')
  assert.deepEqual(links.articleLinkIds(markdown), [target.id])
  await mount(t)
  await openWorldRow(world)
  await worldTab('Codex')
  await click(codexRow(source.title).querySelector('.arc-resource-row__open'))
  await settle(() => titleIs(source.title))
  const forward = document.querySelector('[aria-label="Linked articles"] button')
  assert.equal(forward.textContent, 'Renamed target')
  await click(forward)
  await settle(() => titleIs('Renamed target'))
  const backlink = document.querySelector('[aria-label="Article backlinks"] button')
  assert.equal(backlink.textContent, source.title)
  await click(backlink)
  await settle(() => titleIs(source.title))
  assert.equal(editor().value, markdown)
})

test('failed save blocks article links and World-to-Book navigation, and retry preserves the dirty text', async t => {
  const f = await fixture()
  const source = await addEntry(f.world.id, 'A linked source')
  const target = await addEntry(f.world.id, 'Z link target')
  await p.saveDocumentContent(source.id, links.articleLink(target.id, target.title))
  await mount(t)
  await openWorldRow(f.world)
  await settle(() => titleIs(source.title))
  const table = db.table('entities')
  const rejectSave = (changes, key) => { if (key === source.id && 'content' in changes) throw new Error('Injected article save failure') }
  table.hook('updating').subscribe(rejectSave)
  t.after(() => table.hook('updating').unsubscribe(rejectSave))
  const dirty = `${links.articleLink(target.id, target.title)}\nUnsaved World prose`
  await setTextarea(editor(), dirty)
  await click(document.querySelector('[aria-label="Linked articles"] button'))
  await settle(() => document.querySelector('.save-state')?.textContent.includes('Save failed'))
  assert.equal(titleIs(source.title), true)
  assert.equal(editor().value, dirty)
  assert.equal((await p.getEntity(source.id)).content.includes('Unsaved World prose'), false)
  await worldTab('Books')
  await settle(() => document.querySelector('[aria-label="Linked Books"] .arc-resource-row__open'))
  await click(document.querySelector('[aria-label="Linked Books"] .arc-resource-row__open'))
  await settle(() => document.body.textContent.includes('Fix the save problem before switching books.'))
  assert.equal(editor().getAttribute('data-book-id'), f.world.id)
  assert.equal(editor().value, dirty)
  table.hook('updating').unsubscribe(rejectSave)
  await click(document.querySelector('[aria-label="Linked articles"] button'))
  await settle(() => titleIs(target.title))
  assert.equal((await p.getEntity(source.id)).content, dirty)
  assert.equal((await p.getOwnerWorkspaceState(f.world.id)).lastOpenedCodexEntryId, target.id)
})

async function uploadArchive(label, file) {
  const input = document.querySelector(`input[aria-label="${label}"]`)
  assert.ok(input)
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
}

test('library archive import opens its canonical World and later Book restore resolves pending references', async t => {
  const f = await fixture({ linked: false })
  const article = await addEntry(f.world.id, 'Imported canonical article', [], 'Archive body')
  const worldData = await worldArchive.readWorldArchive(f.world.id)
  worldData.bookReferences = [f.book.id]
  const worldFile = worldArchive.encodeWorldArchive(worldData)
  const canonicalBookData = await p.readBookArchive(f.book.id)
  const bookFile = bookArchive.encodeBookArchive(canonicalBookData)
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) if (table.name !== 'meta') await table.clear()
  })
  await mount(t)
  await uploadArchive('Import World archive', worldFile)
  await settle(() => titleIs(article.title) && editor()?.getAttribute('data-history-key') === `${f.world.id}:${article.id}`, 'World archive imports without an existing owner and opens its canonical article')
  assert.equal((await p.listBooks()).length, 0, 'Pending reference never creates a phantom Book')
  await click(button('Home'))
  await settle(() => document.querySelector('.library-screen'))
  await uploadArchive('Import book backup file', bookFile)
  await settle(async () => Boolean(document.querySelector('.scene-title')) && (await p.listBooks()).length === 1)
  const copiedBook = (await p.listBooks())[0]
  assert.notEqual(copiedBook.id, f.book.id, 'Book backup preserves its existing new-copy identity contract')
  assert.ok(!copiedBook.worldId, 'An independent backup copy must not consume the canonical pending reference')
  assert.equal(await p.getEntity(f.book.id), undefined)
  // A canonical identity becomes available through restoration/sync, unlike a
  // detached backup copy. Opening it reconciles the pending reference.
  const canonicalRoot = canonicalBookData.entities.find(row => row.id === f.book.id)
  canonicalRoot.title = 'Restored canonical Book'
  await settle(() => editor()?.getAttribute('data-book-id') === copiedBook.id, 'Imported backup finishes opening its Book workspace')
  await homeViaWorldBuilding()
  await act(async () => { await p.writeBookArchive(canonicalBookData) })
  await openBook(canonicalRoot)
  await settle(async () => (await p.getEntity(f.book.id))?.worldId === f.world.id, 'Canonical Book availability reconciles the pending World reference before opening')
  assert.equal((await w.listBookCodexEntries(f.book.id))[0].id, article.id)
})

test('World library exposes cloud and archive imports before any World exists', async t => {
  await mount(t)
  assert.ok(button('Cloud Worlds'))
  assert.ok(document.querySelector('input[aria-label="Import World archive"]'))
  await click(button('View all'))
  await settle(() => document.querySelector('[aria-label="World library"]'))
  assert.ok(button('Cloud Worlds'))
  assert.ok(document.querySelector('input[aria-label="Import World archive"]'))
})

test('standalone Last article survives World to Book to World without Book labels', async t => {
  const f = await fixture()
  await addEntry(f.world.id, 'A article')
  const last = await addEntry(f.world.id, 'Last article')
  await mount(t)
  await openWorldRow(f.world)
  await worldTab('Codex')
  await click(codexRow(last.title).querySelector('.arc-resource-row__open'))
  await settle(() => titleIs(last.title))
  assert.ok(labeledButton('Open World workspace'))
  assert.ok(labeledButton('Open current World settings'))
  assert.ok(!labeledButton('Open book workspace'))
  assert.ok(!labeledButton('Open current book settings'))
  assert.equal(document.body.textContent.includes('Open Book Workspace'), false)
  await worldTab('Books')
  await settle(() => document.querySelector('[aria-label="Linked Books"] .arc-resource-row__open'))
  await click(document.querySelector('[aria-label="Linked Books"] .arc-resource-row__open'))
  await settle(() => editor()?.getAttribute('data-book-id') === f.book.id)
  await homeViaWorldBuilding()
  await openWorldRow(f.world)
  await settle(() => titleIs(last.title))
  assert.equal((await p.getOwnerWorkspaceState(f.world.id)).lastOpenedCodexEntryId, last.id)
})

test('creation opens the new canonical article and Note even when mutation events supersede the list refresh', async t => {
  const world = await w.createWorld('Creation race')
  await mount(t)
  await openWorldRow(world)
  assert.doesNotMatch(document.querySelector('.document-path').textContent, /Outline/)
  assert.ok(button('Open World Workspace'))
  await click(button('Create first article'))
  await settle(async () => (await w.listWorldEntries(world.id)).length === 1, 'Article is persisted')
  const [article] = await w.listWorldEntries(world.id)
  await settle(() => editor()?.getAttribute('data-history-key') === `${world.id}:${article.id}`, 'Persisted article is also opened')
  await worldTab('Notes')
  await click([...document.querySelectorAll('.notes-panel button')].find(item => item.textContent.trim() === 'New'))
  await settle(async () => (await p.listEntitiesByBook(world.id, 'note')).length === 1, 'Note is persisted')
  const [note] = await p.listEntitiesByBook(world.id, 'note')
  await settle(() => editor()?.getAttribute('data-history-key') === `${world.id}:${note.id}`, 'Persisted Note is also opened')
})

test('a refresh which read A cannot replace B after a newer edit and navigation save', async t => {
  const world = await w.createWorld('Refresh race')
  const article = await addEntry(world.id, 'Race article', [], 'A')
  await mount(t)
  await openWorldRow(world)
  await settle(() => editor()?.value === 'A')
  const table = db.table('entities'), originalGet = table.get
  let release, captured = false
  const gate = new Promise(resolve => { release = resolve })
  table.get = async function (id) {
    const result = await originalGet.call(this, id)
    if (id === article.id && !captured) {
      captured = true
      table.get = originalGet
      await gate
    }
    return result
  }
  t.after(() => { table.get = originalGet; release() })
  await act(async () => window.dispatchEvent(new Event('focus')))
  await settle(() => captured, 'Refresh reads the old canonical body')
  await setTextarea(editor(), 'B')
  await worldTab('Books')
  await settle(() => button('New Book in this World') && !button('New Book in this World').disabled)
  await click(button('New Book in this World'))
  await settle(async () => (await p.getEntity(article.id)).content === 'B' && (await p.listBooks()).length === 1 && !button('New Book in this World').disabled, 'Required save makes B durable and clears dirty state')
  await act(async () => { release(); await new Promise(resolve => setTimeout(resolve, 100)) })
  assert.equal(editor().value, 'B', 'Obsolete refresh never replaces the saved editor body')
  assert.equal((await p.getEntity(article.id)).content, 'B')
})

test('empty World creates articles, Notes and a summary through the shared editor without creating a Book', async t => {
  const world = await w.createWorld('Independent authoring')
  await mount(t)
  await openWorldRow(world)
  await click(button('Create first article'))
  await settle(() => Boolean(editor()))
  const [first] = await w.listWorldEntries(world.id)
  assert.equal(first.worldId, world.id)
  await setTextarea(editor(), 'First canonical article body')
  await worldTab('Codex')
  await click([...document.querySelectorAll('.codex-dashboard button')].find(item => item.textContent.trim() === 'New'))
  await settle(async () => (await w.listWorldEntries(world.id)).length === 2 && editor()?.getAttribute('data-history-key') !== `${world.id}:${first.id}`)
  assert.equal((await p.getEntity(first.id)).content, 'First canonical article body')
  const second = (await w.listWorldEntries(world.id)).find(item => item.id !== first.id)
  await setTextarea(editor(), 'Second canonical article body')
  await click(document.querySelector('.document-titlebar button[title^="No summary"]'))
  await settle(async () => (await p.listEntitiesByBook(world.id, 'summary')).length === 1 && editor()?.getAttribute('data-history-key')?.includes('summary'))
  const [summary] = await p.listEntitiesByBook(world.id, 'summary')
  assert.equal(summary.sourceEntityId, second.id)
  assert.equal(summary.worldId, world.id)
  await setTextarea(editor(), 'Independent World summary')
  await worldTab('Notes')
  await click([...document.querySelectorAll('.notes-panel button')].find(item => item.textContent.trim() === 'New'))
  await settle(async () => (await p.listEntitiesByBook(world.id, 'note')).length === 1 && document.querySelector('.document-titlebar small')?.textContent === 'Note')
  const [note] = await p.listEntitiesByBook(world.id, 'note')
  assert.equal(note.worldId, world.id)
  assert.equal((await p.getEntity(summary.id)).content, 'Independent World summary')
  await setTextarea(editor(), 'World-owned note body')
  await click(button('Home'))
  await settle(() => document.querySelector('.library-screen'))
  assert.equal((await p.getEntity(note.id)).content, 'World-owned note body')
  assert.equal((await p.listBooks()).length, 0)
})

test('World creates a linked Book and the Home library refreshes without a reload', async t => {
  const world = await w.createWorld('Book creation World')
  await mount(t)
  await openWorldRow(world)
  await worldTab('Books')
  await settle(() => button('New Book in this World') && !button('New Book in this World').disabled)
  await click(button('New Book in this World'))
  await settle(async () => (await p.listBooks()).length === 1 && document.querySelector('[aria-label="Linked Books"] .arc-resource-row'))
  const [book] = await p.listBooks()
  assert.equal(book.worldId, world.id)
  await click(button('Home'))
  await settle(() => document.querySelector('.library-book strong')?.textContent === book.title)
  await openBook(book)
  assert.equal(editor().getAttribute('data-book-id'), book.id)
})

test('World Books panel confirms detach impact and cleans only unavailable dependencies', async t => {
  const f = await fixture()
  const shared = await addEntry(f.world.id, 'Shared dependency')
  const local = await addEntry(f.book.id, 'Local source')
  const localTarget = await addEntry(f.book.id, 'Local target')
  const lost = await p.createCodexDependency(f.book.id, local.id, shared.id)
  const kept = await p.createCodexDependency(f.book.id, local.id, localTarget.id)
  await mount(t)
  await openWorldRow(f.world)
  await worldTab('Books')
  await settle(() => button('Disconnect') && !button('Disconnect').disabled)
  const confirmations = []
  window.confirm = text => { confirmations.push(text); return false }
  await click(button('Disconnect'))
  await settle(() => confirmations.length === 1)
  assert.match(confirmations[0], /1 shared articles.*1 unavailable dependencies/)
  assert.equal((await p.getEntity(f.book.id)).worldId, f.world.id)
  window.confirm = text => { confirmations.push(text); return true }
  await settle(() => !button('Disconnect').disabled)
  await click(button('Disconnect'))
  await settle(async () => !(await p.getEntity(f.book.id)).worldId)
  assert.deepEqual((await p.listCodexDependencies(f.book.id)).map(edge => edge.id), [kept.id])
  assert.ok(!(await p.listCodexDependencies(f.book.id)).some(edge => edge.id === lost.id))
  assert.equal((await p.getEntity(shared.id)).worldId, f.world.id)
  assert.ok(await p.getEntity(f.scene.id), 'Detach retains the manuscript')
  assert.ok(await p.getEntity(local.id), 'Detach retains private lore')
})

test('a canonical World article viewed from Book never offers private Book dependencies', async t => {
  const f = await fixture()
  const source = await addEntry(f.world.id, 'Canonical source')
  const target = await addEntry(f.world.id, 'Canonical target')
  const privateEntry = await addEntry(f.book.id, 'Private Book candidate')
  await mount(t)
  await openBook(f.book)
  await openEntry(source)
  const disclosure = [...document.querySelectorAll('.codex-dependencies-metadata summary')].find(item => item.textContent.includes('Dependencies'))
  await click(disclosure)
  await click(button('Add dependency'))
  const choices = [...document.querySelectorAll('.codex-dependency-picker button strong')].map(item => item.textContent)
  assert.ok(choices.includes(target.title))
  assert.ok(!choices.includes(privateEntry.title))
})

test('World Books panel requires confirmation to move an existing Book between named Worlds', async t => {
  const f = await fixture()
  const nextWorld = await w.createWorld('Destination World')
  const shared = await addEntry(f.world.id, 'Original shared article')
  await mount(t)
  await openWorldRow(nextWorld)
  await worldTab('Books')
  const select = () => document.querySelector('select[aria-label="Connect existing Book"]')
  await settle(() => select() && !select().disabled && [...select().options].some(item => item.value === f.book.id))
  await act(async () => {
    select().value = f.book.id
    select().dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  })
  const prompts = []
  window.confirm = text => { prompts.push(text); return false }
  await click(button('Connect Book'))
  await settle(() => prompts.length === 1 && !button('Connect Book').disabled)
  assert.match(prompts[0], new RegExp(f.world.title))
  assert.match(prompts[0], new RegExp(nextWorld.title))
  assert.equal((await p.getEntity(f.book.id)).worldId, f.world.id)
  window.confirm = text => { prompts.push(text); return true }
  await click(button('Connect Book'))
  await settle(async () => (await p.getEntity(f.book.id)).worldId === nextWorld.id)
  assert.equal((await p.getEntity(shared.id)).worldId, f.world.id)
  assert.ok(await p.getEntity(f.scene.id))
})

test('World deletion UI counts Notes and Chats even without articles', async t => {
  const world = await w.createWorld('Occupied by Notes and Chat')
  await p.createNote(world.id, 'Standalone note')
  await chatService.createChat(world.id, 'Standalone chat')
  await mount(t)
  await openWorldRow(world)
  await worldTab('World')
  await settle(() => document.querySelector('[aria-label="World settings"]')?.textContent.includes('1 Notes, 1 Chats'))
  await click(labeledButton(`Actions for ${world.title}`))
  assert.equal(menuItem('Delete World').disabled, true)
  assert.ok(await p.getEntity(world.id))
})

test('Chat retains the current World article as an explicit selectable source', async t => {
  const world = await w.createWorld('Chat with current article')
  const article = await addEntry(world.id, 'Current article')
  const chat = await chatService.createChat(world.id, 'Article discussion')
  await mount(t)
  await openWorldRow(world)
  await settle(() => titleIs(article.title))
  await worldTab('Chat')
  await settle(() => [...document.querySelectorAll('.arc-resource-row')].some(row => row.querySelector('strong')?.textContent === chat.title))
  await click([...document.querySelectorAll('.arc-resource-row')].find(row => row.querySelector('strong')?.textContent === chat.title).querySelector('.arc-resource-row__open'))
  await settle(() => button('Add current article to context'))
  await click(button('Add current article to context'))
  await settle(async () => (await chatService.getChat(chat.id)).contextProfile.codexEntryIds.includes(article.id))
  assert.equal((await p.listBooks()).length, 0)
})

test('World Notes and Chat remain owner-local and World context rejects explicit private Book IDs', async t => {
  const f = await fixture()
  const privateLore = await addEntry(f.book.id, 'PRIVATE_BOOK_LORE', [], 'PRIVATE_BOOK_SECRET')
  const worldLore = await addEntry(f.world.id, 'World lore', [], 'WORLD_LORE_CONTEXT')
  const note = await p.createNote(f.world.id, 'World note')
  const chat = await chatService.createChat(f.world.id, 'World conversation')
  await chatService.createChatMessage(chat, 'user', 'World message')
  assert.equal((await p.listEntitiesByBook(f.book.id, 'note')).some(item => item.id === note.id), false)
  assert.equal((await chatService.listChats(f.book.id)).some(item => item.id === chat.id), false)
  const profile = { ...p.defaultGenerationContextProfile, includeLastScene: true, structuralIds: [f.scene.id], codexEntryIds: [privateLore.id, worldLore.id], noteIds: [note.id] }
  const context = await buildContextValues({ bookId: f.world.id, type: 'chat', currentSceneId: f.scene.id, profile })
  assert.equal(context.currentSceneText, '')
  assert.equal(context.lastSceneText, '')
  assert.equal(context.additionalContext.includes('PRIVATE_BOOK_SECRET'), false)
  assert.equal(context.additionalContext.includes('WORLD_LORE_CONTEXT'), true)
  await mount(t)
  await openWorldRow(f.world)
  await worldTab('Notes')
  await settle(() => [...document.querySelectorAll('.arc-resource-row')].some(item => item.querySelector('strong')?.textContent === note.title))
  await click([...document.querySelectorAll('.arc-resource-row')].find(item => item.querySelector('strong')?.textContent === note.title)?.querySelector('.arc-resource-row__open'))
  await settle(() => titleIs(note.title))
  await setTextarea(editor(), 'Independent World note edit')
  await worldTab('Chat')
  await settle(() => [...document.querySelectorAll('.arc-resource-row')].some(item => item.querySelector('strong')?.textContent === chat.title))
  await click([...document.querySelectorAll('.arc-resource-row')].find(item => item.querySelector('strong')?.textContent === chat.title).querySelector('.arc-resource-row__open'))
  await settle(() => document.querySelector('.functional-chat h1')?.textContent === chat.title)
  assert.match(document.querySelector('.functional-chat').textContent, /World message/)
  assert.equal((await p.getEntity(note.id)).content, 'Independent World note edit')
})

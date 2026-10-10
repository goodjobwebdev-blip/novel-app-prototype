import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, renameSync, writeFileSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import 'fake-indexeddb/auto'
import { transpileSourceTree } from './transpile-source-tree.mjs'

const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'https://arc.test/', pretendToBeVisual: true })
after(() => dom.window.close())
for (const key of ['window', 'document', 'HTMLElement', 'HTMLDialogElement', 'Element', 'Node', 'MutationObserver', 'sessionStorage', 'localStorage', 'Event', 'CustomEvent']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.getComputedStyle = dom.window.getComputedStyle
dom.window.HTMLElement.prototype.scrollIntoView = function () {}
dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
globalThis.ResizeObserver = class { constructor(callback) { this.callback = callback } observe() { this.callback() } disconnect() {} }
const directory = mkdtempSync(new URL('../node_modules/.arc-world-codex-ui-test-', import.meta.url))
after(() => rmSync(directory, { recursive: true, force: true }))
transpileSourceTree(directory)
renameSync(`${directory}/features/worlds/world-service.mjs`, `${directory}/features/worlds/world-service.actual.mjs`)
// Real persistence/atomic actions, with controllable preflight latency for race regressions.
writeFileSync(`${directory}/features/worlds/world-service.mjs`, `
import * as actual from './world-service.actual.mjs';
export * from './world-service.actual.mjs';
export const calls = [], pending = [];
let deferred = false;
export function configure(value = false) { deferred = value; calls.length = 0; pending.length = 0; }
export function worldTransferConflicts(bookId, id) {
  calls.push('check:' + id);
  if (deferred) return new Promise((resolve, reject) => pending.push({ bookId, id, resolve, reject }));
  return actual.worldTransferConflicts(bookId, id);
}
export function moveEntryToWorld(bookId, id) { calls.push('move:' + id); return actual.moveEntryToWorld(bookId, id); }
export function copyWorldEntryToBook(bookId, id) { calls.push('copy:' + id); return actual.copyWorldEntryToBook(bookId, id); }
export function setWorldEntryHidden(bookId, id, hidden) { calls.push('hidden:' + id + ':' + hidden); return actual.setWorldEntryHidden(bookId, id, hidden); }
`)
const moduleAt = name => import(pathToFileURL(`${directory}/${name}.mjs`))
const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { act } = React, h = React.createElement
const p = await moduleAt('data/persistence')
after(async () => (await p.database()).close())
const w = await moduleAt('features/worlds/world-service')
const ai = await moduleAt('shared/ai/ai-settings')
const { default: Dashboard } = await moduleAt('features/codex/CodexDashboard')
const { buildContextValues } = await moduleAt('shared/context/context-service')
const button = text => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text)
const menuItem = text => [...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent.trim() === text)
const rows = () => [...document.querySelectorAll('.codex-dashboard-entry')]
async function settle(predicate) {
  for (let i = 0; i < 200 && !predicate(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 10)))
  assert.ok(predicate(), document.body.textContent)
}
async function click(text) { const target = button(text); assert.ok(target, `Missing button: ${text}`); await act(async () => target.click()) }
async function openActions(title) {
  const target = document.querySelector(`button[aria-label="Actions for ${title}"]`)
  assert.ok(target, `Missing actions for ${title}`)
  await act(async () => target.click())
}
async function changeSelect(label, value) {
  const field = [...document.querySelectorAll('label.arc-field')].find(field => field.querySelector('.arc-field__label')?.textContent === label)
  const select = document.querySelector(`select[aria-label="${label}"]`) ?? field?.querySelector('select')
  assert.ok(select, `Missing select ${label}`)
  await act(async () => { select.value = value; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
}
async function fixture(linked = true) {
  w.configure()
  const { book, chapter } = await p.createBook(ai.initialAiSettings, 'Book')
  const world = linked ? await w.createWorld('World') : undefined
  if (world) await w.setBookWorld(book.id, world.id)
  return { book, chapter, world }
}
async function addEntry(ownerId, title, triggers = [title], extra = {}) {
  const entry = await p.createCodexEntry(ownerId, title, 'Place')
  const next = { ...entry, content: `${title} body`, autoIncludeTriggers: triggers, ...extra }
  await (await p.database()).table('entities').put(next)
  return next
}
async function mount(t, f, overrides = {}) {
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await act(async () => root.unmount()) })
  const callbacks = []
  const props = {
    bookId: f.book.id, entries: await w.listBookCodexEntries(f.book.id), activeId: null, summaryStates: {},
    onCreate() {}, onOpen(id) { callbacks.push(['open', id]) },
    onRename(entry) { callbacks.push(['rename', entry.id, entry.bookId]) },
    onAutotitle(entry) { callbacks.push(['autotitle', entry.id, entry.bookId]) },
    onArchive(entry) { callbacks.push(['archive', entry.id, entry.bookId]) },
    onRestore(entry) { callbacks.push(['restore', entry.id, entry.bookId]) },
    onDelete(entry) { callbacks.push(['delete', entry.id, entry.bookId]) },
    async onBeforeChange() { w.calls.push('flush') },
    async onRefresh() { w.calls.push('refresh'); props.entries = await w.listBookCodexEntries(props.bookId); root.render(h(Dashboard, props)) },
    ...overrides,
  }
  await act(async () => root.render(h(Dashboard, props)))
  return { root, props, callbacks }
}

test('merged Codex labels scopes, warns with conflicting title/trigger, and exposes canonical World callbacks', async t => {
  const f = await fixture()
  const local = await addEntry(f.book.id, 'Book tower', [' NORTH\tTOWER '])
  const shared = await addEntry(f.world.id, 'World tower', ['North Tower', 'Beacon'])
  const view = await mount(t, f)
  assert.equal(rows().length, 2)
  const localRow = rows().find(row => row.textContent.includes(local.title))
  assert.match(localRow.textContent, /Book-only · Active/)
  assert.match(localRow.textContent, /Trigger conflict:.*North Tower.*World tower/)
  assert.match(rows().find(row => row.textContent.includes(shared.title) && !row.textContent.includes('Book-only')).textContent, /World · Active/)
  assert.match(document.body.textContent, /affects every linked Book/)
  await openActions(local.title)
  await settle(() => menuItem('View trigger conflicts with World') && !menuItem('View trigger conflicts with World').disabled)
  assert.equal(menuItem('Link to World').disabled, true)
  await click('View trigger conflicts with World')
  assert.match(document.querySelector('[role="dialog"]')?.textContent ?? document.querySelector('dialog')?.textContent, /World tower/)
  await click('Close')
  for (const [label, callback] of [['Rename in World', 'rename'], ['Autotitle in World', 'autotitle'], ['Archive in World', 'archive'], ['Delete in World', 'delete']]) {
    await openActions(shared.title)
    assert.ok(menuItem('Copy to Book'))
    assert.ok(menuItem('Hide in this Book'))
    assert.equal([...document.querySelectorAll('[role="menuitem"]')].some(item => /series|override|for this book/i.test(item.textContent)), false)
    await click(label)
    assert.deepEqual(view.callbacks.at(-1), [callback, shared.id, f.world.id], 'World actions retain canonical owner identity')
  }
  await openActions(shared.title)
  await settle(() => menuItem('View trigger conflicts with Book') && !menuItem('View trigger conflicts with Book').disabled)
  assert.equal(menuItem('Copy to Book').disabled, true)
  await click('View trigger conflicts with Book')
  assert.match(document.querySelector('[role="dialog"]')?.textContent ?? document.querySelector('dialog')?.textContent, /Book tower/)
})

test('hide flushes first and hidden manager restores without exposing a hidden-entry editor', async t => {
  const f = await fixture()
  const shared = await addEntry(f.world.id, 'Hidden tower')
  const view = await mount(t, f)
  await openActions(shared.title)
  await settle(() => menuItem('Hide in this Book') && !menuItem('Hide in this Book').disabled)
  w.calls.length = 0
  await click('Hide in this Book')
  await settle(() => rows().length === 0 && Boolean(button(`Restore ${shared.title} in this Book`)))
  assert.deepEqual(w.calls.slice(0, 3), ['flush', `hidden:${shared.id}:true`, 'refresh'])
  assert.ok(document.querySelector(`button[aria-label="Actions for ${shared.title}"]`) === null, 'Hidden entries have no editor actions')
  assert.equal(view.callbacks.length, 0)
  assert.ok((await p.getEntity(f.book.id)).hiddenWorldEntryIds.includes(shared.id))
  w.calls.length = 0
  await click(`Restore ${shared.title} in this Book`)
  await settle(() => rows().length === 1 && !button(`Restore ${shared.title} in this Book`))
  assert.deepEqual(w.calls.slice(0, 3), ['flush', `hidden:${shared.id}:false`, 'refresh'])
  assert.equal((await p.getEntity(shared.id)).bookId, f.world.id)
})

test('transfers remain disabled until checked, then flush before atomic move/copy and refresh', async t => {
  const f = await fixture()
  const local = await addEntry(f.book.id, 'Local harbor')
  w.configure(true)
  await mount(t, f)
  await openActions(local.title)
  assert.equal(menuItem('Link to World').disabled, true)
  await settle(() => w.pending.length === 1)
  await act(async () => w.pending[0].resolve([]))
  await settle(() => !menuItem('Link to World').disabled)
  w.configure()
  await click('Link to World')
  await settle(() => rows().some(row => row.textContent.includes('World · Active')))
  assert.deepEqual(w.calls.slice(0, 3), ['flush', `move:${local.id}`, 'refresh'])
  assert.equal((await p.getEntity(local.id)).worldId, f.world.id)
  await openActions(local.title)
  await settle(() => menuItem('Copy to Book') && !menuItem('Copy to Book').disabled)
  w.calls.length = 0
  await click('Copy to Book')
  await settle(() => rows().length === 2)
  assert.deepEqual(w.calls.slice(0, 3), ['flush', `copy:${local.id}`, 'refresh'])
  const copied = (await w.listBookCodexEntries(f.book.id)).find(entry => !entry.worldId)
  assert.ok(copied.id !== local.id)
  assert.equal(copied.bookId, f.book.id)
  assert.equal((await p.getEntity(local.id)).bookId, f.world.id)
})

test('draft/active status uses persistence, scope/status filters do not conflate draft and archive', async t => {
  const f = await fixture()
  const local = await addEntry(f.book.id, 'Local draft')
  const shared = await addEntry(f.world.id, 'World active')
  const archived = await addEntry(f.world.id, 'World archived', [], { archivedAt: 12 })
  const view = await mount(t, f)
  await openActions(local.title)
  await click('Set draft')
  await settle(() => rows().some(row => row.textContent.includes('Book-only · Draft')))
  assert.equal((await p.getEntity(local.id)).codexStatus, 'draft')
  await changeSelect('Status', 'draft')
  assert.equal(rows().length, 1)
  await openActions(local.title)
  await click('Activate')
  await settle(() => rows().length === 0)
  assert.equal((await p.getEntity(local.id)).codexStatus, 'active')
  await changeSelect('Status', 'all')
  await changeSelect('Scope', 'world')
  assert.equal(rows().length, 1)
  assert.match(rows()[0].textContent, /World active/)
  await openActions(shared.title)
  await click('Set draft in World')
  await settle(() => rows().some(row => row.textContent.includes('World · Draft')))
  assert.equal((await p.getEntity(shared.id)).codexStatus, 'draft')
  await changeSelect('Codex archive mode', 'archived')
  assert.equal(rows().length, 1)
  assert.match(rows()[0].textContent, /World archived.*World · Archived/)
  await openActions(archived.title)
  await click('Restore in World')
  assert.deepEqual(view.callbacks.at(-1), ['restore', archived.id, f.world.id])
})

test('a Book without a World cannot transfer or view unavailable transfer conflicts', async t => {
  const f = await fixture(false)
  const local = await addEntry(f.book.id, 'Unlinked entry')
  await mount(t, f)
  await openActions(local.title)
  assert.equal(menuItem('Link to World').disabled, true)
  assert.equal(menuItem('View trigger conflicts with World').disabled, true)
  assert.equal(w.calls.some(call => call.startsWith('check:')), false)
})

test('late preflight results cannot enable another entry or survive a Book switch; errors fail closed', async t => {
  const f = await fixture()
  const first = await addEntry(f.book.id, 'First'), second = await addEntry(f.book.id, 'Second')
  w.configure(true)
  const view = await mount(t, f)
  await openActions(first.title)
  await settle(() => w.pending.length === 1)
  await openActions(second.title)
  await settle(() => w.pending.length === 2)
  await act(async () => w.pending[0].resolve([]))
  assert.equal(menuItem('Link to World').disabled, true, 'The first entry result must not enable the second')
  await act(async () => w.pending[1].reject(new Error('Preflight unavailable')))
  await settle(() => document.body.textContent.includes('Preflight unavailable'))
  assert.equal(menuItem('Link to World').disabled, true)
  assert.equal(menuItem('View trigger conflicts with World').disabled, true)
  await openActions(first.title)
  await settle(() => w.pending.length === 3)
  const lateCheck = w.pending[2]
  const outsider = await fixture(false)
  const outsideEntry = await addEntry(outsider.book.id, 'Outside entry')
  await act(async () => view.root.render(h(Dashboard, { ...view.props, bookId: outsider.book.id, entries: [outsideEntry] })))
  assert.ok(document.querySelector('[role="menu"]') === null, 'A Book switch closes the old menu')
  await act(async () => lateCheck.resolve([]))
  await openActions(outsideEntry.title)
  assert.equal(menuItem('Link to World').disabled, true)
  assert.equal(document.body.textContent.includes('Preflight unavailable'), false)
})

test('a failed flush prevents mutation, and a Book switch during flush cancels the old action', async t => {
  const f = await fixture()
  const local = await addEntry(f.book.id, 'Flush target')
  let finishFlush
  const view = await mount(t, f, { async onBeforeChange() { throw new Error('Save failed') } })
  await openActions(local.title)
  await settle(() => menuItem('Link to World') && !menuItem('Link to World').disabled)
  w.calls.length = 0
  await click('Link to World')
  assert.match(document.body.textContent, /Save failed/)
  assert.equal(w.calls.some(call => call.startsWith('move:')), false)
  view.props.onBeforeChange = () => new Promise(resolve => { finishFlush = resolve })
  await act(async () => view.root.render(h(Dashboard, view.props)))
  await openActions(local.title)
  await settle(() => menuItem('Link to World') && !menuItem('Link to World').disabled)
  await click('Link to World')
  assert.ok(finishFlush)
  const outsider = await fixture(false)
  await act(async () => view.root.render(h(Dashboard, { ...view.props, bookId: outsider.book.id, entries: [] })))
  await act(async () => finishFlush())
  assert.equal(w.calls.some(call => call.startsWith('move:')), false)
  assert.equal((await p.getEntity(local.id)).worldId, undefined)
})

test('background World events and entry refreshes preserve the user-opened conflict dialog', async t => {
  const f = await fixture()
  const local = await addEntry(f.book.id, 'Book conflict', ['shared'])
  await addEntry(f.world.id, 'World conflict', ['shared'])
  const hidden = await addEntry(f.world.id, 'Hidden reference')
  await w.setWorldEntryHidden(f.book.id, hidden.id, true)
  const view = await mount(t, f)
  const restoredData = () => Boolean(button(`Restore ${hidden.title} in this Book`))
  await settle(restoredData)
  await openActions(local.title)
  await settle(() => menuItem('View trigger conflicts with World') && !menuItem('View trigger conflicts with World').disabled)
  await click('View trigger conflicts with World')
  const dialog = document.querySelector('dialog')
  assert.ok(dialog, 'Conflict dialog opens')
  await act(async () => { await w.createWorld('Unrelated World') })
  await settle(restoredData)
  assert.ok(document.querySelector('dialog') === dialog, 'An unrelated global World event must not dismiss or remount the dialog')
  await act(async () => view.root.render(h(Dashboard, { ...view.props, entries: [...view.props.entries] })))
  await settle(restoredData)
  assert.ok(document.querySelector('dialog') === dialog, 'A visible-entry refresh must preserve the dialog')
  assert.match(dialog.textContent, /World conflict/)
  const outsider = await fixture(false)
  await act(async () => view.root.render(h(Dashboard, { ...view.props, bookId: outsider.book.id, entries: [] })))
  assert.ok(document.querySelector('dialog') === null, 'Switching Books still closes the old dialog')
})

test('context priority blocks dependency bypass but still permits explicit manual World context', async () => {
  const f = await fixture()
  const local = await addEntry(f.book.id, 'Local priority', ['shared'])
  const world = await addEntry(f.world.id, 'World loser', ['shared', 'alias'])
  const root = await addEntry(f.book.id, 'Dependency root', ['root'])
  await p.createCodexDependency(f.book.id, root.id, world.id)
  const scene = await p.createStructuralEntity('scene', f.book.id, f.chapter.id, 'Opening')
  await p.saveDocumentContent(scene.id, 'root alias')
  const options = { bookId: f.book.id, type: 'scene', currentSceneId: scene.id, profile: { ...p.defaultGenerationContextProfile } }
  let context = await buildContextValues(options)
  assert.deepEqual(context.automaticCodex.map(entry => entry.entryId), [root.id])
  assert.equal(context.automaticCodexContext.includes(world.title), false)
  context = await buildContextValues({ ...options, profile: { ...options.profile, codexEntryIds: [world.id] } })
  assert.equal(context.automaticCodex.some(entry => entry.entryId === world.id), false)
  assert.ok(context.additionalContext.includes(`${world.title} (World)`))
  await p.setCodexEntryStatus(local.id, 'draft')
  context = await buildContextValues(options)
  assert.ok(context.automaticCodex.some(entry => entry.entryId === world.id))
  await w.setWorldEntryHidden(f.book.id, world.id, true)
  context = await buildContextValues({ ...options, profile: { ...options.profile, codexEntryIds: [world.id] } })
  assert.equal(context.automaticCodex.some(entry => entry.entryId === world.id), false)
  assert.equal(context.additionalContext.includes(world.title), false)
})

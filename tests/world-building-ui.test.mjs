import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import 'fake-indexeddb/auto'
import { transpileSourceTree } from './transpile-source-tree.mjs'

const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'https://arc.test/', pretendToBeVisual: true })
after(() => dom.window.close())
for (const key of ['window', 'document', 'Node', 'HTMLElement', 'HTMLDialogElement', 'Event', 'CustomEvent', 'localStorage', 'sessionStorage']) globalThis[key] = dom.window[key]
dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { act } = React
const h = React.createElement
const directory = mkdtempSync(new URL('../node_modules/.arc-world-ui-test-', import.meta.url))
after(() => rmSync(directory, { recursive: true, force: true }))
transpileSourceTree(directory)
// Hold only reads, outside Dexie transactions, to exercise stale-response guards.
copyFileSync(`${directory}/features/worlds/world-service.mjs`, `${directory}/features/worlds/world-service-real.mjs`)
writeFileSync(`${directory}/features/worlds/world-service.mjs`, `
export * from './world-service-real.mjs';
import * as real from './world-service-real.mjs';
export const controls = { holdLibrary: false, holdConflicts: false, failLibrary: false, beforeCopy: null, library: [], conflicts: [] };
export async function listWorlds() {
  if (controls.failLibrary) throw new Error('World library read failed');
  const result = await real.listWorlds();
  if (controls.holdLibrary) await new Promise(resolve => controls.library.push(resolve));
  return result;
}
export async function worldDemotionConflicts(worldId, entryId) {
  const result = await real.worldDemotionConflicts(worldId, entryId);
  if (controls.holdConflicts) await new Promise(resolve => controls.conflicts.push(resolve));
  return result;
}
export async function copyWorldEntryToAllBooksAndRemove(worldId, entryId) {
  const beforeCopy = controls.beforeCopy;
  controls.beforeCopy = null;
  if (beforeCopy) await beforeCopy();
  return real.copyWorldEntryToAllBooksAndRemove(worldId, entryId);
}
`)
const moduleAt = name => import(pathToFileURL(`${directory}/${name}.mjs`))
const p = await moduleAt('data/persistence')
after(async () => (await p.database()).close())
const worlds = await moduleAt('features/worlds/world-service')
const ai = await moduleAt('shared/ai/ai-settings')
const profiles = await moduleAt('features/settings/settings-profiles')
const autotitle = await moduleAt('features/writing/autotitle-service')
const fake = await moduleAt('shared/ai/fake-provider')
const { default: WorldBuilding, WorldsHomeSection } = await moduleAt('features/worlds/WorldBuilding')
const { TriggerConflictsDialog } = await moduleAt('features/worlds/TriggerConflictsDialog')
await p.ensurePrototypeSeed('Ready before mounting World views')

beforeEach(async () => {
  worlds.controls.holdLibrary = false
  worlds.controls.holdConflicts = false
  worlds.controls.failLibrary = false
  worlds.controls.beforeCopy = null
  worlds.controls.library.splice(0).forEach(resolve => resolve())
  worlds.controls.conflicts.splice(0).forEach(resolve => resolve())
  const db = await p.database()
  await db.table('entities').clear()
  await db.table('codexDependencies').clear()
  localStorage.clear()
  fake.clearFakeProviderTrace()
})

function rootFor(t) {
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await act(async () => root.unmount()) })
  t.after(async () => {
    worlds.controls.holdLibrary = false; worlds.controls.holdConflicts = false
    worlds.controls.beforeCopy = null
    await act(async () => {
      worlds.controls.library.splice(0).forEach(resolve => resolve())
      worlds.controls.conflicts.splice(0).forEach(resolve => resolve())
    })
  })
  return root
}
const button = text => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text)
const labeledButton = label => [...document.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === label)
async function click(text) {
  const target = button(text)
  assert.ok(target, `Missing button: ${text}`)
  await act(async () => target.click())
}
async function actions(title) {
  const target = labeledButton(`Actions for ${title}`)
  assert.ok(target, `Missing actions for ${title}`)
  await act(async () => target.click())
}
async function settle(predicate) {
  for (let index = 0; index < 200; index++) {
    await act(async () => new Promise(resolve => setTimeout(resolve, 10)))
    if (predicate()) return
  }
  assert.ok(predicate(), document.body.textContent)
}
function worldIdle() {
  return !document.body.textContent.includes('Loading Worlds…') && [...document.querySelectorAll('.world-entry-controls .arc-button')].every(item => !item.disabled)
}
async function setInput(label, value) {
  const input = document.querySelector(`input[aria-label="${label}"]`)
  assert.ok(input, label)
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
}
async function fixture({ linked = 2, entry = true } = {}) {
  const world = await worlds.createWorld('Shared skies')
  const books = []
  for (let index = 0; index < linked; index++) {
    const { book } = await p.createBook(ai.initialAiSettings, `Book ${index + 1}`)
    books.push(await worlds.setBookWorld(book.id, world.id))
  }
  const codex = entry ? await p.createCodexEntry(world.id, 'Sky city', 'Place') : undefined
  if (codex) await (await p.database()).table('entities').update(codex.id, { content: 'SECRET_BODY_NOT_A_VIEWER', autoIncludeTriggers: ['Sky city'] })
  return { world, books, entry: codex }
}
async function mountWorld(t, f) {
  const root = rootFor(t)
  await act(async () => root.render(h(WorldBuilding, { initialWorldId: f.world.id, onHome() {} })))
  await settle(() => document.querySelector('.world-detail h2')?.textContent === f.world.title && !document.body.textContent.includes('Loading Worlds…'))
  await settle(worldIdle)
  return root
}
const copyLabel = 'Copy to all linked books and remove from World'

function configureGlobalDefault() {
  // The legacy global model is deliberately unusable: the default text profile must win.
  ai.saveAiSettings({ ...ai.initialAiSettings, provider: 'fake', mainModel: 'not-the-default-profile', supportModel: '' })
  const library = profiles.loadSettingsProfiles()
  const text = library.profiles.find(profile => profile.id === library.defaults.text)
  profiles.saveSettingsProfile({ ...text, settings: { ...text.settings, mainModel: 'fake/test', supportModel: '', mainModelContextLength: 32768, mainEffectiveContextLimit: '' } })
  return profiles.resolveProfileSettings(profiles.loadSettingsProfiles().defaults)
}

test('Home lists only the first four Worlds, counts members, opens existing/new Worlds and views all', async t => {
  const f = await fixture()
  for (const title of ['A', 'B', 'C', 'D', 'Z']) await worlds.createWorld(title)
  let opened = '', all = 0
  const root = rootFor(t)
  await act(async () => root.render(h(WorldsHomeSection, { onOpen: id => { opened = id }, onViewAll: () => { all++ } })))
  await settle(() => document.querySelectorAll('.worlds-home-section .arc-resource-row').length === 4)
  assert.equal(document.querySelectorAll('.worlds-home-section .arc-resource-row').length, 4)
  assert.ok(!document.querySelector('.worlds-home-section').textContent.includes('Shared skies'))
  await click('View all'); assert.equal(all, 1)
  const firstWorld = (await worlds.listWorlds())[0]
  await act(async () => document.querySelector('.worlds-home-section .arc-resource-row__open').click())
  assert.equal(opened, firstWorld.id)
  opened = ''
  await click('New world')
  await settle(() => Boolean(opened) && worldIdle())
  assert.equal((await p.getEntity(opened)).type, 'world')
  const createdId = opened
  await act(async () => root.render(h(WorldBuilding, { initialWorldId: f.world.id, onHome() {} })))
  await settle(() => document.querySelector('.world-detail')?.textContent.includes('2 linked Books') && worldIdle())
  assert.match(document.querySelector('.world-detail').textContent, /1 Codex entry/)
  assert.ok((await worlds.listWorlds()).some(world => world.id === createdId))
})

test('World Codex stays list-only, exposes only the copy menu and a separate conflict action, and prevents nonempty deletion', async t => {
  const f = await fixture()
  await mountWorld(t, f)
  assert.ok(!document.body.textContent.includes('SECRET_BODY_NOT_A_VIEWER'))
  assert.equal(document.querySelectorAll('textarea,[contenteditable="true"]').length, 0)
  assert.ok(!button('New entry'))
  assert.ok(button('View trigger conflicts with Books'))
  await actions(f.entry.title)
  const menu = document.querySelector('[role="menu"]')
  assert.equal(menu.querySelectorAll('[role="menuitem"]').length, 1)
  assert.equal(menu.textContent.trim(), copyLabel)
  assert.equal(button(copyLabel).disabled, false)
  await act(async () => menu.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  await actions(f.world.title)
  assert.equal(button('Delete World').disabled, true)
  assert.match(document.body.textContent, /only an empty World can be deleted/)
})

test('copy is disabled with no linked Books and while conflict checking; conflict popup names trigger, entry and Book', async t => {
  const f = await fixture({ linked: 0 })
  const root = await mountWorld(t, f)
  await actions(f.entry.title)
  assert.equal(button(copyLabel).disabled, true)
  assert.match(document.body.textContent, /Connect at least one Book/)
  await act(async () => root.unmount())
  const { book } = await p.createBook(ai.initialAiSettings, 'Conflicting Book')
  await worlds.setBookWorld(book.id, f.world.id)
  const local = await p.createCodexEntry(book.id, 'Local tower', 'Place')
  await (await p.database()).table('entities').update(local.id, { autoIncludeTriggers: [' sky CITY '] })
  worlds.controls.holdConflicts = true
  const next = rootFor(t)
  await act(async () => next.render(h(WorldBuilding, { initialWorldId: f.world.id, onHome() {} })))
  await settle(() => worlds.controls.conflicts.length > 0)
  await actions(f.entry.title)
  assert.equal(button(copyLabel).disabled, true)
  assert.match(document.body.textContent, /Checking linked Books/)
  await act(async () => { worlds.controls.holdConflicts = false; worlds.controls.conflicts.splice(0).forEach(resolve => resolve()) })
  await settle(() => document.body.textContent.includes('Resolve trigger conflicts'))
  assert.equal(button(copyLabel).disabled, true)
  await act(async () => document.querySelector('[role="menu"]').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  await click('View trigger conflicts with Books')
  await settle(() => Boolean(document.querySelector('dialog[open]')))
  assert.match(document.querySelector('dialog').textContent, /sky CITY/)
  assert.match(document.querySelector('dialog').textContent, /Local tower/)
  assert.match(document.querySelector('dialog').textContent, /Conflicting Book/)
})

test('mass copy requires confirmation, copies into hidden Books and removes only the World source', async t => {
  const f = await fixture()
  await worlds.setWorldEntryHidden(f.books[1].id, f.entry.id, true)
  await mountWorld(t, f)
  await actions(f.entry.title); await click(copyLabel)
  assert.ok(await p.getEntity(f.entry.id))
  assert.match(document.querySelector('dialog').textContent, /including Books that hide this entry/)
  const confirmationText = document.querySelector('dialog').textContent
  for (const book of f.books) assert.ok(confirmationText.includes(book.title), `Confirmation names ${book.title}`)
  await click('Cancel')
  assert.ok(await p.getEntity(f.entry.id))
  await actions(f.entry.title); await click(copyLabel)
  await click('Copy to all Books and remove source')
  await settle(() => !document.querySelector('.world-entry'))
  assert.equal(await p.getEntity(f.entry.id), undefined)
  for (const book of f.books) {
    const entries = await worlds.listBookCodexEntries(book.id)
    assert.equal(entries.length, 1)
    assert.equal(entries[0].title, 'Sky city')
    assert.equal(entries[0].content, 'SECRET_BODY_NOT_A_VIEWER')
    assert.equal(entries[0].worldId, undefined)
  }
})

test('a conflict introduced after confirmation is rechecked transactionally without partial copies', async t => {
  const f = await fixture()
  await mountWorld(t, f)
  await actions(f.entry.title); await click(copyLabel)
  // Insert after submission starts, before the real transaction checks conflicts.
  // The mutation still emits normal notifications; do not rely on a stale UI snapshot.
  let introduced = false
  worlds.controls.beforeCopy = async () => {
    const now = Date.now()
    await (await p.database()).table('entities').put({ id: 'late-conflict', type: 'codexEntry', bookId: f.books[1].id, parentId: f.books[1].id, title: 'Late tower', category: 'Place', content: '', autoIncludeTriggers: ['Sky city'], createdAt: now, updatedAt: now })
    introduced = true
  }
  await click('Copy to all Books and remove source')
  await settle(() => document.querySelector('dialog')?.textContent.includes('conflicts with') && worldIdle())
  assert.equal(introduced, true)
  assert.equal(document.querySelectorAll('dialog[open]').length, 1)
  assert.equal(button('Copy to all Books and remove source').disabled, true)
  assert.ok(await p.getEntity(f.entry.id))
  const entriesByBook = await Promise.all(f.books.map(book => p.listEntitiesByBook(book.id)))
  const localEntries = (entities, bookId) => entities.filter(entity => entity.type === 'codexEntry' && entity.bookId === bookId && !entity.worldId)
  assert.equal(localEntries(entriesByBook[0], f.books[0].id).length, 0)
  const secondBookLocals = localEntries(entriesByBook[1], f.books[1].id)
  assert.equal(secondBookLocals.length, 1)
  assert.equal(secondBookLocals[0].id, 'late-conflict')
  for (const entities of entriesByBook) assert.ok(entities.some(entity => entity.id === f.entry.id && entity.worldId === f.world.id), 'The inherited World source remains available')
})

test('World rename and empty deletion are explicit; deletion explains Book disconnection', async t => {
  const f = await fixture({ entry: false })
  await mountWorld(t, f)
  await actions(f.world.title); await click('Rename')
  await setInput('World title', 'New skies'); await click('Save title')
  await settle(() => document.querySelector('.world-detail h2')?.textContent === 'New skies' && !document.querySelector('dialog'))
  assert.equal((await p.getEntity(f.world.id)).title, 'New skies')
  await actions('New skies'); await click('Delete World')
  assert.match(document.querySelector('dialog').textContent, /2 linked Books will be disconnected/)
  assert.match(document.querySelector('dialog').textContent, /World-owned history and media/)
  await click('Delete empty World')
  await settle(() => document.body.textContent.includes('This World is no longer available'))
  assert.equal(await p.getEntity(f.world.id), undefined)
  for (const book of f.books) assert.equal((await p.getEntity(book.id)).worldId, undefined)
})

test('World autotitle uses the global default text profile, previews, regenerates and rejects stale acceptance', async t => {
  const f = await fixture()
  configureGlobalDefault()
  await mountWorld(t, f)
  await actions(f.world.title); await click('Autotitle')
  await settle(() => document.querySelector('.world-title-suggestion strong')?.textContent === 'Fake Test Title')
  assert.equal((await p.getEntity(f.world.id)).title, f.world.title)
  assert.equal(fake.getFakeProviderTrace().at(-1).model, 'fake/test')
  const firstCount = fake.getFakeProviderTrace().length
  await click('Regenerate')
  await settle(() => fake.getFakeProviderTrace().length > firstCount && !button('Use title').disabled)
  await act(async () => { await worlds.renameWorld(f.world.id, 'Concurrent author title') })
  await settle(worldIdle)
  await click('Use title')
  await settle(() => document.querySelector('dialog')?.textContent.includes('This World changed'))
  assert.equal((await p.getEntity(f.world.id)).title, 'Concurrent author title')
  await click('Regenerate')
  await settle(() => !button('Use title').disabled)
  await click('Use title')
  await settle(() => !document.querySelector('dialog') && document.querySelector('.world-detail h2')?.textContent === 'Fake Test Title' && worldIdle())
  assert.equal((await p.getEntity(f.world.id)).title, 'Fake Test Title')
})

test('stopping/cancelling World autotitle aborts generation without saving', async t => {
  const f = await fixture()
  configureGlobalDefault()
  await (await p.database()).table('entities').update(f.entry.id, { content: '[DELAY_MS:1000]slow suggestion' })
  await mountWorld(t, f)
  await actions(f.world.title); await click('Autotitle')
  await settle(() => Boolean(document.querySelector('.world-request-meta')) && Boolean(button('Stop')))
  await click('Stop')
  await settle(() => fake.getFakeProviderTrace().at(-1).outcome === 'aborted')
  assert.equal(button('Use title').disabled, true)
  assert.equal((await p.getEntity(f.world.id)).title, f.world.title)
  await click('Regenerate')
  await settle(() => Boolean(document.querySelector('.world-request-meta')) && Boolean(button('Stop')))
  await click('Cancel')
  await settle(() => !document.querySelector('dialog') && fake.getFakeProviderTrace().at(-1).outcome === 'aborted')
  assert.equal((await p.getEntity(f.world.id)).title, f.world.title)
})

test('autotitle includes World lore only and allows only visible connected World Codex targets in a Book', async () => {
  const f = await fixture()
  const settings = configureGlobalDefault()
  const { book: outsider } = await p.createBook(ai.initialAiSettings, 'Outside Book')
  const foreign = await p.createCodexEntry(outsider.id, 'PRIVATE_OUTSIDE_LORE')
  await p.saveDocumentContent(foreign.id, 'PRIVATE_OUTSIDE_BODY')
  const request = await autotitle.prepareAutotitleRequest(f.world.id, f.world.id, settings)
  assert.equal(request.targetType, 'world')
  assert.equal(request.expectedUpdatedAt, (await p.getEntity(f.world.id)).updatedAt)
  assert.match(request.context, /SECRET_BODY_NOT_A_VIEWER/)
  assert.ok(!request.context.includes('PRIVATE_OUTSIDE'))
  const shared = await autotitle.prepareAutotitleRequest(f.books[0].id, f.entry.id, settings)
  assert.equal(shared.targetType, 'codexEntry')
  assert.match(shared.context, /SECRET_BODY_NOT_A_VIEWER/)
  await assert.rejects(autotitle.prepareAutotitleRequest(outsider.id, f.entry.id, settings), /cannot be autotitled/)
  await worlds.setWorldEntryHidden(f.books[0].id, f.entry.id, true)
  await assert.rejects(autotitle.prepareAutotitleRequest(f.books[0].id, f.entry.id, settings), /cannot be autotitled/)
})

test('library errors can retry and an older held load cannot replace a newer event refresh', async t => {
  const f = await fixture({ entry: false })
  const root = rootFor(t)
  worlds.controls.failLibrary = true
  await act(async () => root.render(h(WorldBuilding, { initialWorldId: f.world.id, onHome() {} })))
  await settle(() => document.body.textContent.includes('World library read failed'))
  worlds.controls.failLibrary = false
  worlds.controls.holdLibrary = true
  await click('Retry')
  await settle(() => worlds.controls.library.length === 1)
  worlds.controls.holdLibrary = false
  await act(async () => { await worlds.renameWorld(f.world.id, 'Newer World snapshot') })
  await settle(() => document.querySelector('.world-detail h2')?.textContent === 'Newer World snapshot')
  await act(async () => worlds.controls.library.splice(0).forEach(resolve => resolve()))
  assert.equal(document.querySelector('.world-detail h2').textContent, 'Newer World snapshot')
  worlds.controls.holdLibrary = true
  await act(async () => window.dispatchEvent(new Event('arc-worlds-changed')))
  await settle(() => worlds.controls.library.length === 1)
  await act(async () => root.unmount())
  await act(async () => worlds.controls.library.splice(0).forEach(resolve => resolve()))
  assert.equal(document.getElementById('root').textContent, '')
})

test('TriggerConflictsDialog exposes an accessible empty result and closes explicitly', async t => {
  let closed = false
  const root = rootFor(t)
  await act(async () => root.render(h(TriggerConflictsDialog, { title: 'World conflicts', conflicts: [], onClose: () => { closed = true } })))
  assert.equal(document.querySelector('dialog').getAttribute('aria-label'), 'World conflicts')
  assert.match(document.querySelector('[role="status"]').textContent, /No trigger conflicts/)
  await click('Close')
  assert.equal(closed, true)
})

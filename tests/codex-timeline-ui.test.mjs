import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after } from 'node:test'
import { transpileSourceTree } from './transpile-source-tree.mjs'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import 'fake-indexeddb/auto'

const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'https://arc.test/', pretendToBeVisual: true })
after(() => dom.window.close())
for (const key of ['window', 'document', 'HTMLElement', 'HTMLDialogElement', 'Element', 'Node', 'MutationObserver', 'Window', 'DOMRect', 'Range', 'sessionStorage', 'localStorage', 'Event', 'CustomEvent']) globalThis[key] = dom.window[key]
dom.window.HTMLElement.prototype.scrollIntoView = function () {}
dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.getComputedStyle = dom.window.getComputedStyle
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { act } = React, h = React.createElement
const directory = mkdtempSync(new URL('../node_modules/.arc-timeline-ui-test-', import.meta.url))
after(() => rmSync(directory, { recursive: true, force: true }))
transpileSourceTree(directory)
const moduleAt = name => import(pathToFileURL(`${directory}/${name}.mjs`))
const p = await moduleAt('data/persistence')
after(async () => (await p.database()).close())
const ai = await moduleAt('shared/ai/ai-settings')
const w = await moduleAt('features/worlds/world-service')
const { metadataValues } = await moduleAt('features/chat/chat-management-schema')
const { default: Timeline } = await moduleAt('features/codex/CodexTimeline')
const service = await moduleAt('features/codex/codex-timeline-service')
const button = text => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text)
async function click(text) { const target = button(text); assert.ok(target, `Missing ${text}`); assert.equal(target.disabled, false); await act(async () => target.click()) }
async function settle(predicate) { for (let i = 0; i < 200 && !predicate(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 10))); assert.ok(predicate(), document.body.textContent) }
async function input(label, value) {
  const target = document.querySelector(`[aria-label="${label}"]`)
  assert.ok(target, `Missing ${label}`)
  const prototype = target.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype
  await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value').set.call(target, value); target.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
}
async function chooseView(value) {
  const select = document.querySelector('select[aria-label="Codex timeline view"]')
  assert.ok(select); assert.equal(select.disabled, false)
  await act(async () => { select.value = value; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
  await settle(() => !select.disabled)
}
async function fixture() {
  const { book } = await p.createBook(ai.initialAiSettings, 'Timeline UI '+crypto.randomUUID())
  const entry = await p.createCodexEntry(book.id, 'Traveler')
  await p.saveDocumentContent(entry.id, 'Baseline body')
  const scene = (await p.listEntitiesByBook(book.id, 'scene'))[0]
  return { book, entry: await p.getEntity(entry.id), scene }
}
async function mount(t, f, onViewChange = () => {}) {
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await act(async () => root.unmount()) })
  const props = { bookId: f.book.id, entry: f.entry, currentSceneId: f.scene.id, onBeforeChange: async () => {}, onRefresh: async () => {}, onViewChange }
  await act(async () => root.render(h(Timeline, props)))
  await settle(() => Boolean(button('New checkpoint')) && !button('New checkpoint').disabled)
  return { root, props }
}
test('checkpoint editor saves an independent state without changing baseline or the current scene', async t => {
  const f = await fixture()
  let alternate = false
  const { props } = await mount(t, f, value => { alternate = value })
  await click('New checkpoint')
  await settle(() => document.querySelector('input[aria-label="Checkpoint label"]') && !document.querySelector('.codex-timeline fieldset').disabled)
  await input('Checkpoint label', 'After arrival')
  await input('Checkpoint body', 'The traveler arrived.')
  await click('Save checkpoint')
  await settle(() => !document.querySelector('textarea[aria-label="Checkpoint body"]') && !document.querySelector('select[aria-label="Codex timeline view"]').disabled)
  const saved = await p.getEntity(f.entry.id)
  assert.equal(saved.content, 'Baseline body'); assert.equal(saved.checkpoints[0].content, 'The traveler arrived.'); assert.equal(saved.checkpoints[0].sceneId, f.scene.id)
  assert.equal(alternate, true)
  assert.equal(props.currentSceneId, f.scene.id)
  await chooseView('baseline')
  await settle(() => alternate === false)
  assert.equal((await p.getEntity(f.entry.id)).checkpoints.length, 1)
})
test('World checkpoint edits save directly to canonical lore while copied checkpoint edits stay Book-local', async t => {
  const f = await fixture(), second = await p.createBook(ai.initialAiSettings, 'Second timeline Book'), world = await w.createWorld('Timeline UI World'), series = await p.createSeries('Timeline order')
  for (const [book, order] of [[f.book, '1'], [second.book, '2']]) {
    await w.setBookWorld(book.id, world.id)
    await p.updateBookMetadata(book.id, { ...metadataValues(await p.getEntity(book.id)), seriesId: series.id, seriesOrder: order })
  }
  const source = await w.moveEntryToWorld(f.book.id, f.entry.id)
  const { root, props } = await mount(t, { ...second, entry: source })
  await click('New checkpoint')
  await settle(() => document.querySelector('select[aria-label="Checkpoint book"]') && !document.querySelector('.codex-timeline fieldset').disabled)
  const bookSelect = document.querySelector('select[aria-label="Checkpoint book"]')
  assert.deepEqual([...bookSelect.options].map(option => option.value).sort(), [f.book.id, second.book.id].sort())
  await input('Checkpoint label', 'Shared arrival')
  await input('Checkpoint body', 'Canonical checkpoint body')
  await click('Save checkpoint')
  await settle(() => Boolean(button('Edit checkpoint')) && !button('Edit checkpoint').disabled)
  const canonical = await p.getEntity(source.id)
  assert.equal(canonical.bookId, world.id); assert.equal(canonical.content, 'Baseline body')
  assert.equal(canonical.checkpoints[0].anchorBookId, second.book.id); assert.equal(canonical.checkpoints[0].sceneId, second.scene.id)
  assert.equal((await p.listEntitiesByBook(f.book.id, 'codexEntry')).find(entry => entry.id === source.id).checkpoints[0].content, 'Canonical checkpoint body')
  assert.equal((await service.resolveEntryAt(source.id, { bookId: second.book.id, sceneId: second.scene.id })).content, 'Canonical checkpoint body')
  assert.equal(props.currentSceneId, second.scene.id)
  const copy = await w.copyWorldEntryToBook(second.book.id, source.id)
  assert.notEqual(copy.checkpoints[0].id, canonical.checkpoints[0].id)
  const copyProps = { ...props, entry: copy }
  await act(async () => root.render(h(Timeline, { ...copyProps, key: copy.id })))
  await settle(() => Boolean(button('New checkpoint')) && !button('New checkpoint').disabled)
  await chooseView(copy.checkpoints[0].id)
  await settle(() => Boolean(button('Edit checkpoint')) && !button('Edit checkpoint').disabled)
  await click('Edit checkpoint')
  await settle(() => document.querySelector('textarea[aria-label="Checkpoint body"]'))
  assert.deepEqual([...document.querySelector('select[aria-label="Checkpoint book"]').options].map(option => option.value), [second.book.id], 'Local checkpoints cannot use another Series Book')
  await input('Checkpoint body', 'Independent checkpoint body')
  await click('Save checkpoint')
  await settle(() => !document.querySelector('textarea[aria-label="Checkpoint body"]') && !document.querySelector('select[aria-label="Codex timeline view"]').disabled)
  assert.equal((await p.getEntity(copy.id)).checkpoints[0].content, 'Independent checkpoint body')
  assert.equal((await p.getEntity(source.id)).checkpoints[0].content, 'Canonical checkpoint body')
  assert.equal((await p.getEntity(copy.id)).content, 'Baseline body')
  assert.equal((await p.getEntity(copy.id)).worldId, undefined)
  assert.equal(copyProps.currentSceneId, second.scene.id)
})

import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildSync } from 'esbuild'
import { JSDOM } from 'jsdom'
import 'fake-indexeddb/auto'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://arc.test/', pretendToBeVisual: true })
after(() => dom.window.close())
const directory = mkdtempSync(new URL('../node_modules/.workspace-autocomplete-ui-test-', import.meta.url))
after(() => rmSync(directory, { recursive: true, force: true }))
let persistence
after(async () => { if (persistence) (await persistence.database()).close() })
for (const key of ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLDialogElement', 'Element', 'Node', 'Text', 'MutationObserver', 'Window', 'DOMRect', 'Range', 'Event', 'CustomEvent']) globalThis[key] = dom.window[key]
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
dom.window.Range.prototype.getClientRects = () => []
dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect()
dom.window.HTMLElement.prototype.scrollIntoView = function () {}
// Only browser geometry is supplied; Workspace, its editor, persistence and AI
// execution remain real. No generation, navigation or profile modules are mocked.
globalThis.ResizeObserver = class {
  constructor(callback) { this.callback = callback }
  observe() { this.callback() }
  disconnect() {}
}

buildSync({
  stdin: {
    contents: `
      export { default as Workspace } from './src/app/Workspace.tsx';
      export * as persistence from './src/data/persistence.ts';
      export * as ai from './src/shared/ai/ai-settings.ts';
      export * as profiles from './src/features/settings/settings-profiles.ts';
      export * as fake from './src/shared/ai/fake-provider.ts';
    `,
    resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'tsx',
  },
  bundle: true, packages: 'external', platform: 'node', format: 'esm', jsx: 'automatic',
  outfile: `${directory}/workspace.mjs`, loader: { '.css': 'empty' }, logLevel: 'silent',
})
const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const { EditorView } = await import('@codemirror/view')
const { Transaction } = await import('@codemirror/state')
const { undoDepth } = await import('@codemirror/commands')
const services = await import(pathToFileURL(`${directory}/workspace.mjs`))
persistence = services.persistence
const { Workspace, ai, profiles, fake } = services
const initial = 'The workspace door opened.'
const continuation = ' and the story continued.'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// One persisted book and its explicitly chosen shared Text profile keep setup
// small. Defaults stay opted out, so this exercises Workspace's book resolution.
ai.saveAiSettings({ ...ai.copyAiSettings(ai.initialAiSettings), provider: 'fake', apiKey: '', baseUrl: '', mainModel: 'fake/test', autocomplete: ai.defaultAutocompleteSettings() })
const fixture = await persistence.createBook(ai.loadAiSettings(), 'Workspace autocomplete fixture')
const text = profiles.createSettingsProfile('text', 'Workspace autocomplete Text')
profiles.saveSettingsProfile({ ...text, settings: { ...text.settings, autocomplete: { enabled: true, model: 'fake/test', delayMs: 100, length: 'phrase' } } })
const selections = await persistence.getBookProfileSelections(fixture.book.id)
selections.text = text.id
await persistence.saveBookProfileSelections(fixture.book.id, selections)
const savedStorage = Array.from({ length: localStorage.length }, (_, index) => {
  const key = localStorage.key(index)
  return [key, localStorage.getItem(key)]
})

beforeEach(async t => {
  localStorage.clear()
  for (const [key, value] of savedStorage) localStorage.setItem(key, value)
  sessionStorage.clear()
  await persistence.saveDocumentContent(fixture.scene.id, initial)
  fake.clearFakeProviderTrace()
  t.after(() => fake.clearFakeProviderTrace())
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Workspace autocomplete tests must never use a network provider') })
  t.after(() => assert.equal(network.mock.callCount(), 0, 'No network or model catalog requests'))
})

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 200; attempt++) {
    let ready
    await act(async () => { ready = Boolean(await predicate()); if (!ready) await sleep(10) })
    if (ready) return
  }
  assert.fail(message)
}
async function idle(ms = 240) { await act(async () => { await sleep(ms) }) }
async function click(element) {
  assert.ok(element, 'Requested Workspace control exists')
  assert.equal(element.disabled, false, 'Requested Workspace control is enabled')
  await act(async () => element.click())
}
async function quickAction(ui, label) {
  await click(ui.host.querySelector('.workspace-composer button[aria-label="Open Generate actions"]'))
  await waitFor(() => ui.action(label), `Workspace exposes the ${label} quick action`)
  await click(ui.action(label))
  await waitFor(() => !ui.host.querySelector('.generation-action-popover'), 'Quick action feedback closes the menu')
}
async function savedContent(value) {
  await waitFor(async () => (await persistence.getEntity(fixture.scene.id)).content === value, 'Workspace autosave persists the exact editor prose')
  assert.equal((await persistence.getEntity(fixture.scene.id)).content, value)
}

async function mount(t, collapsed = false) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  t.after(async () => { try { await act(async () => root.unmount()) } finally { host.remove() } })
  await act(async () => root.render(React.createElement(Workspace)))
  await waitFor(() => host.querySelector('button[aria-label="New book"]')?.disabled === false && [...host.querySelectorAll('.library-book')].some(button => button.textContent.includes(fixture.book.title)), 'Workspace loads the persisted library')
  await click([...host.querySelectorAll('.library-book')].find(button => button.textContent.includes(fixture.book.title)))
  const ui = {
    host,
    get view() { const element = host.querySelector('.story-editor .cm-editor'); return element ? EditorView.findFromDOM(element) : undefined },
    get composer() { return host.querySelector('.workspace-composer') },
    get button() { return host.querySelector('.workspace-composer .autocomplete-accept') },
    get ghost() { return host.querySelector('.story-editor .cm-autocomplete-ghost') },
    action(label) { return [...host.querySelectorAll('.workspace-composer .generation-action-row')].find(button => button.querySelector('.generation-action-label')?.textContent === label) },
  }
  await waitFor(() => ui.view?.state.doc.toString() === initial && ui.composer, 'The real scene editor and GenerateControl mount')
  assert.equal(ui.composer.classList.contains('is-collapsed'), false)
  if (collapsed) await quickAction(ui, 'Hide instruction drawer')
  assert.equal(ui.composer.classList.contains('is-collapsed'), collapsed)
  assert.equal(ai.loadAiSettings().autocomplete.enabled, false)
  assert.equal((await persistence.getBookProfileSelections(fixture.book.id)).text, text.id)
  await act(async () => { ui.view.dispatch({ selection: { anchor: ui.view.state.doc.length } }); ui.view.focus() })
  return ui
}
async function suggest(ui) {
  await act(async () => {
    const view = ui.view, from = view.state.doc.length
    view.dispatch({ changes: { from, insert: ' Typed.' }, selection: { anchor: from + 7 }, annotations: Transaction.userEvent.of('input.type') })
  })
  await waitFor(() => ui.ghost && ui.button, 'Actual Workspace displays Fake ghost and accept control')
  assert.equal(ui.ghost.textContent, continuation)
  assert.equal(ui.button.getAttribute('aria-keyshortcuts'), 'Tab')
  assert.equal(fake.getFakeProviderTrace().length, 1)
  assert.equal(fake.getFakeProviderTrace()[0].task, 'autocomplete')
  assert.equal(fake.getFakeProviderTrace()[0].model, 'fake/test')
  assert.equal(fake.getFakeProviderTrace()[0].outcome, 'complete')
  assert.equal(ui.view.state.doc.toString(), initial + ' Typed.')
  assert.equal(ui.host.querySelectorAll('.arc-toast[role="alert"]').length, 0)
}
function noSuggestion(ui) {
  assert.ok(ui.ghost === null, 'Workspace editor ghost is cleared')
  assert.ok(ui.button === null, 'Workspace accept control is removed')
}

for (const collapsed of [false, true]) {
  for (const method of ['click', 'Tab']) {
    test(`actual ${collapsed ? 'collapsed' : 'expanded'} Workspace accepts with ${method} and Undo removes only the continuation`, async t => {
      const ui = await mount(t, collapsed)
      await idle()
      assert.equal(fake.getFakeProviderTrace().length, 0, 'Opening/focusing a scene does not request autocomplete')
      await suggest(ui)
      const before = ui.view.state.doc.toString(), depth = undoDepth(ui.view.state)
      await savedContent(before)
      assert.equal(ui.ghost.textContent, continuation, 'Autosave does not persist or invalidate the ghost')
      if (method === 'click') {
        const button = ui.button
        const pointer = new dom.window.Event('pointerdown', { bubbles: true, cancelable: true })
        await act(async () => button.dispatchEvent(pointer))
        assert.equal(pointer.defaultPrevented, true, 'Actual accept button prevents pointer blur')
        assert.ok(document.activeElement === ui.view.contentDOM, 'Pointerdown keeps editor focus')
        // Exercise the real GenerateControl's keyboard-focus blur exception too.
        await act(async () => button.focus())
        assert.ok(ui.ghost !== null, 'Focusing the accept button preserves the ghost')
        await click(button)
      } else {
        const event = new dom.window.KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', keyCode: 9, bubbles: true, cancelable: true })
        await act(async () => ui.view.contentDOM.dispatchEvent(event))
        assert.equal(event.defaultPrevented, true, 'The real editor routes Tab through Workspace acceptance')
      }
      noSuggestion(ui)
      assert.equal(ui.view.state.doc.toString(), before + continuation)
      assert.equal(undoDepth(ui.view.state), depth + 1)
      assert.ok(document.activeElement === ui.view.contentDOM, 'Acceptance returns focus to the real editor')
      await savedContent(before + continuation)
      assert.equal(fake.getFakeProviderTrace().length, 1, 'Accepted prose does not trigger another request')
      await quickAction(ui, 'Undo')
      assert.equal(ui.view.state.doc.toString(), before, 'Workspace Undo removes the complete continuation, preserving typing')
      assert.equal(undoDepth(ui.view.state), depth)
      noSuggestion(ui)
      await savedContent(before)
      assert.equal(fake.getFakeProviderTrace().length, 1, 'Undo and autosave do not requery')
      assert.equal(ui.composer.classList.contains('is-collapsed'), collapsed)
    })
  }
}

for (const action of ['Escape', 'unrelated control']) {
  test(`actual Workspace cancels when the focused accept button receives ${action}`, async t => {
    const ui = await mount(t)
    await suggest(ui)
    const before = ui.view.state.doc.toString(), depth = undoDepth(ui.view.state), button = ui.button
    await act(async () => button.focus())
    assert.ok(document.activeElement === button, 'Actual accept button is focused')
    assert.ok(ui.ghost !== null, 'Editor blur to accept button is allowed')
    if (action === 'Escape') {
      const event = new dom.window.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true })
      await act(async () => button.dispatchEvent(event))
      assert.equal(event.defaultPrevented, true)
    } else await act(async () => ui.composer.querySelector('button[aria-label="Open Generate actions"]').focus())
    noSuggestion(ui)
    assert.equal(ui.view.state.doc.toString(), before)
    assert.equal(undoDepth(ui.view.state), depth)
    await savedContent(before)
    assert.equal(fake.getFakeProviderTrace().length, 1)
    assert.equal(ui.host.querySelectorAll('.arc-toast[role="alert"]').length, 0)
  })
}

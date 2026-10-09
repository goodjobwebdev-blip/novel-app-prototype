import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildSync } from 'esbuild'
import { JSDOM } from 'jsdom'
import 'fake-indexeddb/auto'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://arc.test/', pretendToBeVisual: true })
after(() => dom.window.close())
const directory = mkdtempSync(new URL('../node_modules/.scene-autocomplete-ui-test-', import.meta.url))
after(() => rmSync(directory, { recursive: true, force: true }))
let persistence
// Install cleanup before imports or fixture creation can open the database.
after(async () => { if (persistence) (await persistence.database()).close() })
for (const key of ['window', 'document', 'localStorage', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'Window', 'DOMRect', 'Range', 'Event', 'CustomEvent', 'StorageEvent']) globalThis[key] = dom.window[key]
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
dom.window.Range.prototype.getClientRects = () => []
dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect()

// One bundle keeps persistence, profile storage and Fake traces shared with the hook.
// CodeMirror stays external so the harness dispatches into the editor's real state.
buildSync({
  stdin: {
    contents: `
      export { useSceneAutocomplete } from './src/features/writing/useSceneAutocomplete.ts';
      export { default as MarkdownEditor } from './src/features/editor/MarkdownEditor.tsx';
      export * as persistence from './src/data/persistence.ts';
      export * as ai from './src/shared/ai/ai-settings.ts';
      export * as profiles from './src/features/settings/settings-profiles.ts';
      export * as fake from './src/shared/ai/fake-provider.ts';
    `,
    resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'tsx',
  },
  bundle: true, packages: 'external', platform: 'node', format: 'esm', jsx: 'automatic',
  outfile: `${directory}/scene-autocomplete.mjs`, loader: { '.css': 'empty' }, logLevel: 'silent',
})
const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const { EditorView } = await import('@codemirror/view')
const { Transaction } = await import('@codemirror/state')
const { undoDepth } = await import('@codemirror/commands')
const services = await import(pathToFileURL(`${directory}/scene-autocomplete.mjs`))
persistence = services.persistence
const { useSceneAutocomplete, MarkdownEditor, ai, profiles, fake } = services
const h = React.createElement
const continuation = ' and the story continued.'
const configured = { enabled: true, model: 'fake/test', delayMs: 100, length: 'phrase' }
const writing = { pov: 'third', tense: 'past', style: 'spare', language: 'English' }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const trace = () => fake.getFakeProviderTrace()
const profileById = id => profiles.loadSettingsProfiles().profiles.find(profile => profile.id === id)

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 200 && !predicate(); attempt++) await act(async () => { await sleep(10) })
  assert.ok(predicate(), message)
}
async function idle(ms = 240) { await act(async () => { await sleep(ms) }) }
function storageChanged(key, newValue = key === null ? null : localStorage.getItem(key)) {
  window.dispatchEvent(new dom.window.StorageEvent('storage', { key, newValue, storageArea: localStorage, url: 'https://arc.test/other-tab' }))
}
async function saveBookSelectionsFromOtherTab(t, bookId, selections) {
  const dispatch = window.dispatchEvent.bind(window)
  let suppressed = 0
  const mocked = t.mock.method(window, 'dispatchEvent', event => {
    if (event.type === profiles.SETTINGS_PROFILES_EVENT) { suppressed += 1; return true }
    return dispatch(event)
  })
  try { await persistence.saveBookProfileSelections(bookId, selections) }
  finally { mocked.mock.restore() }
  assert.equal(suppressed, 1, 'Only the saving tab would receive the custom profile event')
  const key = profiles.BOOK_PROFILE_SELECTIONS_STORAGE_KEY
  assert.equal(typeof key, 'string')
  const newValue = localStorage.getItem(key)
  assert.equal(JSON.parse(newValue).bookId, bookId, 'Real selection save writes the cross-tab book signal')
  assert.equal((await persistence.getBookProfileSelections(bookId)).text, selections.text)
  return { key, newValue }
}
function changedGlobalConnection() {
  return { ...ai.loadAiSettings(), provider: 'litellm', apiKey: 'test-only-litellm-key', baseUrl: 'https://connection.invalid/v1' }
}
function assertChangedGlobalConnection() {
  const saved = ai.loadAiSettings()
  assert.equal(saved.provider, 'litellm')
  assert.equal(saved.apiKey, 'test-only-litellm-key')
  assert.equal(saved.baseUrl, 'https://connection.invalid/v1')
}
function storeGlobalConnection() {
  // Simulate another tab without saveAiSettings emitting a same-tab event here.
  // Fake normalizes credentials/URL to empty, so change the provider as well.
  const { prompts: _legacyPromptMirror, ...persisted } = ai.copyAiSettings(changedGlobalConnection())
  localStorage.setItem(ai.AI_SETTINGS_STORAGE_KEY, JSON.stringify(persisted))
  assertChangedGlobalConnection()
}
function saveAutocomplete(profileId, patch) {
  const profile = profileById(profileId)
  return profiles.saveSettingsProfile({ ...profile, settings: { ...profile.settings, autocomplete: { ...profile.settings.autocomplete, ...patch } } })
}
function storeAutocomplete(profileId, patch) {
  // A different tab writes storage without firing this tab's custom profile event.
  const library = profiles.loadSettingsProfiles()
  const profile = library.profiles.find(profile => profile.id === profileId)
  profile.settings.autocomplete = { ...profile.settings.autocomplete, ...patch }
  localStorage.setItem(profiles.SETTINGS_PROFILES_STORAGE_KEY, JSON.stringify(library))
}

async function fixture(t, { autocomplete = configured, mainModel = '', initial = 'The door opened.' } = {}) {
  localStorage.clear()
  fake.clearFakeProviderTrace()
  t.after(() => fake.clearFakeProviderTrace())
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Autocomplete UI tests must stay on the local Fake provider') })
  t.after(() => assert.equal(network.mock.callCount(), 0, 'No network or model-catalog requests'))
  // Global/default autocomplete stays off; only the explicitly linked shared Text
  // profile opts in. Text profiles do not own provider connections.
  ai.saveAiSettings({ ...ai.copyAiSettings(ai.initialAiSettings), provider: 'fake', apiKey: '', baseUrl: '', mainModel: 'fake/test', supportModel: 'fake/test', autocomplete: ai.defaultAutocompleteSettings() })
  const { book, chapter, scene } = await persistence.createBook(ai.loadAiSettings(), 'Autocomplete UI')
  await persistence.saveDocumentContent(scene.id, initial)
  const otherScene = await persistence.createStructuralEntity('scene', book.id, chapter.id, 'Other scene')
  await persistence.saveDocumentContent(otherScene.id, initial)
  const text = profiles.createSettingsProfile('text', 'Shared autocomplete Text')
  profiles.saveSettingsProfile({ ...text, settings: { ...text.settings, mainModel, autocomplete: { ...autocomplete } } })
  const selections = await persistence.getBookProfileSelections(book.id)
  selections.text = text.id
  await persistence.saveBookProfileSelections(book.id, selections)
  const alternate = profiles.createSettingsProfile('text', 'Alternate Text', text.id)
  saveAutocomplete(alternate.id, { enabled: false })
  fake.clearFakeProviderTrace()
  return { book, scene, otherScene, text, alternate, selections, initial }
}

async function mount(t, f, overrides = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  t.after(async () => {
    try { await unmount() }
    finally { try { await flushSaves() } finally { host.remove() } }
  })
  const editor = React.createRef()
  const observed = { api: null, inputs: [], pendingInputs: [], changes: [], errors: 0, saveErrors: [], accepts: [] }
  let saves = Promise.resolve(), mounted = true
  let options = { bookId: f.book.id, sceneId: f.scene.id, enabled: true, busy: false, writing, ...overrides }

  function Harness(props) {
    const [value, setValue] = React.useState(f.initial)
    const autocomplete = useSceneAutocomplete({ ...props, editor, onError: () => { observed.errors += 1 } })
    observed.api = autocomplete
    const accept = () => {
      const result = autocomplete.accept()
      observed.accepts.push(result)
      return result
    }
    return h(React.Fragment, null,
      h(MarkdownEditor, {
        key: props.sceneId, ref: editor, bookId: props.bookId, historyKey: props.sceneId, value,
        onChange: next => {
          setValue(next)
          observed.changes.push(next)
          const sceneId = props.sceneId
          saves = saves.then(() => persistence.saveDocumentContent(sceneId, next)).catch(error => { observed.saveErrors.push(error) })
        },
        onAutocompleteInput: snapshot => {
          observed.inputs.push(snapshot)
          observed.pendingInputs.push(autocomplete.onInput(snapshot))
        },
        onAutocompleteInvalidate: autocomplete.cancel,
        onAutocompleteAccept: accept,
      }),
      // Mirror Workspace's accept affordance without mounting the whole workspace.
      autocomplete.suggestion && h('button', {
        className: 'autocomplete-accept', type: 'button', 'aria-keyshortcuts': 'Tab',
        onPointerDown: event => event.preventDefault(),
        onKeyDown: event => { if (event.key === 'Escape') { event.preventDefault(); autocomplete.cancel() } },
        onBlur: event => { if (!(event.relatedTarget instanceof Element && event.relatedTarget.closest('.cm-content, .autocomplete-accept'))) autocomplete.cancel() },
        onClick: accept,
      }, 'Accept continuation · Tab'),
      h('button', { className: 'other', type: 'button' }, 'Other action'),
    )
  }
  async function flushSaves() {
    await saves
    assert.equal(observed.saveErrors.length, 0, 'Harness document saves succeeded')
  }
  async function unmount() {
    if (!mounted) return
    mounted = false
    await act(async () => root.unmount())
  }
  async function update(patch) {
    options = { ...options, ...patch }
    await act(async () => root.render(h(Harness, options)))
  }
  await act(async () => root.render(h(Harness, options)))
  await act(async () => editor.current.placeCursor(f.initial.length))
  return {
    host, editor, observed, update, unmount, flushSaves,
    get view() { return EditorView.findFromDOM(host.querySelector('.cm-editor')) },
    get button() { return host.querySelector('.autocomplete-accept') },
    get ghost() { return host.querySelector('.cm-autocomplete-ghost') },
    document() { return editor.current.captureSelection().document },
  }
}

async function type(ui, text = ' Typed.', userEvent = 'input.type') {
  await act(async () => {
    const view = ui.view, from = view.state.doc.length
    view.dispatch({ changes: { from, insert: text }, selection: { anchor: from + text.length }, annotations: Transaction.userEvent.of(userEvent) })
    await Promise.all(ui.observed.pendingInputs)
  })
  await ui.flushSaves()
}
async function key(ui, value, shiftKey = false) {
  const event = new dom.window.KeyboardEvent('keydown', { key: value, code: value, keyCode: value === 'Tab' ? 9 : 27, shiftKey, bubbles: true, cancelable: true })
  await act(async () => { ui.view.contentDOM.dispatchEvent(event) })
  return event.defaultPrevented
}
async function ready(ui, count = 1) {
  await waitFor(() => Boolean(ui.observed.api.suggestion && ui.ghost && ui.button), 'Fake completion should produce both ghost and accept control')
  assert.equal(trace().length, count)
  assert.equal(trace().at(-1).outcome, 'complete')
  assert.equal(ui.observed.errors, 0)
}
function empty(ui) {
  assert.ok(ui.observed.api.suggestion === null, 'Hook suggestion cleared')
  assert.ok(ui.ghost === null, 'Editor ghost cleared')
  assert.ok(ui.button === null, 'Accept button removed')
}
async function acceptClick(ui, focusButton = false) {
  const button = ui.button
  assert.ok(button, 'Accept button exists')
  const pointer = new dom.window.Event('pointerdown', { bubbles: true, cancelable: true })
  await act(async () => { button.dispatchEvent(pointer) })
  assert.equal(pointer.defaultPrevented, true, 'Pointer acceptance must not blur the editor')
  assert.ok(document.activeElement === ui.view.contentDOM, 'Pointerdown preserves editor focus')
  if (focusButton) {
    await act(async () => button.focus())
    assert.ok(document.activeElement === button, 'Keyboard users can focus the accept button')
    assert.ok(ui.ghost !== null, 'Blur to the accept button preserves the ghost')
    assert.ok(ui.observed.api.suggestion !== null, 'Blur to the accept button preserves hook readiness')
  }
  await act(async () => button.click())
  assert.equal(ui.observed.accepts.at(-1), true)
  assert.ok(document.activeElement === ui.view.contentDOM, 'Acceptance refocuses the editor')
  await ui.flushSaves()
}

for (const [name, autocomplete] of [
  ['explicitly off', { ...configured, enabled: false }],
  ['enabled but no autocomplete model', { ...configured, model: '' }],
]) {
  test(`${name}: manual input never falls back to Main or Support`, async t => {
    const f = await fixture(t, { autocomplete, mainModel: 'fake/test' })
    const ui = await mount(t, f)
    await type(ui)
    assert.equal(ui.observed.inputs.length, 1)
    await idle()
    assert.equal(trace().length, 0)
    empty(ui)
    assert.equal(ui.observed.errors, 0)
  })
}

for (const flag of ['enabled', 'busy']) {
  test(`${flag} scope guard prevents calls and does not query merely on resuming`, async t => {
    const f = await fixture(t)
    const ui = await mount(t, f, { [flag]: flag === 'busy' })
    await type(ui)
    await idle()
    empty(ui)
    assert.equal(trace().length, 0)
    await ui.update({ [flag]: flag === 'enabled' })
    await idle()
    assert.equal(trace().length, 0, 'Resuming alone is not manual input')
    await type(ui, ' Resumed.')
    await ready(ui)
  })
}

test('persisted shared Text profile allows autocomplete without Main; Fake ghost never enters prose, saves or history', async t => {
  const f = await fixture(t)
  const effective = await persistence.getBookAiSettings(f.book.id, [])
  assert.equal(effective.mainModel, '')
  assert.equal(effective.autocomplete.delayMs, 100)
  assert.equal(effective.autocomplete.model, 'fake/test')
  assert.equal(ai.loadAiSettings().autocomplete.enabled, false)
  const ui = await mount(t, f)
  await idle()
  assert.equal(trace().length, 0, 'Mount/focus alone does not request a continuation')
  await type(ui)
  const before = ui.document(), depth = undoDepth(ui.view.state), saves = ui.observed.changes.length
  await ready(ui)
  assert.equal(ui.ghost.textContent, continuation)
  assert.equal(ui.ghost.getAttribute('aria-hidden'), 'true')
  assert.equal(ui.ghost.getAttribute('contenteditable'), 'false')
  assert.equal(ui.button.getAttribute('aria-keyshortcuts'), 'Tab')
  assert.equal(ui.document(), before)
  assert.equal(ui.editor.current.captureGenerationContext().sceneText, before)
  assert.equal(ui.view.state.doc.toString(), before)
  assert.equal((await persistence.getEntity(f.scene.id)).content, before)
  assert.equal(ui.observed.changes.length, saves)
  assert.equal(undoDepth(ui.view.state), depth)
  assert.equal(trace()[0].task, 'autocomplete')
  assert.equal(trace()[0].model, 'fake/test')
  assert.equal(trace()[0].maxTokens, 64)
  assert.equal(trace()[0].thinking, false)
  const payload = JSON.parse(trace()[0].messages.find(message => message.role === 'user').content)
  assert.equal(payload.manuscript, before)
  for (const field of ['pov', 'tense', 'style', 'language']) assert.equal(payload.writing[field], writing[field])
})

for (const mode of ['click', 'focused-button click', 'Tab']) {
  test(`${mode} accepts the same continuation as one isolated Undo step, without self-triggering requests`, async t => {
    const f = await fixture(t)
    const ui = await mount(t, f)
    assert.equal(await key(ui, 'Tab'), false, 'Tab without a suggestion is untouched')
    await type(ui)
    const before = ui.document(), inputs = ui.observed.inputs.length, depth = undoDepth(ui.view.state)
    await ready(ui)
    assert.equal(await key(ui, 'Tab', true), false, 'Shift-Tab is not acceptance')
    assert.equal(ui.observed.accepts.length, 0)
    if (mode === 'Tab') {
      assert.equal(await key(ui, 'Tab'), true)
      assert.equal(ui.observed.accepts.at(-1), true)
      await ui.flushSaves()
    } else await acceptClick(ui, mode === 'focused-button click')
    empty(ui)
    assert.equal(ui.document(), before + continuation)
    assert.equal((await persistence.getEntity(f.scene.id)).content, before + continuation)
    assert.equal(ui.view.state.selection.main.head, (before + continuation).length)
    assert.equal(undoDepth(ui.view.state), depth + 1)
    assert.equal(ui.observed.inputs.length, inputs)
    await idle()
    assert.equal(trace().length, 1, 'Accepted text must not schedule another completion')
    await act(async () => assert.equal(ui.editor.current.undo(), true))
    assert.equal(ui.document(), before, 'One Undo removes the whole acceptance, not manual input')
    await act(async () => assert.equal(ui.editor.current.undo(), true))
    assert.equal(ui.document(), f.initial)
    await act(async () => { assert.equal(ui.editor.current.redo(), true); assert.equal(ui.editor.current.redo(), true) })
    assert.equal(ui.document(), before + continuation)
    assert.equal(ui.observed.inputs.length, inputs)
    await idle()
    assert.equal(trace().length, 1, 'Undo/Redo do not requery')
    await type(ui, ' More.')
    await ready(ui, 2)
    await act(async () => assert.equal(ui.editor.current.undo(), true))
    empty(ui)
    assert.equal(ui.document(), before + continuation, 'Later manual typing is separate from acceptance')
    await act(async () => assert.equal(ui.editor.current.undo(), true))
    assert.equal(ui.document(), before)
  })
}

test('new manual typing cancels the visible suggestion and queries only the new snapshot', async t => {
  const f = await fixture(t), ui = await mount(t, f)
  await type(ui)
  await ready(ui)
  const old = ui.observed.api.suggestion.snapshot
  await type(ui, ' New.')
  empty(ui)
  assert.equal(ui.editor.current.isAutocompleteSnapshotCurrent(old, false), false)
  await ready(ui, 2)
  assert.equal(ui.observed.api.suggestion.snapshot.document, ui.document())
  assert.equal(JSON.parse(trace().at(-1).messages.find(message => message.role === 'user').content).manuscript, ui.document())
})

for (const action of ['unrelated control', 'Escape', 'back to editor']) {
  test(`focused accept button -> ${action} handles cancellation without inserting text`, async t => {
    const f = await fixture(t), ui = await mount(t, f)
    await type(ui)
    await ready(ui)
    const before = ui.document(), changes = ui.observed.changes.length, button = ui.button
    await act(async () => button.focus())
    assert.ok(document.activeElement === button, 'Accept button is focused')
    assert.ok(ui.observed.api.suggestion !== null, 'Editor blur to the accept button preserves readiness')
    if (action === 'Escape') {
      const event = new dom.window.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true })
      await act(async () => button.dispatchEvent(event))
      assert.equal(event.defaultPrevented, true, 'Accept-button Escape is handled')
    } else await act(async () => (action === 'back to editor' ? ui.view.contentDOM : ui.host.querySelector('.other')).focus())
    if (action === 'back to editor') {
      assert.ok(ui.observed.api.suggestion !== null, 'Returning to the editor keeps the suggestion')
      assert.equal(ui.ghost.textContent, continuation)
      assert.ok(document.activeElement === ui.view.contentDOM, 'Editor has focus again')
    } else empty(ui)
    assert.equal(ui.document(), before)
    assert.equal(ui.observed.changes.length, changes)
    assert.equal(ui.observed.accepts.length, 0)
    await idle()
    assert.equal(trace().length, 1, 'Focus changes and Escape do not requery')
    assert.equal(ui.observed.errors, 0)
  })
}

test('serialized suggestion snapshots retain their epoch and stay stale after moving away and returning to EOF', async t => {
  const f = await fixture(t), ui = await mount(t, f)
  await type(ui)
  await ready(ui)
  const clone = JSON.parse(JSON.stringify(ui.observed.api.suggestion.snapshot))
  assert.equal(typeof clone.autocompleteEpoch, 'number')
  assert.equal(ui.editor.current.isAutocompleteSnapshotCurrent(clone), true, 'Clones retain current snapshot identity')
  const before = ui.document()
  await act(async () => ui.view.dispatch({ selection: { anchor: 0 } }))
  await act(async () => ui.editor.current.placeCursor(before.length))
  empty(ui)
  assert.equal(ui.document(), clone.document)
  assert.equal(ui.editor.current.captureAutocompleteSnapshot().revision, clone.revision, 'No document edit is needed to invalidate an epoch')
  assert.equal(ui.editor.current.isAutocompleteSnapshotCurrent(clone, false), false)
  await act(async () => {
    assert.equal(ui.editor.current.setAutocompleteSuggestion(clone, continuation), false)
    assert.equal(ui.editor.current.acceptAutocompleteSuggestion(clone, continuation), false)
  })
  assert.equal(ui.document(), before)
  await idle()
  assert.equal(trace().length, 1)
})

const invalidations = [
  ['explicit cancel', async ui => { await act(async () => ui.observed.api.cancel()) }],
  ['cursor movement', async ui => { await act(async () => ui.view.dispatch({ selection: { anchor: 0 } })) }],
  ['Escape', async ui => { await key(ui, 'Escape') }],
  ['busy switch', async ui => { await ui.update({ busy: true }) }],
  ['scene switch', async (ui, f) => { await ui.update({ sceneId: f.otherScene.id }) }],
  ['writing settings change', async ui => { await ui.update({ writing: { ...writing, language: 'French', tense: 'present' } }) }],
  ['disabled scope', async ui => { await ui.update({ enabled: false }) }],
  ['shared Text profile save', async (ui, f) => { await act(async () => { saveAutocomplete(f.text.id, { length: 'sentence' }) }) }],
  ['book Text profile selection', async (ui, f) => { await act(async () => { await persistence.saveBookProfileSelections(f.book.id, { ...f.selections, text: f.alternate.id }) }) }],
  ['cross-tab book Text profile selection', async (ui, f, t) => {
    const wasReady = ui.observed.api.suggestion !== null
    await act(async () => {
      const signal = await saveBookSelectionsFromOtherTab(t, f.book.id, { ...f.selections, text: f.alternate.id })
      assert.equal(ui.observed.api.suggestion !== null, wasReady, 'Suppressed same-tab event cannot mask storage invalidation')
      storageChanged(signal.key, signal.newValue)
    })
  }],
  ['same-tab global connection save', async () => {
    assert.equal(typeof ai.AI_SETTINGS_EVENT, 'string', 'AI settings export their same-tab change event')
    let notifications = 0
    const notified = () => { notifications += 1 }
    window.addEventListener(ai.AI_SETTINGS_EVENT, notified)
    try {
      await act(async () => { ai.saveAiSettings(changedGlobalConnection()) })
    } finally { window.removeEventListener(ai.AI_SETTINGS_EVENT, notified) }
    assert.equal(notifications, 1, 'saveAiSettings emits AI_SETTINGS_EVENT without a synthetic profile/storage event')
    assertChangedGlobalConnection()
  }],
  ['cross-tab global connection storage', async () => {
    await act(async () => { storeGlobalConnection(); storageChanged(ai.AI_SETTINGS_STORAGE_KEY) })
  }],
  ['cross-tab Text profile storage', async (ui, f) => {
    await act(async () => { storeAutocomplete(f.text.id, { length: 'sentence' }); storageChanged(profiles.SETTINGS_PROFILES_STORAGE_KEY) })
  }],
  ['cross-tab storage clear notification', async () => {
    await act(async () => { localStorage.clear(); storageChanged(null) })
  }],
  ['ordinary blur', async ui => { await act(async () => ui.host.querySelector('.other').focus()) }],
]
for (const [name, invalidate] of invalidations) {
  test(`${name} clears a ready continuation without changing prose or starting another request`, async t => {
    const f = await fixture(t), ui = await mount(t, f)
    await type(ui)
    await ready(ui)
    const before = ui.document(), saves = ui.observed.changes.length
    await invalidate(ui, f, t)
    empty(ui)
    assert.equal(ui.document(), before)
    assert.equal(ui.observed.changes.length, saves)
    await act(async () => assert.equal(ui.observed.api.accept(), false))
    await idle()
    assert.equal(trace().length, 1)
    assert.equal(ui.observed.errors, 0)
  })
}

for (const name of ['explicit cancel', 'cursor movement', 'Escape', 'busy switch', 'scene switch', 'writing settings change', 'shared Text profile save', 'book Text profile selection', 'cross-tab book Text profile selection', 'same-tab global connection save', 'cross-tab global connection storage', 'cross-tab Text profile storage', 'ordinary blur']) {
  test(`${name} aborts an in-flight Fake continuation quietly`, async t => {
    const f = await fixture(t, { initial: 'The door opened. [DELAY_MS:5000] Waiting.' })
    const ui = await mount(t, f)
    await type(ui)
    // onInput's real IndexedDB reads have settled. The 100ms debounce starts a
    // Fake stream whose first chunk is delayed five seconds; no partial UI leaks.
    await idle(160)
    empty(ui)
    const before = ui.document()
    await invalidations.find(([label]) => label === name)[1](ui, f, t)
    await waitFor(() => trace().length === 1, 'Cancelled Fake stream should settle and record its abort')
    assert.equal(trace()[0].outcome, 'aborted')
    assert.equal(trace()[0].emittedContent, '')
    empty(ui)
    assert.equal(ui.document(), before)
    await idle()
    assert.equal(trace().length, 1, 'Cancellation must not start a replacement request without manual typing')
    assert.equal(ui.observed.errors, 0)
  })
}

test('typing during a Fake stream aborts the old snapshot; Escape also cancels its replacement debounce', async t => {
  const f = await fixture(t, { initial: 'The door opened. [DELAY_MS:5000] Waiting.' })
  const ui = await mount(t, f)
  await type(ui)
  await idle(160)
  await type(ui, ' New.')
  await key(ui, 'Escape')
  await waitFor(() => trace().length === 1, 'Old typing snapshot was aborted')
  assert.equal(trace()[0].outcome, 'aborted')
  await idle()
  assert.equal(trace().length, 1, 'Escape cancels the replacement before it reaches the provider')
  empty(ui)
  assert.equal(ui.document(), f.initial + ' Typed. New.')
  assert.equal(ui.observed.errors, 0)
})

test('cross-tab selection signal for an unrelated book preserves the current ready continuation', async t => {
  const f = await fixture(t)
  const other = await persistence.createBook(ai.loadAiSettings(), 'Other-tab unrelated book')
  const otherSelections = await persistence.getBookProfileSelections(other.book.id)
  const ui = await mount(t, f)
  await type(ui)
  await ready(ui)
  const keyBefore = ui.observed.api.suggestion.configurationKey
  await act(async () => {
    const signal = await saveBookSelectionsFromOtherTab(t, other.book.id, { ...otherSelections, text: f.alternate.id })
    storageChanged(signal.key, signal.newValue)
  })
  assert.ok(ui.observed.api.suggestion !== null, 'Other-book storage signal is ignored')
  assert.equal(ui.observed.api.suggestion.configurationKey, keyBefore)
  assert.equal(ui.ghost.textContent, continuation)
  await idle()
  assert.equal(trace().length, 1)
  await acceptClick(ui)
})

test('unrelated defaults, other-book selections and unrelated storage leave this book continuation intact', async t => {
  const f = await fixture(t)
  const other = await persistence.createBook(ai.loadAiSettings(), 'Unrelated book')
  const ui = await mount(t, f)
  await type(ui)
  await ready(ui)
  const keyBefore = ui.observed.api.suggestion.configurationKey
  await act(async () => {
    saveAutocomplete(f.alternate.id, { model: '', enabled: false })
    profiles.setDefaultSettingsProfile('text', f.alternate.id)
    await persistence.saveBookProfileSelections(other.book.id, { ...(await persistence.getBookProfileSelections(other.book.id)), text: f.alternate.id })
    localStorage.setItem('unrelated.preference', 'changed')
    storageChanged('unrelated.preference')
    // Relevant storage events with unchanged effective settings must also be ignored.
    storageChanged(profiles.SETTINGS_PROFILES_STORAGE_KEY)
    ai.saveAiSettings({ ...ai.loadAiSettings(), mainModel: '', autocomplete: { ...configured, enabled: false } })
    storageChanged(ai.AI_SETTINGS_STORAGE_KEY)
  })
  assert.ok(ui.observed.api.suggestion !== null, 'Unrelated defaults must not invalidate explicitly selected Text')
  assert.equal(ui.observed.api.suggestion.configurationKey, keyBefore)
  assert.equal(ui.ghost.textContent, continuation)
  assert.equal((await persistence.getBookProfileSelections(f.book.id)).text, f.text.id)
  await idle()
  assert.equal(trace().length, 1)
  await acceptClick(ui)
})

test('saving a new Text configuration cancels stale UI; only new manual input uses its new length and writing settings', async t => {
  const f = await fixture(t), ui = await mount(t, f)
  await type(ui)
  await ready(ui)
  await act(async () => { saveAutocomplete(f.text.id, { length: 'sentence' }) })
  await ui.update({ writing: { ...writing, language: 'French', style: 'lyrical' } })
  empty(ui)
  await idle()
  assert.equal(trace().length, 1)
  await type(ui, ' Again.')
  await ready(ui, 2)
  assert.equal(trace().at(-1).maxTokens, 128)
  const payload = JSON.parse(trace().at(-1).messages.find(message => message.role === 'user').content)
  assert.equal(payload.writing.language, 'French')
  assert.equal(payload.writing.style, 'lyrical')
})

test('an unnotified connection storage write cannot accept a stale Fake result', async t => {
  const f = await fixture(t), ui = await mount(t, f)
  await type(ui)
  await ready(ui)
  const before = ui.document()
  // Even if a change notification is missed, acceptance must re-resolve the connection.
  await act(async () => {
    storeGlobalConnection()
    assert.equal(ui.observed.api.accept(), false)
  })
  empty(ui)
  assert.equal(ui.document(), before)
  assert.equal(trace().length, 1)
  assert.equal(ui.observed.errors, 0)
})

for (const phase of ['debounce', 'in-flight', 'ready']) {
  test(`unmount during ${phase} cleans up requests and profile/storage listeners`, async t => {
    const f = await fixture(t, phase === 'in-flight' ? { initial: 'The door opened. [DELAY_MS:5000] Waiting.' } : {})
    assert.equal(typeof ai.AI_SETTINGS_EVENT, 'string', 'AI settings export their same-tab change event')
    const watchedEvents = [profiles.SETTINGS_PROFILES_EVENT, ai.AI_SETTINGS_EVENT, 'storage']
    const added = [], removed = []
    const add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window)
    t.mock.method(window, 'addEventListener', (type, listener, options) => {
      if (watchedEvents.includes(type)) added.push({ type, listener })
      return add(type, listener, options)
    })
    t.mock.method(window, 'removeEventListener', (type, listener, options) => {
      if (watchedEvents.includes(type)) removed.push({ type, listener })
      return remove(type, listener, options)
    })
    const ui = await mount(t, f)
    await type(ui)
    if (phase === 'in-flight') await idle(160)
    if (phase === 'ready') await ready(ui)
    assert.equal(added.length, watchedEvents.length)
    for (const event of watchedEvents) assert.equal(added.filter(item => item.type === event).length, 1, `Subscribed to ${event}`)
    await ui.unmount()
    assert.equal(removed.length, watchedEvents.length)
    for (const registration of added) assert.ok(removed.some(item => item.type === registration.type && item.listener === registration.listener), `Removed ${registration.type} listener`)
    assert.ok(ui.editor.current === null, 'Editor ref detached')
    assert.equal(ui.host.childElementCount, 0)
    await act(async () => {
      saveAutocomplete(f.text.id, { length: 'sentence' })
      storageChanged(profiles.SETTINGS_PROFILES_STORAGE_KEY)
      profiles.notifySettingsProfilesChanged(f.book.id)
      ai.saveAiSettings(changedGlobalConnection())
    })
    await idle()
    assert.equal(trace().length, phase === 'debounce' ? 0 : 1)
    if (phase === 'in-flight') assert.equal(trace()[0].outcome, 'aborted')
    if (phase === 'ready') assert.equal(trace()[0].outcome, 'complete')
    assert.equal(ui.observed.errors, 0)
  })
}

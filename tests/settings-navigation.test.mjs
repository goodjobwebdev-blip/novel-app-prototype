import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import 'fake-indexeddb/auto'
import { transpileSourceTree } from './transpile-source-tree.mjs'
import { assignBookTestProfiles } from './settings-profile-fixture.mjs'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://arc.test/', pretendToBeVisual: true })
after(() => dom.window.close())
for (const key of ['window', 'document', 'HTMLElement', 'CustomEvent', 'localStorage', 'sessionStorage', 'Element', 'Node', 'MutationObserver', 'Window', 'DOMRect', 'Range']) globalThis[key] = dom.window[key]
globalThis.getComputedStyle = dom.window.getComputedStyle
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
dom.window.Range.prototype.getClientRects = () => []
dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect()
dom.window.HTMLElement.prototype.scrollIntoView = function () {}
window.confirm = () => true
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0)
globalThis.cancelAnimationFrame = clearTimeout
const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const { EditorView } = await import('@codemirror/view')
const directory = mkdtempSync(new URL('../node_modules/.settings-navigation-test-', import.meta.url))
after(() => rmSync(directory, { recursive: true, force: true }))
transpileSourceTree(directory)
const moduleAt = name => import(pathToFileURL(`${directory}/${name}.mjs`))
const p = await moduleAt('data/persistence')
after(async () => (await p.database()).close())
const ai = await moduleAt('shared/ai/ai-settings')
const profiles = await moduleAt('features/settings/settings-profiles')
const ui = await moduleAt('features/settings/ui-settings')
const lastBook = await moduleAt('app/last-book')
const chats = await moduleAt('features/chat/chat-service')
const { default: Workspace } = await moduleAt('app/Workspace')

// One small, shared fixture; reset storage and editable values between tests.
const settings = { ...ai.copyAiSettings(ai.initialAiSettings), provider: 'fake', mainModel: 'fake/test', supportModel: 'fake/test', generationWordDelayMs: '40' }
ai.saveAiSettings(settings)
const defaultUi = { ...structuredClone(ui.defaultUiSettings), activeThemeId: 'blue-light', editor: { ...ui.defaultUiSettings.editor, fontSize: 17 } }
ui.saveUiSettings(defaultUi)
const fixture = await p.createBook(settings, 'Navigation fixture')
const selections = await assignBookTestProfiles({ persistence: p, ai, profiles }, fixture.book.id, settings, ['text', 'story', 'ui'])
const profile = id => profiles.loadSettingsProfiles().profiles.find(item => item.id === id)
const bookUi = { ...structuredClone(ui.defaultUiSettings), activeThemeId: 'warm-paper', highlightDialogue: true, sceneBeats: false, editor: { ...ui.defaultUiSettings.editor, fontSize: 24 } }
profiles.saveSettingsProfile({ ...profile(selections.ui), ui: bookUi })
for (const kind of ['image', 'video']) {
  selections[kind] = profiles.createSettingsProfile(kind, `Book ${kind} navigation`).id
}
await p.saveBookProfileSelections(fixture.book.id, selections)
const note = await p.createNote(fixture.book.id, 'Navigation note')
const chat = await chats.createChat(fixture.book.id, 'Navigation chat')
await chats.createChatMessage(chat, 'user', 'A persisted navigation message.')
const originalContext = await p.getBookContextSettings(fixture.book.id)
const sceneText = 'The original navigation scene.'
const noteText = 'The persisted navigation note.'
const savedStorage = Array.from({ length: localStorage.length }, (_, index) => {
  const key = localStorage.key(index)
  return [key, localStorage.getItem(key)]
})

beforeEach(async t => {
  localStorage.clear()
  for (const [key, value] of savedStorage) localStorage.setItem(key, value)
  sessionStorage.clear()
  window.confirm = () => true
  await p.saveDocumentContent(fixture.scene.id, sceneText)
  await p.saveDocumentContent(note.id, noteText)
  await p.saveBookContextSettings(fixture.book.id, originalContext)
  await p.saveBookProfileSelections(fixture.book.id, selections)
  // Catalog discovery must never reach a real provider in this navigation suite.
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ data: [] }), { headers: { 'Content-Type': 'application/json' } }))
})

async function settle(predicate, description = 'The requested navigation state becomes ready') {
  for (let i = 0; i < 200 && !predicate(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 10)))
  assert.ok(Boolean(predicate()), `${description}: ${document.body.textContent.slice(0, 1800)}`)
}
const ariaButton = label => [...document.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === label)
const textButton = (label, scope = document) => [...scope.querySelectorAll('button')].find(item => item.textContent.trim() === label)
const field = label => [...document.querySelectorAll('label')].find(item => item.querySelector('.arc-field__label')?.textContent === label)?.querySelector('input, select, textarea')
const view = () => {
  const editor = document.querySelector('.cm-editor')
  return editor ? EditorView.findFromDOM(editor) : undefined
}
const railLabels = () => [...document.querySelectorAll('.settings-rail nav button')].map(item => item.textContent.trim())
const lastBookButton = () => textButton(`Back to last book · ${fixture.book.title}`)
async function click(element) {
  assert.ok(Boolean(element), 'The requested control exists')
  assert.equal(element.disabled, false, 'The requested control is enabled')
  await act(async () => element.click())
}
async function change(element, value) {
  assert.ok(Boolean(element), 'The requested field exists')
  const prototype = element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value)
    element.dispatchEvent(new window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  })
}
async function mountWorkspace(t) {
  let closed = false
  const root = createRoot(document.getElementById('root'))
  t.after(close)
  async function close() {
    if (closed) return
    closed = true
    await act(async () => root.unmount())
  }
  await act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Workspace))))
  await settle(() => ariaButton('New book') && !ariaButton('New book').disabled)
  return { close }
}
async function openBook() {
  await click([...document.querySelectorAll('.library-book')].find(item => item.textContent.includes(fixture.book.title)))
  await settle(() => view()?.state.doc.toString() === sceneText)
}
async function openBookSettings() {
  await click(ariaButton('Open current book settings'))
  await settle(() => field('UI')?.value === selections.ui)
}
async function openInlineProfile(label, id, picker = 'Profile / preset') {
  await click(ariaButton(`Edit ${label} profile`))
  await settle(() => field(picker)?.value === id && document.querySelector('.profile-usage'))
}
async function homeFromBook() {
  await openBookSettings()
  await click(ariaButton('Back to library'))
  await settle(() => document.querySelector('.library-screen'))
}
async function openDefaultSettings() {
  await click(ariaButton('Open default settings'))
  await settle(() => document.querySelector('.settings-rail[aria-label="Global settings navigation"]'))
}
async function assertUi(expected) {
  await settle(() => document.documentElement.dataset.uiTheme === expected.activeThemeId && ui.getActiveUiSettings().editor.fontSize === expected.editor.fontSize)
  assert.equal(document.documentElement.style.getPropertyValue('--editor-font-size'), `${expected.editor.fontSize}px`)
  assert.equal(ui.getActiveUiSettings().highlightDialogue, expected.highlightDialogue)
  assert.equal(ui.getActiveUiSettings().sceneBeats, expected.sceneBeats)
}

test('library/global settings use default UI; book settings, inline UI Edit and returns switch the effective profile', async t => {
  await mountWorkspace(t)
  await assertUi(defaultUi)
  await openBook()
  await assertUi(bookUi)
  await openBookSettings()
  assert.deepEqual(railLabels(), ['Profiles', 'Context'])
  await assertUi(bookUi)
  const legacyUi = localStorage.getItem(ui.UI_SETTINGS_STORAGE_KEY)
  await openInlineProfile('UI', selections.ui, 'UI profile')
  assert.deepEqual(railLabels(), ['AI', 'UI', 'Application', 'Sync'])
  await assertUi(defaultUi)
  assert.equal(field('UI profile').value, selections.ui, 'Edit opens the linked book profile, not the global default')
  await click(textButton(`Back to Profiles · ${fixture.book.title}`))
  await settle(() => field('UI')?.value === selections.ui)
  await assertUi(bookUi)
  await click(textButton('Global Settings'))
  await settle(() => lastBookButton())
  await assertUi(defaultUi)
  await click(lastBookButton())
  await settle(() => view()?.state.doc.toString() === sceneText)
  await assertUi(bookUi)
  await homeFromBook()
  await assertUi(defaultUi)
  await openDefaultSettings()
  await assertUi(defaultUi)
  assert.equal(localStorage.getItem(ui.UI_SETTINGS_STORAGE_KEY), legacyUi, 'Surface changes do not overwrite the legacy UI migration source')
})

test('inline Story Edit guards Back to Profiles, retains failed Save drafts, and allows explicit discard or successful save', async t => {
  await mountWorkspace(t)
  await openBook()
  await openBookSettings()
  await openInlineProfile('Story prompt', selections.story)
  assert.equal(field('Prompt preset type').value, 'story')
  const originalName = profile(selections.story).name
  await change(field('Profile name'), 'Unsaved story name')
  assert.equal(profile(selections.story).name, originalName)
  await click(textButton(`Back to Profiles · ${fixture.book.title}`))
  await settle(() => document.querySelector('[role="alertdialog"]'))
  await click(textButton('Keep editing'))
  assert.equal(field('Profile name').value, 'Unsaved story name')
  await click(textButton(`Back to Profiles · ${fixture.book.title}`))
  const originalSet = window.Storage.prototype.setItem
  let failSave = true
  t.mock.method(window.Storage.prototype, 'setItem', function (key, value) {
    if (failSave && key === profiles.SETTINGS_PROFILES_STORAGE_KEY) throw new Error('Navigation profile disk full')
    return originalSet.call(this, key, value)
  })
  await click(textButton('Save and continue'))
  await settle(() => document.body.textContent.includes('Navigation profile disk full') && !textButton('Save and continue').disabled)
  assert.equal(field('Profile name').value, 'Unsaved story name')
  assert.equal(profile(selections.story).name, originalName)
  assert.ok(Boolean(document.querySelector('[role="alertdialog"]')), 'Failed save does not execute the pending return')
  await click(textButton('Discard and continue'))
  await settle(() => field('Story prompt')?.value === selections.story)
  assert.equal(profile(selections.story).name, originalName)
  failSave = false
  await openInlineProfile('Story prompt', selections.story)
  await change(field('Profile name'), 'Saved navigation story')
  await click(textButton(`Back to Profiles · ${fixture.book.title}`))
  await click(textButton('Save and continue'))
  await settle(() => field('Story prompt')?.value === selections.story)
  assert.equal(profile(selections.story).name, 'Saved navigation story')
  assert.equal((await p.getBookProfileSelections(fixture.book.id)).story, selections.story)
})

for (const destination of ['scene', 'note', 'chat']) {
  test(`last-book return restores the persisted ${destination} after Workspace remount`, async t => {
    const mounted = await mountWorkspace(t)
    await openBook()
    if (destination !== 'scene') {
      await click(ariaButton('Open book workspace'))
      await click(textButton(destination === 'note' ? 'notes' : 'chat', document.querySelector('.book-panel nav')))
      const row = () => [...document.querySelectorAll('.arc-resource-row__open')].find(item => item.textContent.includes(destination === 'note' ? note.title : chat.title))
      await settle(row)
      await click(row())
      await settle(() => destination === 'note' ? view()?.state.doc.toString() === noteText : document.querySelector('.functional-chat h1')?.textContent === chat.title)
    }
    const expected = { bookId: fixture.book.id, screen: destination === 'chat' ? 'chat' : 'editor', documentId: destination === 'note' ? note.id : fixture.scene.id, ...(destination === 'chat' ? { chatId: chat.id } : {}) }
    await settle(() => JSON.stringify(lastBook.loadLastBookLocation()) === JSON.stringify(expected))
    await homeFromBook()
    assert.deepEqual(lastBook.loadLastBookLocation(), expected, 'Visiting Home does not erase the last book location')
    await mounted.close()
    await mountWorkspace(t)
    assert.ok(Boolean(document.querySelector('.library-screen')), 'Startup stays in the library until explicitly returning')
    await openDefaultSettings()
    await settle(lastBookButton)
    await click(lastBookButton())
    await settle(() => destination === 'chat' ? document.querySelector('.functional-chat h1')?.textContent === chat.title : view()?.state.doc.toString() === (destination === 'note' ? noteText : sceneText))
    if (destination === 'chat') assert.match(document.querySelector('.functional-chat').textContent, /A persisted navigation message\./)
    assert.deepEqual(lastBook.loadLastBookLocation(), expected)
    await assertUi(bookUi)
  })
}

test('a persisted deleted book is cleared and never offered as a last-book destination', async t => {
  const deleted = await p.createBook(settings, 'Deleted navigation book')
  lastBook.rememberLastBookLocation({ bookId: deleted.book.id, screen: 'editor', documentId: deleted.scene.id })
  await p.deleteEntityTree(deleted.book.id)
  await mountWorkspace(t)
  await settle(() => localStorage.getItem(lastBook.LAST_BOOK_STORAGE_KEY) === null)
  await openDefaultSettings()
  assert.equal([...document.querySelectorAll('button')].filter(item => item.textContent.startsWith('Back to last book')).length, 0)
  assert.equal(lastBook.loadLastBookLocation(), undefined)
  await click(ariaButton('Back to library'))
  await openBook()
  await settle(() => lastBook.loadLastBookLocation()?.bookId === fixture.book.id)
})

for (const scope of ['global', 'book']) {
  test(`${scope} media Settings deep-links image and video profiles and returns to the same media surface`, async t => {
    await mountWorkspace(t)
    if (scope === 'book') await openBook()
    await click(ariaButton('Open images and gallery'))
    await settle(() => document.querySelector('.image-workspace'))
    for (const kind of ['image', 'video']) {
      if (kind === 'video') await click(textButton('Text to video', document.querySelector('[aria-label="Generation type"]')))
      await click(ariaButton('Image settings'))
      const expectedId = scope === 'book' ? selections[kind] : profiles.loadSettingsProfiles().defaults[kind]
      await settle(() => field('Profile / preset')?.value === expectedId)
      assert.equal(field('Model profile type').value, kind)
      assert.deepEqual(railLabels(), ['AI', 'UI', 'Application', 'Sync'])
      assert.equal(document.querySelectorAll('.book-profile-rows').length, 0, 'Media deep links open the global editor, not book profile selection')
      await assertUi(defaultUi)
      await click(ariaButton('Close settings'))
      await settle(() => document.querySelector('.image-workspace'))
      assert.equal(document.querySelector('.image-workspace-header p')?.textContent ?? '', scope === 'book' ? fixture.book.title : '')
      await assertUi(scope === 'book' ? bookUi : defaultUi)
    }
    await click(ariaButton('Back'))
    await settle(() => scope === 'book' ? view()?.state.doc.toString() === sceneText : document.querySelector('.library-screen'))
  })
}

test('a failed manuscript save blocks Settings; retry persists the actual editor text before navigation', async t => {
  await mountWorkspace(t)
  await openBook()
  const prototype = IDBObjectStore.prototype
  const originalPut = prototype.put
  let failSave = true
  t.mock.method(prototype, 'put', function (entity, ...args) {
    if (failSave && this.name === 'entities' && entity.id === fixture.scene.id && typeof entity.content === 'string') throw new DOMException('Navigation manuscript disk full', 'QuotaExceededError')
    return originalPut.call(this, entity, ...args)
  })
  const originalError = console.error
  t.mock.method(console, 'error', (...args) => {
    if (args[0] !== 'Failed to persist document') originalError(...args)
  })
  const draft = 'Unsaved manuscript must survive Settings navigation.'
  await act(async () => view().dispatch({ changes: { from: 0, to: view().state.doc.length, insert: draft } }))
  await click(ariaButton('Open current book settings'))
  await settle(() => document.body.textContent.includes('Settings was not opened.'))
  assert.equal(document.querySelectorAll('.settings-rail').length, 0)
  assert.equal(view().state.doc.toString(), draft)
  assert.equal((await p.getEntity(fixture.scene.id)).content, sceneText)
  failSave = false
  await openBookSettings()
  assert.equal((await p.getEntity(fixture.scene.id)).content, draft)
  await click(ariaButton('Close settings'))
  await settle(() => view()?.state.doc.toString() === draft)
})

test('failed book Context saves block Home and Retry preserves the draft before leaving', async t => {
  await mountWorkspace(t)
  await openBook()
  await openBookSettings()
  await click(textButton('Context', document.querySelector('.settings-rail nav')))
  await settle(() => field('Previous Scenes to scan for Codex triggers'))
  const prototype = IDBObjectStore.prototype
  const originalPut = prototype.put
  let failSave = true
  t.mock.method(prototype, 'put', function (entity, ...args) {
    if (failSave && this.name === 'entities' && entity.bookId === fixture.book.id && entity.settingsType === 'context-book') throw new DOMException('Navigation Context disk full', 'QuotaExceededError')
    return originalPut.call(this, entity, ...args)
  })
  await change(field('Previous Scenes to scan for Codex triggers'), '7')
  await settle(() => document.body.textContent.includes('Context could not be saved.'))
  await click(ariaButton('Back to library'))
  await settle(() => document.querySelector('.settings-save-recovery'))
  assert.equal(document.querySelectorAll('.library-screen').length, 0)
  assert.equal(field('Previous Scenes to scan for Codex triggers').value, '7')
  assert.notEqual((await p.getBookContextSettings(fixture.book.id)).previousScenesForCodexTriggers, 7)
  failSave = false
  await click(textButton('Retry', document.querySelector('.settings-save-recovery')))
  await settle(() => document.querySelector('.library-screen'))
  assert.equal((await p.getBookContextSettings(fixture.book.id)).previousScenesForCodexTriggers, 7)
})

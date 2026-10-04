import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'

import { renderToStaticMarkup } from 'react-dom/server'
import 'fake-indexeddb/auto'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://arc.test', pretendToBeVisual: true })
for (const key of ['window', 'document', 'localStorage', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'MutationObserver', 'CustomEvent', 'Event', 'Node', 'Window', 'Text', 'Range']) globalThis[key] = dom.window[key]
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0)
globalThis.cancelAnimationFrame = clearTimeout
globalThis.getComputedStyle = window.getComputedStyle
window.Range.prototype.getClientRects = () => []
window.Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 })
window.confirm = () => true
const { createRoot } = await import('react-dom/client')
const compiled = await build({
  stdin: { contents: `export { default as App } from './src/app/App.tsx'; export { default as Panel, BookProfilesPanel, profileCatalogSettings, withoutProfileCredentials } from './src/features/settings/SettingsProfilesPanel.tsx'; export { UiSettingsPanel } from './src/features/settings/UiSettingsPortal.tsx'; export * as profiles from './src/features/settings/settings-profiles.ts'; export * as ai from './src/shared/ai/ai-settings.ts'; export * as ui from './src/features/settings/ui-settings.ts'; export * as media from './src/features/images/image-settings.ts'; export * as persistence from './src/data/persistence.ts'; export * as chats from './src/features/chat/chat-service.ts'; export * as catalog from './src/shared/ai/model-catalog.ts'; export * as fake from './src/shared/ai/fake-provider.ts';`, resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'tsx' },
  bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react', 'react-dom', 'react-dom/client', 'react-dom/server'], jsx: 'automatic', loader: { '.css': 'empty' },
})
const module = { exports: {} }
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
const { App, Panel, BookProfilesPanel, UiSettingsPanel, profiles, ai, ui, media, persistence, chats, catalog, fake, profileCatalogSettings, withoutProfileCredentials } = module.exports
const fixture = await persistence.createBook(ai.initialAiSettings, 'Linked test book')
const library = () => profiles.loadSettingsProfiles()
const profile = id => library().profiles.find(item => item.id === id)
const defaults = () => Object.fromEntries(['text', 'tts', 'stt', 'image', 'video', 'ui', 'story', 'codex', 'summary'].map(kind => [kind, library().defaults[kind]]))
const delay = () => new Promise(resolve => setTimeout(resolve, 15))
async function settle() { await act(async () => { await delay(); await delay() }) }
async function mount(Component, props = {}) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  await act(async () => { root.render(React.createElement(Component, props)); await delay() })
  await settle()
  return { host, root, async close() { await act(async () => root.unmount()); host.remove() } }
}
function button(host, label) {
  const found = [...host.querySelectorAll('button')].find(element => element.textContent.trim() === label)
  assert.ok(found, `Missing button: ${label}`)
  return found
}
async function click(element) { await act(async () => { element.click(); await delay() }); await settle() }
function field(host, label) {
  const found = [...host.querySelectorAll('label')].find(element => element.textContent.includes(label))
  assert.ok(found, `Missing field: ${label}`)
  return found.querySelector('input, select, textarea')
}
async function change(element, value) {
  const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value)
    element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
    await delay()
  })
}
const panelProps = extra => ({ section: 'ai', renderEditor: () => React.createElement('p', null, 'Controlled model editor'), application: null, sync: null, ...extra })

test('book Profiles renders nine live selections and Edit links, without detailed editors or credentials', () => {
  const html = renderToStaticMarkup(React.createElement(BookProfilesPanel, { library: library(), selections: defaults(), busy: false, error: '', onChange() {}, onEdit() {}, onRetry() {} }))
  assert.equal((html.match(/<select/g) || []).length, 9)
  assert.equal((html.match(/aria-label="Edit [^"]+ profile"/g) || []).length, 9)
  assert.match(html, /snapshot this book/)
  assert.doesNotMatch(html, /type="password"|Exact model ID|textarea|Chat prompt preset|Character chat prompt preset/)
})

test('App book navigation is only Profiles and Context; Home, Global Settings and Close remain adjacent', async () => {
  const mounted = await mount(App, { book: { id: fixture.book.id, title: fixture.book.title }, onHome() {}, onBack() {} })
  assert.deepEqual([...mounted.host.querySelectorAll('.settings-rail nav button')].map(item => item.textContent.trim()), ['Profiles', 'Context'])
  const header = mounted.host.querySelector('.rail-header')
  assert.match(header.textContent, /Home.*Global Settings/)
  assert.ok(header.querySelector('[aria-label="Close settings"]'))
  await mounted.close()
})

test('global App navigation, last-book return, and prompt deep links select the exact profile', async () => {
  const custom = profiles.createSettingsProfile('summary', 'Summary deep link')
  const mounted = await mount(App, { initialProfileId: custom.id, lastBookTitle: 'Last Book', onLastBook() {}, onHome() {} })
  assert.deepEqual([...mounted.host.querySelectorAll('.settings-rail nav button')].map(item => item.textContent.trim()), ['AI', 'UI', 'Application', 'Sync'])
  assert.ok(button(mounted.host, 'Back to last book · Last Book'))
  assert.equal(field(mounted.host, 'Profile / preset').value, custom.id)
  assert.ok(mounted.host.querySelector('.response-length-setting'))
  assert.equal(mounted.host.querySelector('.models-card'), null)
  await mounted.close()
})

test('text editor includes five roles, role-local caps and prompt selections, but no reveal speed or credentials', async () => {
  const mounted = await mount(App)
  assert.equal(mounted.host.querySelectorAll('.model-role-setting').length, 5)
  assert.ok(mounted.host.querySelector('#main-model-heading').closest('section').textContent.includes('Story / Main context cap'))
  assert.ok(mounted.host.querySelector('#codex-model-heading').closest('section').textContent.includes('Codex model context cap'))
  assert.ok(field(mounted.host, 'Chat prompt preset'))
  assert.ok(field(mounted.host, 'Character chat prompt preset'))
  assert.doesNotMatch(mounted.host.textContent, /Custom reveal speed|Text reveal speed/)
  assert.equal(mounted.host.querySelector('input[type="password"]'), null)
  await mounted.close()
})

test('profile drafts do not autosave; dirty navigation requires Save or Discard and failures keep the draft', async () => {
  const custom = profiles.createSettingsProfile('text', 'Draft test')
  const ref = React.createRef()
  const mounted = await mount(Panel, panelProps({ initialProfileId: custom.id, ref }))
  await change(field(mounted.host, 'Profile name'), 'Unsaved rename')
  assert.equal(profile(custom.id).name, 'Draft test')
  let left = false
  await act(async () => ref.current.requestLeave(() => { left = true }))
  assert.equal(left, false)
  assert.ok(mounted.host.querySelector('[role="alertdialog"]'))
  await click(button(mounted.host, 'Keep editing'))
  assert.equal(field(mounted.host, 'Profile name').value, 'Unsaved rename')
  const originalSet = window.Storage.prototype.setItem
  window.Storage.prototype.setItem = function(key, value) { if (key === profiles.SETTINGS_PROFILES_STORAGE_KEY) throw new Error('Profile disk full'); return originalSet.call(this, key, value) }
  await click(button(mounted.host, 'Save profile'))
  assert.match(mounted.host.textContent, /Profile disk full/)
  assert.equal(field(mounted.host, 'Profile name').value, 'Unsaved rename')
  assert.equal(profile(custom.id).name, 'Draft test')
  window.Storage.prototype.setItem = originalSet
  await act(async () => ref.current.requestLeave(() => { left = true }))
  await click(button(mounted.host, 'Discard and continue'))
  assert.equal(left, true)
  assert.equal(profile(custom.id).name, 'Draft test')
  await mounted.close()
})

test('Save warns with linked book titles; cancellation retains the draft and acceptance saves it', async () => {
  const custom = profiles.createSettingsProfile('text', 'Linked profile')
  await persistence.saveBookProfileSelections(fixture.book.id, { ...defaults(), text: custom.id })
  const mounted = await mount(Panel, panelProps({ initialProfileId: custom.id }))
  assert.match(mounted.host.textContent, /Used in 1 book/)
  assert.equal(button(mounted.host, 'Delete').disabled, true)
  await change(field(mounted.host, 'Profile name'), 'Linked rename')
  let confirmation = ''
  window.confirm = message => { confirmation = message; return false }
  await click(button(mounted.host, 'Save profile'))
  assert.match(confirmation, /Linked test book/)
  assert.equal(profile(custom.id).name, 'Linked profile')
  assert.equal(field(mounted.host, 'Profile name').value, 'Linked rename')
  window.confirm = () => true
  await click(button(mounted.host, 'Save profile'))
  assert.equal(profile(custom.id).name, 'Linked rename')
  await mounted.close()
})

test('default profiles are protected; Duplicate creates an independent editable entry', async () => {
  const mounted = await mount(Panel, panelProps())
  assert.equal(button(mounted.host, 'Delete').disabled, true)
  assert.equal(button(mounted.host, 'Default · protected').disabled, true)
  await click(button(mounted.host, 'Duplicate'))
  const id = field(mounted.host, 'Profile / preset').value
  assert.notEqual(id, library().defaults.text)
  assert.ok(profile(id).name.endsWith('copy'))
  assert.equal(button(mounted.host, 'Delete').disabled, false)
  await mounted.close()
})

test('catalog settings use the global active text connection; profiles strip all credential fields', () => {
  const global = { ...ai.initialAiSettings, provider: 'openai', apiKey: 'global-key', baseUrl: 'https://local.test/v1', speech: { ...ai.initialAiSettings.speech, apiKey: 'speech-key', openaiApiKey: 'stt-key' }, providerProfiles: { nanogpt: { apiKey: 'other-key' } } }
  const effective = profileCatalogSettings(profile(library().defaults.text).settings, global)
  assert.equal(effective.provider, 'openai')
  assert.equal(effective.apiKey, 'global-key')
  assert.equal(effective.speech.apiKey, 'speech-key')
  const clean = withoutProfileCredentials(effective)
  assert.equal(clean.apiKey, '')
  assert.equal(clean.baseUrl, '')
  assert.equal(clean.providerProfiles, undefined)
  assert.equal(clean.speech.apiKey, '')
  assert.equal(clean.speech.openaiApiKey, '')
})

test('Connections owns speech/media keys, saves explicitly, and preserves media favorites', async () => {
  const originalMedia = media.loadImageSettings()
  const mounted = await mount(Panel, panelProps())
  await click(button(mounted.host, 'Connections'))
  assert.ok(field(mounted.host, 'NanoGPT Speech API key'))
  assert.ok(field(mounted.host, 'OpenAI media API key'))
  await change(field(mounted.host, 'OpenAI media API key'), 'local-media-key')
  assert.equal(media.loadImageSettings().keys.openai, originalMedia.keys.openai)
  await click(button(mounted.host, 'Save connections'))
  assert.equal(media.loadImageSettings().keys.openai, 'local-media-key')
  assert.deepEqual(media.loadImageSettings().favorites, originalMedia.favorites)
  await mounted.close()
})

test('controlled UI editor reports changes without autosaving or applying document theme', async () => {
  const savedBefore = localStorage.getItem(ui.UI_SETTINGS_STORAGE_KEY)
  const themeBefore = document.documentElement.getAttribute('data-ui-theme')
  let changed
  const mounted = await mount(UiSettingsPanel, { value: structuredClone(ui.defaultUiSettings), onChange: value => { changed = value } })
  await click(button(mounted.host, 'Editor'))
  await click(mounted.host.querySelector('input[type="checkbox"]'))
  assert.ok(changed)
  assert.equal(localStorage.getItem(ui.UI_SETTINGS_STORAGE_KEY), savedBefore)
  assert.equal(document.documentElement.getAttribute('data-ui-theme'), themeBefore)
  await click(button(mounted.host, 'Reset to readable theme'))
  assert.equal(document.documentElement.getAttribute('data-ui-theme'), themeBefore)
  assert.equal(localStorage.getItem(ui.UI_SETTINGS_STORAGE_KEY), savedBefore)
  await mounted.close()
})

test('image/video/UI deep links select independent controlled editors', async () => {
  for (const kind of ['image', 'video', 'ui']) {
    const custom = profiles.createSettingsProfile(kind, `${kind} deep link`)
    const mounted = await mount(App, { initialProfileId: custom.id })
    const picker = field(mounted.host, kind === 'ui' ? 'UI profile' : 'Profile / preset')
    assert.equal(picker.value, custom.id)
    assert.equal(mounted.host.querySelector('input[type="password"]'), null)
    assert.match(mounted.host.textContent, kind === 'ui' ? /Custom reveal speed/ : kind === 'image' ? /Image models/ : /Video models/)
    await mounted.close()
  }
})

test('book Edit opens the selected global profile and dirty Back to Profiles requires explicit Discard', async () => {
  const mounted = await mount(App, { book: { id: fixture.book.id, title: fixture.book.title }, onBack() {} })
  const selected = (await persistence.getBookProfileSelections(fixture.book.id)).text
  await click(mounted.host.querySelector('[aria-label="Edit Text models profile"]'))
  assert.equal(field(mounted.host, 'Profile / preset').value, selected)
  await change(field(mounted.host, 'Profile name'), 'Not applied')
  await click(button(mounted.host, `Back to Profiles · ${fixture.book.title}`))
  assert.ok(mounted.host.querySelector('[role="alertdialog"]'))
  await click(button(mounted.host, 'Discard and continue'))
  assert.deepEqual([...mounted.host.querySelectorAll('.settings-rail nav button')].map(item => item.textContent.trim()), ['Profiles', 'Context'])
  assert.notEqual(profile(selected).name, 'Not applied')
  await mounted.close()
})

test('Application Context defaults remain global even when entering Global Settings from a book', async () => {
  const before = await persistence.getBookContextSettings(fixture.book.id)
  const mounted = await mount(App, { book: { id: fixture.book.id, title: fixture.book.title } })
  await click(button(mounted.host, 'Global Settings'))
  await click(button(mounted.host, 'Application'))
  await change(field(mounted.host, 'Previous Scenes to scan for Codex triggers'), '7')
  assert.equal(persistence.loadDefaultBookContextSettings().previousScenesForCodexTriggers, 7)
  assert.deepEqual(await persistence.getBookContextSettings(fixture.book.id), before)
  assert.ok(mounted.host.querySelector('.tts-cache-settings'))
  await mounted.close()
})

test('new deep-link props cannot replace an unsaved profile without an explicit choice', async () => {
  const first = profiles.createSettingsProfile('text', 'First deep link')
  const second = profiles.createSettingsProfile('summary', 'Second deep link')
  const mounted = await mount(App, { initialProfileId: first.id })
  await change(field(mounted.host, 'Profile name'), 'Unsaved deep link name')
  await act(async () => mounted.root.render(React.createElement(App, { initialProfileId: second.id })))
  await settle()
  assert.ok(mounted.host.querySelector('[role="alertdialog"]'))
  assert.equal(field(mounted.host, 'Profile / preset').value, first.id)
  await click(button(mounted.host, 'Discard and continue'))
  assert.equal(field(mounted.host, 'Profile / preset').value, second.id)
  await mounted.close()
})

test('corrupt shared library shows a recoverable error without replacing saved data', async () => {
  const original = localStorage.getItem(profiles.SETTINGS_PROFILES_STORAGE_KEY)
  localStorage.setItem(profiles.SETTINGS_PROFILES_STORAGE_KEY, '{broken')
  const mounted = await mount(App, { onBack() {} })
  assert.match(mounted.host.textContent, /Settings unavailable/)
  assert.equal(localStorage.getItem(profiles.SETTINGS_PROFILES_STORAGE_KEY), '{broken')
  localStorage.setItem(profiles.SETTINGS_PROFILES_STORAGE_KEY, original)
  await click(button(mounted.host, 'Retry loading'))
  assert.ok(mounted.host.querySelector('.model-role-settings'))
  await mounted.close()
})

test('dirty profile switching and Set as default require an explicit Save or Discard', async () => {
  const first = profiles.createSettingsProfile('text', 'Switch first')
  const second = profiles.createSettingsProfile('text', 'Switch second')
  const oldDefault = library().defaults.text
  const mounted = await mount(Panel, panelProps({ initialProfileId: first.id }))
  await change(field(mounted.host, 'Profile name'), 'Discarded first name')
  await change(field(mounted.host, 'Profile / preset'), second.id)
  assert.equal(field(mounted.host, 'Profile / preset').value, first.id)
  await click(button(mounted.host, 'Keep editing'))
  await click(button(mounted.host, 'Set as default'))
  assert.equal(library().defaults.text, oldDefault)
  await click(button(mounted.host, 'Save and continue'))
  assert.equal(profile(first.id).name, 'Discarded first name')
  assert.equal(library().defaults.text, first.id)
  assert.equal(button(mounted.host, 'Default · protected').disabled, true)
  assert.equal(button(mounted.host, 'Delete').disabled, true)
  await mounted.close()
})

test('Application default selections are explicit drafts, guarded on navigation, and failures retain selections', async () => {
  const replacement = profiles.createSettingsProfile('text', 'New default')
  profiles.saveSettingsProfile({ ...replacement, settings: { ...replacement.settings, mainModel: 'profile-default-model' } })
  const legacy = ai.loadAiSettings()
  ai.saveAiSettings({ ...legacy, mainModel: 'legacy-model-must-not-win' })
  const originalDefault = library().defaults.text
  let notified
  const ref = React.createRef()
  const mounted = await mount(Panel, panelProps({ section: 'application', ref, onSaved: value => { notified = value } }))
  await change(field(mounted.host, 'Default Text models'), replacement.id)
  assert.equal(library().defaults.text, originalDefault)
  let navigated = false
  await act(async () => ref.current.requestLeave(() => { navigated = true }))
  assert.equal(navigated, false)
  await click(button(mounted.host, 'Keep editing'))
  const originalSet = window.Storage.prototype.setItem
  window.Storage.prototype.setItem = function(key, value) { if (key === profiles.SETTINGS_PROFILES_STORAGE_KEY) throw new Error('Defaults disk full'); return originalSet.call(this, key, value) }
  try {
    await click(button(mounted.host, 'Save defaults'))
    assert.match(mounted.host.textContent, /Defaults disk full/)
    assert.equal(field(mounted.host, 'Default Text models').value, replacement.id)
    assert.equal(library().defaults.text, originalDefault)
    assert.equal(notified, undefined)
  } finally { window.Storage.prototype.setItem = originalSet }
  await click(button(mounted.host, 'Save defaults'))
  assert.equal(library().defaults.text, replacement.id)
  assert.equal(notified.mainModel, 'profile-default-model')
  await mounted.close()
})

test('failed Set as default does not change protection or discard a profile', async () => {
  const custom = profiles.createSettingsProfile('text', 'Fail default button')
  const oldDefault = library().defaults.text
  const mounted = await mount(Panel, panelProps({ initialProfileId: custom.id }))
  const originalSet = window.Storage.prototype.setItem
  window.Storage.prototype.setItem = function(key, value) { if (key === profiles.SETTINGS_PROFILES_STORAGE_KEY) throw new Error('Default button failure'); return originalSet.call(this, key, value) }
  try {
    await click(button(mounted.host, 'Set as default'))
    assert.match(mounted.host.textContent, /Default button failure/)
    assert.equal(library().defaults.text, oldDefault)
    assert.equal(field(mounted.host, 'Profile / preset').value, custom.id)
    assert.equal(button(mounted.host, 'Delete').disabled, false)
  } finally { window.Storage.prototype.setItem = originalSet }
  await mounted.close()
})

test('editing another provider connection never activates it or replaces profile models; Save callback resolves defaults', async () => {
  const originalConnection = ai.loadAiSettings()
  ai.saveAiSettings({ ...originalConnection, provider: 'nanogpt', apiKey: 'active-nano-key', mainModel: 'legacy-unused-main' })
  const profilesBefore = library().profiles
  let saved
  const mounted = await mount(Panel, panelProps({ onSaved: value => { saved = value } }))
  await click(button(mounted.host, 'Connections'))
  await change(field(mounted.host, 'Connection provider'), 'openai')
  await change(mounted.host.querySelector('[aria-label="Text API key"]'), 'global-openai-key')
  assert.equal(field(mounted.host, 'Active text provider').value, 'nanogpt')
  assert.equal(ai.loadAiSettings().provider, 'nanogpt')
  assert.deepEqual(library().profiles, profilesBefore)
  await click(button(mounted.host, 'Save connections'))
  assert.equal(ai.loadAiSettings().provider, 'nanogpt')
  assert.equal(ai.loadAiSettings().apiKey, 'active-nano-key')
  assert.equal(ai.loadAiSettings().providerProfiles.openai.apiKey, 'global-openai-key')
  assert.equal(saved.mainModel, profile(library().defaults.text).settings.mainModel)
  assert.notEqual(saved.mainModel, 'legacy-unused-main')
  assert.deepEqual(library().profiles, profilesBefore)
  await mounted.close()
})

test('UI to AI navigation is guarded and never renders a UI kind in the Models pane', async () => {
  const mounted = await mount(App, { initialProfileId: library().defaults.ui })
  await change(field(mounted.host, 'Custom reveal speed'), '72')
  await click(button(mounted.host, 'AI'))
  assert.ok(mounted.host.querySelector('[role="alertdialog"]'))
  assert.ok(mounted.host.querySelector('.ui-settings-panel'))
  await click(button(mounted.host, 'Discard and continue'))
  assert.equal(field(mounted.host, 'Model profile type').value, 'text')
  assert.equal(mounted.host.querySelector('.ui-settings-panel'), null)
  assert.equal(mounted.host.querySelectorAll('#ai-panel-models').length, 1)
  assert.equal(mounted.host.querySelector('#ai-panel-models').getAttribute('aria-labelledby'), 'ai-tab-models')
  await mounted.close()
})

test('controlled UI profile Save failures retain flags and speed, without touching legacy UI storage', async () => {
  const custom = profiles.createSettingsProfile('ui', 'UI failed save')
  const originalUi = profile(custom.id).ui
  const storedUi = localStorage.getItem(ui.UI_SETTINGS_STORAGE_KEY)
  const mounted = await mount(App, { initialProfileId: custom.id })
  await click(button(mounted.host, 'Editor'))
  await click(mounted.host.querySelector('.ui-editor-settings input[type="checkbox"]'))
  await change(field(mounted.host, 'Custom reveal speed'), '73')
  const originalSet = window.Storage.prototype.setItem
  window.Storage.prototype.setItem = function(key, value) { if (key === profiles.SETTINGS_PROFILES_STORAGE_KEY) throw new Error('UI profile save failed'); return originalSet.call(this, key, value) }
  try {
    await click(button(mounted.host, 'Save profile'))
    assert.match(mounted.host.textContent, /UI profile save failed/)
    assert.equal(field(mounted.host, 'Custom reveal speed').value, '73')
    assert.equal(mounted.host.querySelector('.ui-editor-settings input[type="checkbox"]').checked, !originalUi.highlightDialogue)
    assert.deepEqual(profile(custom.id).ui, originalUi)
    assert.equal(localStorage.getItem(ui.UI_SETTINGS_STORAGE_KEY), storedUi)
  } finally { window.Storage.prototype.setItem = originalSet }
  await click(button(mounted.host, 'Save profile'))
  assert.equal(profile(custom.id).settings.generationWordDelayMs, '73')
  assert.equal(profile(custom.id).ui.highlightDialogue, !originalUi.highlightDialogue)
  assert.equal(localStorage.getItem(ui.UI_SETTINGS_STORAGE_KEY), storedUi)
  await mounted.close()
})

test('Save-in-flight blocks double writes, profile switching and late editor changes', async () => {
  const custom = profiles.createSettingsProfile('text', 'Save gate')
  const ref = React.createRef()
  let edit
  const mounted = await mount(Panel, panelProps({ initialProfileId: custom.id, ref, renderEditor: props => { edit = props; return null } }))
  await change(field(mounted.host, 'Profile name'), 'Save gate committed')
  let left = false, writes = 0
  const originalSet = window.Storage.prototype.setItem
  window.Storage.prototype.setItem = function(key, value) { if (key === profiles.SETTINGS_PROFILES_STORAGE_KEY) writes += 1; return originalSet.call(this, key, value) }
  try {
    await act(async () => {
      button(mounted.host, 'Save profile').click()
      button(mounted.host, 'Save profile').click()
      ref.current.requestLeave(() => { left = true })
      edit.onChange({ ...edit.settings, mainModel: 'late-unwanted-change' })
      await delay()
    })
    await settle()
    assert.equal(left, false)
    assert.equal(writes, 1)
    assert.equal(profile(custom.id).name, 'Save gate committed')
    assert.notEqual(profile(custom.id).settings.mainModel, 'late-unwanted-change')
  } finally { window.Storage.prototype.setItem = originalSet }
  await mounted.close()
})

test('Fake connection preserves local-only notice and accessible request-trace details', async () => {
  ai.saveAiSettings({ ...ai.loadAiSettings(), provider: 'fake', apiKey: '', baseUrl: '' })
  fake.clearFakeProviderTrace()
  const mounted = await mount(App)
  await click(button(mounted.host, 'Reload model list'))
  assert.match(mounted.host.textContent, /No network request was made/)
  await click(button(mounted.host, 'Connections'))
  assert.match(mounted.host.textContent, /No text-AI network request is sent/)
  const trace = mounted.host.querySelector('[aria-label="Fake provider request trace"]')
  assert.ok(trace)
  assert.match(trace.textContent, /Session only · last 20 requests/)
  assert.equal(button(trace, 'Clear trace').disabled, true)
  assert.equal(mounted.host.querySelector('[aria-label="Text API key"]'), null)
  await mounted.close()
})

test('Chat Context preview keeps chat model/prompt snapshots and loads the selected book media profile', async () => {
  const selections = await persistence.getBookProfileSelections(fixture.book.id)
  const text = profile(selections.text)
  const prompt = profiles.createSettingsProfile('chat', 'Preview snapshot prompt')
  profiles.saveSettingsProfile({ ...prompt, settings: ai.withPromptSystemPrompt(prompt.settings, 'assistant', 'CHAT SNAPSHOT MARKER') })
  profiles.saveSettingsProfile({ ...text, settings: { ...text.settings, chatModel: 'snapshot-model', chatPromptPresetId: prompt.id } })
  const chat = await chats.createChat(fixture.book.id, 'Preview snapshot chat')
  profiles.saveSettingsProfile({ ...profile(prompt.id), settings: ai.withPromptSystemPrompt(profile(prompt.id).settings, 'assistant', 'LIVE PRESET MUST NOT REPLACE SNAPSHOT') })
  profiles.saveSettingsProfile({ ...profile(text.id), settings: { ...profile(text.id).settings, chatModel: 'live-model-must-not-win' } })
  const image = profiles.createSettingsProfile('image', 'Book preview media')
  const favorite = { ...media.imageFavorite(media.documentedImageModels.find(model => model.provider === 'openai'), []), alias: 'book-preview-only-alias' }
  profiles.saveSettingsProfile({ ...image, media: { favorites: [favorite], defaultAlias: favorite.alias, defaultAliases: { 'text-to-image': favorite.alias } } })
  await persistence.saveBookProfileSelections(fixture.book.id, { ...selections, image: image.id })
  const mounted = await mount(App, { initialTab: 'context', book: { id: fixture.book.id, title: fixture.book.title, contextType: 'chat', chatId: chat.id } })
  await settle()
  assert.match(mounted.host.textContent, /CHAT SNAPSHOT MARKER/)
  assert.match(mounted.host.textContent, /snapshot-model/)
  assert.match(mounted.host.textContent, /book-preview-only-alias/)
  assert.doesNotMatch(mounted.host.textContent, /LIVE PRESET MUST NOT REPLACE SNAPSHOT|live-model-must-not-win/)
  await mounted.close()
})

test('dirty profile picker remembers its requested destination through Save and Discard', async () => {
  const first = profiles.createSettingsProfile('text', 'Picker source')
  const second = profiles.createSettingsProfile('text', 'Picker destination')
  const mounted = await mount(Panel, panelProps({ initialProfileId: first.id }))
  await change(field(mounted.host, 'Profile name'), 'Saved picker source')
  await change(field(mounted.host, 'Profile / preset'), second.id)
  await click(button(mounted.host, 'Save and continue'))
  assert.equal(profile(first.id).name, 'Saved picker source')
  assert.equal(field(mounted.host, 'Profile / preset').value, second.id)
  await change(field(mounted.host, 'Profile name'), 'Discarded picker destination')
  await change(field(mounted.host, 'Profile / preset'), first.id)
  await click(button(mounted.host, 'Discard and continue'))
  assert.equal(field(mounted.host, 'Profile / preset').value, first.id)
  assert.equal(profile(second.id).name, 'Picker destination')
  await mounted.close()
})

function ControlledThemeHarness({ initial = ui.defaultUiSettings }) {
  const [value, onChange] = React.useState(() => structuredClone(initial))
  return React.createElement(React.Fragment, null,
    React.createElement(UiSettingsPanel, { value, onChange }),
    React.createElement('pre', { 'data-theme-value': true }, JSON.stringify(value)))
}
const themeValue = host => JSON.parse(host.querySelector('[data-theme-value]').textContent)

test('replacing a controlled theme draft discards the abandoned copy but preserves unrelated UI edits', async () => {
  const mounted = await mount(ControlledThemeHarness)
  await click(button(mounted.host, 'Create theme'))
  const abandoned = themeValue(mounted.host).activeThemeId
  await change(field(mounted.host, 'Theme name'), 'Abandoned copy')
  await click(button(mounted.host, 'Editor'))
  await click(mounted.host.querySelector('.ui-editor-settings input[type="checkbox"]'))
  await click(button(mounted.host, 'Theme'))
  await click(mounted.host.querySelector('[aria-label="Copy Warm Paper to customize"]'))
  const current = themeValue(mounted.host)
  assert.notEqual(current.activeThemeId, abandoned)
  assert.equal(current.customThemes.some(theme => theme.id === abandoned), false)
  assert.equal(current.highlightDialogue, true)
  await click(button(mounted.host, 'Cancel changes'))
  assert.equal(themeValue(mounted.host).customThemes.length, 0)
  assert.equal(themeValue(mounted.host).highlightDialogue, true)
  await mounted.close()
})

test('controlled theme reset and delete cannot resurrect stale cancel snapshots', async () => {
  const initial = ui.createCustomTheme({ ...ui.defaultUiSettings, activeThemeId: 'warm-paper' }, 'warm-paper')
  const oldTheme = initial.customThemes[0]
  const mounted = await mount(ControlledThemeHarness, { initial })
  await click(button(mounted.host, 'Edit active'))
  await click(mounted.host.querySelector(`[aria-label="Delete ${oldTheme.name}"]`))
  await click(button(mounted.host, 'Create theme'))
  await click(button(mounted.host, 'Cancel changes'))
  assert.equal(themeValue(mounted.host).customThemes.some(theme => theme.id === oldTheme.id), false)
  await click(button(mounted.host, 'Create theme'))
  await click(button(mounted.host, 'Reset to readable theme'))
  await click(button(mounted.host, 'Create theme'))
  await click(button(mounted.host, 'Cancel changes'))
  assert.equal(themeValue(mounted.host).activeThemeId, 'very-dark')
  await mounted.close()
})

test('successful UI profile Save ends palette editing without retaining an obsolete Cancel snapshot', async () => {
  const custom = profiles.createSettingsProfile('ui', 'Saved palette profile')
  const mounted = await mount(App, { initialProfileId: custom.id })
  await click(button(mounted.host, 'Create theme'))
  await change(field(mounted.host, 'Theme name'), 'Saved palette')
  assert.ok(mounted.host.querySelector('.ui-theme-editor'))
  await click(button(mounted.host, 'Save profile'))
  assert.equal(profile(custom.id).ui.customThemes.at(-1).name, 'Saved palette')
  assert.equal(mounted.host.querySelector('.ui-theme-editor'), null)
  assert.equal(button(mounted.host, 'Save profile').disabled, true)
  await click(button(mounted.host, 'Edit active'))
  await change(field(mounted.host, 'Theme name'), 'Unsaved palette name')
  await click(button(mounted.host, 'Cancel changes'))
  assert.equal(button(mounted.host, 'Save profile').disabled, true)
  assert.equal(profile(custom.id).ui.customThemes.at(-1).name, 'Saved palette')
  await mounted.close()
})

test('partial Application defaults Save retains only unsaved changes for retry', async () => {
  const text = profiles.createSettingsProfile('text', 'Partial default text')
  const story = profiles.createSettingsProfile('story', 'Partial default story')
  const previousStory = library().defaults.story
  const mounted = await mount(Panel, panelProps({ section: 'application' }))
  await change(field(mounted.host, 'Default Text models'), text.id)
  await change(field(mounted.host, 'Default Story prompt'), story.id)
  const originalSet = window.Storage.prototype.setItem
  let writes = 0
  window.Storage.prototype.setItem = function(key, value) {
    if (key === profiles.SETTINGS_PROFILES_STORAGE_KEY && ++writes === 2) throw new Error('Second default write failed')
    return originalSet.call(this, key, value)
  }
  try {
    await click(button(mounted.host, 'Save defaults'))
    assert.match(mounted.host.textContent, /Second default write failed/)
    assert.equal(library().defaults.text, text.id)
    assert.equal(library().defaults.story, previousStory)
    assert.equal(field(mounted.host, 'Default Story prompt').value, story.id)
    assert.equal(button(mounted.host, 'Save defaults').disabled, false)
  } finally { window.Storage.prototype.setItem = originalSet }
  await click(button(mounted.host, 'Save defaults'))
  assert.equal(library().defaults.story, story.id)
  assert.equal(button(mounted.host, 'Save defaults').disabled, true)
  await mounted.close()
})

test('text catalog reload keeps cached models on failure and ignores stale results after switching profiles', async () => {
  const connection = ai.saveAiSettings({ ...ai.loadAiSettings(), provider: 'openai', apiKey: 'catalog-test-key' })
  catalog.saveModelCatalog(connection, [{ id: 'cached-catalog-model' }])
  const first = profiles.createSettingsProfile('text', 'Catalog first')
  const second = profiles.createSettingsProfile('text', 'Catalog second')
  const originalFetch = globalThis.fetch
  const mounted = await mount(App, { initialProfileId: first.id })
  try {
    globalThis.fetch = async () => { throw new Error('Catalog offline') }
    await click(button(mounted.host, 'Reload model list'))
    assert.match(mounted.host.textContent, /Refresh failed; keeping 1 cached models\. Catalog offline/)
    let complete, signal
    globalThis.fetch = (_url, options) => { signal = options.signal; return new Promise(resolve => { complete = resolve }) }
    await click(button(mounted.host, 'Reload model list'))
    await change(field(mounted.host, 'Profile / preset'), second.id)
    assert.equal(signal.aborted, true)
    await act(async () => { complete({ ok: true, json: async () => ({ data: [{ id: 'stale-catalog-model' }] }) }); await delay() })
    assert.deepEqual(catalog.getCachedModelCatalog(connection).models.map(model => model.id), ['cached-catalog-model'])
    assert.doesNotMatch(mounted.host.textContent, /stale-catalog-model/)
  } finally { globalThis.fetch = originalFetch; await mounted.close() }
})

test('speech catalog credentials fall back to each global provider without activating it', () => {
  const connection = { ...ai.initialAiSettings, provider: 'nanogpt', apiKey: 'active-nano', speech: { ...ai.initialAiSettings.speech, apiKey: '', openaiApiKey: '' }, providerProfiles: { openai: { apiKey: 'inactive-openai' } } }
  const effective = profileCatalogSettings(profile(library().defaults.tts).settings, connection)
  assert.equal(effective.provider, 'nanogpt')
  assert.equal(effective.speech.apiKey, 'active-nano')
  assert.equal(effective.speech.openaiApiKey, 'inactive-openai')
  assert.equal(withoutProfileCredentials(effective).speech.apiKey, '')
})

test('profile changed during the asynchronous linked-book check is not overwritten by Save', async () => {
  const custom = profiles.createSettingsProfile('text', 'Concurrent save profile')
  const mounted = await mount(Panel, panelProps({ initialProfileId: custom.id }))
  await change(field(mounted.host, 'Profile name'), 'Local retained draft')
  await act(async () => {
    button(mounted.host, 'Save profile').click()
    profiles.saveSettingsProfile({ ...profile(custom.id), name: 'External saved name' })
    await delay()
  })
  await settle()
  assert.equal(profile(custom.id).name, 'External saved name')
  assert.equal(field(mounted.host, 'Profile name').value, 'Local retained draft')
  assert.match(mounted.host.textContent, /changed in another editor/)
  await mounted.close()
})

test.after(() => dom.window.close())

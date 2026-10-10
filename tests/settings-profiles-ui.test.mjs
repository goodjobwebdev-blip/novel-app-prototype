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
  stdin: { contents: `export { default as App } from './src/app/App.tsx'; export { default as Panel, BookProfilesPanel, profileLabels, profileCatalogSettings, withoutProfileCredentials } from './src/features/settings/SettingsProfilesPanel.tsx'; export { UiSettingsPanel } from './src/features/settings/UiSettingsPortal.tsx'; export * as profiles from './src/features/settings/settings-profiles.ts'; export * as ai from './src/shared/ai/ai-settings.ts'; export * as ui from './src/features/settings/ui-settings.ts'; export * as media from './src/features/images/image-settings.ts'; export * as persistence from './src/data/persistence.ts'; export * as chats from './src/features/chat/chat-service.ts'; export * as catalog from './src/shared/ai/model-catalog.ts'; export * as fake from './src/shared/ai/fake-provider.ts';`, resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'tsx' },
  bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react', 'react-dom', 'react-dom/client', 'react-dom/server'], jsx: 'automatic', loader: { '.css': 'empty' },
})
const module = { exports: {} }
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
const { App, Panel, BookProfilesPanel, profileLabels, UiSettingsPanel, profiles, ai, ui, media, persistence, chats, catalog, fake, profileCatalogSettings, withoutProfileCredentials } = module.exports
const fixture = await persistence.createBook(ai.initialAiSettings, 'Linked test book')
const library = () => profiles.loadSettingsProfiles()
const profile = id => library().profiles.find(item => item.id === id)
const defaults = () => Object.fromEntries(['text', 'tts', 'stt', 'image', 'video', 'ui', 'story', 'codex', 'summary'].map(kind => [kind, library().defaults[kind]]))
const delay = () => new Promise(resolve => setTimeout(resolve, 15))
async function settle() { await act(async () => { await delay(); await delay() }) }
async function mount(t, Component, props = {}) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  t.after(cleanup)
  let closed = false
  async function cleanup() {
    if (closed) return
    closed = true
    try { await act(async () => root.unmount()) } finally { host.remove() }
  }
  await act(async () => { root.render(React.createElement(Component, props)); await delay() })
  await settle()
  return { host, root, close: cleanup }
}
function button(host, label) {
  const found = [...host.querySelectorAll('button')].find(element => element.textContent.trim() === label)
  assert.ok(found, `Missing button: ${label}`)
  return found
}
async function click(element) { await act(async () => { element.click(); await delay() }); await settle() }
async function key(element, value) {
  assert.ok(element, `Missing keyboard target for ${value}`)
  await act(async () => { element.dispatchEvent(new window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })); await delay() })
  await settle()
}
async function openProfileMenu(host) {
  const trigger = host.querySelector('button[aria-label="Actions for profile"]')
  assert.ok(trigger, 'Missing profile Actions trigger')
  if (trigger.getAttribute('aria-expanded') !== 'true') await click(trigger)
  const menu = document.body.querySelector('[role="menu"][aria-label="Actions for profile"]')
  assert.ok(menu, 'Missing body-portaled profile menu after opening Actions')
  assert.equal(host.contains(menu), false)
  return menu
}
async function profileAction(host, label) {
  const menu = await openProfileMenu(host)
  const action = button(menu, label)
  assert.equal(action.getAttribute('role'), 'menuitem')
  assert.equal(action.disabled, false, `${label} should be available`)
  await click(action)
  assert.equal(Boolean(document.body.querySelector('[role="menu"][aria-label="Actions for profile"]')), false)
}
async function openRename(host) {
  await profileAction(host, 'Rename')
  const input = field(host, 'Profile name')
  assert.ok(input.closest('.profile-management-fields'), 'Rename belongs to inline management fields')
  return input
}
function assertNoManagementFields(host) {
  assert.equal(Boolean(host.querySelector('.profile-management-fields')), false)
  assert.equal([...host.querySelectorAll('label')].some(label => /^(?:Profile name|New profile name)$/.test(label.querySelector('.arc-field__label')?.textContent.trim() ?? label.textContent.trim())), false)
}
function assertBreadcrumbs(host, expected) {
  const nav = host.querySelector('nav.settings-breadcrumbs[aria-label="Settings location"]')
  assert.ok(nav, 'Missing accessible Settings location breadcrumb')
  const items = [...nav.querySelectorAll('ol > li')]
  assert.equal(JSON.stringify(items.map(item => item.textContent.trim())), JSON.stringify(expected))
  assert.equal(items.at(-1)?.getAttribute('aria-current'), 'page')
  assert.equal(items.slice(0, -1).some(item => item.hasAttribute('aria-current')), false)
}
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

test('App book navigation is only Profiles and Context; Home, Global Settings and Close remain adjacent', async (t) => {
  const mounted = await mount(t, App, { book: { id: fixture.book.id, title: fixture.book.title }, onHome() {}, onBack() {} })
  assert.equal([...mounted.host.querySelectorAll('.settings-rail nav button')].map(item => item.textContent.trim()).join('|'), 'Profiles|Context')
  const header = mounted.host.querySelector('.rail-header')
  assert.match(header.textContent, /Home.*Global Settings/)
  assert.ok(header.querySelector('[aria-label="Close settings"]'))
  await mounted.close()
})

test('global App navigation, last-book return, and prompt deep links select the exact profile', async (t) => {
  const custom = profiles.createSettingsProfile('summary', 'Summary deep link')
  const mounted = await mount(t, App, { initialProfileId: custom.id, lastBookTitle: 'Last Book', onLastBook() {}, onHome() {} })
  assert.equal([...mounted.host.querySelectorAll('.settings-rail nav button')].map(item => item.textContent.trim()).join('|'), 'AI|UI|Application|Sync')
  assert.ok(button(mounted.host, 'Back to last book · Last Book'))
  assert.equal(field(mounted.host, 'Profile / preset').value, custom.id)
  assertBreadcrumbs(mounted.host, ['Global Settings', 'AI', 'Prompts', profileLabels.summary, custom.name])
  assert.ok(mounted.host.querySelector('.response-length-setting'))
  assert.equal(Boolean(mounted.host.querySelector('.models-card')), false)
  await mounted.close()
})

test('text editor includes six roles, role-local caps and prompt selections, but no reveal speed controls or credentials', async (t) => {
  const mounted = await mount(t, App)
  assert.equal(mounted.host.querySelectorAll('.model-role-setting').length, 6)
  assert.ok(mounted.host.querySelector('#main-model-heading').closest('section').textContent.includes('Story / Main context cap'))
  assert.ok(mounted.host.querySelector('#codex-model-heading').closest('section').textContent.includes('Codex model context cap'))
  assert.ok(field(mounted.host, 'Chat prompt preset'))
  assert.ok(field(mounted.host, 'Character chat prompt preset'))
  assert.equal(Boolean(mounted.host.querySelector('[aria-label="Text reveal speed"]')), false)
  assert.ok(![...mounted.host.querySelectorAll('label')].some(label => label.textContent.includes('Custom reveal speed')), 'Reveal speed controls belong to the UI profile')
  assert.equal(Boolean(mounted.host.querySelector('input[type="password"]')), false)
  await mounted.close()
})

test('profile drafts do not autosave; dirty navigation requires Save or Discard and failures keep the draft', async (t) => {
  const custom = profiles.createSettingsProfile('text', 'Draft test')
  const ref = React.createRef()
  const mounted = await mount(t, Panel, panelProps({ initialProfileId: custom.id, ref }))
  await openRename(mounted.host)
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

test('Save warns with linked book titles; cancellation retains the draft and acceptance saves it', async (t) => {
  const custom = profiles.createSettingsProfile('text', 'Linked profile')
  await persistence.saveBookProfileSelections(fixture.book.id, { ...defaults(), text: custom.id })
  const mounted = await mount(t, Panel, panelProps({ initialProfileId: custom.id }))
  assert.match(mounted.host.textContent, /Used in 1 book/)
  assert.equal(button(await openProfileMenu(mounted.host), 'Delete').disabled, true)
  await openRename(mounted.host)
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

test('default profiles are protected; Duplicate creates an independent editable entry', async (t) => {
  const mounted = await mount(t, Panel, panelProps())
  const menu = await openProfileMenu(mounted.host)
  assert.equal(button(menu, 'Delete').disabled, true)
  assert.equal(button(menu, 'Set as default').disabled, true)
  await key(menu, 'Escape')
  await click(button(mounted.host, 'Duplicate'))
  const id = field(mounted.host, 'Profile / preset').value
  assert.notEqual(id, library().defaults.text)
  assert.ok(profile(id).name.endsWith('copy'))
  assert.equal(button(await openProfileMenu(mounted.host), 'Delete').disabled, false)
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

test('Connections owns speech/media keys, saves explicitly, and preserves media favorites', async (t) => {
  const originalMedia = media.loadImageSettings()
  const mounted = await mount(t, Panel, panelProps())
  await click(button(mounted.host, 'Connections'))
  assert.ok(field(mounted.host, 'NanoGPT Speech API key'))
  assert.ok(field(mounted.host, 'OpenAI media API key'))
  await change(field(mounted.host, 'OpenAI media API key'), 'local-media-key')
  assert.equal(media.loadImageSettings().keys.openai, originalMedia.keys.openai)
  await click(button(mounted.host, 'Save connections'))
  assert.equal(media.loadImageSettings().keys.openai, 'local-media-key')
  assert.equal(JSON.stringify(media.loadImageSettings().favorites), JSON.stringify(originalMedia.favorites))
  await mounted.close()
})

test('controlled UI editor reports changes without autosaving or applying document theme', async (t) => {
  const savedBefore = localStorage.getItem(ui.UI_SETTINGS_STORAGE_KEY)
  const themeBefore = document.documentElement.getAttribute('data-ui-theme')
  let changed
  const mounted = await mount(t, UiSettingsPanel, { value: structuredClone(ui.defaultUiSettings), onChange: value => { changed = value } })
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

test('image/video/UI deep links select independent controlled editors', async (t) => {
  for (const kind of ['image', 'video', 'ui']) {
    const custom = profiles.createSettingsProfile(kind, `${kind} deep link`)
    const mounted = await mount(t, App, { initialProfileId: custom.id })
    const picker = field(mounted.host, kind === 'ui' ? 'UI profile' : 'Profile / preset')
    assert.equal(picker.value, custom.id)
    assertBreadcrumbs(mounted.host, kind === 'ui'
      ? ['Global Settings', 'Appearance', custom.name]
      : ['Global Settings', 'AI', 'Models', profileLabels[kind], custom.name])
    assert.equal(Boolean(mounted.host.querySelector('input[type="password"]')), false)
    assert.match(mounted.host.textContent, kind === 'ui' ? /Custom reveal speed/ : kind === 'image' ? /Image models/ : /Video models/)
    await mounted.close()
  }
})

test('book Edit opens the selected global profile and dirty Back to Profiles requires explicit Discard', async (t) => {
  const mounted = await mount(t, App, { book: { id: fixture.book.id, title: fixture.book.title }, onBack() {} })
  const selected = (await persistence.getBookProfileSelections(fixture.book.id)).text
  await click(mounted.host.querySelector('[aria-label="Edit Text models profile"]'))
  assert.equal(field(mounted.host, 'Profile / preset').value, selected)
  await openRename(mounted.host)
  await change(field(mounted.host, 'Profile name'), 'Not applied')
  await click(button(mounted.host, `Back to Profiles · ${fixture.book.title}`))
  assert.ok(mounted.host.querySelector('[role="alertdialog"]'))
  await click(button(mounted.host, 'Discard and continue'))
  assert.equal([...mounted.host.querySelectorAll('.settings-rail nav button')].map(item => item.textContent.trim()).join('|'), 'Profiles|Context')
  assert.notEqual(profile(selected).name, 'Not applied')
  await mounted.close()
})

test('Application Context defaults remain global even when entering Global Settings from a book', async (t) => {
  const before = await persistence.getBookContextSettings(fixture.book.id)
  const mounted = await mount(t, App, { book: { id: fixture.book.id, title: fixture.book.title } })
  await click(button(mounted.host, 'Global Settings'))
  await click(button(mounted.host, 'Application'))
  await change(field(mounted.host, 'Previous Scenes to scan for Codex triggers'), '7')
  assert.equal(persistence.loadDefaultBookContextSettings().previousScenesForCodexTriggers, 7)
  assert.equal(JSON.stringify(await persistence.getBookContextSettings(fixture.book.id)), JSON.stringify(before))
  assert.ok(mounted.host.querySelector('.tts-cache-settings'))
  await mounted.close()
})

test('new deep-link props cannot replace an unsaved profile without an explicit choice', async (t) => {
  const first = profiles.createSettingsProfile('text', 'First deep link')
  const second = profiles.createSettingsProfile('summary', 'Second deep link')
  const mounted = await mount(t, App, { initialProfileId: first.id })
  await openRename(mounted.host)
  await change(field(mounted.host, 'Profile name'), 'Unsaved deep link name')
  await act(async () => mounted.root.render(React.createElement(App, { initialProfileId: second.id })))
  await settle()
  assert.ok(mounted.host.querySelector('[role="alertdialog"]'))
  assert.equal(field(mounted.host, 'Profile / preset').value, first.id)
  await click(button(mounted.host, 'Discard and continue'))
  assert.equal(field(mounted.host, 'Profile / preset').value, second.id)
  await mounted.close()
})

test('corrupt shared library shows a recoverable error without replacing saved data', async (t) => {
  const original = localStorage.getItem(profiles.SETTINGS_PROFILES_STORAGE_KEY)
  t.after(() => {
    if (original === null) localStorage.removeItem(profiles.SETTINGS_PROFILES_STORAGE_KEY)
    else localStorage.setItem(profiles.SETTINGS_PROFILES_STORAGE_KEY, original)
  })
  localStorage.setItem(profiles.SETTINGS_PROFILES_STORAGE_KEY, '{broken')
  const mounted = await mount(t, App, { onBack() {} })
  assert.match(mounted.host.textContent, /Settings unavailable/)
  assert.equal(localStorage.getItem(profiles.SETTINGS_PROFILES_STORAGE_KEY), '{broken')
  localStorage.setItem(profiles.SETTINGS_PROFILES_STORAGE_KEY, original)
  await click(button(mounted.host, 'Retry loading'))
  assert.ok(mounted.host.querySelector('.model-role-settings'))
  await mounted.close()
})

test('dirty profile switching and Set as default require an explicit Save or Discard', async (t) => {
  const first = profiles.createSettingsProfile('text', 'Switch first')
  const second = profiles.createSettingsProfile('text', 'Switch second')
  const oldDefault = library().defaults.text
  const mounted = await mount(t, Panel, panelProps({ initialProfileId: first.id }))
  await openRename(mounted.host)
  await change(field(mounted.host, 'Profile name'), 'Discarded first name')
  await change(field(mounted.host, 'Profile / preset'), second.id)
  assert.equal(field(mounted.host, 'Profile / preset').value, first.id)
  await click(button(mounted.host, 'Keep editing'))
  await profileAction(mounted.host, 'Set as default')
  assert.equal(library().defaults.text, oldDefault)
  await click(button(mounted.host, 'Save and continue'))
  assert.equal(profile(first.id).name, 'Discarded first name')
  assert.equal(library().defaults.text, first.id)
  const menu = await openProfileMenu(mounted.host)
  assert.equal(button(menu, 'Set as default').disabled, true)
  assert.equal(button(menu, 'Delete').disabled, true)
  await mounted.close()
})

test('Application default selections are explicit drafts, guarded on navigation, and failures retain selections', async (t) => {
  const replacement = profiles.createSettingsProfile('text', 'New default')
  profiles.saveSettingsProfile({ ...replacement, settings: { ...replacement.settings, mainModel: 'profile-default-model' } })
  const legacy = ai.loadAiSettings()
  ai.saveAiSettings({ ...legacy, mainModel: 'legacy-model-must-not-win' })
  const originalDefault = library().defaults.text
  let notified
  const ref = React.createRef()
  const mounted = await mount(t, Panel, panelProps({ section: 'application', ref, onSaved: value => { notified = value } }))
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

test('failed Set as default does not change protection or discard a profile', async (t) => {
  const custom = profiles.createSettingsProfile('text', 'Fail default button')
  const oldDefault = library().defaults.text
  const mounted = await mount(t, Panel, panelProps({ initialProfileId: custom.id }))
  const originalSet = window.Storage.prototype.setItem
  window.Storage.prototype.setItem = function(key, value) { if (key === profiles.SETTINGS_PROFILES_STORAGE_KEY) throw new Error('Default button failure'); return originalSet.call(this, key, value) }
  try {
    await profileAction(mounted.host, 'Set as default')
    assert.match(mounted.host.textContent, /Default button failure/)
    assert.equal(library().defaults.text, oldDefault)
    assert.equal(field(mounted.host, 'Profile / preset').value, custom.id)
    assert.equal(button(await openProfileMenu(mounted.host), 'Delete').disabled, false)
  } finally { window.Storage.prototype.setItem = originalSet }
  await mounted.close()
})

test('editing another provider connection never activates it or replaces profile models; Save callback resolves defaults', async (t) => {
  const originalConnection = ai.loadAiSettings()
  ai.saveAiSettings({ ...originalConnection, provider: 'nanogpt', apiKey: 'active-nano-key', mainModel: 'legacy-unused-main' })
  const profilesBefore = library().profiles
  let saved
  const mounted = await mount(t, Panel, panelProps({ onSaved: value => { saved = value } }))
  await click(button(mounted.host, 'Connections'))
  await change(field(mounted.host, 'Connection provider'), 'openai')
  await change(mounted.host.querySelector('[aria-label="Text API key"]'), 'global-openai-key')
  assert.equal(field(mounted.host, 'Active text provider').value, 'nanogpt')
  assert.equal(ai.loadAiSettings().provider, 'nanogpt')
  assert.equal(JSON.stringify(library().profiles), JSON.stringify(profilesBefore))
  await click(button(mounted.host, 'Save connections'))
  assert.equal(ai.loadAiSettings().provider, 'nanogpt')
  assert.equal(ai.loadAiSettings().apiKey, 'active-nano-key')
  assert.equal(ai.loadAiSettings().providerProfiles.openai.apiKey, 'global-openai-key')
  assert.equal(saved.mainModel, profile(library().defaults.text).settings.mainModel)
  assert.notEqual(saved.mainModel, 'legacy-unused-main')
  assert.equal(JSON.stringify(library().profiles), JSON.stringify(profilesBefore))
  await mounted.close()
})

test('UI to AI navigation is guarded and never renders a UI kind in the Models pane', async (t) => {
  const mounted = await mount(t, App, { initialProfileId: library().defaults.ui })
  await change(field(mounted.host, 'Custom reveal speed'), '72')
  await click(button(mounted.host, 'AI'))
  assert.ok(mounted.host.querySelector('[role="alertdialog"]'))
  assert.ok(mounted.host.querySelector('.ui-settings-panel'))
  await click(button(mounted.host, 'Discard and continue'))
  assert.equal(field(mounted.host, 'Model profile type').value, 'text')
  assert.equal(Boolean(mounted.host.querySelector('.ui-settings-panel')), false)
  assert.equal(mounted.host.querySelectorAll('#ai-panel-models').length, 1)
  assert.equal(mounted.host.querySelector('#ai-panel-models').getAttribute('aria-labelledby'), 'ai-tab-models')
  await mounted.close()
})

test('controlled UI profile Save failures retain flags and speed, without touching legacy UI storage', async (t) => {
  const custom = profiles.createSettingsProfile('ui', 'UI failed save')
  const originalUi = profile(custom.id).ui
  const storedUi = localStorage.getItem(ui.UI_SETTINGS_STORAGE_KEY)
  const mounted = await mount(t, App, { initialProfileId: custom.id })
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
    assert.equal(JSON.stringify(profile(custom.id).ui), JSON.stringify(originalUi))
    assert.equal(localStorage.getItem(ui.UI_SETTINGS_STORAGE_KEY), storedUi)
  } finally { window.Storage.prototype.setItem = originalSet }
  await click(button(mounted.host, 'Save profile'))
  assert.equal(profile(custom.id).settings.generationWordDelayMs, '73')
  assert.equal(profile(custom.id).ui.highlightDialogue, !originalUi.highlightDialogue)
  assert.equal(localStorage.getItem(ui.UI_SETTINGS_STORAGE_KEY), storedUi)
  await mounted.close()
})

test('Save-in-flight blocks double writes, profile switching and late editor changes', async (t) => {
  const custom = profiles.createSettingsProfile('text', 'Save gate')
  const ref = React.createRef()
  let edit
  const mounted = await mount(t, Panel, panelProps({ initialProfileId: custom.id, ref, renderEditor: props => { edit = props; return null } }))
  await openRename(mounted.host)
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

test('Fake connection preserves local-only notice and accessible request-trace details', async (t) => {
  ai.saveAiSettings({ ...ai.loadAiSettings(), provider: 'fake', apiKey: '', baseUrl: '' })
  fake.clearFakeProviderTrace()
  const mounted = await mount(t, App)
  await click(button(mounted.host, 'Reload model list'))
  assert.match(mounted.host.textContent, /No network request was made/)
  await click(button(mounted.host, 'Connections'))
  assert.match(mounted.host.textContent, /No text-AI network request is sent/)
  const trace = mounted.host.querySelector('[aria-label="Fake provider request trace"]')
  assert.ok(trace)
  assert.match(trace.textContent, /Session only · last 20 requests/)
  assert.equal(button(trace, 'Clear trace').disabled, true)
  assert.equal(Boolean(mounted.host.querySelector('[aria-label="Text API key"]')), false)
  await mounted.close()
})

test('Chat Context preview keeps chat model/prompt snapshots and loads the selected book media profile', async (t) => {
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
  const mounted = await mount(t, App, { initialTab: 'context', book: { id: fixture.book.id, title: fixture.book.title, contextType: 'chat', chatId: chat.id } })
  await settle()
  assert.match(mounted.host.textContent, /CHAT SNAPSHOT MARKER/)
  assert.match(mounted.host.textContent, /snapshot-model/)
  assert.match(mounted.host.textContent, /book-preview-only-alias/)
  assert.doesNotMatch(mounted.host.textContent, /LIVE PRESET MUST NOT REPLACE SNAPSHOT|live-model-must-not-win/)
  await mounted.close()
})

test('dirty profile picker remembers its requested destination through Save and Discard', async (t) => {
  const first = profiles.createSettingsProfile('text', 'Picker source')
  const second = profiles.createSettingsProfile('text', 'Picker destination')
  const mounted = await mount(t, Panel, panelProps({ initialProfileId: first.id }))
  await openRename(mounted.host)
  await change(field(mounted.host, 'Profile name'), 'Saved picker source')
  await change(field(mounted.host, 'Profile / preset'), second.id)
  await click(button(mounted.host, 'Save and continue'))
  assert.equal(profile(first.id).name, 'Saved picker source')
  assert.equal(field(mounted.host, 'Profile / preset').value, second.id)
  await openRename(mounted.host)
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

test('replacing a controlled theme draft discards the abandoned copy but preserves unrelated UI edits', async (t) => {
  const mounted = await mount(t, ControlledThemeHarness)
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

test('controlled theme reset and delete cannot resurrect stale cancel snapshots', async (t) => {
  const initial = ui.createCustomTheme({ ...ui.defaultUiSettings, activeThemeId: 'warm-paper' }, 'warm-paper')
  const oldTheme = initial.customThemes[0]
  const mounted = await mount(t, ControlledThemeHarness, { initial })
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

test('successful UI profile Save ends palette editing without retaining an obsolete Cancel snapshot', async (t) => {
  const custom = profiles.createSettingsProfile('ui', 'Saved palette profile')
  const mounted = await mount(t, App, { initialProfileId: custom.id })
  await click(button(mounted.host, 'Create theme'))
  await change(field(mounted.host, 'Theme name'), 'Saved palette')
  assert.ok(mounted.host.querySelector('.ui-theme-editor'))
  await click(button(mounted.host, 'Save profile'))
  assert.equal(profile(custom.id).ui.customThemes.at(-1).name, 'Saved palette')
  assert.equal(Boolean(mounted.host.querySelector('.ui-theme-editor')), false)
  assert.equal(button(mounted.host, 'Save profile').disabled, true)
  await click(button(mounted.host, 'Edit active'))
  await change(field(mounted.host, 'Theme name'), 'Unsaved palette name')
  await click(button(mounted.host, 'Cancel changes'))
  assert.equal(button(mounted.host, 'Save profile').disabled, true)
  assert.equal(profile(custom.id).ui.customThemes.at(-1).name, 'Saved palette')
  await mounted.close()
})

test('partial Application defaults Save retains only unsaved changes for retry', async (t) => {
  const text = profiles.createSettingsProfile('text', 'Partial default text')
  const story = profiles.createSettingsProfile('story', 'Partial default story')
  const previousStory = library().defaults.story
  const mounted = await mount(t, Panel, panelProps({ section: 'application' }))
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

test('text catalog reload keeps cached models on failure and ignores stale results after switching profiles', async (t) => {
  const connection = ai.saveAiSettings({ ...ai.loadAiSettings(), provider: 'openai', apiKey: 'catalog-test-key' })
  catalog.saveModelCatalog(connection, [{ id: 'cached-catalog-model' }])
  const first = profiles.createSettingsProfile('text', 'Catalog first')
  const second = profiles.createSettingsProfile('text', 'Catalog second')
  const originalFetch = globalThis.fetch
  const mounted = await mount(t, App, { initialProfileId: first.id })
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
    assert.equal(catalog.getCachedModelCatalog(connection).models.map(model => model.id).join('|'), 'cached-catalog-model')
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

test('profile changed during the asynchronous linked-book check is not overwritten by Save', async (t) => {
  const custom = profiles.createSettingsProfile('text', 'Concurrent save profile')
  const mounted = await mount(t, Panel, panelProps({ initialProfileId: custom.id }))
  await openRename(mounted.host)
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

test('profile headers start compact with shared/default metadata and body-portaled management actions', async (t) => {
  for (const kind of ['text', 'ui']) {
    const id = library().defaults[kind]
    const mounted = await mount(t, Panel, panelProps({ section: kind === 'ui' ? 'appearance' : 'ai', initialProfileId: id }))
    const header = mounted.host.querySelector('.profile-header-main')
    assert.ok(header, 'Missing compact profile header')
    assert.equal(field(header, kind === 'ui' ? 'UI profile' : 'Profile / preset').value, id)
    assert.ok(button(header, 'Duplicate'))
    assert.ok(header.querySelector('button[aria-label="Actions for profile"]'))
    assertNoManagementFields(mounted.host)
    assert.equal([...header.querySelectorAll('button')].some(item => ['Rename', 'Create', 'Delete', 'Set as default'].includes(item.textContent.trim())), false)
    const meta = mounted.host.querySelector('.profile-header-meta')
    assert.ok(meta, 'Missing profile metadata')
    assert.match(meta.textContent, /Shared profile/)
    assert.match(meta.textContent, /Default/)
    const used = await persistence.listSettingsProfileUsage(id)
    assert.equal(meta.querySelector('details.profile-usage summary')?.textContent.trim(), `Used in ${used.length} book${used.length === 1 ? '' : 's'}`)
    const menu = await openProfileMenu(mounted.host)
    assert.equal(JSON.stringify([...menu.querySelectorAll('[role="menuitem"]')].map(item => item.textContent.trim())), JSON.stringify(['Rename', 'Create new profile', 'Set as default', 'Delete']))
    assert.equal(button(menu, 'Set as default').disabled, true)
    assert.equal(button(menu, 'Delete').disabled, true)
    await mounted.close()
    assert.equal(document.body.querySelectorAll('[role="menu"][aria-label="Actions for profile"]').length, 0)
  }
})

test('profile Actions opens by keyboard and Escape returns focus to its trigger', async (t) => {
  const custom = profiles.createSettingsProfile('text', 'Keyboard actions')
  const mounted = await mount(t, Panel, panelProps({ initialProfileId: custom.id }))
  const trigger = mounted.host.querySelector('button[aria-label="Actions for profile"]')
  assert.ok(trigger)
  assert.equal(trigger.getAttribute('aria-haspopup'), 'menu')
  assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  for (const openingKey of ['ArrowDown', 'ArrowUp']) {
    trigger.focus()
    await key(trigger, openingKey)
    const menu = document.body.querySelector('[role="menu"][aria-label="Actions for profile"]')
    assert.ok(menu, `${openingKey} should open the menu`)
    assert.equal(mounted.host.contains(menu), false)
    assert.equal(trigger.getAttribute('aria-expanded'), 'true')
    assert.equal(trigger.getAttribute('aria-controls'), menu.id)
    assert.ok(document.activeElement === button(menu, 'Rename'), 'First enabled action receives focus')
    await key(document.activeElement, 'ArrowDown')
    assert.ok(document.activeElement === button(menu, 'Create new profile'), 'ArrowDown moves to the next action')
    await key(document.activeElement, 'Escape')
    assert.equal(document.body.querySelectorAll('[role="menu"][aria-label="Actions for profile"]').length, 0)
    assert.equal(trigger.getAttribute('aria-expanded'), 'false')
    assert.ok(document.activeElement === trigger, 'Escape restores focus to Actions')
  }
})

test('Rename focuses its inline input; Done closes management without saving the draft', async (t) => {
  const custom = profiles.createSettingsProfile('text', 'Explicit rename')
  let saves = 0
  const mounted = await mount(t, Panel, panelProps({ initialProfileId: custom.id, onSaved: () => { saves += 1 } }))
  const input = await openRename(mounted.host)
  assert.ok(document.activeElement === input, 'Rename focuses the profile name input')
  await change(input, 'Renamed draft')
  assert.equal(profile(custom.id).name, 'Explicit rename')
  await click(button(mounted.host.querySelector('.profile-management-fields'), 'Done'))
  assertNoManagementFields(mounted.host)
  assert.equal(profile(custom.id).name, 'Explicit rename')
  assert.equal(saves, 0)
  assert.equal(button(mounted.host, 'Save profile').disabled, false)
  assert.match(mounted.host.querySelector('.profile-save-bar').textContent, /Unsaved draft/)
  const reopened = await openRename(mounted.host)
  assert.equal(reopened.value, 'Renamed draft')
  await click(button(mounted.host, 'Done'))
  await click(button(mounted.host, 'Save profile'))
  assert.equal(profile(custom.id).name, 'Renamed draft')
  assert.equal(saves, 1)
  assert.equal(button(mounted.host, 'Save profile').disabled, true)
})

test('Create new profile reveals inline creation fields; Cancel creates nothing and clears the name', async (t) => {
  const source = profiles.createSettingsProfile('text', 'Creation source')
  const beforeDefaults = JSON.stringify(library().defaults)
  const beforeIds = JSON.stringify(library().profiles.map(item => item.id))
  const mounted = await mount(t, Panel, panelProps({ initialProfileId: source.id }))
  const picker = mounted.host.querySelector('.profile-header-main select')
  assert.ok(picker)
  await profileAction(mounted.host, 'Create new profile')
  const management = mounted.host.querySelector('.profile-management-fields')
  assert.ok(management)
  const input = field(management, 'New profile name')
  assert.equal(management.querySelectorAll('input').length, 1)
  assert.ok(button(management, 'Create'))
  await change(input, 'Cancelled profile')
  await click(button(management, 'Cancel'))
  assertNoManagementFields(mounted.host)
  assert.equal(JSON.stringify(library().profiles.map(item => item.id)), beforeIds)
  assert.equal(field(mounted.host, 'Profile / preset').value, source.id)
  await profileAction(mounted.host, 'Create new profile')
  assert.equal(field(mounted.host, 'New profile name').value, '')
  await change(field(mounted.host, 'New profile name'), 'Created inline profile')
  await click(button(mounted.host.querySelector('.profile-management-fields'), 'Create'))
  assert.equal(picker.disabled, false)
  assert.ok(document.activeElement === picker, 'Successful creation focuses the persistent profile picker after busy clears')
  const createdId = field(mounted.host, 'Profile / preset').value
  assert.notEqual(createdId, source.id)
  assert.equal(profile(createdId).name, 'Created inline profile')
  assert.equal(library().profiles.length, JSON.parse(beforeIds).length + 1)
  assert.equal(JSON.stringify(library().defaults), beforeDefaults)
  assertNoManagementFields(mounted.host)
  assert.equal(button(mounted.host, 'Save profile').disabled, true)
})

test('Settings breadcrumbs follow AI tabs, profile kind/picker, draft name and global sections', async (t) => {
  const first = profiles.createSettingsProfile('text', 'Breadcrumb first')
  const second = profiles.createSettingsProfile('text', 'Breadcrumb second')
  const mounted = await mount(t, App, { initialProfileId: first.id })
  assertBreadcrumbs(mounted.host, ['Global Settings', 'AI', 'Models', profileLabels.text, first.name])
  await openRename(mounted.host)
  await change(field(mounted.host, 'Profile / preset'), second.id)
  await settle()
  assertNoManagementFields(mounted.host)
  assertBreadcrumbs(mounted.host, ['Global Settings', 'AI', 'Models', profileLabels.text, second.name])
  await openRename(mounted.host)
  await change(field(mounted.host, 'Profile name'), 'Breadcrumb draft')
  assertBreadcrumbs(mounted.host, ['Global Settings', 'AI', 'Models', profileLabels.text, 'Breadcrumb draft'])
  await click(button(mounted.host, 'Done'))
  await click(button(mounted.host, 'Discard'))
  await click(button(mounted.host, 'Prompts'))
  assertBreadcrumbs(mounted.host, ['Global Settings', 'AI', 'Prompts', profileLabels.story, profile(library().defaults.story).name])
  await change(field(mounted.host, 'Prompt preset type'), 'summary')
  await settle()
  assertBreadcrumbs(mounted.host, ['Global Settings', 'AI', 'Prompts', profileLabels.summary, profile(library().defaults.summary).name])
  await click(button(mounted.host, 'Connections'))
  assertBreadcrumbs(mounted.host, ['Global Settings', 'AI', 'Connections'])
  await click(button(mounted.host, 'UI'))
  assertBreadcrumbs(mounted.host, ['Global Settings', 'Appearance', profile(library().defaults.ui).name])
  await click(button(mounted.host, 'Application'))
  assertBreadcrumbs(mounted.host, ['Global Settings', 'Application'])
  await click(button(mounted.host, 'Sync'))
  assertBreadcrumbs(mounted.host, ['Global Settings', 'Sync'])
})

test('book Edit identifies global shared scope; Duplicate does not reassign the book or change defaults', async (t) => {
  const original = profiles.createSettingsProfile('text', 'Book origin shared profile')
  const created = await persistence.createBook(ai.initialAiSettings, 'Origin contract book')
  await persistence.saveBookProfileSelections(created.book.id, { ...defaults(), text: original.id })
  const beforeSelections = JSON.stringify(await persistence.getBookProfileSelections(created.book.id))
  const beforeDefaults = JSON.stringify(library().defaults)
  const beforeConfiguration = JSON.stringify(profiles.profileConfiguration(profile(original.id)))
  const mounted = await mount(t, App, { book: { id: created.book.id, title: created.book.title } })
  assertBreadcrumbs(mounted.host, ['Book settings', created.book.title, 'Profiles'])
  await click(button(mounted.host, 'Context'))
  assertBreadcrumbs(mounted.host, ['Book settings', created.book.title, 'Context'])
  await click(button(mounted.host, 'Profiles'))
  await click(mounted.host.querySelector('[aria-label="Edit Text models profile"]'))
  assertBreadcrumbs(mounted.host, ['Global Settings', 'AI', 'Models', profileLabels.text, original.name])
  const origin = mounted.host.querySelector('.profile-origin-note')
  assert.ok(origin)
  assert.equal(origin.textContent.trim(), `Opened from “${created.book.title}”. You are editing a shared global profile, not a book-only override.`)
  assert.equal(mounted.host.querySelector('details.profile-usage summary')?.textContent.trim(), 'Used in 1 book')
  const warning = mounted.host.querySelector('.profile-linked-warning')
  assert.ok(warning)
  assert.match(warning.textContent, /shared|linked/i)
  assert.match(warning.textContent, /1/)
  assert.equal(button(await openProfileMenu(mounted.host), 'Delete').disabled, true)
  await key(document.body.querySelector('[role="menu"][aria-label="Actions for profile"]'), 'Escape')
  await click(button(mounted.host.querySelector('.profile-header-main'), 'Duplicate'))
  const copyId = field(mounted.host, 'Profile / preset').value
  assert.notEqual(copyId, original.id)
  assert.equal(JSON.stringify(profiles.profileConfiguration(profile(copyId))), beforeConfiguration)
  assert.equal(JSON.stringify(profiles.profileConfiguration(profile(original.id))), beforeConfiguration)
  assert.equal(JSON.stringify(await persistence.getBookProfileSelections(created.book.id)), beforeSelections)
  assert.equal(JSON.stringify(library().defaults), beforeDefaults)
  assert.equal(mounted.host.querySelector('details.profile-usage summary')?.textContent.trim(), 'Used in 0 books')
  const copyWarning = mounted.host.querySelector('.profile-linked-warning')
  assert.ok(copyWarning, 'Shared effects warning remains visible for an unused copy')
  assert.match(copyWarning.textContent, /No books currently use this profile/)
  const notice = mounted.host.querySelector('.profile-copy-notice[role="status"]')
  assert.ok(notice, 'Duplicate reports the saved copy without implying book reassignment')
  assert.match(notice.textContent, /select|choose/i)
  assert.match(notice.textContent, /Profiles/)
  assert.match(notice.textContent, /book/i)
  assertNoManagementFields(mounted.host)
  await click(button(mounted.host, `Back to Profiles · ${created.book.title}`))
  assertBreadcrumbs(mounted.host, ['Book settings', created.book.title, 'Profiles'])
  assert.equal(field(mounted.host, profileLabels.text).value, original.id)
})

for (const choice of ['Save and continue', 'Discard and continue']) {
  test(`Duplicate respects ${choice} and copies saved configuration, never unsaved edits`, async (t) => {
    const source = profiles.createSettingsProfile('text', `Duplicate guard ${choice}`)
    profiles.saveSettingsProfile({ ...source, settings: { ...source.settings, mainModel: 'duplicate-saved-model' } })
    const beforeDefaults = JSON.stringify(library().defaults)
    const beforeSelections = JSON.stringify(await persistence.getBookProfileSelections(fixture.book.id))
    const beforeCount = library().profiles.length
    let editor
    const mounted = await mount(t, Panel, panelProps({ initialProfileId: source.id, renderEditor: props => { editor = props; return null } }))
    const picker = mounted.host.querySelector('.profile-header-main select')
    assert.ok(picker)
    await openRename(mounted.host)
    await change(field(mounted.host, 'Profile name'), 'Duplicate edited source')
    await act(async () => editor.onChange({ ...editor.settings, mainModel: 'duplicate-edited-model' }))
    await click(button(mounted.host, 'Duplicate'))
    assert.ok(mounted.host.querySelector('[role="alertdialog"]'))
    assert.equal(library().profiles.length, beforeCount)
    assert.equal(field(mounted.host, 'Profile / preset').value, source.id)
    await click(button(mounted.host, 'Keep editing'))
    assert.equal(field(mounted.host, 'Profile name').value, 'Duplicate edited source')
    assert.equal(profile(source.id).settings.mainModel, 'duplicate-saved-model')
    assert.equal(library().profiles.length, beforeCount)
    await click(button(mounted.host, 'Duplicate'))
    await click(button(mounted.host, choice))
    assert.equal(mounted.host.querySelectorAll('[role="alertdialog"]').length, 0)
    assert.equal(picker.disabled, false)
    assert.ok(document.activeElement === picker, 'Successful guarded duplication focuses the persistent profile picker after busy and pending clear')
    const copyId = field(mounted.host, 'Profile / preset').value
    const saved = choice === 'Save and continue'
    assert.notEqual(copyId, source.id)
    assert.equal(library().profiles.length, beforeCount + 1)
    assert.equal(profile(source.id).name, saved ? 'Duplicate edited source' : source.name)
    assert.equal(profile(source.id).settings.mainModel, saved ? 'duplicate-edited-model' : 'duplicate-saved-model')
    assert.equal(profile(copyId).name, `${profile(source.id).name} copy`)
    assert.equal(JSON.stringify(profiles.profileConfiguration(profile(copyId))), JSON.stringify(profiles.profileConfiguration(profile(source.id))))
    assert.equal(JSON.stringify(library().defaults), beforeDefaults)
    assert.equal(JSON.stringify(await persistence.getBookProfileSelections(fixture.book.id)), beforeSelections)
    assertNoManagementFields(mounted.host)
    assert.equal(button(mounted.host, 'Save profile').disabled, true)
    assert.ok(mounted.host.querySelector('.profile-copy-notice[role="status"]'))
  })
}

test('chat prompt copies direct book-origin guidance to their Text models role without reassigning it', async (t) => {
  const prompts = Object.fromEntries(['chat', 'character'].map(kind => [kind, profiles.createSettingsProfile(kind, `${kind} role guidance`)]))
  const text = profiles.createSettingsProfile('text', 'Prompt guidance Text models')
  profiles.saveSettingsProfile({ ...text, settings: { ...text.settings, chatPromptPresetId: prompts.chat.id, characterPromptPresetId: prompts.character.id } })
  const created = await persistence.createBook(ai.initialAiSettings, 'Prompt guidance book')
  await persistence.saveBookProfileSelections(created.book.id, { ...defaults(), text: text.id })
  const beforeSelections = JSON.stringify(await persistence.getBookProfileSelections(created.book.id))
  const beforeDefaults = JSON.stringify(library().defaults)
  const beforeText = JSON.stringify(profiles.profileConfiguration(profile(text.id)))
  for (const kind of ['chat', 'character']) {
    const source = prompts[kind]
    const role = kind === 'chat' ? 'Chat' : 'Character chat'
    const mounted = await mount(t, Panel, panelProps({ initialProfileId: source.id, bookOriginTitle: created.book.title }))
    assertNoManagementFields(mounted.host)
    await click(button(mounted.host.querySelector('.profile-header-main'), 'Duplicate'))
    const copyId = field(mounted.host, 'Profile / preset').value
    assert.notEqual(copyId, source.id)
    assert.equal(profile(copyId).kind, kind)
    assert.equal(JSON.stringify(profiles.profileConfiguration(profile(copyId))), JSON.stringify(profiles.profileConfiguration(profile(source.id))))
    const notice = mounted.host.querySelector('.profile-copy-notice[role="status"]')
    const about = mounted.host.querySelector('details.profile-about')
    assert.ok(notice)
    assert.ok(about)
    for (const guidance of [notice, about]) {
      assert.match(guidance.textContent, /Text models profile/)
      assert.equal(guidance.textContent.includes(role), true)
      assert.doesNotMatch(guidance.textContent, /Return to Profiles[^.]*select this copy|select (?:this |the )?copy (?:directly )?in (?:a |the )?book[’']s Profiles/i)
      assert.doesNotMatch(guidance.textContent, /(?:select|choose) (?:this |the )?(?:prompt|preset)(?: copy)? (?:directly )?in (?:the )?(?:book(?:[’']s)? )?Profiles/i)
    }
    assert.equal(JSON.stringify(await persistence.getBookProfileSelections(created.book.id)), beforeSelections)
    assert.equal(JSON.stringify(library().defaults), beforeDefaults)
    assert.equal(JSON.stringify(profiles.profileConfiguration(profile(text.id))), beforeText)
    await mounted.close()
  }
})

test('shared warning timing distinguishes active appearance, new chats and the next generation operation', async (t) => {
  for (const kind of ['ui', 'chat', 'text']) {
    const id = library().defaults[kind]
    let usage = await persistence.listSettingsProfileUsage(id)
    if (!usage.length) {
      const created = await persistence.createBook(ai.initialAiSettings, `${kind} shared timing book`)
      const selections = await persistence.getBookProfileSelections(created.book.id)
      if (kind === 'chat') {
        const text = profiles.createSettingsProfile('text', 'Chat timing Text models')
        profiles.saveSettingsProfile({ ...text, settings: { ...text.settings, chatPromptPresetId: id } })
        await persistence.saveBookProfileSelections(created.book.id, { ...selections, text: text.id })
      } else {
        await persistence.saveBookProfileSelections(created.book.id, { ...selections, [kind]: id })
      }
      usage = await persistence.listSettingsProfileUsage(id)
    }
    assert.ok(usage.length > 0, `${kind} timing must be checked with a linked book`)
    const mounted = await mount(t, Panel, panelProps({ section: kind === 'ui' ? 'appearance' : 'ai', initialProfileId: id }))
    assert.equal(mounted.host.querySelector('details.profile-usage summary')?.textContent.trim(), `Used in ${usage.length} book${usage.length === 1 ? '' : 's'}`)
    const warning = mounted.host.querySelector('.profile-linked-warning')
    assert.ok(warning)
    assert.match(warning.textContent, new RegExp(`\\b${usage.length}\\s+linked books?\\b`))
    if (kind === 'ui') {
      assert.match(warning.textContent, /appearance/i)
      assert.match(warning.textContent, /immediately/i)
      assert.match(warning.textContent, /active/i)
      assert.doesNotMatch(warning.textContent, /next operation|new chats/i)
    } else if (kind === 'chat') {
      assert.match(warning.textContent, /new chats/i)
      assert.doesNotMatch(warning.textContent, /next operation|immediately/i)
    } else {
      assert.match(warning.textContent, /next operation/i)
      assert.doesNotMatch(warning.textContent, /immediately|new chats/i)
    }
    await mounted.close()
  }
})

test('checking or failed linked-book usage never invents a count and keeps Delete disabled', async (t) => {
  const custom = profiles.createSettingsProfile('text', 'Usage unavailable')
  const db = await persistence.database()
  const entities = db.table('entities')
  const originalWhere = entities.where
  let release, reject
  const pendingBooks = new Promise((resolve, fail) => { release = resolve; reject = fail })
  t.after(() => { entities.where = originalWhere; release([]) })
  // Hold only the public book-list query, without blocking unrelated persistence reads.
  entities.where = function(...args) {
    const clause = originalWhere.apply(this, args)
    if (args[0] === 'type') {
      const originalEquals = clause.equals
      clause.equals = function(value) {
        const collection = originalEquals.call(this, value)
        if (value === 'book') collection.toArray = () => pendingBooks
        return collection
      }
    }
    return clause
  }
  const mounted = await mount(t, Panel, panelProps({ initialProfileId: custom.id }))
  const checking = [...mounted.host.querySelectorAll('.profile-header-meta [role="status"]')].find(item => item.textContent.includes('Checking linked books'))
  assert.ok(checking, 'Checking linked books is an accessible metadata status')
  assert.equal(mounted.host.querySelectorAll('details.profile-usage').length, 0)
  assert.doesNotMatch(mounted.host.textContent, /Used in \d+ books?/)
  assert.equal(mounted.host.querySelectorAll('.profile-linked-warning').length, 0)
  let menu = await openProfileMenu(mounted.host)
  assert.equal(button(menu, 'Delete').disabled, true)
  await key(menu, 'Escape')
  await act(async () => { reject(new Error('Usage query unavailable')); await delay() })
  await settle()
  const usageError = [...mounted.host.querySelectorAll('.profile-header-meta [role="alert"]')].find(item => item.textContent.includes('Linked books could not be checked'))
  assert.ok(usageError, 'Failed usage lookup is an accessible metadata alert')
  assert.equal(mounted.host.querySelectorAll('details.profile-usage').length, 0)
  assert.doesNotMatch(mounted.host.textContent, /Used in \d+ books?/)
  menu = await openProfileMenu(mounted.host)
  assert.equal(button(menu, 'Delete').disabled, true)
  await key(menu, 'Escape')
  entities.where = originalWhere
  await click(button(mounted.host, 'Retry linked books'))
  assert.equal(mounted.host.querySelector('details.profile-usage summary')?.textContent.trim(), 'Used in 0 books')
  const warning = mounted.host.querySelector('.profile-linked-warning')
  assert.ok(warning, 'Unused profiles still explain shared effects after usage is ready')
  assert.match(warning.textContent, /No books currently use this profile/)
  assert.equal(button(await openProfileMenu(mounted.host), 'Delete').disabled, false)
})

test.beforeEach(t => {
  const originalSet = window.Storage.prototype.setItem
  const originalConfirm = window.confirm
  const originalFetch = globalThis.fetch
  t.after(() => {
    window.Storage.prototype.setItem = originalSet
    window.confirm = originalConfirm
    globalThis.fetch = originalFetch
  })
})

test.after(async () => {
  try { (await persistence.database()).close() } finally { dom.window.close() }
})

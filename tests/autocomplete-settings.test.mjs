import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import assert from 'node:assert/strict'
import test, { after, beforeEach } from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import 'fake-indexeddb/auto'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://arc.test', pretendToBeVisual: true })
let services
// Register cleanup before bundle/setup work, which can also fail.
after(async () => {
  try { if (services) (await services.persistence.database()).close() }
  finally { dom.window.close() }
})
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
  stdin: {
    contents: `export { default as App } from './src/app/App.tsx'; export { BookProfilesPanel } from './src/features/settings/SettingsProfilesPanel.tsx'; export * as ai from './src/shared/ai/ai-settings.ts'; export * as profiles from './src/features/settings/settings-profiles.ts'; export * as persistence from './src/data/persistence.ts'; export * as archive from './src/data/book-archive.ts';`,
    resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'tsx',
  },
  bundle: true, platform: 'node', format: 'cjs', write: false,
  external: ['react', 'react-dom', 'react-dom/client', 'react-dom/server'], jsx: 'automatic', loader: { '.css': 'empty' },
})
const bundled = { exports: {} }
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports)
services = bundled.exports
const { App, BookProfilesPanel, ai, profiles, persistence, archive } = services
const configured = { enabled: true, model: 'custom/autocomplete', delayMs: 1200, length: 'sentence' }
const byId = id => profiles.loadSettingsProfiles().profiles.find(profile => profile.id === id)
const edit = (profile, autocomplete) => profiles.saveSettingsProfile({ ...profile, settings: { ...profile.settings, autocomplete } })
const safe = value => assert.doesNotMatch(JSON.stringify(value), /apiKey|baseUrl|providerProfiles|connectionId|accountId|SECRET|private-endpoint/)

beforeEach(async () => {
  // Books reference the localStorage profile library, so reset both stores together.
  // Clear this process's fake database without closing the cached Dexie connection.
  const db = await persistence.database()
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear()
  })
  localStorage.clear()
  ai.saveAiSettings({ ...ai.initialAiSettings, provider: 'fake', mainModel: 'fake/test' })
  profiles.loadSettingsProfiles()
})

const delay = () => new Promise(resolve => setTimeout(resolve, 15))
async function settle() { await act(async () => { await delay(); await delay() }) }
async function mount(t, props = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  t.after(async () => { await act(async () => root.unmount()); host.remove() })
  await act(async () => { root.render(React.createElement(App, props)); await delay() })
  await settle()
  return host
}
function button(host, label) {
  const found = [...host.querySelectorAll('button')].find(element => element.textContent.trim() === label)
  assert.ok(found, `Missing button: ${label}`)
  return found
}
function field(host, label) {
  const found = [...host.querySelectorAll('label')].find(element => element.textContent.includes(label))
  assert.ok(found, `Missing field: ${label}`)
  return found.querySelector('input, select, textarea')
}
function autocompleteCard(host) {
  const heading = host.querySelector('#autocomplete-model-heading')
  assert.ok(heading, 'Autocomplete card is present')
  return heading.closest('section')
}
async function click(element) { await act(async () => { element.click(); await delay() }); await settle() }
async function change(element, value) {
  const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value)
    element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
    await delay()
  })
}

test('autocomplete normalization defaults off without role fallback and copies only its four fields', () => {
  const expected = { enabled: false, model: '', delayMs: 800, length: 'phrase' }
  assert.deepEqual(ai.defaultAutocompleteSettings(), expected)
  assert.deepEqual(ai.normalizeAutocompleteSettings(undefined), expected)
  assert.deepEqual(ai.normalizeAutocompleteSettings(null), expected)
  assert.deepEqual(ai.normalizeAutocompleteSettings([]), expected)
  const { autocomplete: _autocomplete, ...legacy } = ai.copyAiSettings(ai.initialAiSettings)
  legacy.mainModel = 'legacy/main'
  legacy.supportModel = 'legacy/support'
  assert.deepEqual(ai.normalizeAiSettings(legacy).autocomplete, expected)
  assert.deepEqual(ai.normalizeAutocompleteSettings({ ...configured, model: ' custom/autocomplete ', apiKey: 'SECRET', connectionId: 'SECRET' }), configured)
  assert.deepEqual(ai.normalizeAutocompleteSettings({ enabled: 'true', model: 42, delayMs: '800', length: 'paragraph' }), expected)
  const first = ai.copyAiSettings({ ...ai.initialAiSettings, autocomplete: configured })
  const second = ai.copyAiSettings(first)
  second.autocomplete.model = 'independent/copy'
  assert.equal(first.autocomplete.model, configured.model)
  assert.equal(ai.defaultAutocompleteSettings().model, '')
})

test('autocomplete delays require numeric integers from 100 through 10000', () => {
  for (const delayMs of [100, 800, 10000]) {
    assert.equal(ai.autocompleteDelayInputError(delayMs), '')
    assert.equal(ai.normalizeAutocompleteSettings({ delayMs }).delayMs, delayMs)
  }
  for (const delayMs of [undefined, null, '', '800', true, 0, 99, 10001, 800.5, NaN, Infinity]) {
    assert.match(ai.autocompleteDelayInputError(delayMs), /integer from 100 to 10000/)
    assert.equal(ai.normalizeAutocompleteSettings({ delayMs }).delayMs, 800)
  }
})

test('profile validation accepts missing legacy fields but rejects invalid supplied autocomplete fields', () => {
  const profile = profiles.createSettingsProfile('text', 'Validation')
  const legacy = structuredClone(profile)
  delete legacy.settings.autocomplete
  assert.deepEqual(profiles.sanitizeSettingsProfile(legacy).settings.autocomplete, ai.defaultAutocompleteSettings())
  assert.deepEqual(profiles.sanitizeSettingsProfile({ ...profile, settings: { ...profile.settings, autocomplete: {} } }).settings.autocomplete, ai.defaultAutocompleteSettings())
  for (const autocomplete of [null, [], 'enabled', { enabled: 1 }, { model: 42 }, { delayMs: '800' }, { delayMs: 99 }, { delayMs: 10001 }, { delayMs: 800.5 }, { length: 'paragraph' }]) {
    assert.throws(() => profiles.sanitizeSettingsProfile({ ...profile, settings: { ...profile.settings, autocomplete } }), /autocomplete/i)
  }
  const rawLibrary = JSON.parse(localStorage.getItem(profiles.SETTINGS_PROFILES_STORAGE_KEY))
  for (const item of rawLibrary.profiles) delete item.settings.autocomplete
  localStorage.setItem(profiles.SETTINGS_PROFILES_STORAGE_KEY, JSON.stringify(rawLibrary))
  assert.deepEqual(byId(profile.id).settings.autocomplete, ai.defaultAutocompleteSettings())
  rawLibrary.profiles.find(item => item.id === profile.id).settings.autocomplete = { delayMs: -1 }
  const corrupt = JSON.stringify(rawLibrary)
  localStorage.setItem(profiles.SETTINGS_PROFILES_STORAGE_KEY, corrupt)
  assert.throws(profiles.loadSettingsProfiles, /preserved.*Autocomplete delay/)
  assert.equal(localStorage.getItem(profiles.SETTINGS_PROFILES_STORAGE_KEY), corrupt)
})

test('text configuration comparison includes autocomplete while UI and prompt configurations do not', () => {
  const text = profiles.createSettingsProfile('text', 'Owned fields')
  const original = JSON.stringify(profiles.profileConfiguration(text))
  for (const patch of [{ enabled: true }, { model: 'different/model' }, { delayMs: 2000 }, { length: 'sentence' }]) {
    assert.notEqual(JSON.stringify(profiles.profileConfiguration({ ...text, settings: { ...text.settings, autocomplete: { ...text.settings.autocomplete, ...patch } } })), original)
  }
  for (const kind of ['ui', 'story', 'codex', 'summary']) {
    const profile = byId(profiles.loadSettingsProfiles().defaults[kind])
    assert.equal(JSON.stringify(profiles.profileConfiguration({ ...profile, settings: { ...profile.settings, autocomplete: configured } })), JSON.stringify(profiles.profileConfiguration(profile)))
  }
})

test('saved and duplicated text profiles resolve autocomplete independently of global roles and provider snapshots', () => {
  const text = edit(profiles.createSettingsProfile('text', 'Shared autocomplete'), configured)
  const duplicate = profiles.createSettingsProfile('text', 'Independent autocomplete', text.id)
  assert.notEqual(duplicate.id, text.id)
  assert.deepEqual(duplicate.settings.autocomplete, configured)
  edit(duplicate, { ...configured, model: 'duplicate/model' })
  const selection = { ...profiles.defaultBookProfileSelections(), text: text.id }
  ai.saveAiSettings({ ...ai.loadAiSettings(), provider: 'litellm', apiKey: 'GLOBAL_SECRET', baseUrl: 'https://private-endpoint.test/v1', mainModel: 'global/main', autocomplete: { ...configured, model: 'global/stale' }, providerProfiles: { litellm: { apiKey: 'STALE_SECRET', baseUrl: 'https://stale-private-endpoint.test', autocomplete: { ...configured, model: 'provider/stale' } } } })
  const resolved = profiles.resolveProfileSettings(selection)
  assert.deepEqual(resolved.autocomplete, configured)
  assert.equal(resolved.provider, 'litellm')
  assert.equal(resolved.apiKey, 'GLOBAL_SECRET')
  assert.equal(resolved.baseUrl, 'https://private-endpoint.test/v1')
  edit(byId(text.id), { ...configured, model: '' })
  assert.equal(profiles.resolveProfileSettings(selection).autocomplete.model, '')
  assert.equal(byId(duplicate.id).settings.autocomplete.model, 'duplicate/model')
  safe(profiles.settingsProfilesForSelections(selection))
})

test('committed book profile selection changes signal only their book ID and a fresh nonce across windows', async t => {
  ai.saveAiSettings({ ...ai.loadAiSettings(), provider: 'litellm', apiKey: 'GLOBAL_SECRET', baseUrl: 'https://private-endpoint.test/v1' })
  const text = edit(profiles.createSettingsProfile('text', 'Selection signal profile'), configured)
  const { book } = await persistence.createBook(ai.initialAiSettings, 'Selection signal book')
  const { book: otherBook } = await persistence.createBook(ai.initialAiSettings, 'Other selection signal book')
  const selections = await persistence.getBookProfileSelections(book.id)
  const otherSelections = await persistence.getBookProfileSelections(otherBook.id)
  const libraryBefore = localStorage.getItem(profiles.SETTINGS_PROFILES_STORAGE_KEY)
  const observed = []
  const listener = event => observed.push(event.detail.bookId)
  window.addEventListener(profiles.SETTINGS_PROFILES_EVENT, listener)
  t.after(() => window.removeEventListener(profiles.SETTINGS_PROFILES_EVENT, listener))
  assert.equal(profiles.BOOK_PROFILE_SELECTIONS_STORAGE_KEY, 'arc.settings.book-profiles.changed')
  localStorage.removeItem(profiles.BOOK_PROFILE_SELECTIONS_STORAGE_KEY)

  await persistence.saveBookProfileSelections(book.id, { ...selections, text: text.id })
  const first = JSON.parse(localStorage.getItem(profiles.BOOK_PROFILE_SELECTIONS_STORAGE_KEY))
  assert.deepEqual(Object.keys(first).sort(), ['bookId', 'nonce'])
  assert.equal(first.bookId, book.id)
  assert.match(first.nonce, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  safe(first)
  assert.equal((await persistence.getBookProfileSelections(book.id)).text, text.id)
  assert.deepEqual(observed, [book.id])

  await persistence.saveBookProfileSelections(book.id, selections)
  const second = JSON.parse(localStorage.getItem(profiles.BOOK_PROFILE_SELECTIONS_STORAGE_KEY))
  assert.equal(second.bookId, book.id)
  assert.notEqual(second.nonce, first.nonce)
  await persistence.saveBookProfileSelections(otherBook.id, { ...otherSelections, text: text.id })
  const third = JSON.parse(localStorage.getItem(profiles.BOOK_PROFILE_SELECTIONS_STORAGE_KEY))
  assert.deepEqual(Object.keys(third).sort(), ['bookId', 'nonce'])
  assert.equal(third.bookId, otherBook.id)
  assert.notEqual(third.nonce, second.nonce)
  safe(third)
  assert.deepEqual(observed, [book.id, book.id, otherBook.id])
  assert.equal(localStorage.getItem(profiles.SETTINGS_PROFILES_STORAGE_KEY), libraryBefore)
})

test('book selection signal storage failure does not fail the committed save or same-window event', async t => {
  const text = profiles.createSettingsProfile('text', 'Storage failure selection profile')
  const { book } = await persistence.createBook(ai.initialAiSettings, 'Storage failure selection book')
  const selections = await persistence.getBookProfileSelections(book.id)
  const observed = []
  const listener = event => observed.push(event.detail.bookId)
  window.addEventListener(profiles.SETTINGS_PROFILES_EVENT, listener)
  t.after(() => window.removeEventListener(profiles.SETTINGS_PROFILES_EVENT, listener))
  localStorage.removeItem(profiles.BOOK_PROFILE_SELECTIONS_STORAGE_KEY)
  const originalSetItem = window.Storage.prototype.setItem
  let signalWrites = 0
  t.mock.method(window.Storage.prototype, 'setItem', function(key, value) {
    if (key === profiles.BOOK_PROFILE_SELECTIONS_STORAGE_KEY) {
      signalWrites += 1
      throw new Error('Selection signal storage unavailable')
    }
    return originalSetItem.call(this, key, value)
  })

  const saved = await persistence.saveBookProfileSelections(book.id, { ...selections, text: text.id })
  assert.equal(saved.text, text.id)
  assert.equal((await persistence.getBookProfileSelections(book.id)).text, text.id)
  assert.equal(signalWrites, 1)
  assert.equal(localStorage.getItem(profiles.BOOK_PROFILE_SELECTIONS_STORAGE_KEY), null)
  assert.deepEqual(observed, [book.id])
})

test('rejected book profile selection changes do not publish a cross-window signal', async t => {
  const { book } = await persistence.createBook(ai.initialAiSettings, 'Rejected selection signal book')
  const selections = await persistence.getBookProfileSelections(book.id)
  const signalBefore = localStorage.getItem(profiles.BOOK_PROFILE_SELECTIONS_STORAGE_KEY)
  const observed = []
  const listener = event => observed.push(event.detail.bookId)
  window.addEventListener(profiles.SETTINGS_PROFILES_EVENT, listener)
  t.after(() => window.removeEventListener(profiles.SETTINGS_PROFILES_EVENT, listener))

  await assert.rejects(persistence.saveBookProfileSelections(book.id, { ...selections, text: 'missing-profile' }), /unavailable/)
  assert.equal(localStorage.getItem(profiles.BOOK_PROFILE_SELECTIONS_STORAGE_KEY), signalBefore)
  assert.equal((await persistence.getBookProfileSelections(book.id)).text, selections.text)
  assert.deepEqual(observed, [])
})

test('arcbook copy and portable conflict import preserve autocomplete without credentials or overwriting shared profiles', async () => {
  ai.saveAiSettings({ ...ai.loadAiSettings(), provider: 'litellm', apiKey: 'GLOBAL_SECRET', baseUrl: 'https://private-endpoint.test/v1' })
  const text = edit(profiles.createSettingsProfile('text', 'Portable autocomplete'), { ...configured, apiKey: 'NESTED_SECRET', connectionId: 'NESTED_SECRET' })
  const { book } = await persistence.createBook(ai.initialAiSettings, 'Autocomplete portable book')
  const selection = { ...await persistence.getBookProfileSelections(book.id), text: text.id }
  await persistence.saveBookProfileSelections(book.id, selection)
  const portable = await archive.decodeBookArchive(archive.encodeBookArchive(await persistence.readBookArchive(book.id)))
  safe(portable)
  assert.deepEqual(portable.settingsProfiles.find(profile => profile.id === text.id).settings.autocomplete, configured)
  edit(byId(text.id), { ...configured, model: 'local/changed' })
  const copy = archive.copyBookArchive(portable)
  await persistence.writeBookArchive(copy.data)
  const copiedSelection = await persistence.getBookProfileSelections(copy.bookId)
  assert.notEqual(copiedSelection.text, text.id)
  assert.deepEqual((await persistence.getBookAiSettings(copy.bookId, [])).autocomplete, configured)
  assert.equal(byId(text.id).settings.autocomplete.model, 'local/changed')
  const imported = profiles.importSettingsProfiles(portable.settingsProfiles, selection)
  assert.notEqual(imported.text, text.id)
  assert.deepEqual(profiles.resolveProfileSettings(imported).autocomplete, configured)
  assert.equal(byId(text.id).settings.autocomplete.model, 'local/changed')
  const count = profiles.loadSettingsProfiles().profiles.length
  assert.equal(profiles.importSettingsProfiles(portable.settingsProfiles, selection).text, imported.text)
  assert.equal(profiles.loadSettingsProfiles().profiles.length, count)
})

test('autocomplete card opts in explicitly and keeps drafts isolated through validation, discard, and linked-book confirmation', async t => {
  const text = profiles.createSettingsProfile('text', 'UI shared autocomplete')
  const { book } = await persistence.createBook(ai.initialAiSettings, 'Linked autocomplete book')
  await persistence.saveBookProfileSelections(book.id, { ...await persistence.getBookProfileSelections(book.id), text: text.id })
  assert.deepEqual((await persistence.listSettingsProfileUsage(text.id)).map(item => item.id), [book.id])
  let networkCalls = 0
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => { networkCalls += 1; throw new Error('Unexpected network request') }
  t.after(() => { globalThis.fetch = previousFetch })
  let confirmation = '', accept = false
  const previousConfirm = window.confirm
  window.confirm = message => { confirmation = message; return accept }
  t.after(() => { window.confirm = previousConfirm })
  const host = await mount(t, { initialProfileId: text.id })
  const card = autocompleteCard(host)
  const roleHeadings = [...host.querySelectorAll('.model-role-settings h3')].map(heading => heading.textContent)
  assert.equal(roleHeadings.at(-1), 'Autocomplete')
  assert.equal(field(card, 'Enable autocomplete').checked, false)
  assert.equal(field(card, 'Exact model ID').value, '')
  assert.equal(field(card, 'Autocomplete delay (ms)').value, '800')
  assert.equal(field(card, 'Autocomplete length').value, 'phrase')
  assert.match(card.textContent, /automatically send manuscript excerpts.*active global text connection/)
  assert.match(card.textContent, /every book linked.*costs/)
  assert.match(card.textContent, /No fallback to Main/)
  await click(field(card, 'Enable autocomplete'))
  await change(field(card, 'Exact model ID'), configured.model)
  await change(field(card, 'Autocomplete length'), configured.length)
  await change(field(card, 'Autocomplete delay (ms)'), '99')
  assert.equal(field(card, 'Autocomplete delay (ms)').getAttribute('aria-invalid'), 'true')
  await click(button(host, 'Save profile'))
  assert.match(host.textContent, /Autocomplete delay must be an integer/)
  assert.equal(confirmation, '')
  assert.equal(profiles.resolveProfileSettings(await persistence.getBookProfileSelections(book.id)).autocomplete.enabled, false)
  await change(field(card, 'Autocomplete delay (ms)'), String(configured.delayMs))
  assert.equal(button(host, 'Save profile').disabled, false, 'Linked-book lookup must allow saving the valid draft')
  await click(button(host, 'Save profile'))
  assert.match(confirmation, /Linked autocomplete book/)
  assert.match(confirmation, /automatically send manuscript excerpts.*costs/)
  assert.equal(byId(text.id).settings.autocomplete.enabled, false)
  assert.equal(field(card, 'Enable autocomplete').checked, true)
  await click(button(host, 'Discard'))
  assert.equal(field(autocompleteCard(host), 'Enable autocomplete').checked, false)
  await click(field(autocompleteCard(host), 'Enable autocomplete'))
  await change(field(autocompleteCard(host), 'Exact model ID'), configured.model)
  await change(field(autocompleteCard(host), 'Autocomplete length'), configured.length)
  await change(field(autocompleteCard(host), 'Autocomplete delay (ms)'), String(configured.delayMs))
  accept = true
  await click(button(host, 'Save profile'))
  assert.deepEqual(byId(text.id).settings.autocomplete, configured)
  assert.deepEqual((await persistence.getBookAiSettings(book.id, [])).autocomplete, configured)
  assert.equal(networkCalls, 0)
})

test('autocomplete catalog and exact ID edit one explicit model while unlisted IDs survive connection changes', async t => {
  const text = edit(profiles.createSettingsProfile('text', 'Catalog autocomplete'), { ...configured, enabled: false })
  assert.equal((await persistence.listSettingsProfileUsage(text.id)).length, 0)
  const host = await mount(t, { initialProfileId: text.id })
  const card = autocompleteCard(host)
  assert.match(card.textContent, /custom\/autocomplete/)
  const picker = card.querySelector('button[aria-haspopup="listbox"]')
  assert.ok(picker, 'Autocomplete has a searchable catalog picker')
  await click(picker)
  assert.match(card.textContent, /Custom ID/)
  const option = [...host.querySelectorAll('[role="option"]')].find(item => item.textContent.includes('fake/test'))
  assert.ok(option, 'Active Fake connection supplies its own catalog')
  await click(option)
  assert.equal(field(card, 'Exact model ID').value, 'fake/test')
  await change(field(card, 'Exact model ID'), 'unlisted/exact')
  assert.equal(button(host, 'Save profile').disabled, false, 'An isolated catalog fixture must allow saving')
  await click(button(host, 'Save profile'))
  assert.equal(byId(text.id).settings.autocomplete.model, 'unlisted/exact')
  await click(button(host, 'Connections'))
  await change(field(host, 'Active text provider'), 'litellm')
  await click(button(host, 'Save connections'))
  await click(button(host, 'Models'))
  await change(field(host, 'Profile / preset'), text.id)
  assert.equal(field(autocompleteCard(host), 'Exact model ID').value, 'unlisted/exact')
  assert.equal(byId(text.id).settings.autocomplete.enabled, false)
})

test('book text-profile summary shows autocomplete status and model without a detailed editor', () => {
  const text = edit(profiles.createSettingsProfile('text', 'Summary autocomplete'), configured)
  const selections = { ...profiles.defaultBookProfileSelections(), text: text.id }
  const props = { library: profiles.loadSettingsProfiles(), selections, busy: false, error: '', onChange() {}, onEdit() {}, onRetry() {} }
  const html = renderToStaticMarkup(React.createElement(BookProfilesPanel, props))
  assert.match(html, /Autocomplete: On.*custom\/autocomplete/)
  assert.doesNotMatch(html, /Enable autocomplete|Autocomplete delay|Exact model ID/)
  edit(text, { ...configured, enabled: false })
  assert.match(renderToStaticMarkup(React.createElement(BookProfilesPanel, { ...props, library: profiles.loadSettingsProfiles() })), /Autocomplete: Off.*custom\/autocomplete/)
  edit(text, { ...configured, model: '' })
  assert.match(renderToStaticMarkup(React.createElement(BookProfilesPanel, { ...props, library: profiles.loadSettingsProfiles() })), /Autocomplete: On.*model not selected/)
})

import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import 'fake-indexeddb/auto'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://arc.test/', pretendToBeVisual: true })
after(() => dom.window.close())
for (const key of ['window', 'document', 'localStorage', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Event', 'CustomEvent']) globalThis[key] = dom.window[key]
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
const compiled = await build({
  stdin: { contents: `export { default as Panel } from './src/features/settings/SettingsProfilesPanel.tsx'; export * as ai from './src/shared/ai/ai-settings.ts'; export * as media from './src/features/images/image-settings.ts'; export * as persistence from './src/data/persistence.ts';`, resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'tsx' },
  bundle: true, platform: 'node', format: 'cjs', write: false,
  external: ['react', 'react-dom', 'react-dom/client'], jsx: 'automatic', loader: { '.css': 'empty' },
})
const module = { exports: {} }
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
const { Panel, ai, media, persistence } = module.exports
after(async () => (await persistence.database()).close())
const delay = () => new Promise(resolve => setTimeout(resolve, 10))
async function settle() { await act(async () => { await delay(); await delay() }) }
function button(host, text) {
  const result = [...host.querySelectorAll('button')].find(element => element.textContent.trim() === text)
  assert.ok(result, `Missing button: ${text}`)
  return result
}
function field(host, text) {
  const label = [...host.querySelectorAll('label')].find(element => element.querySelector('.arc-field__label')?.textContent.trim() === text)
  assert.ok(label, `Missing field: ${text}`)
  return label.querySelector('input, select')
}
async function change(element, value) {
  assert.ok(element, 'Input exists')
  const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value)
    element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  })
}
async function click(element) { await act(async () => { element.click(); await delay() }); await settle() }
async function mount(t) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  t.after(async () => { try { await act(async () => root.unmount()) } finally { host.remove() } })
  let saves = 0
  await act(async () => root.render(React.createElement(Panel, { section: 'ai', renderEditor: () => null, application: null, sync: null, onSaved: () => { saves++ } })))
  await settle()
  await click(button(host, 'Connections'))
  return { host, saves: () => saves }
}
function configure() {
  // This isolated test file owns its JSDOM origin; reset it between scenarios.
  localStorage.clear()
  ai.saveAiSettings({ ...ai.initialAiSettings, provider: 'nanogpt', apiKey: 'baseline-nano', providerProfiles: { openai: { apiKey: 'baseline-openai' } } })
  media.saveImageSettings({ ...media.loadImageSettings(), keys: { nanogpt: 'baseline-nano-media', openai: 'baseline-openai-media', pruna: '', leonardo: 'baseline-leonardo' } })
}

// One scheduler is shared by both mounted editors, like the origin's Web Locks
// manager is shared by browser tabs. An unrelated holder initially prevents any
// queued save from entering its critical section; grants are explicit, not timed.
function heldExclusiveLocks() {
  const pending = [], requests = []
  let activeGrant = null, nextGrant = 0, held = true
  return {
    requests,
    get activeGrant() { return activeGrant },
    manager: {
      request(name, options, callback) {
        if (typeof options === 'function') { callback = options; options = {} }
        const request = { name, mode: options?.mode ?? 'exclusive', callback }
        requests.push({ name: request.name, mode: request.mode })
        return new Promise((resolve, reject) => pending.push({ ...request, resolve, reject }))
      },
    },
    releaseHolder() { held = false },
    async grantNext() {
      assert.equal(held, false, 'The other tab must release its shared lock first')
      assert.equal(activeGrant, null, 'Exclusive grants cannot overlap')
      const request = pending.shift()
      assert.ok(request, 'A Connections save is waiting for the shared lock')
      activeGrant = ++nextGrant
      try {
        const result = await request.callback({ name: request.name, mode: request.mode })
        request.resolve(result)
      } catch (error) {
        request.reject(error)
      } finally {
        activeGrant = null
      }
    },
    cancelPending() {
      held = false
      for (const request of pending.splice(0)) request.reject(new Error('Test lock holder cancelled'))
    },
  }
}

for (const firstTab of ['a', 'b']) {
  test(`BUG-03 concurrent Connections saves serialize durable comparisons and writes (${firstTab} requests first)`, async t => {
    const warnings = [], originalError = console.error
    t.mock.method(console, 'error', (...args) => { warnings.push(args.map(String).join(' ')); originalError(...args) })
    t.after(() => assert.equal(warnings.filter(message => /not wrapped in act|unmounted component/i.test(message)).length, 0, 'Mounted async settings updates must stay inside act'))
    configure()
    const locks = heldExclusiveLocks()
    const previousLocks = Object.getOwnPropertyDescriptor(navigator, 'locks')
    Object.defineProperty(navigator, 'locks', { configurable: true, value: locks.manager })
    t.after(async () => {
      try { await act(async () => { locks.cancelPending(); await delay() }) }
      finally {
        if (previousLocks) Object.defineProperty(navigator, 'locks', previousLocks)
        else delete navigator.locks
      }
    })
    const tabs = { a: await mount(t), b: await mount(t) }
    for (const [name, tab] of Object.entries(tabs)) {
      await change(field(tab.host, 'API key for NanoGPT'), `synthetic-${name}-connection-draft`)
      await change(field(tab.host, 'NanoGPT media API key'), `synthetic-${name}-media-draft`)
    }
    const winner = tabs[firstTab], loserName = firstTab === 'a' ? 'b' : 'a', loser = tabs[loserName]
    const storageKeys = [ai.AI_SETTINGS_STORAGE_KEY, media.IMAGE_SETTINGS_KEY]
    const baseline = storageKeys.map(key => localStorage.getItem(key))
    const accesses = []
    const storagePrototype = dom.window.Storage.prototype
    const getItem = storagePrototype.getItem, setItem = storagePrototype.setItem
    t.mock.method(storagePrototype, 'getItem', function (key) {
      const value = getItem.call(this, key)
      if (this === localStorage && storageKeys.includes(key)) accesses.push({ kind: 'read', key, value, grant: locks.activeGrant })
      return value
    })
    t.mock.method(storagePrototype, 'setItem', function (key, value) {
      if (this === localStorage && storageKeys.includes(key)) accesses.push({ kind: 'write', key, value: String(value), grant: locks.activeGrant })
      return setItem.call(this, key, value)
    })

    // Do not await either save's completion: both must queue from the same
    // accepted baseline while the cross-tab lock is held elsewhere.
    await act(async () => {
      button(winner.host, 'Save connections').click()
      button(loser.host, 'Save connections').click()
      await delay()
    })
    await settle()
    assert.equal(accesses.filter(access => access.kind === 'write').length, 0, 'Neither tab may write AI or media settings before acquiring the shared lock')
    assert.deepEqual(storageKeys.map(key => localStorage.getItem(key)), baseline, 'The durable baseline remains untouched while both saves wait')
    assert.equal(winner.saves(), 0)
    assert.equal(loser.saves(), 0)
    assert.equal(locks.requests.length, 2, 'Each tab must request cross-tab serialization, not a module-local busy flag')
    assert.equal(typeof locks.requests[0].name, 'string')
    assert.ok(locks.requests[0].name.length > 0, 'The shared lock has a resource name')
    assert.equal(locks.requests[0].name, locks.requests[1].name, 'Both tabs must serialize against the same resource (without prescribing its name)')
    assert.deepEqual(locks.requests.map(request => request.mode), ['exclusive', 'exclusive'])

    locks.releaseHolder()
    await act(async () => { await locks.grantNext(); await delay() })
    await settle()
    assert.equal(winner.saves(), 1, 'The first granted tab completes its save')
    assert.equal(loser.saves(), 0, 'The second tab still waits for its grant')
    assert.equal(ai.loadAiSettings().apiKey, `synthetic-${firstTab}-connection-draft`)
    assert.equal(media.loadImageSettings().keys.nanogpt, `synthetic-${firstTab}-media-draft`)
    const committed = storageKeys.map(key => localStorage.getItem(key))
    const winnerWrites = accesses.filter(access => access.kind === 'write')
    assert.ok(winnerWrites.length > 0, 'The winner durably saves its draft')
    assert.ok(winnerWrites.every(access => access.grant === 1), 'Both AI and media writes must remain inside the same exclusive grant')
    assert.deepEqual([...new Set(winnerWrites.map(access => access.key))].sort(), [...storageKeys].sort(), 'The first grant commits both credential stores')

    await act(async () => { await locks.grantNext(); await delay() })
    await settle()
    assert.deepEqual(storageKeys.map(key => localStorage.getItem(key)), committed, 'The later grant must compare current durable settings and reject without overwriting either store')
    assert.equal(accesses.filter(access => access.kind === 'write').length, winnerWrites.length, 'A conflicting save cannot partially write media or AI settings')
    for (const key of storageKeys) {
      assert.ok(accesses.some(access => access.kind === 'read' && access.key === key && access.grant === 1 && access.value === baseline[storageKeys.indexOf(key)]), 'The winning grant reads its durable baseline inside the lock')
      assert.ok(accesses.some(access => access.kind === 'read' && access.key === key && access.grant === 2 && access.value === committed[storageKeys.indexOf(key)]), 'The losing grant rereads the winner\'s durable value inside the lock, not a pre-lock snapshot')
    }
    assert.equal(winner.saves(), 1)
    assert.equal(loser.saves(), 0, 'The conflicting tab must not report success')
    assert.match(loser.host.querySelector('[role="alert"]')?.textContent ?? '', /changed|conflict|another editor/i)
    assert.equal(field(loser.host, 'API key for NanoGPT').value, `synthetic-${loserName}-connection-draft`, 'The rejected connection draft remains available')
    assert.equal(field(loser.host, 'NanoGPT media API key').value, `synthetic-${loserName}-media-draft`, 'The rejected media draft remains available')
    assert.equal(button(loser.host, 'Save connections').disabled, false, 'Conflict recovery leaves the editor usable')
  })
}

for (const target of ['OpenAI connection and speech/media overrides', 'Leonardo media override only']) {
  test(`BUG-03 stale Connections Save rejects another editor's ${target} without partial writes`, async t => {
    const warnings = [], originalError = console.error
    t.mock.method(console, 'error', (...args) => { warnings.push(args.map(String).join(' ')); originalError(...args) })
    t.after(() => assert.equal(warnings.filter(message => /not wrapped in act|unmounted component/i.test(message)).length, 0, 'Mounted async settings updates must stay inside act'))
    configure()
    const a = await mount(t), b = await mount(t)
    await change(field(a.host, 'API key for NanoGPT'), 'unsaved-nano-draft')
    await change(field(a.host, 'NanoGPT media API key'), 'unsaved-nano-media-draft')
    if (target.startsWith('OpenAI')) {
      await change(field(b.host, 'Connection provider'), 'openai')
      await change(field(b.host, 'API key for OpenAI'), 'saved-openai-from-b')
      await change(field(b.host, 'OpenAI Speech API key'), 'saved-openai-speech-from-b')
      await change(field(b.host, 'OpenAI media API key'), 'saved-openai-media-from-b')
    } else {
      await change(field(b.host, 'Connection provider'), 'leonardo')
      await change(field(b.host, 'Leonardo.AI media API key'), 'saved-leonardo-from-b')
    }
    await click(button(b.host, 'Save connections'))
    assert.equal(b.saves(), 1, 'The competing editor completed its save')
    if (target.startsWith('OpenAI')) {
      assert.equal(ai.loadAiSettings().providerProfiles.openai.apiKey, 'saved-openai-from-b')
      assert.equal(ai.loadAiSettings().speech.openaiApiKey, 'saved-openai-speech-from-b')
      assert.equal(media.loadImageSettings().keys.openai, 'saved-openai-media-from-b')
    } else assert.equal(media.loadImageSettings().keys.leonardo, 'saved-leonardo-from-b')
    const savedAi = JSON.stringify(ai.loadAiSettings()), savedMedia = JSON.stringify(media.loadImageSettings())
    // Browser storage notifications must not turn A's dirty stale snapshot into an approved baseline.
    await act(async () => { window.dispatchEvent(new dom.window.StorageEvent('storage')); await delay() })
    await click(button(a.host, 'Save connections'))
    assert.equal(JSON.stringify(ai.loadAiSettings()), savedAi, 'Stale Save must not overwrite the global connection or partially apply the NanoGPT draft')
    assert.equal(JSON.stringify(media.loadImageSettings()), savedMedia, 'Conflict must be checked before writing any media keys')
    assert.match(a.host.querySelector('[role="alert"]')?.textContent ?? '', /changed|conflict|another editor/i)
    assert.equal(a.saves(), 0, 'A conflict must not report a successful save')
    assert.equal(field(a.host, 'API key for NanoGPT').value, 'unsaved-nano-draft', 'The rejected draft is retained')
    assert.equal(button(a.host, 'Save connections').disabled, false)

    await click(button(a.host, 'Discard'))
    assert.equal(field(a.host, 'API key for NanoGPT').value, 'baseline-nano', 'Discard reloads the current durable connection')
    await change(field(a.host, 'API key for NanoGPT'), 'reviewed-nano-from-a')
    await click(button(a.host, 'Save connections'))
    assert.equal(a.saves(), 1, 'Saving is possible after explicitly reloading the baseline')
    assert.equal(ai.loadAiSettings().apiKey, 'reviewed-nano-from-a')
    assert.equal(JSON.stringify(media.loadImageSettings()), savedMedia, 'Reviewed save retains the other editor\'s media overrides')
    if (target.startsWith('OpenAI')) {
      assert.equal(ai.loadAiSettings().providerProfiles.openai.apiKey, 'saved-openai-from-b')
      assert.equal(ai.loadAiSettings().speech.openaiApiKey, 'saved-openai-speech-from-b')
    }
  })
}

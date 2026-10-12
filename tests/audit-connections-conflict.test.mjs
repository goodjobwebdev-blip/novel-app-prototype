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

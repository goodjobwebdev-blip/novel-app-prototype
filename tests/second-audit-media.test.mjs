import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import { transpileSourceTree } from './transpile-source-tree.mjs'
import 'fake-indexeddb/auto'
const dom = new JSDOM('<div id="root"></div>', { url: 'https://arc.test/' })
for (const key of ['window', 'document', 'HTMLElement', 'Event', 'CustomEvent', 'localStorage']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'), { act } = React
const { createRoot } = await import('react-dom/client')
const dir = mkdtempSync(new URL('../node_modules/.second-media-', import.meta.url))
transpileSourceTree(dir)
const at = name => import(pathToFileURL(`${dir}/${name}.mjs`))
const { default: Controls } = await at('features/images/ImageGenerationControls')
const settings = await at('features/images/image-settings')
const profiles = await at('features/settings/settings-profiles')
const p = await at('data/persistence')
after(async () => { (await p.database()).close(); dom.window.close(); rmSync(dir, { recursive: true, force: true }) })
const png = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6AAAAAElFTkSuQmCC', 'base64')], { type: 'image/png' })
async function settle(predicate) {
  for (let i = 0; i < 100 && !predicate(); i++) await act(async () => new Promise(r => setTimeout(r, 10)))
  assert.ok(predicate(), 'asynchronous controls settled')
}
for (const scenario of ['prompt and size', 'overlapping uploads', 'task switch', 'model switch']) {
  test(`B5: pending source decode preserves ${scenario}`, async t => {
    const favorite = settings.imageFavorite(settings.documentedImageModels.find(m => m.id === 'gpt-image-1'), [])
    favorite.alias = 'Sources'; favorite.tasks = ['text-to-image', 'image-to-image']; favorite.maxSourceImages = 3
    const library = profiles.loadSettingsProfiles()
    profiles.saveSettingsProfile({ ...library.profiles.find(row => row.id === library.defaults.image), media: { favorites: [favorite], defaultAlias: favorite.alias, defaultAliases: {} } })
    const decodes = []
    const oldBitmap = globalThis.createImageBitmap
    globalThis.createImageBitmap = () => new Promise(resolve => decodes.push(() => resolve({ width: 1, height: 1, close() {} })))
    t.after(() => { globalThis.createImageBitmap = oldBitmap })
    let draft = { prompt: 'Original', task: 'image-to-image', alias: 'Sources', size: favorite.defaultSize, sources: [] }, edit
    function Harness() {
      const [value, setValue] = React.useState(draft)
      edit = setValue
      return React.createElement(Controls, { value, onChange: next => { draft = next; setValue(next) } })
    }
    const root = createRoot(document.getElementById('root'))
    t.after(async () => { await act(async () => { decodes.forEach(release => release()); await new Promise(r => setImmediate(r)); root.unmount() }) })
    await act(async () => root.render(React.createElement(Harness)))
    await settle(() => document.querySelector('input[type=file]'))
    const upload = async name => {
      const input = document.querySelector('input[type=file]')
      Object.defineProperty(input, 'files', { configurable: true, value: [Object.assign(png.slice(0, png.size, png.type), { name })] })
      await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    }
    await upload('first.png')
    await settle(() => decodes.length === 1)
    if (scenario === 'overlapping uploads') { await upload('second.png'); await settle(() => decodes.length === 2) }
    else {
      draft = { ...draft, prompt: 'Latest prompt', size: 'Latest size', ...(scenario === 'task switch' ? { task: 'text-to-image', sources: [] } : {}), ...(scenario === 'model switch' ? { alias: 'Other model' } : {}) }
      await act(async () => edit(draft))
    }
    await act(async () => { for (const release of [...decodes].reverse()) { release(); await new Promise(r => setImmediate(r)) } })
    await act(async () => new Promise(r => setTimeout(r, 20)))
    if (scenario === 'overlapping uploads') assert.equal(draft.sources.length, 2, 'both decoded uploads are retained')
    else {
      assert.equal(draft.prompt, 'Latest prompt')
      assert.equal(draft.size, 'Latest size')
      assert.equal(draft.sources.length, scenario === 'prompt and size' ? 1 : 0)
      if (scenario === 'task switch') assert.equal(draft.task, 'text-to-image')
      if (scenario === 'model switch') assert.equal(draft.alias, 'Other model')
    }
  })
}

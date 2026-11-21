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
for (const key of ['window', 'document', 'localStorage', 'HTMLElement', 'Event', 'CustomEvent']) globalThis[key] = dom.window[key]
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
window.confirm = () => true
// JSDOM has no native modal implementation; keep the real gallery/viewer tree.
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
const { createRoot } = await import('react-dom/client')
const compiled = await build({
  stdin: { contents: `export * as p from './src/data/persistence.ts'; export { initialAiSettings } from './src/shared/ai/ai-settings.ts'; export * as store from './src/features/images/image-store.ts'; export { default as EditorBlocks } from './src/features/editor/EditorBlocks.tsx'; export { ImageGalleryView, createImageWorkspaceState } from './src/features/images/ImageWorkspace.tsx'; export { default as ImagePanel } from './src/features/images/ImagePanel.tsx';`, resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'tsx' },
  bundle: true, platform: 'node', format: 'cjs', write: false,
  external: ['react', 'react-dom', 'react-dom/client'], jsx: 'automatic', loader: { '.css': 'empty' },
})
const module = { exports: {} }
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
const { p, initialAiSettings, store, EditorBlocks, ImageGalleryView, createImageWorkspaceState, ImagePanel } = module.exports
after(async () => (await p.database()).close())
const png = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6AAAAAElFTkSuQmCC', 'base64')], { type: 'image/png' })
const pixels = { image: png, thumbnail: png, width: 1, height: 1 }
async function settle(predicate) {
  for (let i = 0; i < 100 && !predicate(); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
  assert.ok(predicate(), 'Gallery UI did not reach the expected state')
}
async function fixture(t) {
  const db = await p.database()
  await db.table('galleryImages').clear()
  await db.table('illustrations').clear()
  const { book } = await p.createBook(initialAiSettings, 'Codex copy')
  const entry = await p.createCodexEntry(book.id, 'Original illustration', 'Place')
  const illustration = await p.saveIllustration(entry.id, pixels, { caption: 'Original illustration', alt: '', cropX: 50, cropY: 50 })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  t.after(async () => { try { await act(async () => root.unmount()) } finally { host.remove() } })
  return { db, book, entry, illustration, host, root }
}
const button = (host, text) => [...host.querySelectorAll('button')].find(node => node.textContent === text)

test('inserting a Codex illustration creates an independent gallery copy without live Codex identity', async t => {
  const f = await fixture(t)
  const editor = { current: { captureSelection: () => ({ editorId: 'editor', revision: 1, document: 'Prose', from: 0, to: 0, text: '' }) } }
  await act(async () => f.root.render(React.createElement(EditorBlocks, { bookId: f.book.id, editor, disabled: false, editRequest: null, insertImage: true })))
  await settle(() => document.querySelector(`option[value="codex:${f.illustration.id}"]`))
  const select = document.querySelector('select')
  await act(async () => { select.value = `codex:${f.illustration.id}`; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await settle(() => !select.disabled && select.value.startsWith('editor-image-'))
  const copy = await store.getGalleryImage(select.value)
  assert.ok(copy, 'Editor persisted an independent image')
  assert.equal(copy.entryId, undefined)
  assert.equal(copy.illustrationId, undefined)
  assert.equal((await p.getIllustration(f.entry.id)).id, f.illustration.id)
})

for (const mode of ['workspace', 'panel']) {
  test(`${mode} gallery deletes legacy editor copies without deleting the original Codex illustration`, async t => {
    const f = await fixture(t)
    const id = 'editor-image-legacy-' + mode
    await f.db.table('galleryImages').add({ ...pixels, id, bookId: f.book.id, entryId: f.entry.id, illustrationId: f.illustration.id, prompt: 'Legacy editor copy', kept: true, createdAt: Date.now() })
    if (mode === 'workspace') await act(async () => f.root.render(React.createElement(ImageGalleryView, { bookId: f.book.id, state: createImageWorkspaceState(), onStateChange: () => {} })))
    else {
      await act(async () => f.root.render(React.createElement(ImagePanel, { bookId: f.book.id })))
      await act(async () => button(f.host, 'Gallery').click())
    }
    await settle(() => [...f.host.querySelectorAll('article')].some(node => node.textContent.includes('Legacy editor copy')))
    const card = [...f.host.querySelectorAll('article')].find(node => node.textContent.includes('Legacy editor copy'))
    if (mode === 'workspace') await act(async () => card.querySelector('.image-result-preview').click())
    const remove = button(mode === 'workspace' ? document : card, 'Delete image')
    assert.ok(remove, 'Copy has a delete action')
    await act(async () => remove.click())
    // Wait for completion of the real async action before inspecting durable state.
    await settle(() => !remove.isConnected || !remove.disabled)
    const original = await p.getIllustration(f.entry.id)
    assert.equal(original?.id, f.illustration.id, 'Deleting a gallery copy must not remove the Codex original')
    assert.equal((await p.getEntity(f.entry.id)).primaryImageId, f.illustration.id)
    assert.equal(await store.getGalleryImage(id), undefined, 'Only the chosen gallery copy was deleted')
  })
}

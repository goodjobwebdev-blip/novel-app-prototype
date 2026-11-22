import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after } from 'node:test'
import { transpileSourceTree } from './transpile-source-tree.mjs'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { JSDOM } from 'jsdom'
import 'fake-indexeddb/auto'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://arc.test/' })
for (const key of ['window', 'document', 'HTMLElement', 'CustomEvent', 'localStorage', 'sessionStorage']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0)
globalThis.cancelAnimationFrame = clearTimeout
const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const directory = mkdtempSync(new URL('../node_modules/.workspace-switch-test-', import.meta.url))
transpileSourceTree(directory)
// CodeMirror's layout engine needs a browser; retain the real Workspace navigation
// and metadata components while supplying only its editor handle in this DOM test.
writeFileSync(`${directory}/features/editor/MarkdownEditor.mjs`, `
import React, { forwardRef, useImperativeHandle } from 'react';
export default forwardRef(function Editor({ value, ariaLabel }, ref) {
  useImperativeHandle(ref, () => ({
    getMarkdown: () => value,
    captureAutocompleteSnapshot: () => null,
    isAutocompleteSnapshotCurrent: () => false,
    setAutocompleteSuggestion: () => false,
    clearAutocompleteSuggestion() {},
    acceptAutocompleteSuggestion: () => false,
  }));
  return React.createElement('div', { role: 'textbox', 'aria-label': ariaLabel }, value);
});
`)
const moduleAt = name => import(pathToFileURL(`${directory}/${name}.mjs`))
const p = await moduleAt('data/persistence')
const { initialAiSettings } = await moduleAt('shared/ai/ai-settings')
const { default: Workspace } = await moduleAt('app/Workspace')
after(async () => { (await p.database()).close(); dom.window.close(); rmSync(directory, { recursive: true, force: true }) })

async function settle(predicate) {
  for (let i = 0; i < 200 && !predicate(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 10)))
  assert.ok(predicate(), document.body.textContent)
}
async function click(element) { assert.ok(element, 'The navigation control exists'); await act(async () => element.click()) }
const button = label => document.querySelector(`button[aria-label="${label}"]`)

test('scene and note titles edit inline without duplicate controls or sibling keys', async t => {
  await p.ensurePrototypeSeed('demo')
  const { book } = await p.createBook(initialAiSettings, 'Switching test book')
  await p.createNote(book.id, 'First note')
  await p.createNote(book.id, 'Second note')
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await act(async () => root.unmount()) })
  const errors = [], originalError = console.error
  console.error = (...args) => { errors.push(args.join(' ')); originalError(...args) }
  try {
    await act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Workspace))))
    const bookButton = () => [...document.querySelectorAll('.library-book')].find(item => item.textContent.includes(book.title))
    await settle(bookButton)
    await click(bookButton())
    await settle(() => button('Open book workspace'))
    async function renameTitle(entity, label, selector) {
      const titleControl = () => document.querySelector(`${selector} button`)
      assert.ok(titleControl(), `${label} title is directly editable`)
      const originalContent = (await p.getEntity(entity.id)).content
      const input = () => document.querySelector(`input[aria-label="${label}"]`)
      const type = async value => act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input(), value)
        input().dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      })
      const key = async value => act(async () => input().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true })))
      await click(titleControl())
      assert.ok(document.activeElement === input(), 'Title input receives focus')
      assert.equal(input().value, entity.title)
      await type('   ')
      await key('Enter')
      assert.equal(input().getAttribute('aria-invalid'), 'true', 'Blank titles remain editable')
      assert.equal((await p.getEntity(entity.id)).title, entity.title)
      await type('Cancelled title')
      await key('Escape')
      assert.equal(input(), null)
      assert.equal(titleControl().textContent, entity.title)
      await click(titleControl())
      await type(`  ${entity.title} renamed  `)
      await key('Enter')
      await settle(() => titleControl()?.textContent === `${entity.title} renamed`)
      assert.equal((await p.getEntity(entity.id)).title, `${entity.title} renamed`)
      await click(titleControl())
      await type(`${entity.title} final`)
      await act(async () => input().blur())
      await settle(() => titleControl()?.textContent === `${entity.title} final`)
      const saved = await p.getEntity(entity.id)
      assert.equal(saved.title, `${entity.title} final`)
      assert.equal(saved.content, originalContent, 'Renaming does not change the document body')
      assert.equal(document.querySelector('.document-path').textContent.includes(saved.title), true)
    }
    for (const title of ['First note', 'Second note', 'First note']) {
      await click(button('Open book workspace'))
      await click([...document.querySelectorAll('.book-panel nav button')].find(item => item.textContent === 'notes'))
      await click([...document.querySelectorAll('.notes-panel .arc-resource-row__open')].find(item => item.textContent.includes(title)))
      await settle(() => document.querySelector('.document-titlebar h1')?.textContent === title)
      assert.equal(document.querySelectorAll('.note-roles').length, 1, 'Only the current note has role controls')
      assert.equal(document.querySelectorAll('.note-roles input[type="checkbox"]').length, 2)
    }
    await click(button('Open book workspace'))
    await click(button('Return to Scene'))
    await settle(() => document.querySelector('.scene-title'))
    assert.equal(document.querySelectorAll('.note-roles').length, 0, 'Scene has no stale note controls')
    const entities = await p.listEntitiesByBook(book.id)
    const scene = entities.find(entity => entity.type === 'scene' && entity.title === document.querySelector('.scene-title').textContent)
    await renameTitle(scene, 'Scene title', '.scene-title')
    await click(button('Open book workspace'))
    await click([...document.querySelectorAll('.book-panel nav button')].find(item => item.textContent === 'notes'))
    await click([...document.querySelectorAll('.notes-panel .arc-resource-row__open')].find(item => item.textContent.includes('First note')))
    await settle(() => document.querySelector('.document-titlebar h1')?.textContent === 'First note')
    await renameTitle(entities.find(entity => entity.type === 'note' && entity.title === 'First note'), 'Note title', '.document-titlebar h1')
    assert.equal([...document.querySelectorAll('.document-title-actions button')].some(item => item.textContent === 'Rename'), false, 'Note title replaces the separate Rename button')
    assert.ok(!errors.some(message => /same key/.test(message)), 'Sibling components have distinct identities')
  } finally {
    console.error = originalError
  }
})

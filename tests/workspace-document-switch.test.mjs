import test, { after } from 'node:test'
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
for (const filename of readdirSync(new URL('../src/', import.meta.url)).filter(name => /\.tsx?$/.test(name))) {
  const source = readFileSync(new URL(`../src/${filename}`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
    .replace(/import ['"][^'"]+\.css['"];?/g, '')
    .replace(/(['"])(\.\/[^'"]+)\1/g, (_, quote, path) => `${quote}${path.replace(/\.tsx?$/, '')}.mjs${quote}`)
  writeFileSync(`${directory}/${filename.replace(/\.tsx?$/, '.mjs')}`, compiled)
}
// CodeMirror's layout engine needs a browser; retain the real Workspace navigation
// and metadata components while supplying only its editor handle in this DOM test.
writeFileSync(`${directory}/MarkdownEditor.mjs`, `
import React, { forwardRef, useImperativeHandle } from 'react';
export default forwardRef(function Editor({ value, ariaLabel }, ref) {
  useImperativeHandle(ref, () => ({ getMarkdown: () => value }));
  return React.createElement('div', { role: 'textbox', 'aria-label': ariaLabel }, value);
});
`)
const moduleAt = name => import(pathToFileURL(`${directory}/${name}.mjs`))
const p = await moduleAt('persistence')
const { initialAiSettings } = await moduleAt('ai-settings')
const { default: Workspace } = await moduleAt('Workspace')
after(async () => { (await p.database()).close(); dom.window.close(); rmSync(directory, { recursive: true, force: true }) })

async function settle(predicate) {
  for (let i = 0; i < 200 && !predicate(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 10)))
  assert.ok(predicate(), document.body.textContent)
}
async function click(element) { assert.ok(element, 'The navigation control exists'); await act(async () => element.click()) }
const button = label => document.querySelector(`button[aria-label="${label}"]`)

test('switching notes and returning to a scene never leaves duplicate note controls behind', async () => {
  const { book } = await p.createBook(initialAiSettings, 'Switching test book')
  await p.createNote(book.id, 'First note')
  await p.createNote(book.id, 'Second note')
  const root = createRoot(document.getElementById('root'))
  const errors = [], originalError = console.error
  console.error = (...args) => { errors.push(args.join(' ')); originalError(...args) }
  try {
    await act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Workspace))))
    const bookButton = () => [...document.querySelectorAll('.library-book')].find(item => item.textContent.includes(book.title))
    await settle(bookButton)
    await click(bookButton())
    await settle(() => button('Open book workspace'))
    for (const title of ['First note', 'Second note', 'First note']) {
      await click(button('Open book workspace'))
      await click([...document.querySelectorAll('.book-panel nav button')].find(item => item.textContent === 'notes'))
      await click([...document.querySelectorAll('.content-open')].find(item => item.textContent.includes(title)))
      await settle(() => document.querySelector('.document-titlebar h1')?.textContent === title)
      assert.equal(document.querySelectorAll('.note-roles').length, 1, 'Only the current note has role controls')
      assert.equal(document.querySelectorAll('.note-roles input[type="checkbox"]').length, 2)
    }
    await click(button('Open book workspace'))
    await click(button('Return to Scene'))
    await settle(() => document.querySelector('.scene-title'))
    assert.equal(document.querySelectorAll('.note-roles').length, 0, 'Scene has no stale note controls')
    assert.ok(!errors.some(message => /same key/.test(message)), 'Sibling components have distinct identities')
  } finally {
    console.error = originalError
    await act(async () => root.unmount())
  }
})

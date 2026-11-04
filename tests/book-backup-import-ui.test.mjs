import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import { transpileSourceTree } from './transpile-source-tree.mjs'

const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'https://arc.test/' })
after(() => dom.window.close())
for (const key of ['window', 'document', 'HTMLElement', 'Event']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const directory = mkdtempSync(new URL('../node_modules/.book-backup-import-test-', import.meta.url))
after(() => rmSync(directory, { recursive: true, force: true }))
transpileSourceTree(directory)
// Gate archive I/O only; the control and shared Button remain real.
writeFileSync(`${directory}/data/book-import.mjs`, `
export let calls = [];
export let complete;
export let fail;
export function importBookArchiveBlob(file) {
  calls.push(file);
  return new Promise((resolve, reject) => { complete = resolve; fail = reject });
}
`)
const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const { BookBackupImport } = await import(pathToFileURL(`${directory}/data/BookStorage.mjs`))
const archive = await import(pathToFileURL(`${directory}/data/book-import.mjs`))

test('backup picker exposes busy state, rejects duplicate imports and supports retry after errors', async t => {
  const imported = []
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await act(async () => root.unmount()) })
  await act(async () => root.render(React.createElement(BookBackupImport, { onImported: async id => { imported.push(id) } })))
  const button = document.querySelector('button')
  const input = document.querySelector('input')
  assert.equal(button.textContent, 'Import book backup')
  assert.equal(button.type, 'button')
  assert.equal(input.accept, '.arcbook')
  assert.equal(input.getAttribute('aria-label'), 'Import book backup file')
  let pickerClicks = 0
  input.addEventListener('click', () => { pickerClicks++ })
  await act(async () => button.click())
  assert.equal(pickerClicks, 1)
  const file = new dom.window.File(['archive'], 'book.arcbook')
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  assert.equal(archive.calls.length, 1)
  assert.ok(archive.calls[0] === file, 'Selected file is passed to the archive importer')
  assert.equal(button.disabled, true)
  assert.equal(button.textContent, 'Importing…')
  assert.equal(button.getAttribute('aria-busy'), 'true')
  await act(async () => {
    button.click()
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  assert.equal(pickerClicks, 1)
  assert.equal(archive.calls.length, 1)
  await act(async () => archive.fail(new Error('Invalid backup archive')))
  assert.equal(document.querySelector('[role="alert"]').textContent, 'Invalid backup archive')
  assert.equal(button.disabled, false)
  assert.notEqual(button.getAttribute('aria-busy'), 'true')
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  assert.equal(archive.calls.length, 2)
  assert.equal(document.querySelector('[role="alert"]'), null)
  await act(async () => archive.complete('restored-book'))
  assert.deepEqual(imported, ['restored-book'])
  assert.equal(button.disabled, false)
  assert.equal(button.textContent, 'Import book backup')
  assert.notEqual(button.getAttribute('aria-busy'), 'true')
  assert.equal(input.value, '', 'The same archive can be selected again')
})

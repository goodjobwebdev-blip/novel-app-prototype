import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { buildSync } from 'esbuild'
import { JSDOM } from 'jsdom'
import { codexTitleTriggerSuggestions } from '../src/features/codex/codex-trigger-service.ts'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://arc.test/' })
after(() => dom.window.close())
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const directory = mkdtempSync(new URL('../node_modules/.codex-entry-ui-', import.meta.url))
after(() => rmSync(directory, { recursive: true, force: true }))
for (const name of ['CodexEntryTitle', 'CodexTriggerSuggestions']) buildSync({ entryPoints: [new URL(`../src/features/codex/${name}.tsx`, import.meta.url).pathname], jsx: 'automatic', bundle: true, packages: 'external', format: 'esm', outfile: `${directory}/${name}.mjs`, loader: { '.css': 'empty' }, logLevel: 'silent' })
const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const { default: Title } = await import(pathToFileURL(`${directory}/CodexEntryTitle.mjs`))
const { default: Suggestions } = await import(pathToFileURL(`${directory}/CodexTriggerSuggestions.mjs`))
const h = React.createElement
async function mount(t, component, props) {
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await act(async () => root.unmount()) })
  await act(async () => root.render(h(component, props)))
  return root
}
async function edit(value) {
  const input = document.querySelector('input')
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
}
async function key(value) {
  await act(async () => document.querySelector('input').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true })))
}

test('title suggestions offer words then the full name, without standalone English honorifics', () => {
  assert.deepEqual(codexTitleTriggerSuggestions('Nicholas Cage'), ['Nicholas', 'Cage', 'Nicholas Cage'])
  for (const prefix of ['Mr.', 'Mister', 'Dr.', 'Doctor', 'Mrs.', 'Ms.', 'Miss', 'Professor', 'Sir']) {
    assert.deepEqual(codexTitleTriggerSuggestions(`${prefix} Nicholas Cage`), ['Nicholas', 'Cage', 'Nicholas Cage', `${prefix} Nicholas Cage`])
  }
  assert.deepEqual(codexTitleTriggerSuggestions('Dr. Sir Nicholas Cage'), ['Nicholas', 'Cage', 'Nicholas Cage', 'Dr. Sir Nicholas Cage'])
  assert.deepEqual(codexTitleTriggerSuggestions('  Николас   Кейдж '), ['Николас', 'Кейдж', 'Николас Кейдж'])
  assert.deepEqual(codexTitleTriggerSuggestions('Anne-Marie O’Neill'), ['Anne-Marie', 'O’Neill', 'Anne-Marie O’Neill'])
  assert.deepEqual(codexTitleTriggerSuggestions('Mara Mara', ['  MARA ']), ['Mara Mara'])
  assert.deepEqual(codexTitleTriggerSuggestions('Nicholas Cage', ['nicholas', ' Nicholas\tCage ']), ['Cage'])
  for (const title of ['', 'Untitled Entry', 'Untitled Entry 2', 'Dr.']) assert.deepEqual(codexTitleTriggerSuggestions(title), [])
})

test('suggestion links append one trigger per line and suppress already selected suggestions', async t => {
  const added = []
  function Editor() {
    const [value, setValue] = React.useState('Alias')
    return h('div', null, h('textarea', { readOnly: true, value }), h(Suggestions, { title: 'Dr. Nicholas Cage', value, disabled: false, onAdd(trigger) { added.push(trigger); setValue(current => `${current}\n${trigger}`) } }))
  }
  await mount(t, Editor, {})
  await act(async () => document.querySelector('button[aria-label="Add trigger: Nicholas"]').click())
  assert.deepEqual(added, ['Nicholas'])
  assert.equal(document.querySelector('textarea').value, 'Alias\nNicholas')
  assert.equal(document.querySelector('button[aria-label="Add trigger: Nicholas"]'), null)
  assert.ok(document.querySelector('button[aria-label="Add trigger: Nicholas Cage"]'))
})

test('suggestions cannot be added while generation is active', async t => {
  const added = []
  await mount(t, Suggestions, { title: 'Nicholas Cage', value: '', disabled: true, onAdd: value => added.push(value) })
  await act(async () => document.querySelector('button').click())
  assert.deepEqual(added, [])
  assert.ok([...document.querySelectorAll('button')].every(button => button.disabled))
})

test('clicking the heading edits the title and Enter saves without a rename dialog', async t => {
  const saved = []
  function Editor() {
    const [title, setTitle] = React.useState('Nicholas Cage')
    return h(Title, { title, disabled: false, readOnly: false, async onSave(next) { saved.push(next); setTitle(next) } })
  }
  await mount(t, Editor, {})
  await act(async () => document.querySelector('h1 button').click())
  assert.equal(document.activeElement.getAttribute('aria-label'), 'Codex entry name')
  await edit('  Doctor Cage  ')
  await key('Enter')
  assert.deepEqual(saved, ['Doctor Cage'])
  assert.equal(document.querySelector('h1').textContent, 'Doctor Cage')
  assert.equal(document.querySelector('input'), null)
})

test('leaving the title saves, Escape cancels, and empty names do not save', async t => {
  const saved = []
  const props = { title: 'Nicholas Cage', disabled: false, readOnly: false, async onSave(value) { saved.push(value) } }
  await mount(t, Title, props)
  await act(async () => document.querySelector('h1 button').click())
  await edit('Cancelled name')
  await key('Escape')
  assert.deepEqual(saved, [])
  assert.equal(document.querySelector('h1').textContent, props.title)
  await act(async () => document.querySelector('h1 button').click())
  await edit(' ')
  await key('Enter')
  assert.deepEqual(saved, [])
  assert.equal(document.querySelector('[role="alert"]').textContent, 'Enter an entry name.')
  await edit('New name')
  await act(async () => document.querySelector('input').blur())
  assert.deepEqual(saved, ['New name'])
})

test('failed title save keeps the draft and allows retry without duplicate pending saves', async t => {
  let finish, calls = 0
  await mount(t, Title, { title: 'Old name', disabled: false, readOnly: false, onSave() { calls++; return new Promise((resolve, reject) => { finish = { resolve, reject } }) } })
  await act(async () => document.querySelector('h1 button').click())
  await edit('New name')
  await key('Enter')
  await key('Enter')
  assert.equal(calls, 1)
  assert.equal(document.querySelector('input').disabled, true)
  await act(async () => finish.reject(new Error('Storage unavailable')))
  assert.equal(document.querySelector('input').value, 'New name')
  assert.equal(document.querySelector('[role="alert"]').textContent, 'Storage unavailable')
  await key('Enter')
  assert.equal(calls, 2)
  await act(async () => finish.resolve())
  assert.equal(document.querySelector('input'), null)
})

test('archived titles are static and generation disables inline rename', async t => {
  const props = { title: 'Archived name', disabled: false, readOnly: true, async onSave() { assert.fail('must not save') } }
  const root = await mount(t, Title, props)
  assert.equal(document.querySelector('h1').textContent, props.title)
  assert.equal(document.querySelector('button'), null)
  await act(async () => root.render(h(Title, { ...props, readOnly: false, disabled: true })))
  assert.equal(document.querySelector('button').disabled, true)
  await act(async () => document.querySelector('button').click())
  assert.equal(document.querySelector('input'), null)
})

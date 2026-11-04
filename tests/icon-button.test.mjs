import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import { transpileSourceTree } from './transpile-source-tree.mjs'

const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'https://arc.test/' })
after(() => dom.window.close())
for (const key of ['window', 'document', 'HTMLElement', 'Event']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const directory = mkdtempSync(new URL('../node_modules/.icon-button-test-', import.meta.url))
after(() => rmSync(directory, { recursive: true, force: true }))
transpileSourceTree(directory)
const React = await import('react')
const { act, createElement: h } = React
const { createRoot } = await import('react-dom/client')
const buttons = await import(pathToFileURL(`${directory}/shared/ui/Button.mjs`))

test('shared icon action preserves its accessible name, ref, native activation and busy/disabled behavior', async t => {
  assert.equal(typeof buttons.IconButton, 'function', 'Provide a reusable icon-only button rather than per-screen button geometry')
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await act(async () => root.unmount()) })
  const ref = React.createRef()
  let clicks = 0
  const render = props => act(async () => root.render(h(buttons.IconButton, {
    'aria-label': 'Close panel', ref, onClick: () => clicks++, ...props,
  }, h('svg', { 'data-icon': 'close' }))))
  await render({})
  const button = document.querySelector('button')
  assert.equal(button.type, 'button', 'Icon actions do not implicitly submit forms')
  assert.equal(button.getAttribute('aria-label'), 'Close panel')
  assert.equal(button.title, 'Close panel', 'Icon-only actions expose a tooltip')
  assert.ok(ref.current === button, 'Menu anchors and focus management receive the real native button')
  assert.equal(button.querySelector('svg').closest('[aria-hidden]').getAttribute('aria-hidden'), 'true')
  button.focus()
  assert.ok(document.activeElement === button, 'The native button remains keyboard focusable')
  await act(async () => button.click())
  assert.equal(clicks, 1)
  await render({ disabled: true })
  await act(async () => button.click())
  assert.equal(clicks, 1, 'Disabled actions cannot activate')
  await render({ loading: true })
  assert.equal(button.disabled, true)
  assert.equal(button.getAttribute('aria-busy'), 'true')
  assert.equal(button.getAttribute('aria-label'), 'Close panel', 'Busy presentation retains the accessible name')
  await act(async () => button.click())
  assert.equal(clicks, 1, 'Busy actions cannot activate')
  await render({ title: 'Close (Escape)' })
  assert.equal(button.title, 'Close (Escape)', 'Existing shortcut tooltips are preserved')
  assert.equal(button.disabled, false)
  assert.equal(button.getAttribute('aria-busy'), null)
  await act(async () => button.click())
  assert.equal(clicks, 2)
})

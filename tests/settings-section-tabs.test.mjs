import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import { transpileSourceTree } from './transpile-source-tree.mjs'

const directory = mkdtempSync(new URL('../node_modules/.settings-section-tabs-test-', import.meta.url))
after(() => rmSync(directory, { recursive: true, force: true }))
transpileSourceTree(directory)
const React = await import('react')
const { act, createElement: h, useState } = React
const { default: SettingsSectionTabs } = await import(pathToFileURL(`${directory}/features/settings/SettingsSectionTabs.mjs`))
const sections = [['theme', 'Theme'], ['typography', 'Typography'], ['editor', 'Editor']]

async function renderTabs(t) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://arc.test/', pretendToBeVisual: true,
  })
  const previousGlobals = new Map()
  let root
  let unmounted = false
  async function unmount() {
    if (root && !unmounted) {
      await act(async () => root.unmount())
      unmounted = true
    }
  }
  t.after(async () => {
    try {
      await unmount()
    } finally {
      dom.window.close()
      for (const [key, descriptor] of previousGlobals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else delete globalThis[key]
      }
    }
  })
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  const { createRoot } = await import('react-dom/client')
  const changes = []
  // SettingsSectionTabs is controlled and supplies IDs, not panel content.
  // This consumer wires those IDs to panels and applies the emitted selection.
  function SettingsFixture() {
    const [active, setActive] = useState('theme')
    return h(React.Fragment, null,
      h(SettingsSectionTabs, {
        tabs: sections, active, idPrefix: 'appearance', label: 'Appearance sections',
        onChange: value => { changes.push(value); setActive(value) },
      }),
      ...sections.map(([value, label]) => h('section', {
        key: value, role: 'tabpanel', id: `appearance-panel-${value}`,
        'aria-labelledby': `appearance-tab-${value}`, hidden: active !== value,
      }, `${label} settings`)),
    )
  }
  root = createRoot(dom.window.document.getElementById('root'))
  t.after(unmount)
  await act(async () => root.render(h(SettingsFixture)))
  return { dom, changes }
}

function assertSelection(dom, active) {
  const document = dom.window.document
  assert.equal(document.querySelectorAll('[role="tab"]').length, sections.length)
  assert.equal(document.querySelectorAll('[role="tab"][aria-selected="true"]').length, 1)
  assert.equal(document.querySelectorAll('[role="tab"][tabindex="0"]').length, 1)
  assert.equal(document.querySelectorAll('[role="tabpanel"]:not([hidden])').length, 1)
  for (const [value, label] of sections) {
    const tab = document.getElementById(`appearance-tab-${value}`)
    assert.ok(tab, `${value} tab exists`)
    assert.equal(tab.getAttribute('role'), 'tab')
    assert.equal(tab.textContent, label)
    assert.equal(tab.getAttribute('aria-selected'), String(value === active))
    assert.equal(tab.tabIndex, value === active ? 0 : -1)
    assert.equal(tab.getAttribute('aria-controls'), `appearance-panel-${value}`)
    const panel = document.getElementById(tab.getAttribute('aria-controls'))
    assert.ok(panel, `${value} tab controls an existing panel`)
    assert.equal(panel.getAttribute('role'), 'tabpanel')
    assert.equal(panel.getAttribute('aria-labelledby'), tab.id)
    assert.equal(panel.hidden, value !== active)
  }
}

async function pressKey(dom, key) {
  const event = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  await act(async () => {
    dom.window.document.activeElement.dispatchEvent(event)
    // Tabs defers focus to requestAnimationFrame; wait for the actual DOM API.
    await new Promise(resolve => dom.window.requestAnimationFrame(resolve))
  })
  assert.equal(event.defaultPrevented, true, `${key} prevents the browser default`)
}

test('settings tabs expose a labelled tablist, active selection and reciprocal panel links', async t => {
  const { dom, changes } = await renderTabs(t)
  const tablist = dom.window.document.querySelector('[role="tablist"]')
  assert.ok(tablist)
  assert.equal(tablist.getAttribute('aria-label'), 'Appearance sections')
  assert.equal(tablist.classList.contains('settings-section-tabs'), true)
  assertSelection(dom, 'theme')
  assert.deepEqual(changes, [])
})

test('clicking settings tabs emits their values and updates selection and panels', async t => {
  const { dom, changes } = await renderTabs(t)
  for (const value of ['typography', 'editor', 'theme']) {
    await act(async () => dom.window.document.getElementById(`appearance-tab-${value}`).click())
    assertSelection(dom, value)
  }
  assert.deepEqual(changes, ['typography', 'editor', 'theme'])
})

test('settings tab keyboard navigation wraps and Home/End move both focus and selection', async t => {
  const { dom, changes } = await renderTabs(t)
  dom.window.document.getElementById('appearance-tab-theme').focus()
  const moves = [
    ['ArrowLeft', 'editor'],
    ['ArrowRight', 'theme'],
    ['ArrowRight', 'typography'],
    ['ArrowLeft', 'theme'],
    ['End', 'editor'],
    ['Home', 'theme'],
  ]
  for (const [key, value] of moves) {
    await pressKey(dom, key)
    assertSelection(dom, value)
    assert.equal(dom.window.document.activeElement.id, `appearance-tab-${value}`, `${key} focuses ${value}`)
  }
  assert.deepEqual(changes, moves.map(([, value]) => value))
})

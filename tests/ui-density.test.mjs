import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const compiled = await build({
  stdin: { contents: `export { default as Input } from './src/shared/ui/Input.tsx'; export { default as Select } from './src/shared/ui/Select.tsx'; export { default as Checkbox } from './src/shared/ui/Checkbox.tsx'; export { default as Choice } from './src/shared/ui/Choice.tsx'; export * as ui from './src/features/settings/ui-settings.ts';`, resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'tsx' },
  bundle: true, platform: 'node', format: 'cjs', write: false,
  external: ['react', 'react-dom/server'], jsx: 'automatic', loader: { '.css': 'empty' },
})
const module = { exports: {} }
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
const { Input, Select, Checkbox, Choice, ui } = module.exports

async function styledDom(t, content) {
  const dom = new JSDOM(`<html><head></head><body><div class="ai-settings-shell"><section class="settings-card">${content}</section></div></body></html>`)
  t.after(() => dom.window.close())
  for (const path of ['src/shared/ui/primitives.css', 'src/shared/ui/choice.css', 'src/app/styles.css', 'src/shared/ui/density.css', 'src/features/settings/ui-settings.css', 'src/features/settings/ai-settings-ux.css']) {
    const style = dom.window.document.createElement('style')
    style.textContent = await readFile(new URL(`../${path}`, import.meta.url), 'utf8')
    dom.window.document.head.append(style)
  }
  return dom
}

test('shared fields own their spacing and descriptions inside legacy settings', async t => {
  const content = renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement(Input, { label: 'Name', description: 'Input help', error: 'Input error' }),
    React.createElement(Input, { className: 'ui-theme-name', label: 'Theme name' }),
    React.createElement(Select, { label: 'Role', description: 'Select help', error: 'Select error' }, React.createElement('option', null, 'Main')),
    React.createElement(Checkbox, { label: 'Enabled', description: 'Checkbox help' }),
    React.createElement(Choice, { title: 'Context', description: 'Choice help', type: 'checkbox' }),
  ))
  const dom = await styledDom(t, content)
  const { document, getComputedStyle } = dom.window
  for (const element of document.querySelectorAll('.arc-field > span, .arc-choice > span, .arc-rich-choice > span')) {
    assert.equal(getComputedStyle(element).marginBottom, '0px', `${element.className} must not add a second gap`)
  }
  for (const description of document.querySelectorAll('.arc-field__description')) {
    assert.equal(getComputedStyle(description).display, 'block', 'Descriptions must not inherit legacy label flex layout')
    assert.equal(getComputedStyle(description).fontSize, '12px', 'Input and Select help use the same supporting type')
  }
})

test('ordinary controls keep shared density in panel headers and legacy feature forms', async t => {
  const dom = await styledDom(t, `
    <header class="arc-panel-header"><div class="arc-panel-header__actions"><button class="arc-button arc-button--medium">Save changes</button></div></header>
    <label class="appearance-field"><select><option>Appearance</option></select></label>
    <div class="chat-predefined"><input class="arc-input"><select class="arc-select"><option>Role</option></select></div>
    <div class="world-workspace-panel"><select><option>World</option></select></div>
    <details class="arc-disclosure"><summary>Advanced settings</summary></details>
    <div class="arc-segmented-control"><button class="arc-segmented-control__option">Default</button></div>
    <div class="arc-search-field"><input aria-label="Search"></div>
    <div class="speech-key-row"><button>Load voices</button></div>
    <div class="speed-presets"><button>Normal</button></div>
  `)
  const { document, getComputedStyle } = dom.window
  for (const path of ['src/shared/ui/disclosure.css', 'src/shared/ui/segmented-control.css', 'src/shared/ui/searchable-select.css', 'src/features/chat/chat.css', 'src/features/worlds/worlds.css', 'src/features/speech/tts.css']) {
    const style = document.createElement('style')
    style.textContent = await readFile(new URL(`../${path}`, import.meta.url), 'utf8')
    document.head.append(style)
  }
  for (const selector of ['.arc-panel-header__actions .arc-button', '.appearance-field select', '.chat-predefined .arc-input', '.chat-predefined .arc-select', '.world-workspace-panel select', '.arc-disclosure > summary', '.arc-segmented-control__option', '.arc-search-field', '.speech-key-row button', '.speed-presets button']) {
    assert.equal(getComputedStyle(document.querySelector(selector)).minHeight, 'var(--control-height)', `${selector} must inherit desktop/touch density instead of a feature-specific fixed minimum`)
  }
  assert.equal(getComputedStyle(document.querySelector('.arc-search-field input')).minHeight, '0', 'Embedded search inputs must not add another control height')
})

test('shared density and surface tokens govern settings without changing manuscript typography', async t => {
  const dom = await styledDom(t, '<section class="book-profile-row"></section><p class="profile-linked-warning"></p><div class="profile-save-bar"></div>')
  const { document } = dom.window
  const style = document.createElement('style')
  style.textContent = await readFile(new URL('../src/features/settings/settings-profiles.css', import.meta.url), 'utf8')
  document.head.append(style)
  const root = dom.window.getComputedStyle(document.documentElement)
  assert.notEqual(root.getPropertyValue('--field-gap').trim(), '', 'Shared field-gap token is defined')
  assert.notEqual(root.getPropertyValue('--card-padding').trim(), '', 'Shared card-padding token is defined')
  assert.notEqual(root.getPropertyValue('--touch-target').trim(), '', 'Touch target remains separate from spacing')
  for (const selector of ['.book-profile-row', '.profile-linked-warning', '.profile-save-bar']) {
    assert.equal(dom.window.getComputedStyle(document.querySelector(selector)).borderRadius, 'var(--radius)', `${selector} uses ordinary surface geometry`)
  }
  const previous = globalThis.document
  globalThis.document = document
  try {
    for (const theme of ['very-dark', 'very-white']) {
      ui.applyUiSettings({ ...ui.defaultUiSettings, activeThemeId: theme })
      assert.equal(document.documentElement.dataset.uiTheme, theme, 'Both dark and light palettes are exercised')
      const palette = ui.builtInThemes.find(item => item.id === theme).palette
      assert.equal(document.documentElement.style.getPropertyValue('--soft').trim(), palette.muted, 'Applying a theme updates its secondary color')
      assert.equal(document.documentElement.style.getPropertyValue('--line').trim(), palette.border, 'Applying a theme updates its border color')
      assert.equal(document.documentElement.style.getPropertyValue('--editor-font-size'), `${ui.defaultUiSettings.editor.fontSize}px`)
      assert.equal(document.documentElement.style.getPropertyValue('--editor-line-height'), String(ui.defaultUiSettings.editor.lineHeight))
    }
  } finally { globalThis.document = previous }
})

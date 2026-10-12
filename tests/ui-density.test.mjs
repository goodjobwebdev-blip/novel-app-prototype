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
  for (const path of ['src/shared/ui/primitives.css', 'src/shared/ui/choice.css', 'src/app/styles.css', 'src/features/settings/ai-settings-ux.css']) {
    const style = dom.window.document.createElement('style')
    style.textContent = await readFile(new URL(`../${path}`, import.meta.url), 'utf8')
    dom.window.document.head.append(style)
  }
  return dom
}

test('shared fields own their spacing and descriptions inside legacy settings', async t => {
  const content = renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement(Input, { label: 'Name', description: 'Input help', error: 'Input error' }),
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

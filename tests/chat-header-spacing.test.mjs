import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const mainUrl = new URL('../src/app/main.tsx', import.meta.url)
const styles = [...readFileSync(mainUrl, 'utf8').matchAll(/import '([^']+\.css)'/g)]
  .map(([, path]) => readFileSync(new URL(path, mainUrl), 'utf8'))

test('chat starts below the shell header at the same inset as scenes', t => {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main class="workspace-screen"><article class="story-editor"><h1>Scene</h1></article><section class="conversation functional-chat"><header><small>Book chat</small><h1>New chat</h1></header></section></main></body></html>')
  t.after(() => dom.window.close())
  for (const css of styles) {
    const style = dom.window.document.createElement('style')
    style.textContent = css
    dom.window.document.head.append(style)
  }
  const topInset = selector => dom.window.getComputedStyle(dom.window.document.querySelector(selector)).paddingTop
  assert.notEqual(topInset('.story-editor'), '', 'scene spacing must be loaded')
  assert.equal(topInset('.conversation'), topInset('.story-editor'),
    'Chat must follow the shell header height like scenes, rather than reserve a fixed blank area')
})

import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'

const styles = await Promise.all([
  'src/shared/ui/primitives.css', 'src/features/chat/chat.css', 'src/app/styles.css',
  'src/shared/ui/density.css', 'src/shared/ui/button-interactions.css',
  'src/features/chat/chat-composer-fix.css', 'src/features/chat/chat-model-picker-shape.css',
  'src/features/settings/ui-settings.css', 'src/shared/ui/mobile-control-hardening.css',
  'src/features/settings/theme-accents.css', 'src/features/chat/composer.css',
].map(path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')))

// Resolve palette variables before parsing: JSDOM does not resolve custom properties.
const palettes = {
  light: { canvas: '#faf8ff', surface: '#ffffff', ink: '#292132', soft: '#62566c' },
  sepia: { canvas: '#f3ead9', surface: '#fbf4e7', ink: '#332b22', soft: '#75634e' },
  dark: { canvas: '#101210', surface: '#1b1e1b', ink: '#eeeee8', soft: '#b7b9ad' },
}
function fixture(t, palette) {
  const dom = new JSDOM('<html><head></head><body><main class="functional-chat"><div class="functional-chat-composer chat-message-composer"><div class="chat-model-picker open"><section class="chat-model-menu"><label class="chat-model-search"><input></label><div class="chat-model-options"><button><span><strong>Model</strong></span></button></div></section></div></div><button class="arc-button arc-button--secondary chat-follow-output">↓ New content</button></main></body></html>')
  t.after(() => dom.window.close())
  for (const css of styles) {
    const style = dom.window.document.createElement('style')
    style.textContent = css.replace(/var\(--([\w-]+)\)/g, (match, key) => palette[key] ?? match)
    dom.window.document.head.append(style)
  }
  return dom
}
function rgb(hex) {
  const parts = hex.slice(1).match(/../g).map(value => Number.parseInt(value, 16))
  return `rgb(${parts.join(', ')})`
}
for (const [theme, palette] of Object.entries(palettes)) {
  test(`chat model menu uses the ${theme} palette instead of a fixed dark surface`, t => {
    const dom = fixture(t, palette)
    const menu = dom.window.document.querySelector('.chat-model-menu')
    assert.equal(dom.window.getComputedStyle(menu).backgroundColor, rgb(palette.surface))
  })
  test(`jump-to-latest high-specificity rule uses readable ${theme} theme colors`, t => {
    const dom = fixture(t, palette)
    const rule = [...dom.window.document.styleSheets].flatMap(sheet => [...sheet.cssRules])
      .find(rule => rule.selectorText === '.chat-follow-output.arc-button')
    assert.ok(rule, 'The floating button layout rule exists')
    // Inspect the winning high-specificity declaration: a later single-class
    // override cannot repair it in browsers, even though JSDOM ignores specificity.
    const probe = dom.window.document.createElement('button')
    probe.style.cssText = rule.style.cssText
    dom.window.document.body.append(probe)
    const computed = dom.window.getComputedStyle(probe)
    assert.equal(computed.backgroundColor, rgb(palette.canvas))
    assert.equal(computed.color, rgb(palette.ink))
  })
}

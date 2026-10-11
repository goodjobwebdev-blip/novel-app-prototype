import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const mainUrl = new URL('../src/app/main.tsx', import.meta.url)
const main = readFileSync(mainUrl, 'utf8')
// Preserve production stylesheet order, including legacy and theme overrides.
const styles = [...main.matchAll(/import '([^']+\.css)'/g)]
  .map(([, path]) => readFileSync(new URL(path, mainUrl), 'utf8'))

for (const [name, className] of [
  ['scene/codex', 'workspace-composer'],
  ['chat', 'chat-message-composer'],
  ['collapsed editor', 'workspace-composer is-collapsed'],
]) {
  test(`${name} drawer has no outer background, glass, border or shadow`, t => {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>')
    t.after(() => dom.window.close())
    const { document } = dom.window
    for (const css of styles) {
      const style = document.createElement('style')
      style.textContent = css
      document.head.append(style)
    }
    const composer = document.createElement('section')
    composer.className = `composer-shell chat-composer functional-chat-composer ${className}`
    composer.innerHTML = `
      <details class="chat-config-strip"><summary>Ready to generate</summary></details>
      <div class="chat-compose-row">
        <div class="expandable-text-input"><textarea aria-label="Instruction"></textarea></div>
        <div class="generation-actions"><button class="generation-primary">Generate</button></div>
      </div>
    `
    document.body.append(composer)
    const computed = element => dom.window.getComputedStyle(element)
    const shell = computed(composer)
    assert.equal(shell.backgroundColor, 'rgba(0, 0, 0, 0)')
    assert.equal(shell.backgroundImage, 'none')
    assert.equal(shell.getPropertyValue('backdrop-filter'), 'none')
    assert.equal(shell.boxShadow, 'none')
    for (const edge of ['Top', 'Right', 'Bottom', 'Left']) assert.equal(shell[`border${edge}Width`], '0px')

    const strip = computed(composer.querySelector('.chat-config-strip'))
    assert.notEqual(strip.backgroundColor, 'rgba(0, 0, 0, 0)', 'Dropdown keeps its own surface')
    assert.equal(strip.borderTopWidth, '1px')
  })
}

test('floating drawer explicitly disables WebKit glass too', () => {
  const css = readFileSync(new URL('../src/features/chat/composer.css', import.meta.url), 'utf8')
  const sharedRule = css.match(/\.chat-composer:is\(\.workspace-composer,\.chat-message-composer\) \{([^}]+)\}/)?.[1]
  assert.ok(sharedRule, 'Scene/Codex and Chat share the floating drawer style')
  assert.match(sharedRule, /-webkit-backdrop-filter: none;/)
})

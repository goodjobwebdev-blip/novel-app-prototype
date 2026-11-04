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

test('expanded editor Stop keeps the same vertical footprint as Generate', t => {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>')
  t.after(() => dom.window.close())
  const { document } = dom.window
  for (const css of styles) {
    const style = document.createElement('style')
    style.textContent = css
    document.head.append(style)
  }
  const composer = document.createElement('section')
  composer.className = 'composer-shell chat-composer functional-chat-composer workspace-composer'
  composer.innerHTML = `
    <div class="chat-compose-row">
      <div class="arc-prompt-field"><div class="expandable-text-input"><textarea></textarea></div></div>
      <div class="generate-control-shell"><div class="generation-actions"><button class="generation-primary">Generate</button></div></div>
    </div>
  `
  document.body.append(composer)
  const shell = composer.querySelector('.generate-control-shell')
  const footprint = button => {
    const css = dom.window.getComputedStyle(button)
    return { height: css.height, marginTop: css.marginTop, marginBottom: css.marginBottom }
  }
  const idle = footprint(shell.querySelector('button'))
  shell.className = 'generate-control-shell drawer-generation-stop'
  shell.innerHTML = '<button class="generation-stop-circle" aria-label="Stop generation">Stop</button>'
  assert.deepEqual(footprint(shell.querySelector('button')), idle,
    'Switching to Stop must not inherit the legacy composer bottom margin')
})

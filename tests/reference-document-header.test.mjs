import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const workspace = readFileSync(new URL('../src/app/Workspace.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/app/styles.css', import.meta.url), 'utf8')

function rule(selector) {
  const start = css.indexOf(`${selector} {`)
  assert.ok(start >= 0, `Missing CSS rule: ${selector}`)
  return css.slice(start, css.indexOf('}', start) + 1)
}

test('Notes and Codex omit the page marker without changing scene numbers or summary markers', () => {
  assert.match(workspace, /const isReferenceDocument = activeDocument\?\.type === 'note' \|\| activeDocument\?\.type === 'codexEntry'/)
  assert.match(workspace, /const pageLabel = isReferenceDocument\s*\? null\s*: activeDocument\?\.type === 'summary'\s*\? 'Σ'\s*: String\(\(activeChapter\?\.order \?\? 0\) \+ 1\)\.padStart\(2, '0'\)/)
  assert.match(workspace, /isReferenceDocument \? 'story-editor--reference' : ''/)
  assert.match(workspace, /\{pageLabel && <small className="page-number">\{pageLabel\}<\/small>\}/)
})

test('reference headers preserve breadcrumbs and the Codex type label', () => {
  assert.ok(workspace.includes('`Notes / ${activeDocument.title}`'))
  assert.ok(workspace.includes('`Codex / ${activeDocument.category} / ${activeDocument.title}`'))
  assert.match(workspace, /<p className="document-path">\{documentPath \|\| 'No document selected'\}<\/p>/)
  assert.match(workspace, /<small>\{activeCodexArchived \? `Archived · \$\{activeDocument\.category\}` : activeDocument\.category\}<\/small>/)
})

test('reference breadcrumbs start 24px below the toolbar while manuscript spacing stays unchanged', t => {
  const styles = ['.story-editor', '.document-path', '.story-editor--reference', '.story-editor--reference > .document-path'].map(rule).join('\n')
  const dom = new JSDOM(`<style>${styles}</style><article class="story-editor story-editor--reference"><p class="document-path">Codex / Place / The Drowned Quarter</p></article><article class="story-editor"><small class="page-number">01</small><p class="document-path">Outline / Scene</p></article>`)
  t.after(() => dom.window.close())
  const reference = dom.window.document.querySelector('.story-editor--reference')
  const manuscript = dom.window.document.querySelector('.story-editor:not(.story-editor--reference)')
  assert.match(rule('.floating-controls'), /inset:14px /)
  assert.match(rule('.floating-controls > button,.floating-control-group > button'), /height:44px;/)
  assert.equal(Number.parseFloat(dom.window.getComputedStyle(reference).paddingTop) - 14 - 44, 24)
  assert.equal(dom.window.getComputedStyle(reference.firstElementChild).marginTop, '0px')
  // JSDOM does not resolve the clamp() in the manuscript padding shorthand.
  assert.match(rule('.story-editor'), /padding:112px clamp\(23px,6vw,56px\) 170px;/)
  assert.equal(dom.window.getComputedStyle(manuscript.querySelector('.document-path')).marginTop, '8px')
})

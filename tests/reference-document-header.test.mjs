import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const workspace = readFileSync(new URL('../src/app/Workspace.tsx', import.meta.url), 'utf8')

function pageLabel(type) {
  const declarations = workspace.slice(workspace.indexOf('  const isReferenceDocument ='), workspace.indexOf('  const openSummaryState ='))
  return new Function('activeDocument', 'activeChapter', `${declarations}\nreturn pageLabel`)({ type }, { order: 0 })
}

test('scene, Note and Codex headers omit numbering while summaries retain their marker', () => {
  for (const type of ['scene', 'note', 'codexEntry']) assert.equal(pageLabel(type), null, type)
  assert.equal(pageLabel('summary'), 'Σ')
  assert.match(workspace, /\{pageLabel && <small className="page-number">\{pageLabel\}<\/small>\}/)
})

test('reference headers preserve breadcrumbs and the Codex type label', () => {
  assert.ok(workspace.includes('`Notes / ${activeDocument.title}`'))
  assert.ok(workspace.includes('`Codex / ${activeDocument.category} / ${activeDocument.title}`'))
  assert.match(workspace, /<p className="document-path">\{documentPath \|\| 'No document selected'\}<\/p>/)
  assert.match(workspace, /<small>\{activeCodexArchived \? `Archived · \$\{activeDocument\.category\}` : activeDocument\.category\}<\/small>/)
})

for (const type of ['scene', 'note', 'codexEntry']) {
  test(`${type} keeps toolbar, breadcrumbs and title compact without shrinking controls`, t => {
    const reference = type !== 'scene'
    const dom = new JSDOM(`<header class="floating-controls"><button>Workspace</button></header><article class="story-editor ${reference ? 'story-editor--reference' : ''}"><p class="document-path">Document path</p>${reference ? '<div class="document-titlebar"><div><h1>Title</h1></div></div>' : '<h1 class="scene-title">Title</h1>'}</article>`)
    t.after(() => dom.window.close())
    // Match application import order, including component CSS and later app overrides.
    for (const path of ['src/features/images/illustrations.css', 'src/app/styles.css', 'src/shared/ui/density.css', 'src/features/settings/ui-settings.css', 'src/shared/ui/mobile-control-hardening.css', 'src/features/chat/composer.css']) {
      const style = dom.window.document.createElement('style')
      style.textContent = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
      dom.window.document.head.append(style)
    }
    const { document, getComputedStyle } = dom.window
    const editor = getComputedStyle(document.querySelector('.story-editor'))
    const toolbar = getComputedStyle(document.querySelector('.floating-controls'))
    const button = getComputedStyle(document.querySelector('.floating-controls button'))
    assert.equal(button.height, '44px', 'Keep accessible toolbar targets')
    assert.equal(Number.parseFloat(editor.paddingTop) - Number.parseFloat(toolbar.inset) - Number.parseFloat(button.height), 12, 'Breadcrumbs sit 12px below toolbar')
    const path = getComputedStyle(document.querySelector('.document-path'))
    assert.equal(path.marginTop, '0px')
    assert.equal(path.marginBottom, '12px')
    const title = getComputedStyle(document.querySelector(reference ? '.document-titlebar' : '.scene-title'))
    assert.equal(title.marginTop, '0px')
    assert.equal(title.marginBottom, reference ? '16px' : '12px')
  })
}

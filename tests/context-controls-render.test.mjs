import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const compiled = await build({ entryPoints: [fileURLToPath(new URL('../src/ContextControls.tsx', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react'], jsx: 'automatic' })
const compiledModule = { exports: {} }
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), compiledModule, compiledModule.exports)
const { ContextSourcePicker, ContextSourceInventory, ContextBudget } = compiledModule.exports
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props))
const sources = [{ id: 'chapter', parentId: 'book', type: 'chapter', title: 'Chapter One', order: 1 }, { id: 'scene', parentId: 'chapter', type: 'scene', title: 'Opening', order: 1 }, { id: 'note', parentId: 'book', type: 'note', title: 'Clue' }]

test('source picker renders inherited scene selections with an explanation and a scene count', () => {
  const html = render(ContextSourcePicker, { sources, profile: { structuralIds: ['chapter'], noteIds: [], codexEntryIds: [], summaryRange: 'none' }, onToggle() {}, onClear() {} })
  assert.match(html, /Chapter One/)
  assert.match(html, /Opening/)
  assert.match(html, /Selected through a parent/)
  assert.match(html, /1 scenes selected/)
})
test('source inventory distinguishes sources used by the request from sources in omitted messages', () => {
  const source = { sourceId: 'note', title: 'Clue', content: 'A red key', representation: 'Full text' }
  const preview = { currentSceneId: '', previousSceneText: '', automaticCodex: [], codexRepresentations: [], additionalSources: [source] }
  const request = { parts: [{ omitted: false, dynamicVariables: [{ variable: 'context.additional', sources: [source] }] }], dynamicSourceDedupe: [], dynamicSourceExclusions: [] }
  assert.match(render(ContextSourceInventory, { preview, request, sources, pending: false }), /Included in request/)
  request.parts[0].omitted = true
  assert.match(render(ContextSourceInventory, { preview, request, sources, pending: false }), /Available · not used by this prompt/)
})
test('pending budget hides old numbers instead of presenting stale readiness', () => {
  const html = render(ContextBudget, { diagnostics: { requestTokens: 12345, fits: true }, model: 'test', pending: true })
  assert.match(html, /Updating preview/)
  assert.doesNotMatch(html, /12,345|Context fits/)
})

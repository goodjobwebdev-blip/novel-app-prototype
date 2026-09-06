import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/Workspace.tsx', import.meta.url), 'utf8')

function body(name, next) {
  const start = source.indexOf(`async function ${name}`)
  const end = source.indexOf(`async function ${next}`, start)
  assert.ok(start >= 0 && end > start)
  return source.slice(start, end)
}

test('Codex category completion updates list but only reclaims active state when source is still selected', () => {
  const text = body('changeCodexCategory', 'saveCodexTriggers')
  assert.match(text, /const sourceId = activeDocument\.id/)
  assert.match(text, /setCodexEntries/)
  assert.match(text, /applyIfStillCurrent\(sourceId, \(\) => activeDocumentIdRef\.current/)
  assert.doesNotMatch(text, /reloadBookContent/)
})

test('Codex summary-preference completion uses the same stale-selection guard', () => {
  const text = body('changeCodexSummaryPreference', 'archiveCodex')
  assert.match(text, /const sourceId = activeDocument\.id/)
  assert.match(text, /setCodexEntries/)
  assert.match(text, /applyIfStillCurrent\(sourceId, \(\) => activeDocumentIdRef\.current/)
})

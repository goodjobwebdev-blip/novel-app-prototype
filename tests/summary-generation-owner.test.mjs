import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { summaryGenerationOwnsUi } from '../src/summary-generation-owner.ts'

const owner = { requestId: 7, bookId: 'book-a', summaryId: 'summary-a' }

test('summary completion owns UI only for the exact request, book, summary, and editor screen', () => {
  assert.equal(summaryGenerationOwnsUi(owner, owner, { bookId: 'book-a', documentId: 'summary-a', screen: 'editor' }), true)
  assert.equal(summaryGenerationOwnsUi(owner, { ...owner, requestId: 8 }, { bookId: 'book-a', documentId: 'summary-a', screen: 'editor' }), false)
  assert.equal(summaryGenerationOwnsUi(owner, owner, { bookId: 'book-b', documentId: 'summary-a', screen: 'editor' }), false)
  assert.equal(summaryGenerationOwnsUi(owner, owner, { bookId: 'book-a', documentId: 'scene-b', screen: 'editor' }), false)
  assert.equal(summaryGenerationOwnsUi(owner, owner, { bookId: 'book-a', documentId: 'summary-a', screen: 'chat' }), false)
})

test('summary generation reserves navigation ownership before its first async preflight', () => {
  const source = readFileSync(new URL('../src/Workspace.tsx', import.meta.url), 'utf8')
  const start = source.indexOf('  async function runSummaryGeneration() {')
  const end = source.indexOf('\n  function generate() {', start)
  assert.ok(start >= 0 && end > start, 'runSummaryGeneration block exists')
  const block = source.slice(start, end)
  const reserve = block.indexOf('generationAbortRef.current = controller')
  const firstAwait = block.indexOf('await ')
  assert.ok(reserve >= 0, 'summary reserves the shared generation controller')
  assert.ok(firstAwait > reserve, 'navigation ownership is reserved before the first await')
  const ownershipGuard = block.indexOf('summaryGenerationOwnsUi(')
  const uiMutation = block.indexOf('activeDocumentIdRef.current = saved.id')
  assert.ok(ownershipGuard >= 0 && uiMutation > ownershipGuard, 'completion guard precedes active-editor mutation')
})

test('book switching also honors the active generation navigation guard', () => {
  const source = readFileSync(new URL('../src/Workspace.tsx', import.meta.url), 'utf8')
  const start = source.indexOf('  async function openBook(')
  const end = source.indexOf('\n  async function deleteWithSaveBarrier', start)
  const block = source.slice(start, end)
  assert.match(block, /canUnmountEditor\(Boolean\(generationAbortRef\.current\)\)/)
  assert.match(block, /Stop generation before switching books\./)
})

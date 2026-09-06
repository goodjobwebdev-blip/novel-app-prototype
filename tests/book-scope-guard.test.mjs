import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LatestAsyncIntent, bookScopeMatches, documentBelongsToBook } from '../src/book-scope-guard.ts'

test('latest async intent invalidates earlier book navigation work', () => {
  const intent = new LatestAsyncIntent()
  const a = intent.begin()
  const b = intent.begin()
  assert.equal(intent.isCurrent(a), false)
  assert.equal(intent.isCurrent(b), true)
  intent.invalidate()
  assert.equal(intent.isCurrent(b), false)
})

test('book/document scope guards reject cross-book identity', () => {
  assert.equal(bookScopeMatches('book-a', 'book-a'), true)
  assert.equal(bookScopeMatches('book-a', 'book-b'), false)
  assert.equal(documentBelongsToBook('book-a', 'book-a'), true)
  assert.equal(documentBelongsToBook('book-a', 'book-b'), false)
  assert.equal(documentBelongsToBook('book-a', null), false)
})

test('Workspace enforces stale refresh, load ownership, and latest openBook intent', () => {
  const source = readFileSync(new URL('../src/Workspace.tsx', import.meta.url), 'utf8')

  const reloadStart = source.indexOf('  async function reloadBookContent(')
  const reloadEnd = source.indexOf('\n  async function loadDocument(', reloadStart)
  const reloadBlock = source.slice(reloadStart, reloadEnd)
  assert.match(reloadBlock, /bookRefreshIntentRef\.current\.begin\(\)/)
  assert.match(reloadBlock, /bookScopeMatches\(bookId, currentBookIdRef\.current\)/)
  assert.ok(reloadBlock.indexOf('bookScopeMatches(bookId, currentBookIdRef.current)') < reloadBlock.indexOf('setOutlineEntities('))

  const loadStart = source.indexOf('  async function loadDocument(')
  const loadEnd = source.indexOf('\n  async function loadScene(', loadStart)
  const loadBlock = source.slice(loadStart, loadEnd)
  assert.match(loadBlock, /documentLoadIntentRef\.current\.begin\(\)/)
  assert.match(loadBlock, /documentBelongsToBook\(editableDocument\.bookId, expectedBookId\)/)
  assert.ok(loadBlock.indexOf('documentBelongsToBook(editableDocument.bookId, expectedBookId)') < loadBlock.indexOf('activeDocumentIdRef.current = editableDocument.id'))

  const openStart = source.indexOf('  async function openBook(')
  const openEnd = source.indexOf('\n  async function deleteWithSaveBarrier', openStart)
  const openBlock = source.slice(openStart, openEnd)
  assert.match(openBlock, /bookOpenIntentRef\.current\.begin\(\)/)
  assert.match(openBlock, /bookOpenIntentRef\.current\.isCurrent\(intent\)/)
  assert.doesNotMatch(openBlock, /await reloadBookContent\(bookId\)/)
})

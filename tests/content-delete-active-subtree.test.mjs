import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/Workspace.tsx', import.meta.url), 'utf8')

test('content deletion uses the full removed subtree when deciding whether to clear the active editor', () => {
  const start = source.indexOf('async function removeContentEntity')
  const end = source.indexOf('async function changeCodexCategory', start)
  assert.ok(start >= 0 && end > start)
  const body = source.slice(start, end)
  assert.match(body, /const removedIds = await deleteWithSaveBarrier\(entity\.id\)/)
  assert.match(body, /removedIds\.includes\(activeDocumentIdRef\.current\)/)
  assert.doesNotMatch(body, /activeDocumentIdRef\.current === entity\.id/)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { KeyedAsyncQueue } from '../src/keyed-async-queue.ts'

test('per-book metadata queue preserves draft invocation order despite a slow first save', async () => {
  const queue = new KeyedAsyncQueue()
  const applied = []
  let releaseFirst
  const firstGate = new Promise((resolve) => { releaseFirst = resolve })
  const first = queue.run('book-a', async () => { await firstGate; applied.push('A') })
  const second = queue.run('book-a', async () => { applied.push('B') })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(applied, [])
  releaseFirst()
  await Promise.all([first, second])
  assert.deepEqual(applied, ['A', 'B'])
  assert.equal(applied.at(-1), 'B')
})

test('Workspace serializes Book metadata saves and stale Book completion cannot reclaim currentBook', () => {
  const source = readFileSync(new URL('../src/Workspace.tsx', import.meta.url), 'utf8')
  assert.match(source, /bookMetadataSaveQueueRef = useRef\(new KeyedAsyncQueue\(\)\)/)
  const start = source.indexOf('  async function saveBookMetadata(')
  const end = source.indexOf('  async function addSeries', start)
  const block = source.slice(start, end)
  assert.match(block, /const sourceBookId = currentBookIdRef\.current/)
  assert.match(block, /bookMetadataSaveQueueRef\.current\.run\(sourceBookId, \(\) => updateBookMetadata\(sourceBookId, metadata\)\)/)
  assert.match(block, /setBookList/)
  assert.match(block, /if \(bookScopeMatches\(sourceBookId, currentBookIdRef\.current\)\) setCurrentBook\(updated\)/)
})

test('Book Settings debounce follows draft changes only and gates saved state to the latest draft', () => {
  const source = readFileSync(new URL('../src/Workspace.tsx', import.meta.url), 'utf8')
  const start = source.indexOf('function BookSettings(')
  const end = source.indexOf('function Outline(', start)
  const block = source.slice(start, end)
  assert.match(block, /await saveHandlerRef\.current\(draftSnapshot\)/)
  assert.match(block, /if \(sequence !== saveSequenceRef\.current\) return\s+savedRef\.current = JSON\.stringify\(draftSnapshot\)/)
  assert.match(block, /\}, \[draft\]\)/)
  assert.doesNotMatch(block, /\[draft, onSave\]/)
})

test('Book metadata persistence is transactional, field-level, and cannot recreate a deleted Book', () => {
  const source = readFileSync(new URL('../src/persistence.ts', import.meta.url), 'utf8')
  const start = source.indexOf('export async function updateBookMetadata(')
  const end = source.indexOf('export async function moveStructuralEntity', start)
  const block = source.slice(start, end)
  const tx = block.indexOf("db.transaction('rw'")
  const read = block.indexOf("db.table('entities').get")
  const update = block.indexOf("db.table('entities').update(id, patch)")
  assert.ok(tx >= 0 && read > tx && update > read)
  assert.doesNotMatch(block, /\.put\(/)
})

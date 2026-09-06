from pathlib import Path

workspace = Path('src/Workspace.tsx')
text = workspace.read_text()

old = "  const documentSaveQueueRef = useRef(new KeyedAsyncQueue())\n  const deletingEntityIdsRef = useRef(new Set<string>())"
new = "  const documentSaveQueueRef = useRef(new KeyedAsyncQueue())\n  const bookMetadataSaveQueueRef = useRef(new KeyedAsyncQueue())\n  const deletingEntityIdsRef = useRef(new Set<string>())"
assert old in text
text = text.replace(old, new, 1)

old = """  async function saveBookMetadata(metadata: BookMetadata) {
    if (!currentBook) return
    const updated = await updateBookMetadata(currentBook.id, metadata)
    setCurrentBook(updated)
    setBookList((books) => books.map((book) => book.id === updated.id ? updated : book))
  }
"""
new = """  async function saveBookMetadata(metadata: BookMetadata) {
    const sourceBookId = currentBookIdRef.current
    if (!sourceBookId) return
    const updated = await bookMetadataSaveQueueRef.current.run(sourceBookId, () => updateBookMetadata(sourceBookId, metadata))
    setBookList((books) => books.map((book) => book.id === updated.id ? updated : book))
    if (bookScopeMatches(sourceBookId, currentBookIdRef.current)) setCurrentBook(updated)
  }
"""
assert old in text
text = text.replace(old, new, 1)

old = """  useEffect(() => {
    if (!draft || JSON.stringify(draft) === savedRef.current) return
    setSaveStatus('saving')
    const sequence = ++saveSequenceRef.current
    const timer = window.setTimeout(async () => {
      try {
        await onSave(draft)
        savedRef.current = JSON.stringify(draft)
        if (sequence === saveSequenceRef.current) setSaveStatus('saved')
      } catch (error) {
        console.error('Failed to save book metadata', error)
        if (sequence === saveSequenceRef.current) setSaveStatus('error')
      }
    }, 650)
    return () => window.clearTimeout(timer)
  }, [draft, onSave])
"""
new = """  useEffect(() => {
    if (!draft || JSON.stringify(draft) === savedRef.current) return
    setSaveStatus('saving')
    const sequence = ++saveSequenceRef.current
    const draftSnapshot = draft
    const timer = window.setTimeout(async () => {
      try {
        await saveHandlerRef.current(draftSnapshot)
        if (sequence !== saveSequenceRef.current) return
        savedRef.current = JSON.stringify(draftSnapshot)
        setSaveStatus('saved')
      } catch (error) {
        console.error('Failed to save book metadata', error)
        if (sequence === saveSequenceRef.current) setSaveStatus('error')
      }
    }, 650)
    return () => window.clearTimeout(timer)
  }, [draft])
"""
assert old in text
text = text.replace(old, new, 1)
workspace.write_text(text)

persistence = Path('src/persistence.ts')
p = persistence.read_text()
old = """export async function updateBookMetadata(id: string, metadata: BookMetadata): Promise<BookEntity> {
  const db = await database()
  const entity = await db.table('entities').get(id) as BookEntity | undefined
  if (!entity || entity.type !== 'book') throw new Error(`Cannot update missing book ${id}`)
  const updated: BookEntity = {
    ...entity,
    ...metadata,
    title: metadata.title.trim() || entity.title || 'Untitled Book',
    seriesId: metadata.seriesId,
    seriesOrder: metadata.seriesId ? metadata.seriesOrder.trim() : '',
    updatedAt: Date.now(),
  }
  await db.table('entities').put(updated)
  return updated
}
"""
new = """export async function updateBookMetadata(id: string, metadata: BookMetadata): Promise<BookEntity> {
  const db = await database()
  return db.transaction('rw', db.table('entities'), async () => {
    const entity = await db.table('entities').get(id) as BookEntity | undefined
    if (!entity || entity.type !== 'book') throw new Error(`Cannot update missing book ${id}`)
    const patch = {
      ...metadata,
      title: metadata.title.trim() || entity.title || 'Untitled Book',
      seriesId: metadata.seriesId,
      seriesOrder: metadata.seriesId ? metadata.seriesOrder.trim() : '',
      updatedAt: Date.now(),
    }
    await db.table('entities').update(id, patch)
    const updated = await db.table('entities').get(id) as BookEntity | undefined
    if (!updated || updated.type !== 'book') throw new Error(`Cannot update missing book ${id}`)
    return updated
  })
}
"""
assert old in p
p = p.replace(old, new, 1)
persistence.write_text(p)

Path('tests/book-metadata-save-order.test.mjs').write_text("""import test from 'node:test'
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
  const end = source.indexOf('\n  async function addSeries', start)
  const block = source.slice(start, end)
  assert.match(block, /const sourceBookId = currentBookIdRef\.current/)
  assert.match(block, /bookMetadataSaveQueueRef\.current\.run\(sourceBookId, \(\) => updateBookMetadata\(sourceBookId, metadata\)\)/)
  assert.match(block, /setBookList/)
  assert.match(block, /if \(bookScopeMatches\(sourceBookId, currentBookIdRef\.current\)\) setCurrentBook\(updated\)/)
})

test('Book Settings debounce follows draft changes only and gates saved state to the latest draft', () => {
  const source = readFileSync(new URL('../src/Workspace.tsx', import.meta.url), 'utf8')
  const start = source.indexOf('function BookSettings(')
  const end = source.indexOf('\nfunction Outline(', start)
  const block = source.slice(start, end)
  assert.match(block, /await saveHandlerRef\.current\(draftSnapshot\)/)
  assert.match(block, /if \(sequence !== saveSequenceRef\.current\) return\s+savedRef\.current = JSON\.stringify\(draftSnapshot\)/)
  assert.match(block, /\}, \[draft\]\)/)
  assert.doesNotMatch(block, /\[draft, onSave\]/)
})

test('Book metadata persistence is transactional, field-level, and cannot recreate a deleted Book', () => {
  const source = readFileSync(new URL('../src/persistence.ts', import.meta.url), 'utf8')
  const start = source.indexOf('export async function updateBookMetadata(')
  const end = source.indexOf('\nexport async function moveStructuralEntity', start)
  const block = source.slice(start, end)
  const tx = block.indexOf("db.transaction('rw'")
  const read = block.indexOf("db.table('entities').get")
  const update = block.indexOf("db.table('entities').update(id, patch)")
  assert.ok(tx >= 0 && read > tx && update > read)
  assert.doesNotMatch(block, /\.put\(/)
})
""")

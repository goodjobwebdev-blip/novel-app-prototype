import { database, getEntity, listEntitiesByBook, type BookEntity } from './persistence'
import { authorPlanning, manuscriptWords, validateAuthorPlanning, type AuthorPlanning } from './author-planning'
export async function readAuthorPlanning(bookId: string) {
  const book = await getEntity<BookEntity>(bookId)
  if (book?.type !== 'book') throw new Error('This book is unavailable.')
  const entities = await listEntitiesByBook(bookId)
  return { planning: authorPlanning(book), entities, words: manuscriptWords(entities) }
}
export async function saveAuthorPlanning(bookId: string, expected: AuthorPlanning, next: AuthorPlanning) {
  const db = await database(), snapshot = structuredClone(next), before = structuredClone(expected)
  await db.transaction('rw', db.table('entities'), async () => {
    const book = await db.table('entities').get(bookId) as BookEntity | undefined
    if (book?.type !== 'book') throw new Error('This book is unavailable.')
    const current = authorPlanning(book)
    if (JSON.stringify(current) !== JSON.stringify(before)) throw new Error('Goals or tasks changed elsewhere. Reload before saving your draft.')
    const entities = await db.table('entities').where('bookId').equals(bookId).toArray()
    const planning = validateAuthorPlanning(snapshot, bookId, entities, current)
    await db.table('entities').update(bookId, { authorPlanning: planning, updatedAt: Date.now() })
  })
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('arc-entity-changed', { detail: { bookId, entityId: bookId } }))
  return readAuthorPlanning(bookId)
}

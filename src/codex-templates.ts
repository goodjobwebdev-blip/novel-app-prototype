import { database, listEntitiesByBook, type BookEntity, type CodexEntryEntity, type NoteEntity } from './persistence'
import { ensureLoreTypesWithDb, resolveLoreType } from './lore-types'
import { seriesTransaction } from './series-codex'
import { protectedRanges } from './document-projection'
import type { MarkdownEditorHandle } from './MarkdownEditor'
export function codexTemplateCompatible(note: NoteEntity, typeId: string) {
  const ids = note.compatibleLoreTypeIds
  return note.useAsCodexTemplate === true && (ids === undefined || (Array.isArray(ids) && (!ids.length || ids.includes(typeId))))
}
export function validateCodexTemplateBody(content: string) {
  if (!content.trim()) throw new Error('This template is empty. Add textual Markdown to its Note first.')
  if (protectedRanges(content).length || /<(?:img|figure|video|audio|iframe|object|embed|svg|script)\b/i.test(content)) throw new Error('This template contains media, private comments, or specialized image/comment/beat blocks. Templates currently support textual Markdown only. Remove those blocks from the template Note before applying it.')
  return content
}
export async function listCodexTemplates(bookId: string, typeId: string) {
  return (await listEntitiesByBook(bookId, 'note')).filter((note): note is NoteEntity => note.type === 'note' && codexTemplateCompatible(note as NoteEntity, typeId))
}
export async function setNoteTemplateOptions(bookId: string, noteId: string, patch: { useAsCodexTemplate?: boolean; compatibleLoreTypeIds?: string[] }) {
  const db = await database()
  const snapshot = structuredClone(patch)
  return seriesTransaction(db, async () => {
    const current = await db.table('entities').get(noteId) as NoteEntity | undefined
    if (current?.type !== 'note' || current.bookId !== bookId) throw new Error('This Note is no longer available in this book.')
    const types = await ensureLoreTypesWithDb(db, bookId)
    if (snapshot.compatibleLoreTypeIds) {
      const existing = Array.isArray(current.compatibleLoreTypeIds) ? current.compatibleLoreTypeIds : []
      if (!Array.isArray(snapshot.compatibleLoreTypeIds) || snapshot.compatibleLoreTypeIds.some(id => typeof id !== 'string' || !id || (!types.some(type => type.id === id) && !existing.includes(id)))) throw new Error('Choose compatible lore types from this book.')
      snapshot.compatibleLoreTypeIds = [...new Set(snapshot.compatibleLoreTypeIds)]
    }
    const next = { ...current, ...snapshot, updatedAt: Date.now() }
    await db.table('entities').put(next)
    return next
  })
}
export type TemplateTarget = { bookId: string; noteId: string; targetId: string; typeId: string; sharedSource?: boolean }
export async function prepareCodexTemplate(input: TemplateTarget) {
  const db = await database()
  return seriesTransaction(db, async () => {
    const book = await db.table('entities').get(input.bookId) as BookEntity | undefined
    const note = await db.table('entities').get(input.noteId) as NoteEntity | undefined
    const target = await db.table('entities').get(input.targetId) as CodexEntryEntity | undefined
    if (book?.type !== 'book' || note?.type !== 'note' || note.bookId !== book.id) throw new Error('This template Note is no longer available in the current book.')
    if (target?.type !== 'codexEntry' || target.archivedAt || target.hiddenInBook) throw new Error('The target Codex entry is unavailable or archived.')
    if (input.sharedSource) {
      if (target.codexScope !== 'series' || target.bookId !== book.seriesId) throw new Error('Open this book’s series source explicitly before applying a shared template.')
    } else if (target.bookId !== book.id || target.codexScope === 'inherited') throw new Error('Choose Edit for this book or explicitly edit the series source before applying a template.')
    const type = resolveLoreType(await ensureLoreTypesWithDb(db, target.bookId), input.typeId)
    const currentTarget = await db.table('entities').get(input.targetId) as CodexEntryEntity
    if (!type || (!input.sharedSource && currentTarget.typeId !== type.id)) throw new Error('The lore type changed or is unavailable. Choose a compatible template again.')
    if (!codexTemplateCompatible(note, type.id)) throw new Error('This Note is no longer a compatible Codex template.')
    return { noteId: note.id, title: note.title, content: validateCodexTemplateBody(note.content) }
  })
}
/** Copy into the captured empty editor as one isolated undo action; never write metadata. */
export async function applyCodexTemplate(input: TemplateTarget, editor: () => MarkdownEditorHandle | null) {
  const handle = editor(), body = handle?.captureSelection()?.document
  if (body === undefined) throw new Error('The editor is not ready.')
  if (body.trim()) throw new Error('Templates apply only to an empty body. Clear the body explicitly first.')
  const snapshot = handle!.captureSelection(0, body.length)
  if (!snapshot) throw new Error('The editor is not ready.')
  const template = await prepareCodexTemplate(input)
  if (!editor()?.replaceRange(snapshot, template.content)) throw new Error('The editor changed or became unavailable. Choose the template again for an empty body.')
  return template
}

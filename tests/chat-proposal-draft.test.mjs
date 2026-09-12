import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import 'fake-indexeddb/auto'
const storage = new Map()
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) }
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const url = new URL(specifier + '.ts', context.parentURL)
    if (existsSync(fileURLToPath(url))) return nextResolve(url.href, context)
  }
  return nextResolve(specifier, context)
} })
const db = await import('../src/persistence.ts')
const { initialAiSettings } = await import('../src/ai-settings.ts')
const { createChat, createChatMessage, saveChatProposalDraft } = await import('../src/chat-service.ts')
const { applyChatDocumentEdit } = await import('../src/chat-tools.ts')
const { editProposalDraft, proposalDraftValues } = await import('../src/chat-proposal-draft.ts')
const { chatHistoryContent } = await import('../src/chat-request.ts')
const proposal = { id: 'p', entityId: 'scene', entityTitle: 'Opening', entityType: 'scene', expectedUpdatedAt: 123, mode: 'text_replacements', edits: [{ oldText: 'first', newText: 'one' }, { oldText: 'second', newText: 'two' }], status: 'proposed', createdAt: 1 }

test('draft editing preserves immutable anchors, original suggestion and revision guards', () => {
  const edited = editProposalDraft('documentEdits', proposal, { 'edit:0': 'ONE', 'edit:1': 'TWO' }, 0)
  assert.deepEqual(edited.edits.map(edit => edit.oldText), ['first', 'second'])
  assert.equal(edited.expectedUpdatedAt, 123)
  assert.equal(edited.entityId, 'scene')
  assert.deepEqual(edited.originalDraft, { 'edit:0': 'one', 'edit:1': 'two' })
  assert.throws(() => editProposalDraft('documentEdits', edited, proposalDraftValues('documentEdits', edited), 0), /changed elsewhere/)
  assert.throws(() => editProposalDraft('documentEdits', proposal, { 'edit:0': 'ONE', 'edit:1': 'TWO', entityId: 'other' }, 0), /unsupported/)
  assert.throws(() => editProposalDraft('documentEdits', { ...proposal, status: 'applying' }, { 'edit:0': 'ONE', 'edit:1': 'TWO' }, 0), /pending/)
  const reset = editProposalDraft('documentEdits', edited, edited.originalDraft, 1)
  assert.deepEqual(reset.edits, proposal.edits)
})

async function fixture() {
  const { book } = await db.createBook(initialAiSettings, 'Editable proposal test')
  const note = await db.createNote(book.id, 'Draft')
  await db.saveDocumentContent(note.id, 'first and second')
  const source = await db.getEntity(note.id)
  const chat = await createChat(book.id)
  const p = { ...proposal, entityId: note.id, entityType: 'note', expectedUpdatedAt: source.updatedAt }
  const message = await createChatMessage(chat, 'assistant', 'Suggested edits.', { documentEdits: [p] })
  return { book, note, chat, message, p }
}

test('persisted drafts leave source untouched, apply edited replacements once, and replay accepted values', async () => {
  const f = await fixture()
  const edited = await saveChatProposalDraft(f.book.id, f.chat.id, f.message.id, 'documentEdits', 'p', { 'edit:0': 'FIRST', 'edit:1': 'SECOND' }, 0)
  assert.equal((await db.getEntity(f.note.id)).content, 'first and second')
  assert.deepEqual((await db.getEntity(f.message.id)).documentEdits, edited.documentEdits)
  await applyChatDocumentEdit(f.message.id, 'p')
  assert.equal((await db.getEntity(f.note.id)).content, 'FIRST and SECOND')
  const history = chatHistoryContent(await db.getEntity(f.message.id))
  assert.match(history, /"status":"applied"/)
  assert.match(history, /FIRST/)
  await assert.rejects(() => applyChatDocumentEdit(f.message.id, 'p'), /already applied/)
  await assert.rejects(() => saveChatProposalDraft(f.book.id, f.chat.id, f.message.id, 'documentEdits', 'p', { 'edit:0': 'again', 'edit:1': 'again' }, 1), /pending/)
})

test('source revision and owner checks survive draft saves', async () => {
  const f = await fixture()
  await assert.rejects(() => saveChatProposalDraft('other-book', f.chat.id, f.message.id, 'documentEdits', 'p', { 'edit:0': 'bad', 'edit:1': 'bad' }, 0), /original chat/)
  await db.saveDocumentContent(f.note.id, 'Author changed first and second')
  await saveChatProposalDraft(f.book.id, f.chat.id, f.message.id, 'documentEdits', 'p', { 'edit:0': 'new', 'edit:1': 'newer' }, 0)
  await assert.rejects(() => applyChatDocumentEdit(f.message.id, 'p'), /changed after/)
  assert.equal((await db.getEntity(f.note.id)).content, 'Author changed first and second')
})

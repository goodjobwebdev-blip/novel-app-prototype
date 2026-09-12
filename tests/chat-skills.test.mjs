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

const p = await import('../src/persistence.ts')
const { initialAiSettings } = await import('../src/ai-settings.ts')
const s = await import('../src/chat-skills.ts')
const c = await import('../src/chat-service.ts')
const { assembleChatGenerationRequest, defaultChatPromptComposition, finalizeChatProviderRequest } = await import('../src/chat-request.ts')
const { copyBookArchive } = await import('../src/book-archive.ts')
const { encodeDocumentBlock } = await import('../src/document-projection.ts')
async function fixture() {
  const { book } = await p.createBook(initialAiSettings, 'Skills test')
  const first = await s.copyStarterChatSkill(book.id, 'copy')
  const second = await s.copyStarterChatSkill(book.id, 'brainstorm')
  const chat = await c.createChat(book.id)
  return { book, first, second, chat }
}
test('skills are explicit, ordered, prose-only and deduplicated in normalized and actual requests', async () => {
  const f = await fixture()
  assert.deepEqual(await s.captureChatSkills(f.book.id, f.chat.skillNoteIds), [])
  await p.saveDocumentContent(f.first.id, 'Unique skill prose '+encodeDocumentBlock({ version: 1, id: 'comment', type: 'comment', text: 'PRIVATE SENTINEL' }))
  const chat = await c.updateChat(f.chat.id, { skillNoteIds: [f.second.id, f.first.id, f.second.id], contextProfile: { ...f.chat.contextProfile, noteIds: [f.first.id] } })
  const prepared = await s.prepareChatSkillContext(chat)
  const request = assembleChatGenerationRequest({ composition: defaultChatPromptComposition, book: { title: f.book.title }, ...prepared, history: [{ role: 'user', content: 'Current request' }] })
  const parts = request.parts.filter(part => part.id.startsWith('chat-skill-'))
  assert.deepEqual(parts.map(part => part.sourceId), [f.second.id, f.first.id])
  assert.ok(parts.every(part => part.ownership === 'user-configuration'))
  const actual = finalizeChatProviderRequest(request)
  assert.equal(JSON.stringify(actual.messages).split('Unique skill prose').length - 1, 1)
  assert.doesNotMatch(JSON.stringify(actual.messages), /PRIVATE SENTINEL/)
  assert.equal(actual.messages.at(-1).content, 'Current request')
})
test('captured skills remain stable; changes, empty bodies, deletion and foreign IDs affect only later requests', async () => {
  const f = await fixture(), other = await fixture()
  const ids = [f.first.id, other.second.id, 'missing']
  const captured = await s.captureChatSkills(f.book.id, ids)
  assert.equal(captured.length, 1)
  await p.saveDocumentContent(f.first.id, 'A new instruction')
  assert.notEqual(captured[0].content, (await s.captureChatSkills(f.book.id, ids))[0].content)
  await s.setNoteChatSkill(f.book.id, f.first.id, false)
  assert.deepEqual(await s.captureChatSkills(f.book.id, ids), [])
  await s.setNoteChatSkill(f.book.id, f.first.id, true)
  await p.saveDocumentContent(f.first.id, '  ')
  assert.deepEqual(await s.captureChatSkills(f.book.id, ids), [])
  await p.deleteEntity(f.first.id)
  assert.deepEqual(await s.captureChatSkills(f.book.id, ids), [])
  await assert.rejects(() => s.setNoteChatSkill(other.book.id, f.second.id, true), /this book/)
})
test('starter copies are independent and backups remap selected Notes while retaining missing references', async () => {
  const f = await fixture()
  const another = await s.copyStarterChatSkill(f.book.id, 'copy')
  await p.saveDocumentContent(f.first.id, 'My independent version')
  assert.equal((await p.getEntity(another.id)).content, s.starterChatSkills.find(item => item.id === 'copy').content)
  await c.updateChat(f.chat.id, { skillNoteIds: [f.first.id, 'deleted-note', f.second.id] })
  const archive = await p.readBookArchive(f.book.id)
  const copied = copyBookArchive(archive).data
  const chat = copied.entities.find(item => item.type === 'chat')
  const note = copied.entities.find(item => item.type === 'note' && item.content === 'My independent version')
  assert.equal(note.useAsChatSkill, true)
  assert.equal(chat.skillNoteIds[0], note.id)
  assert.match(chat.skillNoteIds[1], /^missing-skill-/)
  assert.equal(chat.skillNoteIds.length, 3)
})

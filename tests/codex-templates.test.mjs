import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after } from 'node:test'
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

const p = await import('../src/data/persistence.ts')
const templates = await import('../src/features/codex/codex-templates.ts')
const { initialAiSettings } = await import('../src/shared/ai/ai-settings.ts')
const { setNoteChatSkill } = await import('../src/features/chat/chat-skills.ts')
const { createLoreType } = await import('../src/features/codex/lore-types-service.ts')
const { copyBookArchive, encodeBookArchive, decodeBookArchive } = await import('../src/data/book-archive.ts')
const world = await import('../src/features/worlds/world-service.ts')
after(async () => (await p.database()).close())
const { encodeDocumentBlock } = await import('../src/features/editor/document-projection.ts')
const body = '## Overview\n\nDescribe {{ protagonist }} literally.\n\n- Motivation\n- Conflict\n\n| Fact | Detail |\n| --- | --- |\n| Origin | Fill in |\n'
async function fixture() {
  const { book } = await p.createBook(initialAiSettings, 'Template test')
  const note = await p.createNote(book.id, 'Character structure')
  await p.saveDocumentContent(note.id, body)
  const entry = await p.createCodexEntry(book.id, 'My character', 'Character')
  return { book, note, entry, input: { bookId: book.id, noteId: note.id, targetId: entry.id, typeId: entry.typeId } }
}
test('template and skill roles coexist without changing either document; compatibility and owner checks are explicit', async () => {
  const f = await fixture(), other = await fixture()
  assert.deepEqual(await templates.listCodexTemplates(f.book.id, f.entry.typeId), [])
  await setNoteChatSkill(f.book.id, f.note.id, true)
  const note = await templates.setNoteTemplateOptions(f.book.id, f.note.id, { useAsCodexTemplate: true, compatibleLoreTypeIds: [f.entry.typeId] })
  assert.equal(note.useAsChatSkill, true); assert.equal(note.content, body)
  assert.equal((await p.getEntity(f.entry.id)).content, '')
  assert.equal((await templates.listCodexTemplates(f.book.id, f.entry.typeId)).length, 1)
  assert.deepEqual(await templates.listCodexTemplates(f.book.id, 'lore-place'), [])
  await assert.rejects(() => templates.setNoteTemplateOptions(other.book.id, f.note.id, { useAsCodexTemplate: true }), /this book/)
  await assert.rejects(() => templates.prepareCodexTemplate({ ...f.input, noteId: other.note.id }), /current book/)
  assert.equal((await templates.prepareCodexTemplate(f.input)).content, body)
})
test('textual Markdown is copied literally; unsupported media and private/planning blocks are rejected before replacement', async () => {
  assert.equal(templates.validateCodexTemplateBody(body), body)
  const invalid = ['![Image](image.png)', '![Image][ref]\n\n[ref]: image.png', '<img src="image.png">', '<video src="clip.mp4"></video>', '<audio src="sound.mp3"></audio>', '<iframe src="embed"></iframe>', '<!-- private comment -->', encodeDocumentBlock({ id: 'beat', type: 'beat', text: 'Plan' }), encodeDocumentBlock({ id: 'image', type: 'image', assetId: 'asset' })]
  for (const value of invalid) assert.throws(() => templates.validateCodexTemplateBody(value), /textual Markdown only/)
  assert.throws(() => templates.validateCodexTemplateBody('  '), /empty/)
  const f = await fixture()
  await templates.setNoteTemplateOptions(f.book.id, f.note.id, { useAsCodexTemplate: true })
  let replacements = 0
  const editor = { getText: () => '', captureSelection: () => ({ document: '' }), replaceRange: () => { replacements++; return true } }
  await p.saveDocumentContent(f.note.id, invalid[0])
  await assert.rejects(() => templates.applyCodexTemplate(f.input, () => editor), /textual Markdown only/)
  assert.equal(replacements, 0)
})
test('apply captures an empty editor and refuses changed, nonempty, unmarked or incompatible targets', async () => {
  const f = await fixture()
  await templates.setNoteTemplateOptions(f.book.id, f.note.id, { useAsCodexTemplate: true })
  await assert.rejects(() => templates.applyCodexTemplate(f.input, () => ({ captureSelection: () => ({ document: 'Existing content' }) })), /empty body/)
  let called = false
  const stale = { getText: () => '', captureSelection: () => ({ document: '' }), replaceRange: () => { called = true; return false } }
  await assert.rejects(() => templates.applyCodexTemplate(f.input, () => stale), /editor changed/)
  assert.equal(called, true)
  await templates.setNoteTemplateOptions(f.book.id, f.note.id, { useAsCodexTemplate: false })
  await assert.rejects(() => templates.prepareCodexTemplate(f.input), /compatible/)
  await templates.setNoteTemplateOptions(f.book.id, f.note.id, { useAsCodexTemplate: true, compatibleLoreTypeIds: ['lore-place'] })
  await assert.rejects(() => templates.prepareCodexTemplate(f.input), /compatible/)
  await templates.setNoteTemplateOptions(f.book.id, f.note.id, { compatibleLoreTypeIds: [] })
  await p.updateCodexCategory(f.entry.id, 'Place')
  await assert.rejects(() => templates.prepareCodexTemplate(f.input), /type changed/)
})
test('Book templates edit visible World canon directly; copies remain independent and hidden or foreign targets are rejected', async () => {
  const f = await fixture(), shared = await world.createWorld('Template shared world')
  await world.setBookWorld(f.book.id, shared.id)
  const source = await world.moveEntryToWorld(f.book.id, f.entry.id)
  const { book: second } = await p.createBook(initialAiSettings, 'Second template Book')
  await world.setBookWorld(second.id, shared.id)
  await templates.setNoteTemplateOptions(f.book.id, f.note.id, { useAsCodexTemplate: true })
  assert.equal(source.id, f.entry.id)
  assert.equal((await templates.prepareCodexTemplate(f.input)).content, body)
  assert.equal((await p.getEntity(source.id)).content, '', 'Preparing never writes the canonical body')
  const custom = await createLoreType(f.book.id, 'Private lore')
  await assert.rejects(() => templates.prepareCodexTemplate({ ...f.input, typeId: custom.id }), /type changed/)
  const copy = await world.copyWorldEntryToBook(f.book.id, source.id)
  const editor = { captureSelection: () => ({ document: '' }), replaceRange: (snapshot, content) => { assert.equal(snapshot.document, ''); assert.equal(content, body); return true } }
  await templates.applyCodexTemplate(f.input, () => editor)
  assert.equal((await p.getEntity(source.id)).content, '', 'Apply changes the editor, not persistence')
  await p.saveDocumentContent(source.id, body)
  assert.equal((await p.listEntitiesByBook(second.id, 'codexEntry'))[0].id, source.id)
  assert.equal((await p.listEntitiesByBook(second.id, 'codexEntry'))[0].content, body)
  assert.equal((await p.getEntity(source.id)).bookId, shared.id)
  assert.equal((await p.getEntity(copy.id)).content, '')
  const copyInput = { ...f.input, targetId: copy.id }
  await p.saveDocumentContent(copy.id, (await templates.prepareCodexTemplate(copyInput)).content)
  await p.saveDocumentContent(source.id, 'Later canonical revision')
  assert.equal((await p.getEntity(copy.id)).content, body)
  assert.equal((await p.getEntity(copy.id)).worldId, undefined)
  await world.setWorldEntryHidden(f.book.id, source.id, true)
  await assert.rejects(() => templates.prepareCodexTemplate(f.input), /unavailable/)
  assert.equal((await templates.prepareCodexTemplate(copyInput)).content, body)
  await world.setWorldEntryHidden(f.book.id, source.id, false)
  await world.setBookWorld(f.book.id, '')
  await assert.rejects(() => templates.prepareCodexTemplate(f.input), /unavailable/)
  assert.equal((await p.getEntity(source.id)).content, 'Later canonical revision')
})
test('backup round trips preserve both Note roles, type compatibility and independently copied content', async () => {
  const f = await fixture(), type = await createLoreType(f.book.id, 'Creature')
  await p.updateCodexCategory(f.entry.id, type.id)
  await setNoteChatSkill(f.book.id, f.note.id, true)
  await templates.setNoteTemplateOptions(f.book.id, f.note.id, { useAsCodexTemplate: true, compatibleLoreTypeIds: [type.id] })
  const capture = await templates.prepareCodexTemplate({ ...f.input, typeId: type.id })
  await p.saveDocumentContent(f.entry.id, capture.content)
  await p.saveDocumentContent(f.note.id, 'Changed template for future entries')
  const copied = copyBookArchive(await decodeBookArchive(encodeBookArchive(await p.readBookArchive(f.book.id))))
  await p.writeBookArchive(copied.data)
  const note = (await p.listEntitiesByBook(copied.bookId, 'note'))[0], entry = (await p.listEntitiesByBook(copied.bookId, 'codexEntry'))[0]
  assert.equal(note.useAsChatSkill, true); assert.equal(note.useAsCodexTemplate, true)
  assert.deepEqual(note.compatibleLoreTypeIds, [entry.typeId]); assert.notEqual(entry.typeId, type.id)
  assert.equal(entry.content, body); assert.equal(note.content, 'Changed template for future entries')
})

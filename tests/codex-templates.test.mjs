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
const templates = await import('../src/codex-templates.ts')
const { initialAiSettings } = await import('../src/ai-settings.ts')
const { setNoteChatSkill } = await import('../src/chat-skills.ts')
const { createLoreType } = await import('../src/lore-types-service.ts')
const { copyBookArchive, encodeBookArchive, decodeBookArchive } = await import('../src/book-archive.ts')
const { metadataValues } = await import('../src/chat-management-schema.ts')
const series = await import('../src/series-codex-service.ts')
const { encodeDocumentBlock } = await import('../src/document-projection.ts')
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
test('shared templates require an explicit series-source edit; inherited bodies require a local override first', async () => {
  const f = await fixture(), shared = await p.createSeries('Template shared world')
  await p.updateBookMetadata(f.book.id, { ...metadataValues(f.book), seriesId: shared.id })
  const source = await series.promoteCodexToSeries(f.book.id, f.entry.id)
  await templates.setNoteTemplateOptions(f.book.id, f.note.id, { useAsCodexTemplate: true })
  await assert.rejects(() => templates.prepareCodexTemplate(f.input), /Edit for this book/)
  await assert.rejects(() => templates.prepareCodexTemplate({ ...f.input, targetId: source.id }), /Edit for this book/)
  assert.equal((await templates.prepareCodexTemplate({ ...f.input, targetId: source.id, sharedSource: true })).content, body)
  assert.equal((await p.getEntity(source.id)).content, '')
  const custom = await createLoreType(f.book.id, 'Private lore')
  await assert.rejects(() => templates.prepareCodexTemplate({ ...f.input, targetId: source.id, sharedSource: true, typeId: custom.id }), /type changed/)
  await series.editCodexForBook(f.book.id, f.entry.id)
  assert.equal((await templates.prepareCodexTemplate(f.input)).content, body)
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

import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import 'fake-indexeddb/auto'
registerHooks({ resolve(specifier, context, nextResolve) { if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) { const url = new URL(specifier + '.ts', context.parentURL); if (existsSync(fileURLToPath(url))) return nextResolve(url.href, context) } return nextResolve(specifier, context) } })
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
const db = await import('../src/persistence.ts')
const { initialAiSettings, copyAiSettings } = await import('../src/ai-settings.ts')
const { encodeDocumentBlock } = await import('../src/document-projection.ts')
const { selectionProse } = await import('../src/quick-tools.ts')
const { prepareQuickToolRequest } = await import('../src/quick-tool-generation.ts')
const book = { title: 'Test', series: '', seriesOrder: '', overview: '', genre: '', style: 'Spare', pov: 'Third', tense: 'Past', language: 'English' }

test('selection requests use Main, projected context and effective settings while preserving exact selected Markdown', async () => {
  const settings = copyAiSettings(initialAiSettings); settings.provider = 'fake'; settings.mainModel = 'fake/main'; settings.codexModel = 'fake/codex'; settings.supportModel = 'fake/support'; settings.mainModelContextLength = 100000
  const f = await db.createBook(settings, 'Quick tools')
  const privateBlock = encodeDocumentBlock({ id: 'private', type: 'comment', text: 'PRIVATE_SENTINEL' })
  const beat = encodeDocumentBlock({ id: 'plan', type: 'beat', text: 'BEAT_SENTINEL' })
  const source = `Before.\n\n${privateBlock}\n\n**SELECTED_PROSE**\n\n${beat}\n\nAfter.`
  await db.saveDocumentContent(f.scene.id, source)
  const from = source.indexOf('**SELECTED_PROSE**'), to = from + '**SELECTED_PROSE**'.length
  const capture = { bookId: f.book.id, book, document: { ...await db.getEntity(f.scene.id), pov: 'First', language: 'French' }, snapshot: { editorId: 'editor', revision: 1, document: source, from, to, text: source.slice(from, to) } }
  const result = await prepareQuickToolRequest(capture, 'Make it darker', new AbortController().signal)
  assert.equal(result.model, 'fake/main')
  const text = result.request.providerMessages.map((message) => message.content).join('\n')
  assert.doesNotMatch(text, /PRIVATE_SENTINEL|BEAT_SENTINEL|arc:block/)
  assert.match(text, /pov: First \(Scene override\)/)
  assert.match(text, /language: French \(Scene override\)/)
  assert.equal(text.split('**SELECTED_PROSE**').length - 1, 1)
  assert.ok(text.indexOf('Before.') < text.indexOf('SELECTED_PROSE'))
  assert.ok(text.indexOf('After.') > text.indexOf('SELECTED_PROSE'))
  const codex = await db.createCodexEntry(f.book.id)
  const codexResult = await prepareQuickToolRequest({ ...capture, document: codex }, 'Fix grammar', new AbortController().signal)
  assert.equal(codexResult.model, 'fake/main')
  const note = await db.createNote(f.book.id)
  assert.equal((await prepareQuickToolRequest({ ...capture, document: note }, 'Fix grammar', new AbortController().signal)).model, 'fake/main')
  assert.throws(() => selectionProse({ snapshot: { ...capture.snapshot, from: source.indexOf('PRIVATE_SENTINEL'), to: source.indexOf('PRIVATE_SENTINEL') + 7, text: 'PRIVATE' } }), /outside/)
  await assert.rejects(() => prepareQuickToolRequest({ ...capture, bookId: 'another-book' }, 'Fix grammar', new AbortController().signal), /not editable/)
})

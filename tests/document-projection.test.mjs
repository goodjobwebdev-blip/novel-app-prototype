import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import 'fake-indexeddb/auto'
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const url = new URL(specifier + '.ts', context.parentURL)
    if (existsSync(fileURLToPath(url))) return nextResolve(url.href, context)
  }
  return nextResolve(specifier, context)
} })
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
const { encodeDocumentBlock, documentBlocks, projectProse, proseText, rangeTouchesProtected } = await import('../src/document-projection.ts')
const db = await import('../src/persistence.ts')
const { initialAiSettings, copyAiSettings } = await import('../src/ai-settings.ts')
const { buildContextValues } = await import('../src/context-service.ts')
const { buildSummarySource } = await import('../src/summary-service.ts')
const { prepareSummaryGeneration } = await import('../src/summary-generation.ts')
const { prepareAutotitleRequest } = await import('../src/autotitle-service.ts')
const { normalizeSpeakableText } = await import('../src/tts-service.ts')
const { executeChatWorkspaceTool } = await import('../src/chat-tools.ts')
const { assembleStoryGenerationRequest, defaultStoryPromptComposition } = await import('../src/story-request.ts')
const { encodeBookArchive, decodeBookArchive, copyBookArchive } = await import('../src/book-archive.ts')
const comment = encodeDocumentBlock({ id: 'private-1', type: 'comment', text: 'PRIVATE_SENTINEL --> <script>hello</script>' })
const image = encodeDocumentBlock({ id: 'image-1', type: 'image', assetId: 'asset-1', alt: 'ALT_SENTINEL', caption: 'CAPTION_SENTINEL' })
const body = `Before.\n\n${comment}\n\n${image}\n\n![LEGACY_ALT](https://example.test/image.png "LEGACY_TITLE")\n\nAfter.\n\n| Name | Value |\n| --- | --- |\n| Table | preserved |`
const privatePattern = /PRIVATE_SENTINEL|ALT_SENTINEL|CAPTION_SENTINEL|LEGACY_ALT|LEGACY_TITLE|arc:block|asset-1/
function noPrivate(value) { assert.doesNotMatch(typeof value === 'string' ? value : JSON.stringify(value), privatePattern) }
function call(name, args) { return { id: crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } } }

test('projection removes blocks and images while preserving prose, tables and exact source offsets', () => {
  const projected = projectProse(body)
  noPrivate(projected.text)
  assert.ok(projected.text.includes('| Table | preserved |'))
  assert.equal(projected.text.slice(projected.sourceToProse(body.indexOf('After.'))), body.slice(body.indexOf('After.')))
  assert.equal(documentBlocks(comment)[0].block.text, 'PRIVATE_SENTINEL --> <script>hello</script>')
  assert.ok(rangeTouchesProtected(body, body.indexOf('PRIVATE_SENTINEL')))
  assert.equal(proseText('Visible <!-- unfinished secret'), 'Visible ')
  assert.equal(proseText('A ![alt][ref]\n\n[ref]: https://example.test/a.png'), 'A \n\n')
})

test('context, story, summary, autotitle, Chat reads/search and TTS share the private-content exclusion', async () => {
  const settings = copyAiSettings(initialAiSettings)
  settings.provider = 'fake'; settings.mainModel = 'fake/test'; settings.supportModel = 'fake/test'; settings.mainModelContextLength = settings.supportModelContextLength = 100000
  const f = await db.createBook(settings, 'Projection test')
  await db.saveDocumentContent(f.scene.id, body)
  const source = await db.getEntity(f.scene.id)
  const summary = await db.getOrCreateSummary(source)
  await db.updateEntityAtomically(summary.id, (item) => ({ ...item, content: 'PRIVATE_SENTINEL contaminated old summary', summarizedSourceRevision: source.updatedAt }))
  const prepared = await buildContextValues({ bookId: f.book.id, type: 'scene', currentSceneId: f.scene.id, currentSceneText: body, profile: { ...db.defaultGenerationContextProfile, structuralIds: [f.scene.id], summaryRange: 'all' } })
  noPrivate(prepared)
  const request = assembleStoryGenerationRequest({ composition: defaultStoryPromptComposition, book: { title: '', series: '', seriesOrder: '', overview: '', genre: '', style: '', pov: '', tense: '', language: '' }, responseLength: '', sceneText: body, insertionPosition: body.indexOf('After.'), context: prepared })
  noPrivate(request)
  assert.ok(request.providerMessages.some((message) => message.content.includes('# After generation point\n\nAfter.')))
  const summarySource = await buildSummarySource(f.scene.id)
  noPrivate(summarySource.content); noPrivate(summarySource.diagnostics)
  noPrivate((await prepareSummaryGeneration(f.book, await db.getEntity(summary.id), new AbortController().signal)).messages)
  noPrivate(await prepareAutotitleRequest(f.book.id, f.scene.id, settings))
  noPrivate(normalizeSpeakableText(body))
  const read = await executeChatWorkspaceTool(f.book.id, call('read_entity', { entity_id: f.scene.id }))
  noPrivate(read)
  const search = JSON.parse((await executeChatWorkspaceTool(f.book.id, call('search_entities', { query: 'PRIVATE_SENTINEL' }))).content)
  assert.equal(search.total, 0)
  const replacement = JSON.parse((await executeChatWorkspaceTool(f.book.id, call('propose_document_replacement', { entity_id: f.scene.id, expected_updated_at: source.updatedAt, new_content: 'Rewrite' }))).content)
  assert.equal(replacement.ok, false)
  const local = await executeChatWorkspaceTool(f.book.id, call('propose_document_edit', { entity_id: f.scene.id, expected_updated_at: source.updatedAt, edits: [{ old_text: 'Before.', new_text: 'Changed.' }] }))
  assert.equal(JSON.parse(local.content).ok, true)
  const pixels = new Blob([new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0])], { type: 'image/png' })
  await (await db.database()).table('galleryImages').add({ id: 'asset-1', bookId: f.book.id, image: pixels, thumbnail: pixels, width: 1, height: 1, kept: true, prompt: 'Stored image', createdAt: Date.now() })
  await db.createSnapshot(f.scene.id, 'manual', body)
  const archive = copyBookArchive(await decodeBookArchive(encodeBookArchive(await db.readBookArchive(f.book.id))))
  const imported = archive.data.entities.find((entity) => entity.type === 'scene')
  assert.equal(documentBlocks(imported.content)[0].block.text, documentBlocks(body)[0].block.text)
  assert.notEqual(documentBlocks(imported.content)[0].block.id, 'private-1')
  assert.equal(documentBlocks(imported.content)[1].block.assetId, archive.data.galleryImages[0].id)
  assert.equal(documentBlocks(archive.data.snapshots.at(-1).content)[1].block.assetId, archive.data.galleryImages[0].id)
})

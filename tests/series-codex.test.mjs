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
const s = await import('../src/series-codex-service.ts')
const { initialAiSettings } = await import('../src/ai-settings.ts')
const { metadataValues } = await import('../src/chat-management-schema.ts')
const { copyBookArchive } = await import('../src/book-archive.ts')
const { encodeDocumentBlock, documentBlocks } = await import('../src/document-projection.ts')
const { prepareChatSkillContext } = await import('../src/chat-skills.ts')
const { createChat, updateChat } = await import('../src/chat-service.ts')
async function fixture() {
  const series = await p.createSeries('Shared world '+crypto.randomUUID())
  const books = []
  for (let i = 0; i < 3; i++) { const { book } = await p.createBook(initialAiSettings, 'Book '+i); books.push(await p.updateBookMetadata(book.id, { ...metadataValues(book), seriesId: series.id })) }
  const local = await p.createCodexEntry(books[0].id, 'The tower', 'Place')
  await p.saveDocumentContent(local.id, 'A red tower')
  const source = await s.promoteCodexToSeries(books[0].id, local.id)
  const proxy = async book => (await p.listEntitiesByBook(book.id, 'codexEntry')).find(entry => entry.seriesSourceId === source.id)
  return { series, books, local, source, proxy }
}
test('live edits reach inheriting books; full overrides preserve every local field and reset resumes inheritance', async () => {
  const f = await fixture()
  const third = await f.proxy(f.books[2])
  await s.editCodexForBook(f.books[2].id, third.id)
  await p.saveDocumentContent(third.id, 'A green tower')
  await p.renameEntity(third.id, 'My tower')
  await p.updateCodexAutoIncludeTriggers(third.id, ['MYTOWER'])
  await p.saveDocumentContent(f.source.id, 'A blue tower')
  await p.renameEntity(f.source.id, 'Shared tower')
  for (const book of f.books.slice(0, 2)) { const entry = await f.proxy(book); assert.equal(entry.content, 'A blue tower'); assert.equal(entry.title, 'Shared tower'); assert.equal(entry.codexScope, 'inherited') }
  const overridden = await p.getEntity(third.id)
  assert.equal(overridden.content, 'A green tower'); assert.equal(overridden.title, 'My tower'); assert.deepEqual(overridden.autoIncludeTriggers, ['MYTOWER'])
  const expected = JSON.stringify(overridden)
  await p.saveDocumentContent(third.id, 'Another local edit')
  await assert.rejects(() => s.resetCodexToSeries(f.books[2].id, third.id, expected), /changed/)
  await s.resetCodexToSeries(f.books[2].id, third.id, JSON.stringify(await p.getEntity(third.id)))
  const reset = await p.getEntity(third.id)
  assert.equal(reset.content, 'A blue tower'); assert.equal(reset.codexScope, 'inherited')
  assert.equal(reset.id, third.id)
})
test('hiding is book-local; source deletion detaches overrides and preserves their owned media', async () => {
  const f = await fixture(), db = await p.database()
  const asset = { id: 'asset-'+crypto.randomUUID(), bookId: f.source.bookId, image: new Blob(['original']), thumbnail: new Blob(['thumb']), width: 10, height: 10, kept: true, prompt: 'Test', createdAt: Date.now() }
  await db.table('galleryImages').put(asset)
  await p.saveDocumentContent(f.source.id, 'Shared illustration '+encodeDocumentBlock({ id: 'image-block', type: 'image', assetId: asset.id }))
  const second = await f.proxy(f.books[1]), third = await f.proxy(f.books[2])
  await s.editCodexForBook(f.books[2].id, third.id)
  const localAssetId = documentBlocks(third.content)[0].block.assetId
  assert.notEqual(localAssetId, asset.id)
  assert.equal((await db.table('galleryImages').get(localAssetId)).bookId, f.books[2].id)
  await s.setSeriesEntryHidden(f.books[1].id, second.id, true)
  assert.equal((await p.listEntitiesByBook(f.books[1].id, 'codexEntry')).length, 0)
  assert.equal(p.isCodexEntryArchived(await p.getEntity(second.id)), true)
  assert.equal((await p.listEntitiesByBook(f.books[0].id, 'codexEntry')).length, 1)
  await s.setSeriesEntryHidden(f.books[1].id, second.id, false)
  assert.equal((await f.proxy(f.books[1])).id, second.id)
  await s.deleteSeriesSource(f.books[0].id, f.source.id)
  assert.equal((await p.listEntitiesByBook(f.books[0].id, 'codexEntry')).length, 0)
  const detached = await p.getEntity(third.id)
  assert.equal(detached.seriesSourceId, undefined)
  assert.equal(detached.content, third.content)
  assert.equal(await (await db.table('galleryImages').get(localAssetId)).image.text(), 'original')
})
test('series dependency cycles map to stable effective identities and never cross into another book', async () => {
  const f = await fixture()
  const second = await p.createCodexEntry(f.books[0].id, 'The gate', 'Place')
  await p.saveDocumentContent(second.id, 'The gate sentinel')
  const sharedGate = await s.promoteCodexToSeries(f.books[0].id, second.id)
  await p.createCodexDependency(f.series.id, f.source.id, sharedGate.id, 'near')
  await p.createCodexDependency(f.series.id, sharedGate.id, f.source.id, 'near')
  const foreign = await p.createCodexEntry(f.books[2].id, 'Private secret')
  await p.saveDocumentContent(foreign.id, 'FOREIGN SENTINEL')
  await assert.rejects(() => p.createCodexDependency(f.series.id, f.source.id, foreign.id), /not available/)
  const entries = await p.listEntitiesByBook(f.books[1].id, 'codexEntry')
  const edges = await p.listCodexDependencies(f.books[1].id)
  assert.equal(entries.length, 2); assert.equal(edges.length, 2)
  assert.ok(edges.every(edge => entries.some(entry => entry.id === edge.sourceId) && entries.some(entry => entry.id === edge.targetId)))
  const chat = await createChat(f.books[1].id)
  const saved = await updateChat(chat.id, { contextProfile: { ...chat.contextProfile, codexEntryIds: entries.map(entry => entry.id) } })
  const prepared = await prepareChatSkillContext(saved)
  const text = JSON.stringify(prepared.context)
  assert.doesNotMatch(text, /FOREIGN SENTINEL/)
  assert.equal(prepared.context.additionalSources.filter(item => entries.some(entry => entry.id === item.sourceId)).length, 2)
  const edge = edges[0]
  await p.updateCodexDependency(edge.id, { relationLabel: 'Local relationship' })
  assert.equal((await p.getEntity(edge.sourceId)).codexScope, 'override')
  await p.updateCodexDependency((await p.listCodexDependencies(f.series.id))[0].id, { relationLabel: 'Shared relationship' })
  assert.equal((await p.listCodexDependencies(f.books[1].id)).find(item => item.id === edge.id).relationLabel, 'Local relationship')
})
test('leaving a series keeps visible inherited lore by default; remove preserves local entries and overrides', async () => {
  const f = await fixture()
  const first = await f.proxy(f.books[0]), second = await f.proxy(f.books[1]), third = await f.proxy(f.books[2])
  await s.editCodexForBook(f.books[2].id, third.id)
  const local = await p.createCodexEntry(f.books[1].id, 'Only mine')
  for (const [i, policy] of [[0, undefined], [1, 'remove'], [2, 'remove']]) await p.updateBookMetadata(f.books[i].id, { ...metadataValues(f.books[i]), seriesId: '' }, policy)
  assert.equal((await p.getEntity(first.id)).seriesSourceId, undefined)
  assert.equal(await p.getEntity(second.id), undefined)
  assert.equal((await p.getEntity(third.id)).seriesSourceId, undefined)
  assert.equal((await p.getEntity(local.id)).title, 'Only mine')
})
test('backups import inherited lore and binary images as independent local copies', async () => {
  const f = await fixture(), db = await p.database()
  const pixels = { image: new Blob(['image']), thumbnail: new Blob(['thumb']), width: 20, height: 20 }
  await p.saveIllustration(f.source.id, pixels, { alt: 'Tower', caption: '', cropX: 0, cropY: 0, cropZoom: 1 })
  const inherited = await f.proxy(f.books[1])
  const archive = await p.readBookArchive(f.books[1].id)
  const copied = copyBookArchive(archive)
  await p.writeBookArchive(copied.data)
  const entry = (await p.listEntitiesByBook(copied.bookId, 'codexEntry'))[0]
  assert.equal(entry.seriesSourceId, undefined); assert.equal(entry.codexScope, undefined)
  assert.equal(entry.content, inherited.content)
  const image = await p.getIllustration(entry.id)
  assert.equal(image.bookId, copied.bookId); assert.equal(image.id, entry.primaryImageId); assert.equal(await image.image.text(), 'image')
  await p.saveDocumentContent(f.source.id, 'Changed after import')
  assert.equal((await p.getEntity(entry.id)).content, inherited.content)
})
test('existing local entries stay local on joining; promotion collisions never overwrite a source', async () => {
  const f = await fixture()
  const duplicate = await p.createCodexEntry(f.books[1].id, 'The tower')
  await p.saveDocumentContent(duplicate.id, 'Local duplicate')
  await assert.rejects(() => s.promoteCodexToSeries(f.books[1].id, duplicate.id), /already exists/)
  assert.equal((await p.getEntity(duplicate.id)).content, 'Local duplicate')
  assert.equal((await p.getEntity(duplicate.id)).seriesSourceId, undefined)
  await p.saveDocumentContent((await f.proxy(f.books[1])).id, 'Approved local edit')
  const override = await f.proxy(f.books[1])
  assert.equal(override.codexScope, 'override')
  await p.saveDocumentContent(f.source.id, 'Shared edit')
  assert.equal((await f.proxy(f.books[1])).content, 'Approved local edit')
})

test('accepted edits recheck owner and source revisions inside the final write transaction', async () => {
  const f = await fixture()
  const entry = await f.proxy(f.books[1])
  const expected = { bookId: entry.bookId, updatedAt: entry.updatedAt, content: entry.content }
  await p.saveDocumentContent(f.source.id, 'Updated shared canon')
  await assert.rejects(() => p.saveDocumentContent(entry.id, 'Stale proposed rewrite', expected), /changed after/)
  assert.equal((await p.getEntity(entry.id)).content, 'Updated shared canon')
  assert.equal((await p.getEntity(entry.id)).codexScope, 'inherited')
})

import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import 'fake-indexeddb/auto'

// Run the real persistence module against IndexedDB, not a mocked save function.
const directory = mkdtempSync(new URL('../node_modules/.arc-image-test-', import.meta.url))
for (const filename of readdirSync(new URL('../src/', import.meta.url)).filter((name) => name.endsWith('.ts'))) {
  const source = readFileSync(new URL(`../src/${filename}`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText.replace(/(['"])(\.\/[^'"]+)\1/g, (_, quote, path) => `${quote}${path.replace(/\.ts$/, '')}.mjs${quote}`)
  writeFileSync(`${directory}/${filename.replace(/\.ts$/, '.mjs')}`, compiled)
}
const { default: Dexie } = await import('dexie')
const legacy = new Dexie('arc-novel-local-v1')
legacy.version(3).stores({ entities: 'id,type,bookId,parentId,[parentId+order],updatedAt', snapshots: 'id,entityId,entityType,createdAt,[entityId+createdAt],reason', codexDependencies: 'id,bookId,sourceId,targetId,[bookId+sourceId],[bookId+targetId],[sourceId+targetId],updatedAt', meta: 'key' })
await legacy.open()
await legacy.table('entities').put({ id: 'migration-book', type: 'book', title: 'Existing book', createdAt: 1, updatedAt: 1 })
await legacy.table('entities').put({ id: 'migration-entry', type: 'codexEntry', bookId: 'migration-book', parentId: 'migration-book', title: 'Old entry', content: 'Existing lore', category: 'Other', createdAt: 1, updatedAt: 1 })
legacy.close()
const p = await import(pathToFileURL(`${directory}/persistence.mjs`))
const archive = await import(pathToFileURL(`${directory}/book-archive.mjs`))
const images = await import(pathToFileURL(`${directory}/illustration-image.mjs`))
const { initialAiSettings } = await import(pathToFileURL(`${directory}/ai-settings.mjs`))
after(() => rmSync(directory, { recursive: true, force: true }))
const png = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6AAAAAElFTkSuQmCC', 'base64')], { type: 'image/png' })
const pixels = { image: png, thumbnail: png, width: 1, height: 1 }
const details = { caption: 'The gate', alt: 'A moonlit gate', cropX: 20, cropY: 80 }

async function bookFixture() {
  const { book, chapter, scene } = await p.createBook({ ...initialAiSettings, apiKey: 'TEST_SECRET', providerProfiles: { openai: { apiKey: 'PROFILE_SECRET' } }, speech: { apiKey: 'SPEECH_SECRET', openaiApiKey: 'OPENAI_SPEECH_SECRET' } }, 'Image test')
  const entry = await p.createCodexEntry(book.id, 'Gate', 'Place')
  const other = await p.createCodexEntry(book.id, 'Keeper', 'Character')
  await p.saveDocumentContent(entry.id, '# Gate\nKeep this text exactly.')
  const edge = await p.createCodexDependency(book.id, entry.id, other.id, 'guarded by')
  const illustration = await p.saveIllustration(entry.id, pixels, details)
  return { book, chapter, scene, entry, other, edge, illustration }
}

test('v3 migration preserves existing lore and adds image storage', async () => {
  assert.equal((await p.getEntity('migration-entry')).content, 'Existing lore')
  assert.equal(await p.getIllustration('migration-entry'), undefined)
})

test('image sizing and thumbnail positioning preserve aspect ratio and clamp bounds', () => {
  assert.deepEqual(images.fitImage(3200, 1600), { width: 1600, height: 800 })
  assert.deepEqual(images.fitImage(80, 160), { width: 80, height: 160 })
  assert.deepEqual(images.cropRectangle(800, 400, 100, 50), { x: 400, y: 0, size: 400 })
  assert.deepEqual(images.cropRectangle(400, 800, 0, -10), { x: 0, y: 0, size: 400 })
  assert.throws(() => images.fitImage(10000, 10000), /megapixels/)
})

test('upload validation rejects disguised text and oversized files', async () => {
  await images.assertImageFile(png)
  await assert.rejects(images.assertImageFile(new Blob(['<svg onload="alert(1)"></svg>'], { type: 'image/png' })), /not a supported/)
  await assert.rejects(images.assertImageFile(new Blob([new Uint8Array(images.MAX_UPLOAD_BYTES + 1)])), /20 MB/)
})

test('replace and caption edits preserve latest lore text, title, summary revision and only one image', async () => {
  const { entry, illustration } = await bookFixture()
  await p.saveDocumentContent(entry.id, 'New unsynced-looking text')
  const prior = await p.getEntity(entry.id)
  const replacement = await p.saveIllustration(entry.id, pixels, { ...details, caption: 'Revised' }, illustration.id)
  const updated = await p.getEntity(entry.id)
  assert.equal(updated.content, 'New unsynced-looking text')
  assert.equal(updated.title, 'Gate')
  assert.equal(updated.sourceRevision, prior.sourceRevision)
  assert.equal(updated.primaryImageId, replacement.id)
  assert.equal((await p.readBookArchive(entry.bookId)).illustrations.length, 1)
  await assert.rejects(p.saveIllustration(entry.id, pixels, details, illustration.id), /changed/)
  assert.equal((await p.getIllustration(entry.id)).id, replacement.id)
})

test('archive preserves illustrations and blocks mutations; permanent deletion removes blobs', async () => {
  const { entry, illustration } = await bookFixture()
  await p.archiveCodexEntry(entry.id)
  assert.equal((await p.getIllustration(entry.id)).id, illustration.id)
  await assert.rejects(p.removeIllustration(entry.id, illustration.id), /Restore/)
  await assert.rejects(p.saveIllustration(entry.id, pixels, details, illustration.id), /Restore/)
  await p.restoreCodexEntry(entry.id)
  await p.deleteEntityTree(entry.id)
  assert.equal(await p.getIllustration(entry.id), undefined)
  await assert.rejects(p.saveIllustration(entry.id, pixels, details), /no longer exists/)
})

test('book deletion cleans images while another book remains intact', async () => {
  const first = await bookFixture()
  const second = await bookFixture()
  await p.deleteEntityTree(first.book.id)
  assert.equal(await p.getIllustration(first.entry.id), undefined)
  assert.equal((await p.getIllustration(second.entry.id)).id, second.illustration.id)
})

test('explicit image removal preserves entry text', async () => {
  const { entry, illustration } = await bookFixture()
  await p.removeIllustration(entry.id, illustration.id)
  assert.equal(await p.getIllustration(entry.id), undefined)
  assert.equal((await p.getEntity(entry.id)).primaryImageId, undefined)
  assert.equal((await p.getEntity(entry.id)).content, '# Gate\nKeep this text exactly.')
})

test('binary backup round trip preserves images, snapshots, dependencies, context and settings without keys', async () => {
  const { book, entry, scene, illustration } = await bookFixture()
  const summary = await p.getOrCreateSummary(await p.getEntity(entry.id))
  await p.saveSummaryContent(summary.id, 'A gate.', Date.now())
  await p.createSnapshot(entry.id, 'manual')
  const context = await p.getBookContextSettings(book.id)
  context.lastOpenedSceneId = scene.id
  context.profiles.codex.codexEntryIds = [entry.id]
  await p.saveBookContextSettings(book.id, context)
  const original = await p.readBookArchive(book.id)
  const encoded = archive.encodeBookArchive(original)
  const raw = await encoded.text()
  assert.ok(!raw.includes('TEST_SECRET') && !raw.includes('PROFILE_SECRET') && !raw.includes('SPEECH_SECRET') && !raw.includes('OPENAI_SPEECH_SECRET'))
  const decoded = await archive.decodeBookArchive(encoded)
  assert.deepEqual(new Uint8Array(await decoded.illustrations[0].image.arrayBuffer()), new Uint8Array(await png.arrayBuffer()))
  const copy = archive.copyBookArchive(decoded)
  await p.writeBookArchive(copy.data)
  assert.notEqual(copy.bookId, book.id)
  const restored = await p.readBookArchive(copy.bookId)
  const restoredEntry = restored.entities.find((e) => e.type === 'codexEntry' && e.title === 'Gate')
  const restoredScene = restored.entities.find((e) => e.type === 'scene')
  assert.equal(restoredEntry.content, '# Gate\nKeep this text exactly.')
  assert.notEqual(restoredEntry.id, entry.id)
  assert.equal(restoredEntry.primaryImageId, restored.illustrations[0].id)
  assert.equal(restored.illustrations[0].entryId, restoredEntry.id)
  assert.equal(restored.snapshots[0].entityId, restoredEntry.id)
  assert.equal(restored.dependencies[0].sourceId, restoredEntry.id)
  assert.equal((await p.getOrCreateSummary(restoredEntry)).content, 'A gate.')
  const restoredContext = await p.getBookContextSettings(copy.bookId)
  assert.equal(restoredContext.lastOpenedSceneId, restoredScene.id)
  assert.deepEqual(restoredContext.profiles.codex.codexEntryIds, [restoredEntry.id])
  assert.equal((await p.getBookAiSettings(copy.bookId, [])).apiKey, '')
  assert.equal((await p.getIllustration(entry.id)).id, illustration.id)
})

test('backup rejects truncation, unsupported versions, dangling images and cyclic parents', async () => {
  const { book } = await bookFixture()
  const data = await p.readBookArchive(book.id)
  const encoded = archive.encodeBookArchive(data)
  await assert.rejects(archive.decodeBookArchive(encoded.slice(0, encoded.size - 1)), /invalid/)
  await assert.rejects(archive.decodeBookArchive(new Blob(['not a book backup'])), /invalid/)
  const noImages = { ...data, illustrations: [] }
  await assert.rejects(archive.decodeBookArchive(archive.encodeBookArchive(noImages)), /invalid/)
  const entry = data.entities.find((e) => e.type === 'codexEntry')
  entry.parentId = entry.id
  await assert.rejects(archive.decodeBookArchive(archive.encodeBookArchive(data)), /invalid/)
})

test('failed multi-table import rolls back the entire new book', async () => {
  const { book } = await bookFixture()
  const copy = archive.copyBookArchive(await p.readBookArchive(book.id))
  copy.data.illustrations.push({ ...copy.data.illustrations[0], id: 'different-image-id' })
  await assert.rejects(p.writeBookArchive(copy.data))
  assert.equal(await p.getEntity(copy.bookId), undefined)
  assert.equal(await p.getIllustration(copy.data.illustrations[0].entryId), undefined)
})

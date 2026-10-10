import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
const storage = new Map()
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) }
globalThis.window = new EventTarget()
window.localStorage = localStorage
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const url = new URL(specifier + '.ts', context.parentURL)
    if (existsSync(fileURLToPath(url))) return next(url.href, context)
  }
  return next(specifier, context)
} })
const p = await import('../src/data/persistence.ts')
const w = await import('../src/features/worlds/world-service.ts')
const lore = await import('../src/features/codex/lore-types-service.ts')
const ai = await import('../src/shared/ai/ai-settings.ts')
const profiles = await import('../src/features/settings/settings-profiles.ts')
const { metadataValues } = await import('../src/features/chat/chat-management-schema.ts')
const { documentBlocks, encodeDocumentBlock } = await import('../src/features/editor/document-projection.ts')
const { copyBookArchive, encodeBookArchive } = await import('../src/data/book-archive.ts')
const { buildSummarySource } = await import('../src/features/writing/summary-service.ts')
after(async () => (await p.database()).close())
async function fixture() {
  const world = await w.createWorld('Shared World')
  const books = []
  for (let i = 0; i < 3; i++) {
    const { book } = await p.createBook(ai.initialAiSettings, 'Book ' + i)
    books.push(await w.setBookWorld(book.id, world.id))
  }
  const { book: outsider } = await p.createBook(ai.initialAiSettings, 'Outside World')
  return { world, books, outsider, db: await p.database() }
}
const ids = rows => rows.map(row => row.id).sort()

test('startup upgrades reset every old per-book table and seed exactly one demo, once; global profiles/connections survive', async t => {
  const legacy = new Dexie('arc-novel-local-v1')
  t.after(() => legacy.close())
  legacy.version(7).stores({
    entities: 'id,type,bookId,parentId,[parentId+order],updatedAt',
    snapshots: 'id,entityId,entityType,createdAt,[entityId+createdAt],reason',
    codexDependencies: 'id,bookId,sourceId,targetId,[bookId+sourceId],[bookId+targetId],[sourceId+targetId],updatedAt',
    meta: 'key', illustrations: 'id,bookId,&entryId,updatedAt', illustrationUndo: 'entryId,bookId',
    imageJobs: 'id,bookId,chatId,messageId,status,provider,createdAt', galleryImages: 'id,bookId,createdAt',
    syncLinks: '&bookId,&[endpoint+remoteBookId],endpoint,remoteBookId,updatedAt', syncState: '&bookId,status,updatedAt',
  })
  await legacy.open()
  await legacy.table('entities').bulkPut([
    { id: 'old-book', type: 'book', title: 'Old Book', createdAt: 1, updatedAt: 1 },
    { id: 'old-entry', type: 'codexEntry', bookId: 'old-book', parentId: 'old-book', title: 'Old lore', category: 'Character', content: 'old', createdAt: 1, updatedAt: 1 },
  ])
  for (const name of ['snapshots', 'codexDependencies', 'illustrations', 'illustrationUndo', 'imageJobs', 'galleryImages', 'syncLinks', 'syncState']) {
    await legacy.table(name).put({ id: 'old-' + name, bookId: 'old-book', entryId: 'old-entry', entityId: 'old-entry', endpoint: 'old', remoteBookId: 'old', updatedAt: 1 })
  }
  await legacy.table('meta').bulkPut([{ key: 'prototype-seeded-v1', value: true }, { key: 'prototype-content-seeded-v1', value: true }, { key: 'preserved-ai-old-book', value: { secret: 'old' } }, { key: 'old-media-draft', value: { bookId: 'old-book' } }])
  legacy.close()
  ai.saveAiSettings({ ...ai.initialAiSettings, apiKey: 'PRESERVED_GLOBAL_CONNECTION' })
  profiles.loadSettingsProfiles()
  const before = JSON.stringify([...storage])
  const db = await p.database()
  const failSeed = (_key, entity) => { if (entity.id === p.PROTOTYPE_SCENE_ID) throw new Error('Simulated seed failure') }
  db.table('entities').hook('creating', failSeed)
  t.after(() => db.table('entities').hook('creating').unsubscribe(failSeed))
  await assert.rejects(() => p.ensurePrototypeSeed('Fail atomically'), /Simulated seed failure/)
  assert.equal((await p.getEntity('old-book')).title, 'Old Book')
  assert.equal(await db.table('meta').get('world-model-reset-v1'), undefined)
  assert.equal(await db.table('syncLinks').count(), 1)
  db.table('entities').hook('creating').unsubscribe(failSeed)
  await p.ensurePrototypeSeed('Demo story')
  assert.equal(JSON.stringify([...storage]), before)
  assert.deepEqual(ids(await p.listBooks()), [p.PROTOTYPE_BOOK_ID])
  assert.equal(await p.getEntity('old-entry'), undefined)
  for (const name of ['snapshots', 'codexDependencies', 'illustrations', 'illustrationUndo', 'imageJobs', 'galleryImages', 'syncLinks', 'syncState']) assert.equal(await db.table(name).count(), 0, name)
  assert.equal(await db.table('meta').get('old-media-draft'), undefined)
  assert.equal((await db.table('meta').get('world-model-reset-v1')).value, true)
  const { book } = await p.createBook(ai.initialAiSettings, 'Keep after migration')
  await p.saveDocumentContent(p.PROTOTYPE_SCENE_ID, 'Newer demo story')
  await p.ensurePrototypeSeed('Must not replace newer content')
  assert.equal((await p.getEntity(p.PROTOTYPE_SCENE_ID)).content, 'Newer demo story')
  assert.equal((await p.getEntity(book.id)).title, book.title)
  assert.equal((await p.listBooks()).length, 2)
})

test('World ownership is canonical, shared edits are live, and series never inherit lore or types', async () => {
  const f = await fixture()
  const entry = await p.createCodexEntry(f.world.id, 'Shared tower', 'Place')
  const summary = await p.getOrCreateSummary(entry)
  assert.equal(entry.bookId, f.world.id)
  assert.equal(entry.worldId, f.world.id)
  assert.equal(entry.codexStatus, 'active')
  assert.equal(summary.worldId, f.world.id)
  for (const book of f.books) assert.deepEqual(ids(await w.listBookCodexEntries(book.id)), [entry.id])
  assert.deepEqual(await w.listBookCodexEntries(f.outsider.id), [])
  await p.saveDocumentContent(entry.id, 'Blue tower')
  for (const book of f.books) assert.equal((await p.listEntitiesByBook(book.id, 'codexEntry'))[0].content, 'Blue tower')
  assert.equal((await p.getEntity(entry.id)).bookId, f.world.id)
  assert.equal((await f.db.table('entities').where('type').equals('codexEntry').toArray()).filter(row => row.id === entry.id).length, 1)
  const custom = await lore.createLoreType(f.world.id, 'Magic system')
  assert.ok((await lore.getEffectiveLoreTypes(f.books[0].id)).some(type => type.id === custom.id))
  const series = await p.createSeries('Organizational only')
  await f.db.table('entities').update(series.id, { loreTypes: [{ id: 'series-custom', name: 'Series-only type', order: 7 }] })
  const book = await p.updateBookMetadata(f.books[0].id, { ...metadataValues(f.books[0]), seriesId: series.id })
  assert.equal(book.worldId, f.world.id)
  assert.deepEqual(ids(await w.listBookCodexEntries(book.id)), [entry.id])
  assert.equal((await lore.getEffectiveLoreTypes(book.id)).some(type => type.id === 'series-custom'), false)
})

test('visibility is Book-local and also filters World summaries/dependencies without mutating canonical records', async () => {
  const f = await fixture(), [book, other] = f.books
  const entry = await p.createCodexEntry(f.world.id, 'Shared entry')
  const second = await p.createCodexEntry(f.world.id, 'Second entry')
  const summary = await p.getOrCreateSummary(entry)
  await p.createCodexDependency(f.world.id, second.id, entry.id)
  const before = JSON.stringify(await p.getEntity(entry.id))
  await w.setWorldEntryHidden(book.id, entry.id, true)
  assert.deepEqual(ids(await w.listBookCodexEntries(book.id)), [second.id])
  assert.deepEqual(ids(await w.listBookCodexEntries(book.id, true)), ids([entry, second]))
  assert.equal((await p.listEntitiesByBook(book.id)).some(row => row.id === summary.id), false)
  assert.equal(w.entityAvailableInBook(entry, await p.getEntity(book.id)), false)
  assert.equal(w.entityAvailableInBook(summary, await p.getEntity(book.id)), false)
  assert.equal(w.entityAvailableInBook(entry, other), true)
  assert.equal(w.entityAvailableInBook(entry, f.outsider), false)
  assert.equal(w.entityAvailableInBook(undefined, book), false)
  assert.equal((await p.listCodexDependencies(book.id)).length, 0)
  assert.equal((await p.listCodexDependencies(other.id)).length, 1)
  assert.equal(JSON.stringify(await p.getEntity(entry.id)), before)
  await w.setWorldEntryHidden(book.id, entry.id, false)
  assert.ok((await p.listEntitiesByBook(book.id)).some(row => row.id === summary.id))
  await assert.rejects(() => w.setWorldEntryHidden(f.outsider.id, entry.id, true), /connected World/)
})

test('same-owner trigger uniqueness is normalized and enforced on all general writes, including archived/draft owners and concurrent creation', async () => {
  const f = await fixture(), book = f.books[0]
  const entry = await p.createCodexEntry(book.id, 'The Gate')
  await p.updateCodexAutoIncludeTriggers(entry.id, ['  The   Gate ', 'the gate', 'THE GATE'])
  assert.equal((await p.getEntity(entry.id)).autoIncludeTriggers.length, 1)
  await assert.rejects(() => p.createCodexEntry(book.id, ' THE   GATE '), /reserved/)
  await p.setCodexEntryStatus(entry.id, 'draft')
  await p.archiveCodexEntry(entry.id)
  const other = await p.createCodexEntry(book.id, 'Other')
  await assert.rejects(() => p.updateCodexAutoIncludeTriggers(other.id, ['the gate']), /reserved/)
  await assert.rejects(() => p.putEntity({ ...other, autoIncludeTriggers: ['the gate'] }), /reserved/)
  await assert.rejects(() => p.updateEntityAtomically(other.id, current => ({ ...current, autoIncludeTriggers: ['THE GATE'] })), /reserved/)
  await assert.rejects(() => f.db.table('entities').update(other.id, { autoIncludeTriggers: ['the   gate'] }), /reserved/)
  await assert.rejects(() => f.db.transaction('rw', f.db.table('entities'), async () => {
    await f.db.table('entities').update(other.id, { content: 'Must roll back' })
    await f.db.table('entities').update(other.id, { autoIncludeTriggers: ['the gate'] })
  }), /reserved/)
  assert.equal((await p.getEntity(other.id)).content, '')
  await p.saveDocumentContent(other.id, 'Saved content')
  assert.equal((await p.getEntity(other.id)).autoIncludeTriggers[0], 'Other')
  await p.restoreCodexEntry(entry.id)
  await p.setCodexEntryStatus(entry.id, 'active')
  assert.equal((await p.getEntity(entry.id)).archivedAt, undefined)
  const results = await Promise.allSettled([p.createCodexEntry(book.id, 'Concurrent'), p.createCodexEntry(book.id, 'concurrent')])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  const simultaneous = ['one', 'two'].map(suffix => ({ ...other, id: 'parallel-' + suffix + crypto.randomUUID(), autoIncludeTriggers: ['same transaction'] }))
  await assert.rejects(() => f.db.transaction('rw', f.db.table('entities'), () => Promise.all(simultaneous.map(row => f.db.table('entities').add(row)))), /reserved/)
  for (const row of simultaneous) assert.equal(await p.getEntity(row.id), undefined)
  await assert.rejects(() => f.db.transaction('rw', f.db.table('entities'), () => f.db.table('entities').bulkAdd(simultaneous)), /reserved/)
  for (const row of simultaneous) assert.equal(await p.getEntity(row.id), undefined)
  await p.createCodexEntry(f.world.id, 'The Gate')
  await p.createCodexEntry(f.books[1].id, 'The Gate')
  assert.equal(w.codexTriggerConflicts(entry, ['the gate', 'THE GATE'], [entry]).length, 0)
  const conflict = w.codexTriggerConflicts(other, ['the gate'], [await p.getEntity(entry.id)])
  assert.equal(conflict.length, 1)
  assert.equal(conflict[0].entryId, entry.id)
})

test('moves preserve canonical IDs, summaries, snapshots, media and custom types; copies allocate independent media and IDs', async () => {
  const f = await fixture(), [book, second] = f.books
  const type = await lore.createLoreType(book.id, 'Artifact')
  const local = await p.createCodexEntry(book.id, 'Compass', type.id)
  const asset = { id: 'asset-' + crypto.randomUUID(), bookId: book.id, image: new Blob(['image']), thumbnail: new Blob(['thumb']), width: 10, height: 10, prompt: 'Compass', kept: true, createdAt: Date.now() }
  await f.db.table('galleryImages').add(asset)
  const body = 'Compass ' + encodeDocumentBlock({ id: 'image-block', type: 'image', assetId: asset.id })
  await p.saveDocumentContent(local.id, body)
  await p.createSnapshot(local.id, 'manual')
  const summary = await p.getOrCreateSummary(local)
  await p.saveSummaryContent(summary.id, 'Compass summary', local.updatedAt)
  await p.createSnapshot(summary.id, 'manual')
  const image = await p.saveIllustration(local.id, { image: new Blob(['illustration']), thumbnail: new Blob(['thumb']), width: 10, height: 10 }, { caption: '', alt: '', cropX: 50, cropY: 50 })
  const beforeSnapshots = await p.listSnapshots(local.id)
  const moved = await w.moveEntryToWorld(book.id, local.id)
  assert.equal(moved.id, local.id)
  assert.equal(moved.worldId, f.world.id)
  assert.equal(moved.typeId, type.id)
  assert.equal((await p.getEntity(summary.id)).bookId, f.world.id)
  assert.equal((await p.getIllustration(moved.id)).id, image.id)
  assert.equal((await p.getIllustration(moved.id)).bookId, f.world.id)
  assert.deepEqual(ids(await p.listSnapshots(moved.id)), ids(beforeSnapshots))
  const worldAssetId = documentBlocks(moved.content)[0].block.assetId
  assert.notEqual(worldAssetId, asset.id)
  assert.equal((await f.db.table('galleryImages').get(asset.id)).bookId, book.id)
  assert.equal((await f.db.table('galleryImages').get(worldAssetId)).bookId, f.world.id)
  assert.equal(await (await f.db.table('galleryImages').get(worldAssetId)).image.text(), 'image')
  assert.equal(documentBlocks((await p.listSnapshots(moved.id))[0].content)[0].block.assetId, worldAssetId)
  const copied = await w.copyWorldEntryToBook(second.id, moved.id)
  assert.notEqual(copied.id, moved.id)
  assert.equal(copied.worldId, undefined)
  assert.equal(copied.bookId, second.id)
  assert.equal((await p.getEntity('summary-' + copied.id)).content, 'Compass summary')
  assert.equal((await p.listSnapshots(copied.id)).length, beforeSnapshots.length)
  assert.notEqual((await p.getIllustration(copied.id)).id, image.id)
  const copiedAssetId = documentBlocks(copied.content)[0].block.assetId
  assert.notEqual(copiedAssetId, worldAssetId)
  assert.equal((await f.db.table('galleryImages').get(copiedAssetId)).bookId, second.id)
  await w.setBookWorld(second.id, '')
  assert.ok((await lore.getEffectiveLoreTypes(second.id)).some(item => item.id === copied.typeId))
  assert.equal((await p.getEntity(copied.id)).content, copied.content)
  assert.equal((await p.getEntity(moved.id)).worldId, f.world.id)
})

test('transfer conflicts reserve destination owner triggers and multi-book demotion is atomic, including hidden Books', async () => {
  const f = await fixture(), [first, second, third] = f.books
  const worldEntry = await p.createCodexEntry(f.world.id, 'Reserved')
  const local = await p.createCodexEntry(first.id, 'reserved')
  assert.equal((await w.worldTransferConflicts(first.id, local.id))[0].entryId, worldEntry.id)
  await assert.rejects(() => w.moveEntryToWorld(first.id, local.id), /conflicts/)
  assert.equal((await p.getEntity(local.id)).bookId, first.id)
  assert.equal((await w.worldTransferConflicts(first.id, worldEntry.id))[0].entryId, local.id)
  await assert.rejects(() => w.copyWorldEntryToBook(first.id, worldEntry.id), /conflicts/)
  const conflicts = await w.worldDemotionConflicts(f.world.id, worldEntry.id)
  assert.equal(conflicts[0].bookId, first.id)
  assert.equal(conflicts[0].bookTitle, first.title)
  await assert.rejects(() => w.copyWorldEntryToAllBooksAndRemove(f.world.id, worldEntry.id), /conflicts/)
  assert.equal((await w.listBookCodexEntries(second.id)).filter(entry => !entry.worldId).length, 0)
  assert.ok(await p.getEntity(worldEntry.id))
  await p.deleteEntityTree(local.id)
  await w.setWorldEntryHidden(third.id, worldEntry.id, true)
  await w.copyWorldEntryToAllBooksAndRemove(f.world.id, worldEntry.id)
  assert.equal(await p.getEntity(worldEntry.id), undefined)
  const copies = []
  for (const book of f.books) {
    const entries = await w.listBookCodexEntries(book.id)
    assert.equal(entries.length, 1)
    assert.equal(entries[0].worldId, undefined)
    copies.push(entries[0].id)
  }
  assert.equal(new Set(copies).size, 3)
  assert.equal((await p.getEntity(third.id)).hiddenWorldEntryIds.includes(worldEntry.id), false)
  const emptyWorld = await w.createWorld('No Books')
  const orphan = await p.createCodexEntry(emptyWorld.id, 'No silent loss')
  await assert.rejects(() => w.copyWorldEntryToAllBooksAndRemove(emptyWorld.id, orphan.id), /at least one Book/)
  assert.ok(await p.getEntity(orphan.id))
})

test('World edges stay in one World; local edges can target visible connected World lore; unsafe transfers do not change data', async () => {
  const f = await fixture(), book = f.books[0]
  const local = await p.createCodexEntry(book.id, 'Local')
  const privateEntry = await p.createCodexEntry(book.id, 'Private')
  const shared = await p.createCodexEntry(f.world.id, 'Shared')
  await p.createCodexDependency(book.id, local.id, shared.id)
  await p.createCodexDependency(book.id, local.id, privateEntry.id)
  await assert.rejects(() => p.createCodexDependency(f.world.id, shared.id, privateEntry.id), /not available/)
  await assert.rejects(() => w.moveEntryToWorld(book.id, local.id), /local Book/)
  assert.equal((await p.getEntity(local.id)).worldId, undefined)
  const outgoing = await p.listOutgoingCodexDependencies(book.id, local.id)
  await p.removeCodexDependency(outgoing.find(edge => edge.targetId === privateEntry.id).id)
  await w.moveEntryToWorld(book.id, local.id)
  assert.equal((await p.listOutgoingCodexDependencies(f.world.id, local.id))[0].targetId, shared.id)
  await assert.rejects(() => w.copyWorldEntryToAllBooksAndRemove(f.world.id, shared.id), /incoming World dependencies/)
  assert.ok(await p.getEntity(shared.id))
  await w.setBookWorld(book.id, '')
  assert.equal((await p.listCodexDependencies(book.id)).length, 0)
})

test('only empty Worlds can be deleted, attached links are cleared, rename is optimistic, and changes notify affected Books', async t => {
  const f = await fixture(), events = [], worlds = []
  const onEntity = event => events.push(event.detail.bookId), onWorld = () => worlds.push(true)
  window.addEventListener('arc-entity-changed', onEntity)
  window.addEventListener('arc-worlds-changed', onWorld)
  t.after(() => { window.removeEventListener('arc-entity-changed', onEntity); window.removeEventListener('arc-worlds-changed', onWorld) })
  const current = await p.getEntity(f.world.id)
  await w.renameWorld(f.world.id, 'Renamed', current.updatedAt)
  await assert.rejects(() => w.renameWorld(f.world.id, 'Stale rename', current.updatedAt), /changed/)
  const entry = await p.createCodexEntry(f.world.id, 'Block deletion')
  await assert.rejects(() => w.deleteWorld(f.world.id), /empty World/)
  await p.deleteEntityTree(entry.id)
  await w.deleteWorld(f.world.id)
  assert.equal(await p.getEntity(f.world.id), undefined)
  for (const book of f.books) {
    assert.equal((await p.getEntity(book.id)).worldId, undefined)
    assert.ok(events.includes(book.id))
  }
  assert.ok(worlds.length > 0)
})

test('portable book snapshots include only visible canonical World lore/media/types and import as independent local entries', async () => {
  const f = await fixture(), book = f.books[0]
  const visible = await p.createCodexEntry(f.world.id, 'Visible snapshot')
  const hidden = await p.createCodexEntry(f.world.id, 'Hidden snapshot')
  await p.getOrCreateSummary(visible)
  await p.getOrCreateSummary(hidden)
  const asset = { id: 'snapshot-asset-' + crypto.randomUUID(), bookId: f.world.id, image: new Blob(['image']), thumbnail: new Blob(['thumb']), width: 10, height: 10, prompt: 'Shared', kept: true, createdAt: Date.now() }
  await f.db.table('galleryImages').add(asset)
  await p.saveDocumentContent(visible.id, encodeDocumentBlock({ id: 'snapshot-block', type: 'image', assetId: asset.id }))
  await w.setWorldEntryHidden(book.id, hidden.id, true)
  const local = await p.createCodexEntry(book.id, visible.title)
  const data = await p.readBookArchive(book.id)
  const visibleSnapshot = data.entities.find(row => row.type === 'codexEntry' && row.id !== local.id && row.title === visible.title)
  assert.ok(visibleSnapshot)
  assert.notEqual(visibleSnapshot.id, visible.id)
  assert.equal(visibleSnapshot.autoIncludeTriggers.length, 0)
  assert.equal(data.entities.find(row => row.id === local.id).autoIncludeTriggers.length, 1)
  assert.equal(data.entities.some(row => row.title === hidden.title || row.title === hidden.title + ' summary'), false)
  const otherSnapshot = await p.readBookArchive(f.books[1].id)
  assert.notEqual(otherSnapshot.entities.find(row => row.title === visible.title).id, visibleSnapshot.id)
  assert.equal((await p.readBookArchive(book.id)).entities.find(row => row.id === visibleSnapshot.id).id, visibleSnapshot.id)
  assert.equal(data.entities.some(row => row.type === 'world' || row.worldId), false)
  assert.ok(data.entities.filter(row => !['book', 'series'].includes(row.type)).every(row => row.bookId === book.id))
  assert.equal(visibleSnapshot.parentId, book.id)
  const snapshotAssetId = documentBlocks(visibleSnapshot.content)[0].block.assetId
  assert.notEqual(snapshotAssetId, asset.id)
  assert.equal(data.galleryImages.find(row => row.id === snapshotAssetId).bookId, book.id)
  assert.ok(encodeBookArchive(data).size > 0)
  const imported = copyBookArchive(data)
  await p.writeBookArchive(imported.data)
  const importedBook = await p.getEntity(imported.bookId)
  assert.equal(importedBook.worldId, undefined)
  const importedEntries = await w.listBookCodexEntries(imported.bookId)
  assert.equal(importedEntries.length, 2)
  assert.notEqual(importedEntries[0].id, visible.id)
  assert.equal(importedEntries[0].worldId, undefined)
  assert.ok((await w.listWorlds()).some(world => world.id === f.world.id))
})

test('requesting-Book summary saves validate live World access, canonical ownership, approvals, source revisions and expected content', async () => {
  const f = await fixture(), [book, other] = f.books
  const entry = await p.createCodexEntry(f.world.id, 'Approved summary source')
  const summary = await p.getOrCreateSummary(entry)
  const approval = { messageId: 'approval-' + crypto.randomUUID(), proposalId: 'proposal-' + crypto.randomUUID() }
  const message = { id: approval.messageId, type: 'chatMessage', bookId: book.id, parentId: book.id, content: '', createdAt: 1, updatedAt: 1, entityActions: [{ id: approval.proposalId, status: 'applying', entityId: entry.id, operation: { kind: 'summary' } }] }
  await p.putEntity(message)
  const saved = await p.saveSummaryContent(summary.id, 'Approved World summary', entry.sourceRevision, summary, approval, book.id)
  assert.equal(saved.bookId, f.world.id)
  assert.equal(saved.worldId, f.world.id)
  await assert.rejects(() => p.saveSummaryContent(summary.id, 'Outside scope', entry.sourceRevision, saved, undefined, f.outsider.id), /unavailable/)
  await assert.rejects(() => p.saveSummaryContent(summary.id, 'Missing Book', entry.sourceRevision, saved, undefined, 'missing-book'), /unavailable/)
  await assert.rejects(() => p.saveSummaryContent(summary.id, 'Other Book approval', entry.sourceRevision, saved, approval, other.id), /approval/)
  await assert.rejects(() => p.saveSummaryContent(summary.id, 'Legacy World approval', entry.sourceRevision, saved, approval), /approval/)
  await p.putEntity({ ...message, entityActions: [{ ...message.entityActions[0], status: 'declined' }] })
  await assert.rejects(() => p.saveSummaryContent(summary.id, 'Expired approval', entry.sourceRevision, saved, approval, book.id), /approval/)
  await w.setWorldEntryHidden(book.id, entry.id, true)
  await assert.rejects(() => p.saveSummaryContent(summary.id, 'Hidden source', entry.sourceRevision, saved, undefined, book.id), /unavailable/)
  await w.setWorldEntryHidden(book.id, entry.id, false)
  await w.setBookWorld(book.id, '')
  await assert.rejects(() => p.saveSummaryContent(summary.id, 'Disconnected source', entry.sourceRevision, saved, undefined, book.id), /unavailable/)
  await w.setBookWorld(book.id, f.world.id)
  await p.archiveCodexEntry(entry.id)
  await assert.rejects(() => p.saveSummaryContent(summary.id, 'Archived source', entry.sourceRevision, saved, undefined, book.id), /archived/)
  await p.restoreCodexEntry(entry.id)
  const edited = await p.updateEntityAtomically(entry.id, current => ({ ...current, content: 'New authoritative source', sourceRevision: current.sourceRevision + 1, updatedAt: current.updatedAt + 1 }))
  await assert.rejects(() => p.saveSummaryContent(summary.id, 'Stale generated summary', entry.sourceRevision, saved, undefined, book.id), /source changed/)
  await assert.rejects(() => p.saveSummaryContent(summary.id, 'Stale expected timestamp', edited.sourceRevision, { ...saved, updatedAt: saved.updatedAt - 1 }, undefined, book.id), /summary changed/)
  await assert.rejects(() => p.saveSummaryContent(summary.id, 'Stale expected content', edited.sourceRevision, { ...saved, content: 'different content' }, undefined, book.id), /summary changed/)
  assert.equal((await p.getEntity(summary.id)).content, saved.content)
  await p.saveSummaryContent(summary.id, 'Current source summary', edited.sourceRevision, saved, undefined, book.id)
  // Callers without the new scope argument retain the legacy revision behavior.
  const legacy = await p.saveSummaryContent(summary.id, 'Legacy direct save', entry.sourceRevision)
  assert.equal(legacy.content, 'Legacy direct save')
})

test('requesting-Book summary saves use structural aggregate revisions, not only the parent timestamp', async () => {
  const f = await fixture(), book = f.books[0]
  const scene = (await p.listEntitiesByBook(book.id, 'scene'))[0]
  const chapter = await p.getEntity(scene.parentId)
  const sceneSummary = await p.getOrCreateSummary(scene)
  await p.saveSummaryContent(sceneSummary.id, 'Child summary', scene.updatedAt)
  await p.updateEntityAtomically(sceneSummary.id, current => ({ ...current, updatedAt: chapter.updatedAt + 100 }))
  const summary = await p.getOrCreateSummary(chapter)
  const source = await buildSummarySource(chapter.id, book.id)
  assert.ok(source.sourceRevision > chapter.updatedAt)
  await assert.rejects(() => p.saveSummaryContent(summary.id, 'Wrong parent-only revision', chapter.updatedAt, summary, undefined, book.id), /source changed/)
  const saved = await p.saveSummaryContent(summary.id, 'Aggregate summary', source.sourceRevision, summary, undefined, book.id)
  assert.equal(saved.summarizedSourceRevision, source.sourceRevision)
})

test('World dependencies created through a Book keep canonical ownership when updated and removed', async () => {
  const f = await fixture(), book = f.books[0]
  const source = await p.createCodexEntry(f.world.id, 'Dependency source')
  const target = await p.createCodexEntry(f.world.id, 'Dependency target')
  const local = await p.createCodexEntry(book.id, 'Private dependency target')
  const edge = await p.createCodexDependency(book.id, source.id, target.id, 'Shared relation')
  assert.equal(edge.bookId, f.world.id)
  const updated = await p.updateCodexDependency(edge.id, { relationLabel: 'New relation', includeWithSource: false })
  assert.equal(updated.bookId, f.world.id)
  assert.equal(updated.relationLabel, 'New relation')
  await assert.rejects(() => p.createCodexDependency(book.id, source.id, local.id), /not available/)
  await w.setWorldEntryHidden(book.id, target.id, true)
  await assert.rejects(() => p.createCodexDependency(book.id, source.id, target.id), /not available/)
  await p.removeCodexDependency(edge.id)
  assert.equal((await p.listOutgoingCodexDependencies(f.world.id, source.id)).length, 0)
})

test('read-time lore type ensures and no-op World/entity mutations do not emit notification feedback', async t => {
  const f = await fixture(), book = f.books[0]
  const source = await p.createCodexEntry(f.world.id, 'Notification source')
  const target = await p.createCodexEntry(f.world.id, 'Notification target')
  const edge = await p.createCodexDependency(book.id, source.id, target.id)
  await lore.getEffectiveLoreTypes(book.id)
  let entities = 0, worlds = 0
  const onEntity = () => { entities++ }, onWorld = () => { worlds++ }
  window.addEventListener('arc-entity-changed', onEntity)
  window.addEventListener('arc-worlds-changed', onWorld)
  t.after(() => { window.removeEventListener('arc-entity-changed', onEntity); window.removeEventListener('arc-worlds-changed', onWorld) })
  for (let i = 0; i < 2; i++) {
    await lore.getEffectiveLoreTypes(book.id)
    await lore.getEffectiveLoreTypes(f.world.id)
    await p.putEntity(await p.getEntity(book.id))
    await p.putEntity(await p.getEntity(source.id))
    await w.setBookWorld(book.id, f.world.id)
    await w.setWorldEntryHidden(book.id, source.id, false)
    await w.renameWorld(f.world.id, f.world.title)
    await p.updateCodexDependency(edge.id, { relationLabel: edge.relationLabel, includeWithSource: edge.includeWithSource })
  }
  assert.equal(entities, 0)
  assert.equal(worlds, 0)
  await w.renameWorld(f.world.id, 'A real change')
  assert.ok(entities > 0)
  assert.ok(worlds > 0)
})

test('a genuinely empty v8 database also gets the demo once and never resets later World data', async () => {
  const db = await p.database()
  db.close()
  await db.delete()
  await db.open()
  await p.ensurePrototypeSeed('Fresh database')
  assert.deepEqual(ids(await p.listBooks()), [p.PROTOTYPE_BOOK_ID])
  const world = await w.createWorld('Survives subsequent startup')
  await w.setBookWorld(p.PROTOTYPE_BOOK_ID, world.id)
  await p.ensurePrototypeSeed('Ignored second seed')
  assert.equal((await p.getEntity(p.PROTOTYPE_BOOK_ID)).worldId, world.id)
  assert.equal((await p.getEntity(p.PROTOTYPE_SCENE_ID)).content, 'Fresh database')
  assert.equal((await p.listBooks()).length, 1)
})

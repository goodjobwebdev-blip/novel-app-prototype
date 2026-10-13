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
const chat = await import('../src/features/chat/chat-service.ts')
const ai = await import('../src/shared/ai/ai-settings.ts')
const { buildContextValues } = await import('../src/shared/context/context-service.ts')
after(async () => (await p.database()).close())

const { entityAvailableInWorkspace } = await import('../src/app/workspace-owner.ts')

test('canonical World ownership is required by reads and raw resource writes', async () => {
  const world = await w.createWorld('Canonical resources'), other = await w.createWorld('Other canonical owner')
  const { book } = await p.createBook(ai.initialAiSettings)
  const note = await p.createNote(world.id)
  const db = await p.database()
  for (const worldId of [undefined, '', other.id]) {
    const malformed = { ...note, worldId }
    assert.equal(w.entityAvailableInOwner(malformed, world), false)
    assert.equal(entityAvailableInWorkspace(malformed, world), false)
    await assert.rejects(() => db.table('entities').put(malformed), /canonical|owner/i)
  }
  const bookNote = await p.createNote(book.id)
  await assert.rejects(() => db.table('entities').update(bookNote.id, { worldId: '' }), /canonical|owner/i)
  assert.deepEqual(await p.getEntity(note.id), note)
})

test('raw dependency writes reject private endpoints and preserve already archived edges', async () => {
  const world = await w.createWorld('Raw dependency owner'), other = await w.createWorld('Foreign dependency owner')
  const { book } = await p.createBook(ai.initialAiSettings)
  await w.setBookWorld(book.id, world.id)
  const source = await p.createCodexEntry(world.id, 'Raw source')
  const target = await p.createCodexEntry(world.id, 'Raw target')
  const privateEntry = await p.createCodexEntry(book.id, 'Raw private target')
  const foreign = await p.createCodexEntry(other.id, 'Raw foreign target')
  const edge = await p.createCodexDependency(world.id, source.id, target.id)
  const db = await p.database()
  for (const targetId of [privateEntry.id, foreign.id, source.id, 'missing-target']) {
    await assert.rejects(() => db.table('codexDependencies').update(edge.id, { targetId }), /dependency|owner|available/i)
    await assert.rejects(() => db.table('codexDependencies').add({ ...edge, id: `invalid-${targetId}`, targetId }), /dependency|owner|available/i)
  }
  await assert.rejects(() => db.table('codexDependencies').put({ ...edge, bookId: book.id }), /canonical|owner/i)
  await assert.rejects(() => db.table('codexDependencies').bulkPut([{ ...edge, id: 'raw-bulk-valid' }, { ...edge, id: 'raw-bulk-private', targetId: privateEntry.id }]), /dependency|owner|available/i)
  assert.equal(await db.table('codexDependencies').get('raw-bulk-valid'), undefined)
  await p.archiveCodexEntry(target.id)
  await db.table('codexDependencies').put({ ...edge, relationLabel: 'Retained archived relation' })
  assert.equal((await db.table('codexDependencies').get(edge.id)).relationLabel, 'Retained archived relation')
  // Raw archive restoration preserves archived endpoints; UI creation still rejects them.
  await db.table('codexDependencies').bulkAdd([{ ...edge, id: 'restored-archived-edge' }])
  assert.equal((await db.table('codexDependencies').get('restored-archived-edge')).targetId, target.id)
  await assert.rejects(() => p.createCodexDependency(world.id, source.id, target.id), /archived|Restore/i)
})

test('an orphan World summary blocks empty-World deletion without discarding content', async () => {
  const world = await w.createWorld('Orphan summary owner')
  const source = await p.createCodexEntry(world.id, 'Summary source')
  const summary = await p.getOrCreateSummary(source)
  await p.saveDocumentContent(summary.id, 'Orphan summary survives')
  const db = await p.database()
  // Simulate legacy damage: deleting a source directly leaves its persisted summary.
  await db.table('entities').delete(source.id)
  assert.equal((await w.getWorldDeletionImpact(world.id)).canDelete, false)
  await assert.rejects(() => w.deleteWorld(world.id), /empty World/)
  assert.equal((await p.getEntity(summary.id)).content, 'Orphan summary survives')
  assert.ok(await p.getWorld(world.id))
})

test('World context uses only selected and automatically available World sources despite linked Book selections', async () => {
  const world = await w.createWorld('Isolated context'), other = await w.createWorld('Foreign context')
  const { book, scene } = await p.createBook(ai.initialAiSettings)
  await w.setBookWorld(book.id, world.id)
  const privateNote = await p.createNote(book.id, 'Private note')
  const privateEntry = await p.createCodexEntry(book.id, 'Private lore')
  const foreignEntry = await p.createCodexEntry(other.id, 'Foreign lore')
  await p.saveDocumentContent(scene.id, 'PRIVATE_SCENE_BODY')
  await p.saveDocumentContent(privateNote.id, 'PRIVATE_NOTE_BODY')
  await p.saveDocumentContent(privateEntry.id, 'PRIVATE_LORE_BODY')
  await p.saveDocumentContent(foreignEntry.id, 'FOREIGN_WORLD_BODY')
  const selectedNote = await p.createNote(world.id, 'Selected World note')
  const root = await p.createCodexEntry(world.id, 'Beacon')
  const dependency = await p.createCodexEntry(world.id, 'World dependent source')
  const draft = await p.createCodexEntry(world.id, 'Unfinished source')
  const archived = await p.createCodexEntry(world.id, 'Archived source')
  for (const entry of [root, draft, archived]) await p.updateCodexAutoIncludeTriggers(entry.id, [entry.title])
  await p.saveDocumentContent(selectedNote.id, 'SELECTED_WORLD_NOTE')
  await p.saveDocumentContent(root.id, 'AUTOMATIC_WORLD_LORE')
  await p.saveDocumentContent(dependency.id, 'DEPENDENCY_WORLD_LORE')
  await p.saveDocumentContent(draft.id, 'DRAFT_WORLD_LORE')
  await p.saveDocumentContent(archived.id, 'ARCHIVED_WORLD_LORE')
  await p.setCodexEntryStatus(draft.id, 'draft')
  await p.archiveCodexEntry(archived.id)
  await p.createCodexDependency(world.id, root.id, dependency.id)
  const settings = await p.getBookContextSettings(world.id)
  const prepared = await buildContextValues({
    bookId: world.id, type: 'chat', currentSceneId: scene.id,
    currentSceneText: 'Beacon Unfinished source Archived source',
    profile: { ...settings.profiles.chat, includeLastScene: true, includePreviousSceneWhenEmpty: true, loreAtCurrentScene: true, structuralIds: [scene.id], summaryRange: 'all', noteIds: [selectedNote.id, privateNote.id], codexEntryIds: [privateEntry.id, foreignEntry.id] },
  })
  for (const key of ['currentSceneId', 'currentSceneText', 'currentSceneTitle', 'previousSceneId', 'previousSceneText', 'previousSceneTitle', 'lastSceneText', 'lastSceneTitle', 'summaryContext']) assert.equal(prepared[key], '', key)
  assert.deepEqual(new Set(prepared.automaticCodex.map(item => item.entryId)), new Set([root.id, dependency.id]))
  assert.match(prepared.additionalContext, /SELECTED_WORLD_NOTE/)
  assert.match(prepared.additionalContext, /AUTOMATIC_WORLD_LORE/)
  assert.match(prepared.additionalContext, /DEPENDENCY_WORLD_LORE/)
  assert.doesNotMatch(JSON.stringify(prepared), /PRIVATE_SCENE_BODY|PRIVATE_NOTE_BODY|PRIVATE_LORE_BODY|FOREIGN_WORLD_BODY|DRAFT_WORLD_LORE|ARCHIVED_WORLD_LORE/)
})

test('last article survives database reopening and Book visibility changes never alter World navigation', async () => {
  const world = await w.createWorld('Durable article'), other = await w.createWorld('Other durable article')
  const { book } = await p.createBook(ai.initialAiSettings)
  await w.setBookWorld(book.id, world.id)
  const article = await p.createCodexEntry(world.id, 'Remembered article')
  await p.saveOwnerWorkspaceState(world.id, { lastOpenedCodexEntryId: article.id })
  await p.saveOwnerWorkspaceState(book.id, { lastOpenedCodexEntryId: article.id })
  const db = await p.database()
  db.close()
  await db.open()
  assert.deepEqual(await p.getOwnerWorkspaceState(world.id), { lastOpenedCodexEntryId: article.id })
  assert.deepEqual(await p.getOwnerWorkspaceState(other.id), { lastOpenedCodexEntryId: '' })
  await w.setWorldEntryHidden(book.id, article.id, true)
  assert.deepEqual(await p.getOwnerWorkspaceState(book.id), { lastOpenedCodexEntryId: '' })
  assert.deepEqual(await p.getOwnerWorkspaceState(world.id), { lastOpenedCodexEntryId: article.id })
  await w.setWorldEntryHidden(book.id, article.id, false)
  await w.changeBookWorld(book.id, '', { confirmed: true, expectedWorldId: world.id })
  assert.deepEqual(await p.getOwnerWorkspaceState(book.id), { lastOpenedCodexEntryId: '' })
  assert.deepEqual(await p.getOwnerWorkspaceState(world.id), { lastOpenedCodexEntryId: article.id })
  await p.deleteEntityTree(article.id)
  assert.deepEqual(await p.getOwnerWorkspaceState(world.id), { lastOpenedCodexEntryId: '' })
})

test('Book detachment prunes only inaccessible Book edges and preserves canonical World dependencies', async () => {
  const world = await w.createWorld('Detached canonical dependencies')
  const { book } = await p.createBook(ai.initialAiSettings)
  await w.setBookWorld(book.id, world.id)
  const localA = await p.createCodexEntry(book.id, 'Local source')
  const localB = await p.createCodexEntry(book.id, 'Local target')
  const sharedA = await p.createCodexEntry(world.id, 'Shared source')
  const sharedB = await p.createCodexEntry(world.id, 'Shared target')
  const local = await p.createCodexDependency(book.id, localA.id, localB.id)
  const inaccessible = await p.createCodexDependency(book.id, localA.id, sharedA.id)
  const canonical = await p.createCodexDependency(world.id, sharedA.id, sharedB.id)
  const impact = await w.getBookWorldChangeImpact(book.id, '')
  assert.equal(impact.unavailableDependencies, 1)
  assert.deepEqual(new Set(impact.lostEntryIds), new Set([sharedA.id, sharedB.id]))
  await w.changeBookWorld(book.id, '', { confirmed: true, expectedWorldId: world.id })
  const db = await p.database()
  assert.equal(await db.table('codexDependencies').get(inaccessible.id), undefined)
  assert.deepEqual(await db.table('codexDependencies').get(local.id), local)
  assert.deepEqual(await db.table('codexDependencies').get(canonical.id), canonical)
  assert.deepEqual((await p.listCodexDependencies(world.id)).map(edge => edge.id), [canonical.id])
  assert.deepEqual((await p.listCodexDependencies(book.id)).map(edge => edge.id), [local.id])
  assert.equal((await p.getEntity(localA.id)).bookId, book.id)
  assert.equal((await p.getEntity(sharedA.id)).worldId, world.id)
})

test('empty World deletion leaves linked Book Notes, Chat history and manuscript intact', async () => {
  const world = await w.createWorld('Delete empty owner')
  const { book, scene } = await p.createBook(ai.initialAiSettings)
  await w.setBookWorld(book.id, world.id)
  const note = await p.createNote(book.id, 'Durable Book note')
  await p.saveDocumentContent(note.id, 'Book note remains')
  await p.saveDocumentContent(scene.id, 'Book manuscript remains')
  const conversation = await chat.createChat(book.id)
  const message = await chat.createChatMessage(conversation, 'user', 'Book history remains')
  await p.getBookContextSettings(world.id)
  await p.getBookProfileSelections(world.id)
  await p.saveOwnerWorkspaceState(world.id, { lastOpenedCodexEntryId: '' })
  const expected = await Promise.all([p.getEntity(note.id), p.getEntity(scene.id), p.getEntity(conversation.id), p.getEntity(message.id)])
  assert.equal((await w.getWorldDeletionImpact(world.id)).canDelete, true)
  await w.deleteWorld(world.id)
  assert.equal(await p.getWorld(world.id), undefined)
  assert.equal((await p.getBook(book.id)).worldId, undefined)
  assert.deepEqual(await p.listEntitiesByBook(world.id), [])
  assert.deepEqual(await Promise.all([p.getEntity(note.id), p.getEntity(scene.id), p.getEntity(conversation.id), p.getEntity(message.id)]), expected)
  await assert.rejects(() => p.createNote(world.id), /no longer exists/)
  await assert.rejects(() => p.saveOwnerWorkspaceState(world.id, {}), /no longer exists/)
})

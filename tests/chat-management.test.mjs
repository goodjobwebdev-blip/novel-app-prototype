import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import 'fake-indexeddb/auto'

const storage = new Map()
globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) }

// Run the app's bundled Dexie against IndexedDB in memory, resolving its
// bundler-style TypeScript imports for Node.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const url = new URL(specifier + '.ts', context.parentURL)
    if (existsSync(fileURLToPath(url))) return nextResolve(url.href, context)
  }
  return nextResolve(specifier, context)
} })
const db = await import('../src/persistence.ts')
const { initialAiSettings, copyAiSettings } = await import('../src/ai-settings.ts')
const { executeChatManagementTool } = await import('../src/chat-management-tools.ts')
const { executeChatWorkspaceTool } = await import('../src/chat-tools.ts')
const { applyChatEntityAction, rejectChatEntityAction } = await import('../src/chat-entity-tools.ts')
const { createChat, createChatMessage } = await import('../src/chat-service.ts')
const { getFakeProviderTrace, clearFakeProviderTrace } = await import('../src/fake-provider.ts')
const { prepareSummaryGeneration, regenerateEntitySummary } = await import('../src/summary-generation.ts')
const { CHAT_TOOL_DEFINITIONS } = await import('../src/chat-request.ts')

function call(name, args = {}) { return { id: crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } } }
async function execute(bookId, name, args = {}) {
  const result = await executeChatManagementTool(bookId, call(name, args))
  return { ...JSON.parse(result.content), proposal: result.entityAction }
}
async function fixture() {
  const settings = copyAiSettings(initialAiSettings)
  settings.provider = 'fake'
  settings.mainModel = 'chat-model-must-not-be-used'
  settings.supportModel = 'fake/test'
  settings.supportModelContextLength = 100000
  settings.promptCompositions.summarize.systemPrompt = 'Book {{book.title}}. Summary custom instructions. [DELAY_MS:0]'
  const result = await db.createBook(settings, 'Tool test book')
  const chat = await createChat(result.book.id)
  return { ...result, chat, settings }
}
async function persist(f, proposal) {
  assert.ok(proposal)
  return createChatMessage(f.chat, 'assistant', '', { entityActions: [proposal] })
}
async function approve(f, proposal, signal) {
  const message = await persist(f, proposal)
  await applyChatEntityAction(message.id, proposal.id, signal)
  return message
}
async function readProposal(message, proposal) { return (await db.getEntity(message.id)).entityActions.find((item) => item.id === proposal.id) }

test('all tools have unique names; metadata reads and approved patches cover all fields', async () => {
  const names = CHAT_TOOL_DEFINITIONS.map((t) => t.function.name)
  assert.equal(new Set(names).size, names.length)
  assert.equal(names.length, 27)
  assert.ok(names.includes('propose_image_generation'))
  const f = await fixture()
  const series = await db.createSeries('Test series ' + crypto.randomUUID())
  const read = await execute(f.book.id, 'read_book_metadata')
  assert.ok(read.series.some((s) => s.id === series.id))
  const changes = { title: 'New title', seriesId: series.id, seriesOrder: '3', overview: 'An overview', genre: 'Fantasy', writingStyle: 'Spare', pointOfView: 'First person', tense: 'Present', language: 'French' }
  const result = await execute(f.book.id, 'propose_book_metadata_update', { changes })
  assert.equal((await db.getEntity(f.book.id)).title, f.book.title)
  await approve(f, result.proposal)
  for (const [field, value] of Object.entries(changes)) assert.equal((await db.getEntity(f.book.id))[field], value)
  const partial = await execute(f.book.id, 'propose_book_metadata_update', { changes: { overview: '' } })
  await db.updateEntityAtomically(f.book.id, (book) => ({ ...book, language: 'German' }))
  await approve(f, partial.proposal)
  assert.equal((await db.getEntity(f.book.id)).language, 'German')
  assert.equal((await db.getEntity(f.book.id)).overview, '')
  const standalone = await execute(f.book.id, 'propose_book_metadata_update', { changes: { seriesId: '' } })
  await approve(f, standalone.proposal)
  assert.equal((await db.getEntity(f.book.id)).seriesOrder, '')
})

test('metadata rejects unsupported fields, invalid Series and stale approvals', async () => {
  const f = await fixture()
  for (const changes of [{ id: 'other-book' }, { title: '' }, { language: 42 }, { seriesId: 'missing' }, { seriesOrder: '2' }]) {
    assert.equal((await execute(f.book.id, 'propose_book_metadata_update', { changes })).ok, false)
  }
  const result = await execute(f.book.id, 'propose_book_metadata_update', { changes: { genre: 'Horror' } })
  const message = await persist(f, result.proposal)
  await db.updateEntityAtomically(f.book.id, (book) => ({ ...book, genre: 'Romance' }))
  await assert.rejects(applyChatEntityAction(message.id, result.proposal.id), /changed/)
  assert.equal((await db.getEntity(f.book.id)).genre, 'Romance')
  assert.equal((await readProposal(message, result.proposal)).status, 'stale')
})

test('search and listing paginate deterministically, show matching snippets and respect filters', async () => {
  const f = await fixture()
  for (let i = 0; i < 27; i++) await db.putEntity({ id: `${f.book.id}-note-${i}`, type: 'note', bookId: f.book.id, parentId: f.book.id, title: `Note ${String(i).padStart(2, '0')}`, content: 'preface '.repeat(90) + 'needle in the middle', createdAt: i, updatedAt: i })
  const other = await fixture()
  await db.createNote(other.book.id, 'needle must not leak')
  const results = []
  let offset = 0
  do {
    const page = JSON.parse((await executeChatWorkspaceTool(f.book.id, call('search_entities', { query: 'needle', types: ['note'], offset }))).content)
    assert.equal(page.total, 27)
    page.results.forEach((entry) => assert.match(entry.preview, /needle/))
    results.push(...page.results)
    offset = page.next_offset
  } while (offset !== null)
  assert.equal(new Set(results.map((e) => e.id)).size, 27)
  assert.equal((await execute(f.book.id, 'list_entities', { types: ['scene'], parent_id: f.chapter.id })).results.length, 1)
  assert.equal((await execute(f.book.id, 'list_entities', { limit: 51 })).ok, false)
  const archived = await db.createCodexEntry(f.book.id, 'Retired')
  await db.archiveCodexEntry(archived.id)
  assert.equal((await execute(f.book.id, 'list_entities', { types: ['codexEntry'] })).total, 0)
  assert.equal((await execute(f.book.id, 'list_entities', { types: ['codexEntry'], include_archived: true })).total, 1)
})

test('Codex dependencies require approval and support directional create, update and remove', async () => {
  const f = await fixture()
  const a = await db.createCodexEntry(f.book.id, 'A')
  const b = await db.createCodexEntry(f.book.id, 'B')
  const args = { entity_id: a.id, target_id: b.id }
  const result = await execute(f.book.id, 'propose_codex_dependency', { ...args, action: 'create', relation_label: 'lives in' })
  assert.equal((await db.listCodexDependencies(f.book.id)).length, 0)
  await approve(f, result.proposal)
  assert.equal((await execute(f.book.id, 'read_codex_settings', { entity_id: a.id })).dependencies[0].targetId, b.id)
  assert.equal((await execute(f.book.id, 'read_codex_settings', { entity_id: b.id })).neededBy[0].sourceId, a.id)
  const update = await execute(f.book.id, 'propose_codex_dependency', { ...args, action: 'update', include_with_source: false })
  await approve(f, update.proposal)
  assert.equal((await db.listCodexDependencies(f.book.id))[0].includeWithSource, false)
  const remove = await execute(f.book.id, 'propose_codex_dependency', { ...args, action: 'remove' })
  await approve(f, remove.proposal)
  assert.equal((await db.listCodexDependencies(f.book.id)).length, 0)
  assert.equal((await execute(f.book.id, 'propose_codex_dependency', { entity_id: a.id, target_id: a.id, action: 'create' })).ok, false)
  const other = await fixture()
  const foreign = await db.createCodexEntry(other.book.id, 'Foreign')
  assert.equal((await execute(f.book.id, 'propose_codex_dependency', { entity_id: a.id, target_id: foreign.id, action: 'create' })).ok, false)
})

test('stale dependencies and rejected trigger proposals do not mutate; trigger normalization preserves source revision', async () => {
  const f = await fixture()
  const a = await db.createCodexEntry(f.book.id, 'A')
  const b = await db.createCodexEntry(f.book.id, 'B')
  const edge = await db.createCodexDependency(f.book.id, a.id, b.id)
  const remove = await execute(f.book.id, 'propose_codex_dependency', { entity_id: a.id, target_id: b.id, action: 'remove' })
  await db.updateCodexDependency(edge.id, { relationLabel: 'new relation' })
  await assert.rejects(approve(f, remove.proposal), /changed/)
  const triggers = await execute(f.book.id, 'propose_codex_triggers', { entity_id: a.id, triggers: ['  Alias  ', 'alias', 'Other'] })
  const message = await persist(f, triggers.proposal)
  await rejectChatEntityAction(message.id, triggers.proposal.id)
  await assert.rejects(applyChatEntityAction(message.id, triggers.proposal.id))
  assert.deepEqual((await db.getEntity(a.id)).autoIncludeTriggers, ['A'])
  const accepted = await execute(f.book.id, 'propose_codex_triggers', { entity_id: a.id, triggers: ['  Alias  ', 'alias', 'Other'] })
  await approve(f, accepted.proposal)
  assert.deepEqual((await db.getEntity(a.id)).autoIncludeTriggers, ['Alias', 'Other'])
  assert.equal((await db.getEntity(a.id)).sourceRevision, a.sourceRevision)
})

test('summary reading has no writes and limits sources to the existing supported entity types', async () => {
  const f = await fixture()
  const read = await execute(f.book.id, 'read_summary', { entity_id: f.scene.id })
  assert.equal(read.state, 'missing')
  assert.equal(read.summaryId, null)
  assert.equal((await db.listEntitiesByBook(f.book.id, 'summary')).length, 0)
  const note = await db.createNote(f.book.id, 'Note')
  assert.equal((await execute(f.book.id, 'read_summary', { entity_id: note.id })).ok, false)
  const other = await fixture()
  assert.equal((await execute(f.book.id, 'propose_summary_regeneration', { entity_id: other.scene.id })).ok, false)
})

test('approved summary regeneration uses Support model, shared request, prior summary and snapshots', async () => {
  const f = await fixture()
  await db.saveDocumentContent(f.scene.id, 'Authoritative scene content')
  const source = await db.getEntity(f.scene.id)
  const summary = await db.getOrCreateSummary(source)
  await db.saveSummaryContent(summary.id, 'Previous summary', source.updatedAt)
  clearFakeProviderTrace()
  const result = await execute(f.book.id, 'propose_summary_regeneration', { entity_id: source.id })
  assert.equal(getFakeProviderTrace().length, 0)
  const before = await db.getEntity(summary.id)
  const prepared = await prepareSummaryGeneration(await db.getEntity(f.book.id), before, new AbortController().signal)
  const message = await approve(f, result.proposal)
  const trace = getFakeProviderTrace().at(-1)
  assert.equal(trace.task, 'summary')
  assert.equal(trace.model, f.settings.supportModel)
  assert.notEqual(trace.model, f.settings.mainModel)
  assert.deepEqual(trace.messages, prepared.messages)
  assert.match(JSON.stringify(trace.messages), /Authoritative scene content/)
  assert.match(JSON.stringify(trace.messages), /Previous summary/)
  assert.equal((await readProposal(message, result.proposal)).status, 'applied')
  const read = await execute(f.book.id, 'read_summary', { entity_id: source.id })
  assert.equal(read.state, 'current')
  assert.equal(read.content, trace.emittedContent)
  assert.ok(read.content.trim())
  assert.ok((await db.listSnapshots(summary.id)).some((snapshot) => snapshot.content === 'Previous summary'))
})

test('summary hierarchy uses current child summaries and full content for outdated children', async () => {
  const f = await fixture()
  await db.saveDocumentContent(f.scene.id, 'Scene original')
  const source = await db.getEntity(f.scene.id)
  const summary = await db.getOrCreateSummary(source)
  await db.saveSummaryContent(summary.id, 'Current child summary', source.updatedAt)
  const chapterSummary = await db.getOrCreateSummary(f.chapter)
  const first = await prepareSummaryGeneration(f.book, chapterSummary, new AbortController().signal)
  assert.match(first.source.content, /Current child summary/)
  assert.doesNotMatch(first.source.content, /Scene original/)
  await db.updateEntityAtomically(f.scene.id, (scene) => ({ ...scene, content: 'Updated authoritative body', updatedAt: scene.updatedAt + 100 }))
  const second = await prepareSummaryGeneration(f.book, chapterSummary, new AbortController().signal)
  assert.match(second.source.content, /Updated authoritative body/)
  assert.doesNotMatch(second.source.content, /Current child summary/)
})

test('failed and cancelled summary regeneration keeps previous content and allows retry', async () => {
  const f = await fixture()
  await db.saveDocumentContent(f.scene.id, 'Source')
  const source = await db.getEntity(f.scene.id)
  const summary = await db.getOrCreateSummary(source)
  await db.saveSummaryContent(summary.id, 'Keep me', source.updatedAt)
  f.settings.promptCompositions.summarize.systemPrompt = '[REQUEST_FAIL]'
  await db.saveBookAiSettings(f.book.id, f.settings)
  const result = await execute(f.book.id, 'propose_summary_regeneration', { entity_id: source.id })
  const message = await persist(f, result.proposal)
  await assert.rejects(applyChatEntityAction(message.id, result.proposal.id))
  assert.equal((await db.getEntity(summary.id)).content, 'Keep me')
  assert.equal((await readProposal(message, result.proposal)).status, 'proposed')
  f.settings.promptCompositions.summarize.systemPrompt = '[DELAY_MS:100]'
  await db.saveBookAiSettings(f.book.id, f.settings)
  const controller = new AbortController()
  const pending = applyChatEntityAction(message.id, result.proposal.id, controller.signal)
  const timeout = setTimeout(() => controller.abort(), 30)
  await assert.rejects(pending)
  clearTimeout(timeout)
  assert.equal((await db.getEntity(summary.id)).content, 'Keep me')
  assert.equal((await readProposal(message, result.proposal)).status, 'proposed')
})

test('a newer summary edit is preserved when generation finishes', async () => {
  const f = await fixture()
  f.settings.promptCompositions.summarize.systemPrompt = '[DELAY_MS:10]'
  await db.saveBookAiSettings(f.book.id, f.settings)
  const summary = await db.getOrCreateSummary(f.scene)
  const pending = regenerateEntitySummary(f.book.id, f.scene.id, new AbortController().signal)
  await new Promise((resolve) => setTimeout(resolve, 20))
  await db.saveSummaryContent(summary.id, 'Newer manual edit', 1)
  await assert.rejects(pending, /summary changed/)
  assert.equal((await db.getEntity(summary.id)).content, 'Newer manual edit')
})

test('summary commit checks that the approving message still exists', async () => {
  const f = await fixture()
  f.settings.promptCompositions.summarize.systemPrompt = '[DELAY_MS:10]'
  await db.saveBookAiSettings(f.book.id, f.settings)
  const summary = await db.getOrCreateSummary(f.scene)
  await db.saveSummaryContent(summary.id, 'Keep after message deletion', 1)
  const result = await execute(f.book.id, 'propose_summary_regeneration', { entity_id: f.scene.id })
  const message = await persist(f, result.proposal)
  const pending = applyChatEntityAction(message.id, result.proposal.id)
  await new Promise((resolve) => setTimeout(resolve, 20))
  await db.deleteEntityTree(message.id)
  await assert.rejects(pending)
  assert.equal((await db.getEntity(summary.id)).content, 'Keep after message deletion')
})


test('scene settings inherit live defaults, isolate fields and reject stale or cross-book proposals', async () => {
  const f = await fixture()
  await db.updateEntityAtomically(f.book.id, (book) => ({ ...book, pointOfView: 'Third', tense: 'Past', language: 'English' }))
  const initial = await execute(f.book.id, 'read_scene_settings', { entity_id: f.scene.id })
  assert.equal(initial.effective.pov.value, 'Third')
  assert.equal(initial.effective.pov.origin, 'Book default')
  const proposed = await execute(f.book.id, 'propose_scene_settings_update', { entity_id: f.scene.id, changes: { pov: 'First', language: 'French' } })
  assert.equal((await execute(f.book.id, 'read_scene_settings', { entity_id: f.scene.id })).effective.pov.value, 'Third')
  await approve(f, proposed.proposal)
  await db.updateEntityAtomically(f.book.id, (book) => ({ ...book, pointOfView: 'Second', tense: 'Present' }))
  const changed = await execute(f.book.id, 'read_scene_settings', { entity_id: f.scene.id })
  assert.equal(changed.effective.pov.value, 'First')
  assert.equal(changed.effective.tense.value, 'Present')
  const reset = await execute(f.book.id, 'propose_scene_settings_update', { entity_id: f.scene.id, changes: { pov: '' } })
  await approve(f, reset.proposal)
  const inherited = await execute(f.book.id, 'read_scene_settings', { entity_id: f.scene.id })
  assert.equal(inherited.effective.pov.value, 'Second')
  assert.equal(inherited.effective.language.value, 'French')
  const stale = await execute(f.book.id, 'propose_scene_settings_update', { entity_id: f.scene.id, changes: { language: 'German' } })
  await db.updateEntityAtomically(f.scene.id, (scene) => ({ ...scene, language: 'Spanish' }))
  await assert.rejects(() => approve(f, stale.proposal), /changed/)
  assert.equal((await execute(f.book.id, 'propose_scene_settings_update', { entity_id: f.scene.id, changes: { title: 'No' } })).ok, false)
  const { encodeBookArchive, decodeBookArchive, copyBookArchive } = await import('../src/book-archive.ts')
  const archived = await decodeBookArchive(encodeBookArchive(await db.readBookArchive(f.book.id)))
  const copied = copyBookArchive(archived)
  const sceneCopy = copied.data.entities.find((entity) => entity.type === 'scene')
  assert.equal(sceneCopy.language, 'Spanish')
  assert.equal(sceneCopy.pov, '')
  assert.notEqual(sceneCopy.id, f.scene.id)
  const other = await fixture()
  assert.equal((await execute(other.book.id, 'read_scene_settings', { entity_id: f.scene.id })).ok, false)
})

import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import 'fake-indexeddb/auto'
import { transpileSourceTree } from './transpile-source-tree.mjs'
import { assignBookTestProfiles } from './settings-profile-fixture.mjs'

const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'https://arc.test/', pretendToBeVisual: true })
after(() => dom.window.close())
for (const key of ['window', 'document', 'HTMLElement', 'localStorage', 'sessionStorage', 'Event', 'CustomEvent']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const directory = mkdtempSync(new URL('../node_modules/.world-ai-integration-', import.meta.url))
after(() => rmSync(directory, { recursive: true, force: true }))
transpileSourceTree(directory)
const moduleAt = name => import(pathToFileURL(`${directory}/${name}.mjs`))
const p = await moduleAt('data/persistence')
after(async () => (await p.database()).close())
const w = await moduleAt('features/worlds/world-service')
const ai = await moduleAt('shared/ai/ai-settings')
const profiles = await moduleAt('features/settings/settings-profiles')
const fake = await moduleAt('shared/ai/fake-provider')
const chats = await moduleAt('features/chat/chat-service')
const workspaceTools = await moduleAt('features/chat/chat-tools')
const managementTools = await moduleAt('features/chat/chat-management-tools')
const entityTools = await moduleAt('features/chat/chat-entity-tools')
const summaryGeneration = await moduleAt('features/writing/summary-generation')
const summaries = await moduleAt('features/writing/summary-service')
const characterContext = await moduleAt('features/chat/character-context')
const timeline = await moduleAt('features/codex/codex-timeline')
const timelineService = await moduleAt('features/codex/codex-timeline-service')
const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: CodexTemplates } = await moduleAt('features/codex/CodexTemplates')
const call = (name, args) => ({ id: crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } })
const profile = { includeLastScene: false, includePreviousSceneWhenEmpty: false, structuralIds: [], noteIds: [], codexEntryIds: [], summaryRange: 'none', loreAtCurrentScene: false }

async function fixture() {
  const db = await p.database()
  const world = await w.createWorld('AI canonical World')
  const foreignWorld = await w.createWorld('Other AI World')
  const series = await p.createSeries(`AI chronology ${crypto.randomUUID()}`)
  const settings = { ...ai.copyAiSettings(ai.initialAiSettings), provider: 'fake', supportModel: 'fake/test', supportModelContextLength: 100000, supportThinkingEffort: 'low' }
  settings.promptCompositions.summarize.systemPrompt = 'Summarize for {{book.title}}. [DELAY_MS:0]'
  const books = []
  for (const [title, worldId, order] of [['Prior AI Book', world.id, '1'], ['Requesting AI Book', world.id, '2'], ['Same Series, foreign World', foreignWorld.id, '3']]) {
    const created = await p.createBook(settings, title)
    await w.setBookWorld(created.book.id, worldId)
    await db.table('entities').update(created.book.id, { seriesId: series.id, seriesOrder: order })
    books.push({ ...created, book: await p.getEntity(created.book.id) })
  }
  const [prior, current, foreignBook] = books
  await assignBookTestProfiles({ persistence: p, ai, profiles }, current.book.id, settings, ['text', 'summary'])
  const entry = await p.createCodexEntry(world.id, 'Canonical AI traveler', 'Character')
  await p.saveDocumentContent(entry.id, 'Canonical AI baseline.')
  const foreign = await p.createCodexEntry(foreignWorld.id, 'Foreign AI traveler', 'Character')
  const local = await p.createCodexEntry(current.book.id, 'Local AI lore')
  const chat = await chats.createChat(current.book.id)
  return { db, world, foreignWorld, prior, current, foreignBook, entry: await p.getEntity(entry.id), foreign, local, chat, settings }
}
async function execute(module, bookId, name, args) {
  const result = await module(bookId, call(name, args))
  return { ...result, value: JSON.parse(result.content) }
}
async function approvalMessage(f, proposal) {
  assert.ok(proposal, 'An approval proposal was returned')
  return chats.createChatMessage(f.chat, 'assistant', '', { entityActions: [proposal] })
}
async function approve(f, proposal, signal = new AbortController().signal) {
  const message = await approvalMessage(f, proposal)
  await entityTools.applyChatEntityAction(message.id, proposal.id, signal)
  return message
}
async function settle(predicate) {
  for (let i = 0; i < 100 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 5))
  assert.ok(predicate(), 'The delayed provider request started')
}
function generation(t, start) {
  const controller = new AbortController()
  let pending
  t.after(async () => { controller.abort(); await pending?.catch(() => undefined) })
  pending = start(controller.signal)
  pending.catch(() => undefined)
  return pending
}

test('chat reads and edits canonical World entries without Series snapshots or Book overrides', async () => {
  const f = await fixture(), bookId = f.current.book.id
  const read = await execute(workspaceTools.executeChatWorkspaceTool, bookId, 'read_entity', { entity_id: f.entry.id })
  assert.equal(read.value.ok, true)
  assert.equal(read.value.entity.content, 'Canonical AI baseline.')
  const proposed = await execute(workspaceTools.executeChatWorkspaceTool, bookId, 'propose_document_edit', { entity_id: f.entry.id, expected_updated_at: f.entry.updatedAt, edits: [{ old_text: 'baseline', new_text: 'updated canon' }] })
  assert.equal(proposed.value.ok, true)
  const message = await chats.createChatMessage(f.chat, 'assistant', '', { documentEdits: [proposed.proposal] })
  await workspaceTools.applyChatDocumentEdit(message.id, proposed.proposal.id)
  const canonical = await p.getEntity(f.entry.id)
  assert.equal(canonical.bookId, f.world.id)
  assert.equal(canonical.worldId, f.world.id)
  assert.equal(canonical.content, 'Canonical AI updated canon.')
  assert.equal(canonical.codexScope, undefined)
  assert.equal(canonical.seriesSourceId, undefined)
  assert.equal((await p.listEntitiesByBook(f.prior.book.id, 'codexEntry')).find(entry => entry.id === f.entry.id)?.content, canonical.content)
  const owned = await f.db.table('entities').where('bookId').equals(bookId).toArray()
  assert.equal(owned.some(entry => entry.seriesSourceId === f.entry.id || entry.title === f.entry.title), false)
  assert.ok((await p.listSnapshots(f.entry.id)).length > 0)
  assert.equal((await p.getEntity(message.id)).bookId, bookId)
  assert.equal((await p.getEntity(f.chat.id)).bookId, bookId)
})

test('hidden, foreign and disconnected World entries cannot be read or approved; Scenes stay Book-local', async () => {
  const f = await fixture(), bookId = f.current.book.id
  for (const id of [f.foreign.id, f.prior.scene.id, f.foreignBook.scene.id]) {
    assert.equal((await execute(workspaceTools.executeChatWorkspaceTool, bookId, 'read_entity', { entity_id: id })).value.ok, false)
  }
  const proposed = await execute(workspaceTools.executeChatWorkspaceTool, bookId, 'propose_document_replacement', { entity_id: f.entry.id, expected_updated_at: f.entry.updatedAt, new_content: 'Must not be saved.' })
  assert.equal(proposed.value.ok, true)
  const message = await chats.createChatMessage(f.chat, 'assistant', '', { documentEdits: [proposed.proposal] })
  await w.setWorldEntryHidden(bookId, f.entry.id, true)
  assert.equal((await execute(workspaceTools.executeChatWorkspaceTool, bookId, 'read_entity', { entity_id: f.entry.id })).value.ok, false)
  await assert.rejects(() => workspaceTools.applyChatDocumentEdit(message.id, proposed.proposal.id), /not found|unavailable/)
  assert.equal((await p.getEntity(message.id)).documentEdits[0].status, 'stale')
  assert.equal((await p.getEntity(f.entry.id)).content, 'Canonical AI baseline.')
  await w.setBookWorld(bookId, f.foreignWorld.id)
  assert.equal((await execute(workspaceTools.executeChatWorkspaceTool, bookId, 'read_entity', { entity_id: f.entry.id })).value.ok, false)
})

test('character chat creation accepts only visible connected canonical participants and Book-owned cutoffs', async () => {
  const f = await fixture(), bookId = f.current.book.id
  const initial = entryId => ({ character: { sessionId: crypto.randomUUID(), participants: [{ entryId, label: 'Traveler', token: 'speaker-traveler' }], cutoff: { bookId, sceneId: f.current.scene.id, position: 0 } }, contextProfile: profile })
  const chat = await chats.createChat(bookId, 'World participant', 'character', initial(f.entry.id))
  assert.equal(chat.character.participants[0].entryId, f.entry.id)
  assert.equal(chat.bookId, bookId)
  assert.equal(chat.parentId, bookId)
  assert.equal(chat.worldId, undefined)
  await assert.rejects(() => chats.createChat(bookId, 'Foreign participant', 'character', initial(f.foreign.id)), /selected character/)
  const foreignCutoff = initial(f.entry.id)
  foreignCutoff.character.cutoff.sceneId = f.prior.scene.id
  await assert.rejects(() => chats.createChat(bookId, 'Foreign scene', 'character', foreignCutoff), /position changed/)
  await w.setWorldEntryHidden(bookId, f.entry.id, true)
  await assert.rejects(() => chats.createChat(bookId, 'Hidden participant', 'character', initial(f.entry.id)), /selected character/)
})

test('World management triggers and directional dependencies edit canonical owners with stale and visibility guards', async () => {
  const f = await fixture(), bookId = f.current.book.id
  const target = await p.createCodexEntry(f.world.id, 'World AI dependency')
  const triggers = await execute(managementTools.executeChatManagementTool, bookId, 'propose_codex_triggers', { entity_id: f.entry.id, triggers: ['  traveler  '] })
  assert.equal(triggers.value.ok, true)
  await approve(f, triggers.entityAction)
  assert.deepEqual((await p.getEntity(f.entry.id)).autoIncludeTriggers, ['traveler'])
  const args = { entity_id: f.entry.id, target_id: target.id }
  const create = await execute(managementTools.executeChatManagementTool, bookId, 'propose_codex_dependency', { ...args, action: 'create', relation_label: 'Knows' })
  await approve(f, create.entityAction)
  let edge = (await p.listCodexDependencies(bookId)).find(edge => edge.sourceId === f.entry.id)
  assert.equal(edge.bookId, f.world.id)
  const update = await execute(managementTools.executeChatManagementTool, bookId, 'propose_codex_dependency', { ...args, action: 'update', include_with_source: false })
  await approve(f, update.entityAction)
  edge = (await p.listCodexDependencies(bookId)).find(current => current.id === edge.id)
  assert.equal(edge.includeWithSource, false)
  const stale = await execute(managementTools.executeChatManagementTool, bookId, 'propose_codex_dependency', { ...args, action: 'remove' })
  await p.updateCodexDependency(edge.id, { relationLabel: 'Changed elsewhere' })
  await assert.rejects(() => approve(f, stale.entityAction), /dependency changed/)
  const remove = await execute(managementTools.executeChatManagementTool, bookId, 'propose_codex_dependency', { ...args, action: 'remove' })
  await approve(f, remove.entityAction)
  assert.equal((await p.listCodexDependencies(bookId)).some(edge => edge.sourceId === f.entry.id), false)
  assert.equal((await execute(managementTools.executeChatManagementTool, bookId, 'propose_codex_dependency', { entity_id: f.entry.id, target_id: f.local.id, action: 'create' })).value.ok, false)
  const hidden = await execute(managementTools.executeChatManagementTool, bookId, 'propose_codex_triggers', { entity_id: f.entry.id, triggers: ['Denied'] })
  await w.setWorldEntryHidden(bookId, f.entry.id, true)
  await assert.rejects(() => approve(f, hidden.entityAction), /unavailable/)
  assert.deepEqual((await p.getEntity(f.entry.id)).autoIncludeTriggers, ['traveler'])
})

test('summary preparation and approved regeneration use requesting Book settings and save the World summary once', async t => {
  const f = await fixture(), bookId = f.current.book.id
  const summary = await p.getOrCreateSummary(f.entry)
  await p.saveSummaryContent(summary.id, 'Previous canonical summary.', f.entry.sourceRevision)
  const existing = await p.getEntity(summary.id)
  const prepared = await summaryGeneration.prepareSummaryGeneration(f.current.book, existing, new AbortController().signal)
  assert.equal(prepared.action, 'resummarize')
  const text = prepared.messages.map(message => message.content).join('\n')
  assert.match(text, /Requesting AI Book/)
  assert.match(text, /Previous canonical summary/)
  assert.match(text, /Canonical AI baseline/)
  const proposed = await execute(managementTools.executeChatManagementTool, bookId, 'propose_summary_regeneration', { entity_id: f.entry.id })
  fake.clearFakeProviderTrace()
  const pending = generation(t, signal => approve(f, proposed.entityAction, signal))
  const message = await pending
  const saved = await p.getEntity(summary.id)
  assert.equal(saved.bookId, f.world.id)
  assert.equal(saved.worldId, f.world.id)
  assert.ok(saved.content.trim())
  assert.equal((await p.getEntity(message.id)).entityActions[0].status, 'applied')
  const trace = fake.getFakeProviderTrace().at(-1)
  assert.equal(trace.task, 'summary')
  assert.equal(trace.model, 'fake/test')
  assert.equal(trace.thinkingEffort, 'low')
  assert.ok((await p.listSnapshots(summary.id)).some(snapshot => snapshot.content === 'Previous canonical summary.'))
  const read = await execute(managementTools.executeChatManagementTool, f.prior.book.id, 'read_summary', { entity_id: f.entry.id })
  assert.equal(read.value.ok, true)
  assert.equal(read.value.content, saved.content)
  assert.equal(read.value.state, 'current')
  assert.equal((await f.db.table('entities').where('bookId').equals(f.world.id).toArray()).some(entity => entity.type === 'settings'), false)
  await assert.rejects(() => summaries.buildSummarySource(f.prior.scene.id, bookId), /unavailable/)
  await assert.rejects(() => summaryGeneration.regenerateEntitySummary(bookId, f.prior.scene.id, new AbortController().signal), /unavailable/)
  await assert.rejects(() => summaryGeneration.prepareSummaryGeneration(f.foreignBook.book, saved, new AbortController().signal), /unavailable/)
  await w.setWorldEntryHidden(bookId, f.entry.id, true)
  await assert.rejects(() => summaryGeneration.prepareSummaryGeneration(f.current.book, saved, new AbortController().signal), /unavailable/)
  assert.equal((await execute(managementTools.executeChatManagementTool, bookId, 'read_summary', { entity_id: f.entry.id })).value.ok, false)
})

test('summary preparation rechecks live Book visibility after delayed model metadata lookup', async t => {
  const f = await fixture(), summary = await p.getOrCreateSummary(f.entry)
  const settings = { ...f.settings, provider: 'nanogpt', apiKey: 'test-only-key', baseUrl: 'https://summary-catalog.invalid/v1', supportModel: 'catalog-model', supportModelContextLength: undefined }
  await assignBookTestProfiles({ persistence: p, ai, profiles }, f.current.book.id, settings, ['text', 'summary'])
  let release, requested = false, pending
  const catalog = new Promise(resolve => { release = resolve })
  const controller = new AbortController()
  t.after(async () => {
    controller.abort()
    release(Response.json({ data: [{ id: 'catalog-model', context_length: 100000 }] }))
    await pending?.catch(() => undefined)
  })
  t.mock.method(globalThis, 'fetch', async () => { requested = true; return catalog })
  pending = summaryGeneration.prepareSummaryGeneration(f.current.book, summary, controller.signal)
  pending.catch(() => undefined)
  await settle(() => requested)
  await w.setWorldEntryHidden(f.current.book.id, f.entry.id, true)
  release(Response.json({ data: [{ id: 'catalog-model', context_length: 100000 }] }))
  await assert.rejects(() => pending, /unavailable/)
  assert.equal((await p.getEntity(summary.id)).content, '')
})

for (const mutation of ['hide', 'disconnect', 'archive', 'source', 'summary', 'approval']) {
  test(`summary generation preserves canonical content when ${mutation} changes while streaming`, async t => {
    const f = await fixture(), bookId = f.current.book.id
    const settings = { ...f.settings, provider: 'nanogpt', apiKey: 'test-only-key', baseUrl: 'https://summary-stream.invalid/v1', supportModel: 'test-summary-stream' }
    await assignBookTestProfiles({ persistence: p, ai, profiles }, bookId, settings, ['text', 'summary'])
    await p.saveDocumentContent(f.entry.id, 'Canonical source.')
    const entry = await p.getEntity(f.entry.id), summary = await p.getOrCreateSummary(entry)
    await p.saveSummaryContent(summary.id, 'Kept canonical summary.', entry.sourceRevision)
    const proposed = await execute(managementTools.executeChatManagementTool, bookId, 'propose_summary_regeneration', { entity_id: entry.id })
    assert.equal(proposed.value.ok, true)
    const message = await approvalMessage(f, proposed.entityAction)
    const encoder = new TextEncoder()
    let source, reading = false, settled = false
    const stream = new ReadableStream({
      start(controller) {
        source = controller
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Partial generated summary."}}]}\n\n'))
      },
      // The queued chunk fills the stream; pull signals that the provider reader consumed it.
      pull() { reading = true },
    })
    t.after(async () => {
      source.error(new Error('Test stream cleanup'))
      if (!stream.locked) await stream.cancel().catch(() => undefined)
    })
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      assert.equal(String(url), 'https://summary-stream.invalid/v1/chat/completions')
      assert.equal(JSON.parse(init.body).model, 'test-summary-stream')
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
    })
    const pending = generation(t, signal => entityTools.applyChatEntityAction(message.id, proposed.entityAction.id, signal))
    pending.then(() => { settled = true }, () => { settled = true })
    await settle(() => reading || settled)
    if (settled) {
      await pending // Surface an early service rejection instead of masking it with a polling timeout.
      assert.fail('Generation completed before the provider stream was released')
    }
    assert.equal(reading, true)
    if (mutation === 'hide') await w.setWorldEntryHidden(bookId, entry.id, true)
    if (mutation === 'disconnect') await w.setBookWorld(bookId, f.foreignWorld.id)
    if (mutation === 'archive') await p.archiveCodexEntry(entry.id)
    if (mutation === 'source') await p.saveDocumentContent(entry.id, 'Changed authoritative source.')
    if (mutation === 'summary') await p.saveSummaryContent(summary.id, 'Newer canonical summary.', entry.sourceRevision)
    if (mutation === 'approval') await p.deleteEntity(message.id)
    assert.equal(settled, false, 'Generation is still in flight while the guarded state changes')
    source.enqueue(encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'))
    source.close()
    await assert.rejects(() => pending, /unavailable|archived|changed|approval|missing entity/)
    assert.equal((await p.getEntity(summary.id)).content, mutation === 'summary' ? 'Newer canonical summary.' : 'Kept canonical summary.')
    assert.equal((await p.listSnapshots(summary.id)).length, 0, 'Failed generation does not create a snapshot')
  })
}

test('character selections merge World summaries and resolve only requesting-Book-accessible chronology', async () => {
  const f = await fixture(), bookId = f.current.book.id
  const summary = await p.getOrCreateSummary(f.entry)
  await p.saveSummaryContent(summary.id, 'Canonical selected summary.', f.entry.sourceRevision)
  await p.updateCodexSummaryPreference(f.entry.id, true)
  const point = (book, scene, content) => ({ id: crypto.randomUUID(), label: content, anchorBookId: book.id, sceneId: scene.id, content, revision: 1 })
  await f.db.table('entities').update(f.entry.id, { checkpoints: [point(f.prior.book, f.prior.scene, 'Visible prior checkpoint.'), point(f.foreignBook.book, f.foreignBook.scene, 'Foreign checkpoint must not leak.')] })
  const cutoff = { bookId, sceneId: f.current.scene.id, position: 0 }
  let world = await timelineService.readTimelineWorld(bookId)
  const all = await f.db.table('entities').toArray()
  const selected = { ...profile, codexEntryIds: [f.entry.id, f.foreign.id, f.local.id], structuralIds: [f.prior.scene.id], summaryRange: 'all' }
  let sources = characterContext.characterAdditionalSources(all, selected, cutoff, world)
  assert.equal(sources.find(source => source.entityId === f.entry.id)?.content, 'Canonical selected summary.')
  assert.equal(sources.some(source => source.entityId === f.foreign.id || source.entityId === f.prior.scene.id), false)
  sources = characterContext.characterAdditionalSources(all, { ...selected, loreAtCurrentScene: true }, cutoff, world)
  assert.equal(sources.find(source => source.entityId === f.entry.id)?.content, 'Visible prior checkpoint.')
  const resolved = timeline.resolveCodexState(await p.getEntity(f.entry.id), cutoff, world, 'strict')
  await f.db.table('entities').update(f.entry.id, { timelineSummaries: [{ checkpointId: resolved.checkpointId, sourceText: resolved.content, orderSignature: resolved.orderSignature, mode: 'strict', content: 'Eligible timeline summary.' }] })
  const withTimeline = await f.db.table('entities').toArray()
  sources = characterContext.characterAdditionalSources(withTimeline, { ...selected, loreAtCurrentScene: true }, cutoff, world)
  assert.equal(sources.find(source => source.entityId === f.entry.id)?.content, 'Eligible timeline summary.')
  const malformed = { ...f.entry, bookId: bookId }
  assert.equal(characterContext.characterAdditionalSources([malformed], selected, cutoff, world).length, 0)
  await w.setWorldEntryHidden(bookId, f.entry.id, true)
  world = await timelineService.readTimelineWorld(bookId)
  assert.equal(characterContext.characterAdditionalSources(withTimeline, selected, cutoff, world).some(source => source.entityId === f.entry.id), false)
})

test('World template messaging describes direct canonical saves and these AI paths never synchronize Series codex', async t => {
  const f = await fixture()
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await React.act(async () => root.unmount()) })
  await React.act(async () => {
    root.render(React.createElement(CodexTemplates, { bookId: f.current.book.id, targetId: f.entry.id, typeId: f.entry.typeId, body: '', editor: { current: null } }))
    await new Promise(resolve => setTimeout(resolve, 20))
  })
  for (let i = 0; i < 100 && !document.body.textContent.includes('saved directly to the World'); i++) await React.act(async () => new Promise(resolve => setTimeout(resolve, 5)))
  assert.match(document.body.textContent, /saved directly to the World/)
  assert.doesNotMatch(document.body.textContent, /Save series changes|inheriting books/)
  for (const path of ['chat/chat-service.ts', 'chat/chat-tools.ts', 'chat/chat-management-tools.ts', 'chat/character-context.ts', 'writing/summary-generation.ts', 'codex/CodexTemplates.tsx']) {
    assert.doesNotMatch(readFileSync(new URL(`../src/features/${path}`, import.meta.url), 'utf8'), /synchronizeSeriesCodex/)
  }
})

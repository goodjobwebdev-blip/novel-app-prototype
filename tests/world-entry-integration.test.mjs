import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import 'fake-indexeddb/auto'
import { transpileSourceTree } from './transpile-source-tree.mjs'
import { assignBookTestProfiles } from './settings-profile-fixture.mjs'

const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'https://arc.test/', pretendToBeVisual: true })
after(() => dom.window.close())
for (const key of ['window', 'document', 'HTMLElement', 'HTMLDialogElement', 'localStorage', 'sessionStorage', 'Event', 'CustomEvent']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const directory = mkdtempSync(new URL('../node_modules/.world-entry-integration-', import.meta.url))
after(() => rmSync(directory, { recursive: true, force: true }))
transpileSourceTree(directory)
const moduleAt = name => import(pathToFileURL(`${directory}/${name}.mjs`))
const p = await moduleAt('data/persistence')
after(async () => (await p.database()).close())
const w = await moduleAt('features/worlds/world-service')
const timeline = await moduleAt('features/codex/codex-timeline')
const timelineService = await moduleAt('features/codex/codex-timeline-service')
const templates = await moduleAt('features/codex/codex-templates')
const summaries = await moduleAt('features/writing/summary-service')
const entityTools = await moduleAt('features/chat/chat-entity-tools')
const chats = await moduleAt('features/chat/chat-service')
const characters = await moduleAt('features/chat/character-chat')
const lore = await moduleAt('features/codex/lore-types-service')
const ai = await moduleAt('shared/ai/ai-settings')
const profiles = await moduleAt('features/settings/settings-profiles')
const fake = await moduleAt('shared/ai/fake-provider')
const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { act } = React
const { RoleplayParticipant } = await moduleAt('features/chat/CharacterChatControls')
const { default: CodexTimeline } = await moduleAt('features/codex/CodexTimeline')
const h = React.createElement
const call = (name, args) => ({ id: crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } })
const ids = entities => entities.map(entity => entity.id).sort()

async function fixture() {
  const db = await p.database(), world = await w.createWorld('Canonical World'), otherWorld = await w.createWorld('Unrelated World')
  const series = await p.createSeries('Chronology, not ownership')
  const books = []
  for (const [title, worldId, order, inSeries] of [
    ['Prior book', world.id, '1', true], ['Requesting book', world.id, '2', true],
    ['Same series, other World', otherWorld.id, '3', true], ['Same World, other chronology', world.id, '', false],
  ]) {
    const created = await p.createBook(ai.initialAiSettings, title)
    await w.setBookWorld(created.book.id, worldId)
    await db.table('entities').update(created.book.id, { seriesId: inSeries ? series.id : '', seriesOrder: order })
    books.push({ book: await p.getEntity(created.book.id), scene: created.scene })
  }
  const [prior, current, unrelated, otherChronology] = books
  const entry = await p.createCodexEntry(world.id, 'Canonical traveler', 'Other')
  await p.saveDocumentContent(entry.id, 'Canonical baseline. <!-- private fact -->')
  const local = await p.createCodexEntry(current.book.id, 'Book-local lore')
  const foreign = await p.createCodexEntry(otherWorld.id, 'Foreign canonical')
  return { db, world, otherWorld, series, prior, current, unrelated, otherChronology, entry: await p.getEntity(entry.id), local, foreign }
}
function point(book, scene, content, label = content) {
  return { id: crypto.randomUUID(), label, anchorBookId: book.id, sceneId: scene.id, content, revision: Date.now() }
}
async function settle(predicate, message) {
  for (let i = 0; i < 100 && !predicate(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 10)))
  assert.ok(predicate(), message)
}
function button(text) { return [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text) }
function createTestRoot(t) {
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await act(async () => root.unmount()) })
  return root
}

// Services receive the canonical ID, never a Series proxy or a Book override.
test('World checkpoints write one canonical entry and use Series only to order visible connected books', async () => {
  const f = await fixture(), { book, scene } = f.current
  const previous = point(f.prior.book, f.prior.scene, 'State from prior book')
  const here = point(book, scene, 'State from requesting book')
  const saved = await timelineService.saveCodexCheckpoints(book.id, f.entry.id, [], [previous, here])
  assert.equal(saved.bookId, f.world.id)
  assert.equal(saved.worldId, f.world.id)
  assert.equal(saved.codexScope, undefined)
  assert.equal(saved.seriesSourceId, undefined)
  assert.equal((await timelineService.resolveEntryAt(saved.id, { bookId: book.id, sceneId: scene.id })).content, here.content)
  assert.equal((await timelineService.resolveEntryAt(saved.id, { bookId: f.prior.book.id, sceneId: f.prior.scene.id })).content, previous.content)
  assert.equal((await p.listEntitiesByBook(book.id, 'codexEntry')).filter(entity => entity.id === saved.id).length, 1)
  assert.deepEqual(ids(await p.listEntitiesByBook(book.id, 'codexEntry')), ids([f.entry, f.local]))
  assert.equal((await f.db.table('entities').where('type').equals('codexEntry').toArray()).some(entity => entity.seriesSourceId === saved.id), false)

  const onlyPrevious = await timelineService.saveCodexCheckpoints(book.id, saved.id, saved.checkpoints, [saved.checkpoints[0]])
  const before = await timelineService.readTimelineWorld(book.id)
  assert.equal(timeline.resolveCodexState(onlyPrevious, { bookId: book.id, sceneId: scene.id }, before).content, previous.content)
  const legacySnapshot = { ...f.local, seriesSourceId: 'legacy-source', checkpoints: [previous] }
  assert.equal(timeline.resolveCodexState(legacySnapshot, { bookId: book.id, sceneId: scene.id }, before).content, previous.content)
  await w.setWorldEntryHidden(f.prior.book.id, saved.id, true)
  const afterHiding = await timelineService.readTimelineWorld(book.id)
  assert.notEqual(timeline.timelineOrderSignature(afterHiding), timeline.timelineOrderSignature(before))
  assert.equal(timeline.resolveCodexState(onlyPrevious, { bookId: book.id, sceneId: scene.id }, afterHiding).checkpointId, 'baseline')
  assert.equal(timeline.checkpointBookAvailable(onlyPrevious, f.prior.book.id, book.id, afterHiding), false)
  for (const anchor of [f.prior, f.unrelated, f.otherChronology]) {
    await assert.rejects(() => timelineService.saveCodexCheckpoints(book.id, saved.id, onlyPrevious.checkpoints, [...onlyPrevious.checkpoints, point(anchor.book, anchor.scene, 'Disallowed anchor')]), /visible connected World/)
  }
  await assert.rejects(() => timelineService.saveCodexCheckpoints(book.id, f.local.id, [], [point(f.prior.book, f.prior.scene, 'Local entries cannot cross books')]), /visible connected World/)
  await f.db.table('entities').update(f.prior.book.id, { hiddenWorldEntryIds: [], seriesOrder: '' })
  await assert.rejects(() => timelineService.resolveEntryAt(saved.id, { bookId: book.id, sceneId: scene.id }), /distinct numeric series order/)
})

test('timeline reads, writes and request snapshots reject hidden, unrelated and malformed World ownership', async () => {
  const f = await fixture(), { book, scene } = f.current
  const cutoff = { bookId: book.id, sceneId: scene.id }
  await assert.rejects(() => timelineService.resolveEntryAt(f.foreign.id, cutoff), /unavailable/)
  await assert.rejects(() => timelineService.saveCodexCheckpoints(f.unrelated.book.id, f.entry.id, [], []), /unavailable/)
  await assert.rejects(() => timelineService.resolveEntryAt(f.local.id, { bookId: f.prior.book.id, sceneId: f.prior.scene.id }), /unavailable/)
  const summary = await p.getOrCreateSummary(f.entry)
  await w.setWorldEntryHidden(book.id, f.entry.id, true)
  await assert.rejects(() => timelineService.resolveEntryAt(f.entry.id, cutoff), /unavailable/)
  await assert.rejects(() => timelineService.saveCodexCheckpoints(book.id, f.entry.id, [], []), /unavailable/)
  const world = await timelineService.readTimelineWorld(book.id)
  const resolved = timeline.resolveTimelineEntities([f.entry, summary, f.foreign, f.local], cutoff, world)
  assert.deepEqual(ids(resolved), [f.local.id])
  assert.throws(() => timeline.resolveCodexState({ ...f.entry, bookId: f.otherWorld.id }, cutoff, world), /unavailable/)
  assert.throws(() => timeline.resolveCodexState({ ...f.entry, bookId: f.world.id, worldId: f.otherWorld.id }, cutoff, world), /unavailable/)
  await w.setWorldEntryHidden(book.id, f.entry.id, false)
  await p.archiveCodexEntry(f.entry.id)
  await assert.rejects(() => timelineService.resolveEntryAt(f.entry.id, cutoff), /unavailable/)
  await assert.rejects(() => timelineService.saveCodexCheckpoints(book.id, f.entry.id, [], []), /archived/)
})

test('Book-local template Notes apply to World canonicals without shared-source authorization or metadata writes', async () => {
  const f = await fixture(), book = f.current.book
  const type = await lore.createLoreType(f.world.id, 'World magic')
  await p.updateCodexCategory(f.entry.id, type.id)
  await p.saveDocumentContent(f.entry.id, '')
  const note = await p.createNote(book.id, 'World entry template')
  await p.saveDocumentContent(note.id, '## Origin\n\nFill in the origin.')
  await templates.setNoteTemplateOptions(book.id, note.id, { useAsCodexTemplate: true, compatibleLoreTypeIds: [type.id] })
  const input = { bookId: book.id, noteId: note.id, targetId: f.entry.id, typeId: type.id }
  assert.deepEqual(ids(await templates.listCodexTemplates(book.id, type.id)), [note.id])
  const before = JSON.stringify(await p.getEntity(f.entry.id))
  let copied = ''
  const editor = { captureSelection: () => ({ document: '' }), replaceRange: (_snapshot, content) => { copied = content; return true } }
  await templates.applyCodexTemplate(input, () => editor)
  assert.equal(copied, '## Origin\n\nFill in the origin.')
  assert.equal(JSON.stringify(await p.getEntity(f.entry.id)), before)
  const foreignNote = await p.createNote(f.prior.book.id, 'Other book template')
  await assert.rejects(() => templates.prepareCodexTemplate({ ...input, noteId: foreignNote.id }), /current book/)
  await assert.rejects(() => templates.prepareCodexTemplate({ ...input, targetId: f.foreign.id, sharedSource: true }), /unavailable/)
  await assert.rejects(() => templates.prepareCodexTemplate({ ...input, targetId: f.series.id, sharedSource: true }), /unavailable/)
  await w.setWorldEntryHidden(book.id, f.entry.id, true)
  await assert.rejects(() => templates.prepareCodexTemplate({ ...input, sharedSource: true }), /unavailable/)
  await w.setWorldEntryHidden(book.id, f.entry.id, false)
  await assert.rejects(() => templates.prepareCodexTemplate({ ...input, typeId: 'lore-character' }), /type changed/)
})

test('chat entity approvals change the canonical source and recheck Book visibility before applying', async () => {
  const f = await fixture(), book = f.current.book
  const chat = await chats.createChat(book.id)
  const rename = await entityTools.executeChatEntityTool(book.id, call('propose_entity_rename', { entity_id: f.entry.id, new_title: 'Renamed World traveler' }))
  assert.equal(JSON.parse(rename.content).ok, true)
  const message = await chats.createChatMessage(chat, 'assistant', '', { entityActions: [rename.entityAction] })
  await entityTools.applyChatEntityAction(message.id, rename.entityAction.id)
  assert.equal((await p.getEntity(f.entry.id)).title, 'Renamed World traveler')
  assert.equal((await p.getEntity(f.entry.id)).bookId, f.world.id)
  assert.equal((await p.listEntitiesByBook(f.prior.book.id, 'codexEntry')).find(entity => entity.id === f.entry.id).title, 'Renamed World traveler')
  for (const [bookId, entityId] of [[f.unrelated.book.id, f.entry.id], [book.id, f.foreign.id], [f.prior.book.id, f.local.id]]) {
    const denied = await entityTools.executeChatEntityTool(bookId, call('propose_entity_rename', { entity_id: entityId, new_title: 'Denied' }))
    assert.equal(JSON.parse(denied.content).ok, false)
    assert.equal(denied.entityAction, undefined)
  }
  const localType = await lore.createLoreType(book.id, 'Private Book type')
  const category = await entityTools.executeChatEntityTool(book.id, call('propose_codex_category', { entity_id: f.entry.id, category: localType.id }))
  assert.equal(JSON.parse(category.content).ok, false, 'A canonical World cannot adopt a Book-private lore type')
  const worldType = await lore.createLoreType(f.world.id, 'Shared World type')
  const allowedCategory = await entityTools.executeChatEntityTool(book.id, call('propose_codex_category', { entity_id: f.entry.id, category: worldType.id }))
  assert.equal(JSON.parse(allowedCategory.content).ok, true)
  const categoryMessage = await chats.createChatMessage(chat, 'assistant', '', { entityActions: [allowedCategory.entityAction] })
  await entityTools.applyChatEntityAction(categoryMessage.id, allowedCategory.entityAction.id)
  assert.equal((await p.getEntity(f.entry.id)).typeId, worldType.id)
  const deletion = await entityTools.executeChatEntityTool(book.id, call('propose_entity_delete', { entity_id: f.entry.id }))
  const staleMessage = await chats.createChatMessage(chat, 'assistant', '', { entityActions: [deletion.entityAction] })
  await w.setWorldEntryHidden(book.id, f.entry.id, true)
  await assert.rejects(() => entityTools.applyChatEntityAction(staleMessage.id, deletion.entityAction.id), /current book/)
  assert.equal((await p.getEntity(staleMessage.id)).entityActions[0].status, 'stale')
  assert.ok(await p.getEntity(f.entry.id), 'A hidden canonical must not be deleted through a stale Book approval')
})

test('summary state and source builders include merged canonical summaries but honor requesting Book isolation', async () => {
  const f = await fixture(), book = f.current.book
  const summary = await p.getOrCreateSummary(f.entry)
  await p.saveSummaryContent(summary.id, 'Shared summary text', f.entry.sourceRevision ?? f.entry.updatedAt)
  await f.db.table('entities').update(f.entry.id, { preferSummaryForContext: true })
  const entry = await p.getEntity(f.entry.id), merged = await p.listEntitiesByBook(book.id)
  assert.equal((await summaries.getSummaryStateMap(book.id))[entry.id], 'current')
  assert.equal((await summaries.buildSummarySource(entry.id, book.id)).previousSummary, 'Shared summary text')
  assert.equal((await summaries.buildSummarySource(entry.id)).previousSummary, 'Shared summary text')
  const representation = summaries.codexContextRepresentation(entry, merged)
  assert.equal(representation.representation, 'Summary')
  assert.equal(representation.content, 'Shared summary text')
  const source = await summaries.buildSummarySource(entry.id, book.id)
  assert.match(source.content, /Canonical baseline/)
  assert.doesNotMatch(source.content, /private fact/)
  assert.equal((await summaries.getSummaryStateMap(book.id))[f.local.id], 'missing')
  await assert.rejects(() => summaries.buildSummarySource(entry.id, f.unrelated.book.id), /unavailable in this book/)
  await assert.rejects(() => summaries.buildSummarySource(f.local.id, f.prior.book.id), /unavailable in this book/)
  await w.setWorldEntryHidden(book.id, entry.id, true)
  assert.equal((await summaries.getSummaryStateMap(book.id))[entry.id], undefined)
  assert.equal((await summaries.getSummaryStateMap(f.prior.book.id))[entry.id], 'current')
  await assert.rejects(() => summaries.buildSummarySource(entry.id, book.id), /unavailable in this book/)
})

test('timeline summaries use requesting Book settings, save canonically and reject visibility changes during generation', async t => {
  const f = await fixture(), book = f.current.book
  const settings = { ...ai.copyAiSettings(ai.initialAiSettings), provider: 'fake', supportModel: 'fake/test', supportThinkingEffort: 'low' }
  await assignBookTestProfiles({ persistence: p, ai, profiles }, book.id, settings)
  fake.clearFakeProviderTrace()
  const controller = new AbortController()
  let pending, stream, streamSource
  t.after(async () => {
    controller.abort()
    streamSource?.error(new Error('Test stream cleanup'))
    if (stream && !stream.locked) await stream.cancel().catch(() => undefined)
    await pending?.catch(() => undefined)
  })
  await timelineService.generateTimelineSummary(book.id, f.entry.id, 'baseline', 'cutoff', controller.signal)
  const trace = fake.getFakeProviderTrace().at(-1)
  assert.equal(trace.task, 'summary')
  assert.equal(trace.model, 'fake/test')
  assert.equal(trace.thinkingEffort, 'low')
  const saved = await p.getEntity(f.entry.id)
  assert.equal(saved.bookId, f.world.id)
  assert.equal(saved.timelineSummaries.length, 1)
  assert.ok(saved.timelineSummaries[0].content.trim())
  assert.equal((await f.db.table('entities').where('bookId').equals(f.world.id).toArray()).some(entity => entity.type === 'settings'), false, 'A World is not an AI settings owner')
  await assert.rejects(() => timelineService.generateTimelineSummary(f.unrelated.book.id, f.entry.id, 'baseline', 'cutoff', controller.signal), /unavailable/)
  const cached = JSON.stringify(saved.timelineSummaries)
  await p.saveDocumentContent(f.entry.id, 'Known facts.')
  await assignBookTestProfiles({ persistence: p, ai, profiles }, book.id, {
    ...settings, provider: 'nanogpt', apiKey: 'test-only-key',
    baseUrl: 'https://timeline-summary-stream.invalid/v1', supportModel: 'test-timeline-summary-stream',
  })
  const encoder = new TextEncoder()
  let reading = false, settled = false
  stream = new ReadableStream({
    start(source) {
      streamSource = source
      source.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Partial generated summary."}}]}\n\n'))
    },
    // Fake traces record completion, not request start. Hold SSE open until the reader consumes this chunk.
    pull() { reading = true },
  })
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(String(url), 'https://timeline-summary-stream.invalid/v1/chat/completions')
    assert.equal(JSON.parse(init.body).model, 'test-timeline-summary-stream')
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
  })
  pending = timelineService.generateTimelineSummary(book.id, f.entry.id, 'baseline', 'cutoff', controller.signal)
  pending.then(() => { settled = true }, () => { settled = true })
  await settle(() => reading || settled, 'The captured summary stream started')
  if (settled) {
    await pending
    assert.fail('Generation completed before the provider stream was released')
  }
  assert.equal(reading, true)
  await w.setWorldEntryHidden(book.id, f.entry.id, true)
  assert.equal(settled, false, 'Generation remains in flight while Book visibility changes')
  streamSource.enqueue(encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'))
  streamSource.close()
  await assert.rejects(() => pending, /changed during generation|no longer available/)
  assert.equal(JSON.stringify((await p.getEntity(f.entry.id)).timelineSummaries), cached)
})

test('participant metadata writes the canonical ID and the checkpoint UI offers only visible connected chronology', async t => {
  const f = await fixture(), book = f.current.book
  const root = createTestRoot(t)
  let refreshed = 0
  const entry = await p.getEntity(f.entry.id)
  await act(async () => root.render(h(React.Fragment, null,
    h(RoleplayParticipant, { bookId: book.id, entry, onBeforeChange: async () => {}, onRefresh: async () => { refreshed++ }, onStart() {} }),
    h(CodexTimeline, { bookId: book.id, entry, currentSceneId: f.current.scene.id, onBeforeChange: async () => {}, onRefresh: async () => {} }),
  )))
  await settle(() => button('New checkpoint') && !button('New checkpoint').disabled, 'The canonical timeline is editable through its connected Book')
  await act(async () => document.querySelector('.roleplay-participant input[type="checkbox"]').click())
  await settle(() => refreshed === 1, 'Participant metadata was saved')
  const canonical = await p.getEntity(entry.id)
  assert.equal(canonical.roleplayParticipant, true)
  assert.equal(canonical.bookId, f.world.id)
  assert.equal(canonical.worldId, f.world.id)
  assert.equal(canonical.codexScope, undefined)
  assert.equal((await characters.listCharacterCandidates(book.id)).some(candidate => candidate.id === entry.id), true)
  assert.equal((await characters.listCharacterCandidates(f.unrelated.book.id)).some(candidate => candidate.id === entry.id), false)
  await act(async () => button('New checkpoint').click())
  await settle(() => Boolean(document.querySelector('select[aria-label="Checkpoint book"]')), 'The checkpoint anchor selector opened')
  const options = () => [...document.querySelector('select[aria-label="Checkpoint book"]').options].map(option => option.value).sort()
  assert.deepEqual(options(), [book.id, f.prior.book.id].sort())
  await act(async () => { await w.setWorldEntryHidden(f.prior.book.id, entry.id, true) })
  await settle(() => options().length === 1, 'World visibility updates refresh the checkpoint choices')
  assert.deepEqual(options(), [book.id])
  await act(async () => { await w.setWorldEntryHidden(book.id, entry.id, true) })
  await settle(() => document.querySelector('.codex-timeline fieldset')?.disabled === true, 'Hidden canonicals become read-only')
  assert.equal((await characters.listCharacterCandidates(book.id)).some(candidate => candidate.id === entry.id), false)
  await act(async () => document.querySelector('.roleplay-participant input[type="checkbox"]').click())
  await settle(() => Boolean(document.querySelector('.roleplay-participant [role="alert"]')), 'Hidden participant metadata changes are rejected')
  assert.equal((await p.getEntity(entry.id)).roleplayParticipant, true)
  assert.equal(refreshed, 1)
})

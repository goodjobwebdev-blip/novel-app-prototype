import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import 'fake-indexeddb/auto'
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) { const url = new URL(specifier + '.ts', context.parentURL); if (existsSync(fileURLToPath(url))) return nextResolve(url.href, context) }
  return nextResolve(specifier, context)
} })
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
const { prepareAutomaticBeat, beatPassage, bindBeatPassage, passageMarkers, sceneBeats } = await import('../src/scene-beats.ts')
const { proseText, encodeDocumentBlock } = await import('../src/document-projection.ts')
const { prepareSceneBeatRequest } = await import('../src/scene-beat-generation.ts')
const db = await import('../src/persistence.ts')
const { initialAiSettings, copyAiSettings } = await import('../src/ai-settings.ts')
const { executeChatManagementTool } = await import('../src/chat-management-tools.ts')
const { executeChatWorkspaceTool } = await import('../src/chat-tools.ts')
const { buildContextValues } = await import('../src/context-service.ts')
const { assembleChatGenerationRequest, defaultChatPromptComposition } = await import('../src/chat-request.ts')
const { copyBookArchive } = await import('../src/book-archive.ts')
const bookValues = { title: 'Test', series: '', seriesOrder: '', overview: '', genre: '', style: '', pov: '', tense: '', language: '' }
function call(name, args) { return { id: crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } } }

test('beat capture retries without duplication; stable markers track edits and reject damaged or overlapping ranges', () => {
  assert.equal(prepareAutomaticBeat('Story.', 6, '  ', 'unused'), null)
  const first = prepareAutomaticBeat('Before.\n\nAfter.', 9, 'CURRENT_BEAT', 'beat-one')
  const retry = prepareAutomaticBeat(first.source, first.position, 'CURRENT_BEAT', 'should-not-exist')
  assert.equal(retry.source, first.source)
  assert.equal(retry.beatId, 'beat-one')
  const completed = first.source.slice(0, first.position) + 'Generated prose.' + first.source.slice(first.position)
  const manuallyEdited = completed.replace('Generated prose.', 'Manually improved prose with more words.')
  const range = beatPassage(manuallyEdited, 'beat-one')
  assert.equal(manuallyEdited.slice(range.from, range.to).trim(), 'Manually improved prose with more words.')
  assert.doesNotMatch(proseText(manuallyEdited), /CURRENT_BEAT|arc:passage|beat-one/)
  const damaged = manuallyEdited.replace(passageMarkers(manuallyEdited).find((marker) => marker.edge === 'end') && manuallyEdited.slice(range.to, range.endTo), '')
  assert.equal(beatPassage(damaged, 'beat-one'), null)
  const from = damaged.indexOf('Manually'), to = from + 'Manually improved prose with more words.'.length
  const rebound = bindBeatPassage(damaged, 'beat-one', from, to)
  assert.equal(rebound.slice(beatPassage(rebound, 'beat-one').from, beatPassage(rebound, 'beat-one').to).trim(), 'Manually improved prose with more words.')
  assert.throws(() => prepareAutomaticBeat(manuallyEdited, range.from + 5, 'Another beat', 'two'), /after/)
  const next = prepareAutomaticBeat(manuallyEdited, range.to, 'Another beat', 'two')
  assert.equal(sceneBeats(next.source).length, 2)
  assert.ok(beatPassage(next.source, 'beat-one'))
})

test('beat requests include only the active instruction once, and Chat planning is typed and approval based', async () => {
  const settings = copyAiSettings(initialAiSettings); settings.provider = 'fake'; settings.mainModel = settings.supportModel = 'fake/test'; settings.mainModelContextLength = 100000
  const f = await db.createBook(settings, 'Beats test')
  const first = prepareAutomaticBeat('Before.\n\nAfter.', 9, 'CURRENT_BEAT', 'beat-one')
  const source = first.source.slice(0, first.position) + 'Old passage.' + first.source.slice(first.position) + '\n' + encodeDocumentBlock({ id: 'other', type: 'beat', text: 'OTHER_BEAT' })
  await db.saveDocumentContent(f.scene.id, source)
  const scene = await db.getEntity(f.scene.id), range = beatPassage(source, 'beat-one')
  const prepared = await prepareSceneBeatRequest({ bookId: f.book.id, book: bookValues, scene, source, from: range.from, to: range.to, instruction: 'CURRENT_BEAT' }, new AbortController().signal)
  const payload = prepared.request.providerMessages.map((message) => message.content).join('\n')
  assert.equal(payload.split('CURRENT_BEAT').length - 1, 1)
  assert.doesNotMatch(payload, /OTHER_BEAT|Old passage|arc:passage/)
  const read = JSON.parse((await executeChatWorkspaceTool(f.book.id, call('read_entity', { entity_id: scene.id }))).content)
  assert.doesNotMatch(read.entity.content, /CURRENT_BEAT|OTHER_BEAT/)
  assert.equal(read.entity.planningBlocks[0].type, 'scene_beat')
  assert.equal(read.entity.planningBlocks[0].text, 'CURRENT_BEAT')
  const context = await buildContextValues({ bookId: f.book.id, type: 'chat', currentSceneId: scene.id, profile: db.defaultGenerationContextProfile })
  const chat = assembleChatGenerationRequest({ composition: defaultChatPromptComposition, book: bookValues, context, history: [] })
  assert.ok(chat.providerMessages.some((message) => message.content.includes('Planning only') && message.content.includes('OTHER_BEAT')))
  const proposed = await executeChatManagementTool(f.book.id, call('propose_scene_beat', { entity_id: scene.id, text: 'PROPOSED_BEAT' }))
  assert.equal((await db.getEntity(scene.id)).content, source)
  await db.applyChatManagementChange(f.book.id, scene.id, proposed.entityAction.operation)
  assert.equal(proseText((await db.getEntity(scene.id)).content).trim(), proseText(source).trim())
  assert.equal(sceneBeats((await db.getEntity(scene.id)).content).at(-1).block.text, 'PROPOSED_BEAT')
  const edit = await executeChatManagementTool(f.book.id, call('propose_scene_beat', { entity_id: scene.id, beat_id: 'beat-one', text: 'EDITED_BEAT' }))
  await db.applyChatManagementChange(f.book.id, scene.id, edit.entityAction.operation)
  await assert.rejects(() => db.applyChatManagementChange(f.book.id, scene.id, edit.entityAction.operation), /changed/)
  const copied = copyBookArchive(await db.readBookArchive(f.book.id))
  const copiedScene = copied.data.entities.find((entity) => entity.type === 'scene')
  const copiedBeat = sceneBeats(copiedScene.content)[0]
  assert.notEqual(copiedBeat.block.id, 'beat-one')
  assert.ok(beatPassage(copiedScene.content, copiedBeat.block.id))
})

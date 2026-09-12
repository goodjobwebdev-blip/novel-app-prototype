import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import 'fake-indexeddb/auto'
globalThis.window = new EventTarget()
const storage = new Map()
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key,value) => storage.set(key,String(value)), removeItem: key => storage.delete(key) }
registerHooks({ resolve(s,c,n) { if (s.startsWith('.') && c.parentURL?.startsWith('file:')) { const u = new URL(s+'.ts',c.parentURL); if (existsSync(fileURLToPath(u))) return n(u.href,c) } return n(s,c) } })
const p = await import('../src/persistence.ts'), c = await import('../src/character-chat.ts'), chat = await import('../src/chat-service.ts')
const { initialAiSettings } = await import('../src/ai-settings.ts')
const { assembleChatGenerationRequest, emptyCharacterBook } = await import('../src/chat-request.ts')
const { availableChatTools } = await import('../src/chat-tool-availability.ts')
const images = await import('../src/chat-direct-images.ts'), settings = await import('../src/image-settings.ts')
const { copyBookArchive } = await import('../src/book-archive.ts')
const { resolveCodexState } = await import('../src/codex-timeline.ts')
const { readTimelineWorld } = await import('../src/codex-timeline-service.ts')
const { finalizeChatProviderRequest } = await import('../src/chat-request.ts')
after(async () => (await p.database()).close())
async function fixture() {
 const { book } = await p.createBook(initialAiSettings, 'FUTURE_SECRET title')
 const chapter = await p.createStructuralEntity('chapter',book.id,book.id,'Chapter')
 const first = await p.createStructuralEntity('scene',book.id,chapter.id,'FUTURE_SECRET scene title')
 const later = await p.createStructuralEntity('scene',book.id,chapter.id,'Later')
 await p.saveDocumentContent(first.id,'Visible prose. <!-- PRIVATE_SECRET --> FUTURE_SECRET suffix')
 await p.saveDocumentContent(later.id,'FUTURE_SECRET later manuscript')
 const entry = await p.createCodexEntry(book.id,'Mara')
 const db = await p.database()
 await db.table('entities').update(entry.id,{ typeId:'lore-character', content:'Mara is alive.', triggers:['FUTURE_SECRET'], checkpoints:[{id:'future-point',label:'FUTURE_SECRET',sceneId:later.id,anchorBookId:book.id,content:'FUTURE_SECRET lore',revision:1}] })
 const cutoff = {bookId:book.id,sceneId:first.id,position:14}
 const conversation = await c.createCharacterChat(book.id,[{entryId:entry.id,label:'Mara'}],cutoff)
 return { book, first, later, entry, cutoff, conversation, db }
}
test('strict character prompt and every available read/search omit future prose, summaries and metadata',async()=>{
 const f=await fixture(),frame=await c.captureCharacterFrame(f.conversation,[])
 const history=[{role:'user',content:'Hello'}], tools=availableChatTools(true,history)
 const request=assembleChatGenerationRequest({book:{...emptyCharacterBook,title:'FUTURE_SECRET',overview:'FUTURE_SECRET'},composition:{systemPrompt:'{{book.overview}} {{chat.workspace_instructions}}',predefinedMessages:f.conversation.promptComposition.predefinedMessages},context:frame.context,restrictedInstructions:frame.instructions,history,tools})
 assert.doesNotMatch(JSON.stringify(request),/FUTURE_SECRET|PRIVATE_SECRET/)
 assert.match(JSON.stringify(request),/Visible prose|Mara is alive/)
 assert.deepEqual(tools.map(t=>t.function.name),['read_story_context','search_story_context','propose_image_generation'])
 for(const source of frame.sources){const result=c.executeCharacterRead(frame,{function:{name:'read_story_context',arguments:JSON.stringify({source_id:source.id})}});assert.doesNotMatch(result,/FUTURE_SECRET|PRIVATE_SECRET/)}
 assert.equal(JSON.parse(c.executeCharacterRead(frame,{function:{name:'search_story_context',arguments:'{"query":"FUTURE_SECRET"}'}})).results.length,0)
 assert.equal(JSON.parse(c.executeCharacterRead(frame,{function:{name:'read_entity',arguments:JSON.stringify({entity_id:f.later.id})}})).ok,false)
 assert.equal(JSON.parse(c.executeCharacterRead(frame,{function:{name:'read_story_context',arguments:JSON.stringify({source_id:f.later.id})}})).ok,false)
 const frozen=JSON.stringify(frame);await f.db.table('entities').update(f.entry.id,{content:'Changed after capture'});assert.equal(JSON.stringify(frame),frozen)
})
test('cutoffs persist; earlier positions start empty; forward history is validated against its original knowledge',async()=>{
 const f=await fixture(),frame=await c.captureCharacterFrame(f.conversation,[])
 await chat.createChatMessage(f.conversation,'assistant','@'+f.conversation.character.participants[0].token+': Hello',{characterBoundary:frame.boundary})
 const history=await chat.listChatMessages(f.book.id,f.conversation.id)
 assert.deepEqual((await chat.getChat(f.conversation.id)).character.cutoff,f.cutoff)
 const forward=await c.moveCharacterChat(f.conversation.id,{bookId:f.book.id,sceneId:f.later.id,position:0})
 await c.captureCharacterFrame(forward,history)
 const earlier=await c.moveCharacterChat(forward.id,f.cutoff)
 assert.notEqual(earlier.id,forward.id);assert.equal((await chat.listChatMessages(f.book.id,earlier.id)).length,0)
 assert.equal(earlier.character.participants[0].token,forward.character.participants[0].token)
 await f.db.table('entities').update(f.entry.id,{content:'Revised old knowledge'})
 await assert.rejects(c.captureCharacterFrame(forward,history),/Restart/)
 const restart=await c.moveCharacterChat(forward.id,f.cutoff,true);await c.captureCharacterFrame(restart,[])
 await assert.rejects(c.captureCharacterFrame(restart,history),/another or later/)
})

const requestFor = (conversation, frame, composition = conversation.promptComposition) => assembleChatGenerationRequest({ book: emptyCharacterBook, composition, context: frame.context, restrictedInstructions: frame.instructions, history: [{ role: 'user', content: 'Tell me about yourself.' }], tools: availableChatTools(true, []) })
const sentText = request => JSON.stringify(finalizeChatProviderRequest(request).messages)

test('full participant knowledge survives short summaries and customized or old prompts without duplicate text', async () => {
 const f = await fixture(), body = 'Mara is a navigator. Her sister is Elena. Her hometown is Coral Bay.'
 await p.saveDocumentContent(f.entry.id, body)
 const world = await readTimelineWorld(f.book.id), entry = await p.getEntity(f.entry.id)
 const state = resolveCodexState(entry, f.cutoff, world, 'strict')
 await f.db.table('entities').update(entry.id, { timelineSummaries: [{ checkpointId: state.checkpointId, sourceText: state.content, orderSignature: state.orderSignature, mode: 'strict', content: 'Mara is kind.' }] })
 const frame = await c.captureCharacterFrame(f.conversation, [])
 for (const composition of [f.conversation.promptComposition, { systemPrompt: 'Stay in character.', predefinedMessages: [] }, { systemPrompt: 'Stay in character. {% if book.overview %}{{context.automatic}}{% endif %}', predefinedMessages: [] }, { systemPrompt: '{% if context.automatic_codex %}Stay in character.{% endif %}', predefinedMessages: [] }, { systemPrompt: '{{context.additional}}', predefinedMessages: [{ id: 'disabled', role: 'system', enabled: false, template: '{{context.automatic}}' }] }]) {
   const text = sentText(requestFor(f.conversation, frame, composition))
   assert.match(text, /Her sister is Elena/)
   assert.match(text, /Character: Mara/)
   assert.equal(text.split('Her hometown is Coral Bay').length - 1, 1)
 }
 assert.equal(frame.context.automaticSources[0].representation, 'Full character profile')
})

test('manual Codex, notes and manuscript selections reach existing character chats and remain editable', async () => {
 const f = await fixture()
 const place = await p.createCodexEntry(f.book.id, 'Harbor')
 await p.saveDocumentContent(place.id, 'The harbor bell rings at noon.')
 const note = await p.createNote(f.book.id, 'Shared memory')
 await p.saveDocumentContent(note.id, 'Elena gave Mara a compass. <!-- PRIVATE_NOTE -->')
 const unselected = await p.createNote(f.book.id, 'Hidden note')
 await p.saveDocumentContent(unselected.id, 'UNSELECTED_NOTE')
 const foreign = await fixture(), foreignNote = await p.createNote(foreign.book.id, 'Foreign')
 await p.saveDocumentContent(foreignNote.id, 'FOREIGN_NOTE')
 const before = await c.captureCharacterFrame(f.conversation, [])
 await chat.createChatMessage(f.conversation, 'assistant', 'Hello.', { characterBoundary: before.boundary })
 const history = await chat.listChatMessages(f.book.id, f.conversation.id)
 const profile = { ...f.conversation.contextProfile, codexEntryIds: [place.id], noteIds: [note.id, foreignNote.id], structuralIds: [f.first.parentId] }
 const updated = await chat.saveChatContextProfile(f.conversation.id, profile)
 const frame = await c.captureCharacterFrame(updated, history)
 assert.equal(frame.boundary.fingerprint, before.boundary.fingerprint)
 const text = sentText(requestFor(updated, frame, { systemPrompt: 'Roleplay.', predefinedMessages: [] }))
 assert.match(text, /harbor bell rings/)
 assert.match(text, /Elena gave Mara a compass/)
 assert.match(text, /FUTURE_SECRET suffix/)
 assert.match(text, /FUTURE_SECRET later manuscript/)
 assert.doesNotMatch(text, /PRIVATE_NOTE|UNSELECTED_NOTE|FOREIGN_NOTE/)
 const search = JSON.parse(c.executeCharacterRead(frame, { function: { name: 'search_story_context', arguments: '{"query":"compass"}' } }))
 assert.equal(search.results.length, 1)
 assert.equal(JSON.parse(c.executeCharacterRead(frame, { function: { name: 'read_story_context', arguments: JSON.stringify({ source_id: search.results[0].id }) } })).source.kind, 'note')
 const reloaded = await chat.getChat(updated.id)
 assert.deepEqual(reloaded.contextProfile.codexEntryIds, [place.id])
 const restarted = await c.moveCharacterChat(updated.id, f.cutoff, true)
 assert.deepEqual(restarted.contextProfile, reloaded.contextProfile)
 const cleared = await chat.saveChatContextProfile(updated.id, { ...profile, codexEntryIds: [], noteIds: [], structuralIds: [] })
 const next = await c.captureCharacterFrame(cleared, history)
 assert.doesNotMatch(sentText(requestFor(cleared, next)), /compass|harbor bell rings|FUTURE_SECRET/)
 assert.match(sentText(requestFor(cleared, next)), /Mara is alive/)
})

test('preview selections use their draft and full selected Codex respects the explicit timeline preference', async () => {
 const f = await fixture(), place = await p.createCodexEntry(f.book.id, 'Harbor')
 await f.db.table('entities').update(place.id, { content: 'Baseline harbor.', checkpoints: [{ id: 'now', label: 'Now', sceneId: f.first.id, anchorBookId: f.book.id, content: 'Checkpoint harbor.', revision: 1 }] })
 const profile = { ...f.conversation.contextProfile, codexEntryIds: [place.id], loreAtCurrentScene: true }
 const resolved = await c.captureCharacterFrame(f.conversation, [], profile)
 assert.match(sentText(requestFor(f.conversation, resolved)), /Checkpoint harbor/)
 assert.doesNotMatch(sentText(requestFor(f.conversation, resolved)), /Baseline harbor/)
 const baseline = await c.captureCharacterFrame(f.conversation, [], { ...profile, loreAtCurrentScene: false })
 assert.match(sentText(requestFor(f.conversation, baseline)), /Baseline harbor/)
 assert.deepEqual((await chat.getChat(f.conversation.id)).contextProfile.codexEntryIds, [], 'Preview must not save the draft')
 await f.db.table('entities').update(place.id, { archivedAt: Date.now() })
 assert.doesNotMatch(sentText(requestFor(f.conversation, await c.captureCharacterFrame(f.conversation, [], profile))), /Checkpoint harbor|Baseline harbor/)
})

test('explicit summary ranges include selected manuscript summaries without changing automatic context', async () => {
 const f = await fixture()
 await f.db.table('entities').put({ id: `summary-${f.later.id}`, type: 'summary', bookId: f.book.id, parentId: f.later.id, sourceEntityId: f.later.id, sourceType: 'scene', title: 'Later summary', content: 'The treasure is under the bell.', proseProjectionVersion: 1, createdAt: 1, updatedAt: 1 })
 const before = await c.captureCharacterFrame(f.conversation, [])
 for (const range of ['all', 'after']) {
   const frame = await c.captureCharacterFrame(f.conversation, [], { ...f.conversation.contextProfile, summaryRange: range })
   assert.match(sentText(requestFor(f.conversation, frame)), /treasure is under the bell/)
   assert.equal(frame.boundary.fingerprint, before.boundary.fingerprint)
 }
 for (const range of ['none', 'before']) {
   const frame = await c.captureCharacterFrame(f.conversation, [], { ...f.conversation.contextProfile, summaryRange: range })
   assert.doesNotMatch(sentText(requestFor(f.conversation, frame)), /treasure is under the bell/)
 }
})
test('only eligible distinct participants and available scene positions can start roleplay',async()=>{
 const f=await fixture()
 await assert.rejects(c.createCharacterChat(f.book.id,[],f.cutoff),/one to eight/)
 await assert.rejects(c.createCharacterChat(f.book.id,[{entryId:f.entry.id,label:'Mara'},{entryId:f.entry.id,label:'Other'}],f.cutoff),/distinct/)
 await assert.rejects(c.createCharacterChat(f.book.id,[{entryId:f.entry.id,label:'Mara'}],{...f.cutoff,position:99999}),/position/)
 await f.db.table('entities').update(f.entry.id,{typeId:'lore-location',category:'Location'})
 assert.equal((await c.listCharacterCandidates(f.book.id)).length,0)
 await f.db.table('entities').update(f.entry.id,{roleplayParticipant:true})
 assert.equal((await c.listCharacterCandidates(f.book.id)).length,1)
})
function configure(){const model=settings.documentedImageModels.find(m=>m.id==='gpt-image-1');const favorite=settings.imageFavorite(model,[]);favorite.alias='portrait';settings.saveImageSettings({keys:{nanogpt:'',openai:'',pruna:''},favorites:[favorite],defaultAlias:'portrait'})}
test('direct images are advertised only for explicit current-turn requests',()=>{
 for(const text of ['Hello','Do not generate an image','What does "send me a photo" mean?','Show me how to draw a picture','Suggest an image prompt','If I ask you, generate a picture']) assert.equal(images.explicitlyRequestsImage(text),false,text)
 for(const text of ['Send me a photo of yourself','Please generate a portrait','Can you draw a picture of Mara?']) assert.equal(images.explicitlyRequestsImage(text),true,text)
 assert.ok(availableChatTools(false,[{role:'user',content:'Send me a photo'}]).some(t=>t.function.name==='generate_requested_image'))
 assert.ok(!availableChatTools(false,[{role:'user',content:'Send me a photo'},{role:'assistant',content:'Here'}]).some(t=>t.function.name==='generate_requested_image'))
})
test('direct jobs are durable and idempotent across duplicate calls, reloads, clearing, and foreign requests',async()=>{
 configure();const f=await fixture(),user=await chat.createChatMessage(f.conversation,'user','Send me a photo of Mara')
 const input={chat:f.conversation,userMessageId:user.id,userText:user.content,responseId:'image-response',roundNumber:1,callId:'call-one',prompt:'Mara by the gate'}
 const [one,two]=await Promise.all([images.queueRequestedImage(input),images.queueRequestedImage({...input,callId:'call-two'})])
 assert.equal(one.jobId,two.jobId);assert.equal((await f.db.table('imageJobs').where('bookId').equals(f.book.id).toArray()).length,1)
 const job=await f.db.table('imageJobs').get(one.jobId);assert.equal(job.status,'queued');assert.equal((job.sources ?? []).length,0)
 assert.equal((await chat.listChatMessages(f.book.id,f.conversation.id)).filter(m=>m.directImageRequest).length,1)
 await f.db.table('imageJobs').delete(one.jobId)
 const replay=await images.queueRequestedImage({...input,chat:await chat.getChat(f.conversation.id),callId:'after-reload'});assert.equal(replay.reused,true);assert.equal(await f.db.table('imageJobs').get(one.jobId),undefined)
 const foreign=await fixture();await assert.rejects(images.queueRequestedImage({...input,chat:foreign.conversation}),/originating/)
})
test('missing configuration, unavailable references and cancellation create no paid job',async()=>{
 const f=await fixture(),user=await chat.createChatMessage(f.conversation,'user','Create an image of Mara'),input={chat:f.conversation,userMessageId:user.id,userText:user.content,responseId:'failed-response',roundNumber:1,callId:'failure',prompt:'Mara'}
 settings.saveImageSettings({keys:{},favorites:[],defaultAlias:''})
 await assert.rejects(images.queueRequestedImage(input),/model|favorite|Settings/i)
 configure();const controller=new AbortController();controller.abort();await assert.rejects(images.queueRequestedImage({...input,signal:controller.signal}))
 const changed=await chat.updateChat(f.conversation.id,{directImageReferenceIds:['missing']});await assert.rejects(images.queueRequestedImage({...input,chat:changed}),/reference is unavailable/)
 assert.equal((await f.db.table('imageJobs').where('bookId').equals(f.book.id).toArray()).length,0)
})

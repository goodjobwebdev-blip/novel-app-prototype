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

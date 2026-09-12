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
const p = await import('../src/persistence.ts'), planning = await import('../src/author-planning.ts'), service = await import('../src/author-planning-service.ts')
const chat = await import('../src/chat-service.ts'), management = await import('../src/chat-management-tools.ts'), actions = await import('../src/chat-entity-tools.ts')
const { initialAiSettings } = await import('../src/ai-settings.ts')
const archive = await import('../src/book-archive.ts'), { encodeDocumentBlock } = await import('../src/document-projection.ts')
const { proposalDraftValues } = await import('../src/chat-proposal-draft.ts')
after(async () => (await p.database()).close())
async function fixture(){ const { book } = await p.createBook(initialAiSettings,'Planner'); const chapter=await p.createStructuralEntity('chapter',book.id,book.id,'Chapter');const scene=await p.createStructuralEntity('scene',book.id,chapter.id,'Scene');return {book,chapter,scene} }
const goal=()=>({id:'goal-'+crypto.randomUUID(),title:'Draft the ending',description:'Resolve the main conflict',targetWords:5,completed:false})
const task=()=>({id:'task-'+crypto.randomUUID(),title:'Revise the reveal',notes:'Keep the clue subtle',status:'todo'})
const call=(name,args={})=>({id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}})
test('offline goals and ordered tasks persist, enforce one active goal, and retain text after linked deletion',async()=>{
 const f=await fixture(),g=goal(),a={...task(),goalId:g.id,linkedEntityId:f.scene.id},b=task()
 let saved=await service.saveAuthorPlanning(f.book.id,planning.emptyAuthorPlanning(),{goals:[g],tasks:[a,b]})
 assert.deepEqual((await service.readAuthorPlanning(f.book.id)).planning,saved.planning)
 saved=await service.saveAuthorPlanning(f.book.id,saved.planning,{...saved.planning,tasks:[{...b,status:'doing'},a]})
 assert.equal(saved.planning.tasks[0].id,b.id)
 await assert.rejects(service.saveAuthorPlanning(f.book.id,saved.planning,{...saved.planning,goals:[g,goal()]}),/active goal/)
 await assert.rejects(service.saveAuthorPlanning(f.book.id,planning.emptyAuthorPlanning(),saved.planning),/changed elsewhere/)
 await p.deleteEntityTree(f.scene.id)
 const missing=(await service.readAuthorPlanning(f.book.id)).planning.tasks[1];assert.equal(missing.title,a.title);assert.equal(missing.linkedEntityId,f.scene.id)
 saved=await service.saveAuthorPlanning(f.book.id,saved.planning,{...saved.planning,goals:[{...g,completed:true}],tasks:saved.planning.tasks.map(t=>({...t,status:'done'}))})
 assert.equal(saved.planning.goals[0].completed,true);assert.equal(saved.planning.tasks[1].notes,a.notes)
 await service.saveAuthorPlanning(f.book.id,saved.planning,{...saved.planning,goals:[...saved.planning.goals,goal()]})
})
test('word progress excludes private and planning blocks and falls when manuscript prose is deleted',async()=>{
 const f=await fixture(),g=goal()
 await p.saveDocumentContent(f.scene.id,'One two three. <!-- hidden private text --> '+encodeDocumentBlock({id:'beat',type:'beat',text:'extra future words'}))
 await service.saveAuthorPlanning(f.book.id,planning.emptyAuthorPlanning(),{goals:[g],tasks:[]})
 const current=await service.readAuthorPlanning(f.book.id);assert.equal(current.words,3)
 assert.equal(planning.manuscriptWords(current.entities,{id:f.scene.id,content:'One'}),1)
 await p.saveDocumentContent(f.scene.id,'One two three four five six')
 assert.equal((await service.readAuthorPlanning(f.book.id)).planning.goals[0].completed,false)
 await p.saveDocumentContent(f.scene.id,'One');assert.equal((await service.readAuthorPlanning(f.book.id)).words,1)
})
test('planning backups remap stable task, goal and entity references while retaining unavailable links',async()=>{
 const f=await fixture(),g=goal(),a={...task(),goalId:g.id,linkedEntityId:f.scene.id},b={...task(),linkedEntityId:f.chapter.id}
 await service.saveAuthorPlanning(f.book.id,planning.emptyAuthorPlanning(),{goals:[g],tasks:[a,b]})
 const raw=await p.readBookArchive(f.book.id),copy=archive.copyBookArchive(await archive.decodeBookArchive(archive.encodeBookArchive(raw)))
 const imported=copy.data.entities.find(e=>e.type==='book').authorPlanning
 assert.notEqual(imported.goals[0].id,g.id);assert.equal(imported.tasks[0].goalId,imported.goals[0].id);assert.notEqual(imported.tasks[0].linkedEntityId,f.scene.id)
 assert.ok(copy.data.entities.some(e=>e.id===imported.tasks[0].linkedEntityId))
 await p.deleteEntityTree(f.scene.id)
 const missing=archive.copyBookArchive(await archive.decodeBookArchive(archive.encodeBookArchive(await p.readBookArchive(f.book.id)))).data.entities.find(e=>e.type==='book').authorPlanning.tasks[0]
 assert.equal(missing.title,a.title);assert.match(missing.linkedEntityId,/unavailable/)
})
test('chat planning suggestions stay pending, support edited drafts, and apply once against current state',async()=>{
 const f=await fixture(),conversation=await chat.createChat(f.book.id)
 const result=await management.executeChatManagementTool(f.book.id,call('propose_author_task',{changes:{title:'Suggested task',notes:'AI draft',status:'todo',linkedEntityId:f.scene.id}}))
 assert.ok(result.entityAction, result.content);assert.equal((await service.readAuthorPlanning(f.book.id)).planning.tasks.length,0)
 const message=await chat.createChatMessage(conversation,'assistant','',{entityActions:[result.entityAction]})
 const values={...proposalDraftValues('entityActions',result.entityAction),'plan:title':'My revised task','plan:status':'doing'}
 await chat.saveChatProposalDraft(f.book.id,conversation.id,message.id,'entityActions',result.entityAction.id,values,0)
 assert.equal((await service.readAuthorPlanning(f.book.id)).planning.tasks.length,0)
 await actions.applyChatEntityAction(message.id,result.entityAction.id)
 let current=await service.readAuthorPlanning(f.book.id);assert.equal(current.planning.tasks[0].title,'My revised task');assert.equal(current.planning.tasks[0].status,'doing')
 await assert.rejects(actions.applyChatEntityAction(message.id,result.entityAction.id));assert.equal((await service.readAuthorPlanning(f.book.id)).planning.tasks.length,1)
 const update=await management.executeChatManagementTool(f.book.id,call('propose_author_task',{task_id:current.planning.tasks[0].id,changes:{status:'done'}}))
 const pending=await chat.createChatMessage(conversation,'assistant','Discussing completion',{entityActions:[update.entityAction]})
 assert.equal((await service.readAuthorPlanning(f.book.id)).planning.tasks[0].status,'doing')
 await service.saveAuthorPlanning(f.book.id,current.planning,{...current.planning,tasks:current.planning.tasks.map(t=>({...t,title:'Changed manually'}))})
 await assert.rejects(actions.applyChatEntityAction(pending.id,update.entityAction.id),/changed/)
 const metadata=await management.executeChatManagementTool(f.book.id,call('read_book_metadata'));assert.doesNotMatch(metadata.content,/Changed manually/)
 const scoped=await management.executeChatManagementTool(f.book.id,call('read_author_plan'));assert.match(scoped.content,/Changed manually/)
 const foreign=await fixture(),bad=await management.executeChatManagementTool(f.book.id,call('propose_author_task',{changes:{title:'Wrong link',linkedEntityId:foreign.scene.id}}));assert.equal(JSON.parse(bad.content).ok,false)
})

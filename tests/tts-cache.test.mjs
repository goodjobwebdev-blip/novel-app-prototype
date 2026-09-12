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

const cache=await import('../src/tts-cache.ts'), p=await import('../src/persistence.ts')
const {initialAiSettings}=await import('../src/ai-settings.ts'), {encodeDocumentBlock}=await import('../src/document-projection.ts')
let tts=await import('../src/tts-service.ts'), autoPlay=true, paid=0, catalog=0, inputs=[]
globalThis.Audio=class { constructor(url){this.src=url;this.currentTime=0;this.duration=1} pause(){} play(){if(autoPlay)setTimeout(()=>this.onended?.(),1);return Promise.resolve()} }
const settings={provider:'nanogpt',apiKey:'SECRET_TTS_KEY',model:'Kokoro-82m',voice:'af_bella',maxParallelRequests:'2'}
function provider(custom){paid=0;catalog=0;inputs=[];globalThis.fetch=async(url,init={})=>{if(String(url).includes('/audio-models')){catalog++;return Response.json({data:[{id:settings.model,voices:['af_bella','af_sarah'],max_chars:500,pricing:{per_thousand_chars:0.02}}]})} if(String(url).endsWith('/api/tts')){paid++;inputs.push(JSON.parse(init.body).text);return custom?custom(paid,init):new Response(new Blob(['complete audio '+paid]),{headers:{'content-type':'audio/mpeg'}})}throw new Error('Unexpected network '+url)} }
async function fixture(){await cache.clearTtsCache();cache.saveTtsCacheSettings({enabled:true,maxMiB:256});const {book}=await p.createBook(initialAiSettings,'Cache book');const chapter=await p.createStructuralEntity('chapter',book.id,book.id,'Chapter');const scene=await p.createStructuralEntity('scene',book.id,chapter.id,'Scene');return {book,scene,owner:{bookId:book.id,entityId:scene.id}}}
async function waitFor(predicate){for(let i=0;i<200&&!await predicate();i++)await new Promise(r=>setTimeout(r,5));assert.ok(await predicate())}
after(async()=>{tts.stopTtsSession();tts.dismissTtsState();(await p.database()).close();(await cache.ttsCacheDatabase())?.close()})
test('durable cached replay survives a fresh service instance, rename, missing credentials and complete network loss',async()=>{
 const f=await fixture();provider();await tts.startTtsSession(settings,'Known words.', 'Original title',f.owner);assert.equal(paid,1)
 const db=await cache.ttsCacheDatabase();assert.equal(await db.table('chunks').count(),1);assert.ok((await db.table('chunks').toArray())[0].blob.size)
 tts.dismissTtsState();tts=await import('../src/tts-service.ts?fresh='+Date.now());globalThis.fetch=async()=>{throw new Error('Offline replay must make zero network calls')}
 const offline={...settings,apiKey:''};const plan=await tts.prepareSpeechPlayback(offline,'Known words.',f.owner);assert.equal(plan.cachedChunks,1);assert.equal(plan.missingChunks,0)
 await tts.startTtsSession(offline,'Known words.','Renamed scene',f.owner);assert.equal(tts.getTtsState().status,'complete');assert.equal(tts.getTtsState().missingChunks,0)
 assert.doesNotMatch(JSON.stringify([await db.table('meta').toArray(),await db.table('manifests').toArray(),await db.table('chunks').toArray()]),/SECRET_TTS_KEY/)
})
test('partial edits request only missing chunks, restored text reuses old audio and voice changes never reuse mismatched chunks',async()=>{
 const f=await fixture(),a='Alpha '.repeat(65).trim(),b='Bravo '.repeat(65).trim(),c='Delta '.repeat(65).trim();provider()
 await tts.startTtsSession(settings,a+'\n\n'+b,'First',f.owner);assert.equal(paid,2)
 const edited=await tts.prepareSpeechPlayback(settings,a+'\n\n'+c,f.owner);assert.equal(edited.cachedChunks,1);assert.equal(edited.missingChunks,1);assert.equal(edited.missingCharacters,c.length)
 await tts.startTtsSession(settings,a+'\n\n'+c,'Edit',f.owner,edited);assert.equal(paid,3)
 await tts.startTtsSession({...settings,apiKey:''},a+'\n\n'+b,'Restore',f.owner);assert.equal(paid,3)
 await tts.startTtsSession({...settings,voice:'af_sarah'},a+'\n\n'+b,'New voice',f.owner);assert.equal(paid,5)
 const id=tts.ttsAudioIdentity(settings),one=await cache.ttsChunkKey(f.owner,id,a);for(const changed of [{...id,version:'future-version'},{...id,model:'another-model'},{...id,endpoint:'https://another.example/tts'},{...id,parameters:{speed:1.2}},{...id,format:'wav'}])assert.notEqual(await cache.ttsChunkKey(f.owner,changed,a),one)
})
test('identical concurrent chunks share one paid job and spoken projection excludes private and nonprose text',async()=>{
 const f=await fixture(),paragraph='Words '.repeat(65).trim();provider();await tts.startTtsSession({...settings,maxParallelRequests:'8'},[paragraph,paragraph,paragraph].join('\n\n'),'Repeated',f.owner);assert.equal(paid,1);assert.equal(tts.getTtsState().missingChunks,1)
 provider();await tts.startTtsSession(settings,'Visible. <!-- PRIVATE_SECRET --> '+encodeDocumentBlock({id:'private-beat',type:'beat',text:'FUTURE_SECRET'})+' ![IMAGE_SECRET](https://example.com/image.png)','Projected',f.owner)
 assert.equal(inputs[0],'Visible.');assert.doesNotMatch(inputs.join(''),/PRIVATE_SECRET|FUTURE_SECRET|IMAGE_SECRET/)
})
test('stop and later failure preserve completed chunks and never cache incomplete audio',async()=>{
 const f=await fixture(),a='First '.repeat(65).trim(),b='Later '.repeat(65).trim();autoPlay=false
 provider((number,init)=>number===1?new Response(new Blob(['done']),{headers:{'content-type':'audio/mpeg'}}):new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true})))
 const running=tts.startTtsSession({...settings,maxParallelRequests:'1'},a+'\n\n'+b,'Stop',f.owner);await waitFor(()=>paid===2);tts.stopTtsSession();await running;autoPlay=true
 const offline=await tts.prepareSpeechPlayback({...settings,apiKey:''},a,f.owner);assert.equal(offline.cachedChunks,1)
 provider(()=>new Response(JSON.stringify({error:'deliberate later failure'}),{status:500,headers:{'content-type':'application/json'}}));await assert.rejects(tts.startTtsSession(settings,a+'\n\n'+b,'Failure',f.owner),/deliberate later failure/)
 assert.equal((await cache.ttsCacheDatabase()).table('chunks')!==undefined,true);assert.equal((await tts.prepareSpeechPlayback({...settings,apiKey:''},a,f.owner)).cachedChunks,1)
})
test('storage write failure falls back to temporary playback without another paid generation',async()=>{
 const f=await fixture(),db=await cache.ttsCacheDatabase();provider();const failure=()=>{throw new DOMException('No space','QuotaExceededError')};db.table('chunks').hook('creating',failure)
 try{await tts.startTtsSession(settings,'Temporary audio still plays.','Quota',f.owner);assert.equal(paid,1);assert.equal(tts.getTtsState().status,'complete');assert.equal(await db.table('chunks').count(),0)}finally{db.table('chunks').hook('creating').unsubscribe(failure)}
 await tts.replayTtsSession();assert.equal(paid,1)
})
test('LRU evicts inactive audio across books and skips pinned playback',async()=>{
 const f=await fixture();cache.saveTtsCacheSettings({enabled:true,maxMiB:64});const other={bookId:'other-'+crypto.randomUUID(),entityId:'other-scene'};const identity=tts.ttsAudioIdentity(settings),first=await cache.readTtsCachePlan(f.owner,identity,['one']),second=await cache.readTtsCachePlan(other,identity,['two']),third=await cache.readTtsCachePlan(other,identity,['three']);const audio=new Blob([new Uint8Array(33*1024**2)])
 assert.equal(await cache.writeTtsCacheChunk(first,0,audio),true);assert.equal(await cache.writeTtsCacheChunk(second,0,audio),true)
 const db=await cache.ttsCacheDatabase();assert.equal(await db.table('chunks').get(first.keys[0]),undefined)
 const release=await cache.pinTtsCache(second);try{assert.equal(await cache.writeTtsCacheChunk(third,0,audio),false);assert.ok(await db.table('chunks').get(second.keys[0]))}finally{release()}
 await waitFor(async()=>await db.table('leases').count()===0);assert.equal(await cache.writeTtsCacheChunk(third,0,audio),true);assert.equal(await db.table('chunks').get(second.keys[0]),undefined)
})
test('clear/delete epochs reject late workers, retain shared references correctly, and book archives exclude audio',async()=>{
 const f=await fixture(),identity=tts.ttsAudioIdentity(settings),old=await cache.readTtsCachePlan(f.owner,identity,['old']),audio=new Blob(['valid audio'])
 await cache.clearTtsCache(f.book.id);assert.equal(await cache.writeTtsCacheChunk(old,0,audio),false)
 const first=await cache.readTtsCachePlan(f.owner,identity,['shared']),secondOwner={bookId:f.book.id,entityId:'other-target'},second=await cache.readTtsCachePlan(secondOwner,identity,['shared'])
 await cache.writeTtsCacheChunk(first,0,audio);await cache.writeTtsCacheChunk(second,0,audio)
 await p.deleteEntityTree(f.scene.id);assert.equal(await cache.writeTtsCacheChunk(first,0,audio),false);assert.ok((await cache.readTtsCachePlan(secondOwner,identity,['shared'])).cached[0])
 await cache.deleteTtsCacheOwners([secondOwner.entityId]);assert.equal(await cache.writeTtsCacheChunk(second,0,audio),false)
 const db=await cache.ttsCacheDatabase();assert.equal(await db.table('chunks').count(),0)
 const newOwner={bookId:f.book.id,entityId:f.book.id},fresh=await cache.readTtsCachePlan(newOwner,identity,['backup audio']);await cache.writeTtsCacheChunk(fresh,0,audio)
 const archive=await p.readBookArchive(f.book.id);assert.deepEqual(Object.keys(archive).sort(),['dependencies','entities','galleryImages','illustrations','imageJobs','snapshots']);assert.doesNotMatch(JSON.stringify(archive),/backup audio|valid audio/)
 await p.deleteEntityTree(f.book.id);assert.equal(await db.table('chunks').count(),0);assert.equal(await cache.writeTtsCacheChunk(fresh,0,audio),false)
})
test('turning caching off bypasses reads and writes while keeping stored chunks',async()=>{
 const f=await fixture();provider();await tts.startTtsSession(settings,'Keep stored audio.','On',f.owner);const db=await cache.ttsCacheDatabase();const count=await db.table('chunks').count();cache.saveTtsCacheSettings({enabled:false,maxMiB:256});await tts.startTtsSession(settings,'Keep stored audio.','Off',f.owner);assert.equal(paid,2);assert.equal(await db.table('chunks').count(),count);cache.saveTtsCacheSettings({enabled:true,maxMiB:256});await tts.startTtsSession({...settings,apiKey:''},'Keep stored audio.','On again',f.owner);assert.equal(paid,2)
})

test('clearing while a paid worker is pending lets held audio finish without repopulating persistent storage',async()=>{
 const f=await fixture();let finish;provider(()=>new Promise(resolve=>{finish=resolve}))
 const running=tts.startTtsSession(settings,'A pending audio request.','Clear while generating',f.owner);await waitFor(()=>Boolean(finish));await cache.clearTtsCache(f.book.id);finish(new Response(new Blob(['completed after clear']),{headers:{'content-type':'audio/mpeg'}}));await running
 assert.equal(tts.getTtsState().status,'complete');assert.equal(paid,1);assert.equal(await (await cache.ttsCacheDatabase()).table('chunks').count(),0)
})
test('provider audio URLs become durable blobs, while blocked downloads keep temporary playback without a second paid request',async()=>{
 for(const downloadable of [true,false]){
  const f=await fixture();let requests=0,downloads=0
  globalThis.fetch=async(url)=>{if(String(url).includes('/audio-models'))return Response.json({data:[{id:settings.model,voices:['af_bella'],max_chars:500}]});if(String(url).endsWith('/api/tts')){requests++;return Response.json({audioUrl:'https://audio.example/result.mp3'})}if(String(url)==='https://audio.example/result.mp3'){downloads++;if(!downloadable)throw new TypeError('CORS blocked');return new Response(new Blob(['complete remote audio']),{headers:{'content-type':'audio/mpeg'}})}throw new Error('Unexpected network request')}
  await tts.startTtsSession(settings,'Audio URL response.','Remote audio',f.owner);assert.equal(requests,1);assert.equal(downloads,1);assert.equal(await (await cache.ttsCacheDatabase()).table('chunks').count(),downloadable?1:0)
  await tts.replayTtsSession();assert.equal(requests,1)
  if(downloadable){globalThis.fetch=async()=>{throw new Error('Must replay offline')};await tts.startTtsSession({...settings,apiKey:''},'Audio URL response.','Cached remote audio',f.owner);assert.equal(tts.getTtsState().cachedChunks,1)}
 }
})

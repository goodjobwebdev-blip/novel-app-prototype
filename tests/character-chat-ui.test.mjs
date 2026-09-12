import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { JSDOM } from 'jsdom'
import 'fake-indexeddb/auto'

const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'https://arc.test/', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLDialogElement', 'sessionStorage', 'localStorage', 'Event', 'CustomEvent']) globalThis[key] = dom.window[key]
dom.window.HTMLElement.prototype.scrollIntoView = function () {}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const visualViewport = new dom.window.EventTarget()
visualViewport.height = 700
visualViewport.offsetTop = 0
Object.defineProperty(dom.window, 'visualViewport', { value: visualViewport })
Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth', { get: () => 300 })
Object.defineProperty(dom.window.HTMLElement.prototype, 'clientHeight', { get: () => 300 })
dom.window.HTMLElement.prototype.setPointerCapture = function () {}
dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
globalThis.ResizeObserver = class { constructor(callback) { this.callback = callback } observe() { this.callback() } disconnect() {} }
const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { act } = React
const directory = mkdtempSync(new URL('../node_modules/.arc-generation-ui-test-', import.meta.url))
for (const filename of readdirSync(new URL('../src/', import.meta.url)).filter((name) => /\.tsx?$/.test(name))) {
  const source = readFileSync(new URL(`../src/${filename}`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
    .replace(/import ['"][^'"]+\.css['"];?/g, '')
    .replace(/(['"])(\.\/[^'"]+)\1/g, (_, quote, path) => `${quote}${path.replace(/\.tsx?$/, '')}.mjs${quote}`)
  writeFileSync(`${directory}/${filename.replace(/\.tsx?$/, '.mjs')}`, compiled)
}
const moduleAt = (name) => import(pathToFileURL(`${directory}/${name}.mjs`))
writeFileSync(`${directory}/chat-api.mjs`, `
export const calls=[];
export async function streamChatCompletion(request,onChunk,signal) {
 calls.push(structuredClone(request));signal.throwIfAborted();
 if(calls.length===1) return {toolCalls:[{id:'direct-one',type:'function',function:{name:'generate_requested_image',arguments:'{"prompt":"Mara by a tree"}'}},{id:'direct-duplicate',type:'function',function:{name:'generate_requested_image',arguments:'{"prompt":"Mara by a tree"}'}},{id:'bad-tool',type:'function',function:{name:'read_entity',arguments:'{"entity_id":"future-scene"}'}}]};
 onChunk({content:'@Mara: Here is my photo.\\n@Intruder: Unknown speaker'});return {toolCalls:[]};
}
`)
const p = await moduleAt('persistence')
const ai = await moduleAt('ai-settings')
const chatService = await moduleAt('chat-service')
const api = await moduleAt('chat-api')
const { ChatView } = await moduleAt('ChatFeature')
const { default: Settings } = await moduleAt('App')
const character = await moduleAt('character-chat')
const imageSettings = await moduleAt('image-settings')
const { characterSpeakerParts } = await moduleAt('CharacterMessage')
after(async () => { (await p.database()).close(); dom.window.close(); rmSync(directory, { recursive: true, force: true }) })
const h = React.createElement
const button = text => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text)
async function click(text) { assert.ok(button(text), `Missing ${text}: ${document.body.textContent}`); await act(async () => button(text).click()) }
async function settle(predicate) { for (let i = 0; i < 500 && !predicate(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 10))); assert.ok(predicate(), document.body.textContent) }
async function send() {
  await settle(() => Boolean(document.querySelector('textarea[aria-label="Chat message"]')))
  const input = document.querySelector('textarea[aria-label="Chat message"]')
  await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(input, 'Send me a photo of yourself'); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
  await click('Send')
}
async function fixture(limit) {
  const settings = ai.copyAiSettings(ai.initialAiSettings)
  settings.provider = 'fake'; settings.mainModel = 'fake/test'; settings.mainModelContextLength = 100000
  const { book } = await p.createBook(settings, 'Round test')
  const chapter = await p.createStructuralEntity('chapter',book.id,book.id,'Chapter')
  const scene = await p.createStructuralEntity('scene',book.id,chapter.id,'FUTURE_SECRET')
  await p.saveDocumentContent(scene.id,'Known prose. FUTURE_SECRET')
  const entry=await p.createCodexEntry(book.id,'Mara'); await (await p.database()).table('entities').update(entry.id,{typeId:'lore-character',content:'Mara is kind.',triggers:['FUTURE_SECRET']})
  let chat = await character.createCharacterChat(book.id,[{entryId:entry.id,label:'Mara'}],{bookId:book.id,sceneId:scene.id,position:12})
  chat = await chatService.updateChat(chat.id, { maxModelRounds: limit, modelContextLength: 100000 })
  return { book, chat, scene, entry }
}
function view(f) { return h(ChatView, { bookId: f.book.id, chatId: f.chat.id, bookPromptValues: { title: f.book.title }, onChatChange() {}, onToast(message) { throw new Error(message) } }) }


test('actual character chat sends a restricted request, queues one direct image, and renders participant labels plus the result card',async()=>{
 const favorite=imageSettings.imageFavorite(imageSettings.documentedImageModels.find(m=>m.id==='gpt-image-1'),[]);favorite.alias='portrait';imageSettings.saveImageSettings({keys:{},favorites:[favorite],defaultAlias:'portrait'})
 const f=await fixture(8),root=createRoot(document.getElementById('root'))
 try {
  await act(async()=>root.render(view(f)));await send();await settle(()=>api.calls.length===2 && button('Send') && !button('Send').disabled)
  assert.doesNotMatch(JSON.stringify(api.calls),/FUTURE_SECRET/)
  assert.deepEqual(api.calls[0].tools.map(t=>t.function.name),['read_story_context','search_story_context','propose_image_generation','generate_requested_image'])
  assert.match(JSON.stringify(api.calls[1]),/This tool is unavailable/)
  const jobs=await (await p.database()).table('imageJobs').where('bookId').equals(f.book.id).toArray();assert.equal(jobs.length,1)
  const messages=await chatService.listChatMessages(f.book.id,f.chat.id);assert.equal(messages.filter(m=>m.directImageRequest).length,1)
  assert.ok(messages.filter(m=>m.role==='assistant').every(m=>m.characterBoundary))
  assert.equal(document.querySelector('.character-speaker').textContent,'@Mara:');assert.match(document.querySelector('.chat-media-card').textContent,/Requested image/)
  assert.equal(characterSpeakerParts('@Mara: Hello\n@Intruder: Hi',f.chat.character.participants)[1].speaker,undefined)
 } finally {await act(async()=>root.unmount())}
})

test('actual Chat context settings save character references, preview them, and send them after reopening chat', async () => {
 const f = await fixture(8)
 const note = await p.createNote(f.book.id, 'Compass memory')
 await p.saveDocumentContent(note.id, 'Elena gave Mara the brass compass.')
 const codex = await p.createCodexEntry(f.book.id, 'Coral Bay')
 await p.saveDocumentContent(codex.id, 'Coral Bay has a lighthouse with a green lantern.')
 await p.saveDocumentContent(f.entry.id, 'Mara grew up in Coral Bay and her sister is Elena.')
 f.chat = await chatService.updateChat(f.chat.id, { promptComposition: { systemPrompt: 'Answer as Mara.', predefinedMessages: [] } })
 const settingsProps = { initialTab: 'context', book: { id: f.book.id, title: f.book.title, contextType: 'chat', chatId: f.chat.id } }
 let root = createRoot(document.getElementById('root'))
 const selection = title => [...document.querySelectorAll('.context-selection-row')].find(row => row.querySelector('strong').textContent === title)?.querySelector('input')
 try {
   await act(async () => root.render(h(Settings, settingsProps)))
   await settle(() => selection('Compass memory') && document.querySelector('.context-help')?.textContent.includes('full Codex'))
   assert.ok(selection('Coral Bay'), 'Character chat must expose Codex selections')
   await act(async () => selection('Compass memory').click())
   await settle(() => document.querySelector('.context-inventory').textContent.includes('Compass memory'))
   await act(async () => selection('Coral Bay').click())
   await settle(() => document.querySelector('.context-inventory').textContent.includes('Coral Bay'))
   await settle(() => document.querySelector('.context-inspector').textContent.includes('green lantern'))
   await settle(() => document.querySelector('.context-inspector').textContent.includes('brass compass'))
   const saved = await chatService.getChat(f.chat.id)
   assert.deepEqual(saved.contextProfile.noteIds, [note.id])
   assert.deepEqual(saved.contextProfile.codexEntryIds, [codex.id])
   await act(async () => root.unmount())
   root = createRoot(document.getElementById('root'))
   await act(async () => root.render(h(Settings, settingsProps)))
   await settle(() => selection('Compass memory')?.checked && selection('Coral Bay')?.checked)
   await act(async () => root.unmount())
   root = createRoot(document.getElementById('root'))
   const before = api.calls.length
   await act(async () => root.render(view(f)))
   await send()
   await settle(() => api.calls.length > before && button('Send') && !button('Send').disabled)
   const payload = JSON.stringify(api.calls.at(-1))
   assert.match(payload, /Mara grew up in Coral Bay and her sister is Elena/)
   assert.match(payload, /brass compass/)
   assert.match(payload, /green lantern/)
 } finally { await act(async () => root.unmount()) }
})

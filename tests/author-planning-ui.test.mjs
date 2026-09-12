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

const p=await moduleAt('persistence'), ai=await moduleAt('ai-settings'), service=await moduleAt('author-planning-service')
const {default:AuthorGoalsTasks}=await moduleAt('AuthorGoalsTasks')
after(async()=>{(await p.database()).close();dom.window.close();rmSync(directory,{recursive:true,force:true})})
const h=React.createElement
async function settle(predicate){for(let i=0;i<200&&!predicate();i++)await act(async()=>new Promise(r=>setTimeout(r,10)));assert.ok(predicate(),document.body.textContent)}
const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text)
async function click(text){assert.ok(button(text),text);await act(async()=>button(text).click())}
async function input(label,value){const element=document.querySelector(`[aria-label="${label}"]`);assert.ok(element,label);await act(async()=>{Object.getOwnPropertyDescriptor(element.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:dom.window.HTMLInputElement.prototype,'value').set.call(element,value);element.dispatchEvent(new dom.window.Event(element.tagName==='SELECT'?'change':'input',{bubbles:true}))})}
async function submit(){await act(async()=>document.querySelector('.author-draft').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));await settle(()=>!document.querySelector('.author-draft'))}
test('Book planning UI creates a goal and linked task, filters status, reflects deletion and preserves history after reload',async()=>{
 const {book}=await p.createBook(ai.initialAiSettings,'Book');const chapter=await p.createStructuralEntity('chapter',book.id,book.id,'Chapter');const scene=await p.createStructuralEntity('scene',book.id,chapter.id,'Opening');await p.saveDocumentContent(scene.id,'One two three')
 let opened='',root=createRoot(document.getElementById('root'))
 const view=content=>h(AuthorGoalsTasks,{bookId:book.id,liveScene:{id:scene.id,content},onOpen:id=>{opened=id}})
 try{
  await act(async()=>root.render(view('One two three')));await settle(()=>button('New goal')&&!button('New goal').disabled)
  await click('New goal');await input('Goal title','Finish my draft');await input('Target manuscript words','2');await submit()
  assert.match(document.body.textContent,/3 \/ 2 manuscript words/);assert.ok(button('Complete goal'))
  await act(async()=>root.render(view('One')));assert.match(document.body.textContent,/1 \/ 2 manuscript words/)
  await click('New task');await input('Task title','Revise opening');await input('Task linked item',scene.id);await submit()
  await act(async()=>document.querySelector('.author-task-link').click());assert.equal(opened,scene.id)
  await input('Status: Revise opening','done');await settle(()=>document.querySelector('[aria-label="Status: Revise opening"]').value==='done')
  await input('Filter author tasks','todo');assert.match(document.body.textContent,/No tasks in this view/)
  await input('Filter author tasks','all')
  await act(async()=>{await p.deleteEntityTree(scene.id);window.dispatchEvent(new CustomEvent('arc-entity-changed',{detail:{bookId:book.id}}))});await settle(()=>document.body.textContent.includes('Unavailable linked item'));assert.match(document.body.textContent,/Revise opening/)
  await click('Complete goal');await settle(()=>document.body.textContent.includes('Completed goals'))
  await act(async()=>root.unmount());root=createRoot(document.getElementById('root'));await act(async()=>root.render(h(AuthorGoalsTasks,{bookId:book.id,onOpen(){}})));await settle(()=>document.body.textContent.includes('Revise opening'))
  assert.match(document.body.textContent,/Finish my draft/);assert.equal((await service.readAuthorPlanning(book.id)).planning.tasks[0].status,'done')
 }finally{await act(async()=>root.unmount())}
})

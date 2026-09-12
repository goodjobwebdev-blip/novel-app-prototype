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


const cache=await moduleAt('tts-cache'), {default:CacheSettings}=await moduleAt('TtsCacheSettings')
const h=React.createElement
const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text)
async function waitFor(predicate){for(let i=0;i<100&&!await predicate();i++)await act(async()=>new Promise(r=>setTimeout(r,10)));assert.ok(await predicate(),document.body.textContent)}
after(async()=>{(await cache.ttsCacheDatabase())?.close();dom.window.close();rmSync(directory,{recursive:true,force:true})})
test('Speech cache settings preserve audio when disabled and clear only the chosen scope',async()=>{
 const first={bookId:'book-one',entityId:'scene-one'},second={bookId:'book-two',entityId:'scene-two'},identity={provider:'nanogpt',profile:'speech',endpoint:'https://example.com/tts',model:'model',voice:'voice',format:'mp3',version:'v2',parameters:{}}
 for(const owner of [first,second]){const plan=await cache.readTtsCachePlan(owner,identity,['Known text']);await cache.writeTtsCacheChunk(plan,0,new Blob(['audio']))}
 const db=await cache.ttsCacheDatabase(),root=createRoot(document.getElementById('root'))
 try{
  await act(async()=>root.render(h(CacheSettings,{bookId:first.bookId})));await waitFor(()=>Boolean(button('Clear current book audio')))
  await act(async()=>document.querySelector('input[type=checkbox]').click());assert.equal(cache.loadTtsCacheSettings().enabled,false);assert.equal(await db.table('chunks').count(),2)
  await act(async()=>{const select=document.querySelector('[aria-label="Audio cache maximum"]');Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype,'value').set.call(select,'64');select.dispatchEvent(new dom.window.Event('change',{bubbles:true}))});assert.equal(cache.loadTtsCacheSettings().maxMiB,64)
  await act(async()=>button('Clear current book audio').click());await waitFor(async()=>await db.table('chunks').count()===1);assert.equal((await db.table('chunks').toArray())[0].bookId,second.bookId)
  await act(async()=>button('Clear all audio').click());await waitFor(async()=>await db.table('chunks').count()===0)
 }finally{await act(async()=>root.unmount())}
})

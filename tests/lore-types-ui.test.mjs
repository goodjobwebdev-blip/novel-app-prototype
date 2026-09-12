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
export let calls = [];
let mode = 'tools';
let toolsPerRound = 1;
export let beforeReturn;
export function configure(next, callback, count = 1) { calls = []; mode = next; beforeReturn = callback; toolsPerRound = count; }
export function setMode(next) { mode = next; }
export async function streamChatCompletion(request, onChunk, signal) {
  calls.push(structuredClone(request));
  if (beforeReturn) await beforeReturn(calls.length);
  signal.throwIfAborted();
  onChunk({ content: 'Round ' + calls.length });
  if (mode === 'brainstorm') { mode = 'complete'; return { toolCalls: [{ id: 'brainstorm-call', type: 'function', function: { name: 'present_brainstorm', arguments: JSON.stringify({ topic: 'The next scene', options: [{ title: 'Explore', description: 'Follow the river' }, { title: 'Wait', description: 'Watch the gate' }] }) } }] }; }
  return mode === 'complete' ? { toolCalls: [] } : { toolCalls: Array.from({ length: toolsPerRound }, (_, index) => ({ id: 'call-' + calls.length + '-' + index, type: 'function', function: { name: 'propose_note_create', arguments: JSON.stringify({ title: 'Draft ' + calls.length + '-' + index, content: 'Unapplied body' }) } })) };
}
`)
const p = await moduleAt('persistence')
const ai = await moduleAt('ai-settings')
const chatService = await moduleAt('chat-service')
const api = await moduleAt('chat-api')
const { ChatView } = await moduleAt('ChatFeature')
const { normalizeChatRoundLimit, validateChatRoundLimit } = await moduleAt('chat-round-limit')
after(async () => { (await p.database()).close(); dom.window.close(); rmSync(directory, { recursive: true, force: true }) })
const h = React.createElement
const button = text => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text)
async function click(text) { assert.ok(button(text), `Missing ${text}: ${document.body.textContent}`); await act(async () => button(text).click()) }
async function settle(predicate) { for (let i = 0; i < 500 && !predicate(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 10))); assert.ok(predicate(), document.body.textContent) }
async function send() {
  await settle(() => Boolean(document.querySelector('textarea[aria-label="Chat message"]')))
  const input = document.querySelector('textarea[aria-label="Chat message"]')
  await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(input, 'Please help'); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
  await click('Send')
}
async function fixture(limit) {
  const settings = ai.copyAiSettings(ai.initialAiSettings)
  settings.provider = 'fake'; settings.mainModel = 'fake/test'; settings.mainModelContextLength = 100000
  const { book } = await p.createBook(settings, 'Round test')
  let chat = await chatService.createChat(book.id)
  chat = await chatService.updateChat(chat.id, { maxModelRounds: limit, modelContextLength: 100000 })
  return { book, chat }
}
function view(f) { return h(ChatView, { bookId: f.book.id, chatId: f.chat.id, bookPromptValues: { title: f.book.title }, onChatChange() {}, onToast(message) { throw new Error(message) } }) }


const typesService = await moduleAt('lore-types-service')
const { LoreTypesManager, LoreTypeSelect } = await moduleAt('LoreTypesControls')
async function fill(input, value) { await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })) }) }
test('type controls create, assign, rename and explicitly retire a used custom type', async () => {
  const f = await fixture(8), entry = await p.createCodexEntry(f.book.id, 'Test entry')
  function Wrapper() {
    const [value, setValue] = React.useState(entry.typeId)
    return h(React.Fragment, null, h(LoreTypeSelect, { ownerId: f.book.id, value, onChange: async id => { await p.updateCodexCategory(entry.id, id); setValue(id) } }), h(LoreTypesManager, { bookId: f.book.id }))
  }
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(h(Wrapper)))
    await settle(() => Boolean(document.querySelector('.lore-types-manager label input')))
    await fill(document.querySelector('.lore-types-manager label input'), 'Creature')
    await click('Add lore type')
    await settle(() => [...document.querySelectorAll('select[aria-label="Lore type"] option')].some(option => option.textContent === 'Creature'))
    const type = (await typesService.getEffectiveLoreTypes(f.book.id)).find(item => item.name === 'Creature')
    const select = document.querySelector('select[aria-label="Lore type"]')
    await act(async () => { select.value = type.id; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    await settle(() => select.value === type.id)
    await click('Rename')
    await fill(document.querySelector('.lore-types-manager article input'), 'Species')
    await click('Save name')
    await settle(() => select.selectedOptions[0].textContent === 'Species')
    assert.equal((await p.getEntity(entry.id)).typeId, type.id)
    await click('Retire…')
    await settle(() => Boolean(button('Reassign and retire')))
    assert.match(document.querySelector('dialog').textContent, /1 entries and 0 templates/)
    assert.equal(button('Reassign and retire').disabled, true)
    await act(async () => { const replacement = document.querySelector('select[aria-label="Replacement lore type"]'); replacement.value = 'lore-other'; replacement.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    await click('Reassign and retire')
    await settle(() => !document.querySelector('dialog'))
    assert.equal((await p.getEntity(entry.id)).typeId, 'lore-other')
  } finally { await act(async () => root.unmount()) }
})

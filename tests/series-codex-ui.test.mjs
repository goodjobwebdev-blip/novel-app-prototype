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


const service = await moduleAt('series-codex-service')
const { metadataValues } = await moduleAt('chat-management-schema')
const { CodexScopeControls } = await moduleAt('SeriesCodexControls')
globalThis.MutationObserver = dom.window.MutationObserver
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
dom.window.Range.prototype.getClientRects = () => []
dom.window.Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 })
test('scope controls explicitly create an override, preview reset and save an explicit shared edit', async () => {
  const f = await fixture(8)
  const series = await p.createSeries('UI shared world')
  await p.updateBookMetadata(f.book.id, { ...metadataValues(f.book), seriesId: series.id })
  const local = await p.createCodexEntry(f.book.id, 'UI tower', 'Place')
  await p.saveDocumentContent(local.id, 'Shared original prose')
  const source = await service.promoteCodexToSeries(f.book.id, local.id)
  let current = await p.getEntity(local.id)
  function Wrapper() {
    const [entry, setEntry] = React.useState(current)
    return h(CodexScopeControls, { entry, seriesId: series.id, onBeforeChange: async () => {}, onRefresh: async () => { current = await p.getEntity(local.id); setEntry(current) } })
  }
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(h(Wrapper)))
    assert.match(document.body.textContent, /Inherited from series/)
    await click('Edit for this book')
    await settle(() => Boolean(button('Reset to series…')) && !button('Reset to series…').disabled)
    assert.equal((await p.getEntity(local.id)).codexScope, 'override')
    await act(async () => p.saveDocumentContent(local.id, 'Local prose to discard'))
    await click('Reset to series…')
    await settle(() => Boolean(button('Discard override and inherit')) && !button('Discard override and inherit').disabled)
    assert.match(document.querySelector('dialog').textContent, /Local prose to discard/)
    assert.match(document.querySelector('dialog').textContent, /Shared original prose/)
    await click('Discard override and inherit')
    await settle(() => Boolean(button('Edit for this book')) && !button('Edit for this book').disabled)
    assert.equal((await p.getEntity(local.id)).content, 'Shared original prose')
    await click('Edit series source')
    await settle(() => Boolean(document.querySelector('input[aria-label="Series entry title"]')))
    const title = document.querySelector('input[aria-label="Series entry title"]')
    await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(title, 'Changed shared title'); title.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
    await click('Save series changes')
    await settle(() => !document.querySelector('dialog'))
    assert.equal((await p.getEntity(source.id)).title, 'Changed shared title')
    assert.equal((await p.getEntity(local.id)).title, 'Changed shared title')
  } finally { await act(async () => root.unmount()) }
})

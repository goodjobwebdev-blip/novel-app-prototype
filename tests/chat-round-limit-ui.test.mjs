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

test('malformed stored limits resolve to eight; explicit invalid saves are rejected', () => {
  for (const value of [0, -1, 1.5, NaN, Infinity, '8', undefined, 33]) {
    assert.equal(normalizeChatRoundLimit(value), 8)
    assert.throws(() => validateChatRoundLimit(value), /whole number/)
  }
})

test('limits 1, 8 and 32 stop actual ChatView sends exactly at the configured model count', async () => {
  for (const limit of [1, 8, 32]) {
    const f = await fixture(limit)
    api.configure('tools', limit === 1 ? async () => { await chatService.updateChat(f.chat.id, { maxModelRounds: 32 }) } : undefined)
    const root = createRoot(document.getElementById('root'))
    try {
      await act(async () => root.render(view(f)))
      await send()
      await settle(() => Boolean(button('Continue')) && !button('Continue').disabled)
      assert.equal(api.calls.length, limit)
      const saved = await chatService.listChatMessages(f.book.id, f.chat.id)
      assert.equal(saved.at(-1).status, 'limited')
      assert.equal(saved.at(-1).continuation.maxRounds, limit)
      assert.equal(saved.at(-1).continuation.runtimeParts.filter(part => part.role === 'tool').length, limit)
      assert.equal(saved.filter(message => message.entityActions?.length).length, limit)
    } finally { await act(async () => root.unmount()) }
  }
})

test('reload then Continue sends saved results without recreating proposals and reflects edited values', async () => {
  const f = await fixture(1)
  api.configure('tools')
  let root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(view(f)))
    await send()
    await settle(() => Boolean(button('Continue')) && !button('Continue').disabled)
    const saved = await chatService.listChatMessages(f.book.id, f.chat.id)
    const last = saved.at(-1), proposal = last.entityActions[0]
    await chatService.saveChatProposalDraft(f.book.id, f.chat.id, last.id, 'entityActions', proposal.id, { newTitle: 'Writer edited title', content: 'Writer edited body' }, 0)
    await act(async () => root.unmount())
    root = createRoot(document.getElementById('root'))
    api.setMode('complete')
    await act(async () => root.render(view(f)))
    await settle(() => Boolean(button('Continue')))
    await click('Continue')
    await settle(() => api.calls.length === 2 && Boolean(button('Send')))
    const after = await chatService.listChatMessages(f.book.id, f.chat.id)
    assert.equal(after.filter(message => message.entityActions?.length).length, 1)
    assert.equal(after.at(-1).status, 'complete')
    assert.equal(api.calls[1].messages.filter(message => message.role === 'tool').length, 1)
    assert.match(JSON.stringify(api.calls[1].messages), /Writer edited title/)
    assert.match(JSON.stringify(api.calls[1].messages), /proposed/)
    await assert.rejects(() => chatService.claimChatContinuation(f.book.id, f.chat.id, last.id), /no longer available/)
  } finally { await act(async () => root.unmount()) }
})


test('several tools in one completion consume one round and all proposals survive', async () => {
  const f = await fixture(1)
  api.configure('tools', undefined, 2)
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(view(f)))
    await send()
    await settle(() => Boolean(button('Continue')) && !button('Continue').disabled)
    const saved = (await chatService.listChatMessages(f.book.id, f.chat.id)).at(-1)
    assert.equal(api.calls.length, 1)
    assert.equal(saved.entityActions.length, 2)
    assert.equal(saved.continuation.runtimeParts.filter(part => part.role === 'tool').length, 2)
  } finally { await act(async () => root.unmount()) }
})

test('new chats copy global rounds while saved and legacy chats remain predictable', async () => {
  const config = ai.copyAiSettings(ai.initialAiSettings)
  config.chatMaxModelRounds = 3
  ai.saveAiSettings(config)
  const { book } = await p.createBook(config, 'Default limit book')
  const first = await chatService.createChat(book.id)
  assert.equal(first.maxModelRounds, 3)
  config.chatMaxModelRounds = 9; ai.saveAiSettings(config)
  assert.equal((await chatService.createChat(book.id)).maxModelRounds, 9)
  assert.equal((await chatService.getChat(first.id)).maxModelRounds, 3)
  await p.putEntity({ ...first, maxModelRounds: undefined })
  assert.equal((await chatService.getChat(first.id)).maxModelRounds, 8)
  await assert.rejects(() => chatService.updateChat(first.id, { maxModelRounds: 1.5 }), /whole number/)
  ai.saveAiSettings(ai.initialAiSettings)
})


test('brainstorm selection and saved edits cause no request; explicit submission uses chosen values once', async () => {
  const f = await fixture(8)
  api.configure('brainstorm')
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(view(f)))
    await send()
    await settle(() => Boolean(button('Send selection')) && Boolean(button('Send')))
    assert.equal(api.calls.length, 2)
    await act(async () => document.querySelector('.chat-brainstorm input[type=checkbox]').click())
    await settle(() => !button('Generate more').disabled)
    const input = document.querySelector('textarea[aria-label="Your own brainstorm option"]')
    await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(input, 'Also look for footprints'); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
    await click('Save option edits')
    await settle(() => !button('Generate more').disabled)
    assert.equal(api.calls.length, 2)
    let history = await chatService.listChatMessages(f.book.id, f.chat.id)
    const card = history.find(message => message.brainstorms?.length).brainstorms[0]
    assert.equal(card.selectedIds.length, 1)
    assert.equal(card.customOption, 'Also look for footprints')
    await click('Send selection')
    await settle(() => api.calls.length === 3 && Boolean(button('Send')))
    history = await chatService.listChatMessages(f.book.id, f.chat.id)
    assert.equal(history.filter(message => message.role === 'user').length, 2)
    assert.match(history.filter(message => message.role === 'user').at(-1).content, /Explore\nFollow the river/)
    assert.match(history.filter(message => message.role === 'user').at(-1).content, /Also look for footprints/)
    assert.doesNotMatch(history.filter(message => message.role === 'user').at(-1).content, /Watch the gate/)
    await settle(() => !button('Generate more').disabled)
    await click('Generate more')
    await settle(() => api.calls.length === 4 && Boolean(button('Send')))
    assert.equal(document.querySelectorAll('.chat-brainstorm-options article').length, 2)
  } finally { await act(async () => root.unmount()) }
})

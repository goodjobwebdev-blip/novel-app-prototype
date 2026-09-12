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
dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
globalThis.ResizeObserver = class { constructor(callback) { this.callback = callback } observe() { this.callback() } disconnect() {} }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { act } = React
const directory = mkdtempSync(new URL('../node_modules/.arc-stop-ui-test-', import.meta.url))
for (const filename of readdirSync(new URL('../src/', import.meta.url)).filter(name => /\.tsx?$/.test(name))) {
  const source = readFileSync(new URL(`../src/${filename}`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
    .replace(/import ['"][^'"]+\.css['"];?/g, '')
    .replace(/(['"])(\.\/[^'"]+)\1/g, (_, quote, path) => `${quote}${path.replace(/\.tsx?$/, '')}.mjs${quote}`)
  writeFileSync(`${directory}/${filename.replace(/\.tsx?$/, '.mjs')}`, compiled)
}
const moduleAt = name => import(pathToFileURL(`${directory}/${name}.mjs`))
const p = await moduleAt('persistence')
const ai = await moduleAt('ai-settings')
const chatService = await moduleAt('chat-service')
const { ChatView } = await moduleAt('ChatFeature')
after(async () => { (await p.database()).close(); dom.window.close(); rmSync(directory, { recursive: true, force: true }) })
const button = text => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text)
const stopButton = () => document.querySelector('button[aria-label="Stop chat generation"]')
async function settle(predicate) {
  for (let i = 0; i < 100 && !predicate(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 10)))
  assert.ok(predicate(), document.body.textContent)
}
async function send(text) {
  await settle(() => Boolean(document.querySelector('textarea[aria-label="Chat message"]')))
  const input = document.querySelector('textarea[aria-label="Chat message"]')
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(input, text)
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  assert.ok(button('Send') && !button('Send').disabled)
  await act(async () => button('Send').click())
}
const encoder = new TextEncoder()
const event = delta => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`

for (const phase of ['sending', 'thinking', 'writing']) {
  test(`Chat Stop during ${phase} exits Stopping, keeps the partial response and allows another send`, async t => {
    const settings = ai.copyAiSettings(ai.initialAiSettings)
    Object.assign(settings, { provider: 'nanogpt', apiKey: 'test-only', baseUrl: 'https://provider.invalid/v1', mainModel: 'test', mainModelContextLength: 100000 })
    const { book } = await p.createBook(settings, 'Stop test')
    let chat = await chatService.createChat(book.id)
    chat = await chatService.updateChat(chat.id, { model: 'test', modelContextLength: 100000, thinking: true })
    let requests = 0, cancelled = 0, releaseHeaders
    const pendingHeaders = new Promise(resolve => { releaseHeaders = resolve })
    const firstResponse = new Response(new ReadableStream({
      start(controller) {
        if (phase === 'thinking') controller.enqueue(encoder.encode(event({ reasoning_content: 'Partial thought' })))
        if (phase === 'writing') controller.enqueue(encoder.encode(event({ reasoning_content: 'Partial thought', content: 'Partial answer' })))
      },
      cancel() { cancelled++; return new Promise(() => {}) },
    }))
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      assert.equal(url, 'https://provider.invalid/v1/chat/completions')
      assert.equal(init.method, 'POST')
      requests++
      if (requests === 1) return phase === 'sending' ? pendingHeaders : firstResponse
      return new Response(event({ content: 'New answer' }) + 'data: [DONE]\n\n')
    })
    const toasts = []
    const root = createRoot(document.getElementById('root'))
    try {
      await act(async () => root.render(React.createElement(ChatView, { bookId: book.id, chatId: chat.id, bookPromptValues: { title: book.title }, onChatChange() {}, onToast(message) { toasts.push(message) } })))
      await send('First message')
      await settle(() => requests === 1 && Boolean(stopButton()) && (phase === 'sending' || document.body.textContent.includes('Partial thought')))
      // Let the open response reach its pending read, without sending EOF or an abort from the mock.
      await act(async () => new Promise(resolve => setImmediate(resolve)))
      await act(async () => stopButton().click())
      await settle(() => Boolean(button('Send')) && !stopButton())
      assert.doesNotMatch(document.body.textContent, /Stopping/)
      let saved
      await act(async () => { saved = await chatService.listChatMessages(book.id, chat.id) })
      assert.equal(saved.filter(message => message.role === 'user').length, 1)
      const partials = saved.filter(message => message.role === 'assistant')
      assert.equal(partials.length, 1)
      assert.equal(partials[0].status, 'stopped')
      assert.equal(partials[0].content, phase === 'writing' ? 'Partial answer' : '')
      assert.equal(partials[0].thoughts, phase === 'sending' ? undefined : 'Partial thought')
      await send('Second message')
      await settle(() => requests === 2 && Boolean(button('Send')) && document.body.textContent.includes('New answer'))
      // A late response from the cancelled request cannot replace the new one.
      await act(async () => { releaseHeaders(firstResponse); await new Promise(resolve => setImmediate(resolve)) })
      let latest
      await act(async () => { latest = await chatService.listChatMessages(book.id, chat.id) })
      assert.equal(latest.at(-1).content, 'New answer')
      assert.equal(latest.at(-1).status, 'complete')
      assert.equal(latest.filter(message => message.role === 'assistant').length, partials.length + 1)
      assert.equal(cancelled, 1)
      assert.equal(firstResponse.body.locked, false)
      assert.deepEqual(toasts, [])
    } finally {
      releaseHeaders(firstResponse)
      await act(async () => root.unmount())
    }
  })
}

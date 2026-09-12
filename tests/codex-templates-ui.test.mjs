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


for (const key of ['Element', 'Node', 'MutationObserver', 'Window', 'DOMRect', 'Range']) globalThis[key] = dom.window[key]
globalThis.getComputedStyle = dom.window.getComputedStyle
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
dom.window.Range.prototype.getClientRects = () => []
dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect()
const { default: NoteRoles } = await moduleAt('NoteRoleControls')
const { default: Templates } = await moduleAt('CodexTemplates')
const { default: MarkdownEditor } = await moduleAt('MarkdownEditor')
const templateService = await moduleAt('codex-templates')
const templateBody = '## History\n\nKeep {{ author placeholder }} literal.\n\n| Detail | Guidance |\n| --- | --- |\n| Goal | Write here |'
const checkbox = text => [...document.querySelectorAll('label')].find(label => label.textContent.trim() === text)?.querySelector('input')
test('Note role controls coexist; Apply is one undoable editor change and preserves metadata', async () => {
  const f = await fixture(8), entry = await p.createCodexEntry(f.book.id, 'Existing canonical title'), note = await p.createNote(f.book.id, 'Not an inserted title')
  await p.saveDocumentContent(note.id, templateBody)
  let savedNote = await p.getEntity(note.id)
  let root = createRoot(document.getElementById('root'))
  function Roles() { const [value, setValue] = React.useState(savedNote); return h(NoteRoles, { note: value, onChange: next => { savedNote = next; setValue(next) } }) }
  await act(async () => root.render(h(Roles)))
  await act(async () => checkbox('Use as chat skill').click())
  await settle(() => checkbox('Use as chat skill').checked && !checkbox('Use as Codex template').disabled)
  await act(async () => checkbox('Use as Codex template').click())
  await settle(() => checkbox('Use as Codex template').checked && !checkbox('Use as Codex template').disabled)
  assert.equal(savedNote.useAsChatSkill, true); assert.equal(savedNote.useAsCodexTemplate, true); assert.equal(savedNote.content, templateBody)
  await act(async () => root.unmount())
  root = createRoot(document.getElementById('root'))
  const ref = React.createRef(); let saving = Promise.resolve()
  function Editor() {
    const [body, setBody] = React.useState('')
    return h(React.Fragment, null, h(Templates, { bookId: f.book.id, targetId: entry.id, typeId: entry.typeId, body, editor: ref }), h(MarkdownEditor, { ref, value: body, bookId: f.book.id, onChange: value => { setBody(value); saving = p.saveDocumentContent(entry.id, value) } }))
  }
  try {
    await act(async () => root.render(h(Editor)))
    await settle(() => document.querySelector('select[aria-label="Codex template Note"]')?.options.length === 2)
    await act(async () => { const select = document.querySelector('select[aria-label="Codex template Note"]'); select.value = note.id; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    await click('Apply template')
    await settle(() => ref.current.captureSelection().document === templateBody)
    await saving
    assert.equal(button('Apply template'), undefined)
    const saved = await p.getEntity(entry.id)
    for (const key of ['title', 'category', 'typeId', 'autoIncludeTriggers', 'primaryImageId', 'archivedAt']) assert.deepEqual(saved[key], entry[key])
    assert.equal(saved.content, templateBody)
    await act(async () => p.saveDocumentContent(note.id, 'New source content for future copies'))
    assert.equal(ref.current.captureSelection().document, templateBody)
    await act(async () => assert.equal(ref.current.undo(), true))
    await saving
    assert.equal(ref.current.captureSelection().document, '')
    assert.equal((await p.getEntity(entry.id)).content, '')
    assert.equal(api.calls.length, 0)
  } finally { await act(async () => root.unmount()) }
})
test('unsupported template media reports an error and leaves the empty editor untouched', async () => {
  const f = await fixture(8), entry = await p.createCodexEntry(f.book.id, 'Empty'), note = await p.createNote(f.book.id, 'Unsupported template')
  await p.saveDocumentContent(note.id, '![Portrait](portrait.png)')
  await templateService.setNoteTemplateOptions(f.book.id, note.id, { useAsCodexTemplate: true })
  const ref = React.createRef(), root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(h(React.Fragment, null, h(Templates, { bookId: f.book.id, targetId: entry.id, typeId: entry.typeId, body: '', editor: ref }), h(MarkdownEditor, { ref, value: '', onChange: () => { throw new Error('Unsupported template changed the editor') } }))))
    await settle(() => document.querySelector('select[aria-label="Codex template Note"]')?.options.length === 2)
    await act(async () => { const select = document.querySelector('select[aria-label="Codex template Note"]'); select.value = note.id; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    await click('Apply template')
    await settle(() => Boolean(document.querySelector('[role="alert"]')))
    assert.match(document.querySelector('[role="alert"]').textContent, /textual Markdown only/)
    assert.equal(ref.current.captureSelection().document, '')
    assert.equal((await p.getEntity(entry.id)).content, '')
  } finally { await act(async () => root.unmount()) }
})

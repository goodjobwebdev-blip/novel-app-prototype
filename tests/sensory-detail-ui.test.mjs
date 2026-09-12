import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { JSDOM } from 'jsdom'
import 'fake-indexeddb/auto'
const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'https://arc.test/', pretendToBeVisual: true })
for (const key of ['window','document','HTMLElement','sessionStorage','localStorage','Event','CustomEvent']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const directory = mkdtempSync(new URL('../node_modules/.arc-sensory-ui-', import.meta.url))
for (const filename of readdirSync(new URL('../src/', import.meta.url)).filter(name => /\.tsx?$/.test(name))) {
  const source = readFileSync(new URL(`../src/${filename}`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/import ['"][^'"]+\.css['"];?/g, '').replace(/(['"])(\.\/[^'"]+)\1/g, (_, quote, path) => `${quote}${path.replace(/\.tsx?$/, '')}.mjs${quote}`)
  writeFileSync(`${directory}/${filename.replace(/\.tsx?$/, '.mjs')}`, compiled)
}
const moduleAt = name => import(pathToFileURL(`${directory}/${name}.mjs`))
const p = await moduleAt('persistence')
const ai = await moduleAt('ai-settings')
const { default: QuickRewriteDialog } = await moduleAt('QuickRewriteDialog')
const { sensoryPrompts } = await moduleAt('prose-transformations')
const { encodeDocumentBlock } = await moduleAt('document-projection')
after(async () => { (await p.database()).close(); dom.window.close(); rmSync(directory, { recursive: true, force: true }) })
const h = React.createElement
const button = text => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text)
async function settle(predicate) { for (let i = 0; i < 100 && !predicate(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 10))); assert.ok(predicate(), document.body.textContent) }
async function input(text) { const field = document.querySelector('textarea'); await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(field, text); field.dispatchEvent(new dom.window.Event('input', { bubbles: true })) }) }
const idea = (sense, index = 1) => ({ sense, label: `${sense} idea ${index}`, text: `She paused, noticing ${sense} detail ${index}.` })

async function mount(t, { stale = false, toolId = 'sensory-detail' } = {}) {
  const settings = ai.copyAiSettings(ai.initialAiSettings)
  Object.assign(settings, { provider: 'nanogpt', apiKey: 'test-only', baseUrl: 'https://provider.invalid/v1', mainModel: 'test', mainModelContextLength: 100000 })
  const { book, scene } = await p.createBook(settings, 'Sensory UI')
  const text = 'She paused.'
  const capture = { bookId: book.id, book: { title: book.title }, document: scene, snapshot: { editorId: 'editor', revision: 1, document: text, from: 0, to: text.length, text } }
  const requests = [], sources = [], applied = []
  let closed = 0, cancelled = 0
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://provider.invalid/v1/chat/completions')
    requests.push(init)
    return new Response(new ReadableStream({ start(controller) { sources.push(controller) }, cancel() { cancelled++; return new Promise(() => {}) } }))
  })
  function Host() {
    const [open, setOpen] = React.useState(true)
    return open ? h(QuickRewriteDialog, { tool: { id: toolId, label: toolId === 'sensory-detail' ? 'Sensory detail' : 'Show, don’t tell', kind: 'rewrite', examples: [] }, capture, apply(value) { applied.push(value); return !stale }, close() { closed++; setOpen(false) } }) : h('p', null, 'Closed')
  }
  const root = createRoot(document.getElementById('root'))
  await act(async () => root.render(h(Host)))
  if (toolId === 'sensory-detail') await settle(() => requests.length === 1)
  const emit = async (items, index = sources.length - 1) => { await act(async () => { for (const item of items) sources[index].enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ choices: [{ delta: { content: JSON.stringify(item) + '\n' } }] }) + '\n\n')); await new Promise(resolve => setImmediate(resolve)) }) }
  return { root, requests, sources, applied, emit, get closed() { return closed }, get cancelled() { return cancelled } }
}

test('opening Sensory Detail starts one request and streams two clickable ideas into all seven groups', async t => {
  const f = await mount(t)
  try {
    assert.equal(document.querySelectorAll('.sensory-group').length, 7)
    assert.equal(button('Go'), undefined)
    assert.equal(document.querySelector('input[type=checkbox]'), null)
    await f.emit(sensoryPrompts.flatMap(sense => [idea(sense.id), idea(sense.id, 2)]))
    assert.equal(document.querySelectorAll('.sensory-chip-use').length, 14)
    assert.equal(f.requests.length, 1)
    assert.deepEqual(f.applied, [])
    assert.ok(button('Stop'), 'Ideas can be chosen while generation continues')
    await act(async () => button('sight idea 1').click())
    assert.deepEqual(f.applied, [idea('sight').text])
    assert.equal(f.closed, 1)
    assert.equal(f.requests[0].signal.aborted, true)
    assert.equal(f.cancelled, 1)
    assert.equal(document.querySelector('[role=dialog]'), null)
  } finally { await act(async () => f.root.unmount()) }
})

test('editing stays local during streaming and the edited chip applies the exact writer text', async t => {
  const f = await mount(t)
  try {
    await f.emit([idea('touch')])
    await act(async () => document.querySelector('button[aria-label="Edit touch idea 1"]').click())
    assert.equal(document.activeElement, document.querySelector('textarea'))
    const edited = 'Her fingers ached against the **cold** rail.'
    await input(edited)
    await f.emit([idea('sound')])
    assert.equal(document.querySelector('textarea').value, edited)
    await act(async () => button('Save edit').click())
    assert.deepEqual(f.applied, [])
    assert.equal(f.requests.length, 1)
    assert.equal(document.querySelector('textarea'), null)
    await act(async () => [...document.querySelectorAll('.sensory-chip-use')].find(item => item.title === edited).click())
    assert.deepEqual(f.applied, [edited])
  } finally { await act(async () => f.root.unmount()) }
})

test('Stop retains ideas, More ideas adds to them, and closing aborts without applying', async t => {
  const f = await mount(t)
  try {
    await f.emit([idea('sight')])
    await act(async () => button('Stop').click())
    assert.match(document.querySelector('[role=status]').textContent, /Stopped/)
    assert.ok(button('sight idea 1'))
    await act(async () => button('More ideas').click())
    await settle(() => f.requests.length === 2)
    await f.emit([idea('smell')])
    assert.ok(button('sight idea 1'))
    assert.ok(button('smell idea 1'))
    await act(async () => document.querySelector('[aria-label="Close sensory detail"]').click())
    assert.equal(f.cancelled, 2)
    assert.deepEqual(f.applied, [])
  } finally { await act(async () => f.root.unmount()) }
})

test('stale selections and invalid edits cannot silently replace the passage', async t => {
  const f = await mount(t, { stale: true })
  try {
    await f.emit([idea('taste')])
    await act(async () => button('taste idea 1').click())
    assert.match(document.querySelector('[role=alert]').textContent, /selected passage changed/)
    assert.equal(f.closed, 0)
    await act(async () => document.querySelector('[aria-label="Edit taste idea 1"]').click())
    await input(encodeDocumentBlock({ id: 'hidden', type: 'comment', text: 'Hidden' }))
    assert.equal(button('Use this variant').disabled, true)
    assert.equal(button('Save edit').disabled, true)
    await input('')
    assert.equal(button('Use this variant').disabled, true)
    await act(async () => button('Cancel edit').click())
    assert.equal(document.querySelector('textarea'), null)
    assert.equal(f.applied.length, 1)
  } finally { await act(async () => f.root.unmount()) }
})

test('an unusable model response can be retried without changing the selection', async t => {
  const f = await mount(t)
  try {
    await act(async () => { f.sources[0].enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Not JSON"}}]}\n\ndata: [DONE]\n\n')) })
    await settle(() => Boolean(button('Try again')))
    assert.match(document.querySelector('[role=alert]').textContent, /No new usable/)
    assert.deepEqual(f.applied, [])
    await act(async () => button('Try again').click())
    await settle(() => f.requests.length === 2)
    await f.emit([idea('movement')])
    await act(async () => button('movement idea 1').click())
    assert.deepEqual(f.applied, [idea('movement').text])
  } finally { await act(async () => f.root.unmount()) }
})

test('other rewrite tools retain their explicit Generate and Apply preview flow', async t => {
  const f = await mount(t, { toolId: 'show-dont-tell' })
  try {
    assert.equal(f.requests.length, 0)
    assert.equal(document.querySelector('.sensory-groups'), null)
    await act(async () => button('Go').click())
    await settle(() => f.requests.length === 1)
    const request = JSON.parse(f.requests[0].body)
    assert.match(request.messages[0].content, /Return replacement prose only/)
    assert.doesNotMatch(request.messages[0].content, /newline-delimited JSON/)
    await act(async () => { f.sources[0].enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"She gripped the rail."}}]}\n\ndata: [DONE]\n\n')) })
    await settle(() => Boolean(button('Apply replacement')) && !button('Apply replacement').disabled)
    assert.deepEqual(f.applied, [])
    await act(async () => button('Apply replacement').click())
    assert.deepEqual(f.applied, ['She gripped the rail.'])
  } finally { await act(async () => f.root.unmount()) }
})

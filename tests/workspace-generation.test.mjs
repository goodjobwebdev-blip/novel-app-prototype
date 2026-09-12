import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { JSDOM } from 'jsdom'
import 'fake-indexeddb/auto'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://arc.test/', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'CustomEvent', 'localStorage', 'sessionStorage', 'Element', 'Node', 'MutationObserver', 'Window', 'DOMRect', 'Range']) globalThis[key] = dom.window[key]
globalThis.getComputedStyle = dom.window.getComputedStyle
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
dom.window.Range.prototype.getClientRects = () => []
dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect()
dom.window.HTMLElement.prototype.scrollIntoView = function () {}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0)
globalThis.cancelAnimationFrame = clearTimeout
const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const directory = mkdtempSync(new URL('../node_modules/.workspace-generation-test-', import.meta.url))
for (const filename of readdirSync(new URL('../src/', import.meta.url)).filter(name => /\.tsx?$/.test(name))) {
  const source = readFileSync(new URL(`../src/${filename}`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
    .replace(/import ['"][^'"]+\.css['"];?/g, '')
    .replace(/(['"])(\.\/[^'"]+)\1/g, (_, quote, path) => `${quote}${path.replace(/\.tsx?$/, '')}.mjs${quote}`)
  writeFileSync(`${directory}/${filename.replace(/\.tsx?$/, '.mjs')}`, compiled)
}
const moduleAt = name => import(pathToFileURL(`${directory}/${name}.mjs`))
const p = await moduleAt('persistence')
const { initialAiSettings } = await moduleAt('ai-settings')
const { default: Workspace } = await moduleAt('Workspace')
after(async () => { (await p.database()).close(); dom.window.close(); rmSync(directory, { recursive: true, force: true }) })

async function settle(predicate) {
  for (let i = 0; i < 200 && !predicate(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 10)))
  assert.ok(predicate(), document.body.textContent)
}
async function click(element) { assert.ok(element, 'The requested control exists'); await act(async () => element.click()) }
const button = label => document.querySelector(`button[aria-label="${label}"]`)

const encoder = new TextEncoder()
const event = delta => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`
const generateButton = () => button('Generate')
const stopButton = () => button('Stop generation')
const { EditorView } = await import('@codemirror/view')
const view = () => EditorView.findFromDOM(document.querySelector('.cm-editor'))
async function openWorkspace(settings) {
  const { book, scene } = await p.createBook(settings, `Generation test ${crypto.randomUUID()}`)
  await p.saveDocumentContent(scene.id, 'Original scene.')
  const root = createRoot(document.getElementById('root'))
  await act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Workspace))))
  const bookButton = () => [...document.querySelectorAll('.library-book')].find(item => item.textContent.includes(book.title))
  await settle(bookButton)
  await click(bookButton())
  await settle(() => document.querySelector('.cm-editor') && generateButton())
  await act(async () => view().dispatch({ selection: { anchor: view().state.doc.length } }))
  return { root, scene, book }
}
async function waitSaved(sceneId, content) {
  for (let i = 0; i < 100; i++) {
    let saved
    await act(async () => { saved = await p.getEntity(sceneId); if (saved.content !== content) await new Promise(resolve => setTimeout(resolve, 10)) })
    if (saved.content === content && document.querySelector('.save-state.saved')) return
    await act(async () => new Promise(resolve => setTimeout(resolve, 10)))
  }
  assert.fail('The generated scene was not saved')
}
function settings() {
  return { ...initialAiSettings, provider: 'nanogpt', apiKey: 'test-only', baseUrl: 'https://provider.invalid/v1', mainModel: 'test', mainModelContextLength: 100000, generationWordDelayMs: '0' }
}

test('Generate streams into the real scene editor and becomes ready again', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(event({ content: 'New paragraph.\r\n\r\nAnother paragraph.' }) + 'data: [DONE]\n\n'))
  const { root, scene } = await openWorkspace(settings())
  try {
    const input = document.querySelector('textarea[aria-label="generation prompt"]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(input, 'Open the door.')
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    await click(generateButton())
    await settle(() => view().state.doc.toString().includes('Another paragraph.'))
    await settle(() => !stopButton())
    assert.doesNotMatch(document.body.textContent, /scene changed while generation/)
    await waitSaved(scene.id, view().state.doc.toString())
  } finally { await act(async () => root.unmount()) }
})

for (const phase of ['sending', 'thinking', 'writing', 'buffered']) {
  test(`Scene Stop during ${phase} releases a stalled provider, preserves text and allows Generate again`, async t => {
    let requests = 0, cancelled = 0, releaseHeaders
    const pendingHeaders = new Promise(resolve => { releaseHeaders = resolve })
    const response = new Response(new ReadableStream({
      start(controller) {
        if (phase === 'thinking') controller.enqueue(encoder.encode(event({ reasoning_content: 'Partial thought' })))
        if (phase === 'writing') controller.enqueue(encoder.encode(event({ content: 'Partial.\r\n' })))
        if (phase === 'buffered') {
          controller.enqueue(encoder.encode(event({ content: 'Partial. ' + 'Queued words. '.repeat(100) }) + 'data: [DONE]\n\n'))
          controller.close()
        }
      },
      cancel() { cancelled++; return new Promise(() => {}) },
    }))
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      assert.equal(url, 'https://provider.invalid/v1/chat/completions')
      assert.equal(init.method, 'POST')
      requests++
      if (requests === 1) return phase === 'sending' ? pendingHeaders : response
      return new Response(event({ content: 'Next passage.' }) + 'data: [DONE]\n\n')
    })
    const { root, scene } = await openWorkspace({ ...settings(), generationWordDelayMs: phase === 'buffered' ? '50' : '0' })
    try {
      await click(generateButton())
      await settle(() => requests === 1 && stopButton() && (!['writing', 'buffered'].includes(phase) || view().state.doc.toString().includes('Partial.')))
      await act(async () => new Promise(resolve => setImmediate(resolve)))
      const partial = view().state.doc.toString()
      await click(stopButton())
      await settle(() => generateButton() && !stopButton())
      assert.equal(view().state.doc.toString(), partial)
      assert.doesNotMatch(document.body.textContent, /Stopping|scene changed while generation/)
      await click(generateButton())
      await settle(() => requests === 2 && !stopButton() && view().state.doc.toString().includes('Next passage.'))
      const completed = view().state.doc.toString()
      assert.equal(completed, partial + (partial.endsWith('\n') ? '\n' : '\n\n') + 'Next passage.')
      await act(async () => { releaseHeaders(response); await new Promise(resolve => setImmediate(resolve)) })
      assert.equal(view().state.doc.toString(), completed)
      assert.equal(cancelled, phase === 'buffered' ? 0 : 1)
      assert.equal(response.body.locked, false)
      // The next completed generation also persists the stopped partial passage.
      await waitSaved(scene.id, completed)
    } finally {
      releaseHeaders(response)
      await act(async () => root.unmount())
    }
  })
}

test('a real edit during streaming stops the old run without losing the edit or leaving Stop stuck', async t => {
  let source, requests = 0
  t.mock.method(globalThis, 'fetch', async () => {
    requests++
    if (requests > 1) return new Response(event({ content: 'Fresh passage.' }) + 'data: [DONE]\n\n')
    return new Response(new ReadableStream({
      start(controller) { source = controller; controller.enqueue(encoder.encode(event({ content: 'Old generated passage. ' }))) },
      cancel() { return new Promise(() => {}) },
    }))
  })
  const { root, scene } = await openWorkspace(settings())
  try {
    await click(generateButton())
    await settle(() => view().state.doc.toString().includes('Old generated passage.'))
    await act(async () => {
      view().dispatch({ changes: { from: 0, to: view().state.doc.length, insert: 'My edit.' }, selection: { anchor: 8 } })
      source.enqueue(encoder.encode(event({ content: 'Obsolete continuation. ' })))
    })
    await settle(() => generateButton() && !stopButton())
    assert.equal(view().state.doc.toString(), 'My edit.')
    assert.match(document.body.textContent, /scene changed while generation/)
    await click(generateButton())
    await settle(() => requests === 2 && !stopButton() && view().state.doc.toString().includes('Fresh passage.'))
    assert.equal(view().state.doc.toString(), 'My edit.\n\nFresh passage.')
    await waitSaved(scene.id, view().state.doc.toString())
  } finally { await act(async () => root.unmount()) }
})

test('Stop releases the UI even if the final editor transaction throws', async t => {
  let requests = 0
  t.mock.method(globalThis, 'fetch', async () => {
    requests++
    if (requests > 1) return new Response(event({ content: 'Retry.' }) + 'data: [DONE]\n\n')
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(encoder.encode(event({ content: 'Partial. ' }))) },
      cancel() { return new Promise(() => {}) },
    }))
  })
  const { root, scene } = await openWorkspace(settings())
  try {
    await click(generateButton())
    await settle(() => view().state.doc.toString().includes('Partial.'))
    const editor = view(), originalDispatch = editor.dispatch
    let failCleanup = true
    t.mock.method(editor, 'dispatch', function (...specs) {
      // Simulate the cursor/history transaction failure that previously left
      // Workspace stuck in Stopping; all streaming still uses the real editor.
      if (failCleanup && specs.some(spec => spec.selection && !spec.changes)) {
        failCleanup = false
        throw new RangeError('Selection points outside of document')
      }
      return originalDispatch.apply(this, specs)
    })
    const partial = editor.state.doc.toString()
    await click(stopButton())
    await settle(() => generateButton() && !stopButton())
    assert.equal(failCleanup, false)
    assert.equal(editor.state.doc.toString(), partial)
    assert.match(document.body.textContent, /Selection points outside of document/)
    await click(generateButton())
    await settle(() => requests === 2 && !stopButton() && view().state.doc.toString().includes('Retry.'))
    await waitSaved(scene.id, view().state.doc.toString())
  } finally { await act(async () => root.unmount()) }
})

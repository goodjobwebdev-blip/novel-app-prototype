import test, { after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'https://arc.test/' })
for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'MutationObserver', 'DOMRect', 'Window', 'CustomEvent']) globalThis[key] = dom.window[key]
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
dom.window.Range.prototype.getClientRects = () => []
dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect()
globalThis.IS_REACT_ACT_ENVIRONMENT = true
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      for (const extension of ['.ts', '.tsx']) {
        const url = new URL(specifier + extension, context.parentURL)
        if (existsSync(fileURLToPath(url))) return nextResolve(url.href, context)
      }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true }
    if (/\.tsx?$/.test(url) && url.includes('/src/')) return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText }
    return nextLoad(url, context)
  },
})
const { act, createElement: h, createRef } = await import('react')
const { createRoot } = await import('react-dom/client')
const { EditorView } = await import('@codemirror/view')
const { default: MarkdownEditor } = await import('../src/MarkdownEditor.tsx')
const { default: UiSettingsPortal } = await import('../src/UiSettingsPortal.tsx')
const { loadUiSettings, saveUiSettings, defaultUiSettings, UI_SETTINGS_STORAGE_KEY, UI_SETTINGS_EVENT } = await import('../src/ui-settings.ts')
const created = []
const pause = () => new Promise(resolve => setTimeout(resolve, 25))
afterEach(async () => {
  await act(async () => { for (const root of created.splice(0)) root.unmount(); await pause() })
  document.body.replaceChildren()
  window.localStorage.clear()
})
after(() => dom.window.close())
function mount() {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); created.push(root)
  return { root, host }
}
const marked = host => [...host.querySelectorAll('.cm-dialogue')].map(node => node.textContent).join('')

test('dialogue styling toggles in place, updates while typing, and preserves source, selection and undo', async () => {
  const { root, host } = mount(), ref = createRef(), changes = []
  const source = 'Narration. “Hello, **Mara**.” Then silence.'
  const props = { ref, value: source, onChange: value => changes.push(value), highlightDialogue: true }
  await act(async () => { root.render(h(MarkdownEditor, props)); await pause() })
  const view = EditorView.findFromDOM(host.querySelector('.cm-editor'))
  assert.match(marked(host), /Hello,.*Mara/)
  const from = source.indexOf('Hello'), to = from + 5
  await act(async () => view.dispatch({ selection: { anchor: from, head: to } }))
  await act(async () => root.render(h(MarkdownEditor, { ...props, highlightDialogue: false })))
  assert.equal(EditorView.findFromDOM(host.querySelector('.cm-editor')), view)
  assert.equal(host.querySelector('.cm-dialogue'), null)
  assert.equal(view.state.selection.main.from, from)
  assert.equal(view.state.selection.main.to, to)
  assert.equal(view.state.doc.toString(), source)
  assert.deepEqual(changes, [])
  await act(async () => root.render(h(MarkdownEditor, props)))
  await act(async () => view.dispatch({ changes: { from, to, insert: 'Welcome' } }))
  assert.match(marked(host), /Welcome,.*Mara/)
  assert.equal(changes.at(-1), source.replace('Hello', 'Welcome'))
  await act(async () => root.render(h(MarkdownEditor, { ...props, highlightDialogue: false })))
  await act(async () => assert.equal(ref.current.undo(), true))
  assert.equal(view.state.doc.toString(), source, 'Toggling styling must not replace the edit history')
  await act(async () => root.render(h(MarkdownEditor, props)))
  await act(async () => assert.equal(ref.current.redo(), true))
  assert.match(marked(host), /Welcome,.*Mara/)
  const closing = view.state.doc.toString().indexOf('”')
  await act(async () => view.dispatch({ changes: { from: closing, to: closing + 1 } }))
  assert.equal(host.querySelector('.cm-dialogue'), null, 'An unfinished quote must not style narration')
  await act(async () => view.dispatch({ changes: { from: closing, insert: '”' } }))
  assert.match(marked(host), /Welcome/)
})

test('story highlights coexist with Markdown and Codex mentions while excluding code, comments and image metadata', async () => {
  const { root, host } = mount()
  const source = '“Hello, Mara.”\n\n`"inline code"`\n\n```text\n"fenced code"\n```\n\n<!-- "private comment" -->\n\n!["image alt"](image.png "image title")\n\n[link](https://example.com "link title")\n\n“Read `"literal"` aloud.”'
  const terms = [{ key: 'mara', text: 'Mara', entries: [] }]
  await act(async () => { root.render(h(MarkdownEditor, { value: source, onChange() {}, highlightDialogue: true, mentionTerms: terms, readOnly: true })); await pause() })
  const highlighted = marked(host)
  assert.match(highlighted, /Hello, Mara/)
  assert.match(highlighted, /Read .* aloud/)
  assert.doesNotMatch(highlighted, /code|private|image|link title|literal/)
  assert.equal(host.querySelector('.cm-codex-mention').textContent, 'Mara')
  assert.equal(EditorView.findFromDOM(host.querySelector('.cm-editor')).state.doc.toString(), source)
})

test('streamed dialogue becomes styled when its closing quotation arrives', async () => {
  const { root, host } = mount(), ref = createRef()
  await act(async () => root.render(h(MarkdownEditor, { ref, value: '', onChange() {}, highlightDialogue: true })))
  await act(async () => { assert.ok(ref.current.beginGeneration()); ref.current.appendGenerationChunk('“Stay') })
  assert.equal(host.querySelector('.cm-dialogue'), null)
  await act(async () => { ref.current.appendGenerationChunk(' here.”'); ref.current.finishGeneration('complete') })
  assert.equal(marked(host), 'Stay here.')
})

test('UI setting is opt-in, previews on/off, persists on remount, and survives theme changes', async () => {
  assert.equal(loadUiSettings().highlightDialogue, false)
  window.localStorage.setItem(UI_SETTINGS_STORAGE_KEY, JSON.stringify({ highlightDialogue: 'false' }))
  assert.equal(loadUiSettings().highlightDialogue, false)
  const target = document.createElement('div'); target.className = 'appearance-settings'; document.body.append(target)
  let { root } = mount()
  const toggle = () => [...target.querySelectorAll('label')].find(label => label.textContent.includes('Highlight dialogue')).querySelector('input')
  const events = []
  const listener = event => events.push(event.detail.highlightDialogue)
  window.addEventListener(UI_SETTINGS_EVENT, listener)
  try {
    await act(async () => { root.render(h(UiSettingsPortal)); await pause() })
    await act(async () => target.querySelector('#appearance-tab-editor').click())
    assert.equal(toggle().checked, false)
    assert.equal(target.querySelector('.ui-dialogue-preview .cm-dialogue'), null)
    await act(async () => toggle().click())
    assert.equal(loadUiSettings().highlightDialogue, true)
    assert.equal(target.querySelector('.ui-dialogue-preview .cm-dialogue').textContent, 'Tell me what happened.')
    assert.deepEqual(events, [true])
    await act(async () => saveUiSettings({ ...loadUiSettings(), activeThemeId: 'warm-paper' }))
    assert.equal(loadUiSettings().highlightDialogue, true)
    await act(async () => root.unmount()); created.splice(created.indexOf(root), 1)
    ;({ root } = mount())
    await act(async () => { root.render(h(UiSettingsPortal)); await pause() })
    assert.equal(toggle().checked, true)
    await act(async () => toggle().click())
    assert.equal(loadUiSettings().highlightDialogue, false)
    assert.equal(target.querySelector('.ui-dialogue-preview .cm-dialogue'), null)
    assert.equal(loadUiSettings().activeThemeId, 'warm-paper')
    assert.equal(defaultUiSettings.highlightDialogue, false)
  } finally { window.removeEventListener(UI_SETTINGS_EVENT, listener) }
})

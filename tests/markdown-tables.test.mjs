import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'https://arc.test/' })
for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'MutationObserver', 'DOMRect', 'Window']) globalThis[key] = dom.window[key]
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
const { act, createElement, createRef } = await import('react')
const { createRoot } = await import('react-dom/client')
const { EditorState } = await import('@codemirror/state')
const { ensureSyntaxTree } = await import('@codemirror/language')
const { EditorView } = await import('@codemirror/view')
const { markdown, markdownLanguage } = await import('@codemirror/lang-markdown')
const { markdownTableRanges } = await import('../src/markdown-tables.ts')
const { markdownTablePreview } = await import('../src/MarkdownTablePreview.tsx')
const { default: MarkdownEditor } = await import('../src/MarkdownEditor.tsx')
const { default: MarkdownTable } = await import('../src/MarkdownTable.tsx')
const { default: ReactMarkdown } = await import('react-markdown')
const { default: remarkGfm } = await import('remark-gfm')
const fixture = 'Intro\n\n| Name | Value |\n| :--- | ---: |\n| **Mira** | `12` |\n| A \\| B | ~~old~~ |\n\nAfter'
const created = []
const pause = () => new Promise((resolve) => setTimeout(resolve, 25))
afterEach(async () => { await act(async () => { for (const destroy of created.splice(0)) destroy(); await pause() }); document.body.replaceChildren() })
async function editor(doc = fixture, readOnly = false) {
  const parent = document.createElement('div'); document.body.append(parent)
  let view
  await act(async () => {
    view = new EditorView({ state: EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage }), markdownTablePreview, EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)] }), parent })
    await pause()
  })
  created.push(() => view.destroy())
  return view
}

test('GFM parser finds complete tables and ignores fenced code or incomplete delimiters', () => {
  const parse = (doc) => {
    const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
    assert.ok(ensureSyntaxTree(state, state.doc.length, 5000), 'Complete the parser before checking its ranges')
    return markdownTableRanges(state)
  }
  assert.equal(parse(fixture).length, 1)
  assert.equal(parse('```markdown\n' + fixture + '\n```').length, 0)
  assert.equal(parse('| A | B |\n| --').length, 0)
  assert.equal(parse('| A | B |\n| --- | --- |').length, 1)
  assert.equal(parse(fixture + '\n\n' + fixture).length, 2)
})

test('chat renderer keeps semantic table, alignment and inline Markdown inside a focusable scroll region', async () => {
  const parent = document.createElement('div'); document.body.append(parent)
  const root = createRoot(parent); created.push(() => root.unmount())
  await act(async () => { root.render(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm], components: { table: MarkdownTable } }, fixture)); await pause() })
  const region = parent.querySelector('.markdown-table-scroll')
  assert.equal(region.tabIndex, 0)
  assert.equal(region.getAttribute('role'), 'region')
  assert.equal(region.firstElementChild.tagName, 'TABLE')
  assert.equal(region.querySelectorAll('thead th').length, 2)
  assert.equal(region.querySelector('th:last-child').style.textAlign, 'right')
  assert.equal(region.querySelector('strong').textContent, 'Mira')
  assert.equal(region.querySelector('code').textContent, '12')
  assert.match(region.textContent, /A \| B/)
  assert.equal(region.querySelector('del').textContent, 'old')
})

test('editor previews tables without changing source and preserves the scroll element across selection changes', async () => {
  const view = await editor()
  const region = view.dom.querySelector('.markdown-table-scroll')
  assert.ok(region)
  region.scrollLeft = 80
  await act(async () => { view.dispatch({ selection: { anchor: fixture.length } }); await pause() })
  assert.equal(view.dom.querySelector('.markdown-table-scroll'), region)
  assert.equal(region.scrollLeft, 80)
  assert.equal(view.state.doc.toString(), fixture)
})

test('Edit table reveals raw Markdown; moving to prose restores the updated preview', async () => {
  const view = await editor()
  await act(async () => { view.dom.querySelector('.cm-table-edit').click(); await pause() })
  assert.equal(view.dom.querySelector('table'), null)
  assert.ok(view.hasFocus)
  const start = view.state.doc.toString().indexOf('Mira')
  await act(async () => { view.dispatch({ changes: { from: start, to: start + 4, insert: 'Nora' } }); await pause() })
  await act(async () => { view.dispatch({ selection: { anchor: view.state.doc.length } }); await pause() })
  assert.equal(view.dom.querySelector('table strong').textContent, 'Nora')
  assert.match(view.state.doc.toString(), /\*\*Nora\*\*/)
})

test('read-only and streamed tables render without allowing edits', async () => {
  const view = await editor('Intro\n\n| A | B |\n| --', true)
  assert.equal(view.dom.querySelector('table'), null)
  await act(async () => { view.dispatch({ changes: { from: view.state.doc.length, insert: '- | --- |\n| one | two |' } }); await pause() })
  assert.equal(view.dom.querySelector('td').textContent, 'one')
  assert.equal(view.dom.querySelector('.cm-table-edit'), null)
})

test('nested tables retain quote/list context and raw HTML stays inert', async () => {
  const view = await editor('> | A | B |\n> | --- | --- |\n> | <script>alert(1)</script> | okay |')
  assert.ok(view.dom.querySelector('blockquote table'))
  assert.equal(view.dom.querySelector('script'), null)
  assert.match(view.dom.querySelector('td').textContent, /<script>/)
})

test('the actual Story/Codex editor edits tables and retains undo/redo and generation handling', async () => {
  const parent = document.createElement('div'); document.body.append(parent)
  const root = createRoot(parent); created.push(() => root.unmount())
  const ref = createRef(); const changes = []
  await act(async () => { root.render(createElement(MarkdownEditor, { ref, value: fixture, onChange: (value) => changes.push(value) })); await pause() })
  const view = EditorView.findFromDOM(parent.querySelector('.cm-editor'))
  assert.ok(parent.querySelector('table'))
  await act(async () => { parent.querySelector('.cm-table-edit').click(); await pause() })
  const start = view.state.doc.toString().indexOf('Mira')
  await act(async () => { view.dispatch({ changes: { from: start, to: start + 4, insert: 'Nora' } }); await pause() })
  assert.match(changes.at(-1), /Nora/)
  await act(async () => { assert.equal(ref.current.undo(), true); await pause() })
  assert.match(view.state.doc.toString(), /Mira/)
  await act(async () => { assert.equal(ref.current.redo(), true); await pause() })
  assert.match(view.state.doc.toString(), /Nora/)
  await act(async () => {
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    assert.ok(ref.current.beginGeneration())
    ref.current.appendGenerationChunk('\n\n| New | Table |\n| --- | --- |\n| 1 | 2 |')
    ref.current.finishGeneration('complete')
    view.contentDOM.blur()
    await pause()
  })
  assert.equal(parent.querySelectorAll('table').length, 2)
})

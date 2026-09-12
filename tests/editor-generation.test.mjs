import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { buildSync } from 'esbuild'
import { JSDOM } from 'jsdom'
import 'fake-indexeddb/auto'
const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'https://arc.test/', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'Window', 'DOMRect', 'Range']) globalThis[key] = dom.window[key]
globalThis.getComputedStyle = dom.window.getComputedStyle
globalThis.localStorage = dom.window.localStorage
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
dom.window.Range.prototype.getClientRects = () => []
dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect()
const directory = mkdtempSync(new URL('../node_modules/.editor-generation-test-', import.meta.url))
buildSync({ entryPoints: [new URL('../src/MarkdownEditor.tsx', import.meta.url).pathname], jsx: 'automatic', bundle: true, packages: 'external', format: 'esm', outfile: `${directory}/editor.mjs`, loader: { '.css': 'empty' }, logLevel: 'silent' })
const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const { default: MarkdownEditor } = await import(pathToFileURL(`${directory}/editor.mjs`))
after(() => { dom.window.close(); rmSync(directory, { recursive: true, force: true }) })


async function mount(initial = 'Original.') {
  const root = createRoot(document.getElementById('root')), ref = React.createRef()
  const props = { ref, value: initial, onChange() {} }
  await act(async () => root.render(React.createElement(MarkdownEditor, props)))
  await act(async () => ref.current.placeCursor(initial.length))
  return { root, ref, props }
}
test('provider line endings keep generation document and positions in sync', async () => {
  const { root, ref } = await mount()
  try {
    await act(async () => {
      assert.ok(ref.current.beginGeneration())
      ref.current.appendGenerationChunk('First.\r\n\r\n')
      ref.current.appendGenerationChunk('Second.')
      assert.equal(ref.current.finishGeneration('complete').generatedText, 'First.\n\nSecond.')
    })
    assert.equal(ref.current.captureSelection().document, 'Original.\n\nFirst.\n\nSecond.')
  } finally { await act(async () => root.unmount()) }
})
test('finishing after the document changes cannot use stale cursor positions or overwrite it', async () => {
  for (const placement of ['append', 'replace']) {
    const { root, ref, props } = await mount()
    try {
      await act(async () => { ref.current.beginGeneration('generate', placement); ref.current.appendGenerationChunk('Generated passage.') })
      await act(async () => root.render(React.createElement(MarkdownEditor, { ...props, value: 'Edit.' })))
      await act(async () => assert.equal(ref.current.finishGeneration('cancelled').status, 'error'))
      assert.equal(ref.current.captureSelection().document, 'Edit.')
      await act(async () => assert.ok(ref.current.beginGeneration()))
    } finally { await act(async () => root.unmount()) }
  }
})

for (const placement of ['append', 'replace']) {
  test(`${placement}: line breaks split across chunks stay normalized, complete and undo as one passage`, async () => {
    const { root, ref } = await mount()
    try {
      await act(async () => {
        assert.ok(ref.current.beginGeneration('generate', placement))
        for (const chunk of ['One.\r', '', '\n', '\r', '\nTwo.\rThree.', '\nFour.']) ref.current.appendGenerationChunk(chunk)
        const result = ref.current.finishGeneration('complete')
        assert.equal(result.generatedText, 'One.\n\nTwo.\nThree.\nFour.')
        assert.equal(result.resultDocument, (placement === 'append' ? 'Original.\n\n' : '') + result.generatedText)
      })
      await act(async () => assert.equal(ref.current.undo(), true))
      assert.equal(ref.current.captureSelection().document, 'Original.')
      await act(async () => assert.equal(ref.current.redo(), true))
      await act(async () => {
        assert.ok(ref.current.beginGeneration('regenerate', placement))
        ref.current.appendGenerationChunk('New.\r\nEnding.')
        assert.equal(ref.current.finishGeneration('complete').status, 'complete')
      })
      assert.equal(ref.current.captureSelection().document, (placement === 'append' ? 'Original.\n\n' : '') + 'New.\nEnding.')
    } finally { await act(async () => root.unmount()) }
  })
}

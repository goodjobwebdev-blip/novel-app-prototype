import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'https://arc.test/' })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLTextAreaElement', 'Event']) globalThis[key] = dom.window[key]
// Native dialog lifecycle is supplied by the browser; JSDOM needs these hooks.
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0)
globalThis.cancelAnimationFrame = clearTimeout

const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { act } = React
const directory = mkdtempSync(new URL('../node_modules/.expandable-input-test-', import.meta.url))
const source = readFileSync(new URL('../src/ExpandableTextInput.tsx', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText
writeFileSync(`${directory}/ExpandableTextInput.mjs`, compiled)
const { default: ExpandableTextInput } = await import(pathToFileURL(`${directory}/ExpandableTextInput.mjs`))
after(() => { dom.window.close(); rmSync(directory, { recursive: true, force: true }) })

const button = (name) => [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === name || item.getAttribute('aria-label') === name)
async function click(name) {
  const target = button(name)
  assert.ok(target, `Button ${name} exists: ${document.body.textContent}`)
  await act(async () => target.click())
}
async function input(element, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(element, value)
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
}

function Harness({ applied, stopped, cancelled, captured }) {
  const [status, setStatus] = React.useState('idle')
  const targetRef = React.useRef(null)
  return React.createElement(ExpandableTextInput, {
    value: 'Compact value',
    onChange: (value) => applied.push(value),
    'aria-label': 'Test prompt',
    dialogTitle: 'Expanded test prompt',
    dictationStatus: status,
    onDictate: async (target) => {
      targetRef.current = target
      captured.push(target)
      setStatus('recording')
      return true
    },
    onStopDictation: () => stopped.push(true),
    onCancelDictation: () => {
      cancelled.push(true)
      targetRef.current?.setValue(targetRef.current.value)
      setStatus('cancelled')
    },
  })
}

test('expanded dictation targets the dialog draft and keeps recording controls above the modal', async () => {
  const applied = []
  const stopped = []
  const cancelled = []
  const captured = []
  const root = createRoot(document.getElementById('root'))
  let mounted = true
  try {
    await act(async () => root.render(React.createElement(Harness, { applied, stopped, cancelled, captured })))
    await click('Expand Test prompt')
    const expanded = document.querySelector('[aria-label="Expanded Test prompt"]')
    await input(expanded, 'Alpha beta')
    expanded.setSelectionRange(6, 10)

    await click('Dictation')
    assert.match(document.querySelector('.expandable-dictation-status').textContent, /Listening/)
    assert.ok(button('Stop dictation'))
    assert.ok(button('Cancel dictation'))
    assert.equal(button('Apply').disabled, true)
    assert.equal(captured[0].value, 'Alpha beta')
    assert.equal(captured[0].selectionStart, 6)
    assert.equal(captured[0].selectionEnd, 10)

    await act(async () => { captured[0].setValue('Alpha voice') })
    assert.equal(document.querySelector('.expandable-text-dialog textarea').value, 'Alpha voice')
    assert.deepEqual(applied, [])

    await click('Stop dictation')
    assert.equal(stopped.length, 1)

    await act(async () => {
      const target = document.querySelector('.expandable-text-dialog textarea')
      assert.equal(target.readOnly, true)
    })
    assert.deepEqual(applied, [])

    await click('Cancel dictation')
    assert.equal(cancelled.length, 1)
    assert.equal(document.querySelector('.expandable-text-dialog textarea').value, 'Alpha beta')
    assert.ok(button('Dictation'))

    await input(document.querySelector('.expandable-text-dialog textarea'), 'Alpha final')
    await click('Apply')
    assert.deepEqual(applied, ['Alpha final'])
    assert.equal(document.querySelector('.expandable-text-dialog'), null)

    await click('Expand Test prompt')
    await click('Dictation')
    await act(async () => root.unmount())
    mounted = false
    assert.equal(cancelled.length, 2)
  } finally {
    if (mounted) await act(async () => root.unmount())
  }
})


test('closing invalidates delayed transcription and start failures stay inside the dialog', async () => {
  const applied = [], stopped = [], cancelled = [], captured = []
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(React.createElement(Harness, { applied, stopped, cancelled, captured })))
    await click('Expand Test prompt')
    await click('Dictation')
    await click('Close expanded editor')
    assert.equal(captured[0].isValid(), false)
    assert.equal(captured[0].setValue('Late transcript'), false)
    assert.deepEqual(applied, [])
    await act(async () => root.render(React.createElement(ExpandableTextInput, {
      value: 'Saved', onChange: (value) => applied.push(value), 'aria-label': 'Failure prompt',
      onDictate: async () => { throw new Error('Microphone permission denied') },
    })))
    await click('Expand Failure prompt')
    await click('Dictation')
    assert.match(document.querySelector('[role="dialog"] [role="alert"]').textContent, /permission denied/)
    assert.equal(button('Apply').disabled, false)
    assert.deepEqual(applied, [])
  } finally { await act(async () => root.unmount()) }
})

test('expanded drafts survive keyboard viewport changes and retain prompt hints', async () => {
  const viewport = new dom.window.EventTarget()
  viewport.height = 760
  viewport.offsetTop = 0
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
  const applied = []
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(React.createElement(ExpandableTextInput, {
      value: 'Original prompt', onChange: value => applied.push(value),
      'aria-label': 'Media prompt', placeholder: 'Describe your image or video…', maxLength: 32000,
    })))
    await click('Expand Media prompt')
    const backdrop = document.querySelector('.expandable-text-backdrop')
    const expanded = document.querySelector('[aria-label="Expanded Media prompt"]')
    assert.equal(expanded.placeholder, 'Describe your image or video…')
    assert.equal(expanded.maxLength, 32000)
    await input(expanded, 'A moonlit harbor')
    viewport.height = 330
    viewport.offsetTop = 25
    await act(async () => viewport.dispatchEvent(new dom.window.Event('resize')))
    assert.equal(backdrop.style.getPropertyValue('--expanded-viewport-height'), '330px')
    assert.equal(backdrop.style.getPropertyValue('--expanded-viewport-top'), '25px')
    assert.equal(expanded.value, 'A moonlit harbor')
    await click('Apply')
    assert.deepEqual(applied, ['A moonlit harbor'])
    assert.equal(document.querySelector('[role="dialog"]'), null)
    viewport.height = 760
    await act(async () => viewport.dispatchEvent(new dom.window.Event('resize')))
    assert.equal(backdrop.style.getPropertyValue('--expanded-viewport-height'), '330px', 'Closed dialog no longer listens to the viewport')
  } finally {
    await act(async () => root.unmount())
    delete window.visualViewport
  }
})

import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync, renameSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { JSDOM } from 'jsdom'
import 'fake-indexeddb/auto'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://arc.test/' })
for (const key of ['window', 'document', 'HTMLElement', 'Event', 'CustomEvent', 'localStorage']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0)
globalThis.cancelAnimationFrame = clearTimeout
const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const directory = mkdtempSync(new URL('../node_modules/.media-dictation-test-', import.meta.url))
for (const filename of readdirSync(new URL('../src/', import.meta.url)).filter(name => /\.tsx?$/.test(name))) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../src/${filename}`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText.replace(/import ['"][^'"]+\.css['"];?/g, '')
    .replace(/(['"])(\.\/[^'"]+)\1/g, (_, quote, path) => `${quote}${path.replace(/\.tsx?$/, '')}.mjs${quote}`)
  writeFileSync(`${directory}/${filename.replace(/\.tsx?$/, '.mjs')}`, compiled)
}
// Exercise the real media editor and popup with deterministic speech events.
renameSync(`${directory}/stt-service.mjs`, `${directory}/stt-original.mjs`)
writeFileSync(`${directory}/stt-service.mjs`, `
export { normalizeTranscriptForInsertion } from './stt-original.mjs';
import { parseTranscriptionModelId } from './stt-original.mjs';
let state = { status: 'idle', target: null }, target;
const listeners = new Set();
export let starts = [], stops = 0, cancels = 0;
const emit = status => { state = { status, target: target.kind, presentation: target.presentation }; listeners.forEach(listener => listener(state)); };
export const getSttState = () => state;
export function subscribeSttState(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); }
export async function startSttSession(settings, next) {
  if (!parseTranscriptionModelId(settings.transcriptionModel)) throw new Error('Choose a transcription model in Speech settings.');
  target = next; starts.push({ settings, target }); emit('recording-live');
}
export function provisional(text) { target.onProvisional(text); }
export function stopSttSession() { stops++; target.onFinal('moonlit'); emit('completed'); }
export function cancelSttSession() { cancels++; target.onCancel(); emit('cancelled'); }
`)
const moduleAt = name => import(pathToFileURL(`${directory}/${name}.mjs`))
const p = await moduleAt('persistence')
const ai = await moduleAt('ai-settings')
const stt = await moduleAt('stt-service')
const { default: MediaPromptEditor } = await moduleAt('MediaPromptEditor')
after(async () => { (await p.database()).close(); dom.window.close(); rmSync(directory, { recursive: true, force: true }) })
const h = React.createElement
const findButton = label => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === label || item.getAttribute('aria-label') === label)
async function click(label) { const button = findButton(label); assert.ok(button, label); await act(async () => button.click()) }
async function settle(predicate) {
  for (let i = 0; i < 100 && !predicate(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 10)))
  assert.ok(predicate(), document.body.textContent)
}
const expanded = () => document.querySelector('[aria-label="Expanded Original media prompt"]')
const compact = () => document.querySelector('[aria-label="Original media prompt"]')
function Harness({ bookId }) {
  const [value, setValue] = React.useState({ prompt: 'A red harbor', alias: '', size: '1024x1024' })
  return h(MediaPromptEditor, { key: bookId ?? 'global', bookId, value, onChange: setValue, capability: 'Still image' })
}
function settings(model) {
  const value = ai.copyAiSettings(ai.initialAiSettings)
  value.speech.transcriptionModel = model
  return value
}

test('media popup dictation uses book Speech settings, replaces the selection and applies only on Apply', async () => {
  ai.saveAiSettings(settings('openai:global-model'))
  const { book } = await p.createBook(settings('openai:book-model'), 'Dictation book')
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(h(Harness, { bookId: book.id })))
    await click('Expand Original media prompt')
    expanded().setSelectionRange(2, 5)
    await click('Dictation')
    await settle(() => stt.starts.length > 0)
    assert.equal(stt.starts.at(-1).settings.transcriptionModel, 'openai:book-model')
    assert.equal(stt.starts.at(-1).target.kind, 'media-prompt')
    assert.equal(stt.starts.at(-1).target.presentation, 'expanded')
    assert.equal(expanded().readOnly, true)
    assert.equal(findButton('Apply').disabled, true)
    await act(async () => stt.provisional('foggy'))
    assert.equal(expanded().value, 'A foggy harbor')
    assert.equal(compact().value, 'A red harbor')
    await click('Stop dictation')
    assert.equal(stt.stops, 1)
    assert.equal(expanded().value, 'A moonlit harbor')
    assert.equal(findButton('Apply').disabled, false)
    await click('Dictation')
    await settle(() => stt.starts.length === 2)
    assert.ok(findButton('Stop dictation'), 'Recording controls remain available when dictating again')
    assert.equal(findButton('Apply').disabled, true)
    await click('Cancel dictation')
    await click('Apply')
    assert.equal(compact().value, 'A moonlit harbor')
  } finally { await act(async () => root.unmount()) }
})

test('global media dictation cancels provisional text and closes or unmounts without a live target', async () => {
  ai.saveAiSettings(settings('openai:global-model'))
  const root = createRoot(document.getElementById('root'))
  let mounted = true
  try {
    await act(async () => root.render(h(Harness)))
    await click('Expand Original media prompt')
    await click('Dictation')
    assert.equal(stt.starts.at(-1).settings.transcriptionModel, 'openai:global-model')
    await act(async () => stt.provisional('at night'))
    await click('Cancel dictation')
    assert.equal(expanded().value, 'A red harbor')
    assert.equal(compact().value, 'A red harbor')
    await click('Dictation')
    const closedTarget = stt.starts.at(-1).target
    await click('Close expanded editor')
    assert.equal(closedTarget.isValid(), false)
    assert.throws(() => closedTarget.onFinal('Late transcript'), /no longer available/)
    assert.equal(compact().value, 'A red harbor')
    await click('Expand Original media prompt')
    await click('Dictation')
    const unmountedTarget = stt.starts.at(-1).target
    const before = stt.cancels
    await act(async () => root.unmount()); mounted = false
    assert.equal(stt.cancels, before + 1)
    assert.equal(unmountedTarget.isValid(), false)
  } finally { if (mounted) await act(async () => root.unmount()) }
})

test('missing Speech configuration shows an error inside the popup and keeps the prompt', async () => {
  ai.saveAiSettings(settings('not-configured'))
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(h(Harness)))
    await click('Expand Original media prompt')
    await click('Dictation')
    assert.match(document.querySelector('[role="dialog"] [role="alert"]').textContent, /Choose a transcription model/)
    assert.equal(expanded().value, 'A red harbor')
    assert.equal(findButton('Apply').disabled, false)
    assert.equal(compact().value, 'A red harbor')
  } finally { await act(async () => root.unmount()) }
})

import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { JSDOM } from 'jsdom'
import 'fake-indexeddb/auto'

const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'https://arc.test/' })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLDialogElement', 'sessionStorage', 'localStorage', 'Event', 'CustomEvent']) globalThis[key] = dom.window[key]
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
const p = await moduleAt('persistence')
const settings = await moduleAt('image-settings')
const store = await moduleAt('image-store')
const { executeImageProposal } = await moduleAt('image-tools')
const { runImageQueue } = await moduleAt('image-queue')
const { initialAiSettings } = await moduleAt('ai-settings')
const { createChat, createChatMessage } = await moduleAt('chat-service')
const { default: Card } = await moduleAt('ImageProposalCard')
const { default: Panel } = await moduleAt('ImagePanel')
after(async () => { (await p.database()).close(); dom.window.close(); rmSync(directory, { recursive: true, force: true }) })
const h = React.createElement
const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text || b.getAttribute('aria-label') === text)
async function click(text) { const target = button(text); assert.ok(target, `Button ${text} exists: ${document.body.textContent}`); await act(async () => target.click()) }
async function settle(predicate) { for (let i = 0; i < 100 && !predicate(); i++) await act(async () => new Promise((resolve) => setTimeout(resolve, 10))); assert.ok(predicate(), document.body.textContent) }
async function input(element, value) {
  await act(async () => {
    const proto = element instanceof dom.window.HTMLTextAreaElement ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value)
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
}
const png = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6AAAAAElFTkSuQmCC', 'base64')], { type: 'image/png' })
const deps = { key: async () => 'fixture', generate: async () => ({ image: png }), prepare: async () => ({ image: png, thumbnail: png, width: 1, height: 1 }) }
function configure() {
  const favorites = settings.documentedImageModels.filter((m) => ['gpt-image-1', 'p-image'].includes(m.id)).map((m) => settings.imageFavorite(m, []))
  favorites[0].alias = 'Portrait'; favorites[1].alias = 'Fast'
  settings.saveImageSettings({ favorites, keys: { openai: '', nanogpt: '', pruna: '' }, defaultAlias: 'Portrait' })
}

test('editable chat proposal → repeated generation → navigate → keep → collapse → zoom → remove from chat', async () => {
  configure()
  const { book } = await p.createBook(initialAiSettings, 'First book')
  const conversation = await createChat(book.id)
  const proposal = executeImageProposal({ id: 'call', type: 'function', function: { name: 'propose_image_generation', arguments: JSON.stringify({ prompt: 'Original gate' }) } }).imageGeneration
  const message = await createChatMessage(conversation, 'assistant', '', { imageGenerations: [proposal] })
  let root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(h(Card, { message, proposal })))
    assert.equal(document.querySelector('textarea'), null)
    await click('Open generation tool')
    await settle(() => Boolean(document.querySelector('textarea')))
    await input(document.querySelector('textarea'), 'Edited moonlit gate')
    await click('Close tool')
    await settle(() => !document.querySelector('textarea'))
    assert.equal(document.querySelector('textarea'), null)
    assert.equal((await p.getEntity(message.id)).imageGenerations[0].draft.prompt, 'Edited moonlit gate')
    await click('Open generation tool')
    await settle(() => Boolean(document.querySelector('textarea')))
    assert.equal(document.querySelector('textarea').value, 'Edited moonlit gate')
    await click('Portrait')
    await input(document.querySelector('input[type=search]'), 'Fast')
    assert.equal(document.querySelectorAll('.image-model-options button').length, 1)
    await act(async () => document.querySelector('.image-model-options button').click())
    await act(async () => { const select = document.querySelector('select'); select.value = '1344x768'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    assert.equal(button('Accept proposal'), undefined)
    assert.ok(button('Generate'))
    assert.equal((await store.listImageJobs()).length, 0)
    await click('Generate')
    await settle(() => button('Generate') && !button('Generate').disabled)
    await click('Generate')
    await settle(() => document.querySelectorAll('.image-job').length === 2)
    const before = await store.listImageJobs()
    assert.ok(before.every((j) => j.prompt === 'Edited moonlit gate' && j.provider === 'pruna' && j.size.value === '1344x768'))
    assert.ok(document.querySelector('dialog[aria-label="Generation tool"] .image-proposal-queue'))
    // Unmount the chat, as navigation does, while its durable jobs run.
    await act(async () => root.unmount())
    await runImageQueue('pruna', deps)
    root = createRoot(document.getElementById('root'))
    await act(async () => root.render(h(Card, { message: await p.getEntity(message.id), proposal })))
    await settle(() => Boolean(button('Keep image')))
    assert.ok(button('Open generation tool'))
    await click('Keep image')
    await settle(() => document.body.textContent.includes('Saved to gallery'))
    await click('Discard')
    await settle(() => document.body.textContent.includes('Image discarded'))
    assert.equal((await store.listGalleryImages(book.id)).length, 1)
    await click('View image and prompt')
    await settle(() => Boolean(document.querySelector('dialog[open]')))
    assert.match(document.querySelector('dialog').textContent, /Edited moonlit gate/)
    assert.match(document.querySelector('dialog').textContent, /1344x768/)
    await click('Close image')
    await click('Remove from chat')
    await settle(() => !button('View image and prompt'))
    assert.equal((await store.listGalleryImages(book.id)).length, 1)
  } finally { await act(async () => root.unmount()) }
})

test('gallery includes other books and current uploads; Only this book filters them', async () => {
  configure()
  const { book } = await p.createBook(initialAiSettings, 'Second book')
  const entry = await p.createCodexEntry(book.id, 'Uploaded entry', 'Character')
  await p.saveIllustration(entry.id, { image: png, thumbnail: png, width: 1, height: 1 }, { caption: 'Uploaded image', alt: '', cropX: 50, cropY: 50 })
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(h(Panel, { bookId: book.id, ai: initialAiSettings })))
    await click('Gallery')
    await settle(() => document.querySelectorAll('.image-gallery-grid article').length === 2)
    await act(async () => document.querySelector('.image-gallery-tools input[type=checkbox]').click())
    await settle(() => document.querySelectorAll('.image-gallery-grid article').length === 1)
    assert.match(document.querySelector('.image-gallery-grid').textContent, /Uploaded image/)
  } finally { await act(async () => root.unmount()) }
})

test('image settings save selected model aliases and enabled sizes; invalid defaults stay unsaved', async () => {
  localStorage.removeItem(settings.IMAGE_SETTINGS_KEY)
  localStorage.setItem('arc-image-catalog-v1', 'null')
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(h(Panel, { ai: initialAiSettings })))
    await click('Settings')
    await act(async () => { const select = document.querySelector('select'); select.value = 'pruna'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    await click('Favorite')
    await input(document.querySelector('.image-favorite input:not([type])'), 'Fast art')
    await click('Save image settings *')
    assert.equal(settings.loadImageSettings().favorites[0].alias, 'Fast art')
    assert.equal(settings.loadImageSettings().favorites[0].defaultSize, '1024x1024')
    await act(async () => { for (const box of document.querySelectorAll('.image-favorite input[type=checkbox]')) box.click() })
    await click('Save image settings *')
    assert.match(document.querySelector('[role=alert]').textContent, /Enable at least one size/)
    assert.ok(settings.loadImageSettings().favorites[0].enabledSizes.length > 0)
  } finally { await act(async () => root.unmount()) }
})


test('OpenAI favorite quality and moderation controls default to low and persist edits', async () => {
  configure()
  let root = createRoot(document.getElementById('root'))
  const selectIn = (article, text) => [...article.querySelectorAll('label')].find((label) => label.textContent.startsWith(text))?.querySelector('select')
  try {
    await act(async () => root.render(h(Panel, { ai: initialAiSettings })))
    await click('Settings')
    const [openai, pruna] = document.querySelectorAll('.image-favorite')
    const quality = selectIn(openai, 'Image quality'), moderation = selectIn(openai, 'Image moderation')
    assert.equal(quality.value, 'low')
    assert.equal(moderation.value, 'low')
    assert.deepEqual([...quality.options].map((o) => o.value), ['low', 'medium', 'high', 'auto'])
    assert.deepEqual([...moderation.options].map((o) => o.value), ['low', 'auto'])
    assert.equal(selectIn(pruna, 'Image quality'), undefined)
    assert.equal(selectIn(pruna, 'Image moderation'), undefined)
    await act(async () => { quality.value = 'medium'; quality.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    await act(async () => { moderation.value = 'auto'; moderation.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    await click('Save image settings *')
    await act(async () => root.unmount())
    root = createRoot(document.getElementById('root'))
    await act(async () => root.render(h(Panel, { ai: initialAiSettings })))
    await click('Settings')
    const favorite = document.querySelector('.image-favorite')
    assert.equal(selectIn(favorite, 'Image quality').value, 'medium')
    assert.equal(selectIn(favorite, 'Image moderation').value, 'auto')
    const queued = await store.enqueueImageJob(settings.resolveImageSpec('Configured illustration'))
    assert.equal(queued.quality, 'medium')
    assert.equal(queued.moderation, 'auto')
  } finally { await act(async () => root.unmount()) }
})


test('image choices keep compact checkbox geometry under shared settings styles', async () => {
  configure()
  const style = document.createElement('style')
  // Match the app's cascade: component styles load before global form rules.
  style.textContent = ['image-generation.css', 'styles.css', 'ui-settings.css', 'mobile-control-hardening.css', 'ai-settings-ux.css']
    .map((file) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')).join('\n')
  document.head.append(style)
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(h(Panel, { ai: initialAiSettings })))
    await click('Settings')
    const favorite = document.querySelector('.image-favorite')
    for (const control of favorite.querySelectorAll('input[type=checkbox], input[type=radio]')) {
      const geometry = dom.window.getComputedStyle(control)
      assert.equal(geometry.width, '20px')
      assert.equal(geometry.height, '20px')
      assert.equal(geometry.flexShrink, '0')
      assert.equal(parseFloat(geometry.minHeight), 0)
    }
    const tile = favorite.querySelector('.image-size-option')
    const checkbox = tile.querySelector('input')
    assert.ok(checkbox.checked)
    await act(async () => tile.querySelector('strong').click())
    assert.equal(checkbox.checked, false)
    assert.match(favorite.querySelector('legend').textContent, /2 selected/)
    assert.match(document.querySelector('.image-settings-save').textContent, /Unsaved changes/)
  } finally { await act(async () => root.unmount()); style.remove() }
})


test('remove and clear queue cover earlier history and stay cleared after reopening', async () => {
  configure()
  const db = await p.database()
  await db.table('imageJobs').clear()
  await db.table('galleryImages').clear()
  const spec = settings.resolveImageSpec('Failed illustration')
  await db.table('imageJobs').bulkPut(Array.from({ length: 33 }, (_, i) => ({ ...spec, id: `failed-${i}`, createdAt: i, status: 'failed', error: 'Rejected' })))
  let root = createRoot(document.getElementById('root'))
  const originalConfirm = window.confirm
  window.confirm = () => { throw new Error('Failed-only cleanup should not need confirmation') }
  try {
    await act(async () => root.render(h(Panel, { ai: initialAiSettings })))
    await settle(() => document.querySelectorAll('.image-job').length === 30)
    await click('Remove from queue')
    await settle(() => document.querySelector('.image-queue-actions').textContent.includes('32 generations'))
    await click('Clear queue')
    await settle(() => document.body.textContent.includes('Your generation queue is empty.'))
    assert.equal(button('Show earlier generations'), undefined)
    assert.ok((await store.listImageJobs()).every((j) => j.hiddenInQueue))
    await act(async () => root.unmount())
    root = createRoot(document.getElementById('root'))
    await act(async () => root.render(h(Panel, { ai: initialAiSettings })))
    await settle(() => document.body.textContent.includes('Your generation queue is empty.'))
    assert.equal(document.querySelectorAll('.image-job').length, 0)
  } finally { window.confirm = originalConfirm; await act(async () => root.unmount()) }
})

test('clear queue requires confirmation for active work and preserves kept gallery results', async () => {
  configure()
  const db = await p.database()
  await db.table('imageJobs').clear()
  await db.table('galleryImages').clear()
  const kept = await store.enqueueImageJob(settings.resolveImageSpec('Keep this illustration'))
  await store.enqueueImageJob(settings.resolveImageSpec('Unwanted illustration'))
  await runImageQueue('openai', deps)
  await store.decideImageJob(kept.id, true)
  const queued = await store.enqueueImageJob(settings.resolveImageSpec('Still queued'))
  const expectedGalleryCount = (await store.listGalleryImages()).length
  const originalConfirm = window.confirm
  let accepted = false, confirmations = 0
  window.confirm = () => { confirmations++; return accepted }
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(h(Panel, { ai: initialAiSettings })))
    await settle(() => document.querySelectorAll('.image-job').length === 3)
    await click('Clear queue')
    assert.equal(confirmations, 1)
    assert.equal(document.querySelectorAll('.image-job').length, 3)
    accepted = true
    await click('Clear queue')
    await settle(() => document.body.textContent.includes('Your generation queue is empty.'))
    assert.equal((await store.listImageJobs()).find((j) => j.id === queued.id).status, 'cancelled')
    assert.equal(await db.table('galleryImages').count(), 1)
    await click('Gallery')
    await settle(() => document.querySelectorAll('.image-gallery-grid article').length === expectedGalleryCount)
    assert.match(document.querySelector('.image-gallery-grid').textContent, /Keep this illustration/)
  } finally { window.confirm = originalConfirm; await act(async () => root.unmount()) }
})

test('discard removes an unwanted result from the generation queue immediately', async () => {
  configure()
  const db = await p.database()
  await db.table('imageJobs').clear()
  await db.table('galleryImages').clear()
  await store.enqueueImageJob(settings.resolveImageSpec('Unwanted illustration'))
  await runImageQueue('openai', deps)
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(h(Panel, { ai: initialAiSettings })))
    await settle(() => Boolean(button('Discard')))
    await click('Discard')
    await settle(() => document.body.textContent.includes('Your generation queue is empty.'))
    assert.equal(await db.table('galleryImages').count(), 0)
  } finally { await act(async () => root.unmount()) }
})

test('media enhancement preserves original text, chips do not send, and late results keep newer edits', async () => {
  const ai = await moduleAt('ai-settings')
  const fake = await moduleAt('fake-provider')
  const { default: Prompt } = await moduleAt('MediaPromptEditor')
  const config = ai.copyAiSettings(ai.initialAiSettings)
  config.provider = 'fake'; config.supportModel = 'fake/test'; config.supportModelContextLength = 33000
  ai.saveAiSettings(config)
  fake.clearFakeProviderTrace()
  function ControlledPrompt() {
    const [value, onChange] = React.useState({ prompt: 'Moonlit harbor', alias: 'Visual', size: '1024x1024', enhancementTemplate: 'Improve this prompt. [DELAY_MS:0]' })
    return h(Prompt, { value, onChange, capability: 'Still images' })
  }
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(h(ControlledPrompt)))
    await click('Enhance with guidance')
    await click('Vintage illustration')
    assert.equal(fake.getFakeProviderTrace().length, 0)
    await click('Enhance with this guidance')
    await settle(() => document.body.textContent.includes('Enhanced draft ready'))
    const original = document.querySelector('textarea[aria-label="Original media prompt"]')
    const enhanced = document.querySelector('textarea[aria-label="Enhanced media prompt"]')
    assert.equal(original.value, 'Moonlit harbor')
    assert.ok(enhanced.value)
    const previous = enhanced.value
    await input(document.querySelector('textarea[aria-label="Enhancement instructions"]'), 'Improve slowly. [DELAY_MS:30]')
    await click('Enhance')
    await input(original, 'Newer original edit')
    await settle(() => document.body.textContent.includes('draft changed while enhancing'))
    assert.equal(original.value, 'Newer original edit')
    assert.equal(enhanced.value, previous)
    assert.match(document.body.textContent, /Out of date/)
    assert.equal((await store.listImageJobs()).filter(job => job.prompt === previous).length, 0)
  } finally { await act(async () => root.unmount()) }
})


test('Generate approves once and keeps the popup open for parallel jobs, edited drafts, and result review', async () => {
  configure()
  const db = await p.database()
  await db.table('imageJobs').clear()
  const { book } = await p.createBook(initialAiSettings, 'Popup queue')
  const conversation = await createChat(book.id)
  const proposal = executeImageProposal({ id: 'popup-call', type: 'function', function: { name: 'propose_image_generation', arguments: JSON.stringify({ prompt: 'First version' }) } }).imageGeneration
  const message = await createChatMessage(conversation, 'assistant', '', { imageGenerations: [proposal] })
  const root = createRoot(document.getElementById('root'))
  const started = [], releases = new Map()
  let draining
  const popup = () => document.querySelector('dialog[aria-label="Generation tool"]')
  const popupButton = text => [...popup().querySelectorAll('button')].find(item => item.textContent.trim() === text)
  try {
    await act(async () => root.render(h(Card, { message, proposal })))
    await click('Open generation tool')
    await settle(() => Boolean(button('Generate')) && !button('Generate').disabled)
    assert.equal((await store.listImageJobs()).length, 0)
    assert.match(popup().textContent, /Your queued generations and results will appear here/)
    // A rapid double click is one submission; the next settled click is a new job.
    await act(async () => { button('Generate').click(); button('Generate').click() })
    await settle(() => Boolean(button('Generate')) && !button('Generate').disabled && popup().querySelectorAll('.image-job').length === 1)
    assert.equal((await p.getEntity(message.id)).imageGenerations[0].status, 'accepted')
    await act(async () => {
      draining = runImageQueue('openai', { ...deps, generate: async job => {
        started.push(job)
        await new Promise(resolve => releases.set(job.id, resolve))
        return { image: png }
      } })
    })
    await settle(() => started.length === 1)
    await input(popup().querySelector('textarea'), 'Second version')
    await click('Generate')
    await settle(() => started.length === 2 && Boolean(button('Generate')) && !button('Generate').disabled)
    assert.deepEqual(started.map(job => job.prompt), ['First version', 'Second version'])
    await settle(() => popup().querySelectorAll('.image-job').length === 2)
    assert.ok([...popup().querySelectorAll('.image-job')].every(card => card.textContent.includes('Generating')))
    assert.match(popup().textContent, /First version/)
    assert.match(popup().textContent, /Second version/)
    // Complete only the second result while the first is still in flight.
    await act(async () => releases.get(started[1].id)())
    await settle(() => Boolean(popupButton('Keep image')))
    await act(async () => popupButton('Keep image').click())
    await settle(() => popup().textContent.includes('Saved to gallery'))
    assert.equal(popup().querySelector('textarea').value, 'Second version')
    await act(async () => releases.get(started[0].id)())
    await act(async () => draining)
    await settle(() => Boolean(popupButton('Discard')))
    await act(async () => popupButton('Discard').click())
    await settle(() => popup().textContent.includes('Image discarded'))
    await click('Close tool')
    await settle(() => !popup())
    await settle(() => document.body.textContent.includes('Saved to gallery'))
    await click('Open generation tool')
    await settle(() => Boolean(popup()))
    assert.equal(popup().querySelector('textarea').value, 'Second version')
    await settle(() => popup().textContent.includes('Saved to gallery'))
  } finally {
    releases.forEach(resolve => resolve())
    if (draining) await act(async () => draining)
    await act(async () => root.unmount())
  }
})

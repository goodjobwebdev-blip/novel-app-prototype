import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after } from 'node:test'
import { transpileSourceTree } from './transpile-source-tree.mjs'
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
transpileSourceTree(directory)
const moduleAt = (name) => import(pathToFileURL(`${directory}/${name}.mjs`))
const p = await moduleAt('data/persistence')
const settings = await moduleAt('features/images/image-settings')
const store = await moduleAt('features/images/image-store')
const { executeImageProposal } = await moduleAt('features/images/image-tools')
const { runImageQueue } = await moduleAt('features/images/image-queue')
const { initialAiSettings } = await moduleAt('shared/ai/ai-settings')
const { createChat, createChatMessage } = await moduleAt('features/chat/chat-service')
const { default: Card } = await moduleAt('features/images/ImageProposalCard')
const { default: Panel } = await moduleAt('features/images/ImagePanel')
const { default: ImageJobs } = await moduleAt('features/images/ImageResults')
const { default: SettingsPanel } = await moduleAt('features/images/ImageSettingsPanel')
const { default: ConnectionsPanel } = await moduleAt('features/settings/SettingsProfilesPanel')
const { DEFAULT_LITELLM_BASE_URL } = await moduleAt('features/settings/provider-profiles')
const aiSettings = await moduleAt('shared/ai/ai-settings')
const profiles = await moduleAt('features/settings/settings-profiles')
const { loadBookImageSettings } = await moduleAt('features/images/book-image-settings')
const { captureImageCredentials } = await moduleAt('features/images/image-connection')
after(async () => { (await p.database()).close(); dom.window.close(); rmSync(directory, { recursive: true, force: true }) })
const h = React.createElement
function testRoot(t) {
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await act(async () => root.unmount()) })
  return root
}
function selectedImageProfile() {
  const library = profiles.loadSettingsProfiles()
  return library.profiles.find(profile => profile.id === library.defaults.image)
}
function ProfileEditor() {
  const profile = selectedImageProfile()
  const [value, onChange] = React.useState({ ...profile.media, keys: { openai: '', nanogpt: '', pruna: '' } })
  const ref = React.useRef(null)
  return h(React.Fragment, null,
    h(SettingsPanel, { ref, ai: initialAiSettings, value, onChange, mediaKind: 'image', hideCredentials: true }),
    h('button', { onClick: () => {
      if (ref.current.save()) {
        const { keys: _keys, ...media } = settings.validateImageSettings(value)
        profiles.saveSettingsProfile({ ...profile, media })
      }
    } }, 'Save profile'))
}
const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text || b.getAttribute('aria-label') === text)
async function click(text) { const target = button(text); assert.ok(target, `Button ${text} exists: ${document.body.textContent}`); await act(async () => target.click()) }
async function settle(predicate) { for (let i = 0; i < 100 && !predicate(); i++) await act(async () => new Promise((resolve) => setTimeout(resolve, 10))); assert.ok(predicate(), document.body.textContent) }
async function expandImageJob(card) {
  const toggle = card.querySelector('header button.image-job-toggle')
  assert.ok(toggle, 'Each job has a header toggle')
  assert.equal(toggle.getAttribute('aria-expanded'), 'false')
  const bodyId = toggle.getAttribute('aria-controls')
  assert.ok(bodyId, 'The toggle identifies its job body')
  assert.ok(!card.querySelector('.image-job-body'), 'Collapsed bodies are not mounted')
  await act(async () => toggle.click())
  assert.equal(toggle.getAttribute('aria-expanded'), 'true')
  const body = card.querySelector('div.image-job-body')
  assert.ok(body, 'Expanding mounts the job body')
  assert.equal(body.id, bodyId)
}
async function expandImageJobs(scope = document) {
  const cards = [...scope.querySelectorAll('article.image-job')]
  assert.ok(cards.length, 'Jobs have arrived before expanding')
  for (const card of cards) await expandImageJob(card)
}
async function input(element, value) {
  await act(async () => {
    const proto = element instanceof dom.window.HTMLTextAreaElement ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value)
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
}
const png = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6AAAAAElFTkSuQmCC', 'base64')], { type: 'image/png' })
const deps = { key: async (job) => captureImageCredentials(job.provider), generate: async () => ({ image: png }), prepare: async () => ({ image: png, thumbnail: png, width: 1, height: 1 }) }
function configure() {
  const favorites = settings.documentedImageModels.filter((m) => ['gpt-image-1', 'p-image'].includes(m.id)).map((m) => settings.imageFavorite(m, []))
  favorites[0].alias = 'Portrait'; favorites[1].alias = 'Fast'
  const configured = settings.saveImageSettings({ favorites, keys: { openai: '', nanogpt: '', pruna: '' }, defaultAlias: 'Portrait' })
  const { keys: _keys, ...media } = configured
  profiles.saveSettingsProfile({ ...selectedImageProfile(), media })
  return configured
}

test('editable chat proposal → repeated generation → navigate → keep → collapse → zoom → remove from chat', async (t) => {
  configure()
  const { book } = await p.createBook(initialAiSettings, 'First book')
  const conversation = await createChat(book.id)
  const proposal = executeImageProposal({ id: 'call', type: 'function', function: { name: 'propose_image_generation', arguments: JSON.stringify({ prompt: 'Original gate' }) } }, await loadBookImageSettings(book.id)).imageGeneration
  const message = await createChatMessage(conversation, 'assistant', '', { imageGenerations: [proposal] })
  let root = testRoot(t)
  try {
    await act(async () => root.render(h(Card, { message, proposal })))
    assert.ok(!document.querySelector('textarea'), 'The compact proposal has no prompt editor')
    await click('Open generation tool')
    await settle(() => Boolean(document.querySelector('textarea')))
    await input(document.querySelector('textarea'), 'Edited moonlit gate')
    await click('Close tool')
    await settle(() => !document.querySelector('textarea'))
    assert.ok(!document.querySelector('textarea'), 'Closing the tool removes its prompt editor')
    assert.equal((await p.getEntity(message.id)).imageGenerations[0].draft.prompt, 'Edited moonlit gate')
    await click('Open generation tool')
    await settle(() => Boolean(document.querySelector('textarea')))
    assert.equal(document.querySelector('textarea').value, 'Edited moonlit gate')
    await act(async () => document.querySelector('.arc-searchable-select__trigger').click())
    await input(document.querySelector('.arc-searchable-select input[type=search]'), 'Fast')
    assert.equal(document.querySelectorAll('.arc-searchable-select__options button').length, 1)
    await act(async () => document.querySelector('.arc-searchable-select__options button').click())
    await act(async () => { const select = document.querySelector('select'); select.value = '1344x768'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    assert.ok(!button('Accept proposal'), 'Generate is the approval action')
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
    root = testRoot(t)
    await act(async () => root.render(h(Card, { message: await p.getEntity(message.id), proposal })))
    await settle(() => document.querySelectorAll('article.image-job').length === 2)
    await expandImageJobs()
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

test('gallery includes other books and current uploads; Only this book filters them', async (t) => {
  configure()
  const { book } = await p.createBook(initialAiSettings, 'Second book')
  const entry = await p.createCodexEntry(book.id, 'Uploaded entry', 'Character')
  await p.saveIllustration(entry.id, { image: png, thumbnail: png, width: 1, height: 1 }, { caption: 'Uploaded image', alt: '', cropX: 50, cropY: 50 })
  const root = testRoot(t)
  try {
    await act(async () => root.render(h(Panel, { bookId: book.id, ai: initialAiSettings })))
    await click('Gallery')
    await settle(() => document.querySelectorAll('.image-gallery-grid article').length === 2)
    await act(async () => document.querySelector('.image-gallery-tools input[type=checkbox]').click())
    await settle(() => document.querySelectorAll('.image-gallery-grid article').length === 1)
    assert.match(document.querySelector('.image-gallery-grid').textContent, /Uploaded image/)
  } finally { await act(async () => root.unmount()) }
})

test('saving a displayed LiteLLM default endpoint with only a Pruna media key configures generation', async (t) => {
  configure()
  const originalAi = aiSettings.loadAiSettings(), originalMedia = settings.loadImageSettings()
  t.after(() => { aiSettings.saveAiSettings(originalAi); settings.saveImageSettings(originalMedia) })
  aiSettings.saveAiSettings({ ...initialAiSettings, provider: 'nanogpt', apiKey: 'text-only-key', providerProfiles: {} })
  settings.saveImageSettings({ ...originalMedia, keys: { ...originalMedia.keys, pruna: '' } })
  const root = testRoot(t)
  const field = label => [...document.querySelectorAll('label')].find(item => item.textContent.includes(label))?.querySelector('input, select')
  try {
    await act(async () => root.render(h(ConnectionsPanel, { section: 'ai', renderEditor: () => null, application: null, sync: null })))
    await click('Connections')
    await act(async () => { const select = field('Connection provider'); select.value = 'litellm'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    assert.equal(field('LiteLLM base URL').value, DEFAULT_LITELLM_BASE_URL)
    assert.equal(button('Save connections').disabled, false, 'The displayed new connection can be saved without editing its URL')
    assert.equal(document.querySelector('[aria-label="Text API key"]').value, '')
    assert.equal(settings.resolvePrunaGatewayUrl(aiSettings.loadAiSettings()), '', 'Choosing a connection does not autosave it')
    await input(field('Pruna / LiteLLM media API key'), 'media-only-key')
    await click('Save connections')
    await settle(() => button('Save connections').disabled)
    const credentials = captureImageCredentials('pruna')
    assert.equal(credentials.key, 'media-only-key')
    assert.equal(credentials.gatewayUrl, `${new URL(DEFAULT_LITELLM_BASE_URL).origin}/pruna`, 'Save persists the endpoint displayed in the form, even if the URL was not edited')
    const saved = aiSettings.loadAiSettings()
    assert.equal(saved.provider, 'nanogpt', 'Editing the media gateway does not switch the text provider')
    assert.equal(saved.apiKey, 'text-only-key')
    assert.equal(saved.providerProfiles.litellm.apiKey, '', 'The general LiteLLM key is optional when a media key is provided')
    assert.equal(saved.providerProfiles.litellm.baseUrl, DEFAULT_LITELLM_BASE_URL)

    await input(field('LiteLLM base URL'), 'https://gateway.example:9447/v1')
    await click('Save connections')
    await settle(() => button('Save connections').disabled)
    assert.equal(captureImageCredentials('pruna').gatewayUrl, 'https://gateway.example:9447/pruna', 'The custom port is retained and the text API v1 path is replaced')
    assert.equal(captureImageCredentials('pruna').key, 'media-only-key')
  } finally { await act(async () => root.unmount()) }
})

test('selected Image profile saves aliases and enabled sizes only on Save; invalid defaults stay unsaved', async (t) => {
  configure()
  profiles.saveSettingsProfile({ ...selectedImageProfile(), media: { favorites: [], defaultAlias: '', defaultAliases: {} } })
  const legacyBefore = localStorage.getItem(settings.IMAGE_SETTINGS_KEY)
  const root = testRoot(t)
  await act(async () => root.render(h(ProfileEditor)))
  assert.equal(document.querySelectorAll('input[type=password]').length, 0)
  await act(async () => { const select = document.querySelector('select'); select.value = 'pruna'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
  await click('Favorite')
  await input(document.querySelector('.image-favorite input:not([type])'), 'Fast art')
  assert.equal(selectedImageProfile().media.favorites.length, 0)
  await click('Save profile')
  assert.equal(selectedImageProfile().media.favorites[0].alias, 'Fast art')
  assert.equal(selectedImageProfile().media.favorites[0].defaultSize, '1024x1024')
  for (const box of document.querySelectorAll('.image-favorite input[type=checkbox]')) await act(async () => box.click())
  await click('Save profile')
  assert.match(document.querySelector('[role=alert]').textContent, /Enable at least one size/)
  assert.ok(selectedImageProfile().media.favorites[0].enabledSizes.length > 0)
  assert.equal(localStorage.getItem(settings.IMAGE_SETTINGS_KEY), legacyBefore)
})


test('selected Image profile quality and moderation default to low and persist explicit saves', async (t) => {
  configure()
  let root = testRoot(t)
  const selectIn = (article, text) => [...article.querySelectorAll('label')].find((label) => label.textContent.startsWith(text))?.querySelector('select')
  try {
    await act(async () => root.render(h(ProfileEditor)))
    assert.equal(document.querySelectorAll('input[type=password]').length, 0)
    const [openai, pruna] = document.querySelectorAll('.image-favorite')
    const quality = selectIn(openai, 'Image quality'), moderation = selectIn(openai, 'Image moderation')
    assert.equal(quality.value, 'low')
    assert.equal(moderation.value, 'low')
    assert.deepEqual([...quality.options].map((o) => o.value), ['low', 'medium', 'high', 'auto'])
    assert.deepEqual([...moderation.options].map((o) => o.value), ['low', 'auto'])
    assert.ok(!selectIn(pruna, 'Image quality'), 'Pruna has no OpenAI quality control')
    assert.ok(!selectIn(pruna, 'Image moderation'), 'Pruna has no OpenAI moderation control')
    await act(async () => { quality.value = 'medium'; quality.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    await act(async () => { moderation.value = 'auto'; moderation.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    assert.equal(selectedImageProfile().media.favorites[0].quality, 'low')
    await click('Save profile')
    assert.equal(selectedImageProfile().media.favorites[0].quality, 'medium')
    assert.equal(selectedImageProfile().media.favorites[0].moderation, 'auto')
    await act(async () => root.unmount())
    root = testRoot(t)
    await act(async () => root.render(h(ProfileEditor)))
    const favorite = document.querySelector('.image-favorite')
    assert.equal(selectIn(favorite, 'Image quality').value, 'medium')
    assert.equal(selectIn(favorite, 'Image moderation').value, 'auto')
    const queued = await store.enqueueImageJob(settings.resolveImageSpec('Configured illustration', undefined, undefined, undefined, await loadBookImageSettings()))
    assert.equal(queued.quality, 'medium')
    assert.equal(queued.moderation, 'auto')
  } finally { await act(async () => root.unmount()) }
})


test('image choices keep compact checkbox geometry under shared settings styles', async (t) => {
  configure()
  const style = document.createElement('style')
  // Match the app's cascade: component styles load before global form rules.
  style.textContent = [
    'features/images/image-generation.css',
    'shared/ui/primitives.css',
    'shared/ui/choice.css',
    'app/styles.css',
    'features/settings/ui-settings.css',
    'shared/ui/mobile-control-hardening.css',
    'features/settings/ai-settings-ux.css',
  ].map((path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')).join('\n')
  document.head.append(style)
  const root = testRoot(t)
  try {
    await act(async () => root.render(h(ProfileEditor)))
    const favorite = document.querySelector('.image-favorite')
    for (const control of favorite.querySelectorAll('input[type=checkbox], input[type=radio]')) {
      const geometry = dom.window.getComputedStyle(control)
      assert.equal(geometry.width, '18px')
      assert.equal(geometry.height, '18px')
      assert.equal(geometry.minWidth, '18px')
      assert.equal(geometry.minHeight, '18px')
      assert.equal(geometry.maxWidth, '18px')
      assert.equal(geometry.maxHeight, '18px')
    }
    const tile = favorite.querySelector('.image-size-option')
    const checkbox = tile.querySelector('input')
    assert.ok(checkbox.checked)
    await act(async () => tile.querySelector('strong').click())
    assert.equal(checkbox.checked, false)
    assert.match(favorite.querySelector('legend').textContent, /2 selected/)
    assert.match(document.querySelector('.image-settings-status').textContent, /global profile editor/)
    assert.equal(selectedImageProfile().media.favorites[0].enabledSizes.length, 3)
    await click('Save profile')
    assert.equal(selectedImageProfile().media.favorites[0].enabledSizes.length, 2)
  } finally { await act(async () => root.unmount()); style.remove() }
})


test('remove and clear queue cover earlier history and stay cleared after reopening', async (t) => {
  configure()
  const db = await p.database()
  await db.table('imageJobs').clear()
  await db.table('galleryImages').clear()
  const spec = settings.resolveImageSpec('Failed illustration')
  await db.table('imageJobs').bulkPut(Array.from({ length: 33 }, (_, i) => ({ ...spec, id: `failed-${i}`, createdAt: i, status: 'failed', error: 'Rejected' })))
  let root = testRoot(t)
  const originalConfirm = window.confirm
  window.confirm = () => { throw new Error('Failed-only cleanup should not need confirmation') }
  try {
    await act(async () => root.render(h(Panel, { ai: initialAiSettings })))
    await settle(() => document.querySelectorAll('.image-job').length === 30)
    await expandImageJob(document.querySelector('article.image-job'))
    await click('Remove from queue')
    await settle(() => document.querySelector('.image-queue-actions').textContent.includes('32 generations'))
    await click('Clear queue')
    await settle(() => document.body.textContent.includes('Your generation queue is empty.'))
    assert.ok(!button('Show earlier generations'), 'Cleared history has no pagination action')
    assert.ok((await store.listImageJobs()).every((j) => j.hiddenInQueue))
    await act(async () => root.unmount())
    root = testRoot(t)
    await act(async () => root.render(h(Panel, { ai: initialAiSettings })))
    await settle(() => document.body.textContent.includes('Your generation queue is empty.'))
    assert.equal(document.querySelectorAll('.image-job').length, 0)
  } finally { window.confirm = originalConfirm; await act(async () => root.unmount()) }
})

test('clear queue requires confirmation for active work and preserves kept gallery results', async (t) => {
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
  const root = testRoot(t)
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

test('discard removes an unwanted result from the generation queue immediately', async (t) => {
  configure()
  const db = await p.database()
  await db.table('imageJobs').clear()
  await db.table('galleryImages').clear()
  await store.enqueueImageJob(settings.resolveImageSpec('Unwanted illustration'))
  await runImageQueue('openai', deps)
  const root = testRoot(t)
  try {
    await act(async () => root.render(h(Panel, { ai: initialAiSettings })))
    await settle(() => document.querySelectorAll('article.image-job').length === 1)
    await expandImageJobs()
    await settle(() => Boolean(button('Discard')))
    await click('Discard')
    await settle(() => document.body.textContent.includes('Your generation queue is empty.'))
    assert.equal(await db.table('galleryImages').count(), 0)
  } finally { await act(async () => root.unmount()) }
})

test('image jobs collapse independently and retain expansion across completion and status groups', async (t) => {
  configure()
  const db = await p.database()
  await db.table('imageJobs').clear()
  await db.table('galleryImages').clear()
  const portrait = await store.enqueueImageJob(settings.resolveImageSpec('Expanded portrait prompt', 'Portrait'))
  const fast = await store.enqueueImageJob(settings.resolveImageSpec('Collapsed fast prompt', 'Fast'))
  const root = testRoot(t)
  const cardFor = alias => [...document.querySelectorAll('article.image-job')].find(card => card.querySelector('button.image-job-toggle')?.textContent.includes(alias))
  const toggleFor = alias => cardFor(alias)?.querySelector('header button.image-job-toggle')
  const assertCollapsed = alias => {
    const card = cardFor(alias)
    assert.ok(card, `${alias} card exists`)
    assert.equal(toggleFor(alias).getAttribute('aria-expanded'), 'false')
    assert.ok(!card.querySelector('.image-job-body'), 'Collapsing unmounts the body')
    assert.ok(!card.querySelector('.image-prompt-preview'), 'Collapsed prompts are not mounted')
    assert.ok(!card.querySelector('.image-job-result'), 'Collapsed results are not mounted')
    assert.ok(!card.querySelector('.image-actions'), 'Collapsed actions are not mounted')
  }
  const assertExpanded = job => {
    const card = cardFor(job.modelAlias)
    const toggle = toggleFor(job.modelAlias)
    assert.equal(toggle.getAttribute('aria-expanded'), 'true')
    assert.equal(card.querySelector('div.image-job-body')?.id, toggle.getAttribute('aria-controls'))
    assert.equal(card.querySelector('.image-prompt-preview')?.textContent, job.prompt)
  }
  try {
    await act(async () => root.render(h(ImageJobs, { showPrompt: true })))
    await settle(() => document.querySelectorAll('article.image-job').length === 2)
    for (const job of [portrait, fast]) {
      assertCollapsed(job.modelAlias)
      assert.match(toggleFor(job.modelAlias).textContent, /Queued/)
      const dimensions = `${job.size.width} × ${job.size.height}`
      assert.ok(cardFor(job.modelAlias).querySelector('small').textContent.includes(dimensions))

    }
    assert.notEqual(toggleFor('Portrait').getAttribute('aria-controls'), toggleFor('Fast').getAttribute('aria-controls'))
    await expandImageJob(cardFor('Portrait'))
    assertExpanded(portrait)
    assertCollapsed('Fast')
    await expandImageJob(cardFor('Fast'))
    assertExpanded(portrait)
    assertExpanded(fast)
    await act(async () => toggleFor('Portrait').click())
    assertCollapsed('Portrait')
    assertExpanded(fast)
    await expandImageJob(cardFor('Portrait'))
    assertExpanded(portrait)
    await act(async () => toggleFor('Fast').click())
    assertCollapsed('Fast')

    await act(async () => runImageQueue('openai', deps))
    await act(async () => runImageQueue('pruna', deps))
    await settle(() => ['Portrait', 'Fast'].every(alias => toggleFor(alias)?.textContent.includes('completed')))
    assertExpanded(portrait)
    assertCollapsed('Fast')
    assert.match(cardFor('Portrait').closest('.image-job-group').querySelector('h3').textContent, /Needs review/)
    assert.match(cardFor('Fast').closest('.image-job-group').querySelector('h3').textContent, /Needs review/)
    await settle(() => Boolean(cardFor('Portrait').querySelector('button[aria-label="View image and prompt"]')))
    assert.ok([...cardFor('Portrait').querySelectorAll('button')].some(item => item.textContent.trim() === 'Keep image'))

    await act(async () => store.decideImageJob(portrait.id, true))
    await settle(() => cardFor('Portrait').closest('.image-job-group').querySelector('h3').textContent.includes('Earlier'))
    assertExpanded(portrait)
    assertCollapsed('Fast')
    await settle(() => cardFor('Portrait').textContent.includes('Saved to gallery'))
    await act(async () => toggleFor('Portrait').click())
    assertCollapsed('Portrait')
    assert.ok(!cardFor('Portrait').textContent.includes('Saved to gallery'))
    await expandImageJob(cardFor('Portrait'))
    assertExpanded(portrait)
    await settle(() => cardFor('Portrait').textContent.includes('Saved to gallery'))
    await expandImageJob(cardFor('Fast'))
    assertExpanded(fast)
    assertExpanded(portrait)
    await settle(() => [...cardFor('Fast').querySelectorAll('button')].some(item => item.textContent.trim() === 'Keep image'))
  } finally { await act(async () => root.unmount()) }
})

test('media enhancement preserves original text, chips do not send, and late results keep newer edits', async (t) => {
  const ai = await moduleAt('shared/ai/ai-settings')
  const fake = await moduleAt('shared/ai/fake-provider')
  const { default: Prompt } = await moduleAt('features/images/MediaPromptEditor')
  const config = ai.copyAiSettings(ai.initialAiSettings)
  config.provider = 'fake'; config.supportModel = 'fake/test'; config.supportModelContextLength = 33000
  ai.saveAiSettings(config)
  const library = profiles.loadSettingsProfiles()
  const textProfile = library.profiles.find(profile => profile.id === library.defaults.text)
  profiles.saveSettingsProfile({ ...textProfile, settings: config })
  fake.clearFakeProviderTrace()
  function ControlledPrompt() {
    const [value, onChange] = React.useState({ prompt: 'Moonlit harbor', alias: 'Visual', size: '1024x1024', enhancementTemplate: 'Improve this prompt. [DELAY_MS:0]' })
    return h(Prompt, { value, onChange, capability: 'Still images' })
  }
  const root = testRoot(t)
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


test('Generate approves once and keeps the popup open for parallel jobs, edited drafts, and result review', async (t) => {
  configure()
  const db = await p.database()
  await db.table('imageJobs').clear()
  const { book } = await p.createBook(initialAiSettings, 'Popup queue')
  const conversation = await createChat(book.id)
  const proposal = executeImageProposal({ id: 'popup-call', type: 'function', function: { name: 'propose_image_generation', arguments: JSON.stringify({ prompt: 'First version' }) } }, await loadBookImageSettings(book.id)).imageGeneration
  const message = await createChatMessage(conversation, 'assistant', '', { imageGenerations: [proposal] })
  const root = testRoot(t)
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
    await expandImageJobs(popup())
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
    await settle(() => document.querySelectorAll('article.image-job').length === 2)
    await expandImageJobs()
    await settle(() => document.body.textContent.includes('Saved to gallery'))
    await click('Open generation tool')
    await settle(() => Boolean(popup()) && popup().querySelectorAll('article.image-job').length === 2)
    assert.equal(popup().querySelector('textarea').value, 'Second version')
    await expandImageJobs(popup())
    await settle(() => popup().textContent.includes('Saved to gallery'))
  } finally {
    releases.forEach(resolve => resolve())
    if (draining) await act(async () => draining)
    await act(async () => root.unmount())
  }
})

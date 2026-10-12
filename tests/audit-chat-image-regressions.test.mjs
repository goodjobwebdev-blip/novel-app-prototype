import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import 'fake-indexeddb/auto'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://arc.test/', pretendToBeVisual: true })
after(() => dom.window.close())
for (const key of ['window', 'document', 'localStorage', 'HTMLElement', 'Event', 'CustomEvent']) globalThis[key] = dom.window[key]
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
const compiled = await build({
  stdin: { contents: `export * as persistence from './src/data/persistence.ts'; export * as ai from './src/shared/ai/ai-settings.ts'; export * as media from './src/features/images/image-settings.ts'; export * as profiles from './src/features/settings/settings-profiles.ts'; export * as store from './src/features/images/image-store.ts'; export * as chats from './src/features/chat/chat-service.ts'; export { queueRequestedImage } from './src/features/chat/chat-direct-images.ts'; export { ChatImageReferences } from './src/features/chat/CharacterChatControls.tsx';`, resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'tsx' },
  bundle: true, platform: 'node', format: 'cjs', write: false,
  external: ['react', 'react-dom', 'react-dom/client'], jsx: 'automatic', loader: { '.css': 'empty' },
})
const module = { exports: {} }
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
const { persistence: p, ai, media, profiles, store, chats, queueRequestedImage, ChatImageReferences } = module.exports
after(async () => (await p.database()).close())
// These regressions exercise queue persistence, never a provider worker or paid request.
const realFetch = globalThis.fetch
let networkCalls = 0
globalThis.fetch = async () => { networkCalls++; throw new Error('Network access is forbidden in media audit regressions') }
after(() => { globalThis.fetch = realFetch; assert.equal(networkCalls, 0, 'No provider/catalog network request was made') })
const png = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6AAAAAElFTkSuQmCC', 'base64')], { type: 'image/png' })
const output = { image: png, thumbnail: png, width: 1, height: 1 }
const source = { id: 'selected-source', mime: 'image/png', data: png, width: 1, height: 1 }
const delay = () => new Promise(resolve => setTimeout(resolve, 10))
async function settle(predicate) {
  for (let i = 0; i < 100 && !predicate(); i++) await act(async () => { await delay() })
  assert.ok(predicate(), 'Image-reference UI did not reach the expected state')
}
async function drain() {
  await act(async () => {
    // Barrier drains earlier IndexedDB reads started by mounted subscribers.
    const db = await p.database()
    await db.transaction('rw', db.table('galleryImages'), async () => { await db.table('galleryImages').count() })
    await delay()
  })
}
function configure() {
  ai.saveAiSettings({ ...ai.initialAiSettings, provider: 'openai', apiKey: 'synthetic-no-network-key', providerProfiles: {} })
  const favorite = media.imageFavorite(media.documentedImageModels.find(model => model.id === 'gpt-image-1'), [])
  favorite.alias = 'portrait'
  const settings = media.saveImageSettings({ favorites: [favorite], defaultAlias: 'portrait', keys: { openai: '', nanogpt: '', pruna: '', leonardo: '' } })
  const library = profiles.loadSettingsProfiles(), profile = library.profiles.find(item => item.id === library.defaults.image)
  const { keys: _keys, ...definition } = settings
  profiles.saveSettingsProfile({ ...profile, media: definition })
  return settings
}
async function fixture() {
  const settings = configure()
  const db = await p.database()
  await db.table('imageJobs').clear()
  await db.table('galleryImages').clear()
  const { book } = await p.createBook(ai.initialAiSettings, 'Image audit fixture')
  const chat = await chats.createChat(book.id)
  return { book, chat, settings, db }
}
function requestFields(job) {
  return { prompt: job.prompt, modelAlias: job.modelAlias, provider: job.provider, model: job.model, size: job.size, task: job.task, quality: job.quality, moderation: job.moderation, video: job.video, leonardoOptions: job.leonardoOptions, leonardoContractVersion: job.leonardoContractVersion }
}

// Use a real accepted proposal and frozen source bytes, not a manually injected malformed job.
test('BUG-04 Retry after Clear queue preserves image-to-image bytes or requires explicit reselection', async () => {
  const f = await fixture()
  const proposal = { id: 'proposal-with-source', prompt: 'Repaint the reference', modelAlias: 'portrait', size: '1024x1024', task: 'image-to-image', status: 'proposed', createdAt: Date.now() }
  const message = await chats.createChatMessage(f.chat, 'assistant', '', { imageGenerations: [proposal] })
  const origin = { bookId: f.book.id, chatId: f.chat.id, messageId: message.id, proposalId: proposal.id }
  const queued = await store.enqueueImageProposal({ prompt: proposal.prompt, alias: 'portrait', size: proposal.size, task: 'image-to-image', sources: [source] }, origin)
  assert.equal(queued.sources.length, 1, 'The original request has a valid source')
  await store.clearImageQueue([queued.id])
  const cleared = await f.db.table('imageJobs').get(queued.id)
  assert.equal(cleared.status, 'cancelled')
  assert.equal(cleared.messageId, message.id, 'Chat retains the retryable result')
  let failure
  try { await store.retryImageJob(queued.id) } catch (error) { failure = error }
  const retries = (await store.listImageJobs()).filter(job => job.id !== queued.id)
  if (failure) {
    assert.match(failure.message, /(?:reselect|select.*again|select.*reference|source.*unavailable|reference.*unavailable)/i, 'Explain how to recover missing source bytes')
    assert.equal(retries.length, 0, 'Rejection must not persist an invalid generation')
  } else {
    assert.equal(retries.length, 1)
    assert.equal(retries[0].task, 'image-to-image')
    assert.equal(retries[0].sources?.length, 1, 'Never turn a cleared image-to-image request into sources=[]')
    assert.deepEqual(await retries[0].sources[0].data.arrayBuffer(), await source.data.arrayBuffer(), 'A successful retry uses the original reference bytes')
  }
  assert.equal(networkCalls, 0)
})

async function directFixture(status) {
  const f = await fixture()
  const userText = 'Generate an image of a lighthouse'
  const user = await chats.createChatMessage(f.chat, 'user', userText)
  const claim = await queueRequestedImage({ chat: f.chat, userMessageId: user.id, userText, responseId: 'response-audit', roundNumber: 1, callId: 'direct-audit', prompt: 'A lighthouse at sunrise', mediaSettings: f.settings })
  const original = await f.db.table('imageJobs').get(claim.jobId)
  if (status === 'cancelled') await store.cancelImageJob(original.id)
  else {
    await store.claimImageJob('openai', 'audit-worker')
    if (status === 'failed') await store.patchOwnedImageJob(original.id, 'audit-worker', { status: 'failed', error: 'Synthetic local failure before submission' })
    else await store.recoverImageJobs('openai')
  }
  assert.equal((await f.db.table('imageJobs').get(original.id)).status, status)
  return { ...f, user, claim, original }
}
for (const status of ['cancelled', 'failed', 'interrupted']) {
  test(`BUG-07 explicit Retry of a ${status} direct Chat request queues its immutable spec without proposal approval`, async () => {
    const f = await directFixture(status)
    const message = await p.getEntity(f.claim.messageId)
    assert.equal(message.directImageRequest.jobId, f.original.id)
    assert.equal(message.imageGenerations?.length ?? 0, 0, 'Direct requests do not have an accepted proposal')
    // A retry must not resolve the old alias against newly edited favorites.
    const library = profiles.loadSettingsProfiles(), profile = library.profiles.find(item => item.id === library.defaults.image)
    profiles.saveSettingsProfile({ ...profile, media: { ...profile.media, favorites: [], defaultAlias: '' } })
    await store.retryImageJob(f.original.id)
    const jobs = await store.listImageJobs(), retries = jobs.filter(job => job.id !== f.original.id)
    assert.equal(retries.length, 1, 'An explicit retry creates exactly one new job')
    const retry = retries[0]
    assert.deepEqual(requestFields(retry), requestFields(f.original))
    assert.equal(retry.bookId, f.book.id)
    assert.equal(retry.chatId, f.chat.id)
    assert.equal(retry.messageId, f.claim.messageId)
    assert.equal(retry.directUserMessageId, f.user.id, 'Retry retains the originating explicit request')
    assert.equal(retry.status, 'queued')
    assert.equal(retry.providerJobId, undefined)
    assert.equal(retry.owner, undefined)
    assert.equal(retry.error, undefined)
    assert.equal(retry.startedAt, undefined)
    assert.equal((await p.getEntity(f.user.id)).directImageClaim.jobId, f.original.id, 'Explicit Retry must not erase the one-generation-per-turn claim')
    assert.equal((await f.db.table('imageJobs').get(f.original.id)).status, status)
    assert.equal(networkCalls, 0)
  })
}
for (const invalid of ['deleted user', 'wrong chat', 'unrelated direct claim']) {
  test(`BUG-07 direct retry rejects a ${invalid} origin instead of treating any directImageRequest as authorization`, async () => {
    const f = await directFixture('cancelled')
    if (invalid === 'deleted user') await f.db.table('entities').delete(f.user.id)
    else if (invalid === 'wrong chat') {
      const other = await chats.createChat(f.book.id)
      await f.db.table('imageJobs').update(f.original.id, { chatId: other.id })
    } else await f.db.table('entities').update(f.claim.messageId, { directImageRequest: { ...f.claim, jobId: 'unrelated-job' } })
    await assert.rejects(store.retryImageJob(f.original.id), /request|origin|chat|available|changed/i)
    assert.equal((await store.listImageJobs()).length, 1, 'Invalid origin must not authorize another generation')
    assert.equal(networkCalls, 0)
  })
}

async function completedImage(f, prompt) {
  const spec = media.resolveImageSpec(prompt, 'portrait', undefined, undefined, f.settings)
  const queued = await store.enqueueImageJob(spec, { bookId: f.book.id })
  const claimed = await store.claimImageJob('openai', 'local-completion')
  assert.equal(claimed.id, queued.id)
  await store.completeImageJob(claimed, output)
  return f.db.table('imageJobs').get(queued.id)
}
async function mountReferences(t, chat) {
  const warnings = [], originalError = console.error
  t.mock.method(console, 'error', (...args) => { warnings.push(args.map(String).join(' ')); originalError(...args) })
  t.after(() => assert.equal(warnings.filter(message => /not wrapped in act|unmounted component/i.test(message)).length, 0, 'Image-store subscriber updates must stay inside act'))
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  t.after(async () => { try { await act(async () => root.unmount()) } finally { host.remove() } })
  function Harness() {
    const [current, setCurrent] = React.useState(chat)
    return React.createElement(ChatImageReferences, { chat: current, onChange: setCurrent })
  }
  await act(async () => root.render(React.createElement(Harness)))
  await drain()
  return host
}
const checkbox = (host, prompt) => [...host.querySelectorAll('label')].find(label => label.textContent.includes(prompt))?.querySelector('input[type="checkbox"]')

test('BUG-08 Keep adds a newly saved still image to the mounted Chat reference picker without selecting it', async t => {
  const f = await fixture(), image = await completedImage(f, 'Newly kept lighthouse')
  const host = await mountReferences(t, f.chat)
  assert.equal(Boolean(checkbox(host, image.prompt)), false, 'Unkept results are not selectable')
  await act(async () => { await store.decideImageJob(image.id, true) })
  await settle(() => Boolean(checkbox(host, image.prompt)))
  assert.equal(checkbox(host, image.prompt).checked, false, 'Keep must never auto-select a paid request reference')
  await act(async () => checkbox(host, image.prompt).click())
  await settle(() => checkbox(host, image.prompt)?.checked === true)
  assert.deepEqual((await chats.getChat(f.chat.id)).directImageReferenceIds, [image.assetId])
})

test('BUG-08 Delete removes a selected image from mounted Chat options and exposes unavailable-reference recovery', async t => {
  const f = await fixture(), image = await completedImage(f, 'Delete this selected lighthouse')
  await store.decideImageJob(image.id, true)
  f.chat = await chats.updateChat(f.chat.id, { directImageReferenceIds: [image.assetId] })
  const host = await mountReferences(t, f.chat)
  await settle(() => checkbox(host, image.prompt)?.checked === true)
  await act(async () => { await store.deleteGalleryImage(image.assetId) })
  await settle(() => !checkbox(host, image.prompt))
  assert.equal(await store.getGalleryImage(image.assetId), undefined)
  const remove = [...host.querySelectorAll('button')].find(button => button.textContent.trim() === 'Remove unavailable reference')
  assert.ok(remove, 'A deleted selected image must not stay selectable; its stored ID has an explicit removal action')
  await act(async () => remove.click())
  await settle(() => !host.textContent.includes('Remove unavailable reference'))
  assert.deepEqual((await chats.getChat(f.chat.id)).directImageReferenceIds, [], 'Unavailable selections are safely removed through the real Chat save path')
})

import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import 'fake-indexeddb/auto'
import { transpileSourceTree } from './transpile-source-tree.mjs'

const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'https://arc.test/' })
for (const key of ['window', 'document', 'HTMLElement', 'localStorage', 'sessionStorage', 'Event', 'CustomEvent']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { act } = React
const h = React.createElement
const directory = mkdtempSync(new URL('../node_modules/.arc-media-profiles-test-', import.meta.url))
transpileSourceTree(directory)
const moduleAt = name => import(pathToFileURL(`${directory}/${name}.mjs`))
const p = await moduleAt('data/persistence')
const ai = await moduleAt('shared/ai/ai-settings')
const profiles = await moduleAt('features/settings/settings-profiles')
const s = await moduleAt('features/images/image-settings')
const { loadBookImageSettings } = await moduleAt('features/images/book-image-settings')
const store = await moduleAt('features/images/image-store')
const { runImageQueue } = await moduleAt('features/images/image-queue')
const { captureImageCredentials, imageConnectionFingerprint } = await moduleAt('features/images/image-connection')
const { queueRequestedImage } = await moduleAt('features/chat/chat-direct-images')
const { executeImageProposal } = await moduleAt('features/images/image-tools')
const { useImageSettings } = await moduleAt('features/images/image-hooks')
const { default: SettingsPanel } = await moduleAt('features/images/ImageSettingsPanel')
const { default: ImagePanel } = await moduleAt('features/images/ImagePanel')
const { default: Controls } = await moduleAt('features/images/ImageGenerationControls')
const { createChat, createChatMessage, updateChat } = await moduleAt('features/chat/chat-service')
const keys = { nanogpt: '', openai: 'local-image-secret', pruna: '' }
const png = new Blob(['fixture'], { type: 'image/png' })
const output = { image: png, thumbnail: png, width: 1, height: 1 }
const deps = { key: async (job) => captureImageCredentials(job.provider), generate: async () => ({ image: png }), prepare: async () => output }

function favorite(id, alias) {
  return { ...s.imageFavorite(s.documentedImageModels.find(model => model.id === id), []), alias }
}
function media(favorites) {
  return { favorites, defaultAlias: favorites[0]?.alias ?? '', defaultAliases: Object.fromEntries(favorites.flatMap(model => model.tasks.map(task => [task, model.alias]))) }
}
function configure() {
  ai.saveAiSettings({ ...ai.initialAiSettings, provider: 'litellm', apiKey: 'local-pruna-secret', baseUrl: 'https://original-gateway.invalid/v1' })
  s.saveImageSettings({ ...media([favorite('gpt-image-1', 'Global image'), favorite('p-video', 'Global video')]), keys })
  profiles.loadSettingsProfiles()
}
async function fixture() {
  const { book } = await p.createBook(ai.initialAiSettings, 'Media profile book')
  const image = profiles.createSettingsProfile('image', 'Book illustrations')
  const video = profiles.createSettingsProfile('video', 'Book animation')
  image.media = media([favorite('gpt-image-1.5', 'Book image')])
  video.media = media([favorite('p-video', 'Book video')])
  profiles.saveSettingsProfile(image)
  profiles.saveSettingsProfile(video)
  const selections = await p.getBookProfileSelections(book.id)
  await p.saveBookProfileSelections(book.id, { ...selections, image: image.id, video: video.id })
  return { book, image, video }
}
function proposalCall(args) {
  return { id: 'media-call', type: 'function', function: { name: 'propose_image_generation', arguments: JSON.stringify(args) } }
}
async function settle(predicate) {
  for (let i = 0; i < 100 && !predicate(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 10)))
  assert.ok(predicate(), document.body.textContent)
}
async function input(element, value) {
  assert.ok(element)
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(element, value)
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
}
async function select(element, value) {
  await act(async () => { element.value = value; element.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
}
const button = text => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text)
const selectLabel = text => [...document.querySelectorAll('label')].find(label => label.textContent.startsWith(text))?.querySelector('select')

beforeEach(async () => {
  localStorage.clear()
  configure()
  const db = await p.database()
  await db.table('imageJobs').clear()
  await db.table('galleryImages').clear()
})
after(async () => { (await p.database()).close(); dom.window.close(); rmSync(directory, { recursive: true, force: true }) })

test('book resolution combines independent Image/Video profiles and local-only credentials; outside books uses defaults', async (t) => {
  const { book } = await fixture()
  const legacyBefore = localStorage.getItem(s.IMAGE_SETTINGS_KEY)
  const resolved = await loadBookImageSettings(book.id)
  assert.deepEqual(resolved.favorites.map(model => model.alias), ['Book image', 'Book video'])
  assert.equal(resolved.defaultAliases['text-to-image'], 'Book image')
  assert.equal(resolved.defaultAliases['text-to-video'], 'Book video')
  assert.equal(resolved.keys.openai, 'local-image-secret')
  assert.deepEqual((await loadBookImageSettings()).favorites.map(model => model.alias), ['Global image', 'Global video'])
  assert.equal(localStorage.getItem(s.IMAGE_SETTINGS_KEY), legacyBefore)
  assert.doesNotMatch(localStorage.getItem(profiles.SETTINGS_PROFILES_STORAGE_KEY), /local-image-secret|"keys"/)
  await assert.rejects(loadBookImageSettings('deleted-book'), /no longer exists/)
})

test('instructions and proposal tools accept the captured book settings, including video, without leaking credentials', async (t) => {
  const { book } = await fixture()
  const captured = await loadBookImageSettings(book.id)
  const instructions = s.imageModelInstructions(captured)
  assert.match(instructions, /Book image|Book video/)
  assert.doesNotMatch(instructions, /Global image|Global video|local-image-secret|"keys"/)
  const image = executeImageProposal(proposalCall({ prompt: 'A quiet harbor' }), captured).imageGeneration
  const video = executeImageProposal(proposalCall({ prompt: 'A quiet harbor', task: 'text-to-video' }), captured).imageGeneration
  assert.equal(image.modelAlias, 'Book image')
  assert.equal(video.modelAlias, 'Book video')
  assert.equal(executeImageProposal(proposalCall({ prompt: 'A quiet harbor', model_alias: 'Global image' }), captured).imageGeneration, undefined)
  assert.equal((await store.listImageJobs()).length, 0)
})

test('approved proposals queue book media parameters, video options and source blobs, never global favorites', async (t) => {
  const { book } = await fixture()
  const settings = await loadBookImageSettings(book.id)
  const conversation = await createChat(book.id)
  const proposal = executeImageProposal(proposalCall({ prompt: 'Animate the gate', task: 'image-to-video' }), settings).imageGeneration
  const message = await createChatMessage(conversation, 'assistant', '', { imageGenerations: [proposal] })
  const source = { id: 'source', data: png, mime: 'image/png', width: 1, height: 1 }
  const draft = { prompt: 'Animate the gate', alias: 'Book video', size: '1344x768', task: 'image-to-video', sources: [source], duration: 10, resolution: '1080p', aspectRatio: '16:9', seed: 41 }
  const origin = { bookId: book.id, chatId: conversation.id, messageId: message.id, proposalId: proposal.id }
  const job = await store.enqueueImageProposal(draft, origin, settings)
  assert.equal(job.model, 'p-video')
  assert.equal(job.modelAlias, 'Book video')
  assert.equal(job.video.duration, 10)
  assert.equal(job.video.resolution, '1080p')
  assert.equal(job.video.seed, 41)
  assert.equal(job.localConnectionFingerprint, await imageConnectionFingerprint(job.provider, captureImageCredentials(job.provider)))
  assert.equal((await store.listImageJobs())[0].localConnectionFingerprint, job.localConnectionFingerprint)
  assert.equal(await job.sources[0].data.text(), 'fixture')
  assert.equal((await p.getEntity(message.id)).imageGenerations[0].status, 'accepted')
  assert.deepEqual((await p.getEntity(message.id)).imageGenerations[0].draft, draft)
})

test('enqueue refuses an alias that now points to a different paid model', async (t) => {
  const { book, image } = await fixture()
  const captured = await loadBookImageSettings(book.id)
  const spec = s.resolveImageSpec('A quiet harbor', 'Book image', undefined, undefined, captured)
  image.media = media([favorite('gpt-image-2', 'Book image')])
  profiles.saveSettingsProfile(image)
  await assert.rejects(store.enqueueImageJob(spec, { bookId: book.id }), /model changed/)
  assert.equal((await store.listImageJobs()).length, 0)
})

test('approval refuses profile option changes rather than silently increasing paid quality', async (t) => {
  const { book, image } = await fixture()
  const captured = await loadBookImageSettings(book.id)
  const spec = s.resolveImageSpec('A quiet harbor', 'Book image', undefined, undefined, captured)
  image.media.favorites[0].quality = 'high'
  profiles.saveSettingsProfile(image)
  await assert.rejects(store.enqueueImageJob(spec, { bookId: book.id }), /options changed/)
  assert.equal((await store.listImageJobs()).length, 0)
})

test('explicit retry without a ticket binds current credentials but preserves the frozen model after alias rebinding or deletion', async (t) => {
  const { book, image } = await fixture()
  const settings = await loadBookImageSettings(book.id)
  const original = await store.enqueueImageJob(s.resolveImageSpec('A quiet harbor', 'Book image', '1536x1024', undefined, settings), { bookId: book.id })
  await (await p.database()).table('imageJobs').update(original.id, { status: 'failed', error: 'Interrupted fixture' })
  image.media = media([favorite('gpt-image-2', 'Book image')])
  profiles.saveSettingsProfile(image)
  s.saveImageSettings({ ...s.loadImageSettings(), keys: { ...keys, openai: 'approved-retry-key' } })
  const currentFingerprint = await imageConnectionFingerprint('openai', captureImageCredentials('openai'))
  await store.retryImageJob(original.id)
  const retry = (await store.listImageJobs()).find(job => job.id !== original.id)
  assert.equal(retry.provider, original.provider)
  assert.equal(retry.model, original.model)
  assert.equal(retry.quality, original.quality)
  assert.equal(retry.size.value, original.size.value)
  assert.equal(retry.error, undefined)
  assert.equal(retry.localConnectionFingerprint, currentFingerprint)
  assert.notEqual(retry.localConnectionFingerprint, original.localConnectionFingerprint)
  assert.equal((await store.listImageJobs()).find(job => job.id === original.id).localConnectionFingerprint, original.localConnectionFingerprint)
  image.media = media([])
  profiles.saveSettingsProfile(image)
  let generated
  await runImageQueue('openai', { ...deps, generate: async job => { generated = job; return { image: png } } })
  assert.equal(generated.model, original.model)
  assert.equal((await store.listImageJobs()).find(job => job.id === retry.id).status, 'completed')
})

test('provider-job continuation retains the original ID and options after profile edits', async (t) => {
  const { book, video } = await fixture()
  const settings = await loadBookImageSettings(book.id)
  const original = await store.enqueueImageJob(s.resolveImageSpec('A harbor', 'Book video', '1344x768', undefined, settings, 'text-to-video', [], { duration: 10 }), { bookId: book.id })
  await (await p.database()).table('imageJobs').update(original.id, { status: 'failed', providerJobId: 'provider-prediction' })
  video.media = media([])
  profiles.saveSettingsProfile(video)
  await store.retryImageJob(original.id)
  let generated
  await runImageQueue('pruna', { ...deps, generate: async job => { generated = job; return { image: png } } })
  assert.equal(generated.id, original.id)
  assert.equal(generated.providerJobId, 'provider-prediction')
  assert.equal(generated.localConnectionFingerprint, original.localConnectionFingerprint)
  assert.equal(generated.model, 'p-video')
  assert.equal(generated.video.duration, 10)
  assert.equal((await store.listImageJobs()).length, 1)
})

test('direct requested images use the captured selected-book profile, never rebound global favorites', async () => {
  const { book, image } = await fixture()
  const mediaSettings = await loadBookImageSettings(book.id)
  const conversation = await createChat(book.id)
  const user = await createChatMessage(conversation, 'user', 'Draw a portrait of the keeper')
  image.media = media([favorite('gpt-image-2', 'Book image')])
  profiles.saveSettingsProfile(image)
  const request = { chat: conversation, userMessageId: user.id, userText: user.content, responseId: 'direct-response', roundNumber: 1, callId: 'direct-call', prompt: 'The keeper at the harbor', mediaSettings }
  const result = await queueRequestedImage(request)
  const [job] = await store.listImageJobs()
  assert.equal(job.id, result.jobId)
  assert.equal(job.modelAlias, 'Book image')
  assert.equal(job.model, 'gpt-image-1.5')
  assert.equal(job.size.value, mediaSettings.favorites[0].defaultSize)
  assert.equal(job.quality, mediaSettings.favorites[0].quality)
  assert.equal(job.localConnectionFingerprint, await imageConnectionFingerprint(job.provider, captureImageCredentials(job.provider)))
  assert.doesNotMatch(JSON.stringify(job), /local-image-secret|local-pruna-secret/)
  const reused = await queueRequestedImage(request)
  assert.equal(reused.reused, true)
  assert.equal(reused.jobId, job.id)
  assert.equal((await store.listImageJobs()).length, 1)
  s.saveImageSettings({ ...s.loadImageSettings(), keys: { ...keys, openai: 'changed-direct-image-key' } })
  const replay = await queueRequestedImage(request)
  assert.equal(replay.reused, true)
  assert.equal(replay.jobId, job.id)
  let requests = 0
  await runImageQueue('openai', { ...deps, generate: async () => { requests++; return { image: png } } })
  assert.equal(requests, 0)
  const [failed] = await store.listImageJobs()
  assert.equal(failed.status, 'failed')
  assert.equal(failed.localConnectionFingerprint, job.localConnectionFingerprint)
  assert.match(failed.error, /endpoint or account changed.*queued/)
  assert.equal((await p.getEntity(user.id)).directImageClaim.jobId, job.id)
})

test('direct image references resolve image-to-image from the captured profile and freeze source bytes', async () => {
  const { book } = await fixture()
  const mediaSettings = await loadBookImageSettings(book.id)
  const db = await p.database()
  await db.table('galleryImages').put({ ...output, id: 'selected-reference', bookId: book.id, kept: true, kind: 'image', prompt: 'Keeper reference', createdAt: 1 })
  const conversation = await updateChat((await createChat(book.id)).id, { directImageReferenceIds: ['selected-reference'] })
  const user = await createChatMessage(conversation, 'user', 'Create a portrait of the keeper')
  await queueRequestedImage({ chat: conversation, userMessageId: user.id, userText: user.content, responseId: 'direct-reference', roundNumber: 1, callId: 'reference-call', prompt: 'Keeper by the gate', mediaSettings })
  const [job] = await store.listImageJobs()
  assert.equal(job.task, 'image-to-image')
  assert.equal(job.model, 'gpt-image-1.5')
  assert.equal(job.modelAlias, 'Book image')
  assert.deepEqual(job.sources.map(source => source.id), ['selected-reference'])
  assert.equal(await job.sources[0].data.text(), 'fixture')
  await db.table('galleryImages').delete('selected-reference')
  assert.equal(await (await store.listImageJobs())[0].sources[0].data.text(), 'fixture')
})

test('direct requests without a captured media inventory fail instead of falling back to global models', async () => {
  const { book } = await fixture()
  const conversation = await createChat(book.id)
  const user = await createChatMessage(conversation, 'user', 'Draw a portrait of the keeper')
  await assert.rejects(queueRequestedImage({ chat: conversation, userMessageId: user.id, userText: user.content, responseId: 'missing-snapshot', roundNumber: 1, callId: 'direct-call', prompt: 'The keeper' }), /captured media settings/)
  assert.equal((await store.listImageJobs()).length, 0)
  assert.equal((await p.getEntity(user.id)).directImageClaim, undefined)
})

test('new queued jobs bind their connection before execution and reject endpoint or account changes', async () => {
  const { book } = await fixture()
  const settings = await loadBookImageSettings(book.id)
  const db = await p.database()
  const originalAi = ai.loadAiSettings()
  for (const [provider, change] of [['pruna', 'endpoint'], ['pruna', 'account'], ['openai', 'account']]) {
    await db.table('imageJobs').clear()
    ai.saveAiSettings(originalAi)
    s.saveImageSettings({ ...s.loadImageSettings(), keys })
    const spec = s.resolveImageSpec('A harbor', provider === 'pruna' ? 'Book video' : 'Book image', undefined, undefined, settings, provider === 'pruna' ? 'text-to-video' : 'text-to-image')
    const expectedFingerprint = await imageConnectionFingerprint(provider, captureImageCredentials(provider))
    const queued = await store.enqueueImageJob(spec, { bookId: book.id })
    assert.equal(queued.status, 'queued')
    assert.equal(queued.providerJobId, undefined)
    assert.equal(queued.localConnectionFingerprint, expectedFingerprint)
    assert.equal((await store.listImageJobs())[0].localConnectionFingerprint, expectedFingerprint)
    if (provider === 'openai') s.saveImageSettings({ ...s.loadImageSettings(), keys: { ...keys, openai: 'changed-queued-key' } })
    else ai.saveAiSettings({ ...originalAi, ...(change === 'endpoint' ? { baseUrl: 'https://changed-gateway.invalid/v1' } : { apiKey: 'changed-account-key' }) })
    let requests = 0
    await runImageQueue(provider, { ...deps, generate: async () => { requests++; return { image: png } } })
    assert.equal(requests, 0)
    const [failed] = await store.listImageJobs()
    assert.equal(failed.id, queued.id)
    assert.equal(failed.status, 'failed')
    assert.equal(failed.providerJobId, undefined)
    assert.equal(failed.localConnectionFingerprint, expectedFingerprint)
    assert.match(failed.error, /endpoint or account changed.*queued/)
    assert.match(failed.error, /explicitly retry/)
    assert.doesNotMatch(JSON.stringify(failed), /changed-queued-key|changed-account-key|changed-gateway/)
  }
})

test('duplicate approved submissions keep their original queued connection instead of rebinding it', async () => {
  const { book } = await fixture()
  const settings = await loadBookImageSettings(book.id)
  const spec = s.resolveImageSpec('A harbor', 'Book image', undefined, undefined, settings)
  const origin = { bookId: book.id, submissionId: 'same-approved-submission' }
  const original = await store.enqueueImageJob(spec, origin)
  s.saveImageSettings({ ...s.loadImageSettings(), keys: { ...keys, openai: 'new-duplicate-key' } })
  const duplicate = await store.enqueueImageJob(spec, origin)
  assert.equal(duplicate.id, original.id)
  assert.equal(duplicate.localConnectionFingerprint, original.localConnectionFingerprint)
  assert.equal((await store.listImageJobs()).length, 1)
  let requests = 0
  await runImageQueue('openai', { ...deps, generate: async () => { requests++; return { image: png } } })
  assert.equal(requests, 0)
  assert.equal((await store.listImageJobs())[0].localConnectionFingerprint, original.localConnectionFingerprint)
})

test('legacy non-ticket jobs may bind current credentials on execution, but persist them before requesting', async () => {
  const spec = s.resolveImageSpec('A harbor', 'Global image')
  const db = await p.database()
  await db.table('imageJobs').put({ ...spec, id: 'legacy-without-ticket', status: 'queued', createdAt: 1 })
  const expectedFingerprint = await imageConnectionFingerprint('openai', captureImageCredentials('openai'))
  let requests = 0
  await runImageQueue('openai', { ...deps, generate: async () => {
    requests++
    assert.equal((await store.listImageJobs())[0].localConnectionFingerprint, expectedFingerprint)
    return { image: png }
  } })
  assert.equal(requests, 1)
  const [completed] = await store.listImageJobs()
  assert.equal(completed.status, 'completed')
  assert.equal(completed.localConnectionFingerprint, expectedFingerprint)
})

test('durable ticket retries reject changed endpoints and accounts; execution rechecks the connection', async () => {
  const { book } = await fixture()
  const settings = await loadBookImageSettings(book.id)
  const original = await store.enqueueImageJob(s.resolveImageSpec('A harbor', 'Book video', undefined, undefined, settings, 'text-to-video'), { bookId: book.id })
  const originalAi = ai.loadAiSettings()
  let submitted = 0
  await runImageQueue('pruna', { ...deps, generate: async (job, _credentials, _signal, onSubmitted) => {
    submitted++
    await onSubmitted('durable-prediction')
    const stored = (await store.listImageJobs()).find(item => item.id === job.id)
    assert.match(stored.localConnectionFingerprint, /^sha256:[a-f0-9]{64}$/)
    assert.equal(stored.providerJobId, 'durable-prediction')
    throw new Error('Polling interrupted')
  } })
  const [ticket] = await store.listImageJobs()
  assert.doesNotMatch(JSON.stringify(ticket), /local-pruna-secret|original-gateway/)
  for (const changed of [{ ...originalAi, baseUrl: 'https://other-gateway.invalid/v1' }, { ...originalAi, apiKey: 'different-account-key' }]) {
    ai.saveAiSettings(changed)
    await assert.rejects(store.retryImageJob(original.id), /endpoint or account changed/)
    const [stored] = await store.listImageJobs()
    assert.equal(stored.status, 'failed')
    assert.equal(stored.providerJobId, 'durable-prediction')
    assert.equal(stored.localConnectionFingerprint, ticket.localConnectionFingerprint)
  }
  ai.saveAiSettings(originalAi)
  await store.retryImageJob(original.id)
  // A connection edit after Retry but before the worker starts must also be caught.
  ai.saveAiSettings({ ...originalAi, baseUrl: 'https://other-gateway.invalid/v1' })
  await runImageQueue('pruna', { ...deps, generate: async () => { submitted++; return { image: png } } })
  assert.equal(submitted, 1)
  assert.match((await store.listImageJobs())[0].error, /endpoint or account changed/)
  ai.saveAiSettings(originalAi)
  await store.retryImageJob(original.id)
  await runImageQueue('pruna', { ...deps, generate: async job => {
    assert.equal(job.providerJobId, 'durable-prediction')
    assert.equal(job.model, original.model)
    return { image: png }
  } })
  assert.equal((await store.listImageJobs())[0].status, 'completed')
  assert.equal((await store.listImageJobs()).length, 1)
})

test('legacy or unsupported tickets require review/restart and never silently submit a paid request', async () => {
  const db = await p.database()
  for (const provider of ['pruna', 'nanogpt', 'openai']) {
    await db.table('imageJobs').clear()
    const spec = s.resolveImageSpec('A harbor', 'Global image')
    const job = { ...spec, id: `legacy-${provider}`, provider, task: provider === 'nanogpt' ? 'text-to-video' : 'text-to-image', status: 'failed', createdAt: 1, providerJobId: 'legacy-ticket' }
    await db.table('imageJobs').put(job)
    await assert.rejects(store.retryImageJob(job.id), /Review the provider history before restarting/)
    assert.equal((await store.listImageJobs())[0].status, 'failed')
    // Crash recovery reaches the same guard even without a manual Retry action.
    await db.table('imageJobs').update(job.id, { status: 'running' })
    await store.recoverImageJobs(provider)
    let requests = 0
    await runImageQueue(provider, { ...deps, generate: async () => { requests++; return { image: png } } })
    assert.equal(requests, 0)
    const [failed] = await store.listImageJobs()
    assert.equal(failed.status, 'failed')
    assert.equal(failed.providerJobId, 'legacy-ticket')
    assert.equal(failed.localConnectionFingerprint, undefined)
    assert.match(failed.error, /Review the provider history before restarting/)
  }
})

test('NanoGPT video tickets reject account changes without rebinding their model', async () => {
  const db = await p.database()
  ai.saveAiSettings({ ...ai.initialAiSettings, provider: 'nanogpt', apiKey: 'nano-original-key' })
  const spec = s.resolveImageSpec('A harbor', 'Global video', undefined, undefined, await loadBookImageSettings(), 'text-to-video')
  const localConnectionFingerprint = await imageConnectionFingerprint('nanogpt', captureImageCredentials('nanogpt'))
  const ticket = { ...spec, id: 'nano-ticket', provider: 'nanogpt', model: 'frozen-nano-video', status: 'failed', createdAt: 1, providerJobId: 'nano-request', localConnectionFingerprint }
  await db.table('imageJobs').put(ticket)
  ai.saveAiSettings({ ...ai.loadAiSettings(), apiKey: 'nano-other-key' })
  await assert.rejects(store.retryImageJob(ticket.id), /endpoint or account changed/)
  assert.equal((await store.listImageJobs())[0].model, 'frozen-nano-video')
  ai.saveAiSettings({ ...ai.loadAiSettings(), apiKey: 'nano-original-key' })
  await store.retryImageJob(ticket.id)
  await runImageQueue('nanogpt', { ...deps, key: async () => captureImageCredentials('nanogpt'), generate: async job => {
    assert.equal(job.model, 'frozen-nano-video')
    assert.equal(job.providerJobId, 'nano-request')
    return { image: png }
  } })
  assert.equal((await store.listImageJobs())[0].status, 'completed')
})

test('queue credentials stay fixed through submission and polling despite connection edits', async () => {
  const { book } = await fixture()
  const settings = await loadBookImageSettings(book.id)
  const original = await store.enqueueImageJob(s.resolveImageSpec('A harbor', 'Book video', undefined, undefined, settings, 'text-to-video'), { bookId: book.id })
  const credentials = captureImageCredentials('pruna')
  const fingerprint = await imageConnectionFingerprint('pruna', credentials)
  let reads = 0
  await runImageQueue('pruna', { ...deps, key: async () => { reads++; return credentials }, generate: async (job, captured, _signal, onSubmitted) => {
    assert.equal(captured.key, 'local-pruna-secret')
    assert.equal(captured.gatewayUrl, 'https://original-gateway.invalid/pruna')
    ai.saveAiSettings({ ...ai.loadAiSettings(), apiKey: 'edited-key', baseUrl: 'https://edited-gateway.invalid/v1' })
    credentials.key = 'mutated-key'
    credentials.gatewayUrl = 'https://mutated-gateway.invalid/pruna'
    await onSubmitted('fixed-connection-ticket')
    assert.equal(captured.key, 'local-pruna-secret')
    assert.equal(captured.gatewayUrl, 'https://original-gateway.invalid/pruna')
    const [stored] = await store.listImageJobs()
    assert.equal(stored.localConnectionFingerprint, fingerprint)
    assert.equal(stored.providerJobId, 'fixed-connection-ticket')
    assert.equal(stored.model, original.model)
    return { image: png }
  } })
  assert.equal(reads, 1)
  assert.equal((await store.listImageJobs())[0].status, 'completed')
})

test('queue uses global provider credentials and the frozen model, not book text connection settings', async (t) => {
  const { book } = await fixture()
  ai.saveAiSettings({ ...ai.initialAiSettings, provider: 'openai', apiKey: 'global-text-secret' })
  const settings = await loadBookImageSettings(book.id)
  const original = await store.enqueueImageJob(s.resolveImageSpec('A harbor', 'Book image', undefined, undefined, settings), { bookId: book.id })
  // Unrelated profile conflicts must not prevent execution of an already frozen job.
  const defaultVideo = profiles.loadSettingsProfiles().profiles.find(profile => profile.id === profiles.loadSettingsProfiles().defaults.video)
  defaultVideo.media = media([favorite('p-video', 'Global image')])
  profiles.saveSettingsProfile(defaultVideo)
  const previousFetch = globalThis.fetch
  let authorization, body
  globalThis.fetch = async (_url, options) => {
    authorization = options.headers.Authorization
    body = JSON.parse(options.body)
    throw new Error('Fixture stops before any provider request')
  }
  try { await runImageQueue('openai') } finally { globalThis.fetch = previousFetch }
  assert.equal(authorization, 'Bearer local-image-secret')
  assert.equal(body.model, original.model)
  assert.equal((await store.listImageJobs())[0].status, 'failed')
})

test('controlled profile editing only emits callbacks; Save/discard and timers never persist settings', async (t) => {
  const original = { ...media([favorite('gpt-image-1', 'Image favorite'), favorite('p-video', 'Video favorite')]), keys }
  const legacyBefore = localStorage.getItem(s.IMAGE_SETTINGS_KEY)
  const libraryBefore = localStorage.getItem(profiles.SETTINGS_PROFILES_STORAGE_KEY)
  let current = original, changes = 0, dirtyCalls = 0
  const ref = React.createRef()
  function Controlled() {
    const [value, setValue] = React.useState(original)
    return h(SettingsPanel, { ref, ai: ai.initialAiSettings, value, mediaKind: 'video', hideCredentials: true, onDirtyChange: () => dirtyCalls++, onChange: next => { current = next; changes++; setValue(next) } })
  }
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await act(async () => root.unmount()) })
  try {
    await act(async () => root.render(h(Controlled)))
    assert.equal(document.querySelectorAll('input[type=password]').length, 0)
    assert.equal(document.querySelectorAll('.image-favorite').length, 1)
    assert.equal(document.querySelector('.image-favorite input:not([type])').value, 'Video favorite')
    assert.equal(document.querySelectorAll('.image-default-choice').length, 0)
    await input(document.querySelector('.image-favorite input:not([type])'), 'Renamed video')
    assert.equal(changes, 1)
    assert.equal(current.favorites[0].alias, 'Image favorite')
    assert.equal(current.defaultAlias, 'Image favorite')
    assert.equal(current.defaultAliases['text-to-image'], 'Image favorite')
    assert.equal(current.defaultAliases['text-to-video'], 'Renamed video')
    await act(async () => { assert.equal(ref.current.save(), true); ref.current.discard(); await new Promise(resolve => setTimeout(resolve, 450)) })
    assert.equal(dirtyCalls, 0)
    assert.equal(changes, 1)
    assert.equal(localStorage.getItem(s.IMAGE_SETTINGS_KEY), legacyBefore)
    assert.equal(localStorage.getItem(profiles.SETTINGS_PROFILES_STORAGE_KEY), libraryBefore)
    await act(async () => button('Remove favorite').click())
    assert.deepEqual(current.favorites, [original.favorites[0]])
    assert.equal(current.defaultAliases['text-to-image'], 'Image favorite')
    assert.equal(current.defaultAliases['text-to-video'], undefined)
  } finally { await act(async () => root.unmount()) }
})

test('Image and Video catalogs filter capabilities independently and controlled values update from the parent', async (t) => {
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await act(async () => root.unmount()) })
  let changed
  const value = { ...media([]), keys }
  try {
    await act(async () => root.render(h(SettingsPanel, { ai: ai.initialAiSettings, value, mediaKind: 'video', hideCredentials: true, onChange: next => changed = next })))
    await select(selectLabel('Provider'), 'pruna')
    assert.match(document.querySelector('.image-catalog').textContent, /P-Video/)
    assert.doesNotMatch(document.querySelector('.image-catalog').textContent, /P-Image|FLUX/)
    await act(async () => button('Favorite').click())
    assert.ok(changed.favorites[0].tasks.every(task => task.endsWith('video')))
    await act(async () => root.render(h(SettingsPanel, { ai: ai.initialAiSettings, value: { ...media([favorite('p-video', 'Externally replaced')]), keys }, mediaKind: 'video', hideCredentials: true })))
    assert.equal(document.querySelector('.image-favorite input:not([type])').value, 'Externally replaced')
    await act(async () => root.render(h(SettingsPanel, { ai: ai.initialAiSettings, value, mediaKind: 'image', hideCredentials: true })))
    assert.match(document.querySelector('.image-catalog').textContent, /P-Image|FLUX/)
    assert.doesNotMatch(document.querySelector('.image-catalog').textContent, /P-Video|WAN Text to Video|WAN Image to Video/)
  } finally { await act(async () => root.unmount()) }
})

test('book-aware hook refreshes on profile/selection events and never exposes another book’s settings during a switch', async (t) => {
  const first = await fixture(), second = await fixture()
  second.image.media = media([favorite('gpt-image-2', 'Second image')])
  profiles.saveSettingsProfile(second.image)
  let current, wrongScope = false, expected = first.book.id
  function Probe({ bookId }) {
    current = useImageSettings(bookId)
    if (expected === second.book.id && current.favorites.some(model => model.alias === 'Book image')) wrongScope = true
    return h('div', null, current.error || current.favorites.map(model => model.alias).join(','))
  }
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await act(async () => root.unmount()) })
  try {
    await act(async () => root.render(h(Probe, { bookId: first.book.id })))
    await settle(() => current.favorites.some(model => model.alias === 'Book image'))
    first.image.media = media([favorite('gpt-image-1', 'Updated image')])
    await act(async () => profiles.saveSettingsProfile(first.image))
    await settle(() => current.favorites.some(model => model.alias === 'Updated image'))
    expected = second.book.id
    await act(async () => root.render(h(Probe, { bookId: second.book.id })))
    await settle(() => current.favorites.some(model => model.alias === 'Second image'))
    assert.equal(wrongScope, false)
    await act(async () => p.saveBookProfileSelections(second.book.id, profiles.defaultBookProfileSelections()))
    await settle(() => current.favorites.some(model => model.alias === 'Global image'))
    await act(async () => root.render(h(Probe, { bookId: 'deleted-book' })))
    await settle(() => Boolean(current.error))
    assert.equal(current.favorites.length, 0)
    await act(async () => root.render(h(Probe)))
    await settle(() => current.favorites.some(model => model.alias === 'Global image'))
  } finally { await act(async () => root.unmount()) }
})

test('unavailable draft models remain untouched and show an actionable error; book media panels only link global settings', async (t) => {
  const { book } = await fixture()
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await act(async () => root.unmount()) })
  let changes = 0, opened = 0
  const draft = { prompt: 'Preserve this prompt', alias: 'Deleted model', size: '1024x1024', sources: [] }
  try {
    await act(async () => root.render(h(Controls, { bookId: book.id, value: draft, onChange: () => changes++ })))
    await settle(() => document.body.textContent.includes('Deleted model') && document.body.textContent.includes('unavailable'))
    assert.equal(changes, 0)
    assert.equal(document.querySelector('textarea').value, draft.prompt)
    await act(async () => root.render(h(ImagePanel, { bookId: book.id, onOpenSettings: () => opened++ })))
    assert.equal(document.querySelectorAll('input[type=password]').length, 0)
    assert.deepEqual([...document.querySelectorAll('.image-tabs-wrap [role=tab]')].map(tab => tab.textContent.trim()), ['Generate', 'Gallery'])
    await act(async () => button('Global Settings').click())
    assert.equal(opened, 1)
  } finally { await act(async () => root.unmount()) }
})

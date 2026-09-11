import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
const storage = new Map()
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) }
globalThis.window = new EventTarget()
registerHooks({ resolve(s, context, next) {
  if (s.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const url = new URL(s + '.ts', context.parentURL)
    if (existsSync(fileURLToPath(url))) return next(url.href, context)
  }
  return next(s, context)
} })
const png64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6AAAAAElFTkSuQmCC'
const png = new Blob([Buffer.from(png64, 'base64')], { type: 'image/png' })
const output = { image: png, thumbnail: png, width: 1, height: 1 }
const legacy = new Dexie('arc-novel-local-v1')
legacy.version(5).stores({ entities: 'id,type,bookId,parentId,[parentId+order],updatedAt', snapshots: 'id,entityId,entityType,createdAt,[entityId+createdAt],reason', codexDependencies: 'id,bookId,sourceId,targetId,[bookId+sourceId],[bookId+targetId],[sourceId+targetId],updatedAt', meta: 'key', illustrations: 'id,bookId,&entryId,updatedAt', illustrationUndo: 'entryId,bookId' })
await legacy.open()
await legacy.table('entities').bulkPut([
  { id: 'legacy-book', type: 'book', title: 'Keep my novel', createdAt: 1, updatedAt: 1 },
  { id: 'legacy-entry', type: 'codexEntry', title: 'Mara', content: 'Existing lore', bookId: 'legacy-book', parentId: 'legacy-book', category: 'Character', primaryImageId: 'legacy-image', createdAt: 1, updatedAt: 1 },
])
await legacy.table('illustrations').put({ ...output, id: 'legacy-image', entryId: 'legacy-entry', bookId: 'legacy-book', caption: 'Mara', alt: '', cropX: 50, cropY: 50, createdAt: 1 })
await legacy.table('illustrationUndo').put({ id: 'legacy-undo', entryId: 'legacy-entry', bookId: 'legacy-book', expectedImageId: 'legacy-image' })
legacy.close()
const p = await import('../src/persistence.ts')
const s = await import('../src/image-settings.ts')
const store = await import('../src/image-store.ts')
const providers = await import('../src/image-providers.ts')
const { runImageQueue } = await import('../src/image-queue.ts')
const { executeImageProposal } = await import('../src/image-tools.ts')
const chat = await import('../src/chat-service.ts')
const archive = await import('../src/book-archive.ts')
const { initialAiSettings } = await import('../src/ai-settings.ts')
after(async () => (await p.database()).close())
function configure() {
  const favorites = s.documentedImageModels.filter((m) => ['gpt-image-1', 'p-image'].includes(m.id)).map((m) => s.imageFavorite(m, []))
  favorites[0].alias = 'portrait'; favorites[1].alias = 'fast'
  return s.saveImageSettings({ keys: { nanogpt: '', openai: '', pruna: '' }, favorites, defaultAlias: 'portrait' })
}
configure()
function propose(args = { prompt: 'Mara beside the gate' }) { return executeImageProposal({ id: 'call', type: 'function', function: { name: 'propose_image_generation', arguments: JSON.stringify(args) } }) }
async function fixture() {
  configure()
  const { book } = await p.createBook(initialAiSettings, 'Image test ' + crypto.randomUUID())
  const conversation = await chat.createChat(book.id)
  const proposal = propose().imageGeneration
  const message = await chat.createChatMessage(conversation, 'assistant', '', { imageGenerations: [proposal] })
  return { book, conversation, proposal, message, origin: { bookId: book.id, chatId: conversation.id, messageId: message.id, proposalId: proposal.id } }
}
async function enqueue(f, prompt = 'Mara', alias = 'portrait') {
  return store.enqueueImageJob(s.resolveImageSpec(prompt, alias), f?.origin)
}
async function clearJobs() { const db = await p.database(); await db.table('imageJobs').clear(); await db.table('galleryImages').clear() }
const deps = { key: async () => 'test-key', generate: async () => ({ image: png }), prepare: async () => output }
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
const job = (provider, extra = {}) => ({ ...s.resolveImageSpec('A gate', provider === 'pruna' ? 'fast' : 'portrait'), provider, id: 'adapter-test', status: 'running', createdAt: 1, ...extra })

test('v5 upgrade keeps books, lore, illustrations, and undo; new books still work', async () => {
  assert.equal((await p.getEntity('legacy-book')).title, 'Keep my novel')
  assert.equal((await p.getEntity('legacy-entry')).content, 'Existing lore')
  assert.equal((await p.getIllustration('legacy-entry')).image.size, png.size)
  assert.equal((await p.getIllustrationUndo('legacy-entry')).id, 'legacy-undo')
  assert.equal((await p.database()).verno, 6)
  assert.ok((await p.createBook(initialAiSettings, 'Created after upgrade')).book.id)
})

test('keys fall back only to the matching AI provider; model instructions contain no credentials', () => {
  const settings = configure()
  const ai = { ...initialAiSettings, provider: 'nanogpt', apiKey: 'nano-secret', providerProfiles: { openai: { apiKey: 'openai-secret' } } }
  assert.equal(s.resolveImageKey('nanogpt', settings, ai), 'nano-secret')
  assert.equal(s.resolveImageKey('openai', settings, ai), 'openai-secret')
  assert.equal(s.resolveImageKey('pruna', settings, ai), '')
  settings.keys.openai = 'image-secret'
  assert.equal(s.resolveImageKey('openai', settings, ai), 'image-secret')
  s.saveImageSettings(settings)
  assert.doesNotMatch(s.imageModelInstructions(), /secret|apiKey/)
  assert.match(s.imageModelInstructions(), /portrait/)
  configure()
})

test('favorites validate aliases and dimensions; ratio resolves an enabled size only', () => {
  const settings = configure()
  assert.equal(s.resolveImageSpec('gate').size.value, '1024x1024')
  assert.equal(s.resolveImageSpec('gate', 'portrait', undefined, '3:2').size.value, '1536x1024')
  assert.throws(() => s.resolveImageSpec('gate', 'missing'), /favorite/)
  assert.throws(() => s.resolveImageSpec('gate', 'portrait', '2048x2048'), /not enabled/)
  assert.throws(() => s.resolveImageSpec('gate', 'portrait', '1536x1024', '1:1'), /not enabled/)
  settings.favorites[1].alias = 'PORTRAIT'
  assert.throws(() => s.validateImageSettings(settings), /unique/)
})

test('proposal and acceptance never generate; origin and approval are enforced', async () => {
  await clearJobs()
  const f = await fixture()
  assert.equal(propose({ prompt: 'gate', model_alias: 'unknown' }).imageGeneration, undefined)
  assert.equal((await store.listImageJobs()).length, 0)
  await assert.rejects(enqueue(f), /Accept/)
  await store.setImageProposal(f.message.id, f.proposal.id, 'accepted', { prompt: 'Edited prompt', alias: 'fast', size: '1344x768' })
  assert.equal((await store.listImageJobs()).length, 0)
  assert.equal((await p.getEntity(f.message.id)).imageGenerations[0].prompt, 'Edited prompt')
  await assert.rejects(store.setImageProposal(f.message.id, f.proposal.id, 'accepted'), /handled/)
  await assert.rejects(store.enqueueImageJob(s.resolveImageSpec('gate'), { ...f.origin, chatId: 'wrong-chat' }), /Accept/)
})

test('repeated clicks freeze separate requests; competing workers submit each job once', async () => {
  await clearJobs()
  const f = await fixture()
  await store.setImageProposal(f.message.id, f.proposal.id, 'accepted')
  const one = await enqueue(f, 'First prompt'), two = await enqueue(f, 'Second prompt')
  assert.notEqual(one.id, two.id)
  const submissions = []
  const adapter = { ...deps, generate: async (j) => { submissions.push(j.prompt); await new Promise((r) => setTimeout(r, 5)); return { image: png } } }
  await Promise.all([runImageQueue('openai', adapter), runImageQueue('openai', adapter)])
  assert.deepEqual(submissions.sort(), ['First prompt', 'Second prompt'])
  const jobs = await store.listImageJobs()
  assert.ok(jobs.every((j) => j.status === 'completed'))
  assert.equal((await store.listGalleryImages()).filter((a) => !a.entryId).length, 0)
  await store.decideImageJob(one.id, true)
  await store.decideImageJob(one.id, true)
  await store.hideImageFromChat(one.id)
  assert.equal((await store.listGalleryImages(f.book.id)).length, 1)
  await store.decideImageJob(two.id, false)
  assert.equal(await store.getGalleryImage(jobs.find((j) => j.id === two.id).assetId), undefined)
  await chat.deleteChat(f.conversation.id)
  assert.equal((await store.listGalleryImages(f.book.id)).length, 1)
  assert.equal((await store.listImageJobs()).length, 0)
})

test('navigation does not change a queued request’s book; deleting a book keeps saved gallery images', async () => {
  await clearJobs()
  const first = await fixture(), second = await fixture()
  await store.setImageProposal(first.message.id, first.proposal.id, 'accepted')
  const queued = await enqueue(first)
  await runImageQueue('openai', deps)
  await store.decideImageJob(queued.id, true)
  assert.equal((await store.listGalleryImages(second.book.id)).length, 0)
  assert.equal((await store.listGalleryImages(first.book.id)).length, 1)
  await p.deleteEntityTree(first.book.id)
  assert.equal((await store.listGalleryImages()).filter((a) => !a.entryId).length, 1)
})

test('cancel and deletion prevent a late provider result from restoring an image', async () => {
  await clearJobs()
  const q = await enqueue(undefined)
  const running = await store.claimImageJob('openai', 'worker')
  await store.cancelImageJob(q.id)
  await store.completeImageJob(running, output)
  assert.equal((await store.listImageJobs())[0].status, 'cancelled')
  assert.equal(await (await p.database()).table('galleryImages').count(), 0)
  assert.equal(await store.patchOwnedImageJob(q.id, 'worker', { status: 'completed' }), false)
  await clearJobs()
  const f = await fixture()
  await store.setImageProposal(f.message.id, f.proposal.id, 'accepted')
  await enqueue(f)
  const deleted = await store.claimImageJob('openai', 'worker')
  await chat.deleteChat(f.conversation.id)
  await store.completeImageJob(deleted, output)
  assert.equal(await (await p.database()).table('galleryImages').count(), 0)
})

test('restart interrupts unknown requests and resumes only recorded Pruna jobs', async () => {
  await clearJobs()
  await enqueue(undefined)
  await store.claimImageJob('openai', 'old-tab')
  await store.recoverImageJobs('openai')
  let count = 0
  await runImageQueue('openai', { ...deps, generate: async () => { count++; return { image: png } } })
  assert.equal(count, 0)
  assert.equal((await store.listImageJobs())[0].status, 'interrupted')
  const queued = await enqueue(undefined, 'gate', 'fast')
  await store.claimImageJob('pruna', 'old-tab')
  await store.patchOwnedImageJob(queued.id, 'old-tab', { providerJobId: 'prediction-1' })
  await store.recoverImageJobs('pruna')
  await runImageQueue('pruna', { ...deps, generate: async (j) => { assert.equal(j.providerJobId, 'prediction-1'); return { image: png } } })
  assert.equal((await store.listImageJobs()).find((j) => j.id === queued.id).status, 'completed')
})

test('provider failure is persisted without retrying or recording credentials', async () => {
  await clearJobs(); await enqueue(undefined)
  let count = 0
  await runImageQueue('openai', { ...deps, generate: async () => { count++; throw new Error('Bad test-key') } })
  assert.equal(count, 1)
  const [failed] = await store.listImageJobs()
  assert.equal(failed.status, 'failed')
  assert.match(failed.error, /redacted/)
  assert.doesNotMatch(JSON.stringify(failed), /test-key/)
})

test('NanoGPT discovery uses explicit numeric capabilities and excludes edit-only or multi-output models', () => {
  const model = { id: 'flux', capabilities: { image_generation: true }, supported_parameters: { resolutions: ['1024x1024', '16:9', '1024x1024', '1280x720'] } }
  const list = providers.normalizeNanoImageModels({ data: [model, { ...model, id: 'edit', capabilities: {} }, { ...model, id: 'multi', supported_parameters: { ...model.supported_parameters, fixed_image_count: 4 } }] })
  assert.deepEqual(list.map((m) => m.id), ['flux'])
  assert.deepEqual(list[0].sizes.map((s) => s.value), ['1024x1024', '1280x720'])
})

test('NanoGPT and OpenAI submit one output with the correct fields and decode original bytes', async () => {
  for (const provider of ['openai', 'nanogpt']) {
    const calls = []
    const result = await providers.generateProviderImage(job(provider), 'key', new AbortController().signal, async () => {}, async (url, init) => { calls.push({ url, init }); return response({ data: [{ b64_json: png64, revised_prompt: 'A revised gate' }], cost: 0.02, seed: 42 }) })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].init.headers.Authorization, 'Bearer key')
    const body = JSON.parse(calls[0].init.body)
    assert.equal(body.n, 1); assert.equal(body.size, '1024x1024')
    assert.equal(body.quality, provider === 'openai' ? 'low' : undefined)
    assert.equal(body.moderation, provider === 'openai' ? 'low' : undefined)
    assert.equal(body[provider === 'openai' ? 'output_format' : 'response_format'], provider === 'openai' ? 'png' : 'b64_json')
    assert.deepEqual(await result.image.arrayBuffer(), await png.arrayBuffer())
    assert.equal(result.revisedPrompt, 'A revised gate')
  }
})

test('Pruna catalog hardcodes verified image and video capabilities, sizes, and flat costs', () => {
  assert.deepEqual(s.prunaImageModels.map((m) => m.id), ['flux-dev', 'qwen-image', 'qwen-image-fast', 'z-image-turbo', 'flux-2-klein-4b', 'wan-image-small', 'p-image', 'p-image-edit', 'qwen-image-edit-plus', 'wan-i2v', 'p-video', 'wan-t2v'])
  assert.equal(s.prunaImageModels.find((m) => m.id === 'qwen-image').cost, 0.025)
  assert.equal(s.prunaImageModels.find((m) => m.id === 'flux-2-klein-4b').cost, 0.0001)
  assert.equal(s.prunaImageModels.find((m) => m.id === 'p-image').ratios.includes('16:9'), true)
  assert.equal(s.prunaImageModels.find((m) => m.id === 'z-image-turbo').sizeMode, 'dimensions')
  assert.deepEqual(s.prunaImageModels.find((m) => m.id === 'p-image-edit').tasks, ['image-to-image'])
  assert.deepEqual(s.prunaImageModels.find((m) => m.id === 'p-video').tasks, ['text-to-video', 'image-to-video'])
})

test('OpenAI edits use the current multipart Image API with repeated source fields', async () => {
  const source = { id: 'source', mime: 'image/png', data: png, width: 1, height: 1 }
  const calls = []
  await providers.generateProviderImage(job('openai', { model: 'gpt-image-2.5-sunburst', task: 'image-to-image', sources: [source], quality: 'max' }), 'key', new AbortController().signal, async () => {}, async (url, init) => {
    calls.push({ url, init })
    assert.equal(url, 'https://api.openai.com/v1/images/edits')
    assert.equal(init.body.get('model'), 'gpt-image-2.5-sunburst')
    assert.equal(init.body.get('quality'), 'max')
    assert.equal(init.body.getAll('image[]').length, 1)
    return response({ data: [{ b64_json: png64 }] })
  })
  assert.equal(calls.length, 1)
})

test('Pruna image editing uploads sources and uses each model-specific source field', async () => {
  const source = { id: 'source', mime: 'image/png', data: png, width: 1, height: 1 }
  for (const [model, field] of [['p-image-edit', 'images'], ['qwen-image-edit-plus', 'image']]) {
    const calls = []
    await providers.generateProviderImage(job('pruna', { model, task: 'image-to-image', sources: [source] }), 'key', new AbortController().signal, async () => {}, async (url, init) => {
      calls.push({ url, init })
      if (url.endsWith('/v1/files')) { assert.equal(init.body.getAll('content').length, 1); return response({ urls: { get: '/v1/files/uploaded' } }) }
      if (url.endsWith('/v1/predictions')) { const input = JSON.parse(init.body).input; assert.deepEqual(input[field], ['https://api.pruna.ai/v1/files/uploaded']); return response({ status: 'complete', generation_url: '/v1/predictions/delivery/edit' }) }
      return new Response(png)
    })
    assert.equal(calls.length, 3)
  }
})

test('NanoGPT video persists request IDs, polls, and downloads a validated video', async () => {
  const video = new Blob([new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109])], { type: 'video/mp4' })
  const submitted = [], calls = []
  const result = await providers.generateProviderImage(job('nanogpt', { model: 'pruna-ai/p-video/text-to-video', task: 'text-to-video', video: { resolution: '720p', duration: 5, aspectRatio: '16:9' } }), 'key', new AbortController().signal, async (id) => submitted.push(id), async (url, init) => {
    calls.push({ url, init })
    if (url.endsWith('/api/generate-video')) { const body = JSON.parse(init.body); assert.equal(body.duration, '5'); return response({ requestId: 'video-request' }, 202) }
    if (url.includes('/api/video/status')) return response({ status: 'completed', url: 'https://cdn.example/video.mp4' })
    assert.equal(init.headers['x-api-key'], 'key'); return new Response(video)
  }, async () => {})
  assert.deepEqual(submitted, ['video-request'])
  assert.equal(result.kind, 'video')
  assert.equal(result.image.type, 'video/mp4')
  assert.equal(calls.length, 3)
})

test('Pruna submits an aspect ratio, persists async predictions, and decodes output arrays', async () => {
  for (const resume of [false, true]) {
    const calls = [], submitted = []
    const result = await providers.generateProviderImage(job('pruna', resume ? { providerJobId: 'existing-id' } : {}), 'pruna-key', new AbortController().signal, async (id) => submitted.push(id), async (url, init) => {
      calls.push({ url, init })
      if (init.method === 'POST') {
        assert.equal(init.headers.Model, 'p-image'); assert.equal(init.headers['Try-Sync'], 'true')
        assert.deepEqual(JSON.parse(init.body), { input: { prompt: 'A gate', aspect_ratio: '1:1' } })
        return response({ id: 'existing-id' })
      }
      if (url.includes('/status/')) { if (!resume) assert.deepEqual(submitted, ['existing-id']); return response({ status: 'complete', output: ['/v1/predictions/delivery/existing-id'] }) }
      assert.equal(init.headers.apikey, 'pruna-key'); assert.equal(init.redirect, 'error')
      return new Response(png)
    })
    assert.equal(calls.filter((c) => c.init.method === 'POST').length, resume ? 0 : 1)
    assert.equal(result.image.size, png.size)
    assert.equal(result.cost, 0.005)
  }
})

test('Pruna submits dimensions for Z-Image Turbo and decodes synchronous generation URL arrays', async () => {
  const calls = []
  const result = await providers.generateProviderImage(job('pruna', { model: 'z-image-turbo', size: s.imageSize('1344x768') }), 'pruna-key', new AbortController().signal, async () => assert.fail('A synchronous result has no prediction to persist.'), async (url, init) => {
    calls.push({ url, init })
    if (init.method === 'POST') {
      assert.deepEqual(JSON.parse(init.body), { input: { prompt: 'A gate', width: 1344, height: 768 } })
      return response({ status: 'success', generation_url: ['/v1/predictions/delivery/sync-id'] })
    }
    return new Response(png)
  })
  assert.equal(calls.length, 2)
  assert.equal(result.cost, 0.005)
})

test('Pruna rejects unknown models and reports detail errors without leaking keys', async () => {
  let calls = 0
  await assert.rejects(providers.generateProviderImage(job('pruna', { model: 'unknown' }), 'key', new AbortController().signal, async () => {}, async () => { calls++; return response({}) }), /Unsupported Pruna/)
  assert.equal(calls, 0)
  await assert.rejects(providers.generateProviderImage(job('pruna'), 'secret', new AbortController().signal, async () => {}, async () => response({ detail: 'Bad secret' }, 400)), (error) => error.message.includes('Bad [redacted]') && !error.message.includes('secret'))
})

test('delivery rejects unsafe authenticated URLs and errors redact keys', async () => {
  let calls = 0
  await assert.rejects(providers.generateProviderImage(job('pruna', { providerJobId: 'id' }), 'secret', new AbortController().signal, async () => {}, async () => { calls++; return response({ status: 'succeeded', generation_url: 'https://unrelated.example/steal' }) }), /unexpected delivery/)
  assert.equal(calls, 1)
  await assert.rejects(providers.generateProviderImage(job('openai'), 'secret', new AbortController().signal, async () => {}, async () => response({ error: { message: 'Invalid key secret' } }, 401)), (e) => !e.message.includes('secret') && e.message.includes('redacted'))
})

test('v2 backups retain kept originals and chat references, omit active jobs, import safely, and read v1', async () => {
  await clearJobs()
  const f = await fixture()
  await store.setImageProposal(f.message.id, f.proposal.id, 'accepted')
  const q = await enqueue(f)
  await runImageQueue('openai', deps)
  await store.decideImageJob(q.id, true)
  await enqueue(f, 'Still queued')
  const data = await p.readBookArchive(f.book.id)
  assert.equal(data.imageJobs.length, 1)
  assert.equal(data.galleryImages.length, 1)
  const decoded = await archive.decodeBookArchive(archive.encodeBookArchive(data))
  const copied = archive.copyBookArchive(decoded)
  await p.writeBookArchive(copied.data)
  assert.notEqual(copied.data.galleryImages[0].id, decoded.galleryImages[0].id)
  assert.equal(copied.data.imageJobs[0].assetId, copied.data.galleryImages[0].id)
  assert.equal(copied.data.entities.find((e) => e.id === copied.data.imageJobs[0].messageId).imageGenerations[0].status, 'stale')
  assert.equal(copied.data.imageJobs[0].proposalId, copied.data.entities.find((e) => e.id === copied.data.imageJobs[0].messageId).imageGenerations[0].id)
  assert.deepEqual(await copied.data.galleryImages[0].image.arrayBuffer(), await png.arrayBuffer())
  const plain = { format: 'arc-book', version: 1, ...data, galleryImages: undefined, imageJobs: undefined }
  const manifest = new TextEncoder().encode(JSON.stringify(plain)), header = new Uint8Array(12)
  header.set(new TextEncoder().encode('ARCBK001')); new DataView(header.buffer).setUint32(8, manifest.length)
  const old = await archive.decodeBookArchive(new Blob([header, manifest]))
  assert.equal(old.entities.find((e) => e.id === f.book.id).title, f.book.title)
  assert.deepEqual(old.galleryImages, [])
})

test('v3 backups round-trip kept video media and exclude frozen source blobs', async () => {
  await clearJobs()
  const f = await fixture()
  await store.setImageProposal(f.message.id, f.proposal.id, 'accepted')
  const queued = await enqueue(f)
  await runImageQueue('openai', deps)
  await store.decideImageJob(queued.id, true)
  const data = await p.readBookArchive(f.book.id)
  const video = new Blob([new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109])], { type: 'video/mp4' })
  data.galleryImages[0] = { ...data.galleryImages[0], kind: 'video', task: 'text-to-video', image: video, mediaDurationMs: 5000 }
  data.imageJobs[0] = { ...data.imageJobs[0], task: 'text-to-video', sources: [{ id: 'private-source', data: png, mime: 'image/png', width: 1, height: 1 }] }
  const encoded = archive.encodeBookArchive(data)
  const decoded = await archive.decodeBookArchive(encoded)
  assert.equal(decoded.galleryImages[0].kind, 'video')
  assert.equal(decoded.galleryImages[0].image.type, 'video/mp4')
  assert.equal(decoded.imageJobs[0].sources, undefined)
})

test('chat forks share kept attachments without cloning queued requests or reauthorizing proposals', async () => {
  await clearJobs()
  const f = await fixture()
  await store.setImageProposal(f.message.id, f.proposal.id, 'accepted')
  const kept = await enqueue(f)
  await runImageQueue('openai', deps)
  await store.decideImageJob(kept.id, true)
  await enqueue(f, 'Do not fork this queued request')
  const fork = await chat.forkChat(f.conversation, f.message.order)
  const messages = await chat.listChatMessages(f.book.id, fork.id)
  const jobs = (await store.listImageJobs()).filter((j) => j.chatId === fork.id)
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].status, 'completed')
  assert.equal(jobs[0].messageId, messages[0].id)
  assert.equal(messages[0].imageGenerations[0].status, 'stale')
  assert.equal((await store.listGalleryImages(f.book.id)).length, 1)
  await chat.deleteChat(f.conversation.id)
  assert.ok(await store.getGalleryImage(jobs[0].assetId))
  await store.deleteGalleryImage(jobs[0].assetId)
  assert.equal((await store.listImageJobs()).find((j) => j.id === jobs[0].id).decision, 'discarded')
})


test('OpenAI favorites default to low, migrate older settings, and validate saved choices', () => {
  const settings = configure()
  assert.equal(settings.favorites[0].quality, 'low')
  assert.equal(settings.favorites[0].moderation, 'low')
  assert.equal(settings.favorites[1].quality, undefined)
  assert.equal(settings.favorites[1].moderation, undefined)
  delete settings.favorites[0].quality
  delete settings.favorites[0].moderation
  localStorage.setItem(s.IMAGE_SETTINGS_KEY, JSON.stringify(settings))
  const loaded = s.loadImageSettings()
  assert.equal(loaded.favorites[0].quality, 'low')
  assert.equal(loaded.favorites[0].moderation, 'low')
  loaded.favorites[0].quality = 'high'
  loaded.favorites[0].moderation = 'auto'
  s.saveImageSettings(loaded)
  assert.equal(s.loadImageSettings().favorites[0].quality, 'high')
  assert.equal(s.loadImageSettings().favorites[0].moderation, 'auto')
  loaded.favorites[0].quality = 'invalid'
  assert.throws(() => s.saveImageSettings(loaded), /quality/)
  loaded.favorites[0].quality = 'medium'
  loaded.favorites[0].moderation = 'invalid'
  assert.throws(() => s.saveImageSettings(loaded), /moderation/)
  configure()
})

test('queued OpenAI requests keep saved choices after favorites change, including API submission', async () => {
  await clearJobs()
  const settings = configure()
  settings.favorites[0].quality = 'high'
  settings.favorites[0].moderation = 'auto'
  s.saveImageSettings(settings)
  const queued = await enqueue(undefined)
  configure() // Later favorite changes must not alter the queued request.
  const [saved] = await store.listImageJobs()
  assert.equal(saved.id, queued.id)
  assert.equal(saved.quality, 'high')
  assert.equal(saved.moderation, 'auto')
  const bodies = []
  await runImageQueue('openai', { ...deps, generate: (j, key, signal, onSubmitted) => providers.generateProviderImage(j, key, signal, onSubmitted, async (_, init) => {
    bodies.push(JSON.parse(init.body))
    return response({ data: [{ b64_json: png64 }] })
  }) })
  assert.equal(bodies.length, 1)
  assert.equal(bodies[0].quality, 'high')
  assert.equal(bodies[0].moderation, 'auto')
  assert.equal(s.resolveImageSpec('Next image').quality, 'low')
})

test('OpenAI adapter supports every quality choice and defaults legacy jobs to low', async () => {
  for (const quality of [undefined, 'low', 'medium', 'high', 'auto']) {
    const moderation = quality === undefined ? undefined : 'auto'
    await providers.generateProviderImage(job('openai', { quality, moderation }), 'key', new AbortController().signal, async () => {}, async (_, init) => {
      const body = JSON.parse(init.body)
      assert.equal(body.quality, quality ?? 'low')
      assert.equal(body.moderation, moderation ?? 'low')
      return response({ data: [{ b64_json: png64 }] })
    })
  }
})


test('clearing queue preserves kept chat images, discards unkept bytes, and stops late completions', async () => {
  await clearJobs()
  const f = await fixture()
  await store.setImageProposal(f.message.id, f.proposal.id, 'accepted')
  const kept = await enqueue(f), unwanted = await enqueue(f)
  await runImageQueue('openai', deps)
  await store.decideImageJob(kept.id, true)
  const completed = await store.listImageJobs()
  const keptAsset = completed.find((j) => j.id === kept.id).assetId
  const unwantedAsset = completed.find((j) => j.id === unwanted.id).assetId
  const running = await enqueue(undefined)
  const claimed = await store.claimImageJob('openai', 'clear-test')
  const queued = await enqueue(undefined, 'Pending Pruna', 'fast')
  const ids = (await store.listImageJobs()).map((j) => j.id)
  const newer = await enqueue(undefined, 'Added after clear was requested')
  await store.clearImageQueue(ids)
  await store.completeImageJob(claimed, output)
  assert.equal(await store.patchOwnedImageJob(running.id, 'clear-test', { status: 'failed' }), false)
  const jobs = await store.listImageJobs()
  assert.ok(jobs.filter((j) => ids.includes(j.id)).every((j) => j.hiddenInQueue))
  assert.equal(jobs.find((j) => j.id === running.id).status, 'cancelled')
  assert.equal(jobs.find((j) => j.id === queued.id).status, 'cancelled')
  assert.equal(jobs.find((j) => j.id === newer.id).status, 'queued')
  assert.equal(jobs.find((j) => j.id === newer.id).hiddenInQueue, undefined)
  assert.equal(jobs.find((j) => j.id === kept.id).messageId, f.message.id)
  assert.equal(jobs.find((j) => j.id === kept.id).hiddenInChat, undefined)
  assert.equal(jobs.find((j) => j.id === kept.id).assetId, keptAsset)
  assert.equal((await store.getGalleryImage(keptAsset)).kept, true)
  assert.equal(await store.getGalleryImage(unwantedAsset), undefined)
  assert.equal(jobs.find((j) => j.id === unwanted.id).decision, 'discarded')
  assert.equal((await (await p.database()).table('galleryImages').count()), 1)
  await store.clearImageQueue([...ids, 'missing-id']) // Repeat is harmless.
  assert.equal((await store.getGalleryImage(keptAsset)).kept, true)
})

test('removing a failed job leaves others alone; retrying a cleared Pruna job makes it visible', async () => {
  await clearJobs(); configure()
  const failed = await enqueue(undefined), pruna = await enqueue(undefined, 'Pruna', 'fast')
  await runImageQueue('openai', { ...deps, generate: async () => { throw new Error('Generation rejected') } })
  await store.clearImageQueue([failed.id])
  let jobs = await store.listImageJobs()
  assert.equal(jobs.find((j) => j.id === failed.id).hiddenInQueue, true)
  assert.equal(jobs.find((j) => j.id === pruna.id).hiddenInQueue, undefined)
  await store.claimImageJob('pruna', 'pruna-worker')
  await store.patchOwnedImageJob(pruna.id, 'pruna-worker', { providerJobId: 'existing-prediction' })
  await store.clearImageQueue([pruna.id])
  await store.retryImageJob(pruna.id)
  jobs = await store.listImageJobs()
  assert.equal(jobs.find((j) => j.id === pruna.id).hiddenInQueue, false)
  assert.equal(jobs.find((j) => j.id === pruna.id).status, 'queued')
  assert.equal(jobs.find((j) => j.id === pruna.id).providerJobId, 'existing-prediction')
})

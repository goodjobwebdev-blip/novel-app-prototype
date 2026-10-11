import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after } from 'node:test'
import 'fake-indexeddb/auto'
const storage = new Map()
globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) }
globalThis.window = new EventTarget()
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
registerHooks({ resolve(s, context, next) {
  if (s.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const url = new URL(s + '.ts', context.parentURL)
    if (existsSync(fileURLToPath(url))) return next(url.href, context)
  }
  return next(s, context)
} })
const settings = await import('../src/features/images/image-settings.ts')
const ids = ['lucid-origin', 'lucid-realism', 'flux-schnell', 'ideogram/p-image-ideogram', 'krea/krea-2', 'krea-2-turbo']
const persistence = await import('../src/data/persistence.ts')
after(async () => (await persistence.database()).close())
const png = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6AAAAAElFTkSuQmCC', 'base64')], { type: 'image/png' })
const response = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })
test('Leonardo discovery never sends its key to OpenAI and preserves curated contracts without guessing discovery IDs', async () => {
  const { fetchImageModels } = await import('../src/features/images/image-providers.ts')
  let calls = 0
  const offline = await fetchImageModels('leonardo', '', async () => assert.fail('no key means no discovery network'))
  assert.deepEqual(offline.map(m => m.id), ids)
  const models = await fetchImageModels('leonardo', 'fixture-only-key', async (url, init) => {
    calls++
    assert.equal(String(url), 'https://cloud.leonardo.ai/api/rest/v2/models')
    assert.equal(init.headers.Authorization, 'Bearer fixture-only-key')
    assert.equal(init.credentials, 'omit')
    assert.equal(init.redirect, 'error')
    return response({ productionApiAvailableModels: [{ id: 'lucid-origin', name: 'Lucid Origin', parameters: { type: 'object' } }, { id: 'UNPROVEN_KREA_ID', name: 'Krea 2', parameters: {} }] })
  })
  assert.equal(calls, 1)
  assert.deepEqual(models.map(m => m.id), ids)
  assert.match(models[0].description, /discovery.*confirmed/i)
  assert.match(models.find(m => m.id === 'krea/krea-2').description, /not confirmed/i)
  assert.deepEqual(models.map(m => m.sizes), offline.map(m => m.sizes))
  await assert.rejects(() => fetchImageModels('leonardo', 'fixture-only-key', async () => response({ data: [] })), /invalid.*catalog/i)
  await assert.rejects(() => fetchImageModels('leonardo', 'fixture-only-key', async () => new Response('private remote error', { status: 401 })), /401/)
})
test('Leonardo explicit Generate persists snapshot and ticket before polling, keeps Gallery output, and resumes GET-only', async () => {
  const profiles = await import('../src/features/settings/settings-profiles.ts')
  const store = await import('../src/features/images/image-store.ts')
  const { runImageQueue } = await import('../src/features/images/image-queue.ts')
  const { generateProviderImage } = await import('../src/features/images/image-providers.ts')
  const { assertImageJobConnection } = await import('../src/features/images/image-connection.ts')
  const { buildLeonardoRequest } = await import('../src/features/images/leonardo-contracts.ts')
  const favorite = settings.imageFavorite(settings.documentedImageModels.find(m => m.id === 'krea/krea-2' && m.provider === 'leonardo'), [])
  favorite.leonardoOptions = { prompt_enhance: 'OFF', quality: 'HIGH', seed: 0 }
  const configured = settings.saveImageSettings({ keys: { leonardo: 'fixture-only-key' }, favorites: [favorite], defaultAlias: favorite.alias })
  const library = profiles.loadSettingsProfiles()
  const { keys, ...media } = configured
  profiles.saveSettingsProfile({ ...library.profiles.find(p => p.id === library.defaults.image), media })
  const spec = settings.resolveImageSpec('A private fox', favorite.alias, undefined, undefined, configured)
  const queued = await store.enqueueImageJob(spec)
  assert.deepEqual(queued.leonardoOptions, spec.leonardoOptions)
  assert.equal(queued.leonardoContractVersion, 1)
  const calls = []
  let polls = 0
  const fetcher = async (url, init) => {
    calls.push(String(url))
    assert.equal(init.credentials, 'omit')
    assert.equal(init.redirect, 'error')
    if (String(url).endsWith('/v2/generations')) {
      assert.equal(init.method, 'POST')
      assert.equal(init.headers.Authorization, 'Bearer fixture-only-key')
      assert.equal(init.headers.Accept, 'application/json')
      assert.deepEqual(JSON.parse(init.body), buildLeonardoRequest(queued))
      return response({ generationId: 'fixture-ticket-123', apiCreditCost: 17 })
    }
    if (String(url).includes('/v1/generations/')) {
      assert.equal((await store.listImageJobs()).find(j => j.id === queued.id).providerJobId, 'fixture-ticket-123')
      assert.equal(init.headers.Authorization, 'Bearer fixture-only-key')
      return response({ generations_by_pk: { status: polls++ ? 'COMPLETE' : 'PENDING', generated_images: polls > 1 ? [{ id: 'image', url: 'https://cdn.example.org/output.png' }] : [] } })
    }
    assert.equal(init.headers?.Authorization, undefined)
    assert.equal(init.referrerPolicy, 'no-referrer')
    return new Response(png)
  }
  await runImageQueue('leonardo', { key: async () => 'fixture-only-key', generate: (job, key, signal, submitted) => generateProviderImage(job, key, signal, submitted, fetcher, async () => {}), prepare: async output => ({ ...output, width: 1, height: 1, thumbnail: png }) })
  const completed = (await store.listImageJobs()).find(j => j.id === queued.id)
  assert.equal(completed.status, 'completed')
  assert.equal((await store.getGalleryImage(completed.assetId)).cost, undefined)
  await store.decideImageJob(queued.id, true)
  assert.equal((await store.listGalleryImages()).some(i => i.id === completed.assetId), true)
  assert.throws(() => assertImageJobConnection(completed, 'different-account'), /changed/)
  assert.doesNotThrow(() => assertImageJobConnection(completed, completed.localConnectionFingerprint))
  let posts = 0
  const output = await generateProviderImage(completed, 'fixture-only-key', new AbortController().signal, async () => assert.fail('resume must not submit'), async (url, init) => {
    if (init.method === 'POST') posts++
    return String(url).includes('/v1/generations/') ? response({ generations_by_pk: { status: 'COMPLETE', generated_images: [{ id: 'image', url: 'https://cdn.example.org/output.png' }] } }) : new Response(png)
  }, async () => {})
  assert.equal(output.image.size, png.size)
  assert.equal(posts, 0)
  assert.equal(calls.filter(url => url.endsWith('/v2/generations')).length, 1)
})
test('Leonardo kept output survives portable archive round-trip with options but no account identity', async () => {
  const { encodeBookArchive, decodeBookArchive } = await import('../src/data/book-archive.ts')
  const favorite = settings.imageFavorite(settings.documentedImageModels.find(m => m.id === 'krea/krea-2'), [])
  const spec = settings.resolveImageSpec('A fox', favorite.alias, undefined, undefined, { keys: {}, favorites: [favorite], defaultAlias: favorite.alias })
  const archive = encodeBookArchive({ entities: [{ id: 'archive-book', type: 'book', title: 'Fixture', createdAt: 1, updatedAt: 1 }], snapshots: [], dependencies: [], illustrations: [], galleryImages: [{ id: 'archive-image', bookId: 'archive-book', kept: true, prompt: spec.prompt, provider: 'leonardo', model: spec.model, width: 1, height: 1, createdAt: 1, image: png, thumbnail: png }], imageJobs: [{ ...spec, id: 'archive-job', bookId: 'archive-book', status: 'completed', decision: 'kept', assetId: 'archive-image', createdAt: 1, providerJobId: 'private-ticket', localConnectionFingerprint: 'private-account' }] })
  const bytes = await archive.text()
  assert.equal(bytes.includes('private-ticket'), false)
  assert.equal(bytes.includes('private-account'), false)
  const decoded = await decodeBookArchive(archive)
  assert.equal(decoded.galleryImages[0].provider, 'leonardo')
  assert.deepEqual(decoded.imageJobs[0].leonardoOptions, spec.leonardoOptions)
  const corrupt = { ...decoded, imageJobs: [{ ...decoded.imageJobs[0], leonardoOptions: { quality: 'LOW' } }] }
  await assert.rejects(() => decodeBookArchive(encodeBookArchive(corrupt)), /quality|invalid/i)
})

test('six distinct documented Leonardo models resolve private single-output model-specific requests', async () => {
  const catalog = settings.documentedImageModels.filter(model => model.provider === 'leonardo')
  assert.deepEqual(catalog.map(model => model.id), ids)
  const { buildLeonardoRequest } = await import('../src/features/images/leonardo-contracts.ts')
  for (const model of catalog) {
    const favorite = settings.imageFavorite(model, [])
    const spec = settings.resolveImageSpec('A fox in a quiet forest', favorite.alias, undefined, undefined, { keys: {}, favorites: [favorite], defaultAlias: favorite.alias })
    assert.deepEqual(model.tasks, ['text-to-image'])
    const options = model.id.startsWith('lucid-') ? { mode: 'FAST', style_ids: ['111dc692-d470-4eec-b791-3475abac4c46'] } : model.id === 'flux-schnell' ? { style_ids: ['111dc692-d470-4eec-b791-3475abac4c46'] } : ['ideogram/p-image-ideogram', 'krea/krea-2'].includes(model.id) ? { quality: 'MEDIUM' } : {}
    assert.deepEqual(buildLeonardoRequest(spec), { model: model.id, public: false, parameters: { prompt: spec.prompt, width: 1024, height: 1024, quantity: 1, prompt_enhance: 'OFF', ...options } })
    assert.equal(spec.leonardoContractVersion, 1)
  }
})
test('Leonardo profiles retain validated model-specific options through portable sanitization and enqueue snapshot', async () => {
  const { sanitizeSettingsProfile } = await import('../src/features/settings/settings-profiles.ts')
  const { initialAiSettings } = await import('../src/shared/ai/ai-settings.ts')
  const { buildLeonardoRequest } = await import('../src/features/images/leonardo-contracts.ts')
  const maxima = [2000, 9999, 2000, 10000, 5000, 9999]
  for (const [index, id] of ids.entries()) {
    const model = settings.documentedImageModels.find(m => m.provider === 'leonardo' && m.id === id)
    const favorite = settings.imageFavorite(model, [])
    if (['lucid-origin', 'lucid-realism', 'flux-schnell', 'krea/krea-2'].includes(id)) favorite.leonardoOptions.seed = 0
    const media = { favorites: [favorite], defaultAlias: favorite.alias }
    const profile = sanitizeSettingsProfile({ id: 'test-image', name: 'Image', kind: 'image', settings: structuredClone(initialAiSettings), media })
    assert.deepEqual(profile.media.favorites[0].leonardoOptions, favorite.leonardoOptions)
    const config = { ...profile.media, keys: {} }
    const spec = settings.resolveImageSpec('x'.repeat(maxima[index]), favorite.alias, undefined, undefined, config)
    assert.equal(buildLeonardoRequest(spec).parameters.prompt.length, maxima[index])
    assert.throws(() => settings.resolveImageSpec('x'.repeat(maxima[index] + 1), favorite.alias, undefined, undefined, config), /prompt/i)
    assert.throws(() => buildLeonardoRequest({ ...spec, prompt: '  ' }), /prompt/i)
    assert.throws(() => buildLeonardoRequest({ ...spec, size: { width: 65, height: 1024, value: '65x1024' } }), /size|dimension/i)
    assert.throws(() => buildLeonardoRequest({ ...spec, leonardoOptions: { ...spec.leonardoOptions, negative_prompt: 'bad' } }), /option/i)
    assert.throws(() => buildLeonardoRequest({ ...spec, task: 'image-to-image', sources: [] }), /text-to-image/i)
    assert.throws(() => buildLeonardoRequest({ ...spec, leonardoContractVersion: 999 }), /contract/i)
    assert.throws(() => buildLeonardoRequest({ ...spec, leonardoOptions: { ...spec.leonardoOptions, seed: -1 } }), /seed/i)
    assert.throws(() => buildLeonardoRequest({ ...spec, leonardoOptions: { ...spec.leonardoOptions, seed: NaN } }), /seed/i)
    if (id === 'krea/krea-2') assert.throws(() => buildLeonardoRequest({ ...spec, leonardoOptions: { quality: 'LOW' } }), /quality/i)
    if (id === 'krea-2-turbo') for (const option of [{ mode: 'FAST' }, { quality: 'MEDIUM' }, { seed: 0 }, { style_ids: [] }, { guidances: {} }]) assert.throws(() => buildLeonardoRequest({ ...spec, leonardoOptions: option }), /option/i)
    favorite.leonardoOptions = { ...favorite.leonardoOptions, bad_imported_field: true }
    assert.throws(() => settings.validateImageSettings({ keys: {}, ...media }), /option/i)
  }
})

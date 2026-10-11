import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test from 'node:test'
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

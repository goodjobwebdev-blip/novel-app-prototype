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

import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import 'fake-indexeddb/auto'
const storage = new Map()
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) }
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const url = new URL(specifier + '.ts', context.parentURL)
    if (existsSync(fileURLToPath(url))) return nextResolve(url.href, context)
  }
  return nextResolve(specifier, context)
} })
const { assembleMediaEnhancementRequest, enhanceMediaPrompt, mediaEnhancementFingerprint, mediaEnhancementIsStale, selectedMediaPrompt } = await import('../src/media-prompt.ts')
const { saveMediaWorkspaceDraft, loadMediaWorkspaceDraft } = await import('../src/media-draft-storage.ts')
const { initialAiSettings, copyAiSettings } = await import('../src/ai-settings.ts')
const { clearFakeProviderTrace, getFakeProviderTrace } = await import('../src/fake-provider.ts')
const draft = { prompt: 'Moonlit gate', alias: 'Visual', size: '1024x1024', task: 'text-to-image', sources: [{ data: new Blob(['SOURCE-SECRET']), id: 'source' }], enhancementGuidance: 'Vintage illustration', enhancementMode: 'guided' }

test('enhancement context includes only prompt, guidance and media capabilities', () => {
  const request = JSON.stringify(assembleMediaEnhancementRequest(draft, 'Still images').providerMessages)
  assert.match(request, /Moonlit gate/)
  assert.match(request, /Vintage illustration/)
  assert.doesNotMatch(request, /SOURCE-SECRET|sources|manuscript/)
  assert.doesNotMatch(JSON.stringify(assembleMediaEnhancementRequest({ ...draft, enhancementMode: 'standard' }, '').providerMessages), /Vintage illustration/)
})

test('selected prompt is exact, original survives, and changes invalidate enhancement', () => {
  const completed = { ...draft, enhancedPrompt: '  Enhanced gate\n', enhancementFingerprint: mediaEnhancementFingerprint(draft, 'Still'), promptSelection: 'enhanced' }
  assert.equal(selectedMediaPrompt(completed), '  Enhanced gate\n')
  assert.equal(selectedMediaPrompt({ ...completed, promptSelection: 'original' }), 'Moonlit gate')
  assert.equal(mediaEnhancementIsStale(completed, 'Still'), false)
  assert.equal(mediaEnhancementIsStale({ ...completed, prompt: 'Sunlit gate' }, 'Still'), true)
  assert.equal(mediaEnhancementIsStale({ ...completed, enhancementGuidance: 'Oil paint' }, 'Still'), true)
  assert.equal(mediaEnhancementIsStale(completed, 'Video'), true)
})

test('Support model enhancement returns a draft and cancellation does not mutate it', async () => {
  clearFakeProviderTrace()
  const settings = copyAiSettings(initialAiSettings)
  settings.provider = 'fake'; settings.supportModel = 'fake/test'; settings.mainModel = 'must-not-use'; settings.supportModelContextLength = 33000
  const captured = { ...draft, enhancementTemplate: 'Return an improved prompt. [DELAY_MS:0]' }
  const before = structuredClone(captured)
  const output = await enhanceMediaPrompt(captured, 'Still', undefined, new AbortController().signal, undefined, settings)
  assert.ok(output)
  assert.deepEqual(captured, before)
  assert.equal(getFakeProviderTrace().length, 1)
  assert.equal(getFakeProviderTrace()[0].model, 'fake/test')
  const abort = new AbortController(); abort.abort()
  await assert.rejects(() => enhanceMediaPrompt(captured, 'Still', undefined, abort.signal, undefined, settings), { name: 'AbortError' })
  assert.equal(getFakeProviderTrace().length, 1)
})

test('durable workspace drafts round-trip original, enhanced, guidance, selection and source blobs', async () => {
  const state = { tab: 'generate', draft: { ...draft, enhancedPrompt: 'Enhanced gate', promptSelection: 'enhanced' }, gallery: { query: '', scope: 'all', limit: 40 } }
  await saveMediaWorkspaceDraft(state)
  const restored = await loadMediaWorkspaceDraft()
  assert.equal(restored.draft.prompt, 'Moonlit gate')
  assert.equal(restored.draft.enhancedPrompt, 'Enhanced gate')
  assert.equal(restored.draft.enhancementGuidance, 'Vintage illustration')
  assert.equal(restored.draft.promptSelection, 'enhanced')
  assert.equal(await restored.draft.sources[0].data.text(), 'SOURCE-SECRET')
})

import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
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
const { assembleMediaEnhancementRequest, enhanceMediaPrompt, mediaEnhancementFingerprint, normalizeMediaPromptDraft, selectedMediaPrompt } = await import('../src/features/images/media-prompt.ts')
const { saveMediaWorkspaceDraft, loadMediaWorkspaceDraft } = await import('../src/features/images/media-draft-storage.ts')
const { initialAiSettings, copyAiSettings } = await import('../src/shared/ai/ai-settings.ts')
const { clearFakeProviderTrace, getFakeProviderTrace } = await import('../src/shared/ai/fake-provider.ts')
const draft = { prompt: 'Moonlit gate', alias: 'Visual', size: '1024x1024', task: 'text-to-image', sources: [{ data: new Blob(['SOURCE-SECRET']), id: 'source' }], enhancementGuidance: 'Vintage illustration', enhancementMode: 'guided' }

test('enhancement context includes only prompt, guidance and media capabilities', () => {
  const request = JSON.stringify(assembleMediaEnhancementRequest(draft, 'Still images').providerMessages)
  assert.match(request, /Moonlit gate/)
  assert.match(request, /Vintage illustration/)
  assert.doesNotMatch(request, /SOURCE-SECRET|sources|manuscript/)
  assert.match(JSON.stringify(assembleMediaEnhancementRequest({ ...draft, enhancementMode: 'standard' }, '').providerMessages), /Vintage illustration/)
  const unguided = assembleMediaEnhancementRequest({ ...draft, enhancementGuidance: '' }, '')
  assert.equal(JSON.parse(unguided.providerMessages.at(-1).content).guidance, '')
})

test('legacy drafts keep their selected text and merge custom instructions into one guidance field', () => {
  const completed = { ...draft, enhancedPrompt: '  Enhanced gate\n', enhancementTemplate: 'Preserve the stone arch', promptSelection: 'enhanced' }
  const current = normalizeMediaPromptDraft(completed)
  assert.equal(current.prompt, '  Enhanced gate\n')
  assert.equal(selectedMediaPrompt(current), selectedMediaPrompt(completed))
  assert.equal(current.enhancementGuidance, 'Vintage illustration\n\nPreserve the stone arch')
  assert.equal(current.enhancedPrompt, undefined)
  assert.equal(current.enhancementTemplate, undefined)
  assert.equal(current.promptSelection, undefined)
  assert.deepEqual(normalizeMediaPromptDraft(current), current)
  assert.equal(normalizeMediaPromptDraft({ ...completed, promptSelection: 'original' }).prompt, 'Moonlit gate')
  const fingerprint = mediaEnhancementFingerprint(current, 'Still')
  assert.notEqual(mediaEnhancementFingerprint({ ...current, prompt: 'Sunlit gate' }, 'Still'), fingerprint)
  assert.notEqual(mediaEnhancementFingerprint({ ...current, enhancementGuidance: 'Oil paint' }, 'Still'), fingerprint)
  assert.notEqual(mediaEnhancementFingerprint(current, 'Video'), fingerprint)
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

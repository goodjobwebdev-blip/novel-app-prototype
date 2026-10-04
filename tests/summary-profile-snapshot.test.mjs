import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import 'fake-indexeddb/auto'
import { transpileSourceTree } from './transpile-source-tree.mjs'
import { assignBookTestProfiles } from './settings-profile-fixture.mjs'

const dom = new JSDOM('', { url: 'https://arc.test/' })
after(() => dom.window.close())
for (const key of ['window', 'document', 'localStorage', 'sessionStorage', 'CustomEvent']) globalThis[key] = dom.window[key]
const directory = mkdtempSync(new URL('../node_modules/.summary-profile-snapshot-test-', import.meta.url))
after(() => rmSync(directory, { recursive: true, force: true }))
transpileSourceTree(directory)
const moduleAt = name => import(pathToFileURL(`${directory}/${name}.mjs`))
const p = await moduleAt('data/persistence')
after(async () => (await p.database()).close())
const ai = await moduleAt('shared/ai/ai-settings')
const profiles = await moduleAt('features/settings/settings-profiles')
const { prepareSummaryGeneration } = await moduleAt('features/writing/summary-generation')

async function settle(predicate) {
  for (let i = 0; i < 200 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.ok(predicate(), 'The delayed summary model catalog request started')
}

test('Summary preparation retains its snapshot when profiles and the global connection change during catalog lookup', async t => {
  const original = ai.withPromptSystemPrompt({
    ...ai.initialAiSettings,
    provider: 'nanogpt', baseUrl: 'https://original-summary-provider.invalid/v1', apiKey: 'original-summary-key',
    supportModel: 'original-summary-model', supportModelContextLength: undefined, supportThinkingEffort: 'high',
    responseLengths: { ...ai.initialAiSettings.responseLengths, summary: 'Original summary response length.' },
  }, 'summarize', 'Original Summary snapshot prompt.')
  const { book, scene } = await p.createBook(original, 'Summary profile snapshot')
  const selections = await assignBookTestProfiles({ persistence: p, ai, profiles }, book.id, original, ['text', 'summary'])
  await p.saveDocumentContent(scene.id, 'Authoritative original scene source.')
  const summary = await p.getOrCreateSummary(await p.getEntity(scene.id))
  const controller = new AbortController()
  let resolveCatalog, preparation, catalogRequest, catalogCalls = 0, catalogReleased = false
  const catalog = new Promise(resolve => { resolveCatalog = resolve })
  function releaseCatalog() {
    if (catalogReleased) return
    catalogReleased = true
    // NanoGPT's documented detailed catalog is keyed by data[].id/context_length.
    resolveCatalog(Response.json({ data: [
      { id: 'unrelated-model', context_length: 777000 },
      { id: original.supportModel, context_length: 96000 },
      { id: 'edited-summary-model', context_length: 120000 },
    ] }))
  }
  t.after(async () => {
    controller.abort()
    releaseCatalog()
    await preparation?.catch(() => undefined)
  })
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    catalogCalls++
    catalogRequest = { url: String(url), authorization: new Headers(init.headers).get('Authorization') }
    return catalog
  })
  preparation = prepareSummaryGeneration(book, summary, controller.signal)
  // Observe rejection immediately even if setup/assertions fail before awaiting preparation.
  preparation.catch(() => undefined)
  await settle(() => catalogCalls === 1)
  assert.equal(catalogRequest.url, `${original.baseUrl}/models?detailed=true&sort=favorites`)
  assert.equal(catalogRequest.authorization, `Bearer ${original.apiKey}`)
  const byId = id => profiles.loadSettingsProfiles().profiles.find(profile => profile.id === id)
  const text = byId(selections.text), prompt = byId(selections.summary)
  profiles.saveSettingsProfile({ ...text, settings: {
    ...text.settings, supportModel: 'edited-summary-model', supportModelContextLength: 120000, supportThinkingEffort: 'low',
  } })
  profiles.saveSettingsProfile({ ...prompt, settings: {
    ...ai.withPromptSystemPrompt(prompt.settings, 'summarize', 'Edited Summary snapshot prompt.'),
    responseLengths: { ...prompt.settings.responseLengths, summary: 'Edited summary response length.' },
  } })
  ai.saveAiSettings({ ...ai.loadAiSettings(), provider: 'litellm', baseUrl: 'https://edited-summary-provider.invalid/v1', apiKey: 'edited-summary-key' })
  const beforeRelease = await p.getBookAiSettings(book.id, [])
  assert.equal(beforeRelease.supportModel, 'edited-summary-model', 'The Text profile was edited while the catalog response was still pending')
  assert.equal(beforeRelease.provider, 'litellm')
  releaseCatalog()
  const prepared = await preparation
  assert.equal(prepared.settings.supportModel, original.supportModel)
  assert.equal(prepared.settings.supportThinkingEffort, 'high')
  assert.equal(prepared.settings.provider, 'nanogpt')
  assert.equal(prepared.settings.baseUrl, original.baseUrl)
  assert.equal(prepared.settings.apiKey, original.apiKey)
  assert.equal(prepared.settings.promptCompositions.summarize.systemPrompt, 'Original Summary snapshot prompt.')
  assert.equal(prepared.settings.responseLengths.summary, 'Original summary response length.')
  assert.equal(prepared.settings.supportModelContextLength, undefined, 'The captured settings are not replaced by metadata persistence')
  assert.equal(prepared.diagnostics.modelId, original.supportModel)
  assert.equal(prepared.diagnostics.modelContextKnown, true)
  assert.equal(prepared.diagnostics.modelContextTokens, 96000)
  assert.equal(prepared.diagnostics.effectiveContextTokens, 96000)
  assert.equal(prepared.diagnostics.fits, true)
  assert.equal(prepared.action, 'summarize')
  assert.equal(prepared.source.source.id, scene.id)
  assert.equal(prepared.messages[0].content, 'Original Summary snapshot prompt.')
  const requestText = prepared.messages.map(message => message.content).join('\n')
  assert.match(requestText, /Authoritative original scene source\./)
  assert.match(requestText, /Original summary response length\./)
  assert.doesNotMatch(requestText, /Edited Summary snapshot prompt|Edited summary response length/)
  const live = await p.getBookAiSettings(book.id, [])
  assert.equal(live.supportModel, 'edited-summary-model')
  assert.equal(live.supportModelContextLength, 120000)
  assert.equal(live.supportThinkingEffort, 'low')
  assert.equal(live.provider, 'litellm')
  assert.equal(live.baseUrl, 'https://edited-summary-provider.invalid/v1')
  assert.equal(live.apiKey, 'edited-summary-key')
  assert.equal(live.promptCompositions.summarize.systemPrompt, 'Edited Summary snapshot prompt.')
  assert.equal(live.responseLengths.summary, 'Edited summary response length.')
  const metadata = (await (await p.database()).table('entities').get(`settings-profiles-book-${book.id}`)).modelMetadata
  assert.equal(Object.keys(metadata ?? {}).length, 0, 'Late metadata for the original provider/model is not cached against the edited profile')
  assert.equal(catalogCalls, 1)
})

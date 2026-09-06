import { readFileSync, writeFileSync, rmSync } from 'node:fs'

function read(path) { return readFileSync(path, 'utf8') }
function write(path, value) { writeFileSync(path, value) }

function replaceExact(path, before, after, expected = 1) {
  const source = read(path)
  let count = 0
  let cursor = 0
  while ((cursor = source.indexOf(before, cursor)) >= 0) {
    count += 1
    cursor += before.length
  }
  if (count !== expected) throw new Error(`${path}: expected ${expected} matches, found ${count} for ${JSON.stringify(before.slice(0, 90))}`)
  write(path, source.split(before).join(after))
}

function replaceRegex(path, pattern, replacement, expected = 1) {
  const source = read(path)
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  const matches = [...source.matchAll(new RegExp(pattern.source, flags))]
  if (matches.length !== expected) throw new Error(`${path}: expected ${expected} regex matches, found ${matches.length} for ${pattern}`)
  write(path, source.replace(new RegExp(pattern.source, flags), replacement))
}

// Provider settings and persistence.
replaceExact(
  'src/ai-settings.ts',
  "export type AiProvider = 'openrouter' | 'nanogpt' | 'openai' | 'compatible'",
  "export type AiProvider = 'openrouter' | 'nanogpt' | 'openai' | 'compatible' | 'fake'",
)
replaceExact(
  'src/ai-settings.ts',
  "export function generationWordDelayMs(settings: Pick<AiSettings, 'generationWordDelayMs'>) {\n  return Number(normalizeGenerationWordDelay(settings.generationWordDelayMs))\n}\n",
  "export function generationWordDelayMs(settings: Pick<AiSettings, 'generationWordDelayMs'>) {\n  return Number(normalizeGenerationWordDelay(settings.generationWordDelayMs))\n}\n\nexport function textAiIsConfigured(settings: Pick<AiSettings, 'provider' | 'apiKey' | 'mainModel'>) {\n  if (settings.provider === 'fake') return settings.mainModel.trim() === 'fake/test'\n  return settings.provider === 'nanogpt' && Boolean(settings.apiKey.trim() && settings.mainModel.trim())\n}\n",
)
replaceExact(
  'src/ai-settings.ts',
  "    ...initialAiSettings,\n    ...value,\n    responseLength: typeof value?.responseLength === 'string' ? value.responseLength : '',",
  "    ...initialAiSettings,\n    ...value,\n    apiKey: value?.provider === 'fake' ? '' : typeof value?.apiKey === 'string' ? value.apiKey : initialAiSettings.apiKey,\n    baseUrl: value?.provider === 'fake' ? '' : typeof value?.baseUrl === 'string' ? value.baseUrl : initialAiSettings.baseUrl,\n    responseLength: typeof value?.responseLength === 'string' ? value.responseLength : '',",
)

// Settings UI: provider selection, local model catalog, persistent warning, and trace.
replaceExact(
  'src/App.tsx',
  "import { clearModelCatalog, getCachedModelCatalog, providerModelEndpoint, saveModelCatalog, type ProviderModel } from './model-catalog'",
  "import { clearModelCatalog, getCachedModelCatalog, providerModelEndpoint, saveModelCatalog, type ProviderModel } from './model-catalog'\nimport { FAKE_PROVIDER_MODEL, clearFakeProviderTrace, getFakeProviderTrace, subscribeFakeProviderTrace } from './fake-provider'",
)
replaceExact(
  'src/App.tsx',
  "const providerLabels: Record<AiProvider, string> = { openrouter: 'OpenRouter', nanogpt: 'nano-gpt.com', openai: 'OpenAI', compatible: 'OpenAI-compatible' }",
  "const providerLabels: Record<AiProvider, string> = { openrouter: 'OpenRouter', nanogpt: 'nano-gpt.com', openai: 'OpenAI', compatible: 'OpenAI-compatible', fake: 'Fake (testing)' }",
)
replaceExact(
  'src/App.tsx',
  "function textModelConnectionKey(settings: Pick<AiSettings, 'provider' | 'baseUrl' | 'apiKey'>) {\n  return `${settings.provider}\\n${providerModelEndpoint(settings)}\\n${settings.apiKey.trim()}`\n}\n",
  "function textModelConnectionKey(settings: Pick<AiSettings, 'provider' | 'baseUrl' | 'apiKey'>) {\n  return `${settings.provider}\\n${providerModelEndpoint(settings)}\\n${settings.apiKey.trim()}`\n}\n\nfunction cachedTextModelCatalog(settings: Pick<AiSettings, 'provider' | 'baseUrl' | 'apiKey'>) {\n  return settings.provider === 'fake' ? { models: [FAKE_PROVIDER_MODEL] } : getCachedModelCatalog(settings)\n}\n",
)
replaceExact('src/App.tsx', 'getCachedModelCatalog(defaults)', 'cachedTextModelCatalog(defaults)', 3)
replaceExact('src/App.tsx', 'getCachedModelCatalog(bookSettings)', 'cachedTextModelCatalog(bookSettings)')
replaceExact('src/App.tsx', 'getCachedModelCatalog(copied)', 'cachedTextModelCatalog(copied)', 2)
replaceExact(
  'src/App.tsx',
  "  const [settings, setSettings] = useState<AiSettings>(initialAiSettings)\n",
  "  const [settings, setSettings] = useState<AiSettings>(initialAiSettings)\n  const [fakeTrace, setFakeTrace] = useState(() => getFakeProviderTrace())\n",
)
replaceExact(
  'src/App.tsx',
  "  onSavedRef.current = onSaved\n\n  useEffect(() => () => {",
  "  onSavedRef.current = onSaved\n\n  useEffect(() => subscribeFakeProviderTrace(() => setFakeTrace(getFakeProviderTrace())), [])\n\n  useEffect(() => () => {",
)
replaceExact(
  'src/App.tsx',
  "    const baseUrl = provider === 'nanogpt' ? 'https://nano-gpt.com/api/v1' : provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : provider === 'openai' ? 'https://api.openai.com/v1' : current.baseUrl\n    const next = { ...current, provider, baseUrl, mainModel: '', mainModelContextLength: undefined, supportModel: '', supportModelContextLength: undefined, codexModel: '', codexModelContextLength: undefined }\n    clearModelCatalog(current)\n    clearModelCatalog(next)\n    changeAiSettings(() => next)\n    setModels([]); setStatus('Provider changed. Reload its model list when ready.'); setStatusKind('quiet')",
  "    const baseUrl = provider === 'nanogpt' ? 'https://nano-gpt.com/api/v1' : provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : provider === 'openai' ? 'https://api.openai.com/v1' : provider === 'fake' ? '' : current.baseUrl\n    const next = { ...current, provider, apiKey: provider === 'fake' ? '' : current.apiKey, baseUrl, mainModel: '', mainModelContextLength: undefined, supportModel: '', supportModelContextLength: undefined, codexModel: '', codexModelContextLength: undefined }\n    clearModelCatalog(current)\n    clearModelCatalog(next)\n    changeAiSettings(() => next)\n    setModels(provider === 'fake' ? [FAKE_PROVIDER_MODEL] : []); setStatus(provider === 'fake' ? 'Fake Test Model is available locally. Reload never contacts a network.' : 'Provider changed. Reload its model list when ready.'); setStatusKind(provider === 'fake' ? 'success' : 'quiet')",
)
replaceExact(
  'src/App.tsx',
  "  async function refreshModels() {\n    const requestSettings = latestAiSettingsRef.current\n    if (!requestSettings.apiKey.trim()) { setStatus('Enter an API key before loading models.'); setStatusKind('error'); return }",
  "  async function refreshModels() {\n    const requestSettings = latestAiSettingsRef.current\n    if (requestSettings.provider === 'fake') {\n      invalidateModelRefresh()\n      setModels([FAKE_PROVIDER_MODEL])\n      changeAiSettings((current) => ({\n        ...current,\n        mainModelContextLength: current.mainModel === FAKE_PROVIDER_MODEL.id ? FAKE_PROVIDER_MODEL.context_length : undefined,\n        supportModelContextLength: current.supportModel === FAKE_PROVIDER_MODEL.id ? FAKE_PROVIDER_MODEL.context_length : undefined,\n        codexModelContextLength: current.codexModel === FAKE_PROVIDER_MODEL.id ? FAKE_PROVIDER_MODEL.context_length : undefined,\n      }))\n      setStatus('1 local testing model available. No network request was made.')\n      setStatusKind('success')\n      return\n    }\n    if (!requestSettings.apiKey.trim()) { setStatus('Enter an API key before loading models.'); setStatusKind('error'); return }",
)
replaceExact(
  'src/App.tsx',
  "<i>{provider === 'nanogpt' ? 'N' : provider === 'openrouter' ? 'O' : provider === 'openai' ? 'AI' : '{ }'}</i>",
  "<i>{provider === 'fake' ? 'T' : provider === 'nanogpt' ? 'N' : provider === 'openrouter' ? 'O' : provider === 'openai' ? 'AI' : '{ }'}</i>",
)
replaceRegex(
  'src/App.tsx',
  /(            )(<label><span>API key<\/span><div className="input-action"><input[\s\S]*?<\/div><\/label>)/,
  (_match, indent, label) => `${indent}{settings.provider !== 'fake' && ${label}}`,
)
replaceExact(
  'src/App.tsx',
  "            <button className=\"reload-button\" type=\"button\" onClick={refreshModels} disabled={loading}><RefreshCw className={loading ? 'spinning' : ''} aria-hidden=\"true\" />{loading ? 'Loading models…' : 'Reload model list'}</button>",
  "            {settings.provider === 'fake' && <div className=\"status success\" role=\"note\"><i />Testing provider — responses, errors, reasoning, and tool calls are generated locally and deterministically. No text-AI network request is sent.</div>}\n            <button className=\"reload-button\" type=\"button\" onClick={refreshModels} disabled={loading}><RefreshCw className={loading ? 'spinning' : ''} aria-hidden=\"true\" />{loading ? 'Loading models…' : 'Reload model list'}</button>",
)
replaceExact(
  'src/App.tsx',
  "        </section>\n\n        <section className=\"settings-card models-card\">",
  "        </section>\n\n        {settings.provider === 'fake' && <section className=\"settings-card provider-card\" aria-label=\"Fake provider request trace\">\n          <div className=\"card-heading\"><div><span>T</span><h2>Request trace</h2></div><p>Session only · last 20 Fake requests</p></div>\n          <div className=\"connection-fields\"><button className=\"reload-button\" type=\"button\" onClick={clearFakeProviderTrace} disabled={!fakeTrace.length}>Clear trace</button></div>\n          <details><summary>{fakeTrace.length ? `${fakeTrace.length} request${fakeTrace.length === 1 ? '' : 's'}` : 'No Fake requests yet'}</summary><pre>{fakeTrace.length ? JSON.stringify(fakeTrace, null, 2) : 'Generate, summarize, autotitle, or chat with Fake (testing) to inspect the exact provider-boundary request.'}</pre></details>\n        </section>}\n\n        <section className=\"settings-card models-card\">",
)

// Shared Story/Codex/Summary dispatch. Keep request assembly untouched so #119 can replace it independently.
replaceExact(
  'src/Workspace.tsx',
  "import { generationWordDelayMs, loadAiSettings, type AiSettings } from './ai-settings'",
  "import { generationWordDelayMs, loadAiSettings, textAiIsConfigured, type AiSettings } from './ai-settings'",
)
replaceExact(
  'src/Workspace.tsx',
  "import { fetchNanoGPTModelContextLength, nanoGPTRequestText, renderLorePrompt, renderStoryPrompt, streamNanoGPTCompletion, type NanoGPTStreamMetadata } from './nanogpt'",
  "import { renderLorePrompt, renderStoryPrompt, type NanoGPTStreamMetadata } from './nanogpt'\nimport { fetchTextProviderModelContextLength, streamTextProviderCompletion, textProviderRequestText } from './text-provider'",
)
replaceExact(
  'src/Workspace.tsx',
  "type GenerationRequestSnapshot = {\n  baseUrl: string",
  "type GenerationRequestSnapshot = {\n  provider: AiSettings['provider']\n  baseUrl: string",
)
replaceExact(
  'src/Workspace.tsx',
  "  provider: 'NanoGPT'\n",
  "  provider: 'NanoGPT' | 'Fake (testing)'\n",
)
replaceExact(
  'src/Workspace.tsx',
  "    setAiReady(settings.provider === 'nanogpt' && Boolean(settings.apiKey.trim() && settings.mainModel.trim()))",
  "    setAiReady(textAiIsConfigured(settings))",
)
replaceExact(
  'src/Workspace.tsx',
  "      if (returnScreen === 'home') setAiReady(settings.provider === 'nanogpt' && Boolean(settings.apiKey.trim() && settings.mainModel.trim()))",
  "      if (returnScreen === 'home') setAiReady(textAiIsConfigured(settings))",
)
replaceExact(
  'src/Workspace.tsx',
  "    if (settings.provider !== 'nanogpt') {\n      showToast('Text generation currently supports NanoGPT only. Choose it in Book settings.')\n      return\n    }\n    if (!settings.apiKey.trim()) {\n      showToast('Add your NanoGPT API key in Book settings before generating.')\n      return\n    }",
  "    if (settings.provider !== 'nanogpt' && settings.provider !== 'fake') {\n      showToast('Text generation currently supports NanoGPT or Fake (testing) only. Choose one in Book settings.')\n      return\n    }\n    if (settings.provider === 'nanogpt' && !settings.apiKey.trim()) {\n      showToast('Add your NanoGPT API key in Book settings before generating.')\n      return\n    }",
)
replaceExact(
  'src/Workspace.tsx',
  "          ?? await fetchNanoGPTModelContextLength(settings.apiKey.trim(), settings.baseUrl, selectedModel).catch(() => undefined)",
  "          ?? await fetchTextProviderModelContextLength({ provider: settings.provider, apiKey: settings.apiKey.trim(), baseUrl: settings.baseUrl, model: selectedModel }).catch(() => undefined)",
)
replaceExact(
  'src/Workspace.tsx',
  "        const requestText = nanoGPTRequestText({ systemPrompt, contextMessage, userMessage })",
  "        const requestText = textProviderRequestText({ systemPrompt, contextMessage, userMessage })",
)
replaceExact(
  'src/Workspace.tsx',
  "        requestSnapshot = {\n          baseUrl: settings.baseUrl,",
  "        requestSnapshot = {\n          provider: settings.provider,\n          baseUrl: settings.baseUrl,",
)
replaceExact(
  'src/Workspace.tsx',
  "      provider: 'NanoGPT',\n      estimatedRequestTokens: requestSnapshot.estimatedRequestTokens,",
  "      provider: requestSnapshot.provider === 'fake' ? 'Fake (testing)' : 'NanoGPT',\n      estimatedRequestTokens: requestSnapshot.estimatedRequestTokens,",
)
replaceExact(
  'src/Workspace.tsx',
  "      await streamNanoGPTCompletion({\n        apiKey: settings.apiKey.trim(),\n        baseUrl: requestSnapshot.baseUrl,\n        model: requestSnapshot.model,",
  "      await streamTextProviderCompletion({\n        provider: requestSnapshot.provider,\n        task: isCodex ? 'codex' : 'story',\n        apiKey: settings.apiKey.trim(),\n        baseUrl: requestSnapshot.baseUrl,\n        model: requestSnapshot.model,",
)
replaceExact(
  'src/Workspace.tsx',
  "      if (settings.provider !== 'nanogpt' || !settings.apiKey.trim() || !settings.supportModel.trim()) {\n        status = 'error'\n        showToast('Choose NanoGPT and a Support model in Book settings before summarizing.')\n        return\n      }",
  "      if ((settings.provider !== 'nanogpt' && settings.provider !== 'fake') || (settings.provider === 'nanogpt' && !settings.apiKey.trim()) || !settings.supportModel.trim()) {\n        status = 'error'\n        showToast('Choose NanoGPT or Fake (testing) and a Support model in Book settings before summarizing.')\n        return\n      }",
)
replaceExact(
  'src/Workspace.tsx',
  "        provider: 'NanoGPT',\n        startedAt: generationStartedAtRef.current,",
  "        provider: settings.provider === 'fake' ? 'Fake (testing)' : 'NanoGPT',\n        startedAt: generationStartedAtRef.current,",
)
replaceExact(
  'src/Workspace.tsx',
  "      await streamNanoGPTCompletion({\n        apiKey: settings.apiKey.trim(),\n        baseUrl: settings.baseUrl,\n        model: settings.supportModel,",
  "      await streamTextProviderCompletion({\n        provider: settings.provider,\n        task: 'summary',\n        apiKey: settings.apiKey.trim(),\n        baseUrl: settings.baseUrl,\n        model: settings.supportModel,",
)

// Autotitle dispatch.
replaceExact(
  'src/autotitle-service.ts',
  "import { fetchNanoGPTModelContextLength, streamNanoGPTCompletion } from './nanogpt'",
  "import { fetchTextProviderModelContextLength, streamTextProviderCompletion } from './text-provider'",
)
replaceExact(
  'src/autotitle-service.ts',
  "  if (settings.provider !== 'nanogpt') throw new Error('Dedicated autotitle currently supports NanoGPT only. Choose NanoGPT in Book AI settings.')\n  if (!settings.apiKey.trim()) throw new Error('Add your NanoGPT API key in Book AI settings before generating a title.')",
  "  if (settings.provider !== 'nanogpt' && settings.provider !== 'fake') throw new Error('Dedicated autotitle supports NanoGPT or Fake (testing). Choose one in Book AI settings.')\n  if (settings.provider === 'nanogpt' && !settings.apiKey.trim()) throw new Error('Add your NanoGPT API key in Book AI settings before generating a title.')",
)
replaceExact(
  'src/autotitle-service.ts',
  "    modelContextLength = await fetchNanoGPTModelContextLength(settings.apiKey.trim(), settings.baseUrl, model).catch(() => undefined)",
  "    modelContextLength = await fetchTextProviderModelContextLength({ provider: settings.provider, apiKey: settings.apiKey.trim(), baseUrl: settings.baseUrl, model }).catch(() => undefined)",
)
replaceExact(
  'src/autotitle-service.ts',
  "  await streamNanoGPTCompletion({\n    apiKey: settings.apiKey.trim(),",
  "  await streamTextProviderCompletion({\n    provider: settings.provider,\n    task: 'autotitle',\n    apiKey: settings.apiKey.trim(),",
)

// Chat model loading and request dispatch.
replaceExact(
  'src/chat-service.ts',
  "import { getCachedModelCatalog } from './model-catalog'",
  "import { getCachedModelCatalog } from './model-catalog'\nimport { FAKE_PROVIDER_MODEL } from './fake-provider'",
)
replaceExact(
  'src/chat-service.ts',
  "export async function fetchAvailableChatModels(settings: AiSettings): Promise<ChatModel[]> {\n  if (!settings.apiKey.trim()) throw new Error('Add an API key in Book AI settings before loading chat models.')",
  "export async function fetchAvailableChatModels(settings: AiSettings): Promise<ChatModel[]> {\n  if (settings.provider === 'fake') return [{ ...FAKE_PROVIDER_MODEL }]\n  if (!settings.apiKey.trim()) throw new Error('Add an API key in Book AI settings before loading chat models.')",
)
replaceExact(
  'src/ChatFeature.tsx',
  "    if (!settings.apiKey.trim()) throw new Error('Add an API key in Book AI settings before chatting.')",
  "    if (settings.provider !== 'fake' && !settings.apiKey.trim()) throw new Error('Add an API key in Book AI settings before chatting.')",
)
replaceExact(
  'src/chat-api.ts',
  "import type { AiProvider } from './ai-settings'",
  "import type { AiProvider } from './ai-settings'\nimport { streamFakeProvider } from './fake-provider'",
)
replaceExact(
  'src/chat-api.ts',
  "export async function streamChatCompletion(\n  request: ChatCompletionRequest,\n  onChunk: (chunk: ChatCompletionChunk) => void,\n  signal: AbortSignal,\n  onResponse?: () => void,\n): Promise<ChatCompletionResult> {\n  const body: Record<string, unknown> = {",
  "export async function streamChatCompletion(\n  request: ChatCompletionRequest,\n  onChunk: (chunk: ChatCompletionChunk) => void,\n  signal: AbortSignal,\n  onResponse?: () => void,\n): Promise<ChatCompletionResult> {\n  if (request.provider === 'fake') {\n    const result = await streamFakeProvider({\n      task: 'chat',\n      model: request.model,\n      messages: request.messages,\n      tools: request.tools,\n      thinking: request.thinking,\n    }, {\n      onResponse,\n      onContent: (content) => onChunk({ content }),\n      onThoughts: (thoughts) => onChunk({ thoughts }),\n    }, signal)\n    return { toolCalls: result.toolCalls, finishReason: result.finishReason }\n  }\n\n  const body: Record<string, unknown> = {",
)

// The temporary helper/workflow should never land on main.
rmSync('.github/workflows/issue-109-patch.yml', { force: true })
rmSync('scripts/apply-issue-109.mjs', { force: true })

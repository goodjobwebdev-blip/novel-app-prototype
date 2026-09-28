import { THINKING_EFFORT_OPTIONS, normalizeThinkingEffort } from '../shared/ai/thinking-effort'
import TtsCacheSettings from '../features/speech/TtsCacheSettings'
import { captureCharacterFrame, type CharacterFrame } from '../features/chat/character-chat'
import { availableChatTools } from '../features/chat/chat-tool-availability'
import { sceneWritingValues, resolveSceneWriting } from '../features/writing/scene-writing'
import ImageSettingsPanel, { type ImageSettingsPanelRef } from '../features/images/ImageSettingsPanel'
import SettingsSectionTabs from '../features/settings/SettingsSectionTabs'
import { ContextSourcePicker, ContextSourceInventory, ContextBudget } from '../shared/context/ContextControls'
import '../shared/context/context-settings-ux.css'
import { switchProviderProfile } from '../features/settings/provider-profiles'
import { TextRevealPreview } from '../shared/ui/TextRevealPreview'
import Input from '../shared/ui/Input'
import Select from '../shared/ui/Select'
import Checkbox from '../shared/ui/Checkbox'
import Button from '../shared/ui/Button'
import Disclosure from '../shared/ui/Disclosure'
import SearchableSelect from '../shared/ui/SearchableSelect'
import SegmentedControl from '../shared/ui/SegmentedControl'
import RadioGroup from '../shared/ui/RadioGroup'
import Tabs from '../shared/ui/Tabs'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  Check,
  CircleHelp,
  Cloud,
  Home,
  Image as ImageIcon,
  MessageCircle,
  Mic,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  Type,
  Volume2,
  X,
} from 'lucide-react'
import {
  initialAiSettings,
  defaultPromptCompositions,
  loadAiSettings,
  CODEX_RESPONSE_LENGTH_PRESETS,
  STORY_RESPONSE_LENGTH_PRESETS,
  SUMMARY_RESPONSE_LENGTH_PRESETS,
  saveAiSettings,
  saveGlobalFavorites,
  resetPromptComposition,
  withPromptComposition,
  withPromptSystemPrompt,
  type AiPrompts,
  type AiProvider,
  type AiSettings,
} from '../shared/ai/ai-settings'
import {
  copyDefaultAiSettingsToBook,
  ensureBookAiSettings,
  getBookContextSettings,
  getBookAiSettings,
  loadDefaultBookContextSettings,
  isCodexEntryArchived,
  listEntitiesByBook,
  saveBookContextSettings,
  saveDefaultBookContextSettings,
  saveBookAiSettings,
  defaultBookContextSettings,
  type ArcEntity,
  type BookContextSettings,
  type GenerationContextProfile,
  type GenerationContextType,
  type SummarySourceType,
} from '../data/persistence'
import { bookTemplateValues, promptTemplateDiagnostics, promptVariables, renderPromptTemplate, type BookPromptValues } from '../shared/ai/prompt-template'
import PromptTemplateEditor, { type PromptTemplateEditorHandle } from '../features/settings/PromptTemplateEditor'
import PromptPresetControls from '../features/settings/PromptPresetControls'
import { makePredefinedMessage, likelyReusablePrefix, normalizedRequestDiagnosticText, type NormalizedAssembledRequest, type PredefinedMessage, type PromptCompositionScope } from '../shared/ai/prompt-composition'
import { assembleStoryGenerationRequest, STORY_CONTINUE_FALLBACK } from '../features/writing/story-request'
import { assembleCodexGenerationRequest, CODEX_CONTINUE_FALLBACK } from '../features/codex/codex-request'
import { assembleSummaryGenerationRequest } from '../features/writing/summary-request'
import { buildSummarySource, type SummarySource } from '../features/writing/summary-service'
import { buildContextValues, contextLimitInputError, generationContextDiagnostics, type PreparedContextValues } from '../shared/context/context-service'
import { getChat, listChatMessages, saveChatContextProfile, type ChatEntity, type ChatMessageEntity } from '../features/chat/chat-service'
import { assembleChatGenerationRequest, finalizeChatProviderRequest } from '../features/chat/chat-request'
import { clearModelCatalog, getCachedModelCatalog, providerModelEndpoint, saveModelCatalog, type ProviderModel } from '../shared/ai/model-catalog'
import { FAKE_PROVIDER_MODEL, clearFakeProviderTrace, getFakeProviderTrace, subscribeFakeProviderTrace } from '../shared/ai/fake-provider'
import { KeyedAsyncQueue } from '../shared/utils/keyed-async-queue'
import { saveRequiredSettingsForLeave } from '../features/settings/settings-leave-policy'
import { fetchSpeechModels, type SpeechModel } from '../features/speech/tts-service'
import { fetchTranscriptionModels, type SttModel } from '../features/speech/stt-service'
import SyncSettingsPanel from '../features/sync/SyncSettingsPanel'
import '../features/settings/response-length-settings.css'
import '../shared/context/context-limit-settings.css'
import '../features/codex/codex-archive.css'
import '../features/codex/codex-summary.css'
import '../features/speech/tts.css'
import '../features/codex/codex-triggers.css'
import '../features/settings/settings-save-recovery.css'
import type { PromptPresetScope } from '../features/settings/prompt-presets'
type SettingsTab = 'ai' | 'context' | 'appearance' | 'speech' | 'images' | 'sync'
type ContextSection = GenerationContextType | 'summary'
type SaveState = 'loading' | 'saved' | 'saving' | 'error'
type ModelRole = 'main' | 'support' | 'codex' | 'chat'
type RequestPreviewMessage = {
  key: string
  role: 'system' | 'user' | 'assistant' | 'tool'
  title: string
  detail: string
  content: string
  reasoning?: string
  omitted?: boolean
  references?: string[]
  diagnostics?: string[]
}

const providerLabels: Record<AiProvider, string> = { openrouter: 'OpenRouter', nanogpt: 'nano-gpt.com', openai: 'OpenAI', litellm: 'LiteLLM', compatible: 'OpenAI-compatible', fake: 'Fake (testing)' }
const modelRoles: ReadonlyArray<{ key: ModelRole; label: string; description: string }> = [
  { key: 'main', label: 'Main · Story writing', description: 'Writes story prose.' },
  { key: 'support', label: 'Support · Summaries & titles', description: 'Creates summaries and titles.' },
  { key: 'codex', label: 'Codex · Worldbuilding', description: 'Builds world and lore entries.' },
  { key: 'chat', label: 'Chat · Assistant', description: 'Sets the default for new chats.' },
]
const promptPresetScope: Record<keyof AiPrompts, PromptPresetScope> = { story: 'story', assistant: 'chat', lore: 'codex', summarize: 'summary' }
function formatContext(value?: number) {
  if (!value) return 'Context unknown'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 ? 1 : 0)}m context`
  return `${Math.round(value / 1000)}k context`
}

function textModelConnectionKey(settings: Pick<AiSettings, 'provider' | 'baseUrl' | 'apiKey'>) {
  return `${settings.provider}\n${providerModelEndpoint(settings)}\n${settings.apiKey.trim()}`
}

function cachedTextModelCatalog(settings: Pick<AiSettings, 'provider' | 'baseUrl' | 'apiKey'>) {
  return settings.provider === 'fake' ? { models: [FAKE_PROVIDER_MODEL] } : getCachedModelCatalog(settings)
}

function ttsCatalogConnectionKey(settings: AiSettings['speech']) {
  return settings.apiKey.trim()
}

function sttCatalogConnectionKey(settings: AiSettings['speech']) {
  return `${settings.apiKey.trim()}\n${settings.openaiApiKey.trim()}`
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

type AiSettingsProps = {
  initialTab?: SettingsTab
  onHome?: () => void
  onBack?: () => void
  onSaved?: (settings: AiSettings) => void
  book?: { id: string; title: string; contextType?: GenerationContextType; currentDocumentId?: string; currentDocumentText?: string; insertionPosition?: number; promptValues?: BookPromptValues; chatId?: string; currentSummary?: { id: string; sourceEntityId: string; sourceType: SummarySourceType; content: string } }
}

export default function App({ onHome, onBack, onSaved, book, initialTab = 'ai' }: AiSettingsProps) {
  const [settings, setSettings] = useState<AiSettings>(initialAiSettings)
  const [fakeTrace, setFakeTrace] = useState(() => getFakeProviderTrace())
  const [models, setModels] = useState<ProviderModel[]>([])
  const [promptTab, setPromptTab] = useState<keyof AiPrompts>('story')
  const [promptVariableQuery, setPromptVariableQuery] = useState('')
  const [aiSection, setAiSection] = useState<'connection' | 'models' | 'prompts'>('models')
  const [connectionExpanded, setConnectionExpanded] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('Add an API key, then reload the model list.')
  const [statusKind, setStatusKind] = useState<'quiet' | 'success' | 'error'>('quiet')
  const [saveState, setSaveState] = useState<SaveState>(book ? 'loading' : 'saved')
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(initialTab)
  const [settingsLoading, setSettingsLoading] = useState(Boolean(book))
  const [contextSection, setContextSection] = useState<ContextSection>(() => book?.currentSummary ? 'summary' : book?.contextType ?? 'scene')
  const [contextSettings, setContextSettings] = useState<BookContextSettings>(defaultBookContextSettings)
  const [chatContextProfile, setChatContextProfile] = useState<GenerationContextProfile | null>(null)
  const [contextSources, setContextSources] = useState<ArcEntity[]>([])
  const [contextSaved, setContextSaved] = useState(true)
  const [contextSaveError, setContextSaveError] = useState('')
  const [contextReady, setContextReady] = useState(!book)
  const [contextLoadVersion, setContextLoadVersion] = useState(0)
  const [leaveRecoveryOpen, setLeaveRecoveryOpen] = useState(false)
  const [leaveSaving, setLeaveSaving] = useState(false)
  const [imageSettingsDirty, setImageSettingsDirty] = useState(false)
  const [summaryPreviewSource, setSummaryPreviewSource] = useState<SummarySource | null>(null)
  const [summaryPreviewError, setSummaryPreviewError] = useState('')
  const aiLoadedScopeRef = useRef<string | null>(null)
  const aiSavedRef = useRef('')
  const latestAiSettingsRef = useRef(settings)
  const aiSaveTimerRef = useRef<number | null>(null)
  const aiSaveVersionRef = useRef(0)
  const aiSaveQueueRef = useRef(new KeyedAsyncQueue())
  const onSavedRef = useRef(onSaved)
  const contextSaveVersionRef = useRef(0)
  const contextSaveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const pendingLeaveDestinationRef = useRef<(() => void) | null>(null)
  const leaveSavingRef = useRef(false)
  const modelRefreshSequenceRef = useRef(0)
  const modelRefreshControllerRef = useRef<AbortController | null>(null)
  const promptEditorRef = useRef<PromptTemplateEditorHandle | null>(null)
  const imageSettingsRef = useRef<ImageSettingsPanelRef | null>(null)
  const isBookSettings = Boolean(book)
  onSavedRef.current = onSaved

  useEffect(() => subscribeFakeProviderTrace(() => setFakeTrace(getFakeProviderTrace())), [])

  useEffect(() => {
    let cancelled = false
    const summary = book?.currentSummary
    setSummaryPreviewSource(null)
    setSummaryPreviewError('')
    if (!summary) return () => { cancelled = true }
    void buildSummarySource(summary.sourceEntityId).then((source) => {
      if (!cancelled) setSummaryPreviewSource(source)
    }).catch(() => {
      if (!cancelled) setSummaryPreviewError('The current Summary source could not be prepared for preview.')
    })
    return () => { cancelled = true }
  }, [book?.currentSummary?.id, book?.currentSummary?.sourceEntityId, book?.currentSummary?.content])

  useEffect(() => () => {
    modelRefreshSequenceRef.current += 1
    modelRefreshControllerRef.current?.abort()
    modelRefreshControllerRef.current = null
  }, [])

  useEffect(() => {
    let cancelled = false
    modelRefreshSequenceRef.current += 1
    modelRefreshControllerRef.current?.abort()
    modelRefreshControllerRef.current = null
    setLoading(false)
    const scope = book?.id ?? 'defaults'
    aiLoadedScopeRef.current = null
    aiSaveVersionRef.current += 1
    if (aiSaveTimerRef.current !== null) window.clearTimeout(aiSaveTimerRef.current)
    aiSaveTimerRef.current = null
    setSaveState('loading')
    const defaults = loadAiSettings()
    if (!book) {
      latestAiSettingsRef.current = defaults
      aiSavedRef.current = JSON.stringify(defaults)
      aiLoadedScopeRef.current = scope
      setSettings(defaults)
      setAiSection(defaults.apiKey || defaults.provider === 'fake' ? 'models' : 'connection')
      const cachedModels = cachedTextModelCatalog(defaults)
      setModels(cachedModels?.models ?? [])
      setStatus(cachedModels ? `${cachedModels.models.length} cached models available. Reload the model list to refresh it.` : 'No cached model list yet. Use Reload model list to fetch it from the provider.')
      setStatusKind(cachedModels?.models.length ? 'success' : 'quiet')
      setSaveState('saved')
      setSettingsLoading(false)
      return () => { cancelled = true }
    }

    setSettingsLoading(true)
    ;(async () => {
      try {
        await ensureBookAiSettings(book.id, defaults)
        const bookSettings = await getBookAiSettings(book.id, defaults.favorites)
        if (cancelled) return
        latestAiSettingsRef.current = bookSettings
        aiSavedRef.current = JSON.stringify(bookSettings)
        aiLoadedScopeRef.current = scope
        setSettings(bookSettings)
        setAiSection(bookSettings.apiKey || bookSettings.provider === 'fake' ? 'models' : 'connection')
        const cachedModels = cachedTextModelCatalog(bookSettings)
        setModels(cachedModels?.models ?? [])
        setStatus(cachedModels ? `${cachedModels.models.length} cached models available for “${book.title}”. Reload the model list to refresh it.` : 'No cached model list yet. Use Reload model list to fetch it from the provider.')
        setStatusKind(cachedModels?.models.length ? 'success' : 'quiet')
        setSaveState('saved')
      } catch {
        if (cancelled) return
        latestAiSettingsRef.current = defaults
        setSettings(defaults)
        setStatus('Book settings could not be read. No changes have been saved.')
        setStatusKind('error')
        setSaveState('error')
      } finally {
        if (!cancelled) setSettingsLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [book?.id])

  useEffect(() => {
    let cancelled = false
    if (!book) {
      setContextSaveError('')
      setContextSettings(loadDefaultBookContextSettings())
      setChatContextProfile(null)
      setContextSources([])
      setContextSaved(true)
      setContextReady(true)
      return () => { cancelled = true }
    }
    setContextReady(false)
    setContextSaved(false)
    setContextSaveError('')
    void Promise.all([getBookContextSettings(book.id), listEntitiesByBook(book.id), book.chatId ? getChat(book.chatId) : Promise.resolve(undefined)]).then(([value, entities, chat]) => {
      if (!cancelled) {
        setContextReady(true)
        setContextSettings(value)
        setChatContextProfile(chat?.contextProfile ?? null)
        setContextSources(entities)
        setContextSaved(true)
      }
    }).catch(() => { if (!cancelled) { setContextSaved(false); setContextSaveError('Context settings could not be loaded. Reopen settings to try again.') } })
    return () => { cancelled = true }
  }, [book?.id, book?.chatId, contextLoadVersion])


  function persistAiSettings(snapshot: AiSettings, scope: string, version: number): Promise<boolean> {
    const pending = aiSaveQueueRef.current.run(scope, async () => {
      const savedSettings = scope === 'defaults'
        ? saveAiSettings(snapshot)
        : await saveBookAiSettings(scope, snapshot)
      if (scope !== 'defaults') saveGlobalFavorites(snapshot.favorites)
      if (version !== aiSaveVersionRef.current || scope !== aiLoadedScopeRef.current) return false
      aiSavedRef.current = JSON.stringify(snapshot)
      setSaveState('saved')
      setSaveError('')
      onSavedRef.current?.(savedSettings)
      return true
    })
    return pending.catch(() => {
      if (version !== aiSaveVersionRef.current || scope !== aiLoadedScopeRef.current) return false
      setSaveState('error')
      setSaveError('Settings could not be saved. Your changes are still here.')
      return false
    })
  }

  function scheduleAiSettingsSave(next: AiSettings) {
    const scope = aiLoadedScopeRef.current
    latestAiSettingsRef.current = next
    if (!scope || JSON.stringify(next) === aiSavedRef.current) return
    setSaveState('saving')
    const version = ++aiSaveVersionRef.current
    if (aiSaveTimerRef.current !== null) window.clearTimeout(aiSaveTimerRef.current)
    aiSaveTimerRef.current = window.setTimeout(() => {
      aiSaveTimerRef.current = null
      void persistAiSettings(next, scope, version)
    }, 500)
  }

  function changeAiSettings(transform: (current: AiSettings) => AiSettings) {
    const current = latestAiSettingsRef.current
    const next = transform(current)
    if (JSON.stringify(next) === JSON.stringify(current)) return
    latestAiSettingsRef.current = next
    setSettings(next)
    scheduleAiSettingsSave(next)
  }

  async function flushAiSettings(): Promise<boolean> {
    const scope = aiLoadedScopeRef.current
    const snapshot = latestAiSettingsRef.current
    if (!scope || JSON.stringify(snapshot) === aiSavedRef.current) return true
    if (aiSaveTimerRef.current !== null) window.clearTimeout(aiSaveTimerRef.current)
    aiSaveTimerRef.current = null
    setSaveState('saving')
    const version = ++aiSaveVersionRef.current
    const saved = await persistAiSettings(snapshot, scope, version)
    return saved
      && scope === aiLoadedScopeRef.current
      && JSON.stringify(latestAiSettingsRef.current) === aiSavedRef.current
  }

  function invalidateModelRefresh() {
    modelRefreshSequenceRef.current += 1
    modelRefreshControllerRef.current?.abort()
    modelRefreshControllerRef.current = null
    setLoading(false)
  }

  function update<K extends keyof AiSettings>(key: K, value: AiSettings[K]) { changeAiSettings((current) => ({ ...current, [key]: value })) }
  function updateConnection<K extends 'apiKey' | 'baseUrl'>(key: K, value: AiSettings[K]) {
    const current = latestAiSettingsRef.current
    if (current[key] === value) return
    invalidateModelRefresh()
    const next = { ...current, [key]: value } as AiSettings
    clearModelCatalog(current)
    clearModelCatalog(next)
    changeAiSettings(() => next)
    setModels([])
    setStatus('Connection changed. Reload the model list to refresh the cache.')
    setStatusKind('quiet')
  }
  function selectProvider(provider: AiProvider) {
    const current = latestAiSettingsRef.current
    if (current.provider === provider) return
    invalidateModelRefresh()
    const next = switchProviderProfile(current, provider)
    setShowKey(false)
    clearModelCatalog(current)
    clearModelCatalog(next)
    changeAiSettings(() => next)
    setModels(provider === 'fake' ? [FAKE_PROVIDER_MODEL] : []); setStatus(provider === 'fake' ? 'Fake Test Model is available locally. Reload never contacts a network.' : 'Provider changed. Reload its model list when ready.'); setStatusKind(provider === 'fake' ? 'success' : 'quiet')
  }
  function selectModel(kind: ModelRole, id: string) {
    const contextLength = models.find((model) => model.id === id)?.context_length
    changeAiSettings((current) => kind === 'main'
      ? { ...current, mainModel: id, mainModelContextLength: contextLength }
      : kind === 'support' ? { ...current, supportModel: id, supportModelContextLength: contextLength } : kind === 'chat' ? { ...current, chatModel: id, chatModelContextLength: contextLength } : { ...current, codexModel: id, codexModelContextLength: contextLength })
  }
  async function refreshModels() {
    const requestSettings = latestAiSettingsRef.current
    if (requestSettings.provider === 'fake') {
      invalidateModelRefresh()
      setModels([FAKE_PROVIDER_MODEL])
      changeAiSettings((current) => ({
        ...current,
        mainModelContextLength: current.mainModel === FAKE_PROVIDER_MODEL.id ? FAKE_PROVIDER_MODEL.context_length : undefined,
        chatModelContextLength: current.chatModel === FAKE_PROVIDER_MODEL.id ? FAKE_PROVIDER_MODEL.context_length : undefined,
        supportModelContextLength: current.supportModel === FAKE_PROVIDER_MODEL.id ? FAKE_PROVIDER_MODEL.context_length : undefined,
        codexModelContextLength: current.codexModel === FAKE_PROVIDER_MODEL.id ? FAKE_PROVIDER_MODEL.context_length : undefined,
      }))
      setStatus('1 local testing model available. No network request was made.')
      setStatusKind('success')
      return
    }
    if (!requestSettings.apiKey.trim()) { setStatus('Enter an API key before loading models.'); setStatusKind('error'); return }
    if ((requestSettings.provider === 'compatible' || requestSettings.provider === 'litellm') && !requestSettings.baseUrl.trim()) { setStatus(`Enter the ${requestSettings.provider === 'litellm' ? 'LiteLLM base URL' : 'compatible provider endpoint'} first.`); setStatusKind('error'); return }
    modelRefreshControllerRef.current?.abort()
    const requestId = ++modelRefreshSequenceRef.current
    const connectionKey = textModelConnectionKey(requestSettings)
    const controller = new AbortController()
    modelRefreshControllerRef.current = controller
    const ownsRequest = () => requestId === modelRefreshSequenceRef.current && textModelConnectionKey(latestAiSettingsRef.current) === connectionKey
    setLoading(true); setStatus('Contacting the provider…'); setStatusKind('quiet')
    try {
      const response = await fetch(providerModelEndpoint(requestSettings), { headers: { Accept: 'application/json', Authorization: `Bearer ${requestSettings.apiKey.trim()}` }, signal: controller.signal })
      const payload = await response.json().catch(() => ({})) as { data?: ProviderModel[]; message?: string; error?: { message?: string } }
      if (!response.ok) throw new Error(payload.error?.message || payload.message || `Provider returned ${response.status}.`)
      const nextModels = Array.isArray(payload.data) ? payload.data.filter((model) => typeof model.id === 'string' && model.id.length > 0) : []
      if (!ownsRequest()) return
      changeAiSettings((current) => ({
        ...current,
        mainModelContextLength: nextModels.find((model) => model.id === current.mainModel)?.context_length ?? current.mainModelContextLength,
        chatModelContextLength: nextModels.find((model) => model.id === current.chatModel)?.context_length ?? current.chatModelContextLength,
        supportModelContextLength: nextModels.find((model) => model.id === current.supportModel)?.context_length ?? current.supportModelContextLength,
        codexModelContextLength: nextModels.find((model) => model.id === current.codexModel)?.context_length ?? current.codexModelContextLength,
      }))
      if (!ownsRequest()) return
      const cached = saveModelCatalog(requestSettings, nextModels)
      setModels(nextModels)
      setStatus(nextModels.length ? (cached.persisted ? `${nextModels.length} models cached.` : `${nextModels.length} models loaded, but the browser could not persist the cache.`) : 'The provider returned no models.')
      setStatusKind(nextModels.length && cached.persisted ? 'success' : 'error')
    } catch (error) {
      if (!ownsRequest() || isAbortError(error)) return
      const cached = getCachedModelCatalog(requestSettings)
      if (cached?.models.length) {
        setModels(cached.models)
        const reason = error instanceof Error ? error.message : 'Could not refresh the model list.'
        setStatus(`Refresh failed; keeping ${cached.models.length} cached models. ${reason}`)
      } else {
        setModels([])
        setStatus(error instanceof Error ? error.message : 'Could not load the model list.')
      }
      setStatusKind('error')
    } finally {
      if (requestId === modelRefreshSequenceRef.current) {
        if (modelRefreshControllerRef.current === controller) modelRefreshControllerRef.current = null
        setLoading(false)
      }
    }
  }

  async function resetFromDefaults() {
    if (!book || !window.confirm(`Replace the AI settings for “${book.title}” with the current defaults?`)) return
    invalidateModelRefresh()
    const scope = book.id
    const defaults = loadAiSettings()
    if (aiSaveTimerRef.current !== null) window.clearTimeout(aiSaveTimerRef.current)
    aiSaveTimerRef.current = null
    const version = ++aiSaveVersionRef.current

    // Reset becomes the newest local revision immediately, so any edit made while the
    // queued reset is waiting starts from the defaults and is ordered after the reset.
    latestAiSettingsRef.current = defaults
    setSettings(defaults)
    setSaveState('saving')
    setModels(cachedTextModelCatalog(defaults)?.models ?? [])

    try {
      await aiSaveQueueRef.current.run(scope, async () => {
        const copied = await copyDefaultAiSettingsToBook(scope, defaults)
        if (version !== aiSaveVersionRef.current || scope !== aiLoadedScopeRef.current) return
        latestAiSettingsRef.current = copied
        aiSavedRef.current = JSON.stringify(copied)
        setSettings(copied)
        setSaveState('saved')
        setModels(cachedTextModelCatalog(copied)?.models ?? [])
        setSaveError('')
        onSavedRef.current?.(copied)
      })
    } catch {
      if (version !== aiSaveVersionRef.current || scope !== aiLoadedScopeRef.current) return
      setSaveState('error')
      setSaveError('Defaults could not be copied to this book. Try again.')
    }
  }

  async function saveContextDefaults(): Promise<boolean> {
    if (!contextReady) return true // No editable Context draft has been loaded.
    const section = contextSection
    setContextSaveError('')
    setContextSaved(false)
    const value = contextSettings
    if (!book) {
      try {
        const saved = saveDefaultBookContextSettings(value)
        setContextSettings(saved)
        setContextSaved(true)
        return true
      } catch {
        setContextSaved(false)
        setContextSaveError('Context could not be saved. Your selections are still here.')
        return false
      }
    }

    const version = ++contextSaveVersionRef.current
    if (section === 'chat' && book.chatId && chatContextProfile) {
      try {
        await saveChatContextProfile(book.chatId, chatContextProfile)
        if (version !== contextSaveVersionRef.current) return false
        setContextSaved(true)
        return true
      } catch {
        if (version === contextSaveVersionRef.current) { setContextSaved(false); setContextSaveError('Context could not be saved. Your selections are still here.') }
        return false
      }
    }

    const pending = contextSaveQueueRef.current.catch(() => undefined).then(() => saveBookContextSettings(book.id, value))
    contextSaveQueueRef.current = pending.then(() => undefined, () => undefined)
    try {
      const savedDefaults = await pending
      if (version !== contextSaveVersionRef.current) return false
      setContextSettings(savedDefaults)
      setContextSaved(true)
      return true
    } catch {
      if (version === contextSaveVersionRef.current) { setContextSaved(false); setContextSaveError('Context could not be saved. Your selections are still here.') }
      return false
    }
  }

  function updateContextDefaults(value: BookContextSettings, section: GenerationContextType = 'scene') {
    if (!contextReady) return
    setContextSaveError('')
    setContextSaved(false)
    if (section === 'chat' && book?.chatId) setChatContextProfile(value.profiles.chat)
    else setContextSettings(value)
    if (!book) {
      try {
        const saved = saveDefaultBookContextSettings(value)
        setContextSettings(saved)
        setContextSaved(true)
      } catch {
        setContextSaved(false)
        setContextSaveError('Context could not be saved. Your selections are still here.')
      }
      return
    }
    const version = ++contextSaveVersionRef.current
    if (section === 'chat' && book.chatId) {
      contextSaveQueueRef.current = contextSaveQueueRef.current.catch(() => undefined).then(async () => {
        await saveChatContextProfile(book.chatId!, value.profiles.chat)
        if (version === contextSaveVersionRef.current) setContextSaved(true)
      }).catch(() => {
        if (version === contextSaveVersionRef.current) { setContextSaved(false); setContextSaveError('Context could not be saved. Your selections are still here.') }
      })
      return
    }
    contextSaveQueueRef.current = contextSaveQueueRef.current.catch(() => undefined).then(async () => {
      const savedDefaults = await saveBookContextSettings(book.id, value)
      if (version === contextSaveVersionRef.current) {
        setContextSettings(savedDefaults)
        setContextSaved(true)
      }
    }).catch(() => {
      if (version === contextSaveVersionRef.current) { setContextSaved(false); setContextSaveError('Context could not be saved. Your selections are still here.') }
    })
  }

  async function flushImageSettings(): Promise<boolean> {
    if (!imageSettingsDirty) return true
    return imageSettingsRef.current?.save() ?? true
  }

  async function selectSettingsTab(tab: SettingsTab) {
    if (tab === settingsTab) return
    if (settingsTab === 'images' && !(await flushImageSettings())) return
    setSettingsTab(tab)
  }

  async function leaveSettings(destination?: () => void) {
    if (!destination || leaveSavingRef.current) return
    pendingLeaveDestinationRef.current = destination
    leaveSavingRef.current = true
    setLeaveSaving(true)
    const saved = await saveRequiredSettingsForLeave([
      () => flushAiSettings(),
      ...(!contextSaved ? [() => saveContextDefaults()] : []),
      ...((settingsTab === 'images' && imageSettingsDirty) ? [() => flushImageSettings()] : []),
    ])
    leaveSavingRef.current = false
    setLeaveSaving(false)
    if (!saved) {
      setLeaveRecoveryOpen(true)
      return
    }
    setLeaveRecoveryOpen(false)
    pendingLeaveDestinationRef.current = null
    destination()
  }

  async function retrySettingsLeave() {
    const destination = pendingLeaveDestinationRef.current
    if (!destination) return
    await leaveSettings(destination)
  }

  async function leaveSettingsWithoutSaving() {
    const destination = pendingLeaveDestinationRef.current
    if (!destination || leaveSavingRef.current) return
    if (!window.confirm('Leave without saving? Unsaved settings changes will be lost.')) return

    if (aiSaveTimerRef.current !== null) window.clearTimeout(aiSaveTimerRef.current)
    aiSaveTimerRef.current = null
    aiSaveVersionRef.current += 1
    contextSaveVersionRef.current += 1
    leaveSavingRef.current = true
    setLeaveSaving(true)
    const scope = aiLoadedScopeRef.current
    await Promise.allSettled([
      scope ? aiSaveQueueRef.current.whenIdle(scope) : Promise.resolve(),
      contextSaveQueueRef.current.catch(() => undefined),
    ])
    leaveSavingRef.current = false
    setLeaveSaving(false)
    imageSettingsRef.current?.discard()
    setLeaveRecoveryOpen(false)
    pendingLeaveDestinationRef.current = null
    destination()
  }

  const activePrompt = settings.promptCompositions[promptTab].systemPrompt
  const responseLengthScope = promptTab === 'lore' ? 'codex' : promptTab === 'summarize' ? 'summary' : promptTab === 'story' ? 'story' : null
  const activeResponseLength = responseLengthScope ? settings.responseLengths[responseLengthScope] : ''
  const activeResponseLengthPresets = responseLengthScope === 'story'
    ? STORY_RESPONSE_LENGTH_PRESETS
    : responseLengthScope === 'codex' ? CODEX_RESPONSE_LENGTH_PRESETS : SUMMARY_RESPONSE_LENGTH_PRESETS
  const basePromptPreviewValues = book?.promptValues
    ? bookTemplateValues({ ...book.promptValues, responseLength: activeResponseLength })
    : undefined
  const promptPreviewValues = promptTab === 'summarize' && basePromptPreviewValues && book?.currentSummary && summaryPreviewSource
    ? {
        ...basePromptPreviewValues,
        'target.type': summaryPreviewSource.source.type === 'codexEntry' ? 'Codex entry' : summaryPreviewSource.source.type[0].toUpperCase() + summaryPreviewSource.source.type.slice(1),
        'target.title': summaryPreviewSource.source.title,
        'target.source': summaryPreviewSource.content,
        'target.previous_summary': summaryPreviewSource.previousSummary ?? '',
      }
    : basePromptPreviewValues
  const activePromptDiagnostics = promptTemplateDiagnostics(activePrompt, promptTab, promptPreviewValues)
  const compositionPromptDiagnostics = [activePrompt, ...settings.promptCompositions[promptTab].predefinedMessages.filter((message) => message.enabled).map((message) => message.template)]
    .flatMap((template) => promptTemplateDiagnostics(template, promptTab, promptPreviewValues))
  const activePromptErrors = compositionPromptDiagnostics.filter((diagnostic) => diagnostic.severity === 'error')
  const activePromptWarnings = compositionPromptDiagnostics.filter((diagnostic) => diagnostic.severity === 'warning')
  const normalizedVariableQuery = promptVariableQuery.trim().toLowerCase()
  const availablePromptVariables = promptVariables.filter((variable) => variable.scopes.includes(promptTab))
    .filter((variable) => !normalizedVariableQuery || `${variable.name} ${variable.description}`.toLowerCase().includes(normalizedVariableQuery))
  const localPromptPreview = activePromptErrors.length ? '' : renderPromptTemplate(activePrompt, promptPreviewValues ?? {})
  const summaryNormalizedRequest = promptTab === 'summarize' && !activePromptErrors.length && book?.currentSummary && summaryPreviewSource && book.promptValues
    ? assembleSummaryGenerationRequest({
        composition: settings.promptCompositions.summarize,
        book: { ...book.promptValues, responseLength: settings.responseLengths.summary },
        responseLength: settings.responseLengths.summary,
        summary: { id: book.currentSummary.id, content: summaryPreviewSource.previousSummary ?? '' },
        target: { id: summaryPreviewSource.source.id, type: summaryPreviewSource.source.type, title: summaryPreviewSource.source.title, source: summaryPreviewSource.content },
        sourceDiagnostics: summaryPreviewSource.diagnostics,
      })
    : null
  const visibleContextSettings = contextSection === 'chat' && chatContextProfile
    ? { ...contextSettings, profiles: { ...contextSettings.profiles, chat: chatContextProfile } }
    : contextSettings

  return (
    <main className="app-shell ai-settings-shell">
      <aside className="settings-rail" aria-label={`${isBookSettings ? 'Book' : 'Default'} settings navigation`}>
        <div className="rail-header"><button className="home-button" type="button" aria-label="Back to library" onClick={() => { void leaveSettings(onHome) }} disabled={leaveSaving}><Home aria-hidden="true" /><b>Home</b></button>{onBack && <button className="settings-close" type="button" onClick={() => { void leaveSettings(onBack) }} aria-label="Close settings" title="Close settings" disabled={leaveSaving}><X aria-hidden="true" /></button>}</div>
        <nav>
          {(isBookSettings ? ([['ai', Bot, 'AI'], ['context', SlidersHorizontal, 'Context'], ['appearance', Type, 'UI'], ['speech', Volume2, 'Speech'], ['images', ImageIcon, 'Images']] as const) : ([['ai', Bot, 'AI'], ['context', SlidersHorizontal, 'Context'], ['appearance', Type, 'UI'], ['speech', Volume2, 'Speech'], ['images', ImageIcon, 'Images'], ['sync', Cloud, 'Sync']] as const)).map(([key, Icon, label]) => (
            <button className={settingsTab === key ? 'active' : ''} type="button" onClick={() => { void selectSettingsTab(key) }} aria-current={settingsTab === key ? 'page' : undefined} key={key}><Icon aria-hidden="true" /><span>{label}</span></button>
          ))}
        </nav>
        <p>{settingsTab === 'sync' ? 'Sync credentials and automatic-upload preference apply only to this browser.' : settingsTab === 'images' ? 'Image providers and favorite models apply to all books on this device.' : isBookSettings ? `Changes here affect only “${book?.title}”. Favorite models are shared across books.` : 'Defaults are copied into a new book. After that, each book keeps its own settings.'}</p>
      </aside>

      <section className="settings-page" aria-labelledby="page-title">
        {leaveRecoveryOpen && <section className="settings-save-recovery" role="alert" aria-live="assertive">
          <div><strong>Settings weren’t saved</strong><span>Your unsaved changes are still here. Retry saving, or deliberately leave and discard only the changes that are still unsaved.</span></div>
          <div className="settings-save-recovery-actions">
            <button className="primary" type="button" onClick={() => { void retrySettingsLeave() }} disabled={leaveSaving}>{leaveSaving ? 'Retrying…' : 'Retry'}</button>
            <button type="button" onClick={() => { void leaveSettingsWithoutSaving() }} disabled={leaveSaving}>Leave without saving</button>
          </div>
        </section>}
        {settingsTab === 'ai' ? <>
        <header className="page-heading"><div><p>{isBookSettings ? 'Book AI' : 'Default AI'}</p><h1 id="page-title">Models & prompts</h1><span>{isBookSettings ? `Configure AI for “${book?.title}”. These settings are independent from the defaults.` : 'Configure the writing and support models used when a book is created.'}</span></div><div className={`save-state ${saveState}`} aria-live="polite"><i />{saveState === 'loading' || settingsLoading ? 'Loading' : saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : 'Saved'}</div></header>

        <div className="ai-scope-row"><span>{isBookSettings ? `This book only · ${book?.title}` : 'Defaults for new books'}</span>{book && <details className="ai-settings-menu"><summary>More options</summary><button type="button" onClick={() => { void resetFromDefaults() }} disabled={settingsLoading}>Reset from defaults</button></details>}</div>
        {saveError && <div className="status error" role="alert">{saveError}<button type="button" onClick={() => { void flushAiSettings() }}>Retry saving</button></div>}
        <SettingsSectionTabs tabs={aiSections} active={aiSection} onChange={setAiSection} idPrefix="ai" label="AI sections" />
        <section hidden={aiSection !== 'connection'} className="settings-card provider-card" role="tabpanel" id="ai-panel-connection" aria-labelledby="ai-tab-connection">
          <div className="card-heading"><div><span>01</span><h2>Provider</h2></div><p>Connection details stay in this browser.</p></div>
          <p className="connection-summary">{providerLabels[settings.provider]} · {settings.provider === 'fake' ? 'Local testing' : settings.apiKey ? 'Key saved on this device' : 'Setup required'}</p><Disclosure className="provider-connection" title="Edit connection" description="Provider endpoint, credentials, and model catalog." open={connectionExpanded || (!settings.apiKey && settings.provider !== 'fake')} onToggle={event => setConnectionExpanded(event.currentTarget.open)}><div className="provider-grid">{(Object.keys(providerLabels) as AiProvider[]).map((provider) => <button key={provider} className={settings.provider === provider ? 'selected' : ''} type="button" aria-pressed={settings.provider === provider} onClick={() => selectProvider(provider)}><i>{provider === 'fake' ? 'T' : provider === 'nanogpt' ? 'N' : provider === 'openrouter' ? 'O' : provider === 'openai' ? 'AI' : provider === 'litellm' ? 'LLM' : '{ }'}</i><span><strong>{providerLabels[provider]}</strong><small>{provider === 'fake' ? 'Local · no network' : provider === 'compatible' ? 'Custom endpoint' : provider === 'litellm' ? 'Self-hosted gateway' : 'Managed endpoint'}</small></span><b>{settings.provider === provider ? '✓' : ''}</b></button>)}</div>
          <div className="connection-fields">
            {(settings.provider === 'compatible' || settings.provider === 'litellm') && <Input label={settings.provider === 'litellm' ? 'LiteLLM base URL' : 'Endpoint URL'} value={settings.baseUrl} onChange={(event) => updateConnection('baseUrl', event.target.value)} placeholder={settings.provider === 'litellm' ? 'https://webdev.serveblog.net:9447/v1' : 'https://provider.example/v1'} />}
            {settings.provider !== 'fake' && <label><span>{settings.provider === 'litellm' ? 'LiteLLM API key' : 'API key'}</span><div className="input-action"><input
              type={showKey ? 'text' : 'password'}
              name="arc-provider-token"
              value={settings.apiKey}
              onChange={(event) => updateConnection('apiKey', event.target.value)}
              placeholder="Enter API key"
              autoComplete="one-time-code"
              autoCapitalize="none"
              data-1p-ignore
              data-bwignore="true"
              data-form-type="other"
              data-lpignore="true"
              spellCheck={false}
            /><button type="button" onClick={() => setShowKey((value) => !value)}>{showKey ? 'Hide' : 'Show'}</button></div></label>}
            {settings.provider === 'fake' && <div className="status success" role="note"><i />Testing provider — responses, errors, reasoning, and tool calls are generated locally and deterministically. No text-AI network request is sent.</div>}
            <Button className="reload-button" onClick={refreshModels} disabled={loading} leadingIcon={<RefreshCw className={loading ? 'spinning' : ''} aria-hidden="true" />}>{loading ? 'Loading models…' : 'Reload model list'}</Button>
          </div>
          </Disclosure><p className={`status ${statusKind}`} role="status"><i />{status}</p>
        </section>

        {settings.provider === 'fake' && aiSection === 'connection' && <Disclosure className="settings-card provider-trace" bodyClassName="provider-trace-body" eyebrow="Testing provider" title="Request trace" description={fakeTrace.length ? `${fakeTrace.length} request${fakeTrace.length === 1 ? '' : 's'} captured` : 'No Fake requests yet'} aria-label="Fake provider request trace">
          <p>Session only · last 20 requests. Inspect the exact provider-boundary payload generated by Arc.</p><Button size="small" variant="ghost" onClick={clearFakeProviderTrace} disabled={!fakeTrace.length}>Clear trace</Button><pre>{fakeTrace.length ? JSON.stringify(fakeTrace, null, 2) : 'Generate, summarize, autotitle, or chat with Fake (testing) to capture a request.'}</pre>
        </Disclosure>}

        <section hidden={aiSection !== 'models'} className="settings-card models-card" role="tabpanel" id="ai-panel-models" aria-labelledby="ai-tab-models">
          <div className="card-heading"><div><span>02</span><h2>Models</h2></div><p>{isBookSettings ? 'Favorites are shared; model choices belong to this book.' : 'Main writes; Support summarizes; Codex builds your world; Chat assists.'}</p></div>
          <div className="model-role-settings">{modelRoles.map(({ key: role, label, description }) => {
            const configuredModel = settings[`${role}Model`].trim()
            const mainModel = settings.mainModel.trim()
            const emptyTitle = role === 'codex' || role === 'chat' ? `Use Main · ${mainModel || 'not selected'}` : `No ${label.split(' · ')[0]} model`
            const emptySubtitle = role === 'main'
              ? 'Story generation will be unavailable'
              : role === 'support'
                ? 'Summaries and prompt enhancement will be unavailable'
                : 'No separate model for this role'
            const effectiveModel = role === 'codex' || role === 'chat' ? configuredModel || mainModel : configuredModel
            const priority = role === 'main'
              ? effectiveModel ? `Effective model: ${effectiveModel}. Main has no fallback.` : 'Effective model: none. Main has no fallback, so story generation is unavailable.'
              : role === 'support'
                ? effectiveModel ? `Effective model: ${effectiveModel}. Support has priority for summaries, prompt enhancement, and automatic titles.` : mainModel ? `Effective model: none for summaries or prompt enhancement. Automatic titles alone fall back to Main: ${mainModel}.` : 'Effective model: none. Summaries, prompt enhancement, and automatic titles are unavailable.'
                : role === 'codex'
                  ? effectiveModel ? `Effective model: ${effectiveModel}. Priority: Codex, then Main.` : 'Effective model: none. Priority: Codex, then Main; Codex generation is unavailable when both are empty.'
                  : effectiveModel ? `Effective model for new chats: ${effectiveModel}. Priority: Chat, then Main. Existing chats keep their own model.` : 'Effective model for new chats: none. Priority: Chat, then Main. Existing chats keep their own model.'
            return <section className="model-role-setting" key={role} aria-labelledby={`${role}-model-heading`}>
              <header><h3 id={`${role}-model-heading`}>{label}</h3><p>{description}</p></header>
              <SearchableSelect
                label="Catalog model"
                value={settings[`${role}Model`]}
                searchPlaceholder={`Search ${label.split(' · ')[0]} models`}
                emptyText={models.length ? 'No models match that search.' : 'Reload the provider model list first.'}
                description="Choose a model returned by the provider. Favorites are listed first."
                options={[
                  { value: '', title: emptyTitle, subtitle: emptySubtitle },
                  ...(!models.some(model => model.id === settings[`${role}Model`]) && settings[`${role}Model`] ? [{ value: settings[`${role}Model`], title: settings[`${role}Model`], subtitle: 'Unlisted provider model', badges: ['Custom ID'] }] : []),
                  ...[...models].sort((a, b) => Number(settings.favorites.includes(b.id)) - Number(settings.favorites.includes(a.id))).map(model => ({ value: model.id, title: model.name || model.id, subtitle: model.name && model.name !== model.id ? model.id : undefined, meta: formatContext(model.context_length), badges: [settings.favorites.includes(model.id) ? 'Favorite' : '', model.architecture?.modality || 'Text'].filter(Boolean) })),
                ]}
                onChange={modelId => selectModel(role, modelId)}
              />
              <Input label="Exact model ID" description="This edits the same model selection as the catalog picker. Use it only when the provider supports a model that is missing from the loaded catalog." value={settings[`${role}Model`]} onChange={event => selectModel(role, event.target.value)} placeholder={(role === 'codex' || role === 'chat') ? 'Leave empty to use Main' : 'Enter an unlisted model ID'} />
              <Select label="Thinking effort" description={role === 'chat' ? 'Copied to new chats; each chat can change it.' : 'Used whenever this role runs, including when its model falls back to Main.'} value={settings[`${role}ThinkingEffort`]} onChange={event => update(`${role}ThinkingEffort`, normalizeThinkingEffort(event.target.value))}>{THINKING_EFFORT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>
              <p className="effective-model-note">{priority}</p>
              {role === 'chat' && !isBookSettings && <Select label="Max model rounds per response" description="Default for new chats. One assistant model request is one round; several tools in that request still count as one. Existing chats keep their own limit." value={settings.chatMaxModelRounds} onChange={event => update('chatMaxModelRounds', Number(event.target.value))}>{Array.from({ length: 32 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</Select>}
            </section>
          })}</div>
          <div className="reveal-setting"><h3>Text reveal speed</h3><p>Controls how quickly generated words appear.</p><SegmentedControl className="reveal-speed-control" label="Text reveal speed" value={settings.generationWordDelayMs} onChange={delay => update('generationWordDelayMs', delay)} fullWidth options={[{ value: '120', label: 'Slow' }, { value: '40', label: 'Normal' }, { value: '10', label: 'Fast' }]} /><TextRevealPreview delay={Number(settings.generationWordDelayMs)} /></div>
          <Disclosure className="ai-advanced" title="Advanced" description="Speed and context limits">
          <label className="generation-speed-setting">
            <span><strong>Custom reveal speed</strong><em>Milliseconds per word</em></span>
            <input type="text" inputMode="numeric" pattern="[0-9]*" value={settings.generationWordDelayMs} onChange={(event) => update('generationWordDelayMs', event.target.value)} aria-describedby="generation-speed-help" spellCheck={false} />
            <small id="generation-speed-help">40 ms is the default. Use a lower value for faster writing or a higher value for slower writing (1–2000).</small>
          </label>
          <div className="context-limit-grid">
            <label className={contextLimitInputError(settings.mainEffectiveContextLimit) ? 'invalid' : ''}><span><strong>Story / Main context cap</strong><em>Effective input window</em></span><input type="text" value={settings.mainEffectiveContextLimit} onChange={(event) => update('mainEffectiveContextLimit', event.target.value)} placeholder="Model maximum" spellCheck={false} /><small>{contextLimitInputError(settings.mainEffectiveContextLimit) || 'Optional. Accepts tokens such as 32000, 32k, or 1m. The model hard maximum still wins.'}</small></label>
            <label className={contextLimitInputError(settings.codexEffectiveContextLimit) ? 'invalid' : ''}><span><strong>Codex model context cap</strong><em>Used when a Codex model is set</em></span><input type="text" value={settings.codexEffectiveContextLimit} onChange={(event) => update('codexEffectiveContextLimit', event.target.value)} placeholder="Model maximum" spellCheck={false} /><small>{contextLimitInputError(settings.codexEffectiveContextLimit) || (settings.codexModel.trim() ? 'Optional cap for the selected Codex model.' : 'Codex currently falls back to Main, so the Story / Main cap applies.')}</small></label>
          </div>
          </Disclosure>
        </section>

        <section hidden={aiSection !== 'prompts'} className="settings-card prompts-card" role="tabpanel" id="ai-panel-prompts" aria-labelledby="ai-tab-prompts">
          <div className="card-heading"><div><span>03</span><h2>Prompts</h2></div><p>System prompt, ordered predefined messages, then Arc’s current instruction.</p></div>
          <Tabs className="prompt-tabs" label="Prompt purpose" value={promptTab} onChange={setPromptTab} items={([['story', 'Story'], ['assistant', 'Chat'], ['lore', 'Codex'], ['summarize', 'Summary']] as const).map(([value, label]) => ({ value, label, id: `prompt-tab-${value}`, panelId: 'prompt-panel' }))} />
          <div role="tabpanel" id="prompt-panel" aria-labelledby={`prompt-tab-${promptTab}`} key={promptTab}>
          <PromptPresetControls
            scope={promptPresetScope[promptTab]}
            composition={settings.promptCompositions[promptTab]}
            arcDefault={defaultPromptCompositions[promptTab]}
            onApply={(composition) => changeAiSettings((current) => withPromptComposition(current, promptTab, composition))}
          />
          {responseLengthScope && <div className="response-length-setting">
            <label htmlFor={`${responseLengthScope}-response-length`}><span><strong>Response length</strong><em>{promptTab === 'story' ? 'Story' : promptTab === 'lore' ? 'Codex' : 'Summary'}</em></span><textarea id={`${responseLengthScope}-response-length`} value={activeResponseLength} onChange={(event) => changeAiSettings((current) => ({ ...current, responseLengths: { ...current.responseLengths, [responseLengthScope]: event.target.value } }))} placeholder="Leave empty to let the model decide." /></label>
            <div className="response-length-presets" aria-label={`${responseLengthScope} response length presets`}>{activeResponseLengthPresets.map((preset) => <button type="button" key={preset.label} onClick={() => changeAiSettings((current) => ({ ...current, responseLengths: { ...current.responseLengths, [responseLengthScope]: preset.value } }))}>{preset.label}</button>)}</div>
            {![activePrompt, ...settings.promptCompositions[promptTab].predefinedMessages.filter(message => message.enabled).map(message => message.template)].some(template => /{{\s*response\.length\s*}}/.test(template)) && <div className="response-length-warning" role="status"><strong>Not included in this prompt</strong><p>Response length has no effect until an enabled template includes it.</p><button type="button" onClick={() => changeAiSettings(current => withPromptSystemPrompt(current, promptTab, `${current.promptCompositions[promptTab].systemPrompt}\n\n{% if response.length %}\nResponse length: {{response.length}}\n{% endif %}`))}>Add to prompt</button></div>}
            <small>Available as <code>{'{{response.length}}'}</code> only in this generation scope. It is sent only where an enabled template references it.</small>
          </div>}
          <h3 className="prompt-section-label">System prompt</h3>
          <PromptTemplateEditor
            ref={promptEditorRef}
            value={settings.promptCompositions[promptTab].systemPrompt}
            diagnostics={activePromptDiagnostics}
            ariaLabel={`${promptTab} system prompt template`}
            onChange={(value) => changeAiSettings((current) => withPromptSystemPrompt(current, promptTab, value))}
          />
          <PredefinedMessages
            scope={promptTab}
            messages={settings.promptCompositions[promptTab].predefinedMessages}
            previewValues={promptPreviewValues}
            onChange={(messages) => changeAiSettings((current) => withPromptComposition(current, promptTab, { ...current.promptCompositions[promptTab], predefinedMessages: messages }))}
          />
          <div className={`prompt-validation-summary ${activePromptErrors.length ? 'invalid' : activePromptWarnings.length ? 'warning' : 'valid'}`} role="status">
            <strong>{activePromptErrors.length
              ? `${activePromptErrors.length} template error${activePromptErrors.length === 1 ? '' : 's'} — generation is blocked`
              : activePromptWarnings.length
                ? `${activePromptWarnings.length} preview warning${activePromptWarnings.length === 1 ? '' : 's'}`
                : 'Template is valid'}</strong>
            {compositionPromptDiagnostics.length > 0 && <ul>{compositionPromptDiagnostics.map((diagnostic, index) => <li key={`${diagnostic.code}-${diagnostic.from}-${index}`}><b>{diagnostic.severity === 'error' ? 'Error' : 'Warning'}:</b> {diagnostic.message}</li>)}</ul>}
          </div>
          <details className="prompt-local-preview">
            <summary>Rendered preview</summary>
            {activePromptErrors.length
              ? <p role="alert">Fix the template errors above to render this prompt.</p>
              : <pre>{localPromptPreview || '[This prompt renders as empty with the current preview values.]'}</pre>}
          </details>
          {promptTab === 'summarize' && <SummaryRequestPreview
            request={summaryNormalizedRequest}
            source={summaryPreviewSource}
            error={summaryPreviewError}
            hasCurrentSummary={Boolean(book?.currentSummary)}
            model={settings.supportModel}
            modelContextLength={settings.supportModelContextLength}
          />}
          <details className="prompt-reference">
            <summary><CircleHelp aria-hidden="true" /><span>Variables & syntax</span></summary>
            <div className="prompt-syntax"><span>Insert a value</span><code>{'{{book.title}}'}</code><span>Include a block only when a value exists</span><code>{'{% if book.genre %}Genre: {{book.genre}}{% endif %}'}</code></div>
            <Input className="prompt-variable-search" label="Search variables" type="search" value={promptVariableQuery} onChange={(event) => setPromptVariableQuery(event.target.value)} placeholder={`Search ${promptTab} variables`} />
            <div className="prompt-variable-list">{availablePromptVariables.map((variable) => {
              const previewName = variable.aliasFor ?? variable.name
              const previewValue = promptPreviewValues?.[previewName]
              const hasPreviewValue = Boolean(promptPreviewValues && Object.prototype.hasOwnProperty.call(promptPreviewValues, previewName))
              return <div key={variable.name}>
                <button type="button" onClick={() => promptEditorRef.current?.insert(`{{${variable.name}}}`)}><code>{`{{${variable.name}}}`}</code></button>
                <span>{variable.description}<small>{variable.stability === 'stable' ? 'Stable' : variable.stability === 'book-state' ? 'Changes with book/settings' : 'Changes each generation'}{promptPreviewValues ? ` · ${hasPreviewValue ? (previewValue?.trim() ? 'available now' : 'empty now') : 'resolved at generation time'}` : ''}</small></span>
                <button type="button" className="insert-condition" onClick={() => promptEditorRef.current?.insert(`{% if ${variable.name} %}\n{{${variable.name}}}\n{% endif %}`)}>Insert if block</button>
              </div>
            })}{!availablePromptVariables.length && <p>No variables match that search.</p>}</div>
          </details>
          <div className="prompt-footer"><button type="button" onClick={() => { if (window.confirm('Reset this prompt and all predefined messages to the Arc default?')) changeAiSettings((current) => resetPromptComposition(current, promptTab)) }}>Reset prompt composition</button></div></div>
        </section>

        </> : settingsTab === 'context' ? (!contextReady ? <section className="settings-card"><h1 id="page-title">Context</h1><p role="status">{contextSaveError || 'Loading context settings…'}</p>{contextSaveError && <Button onClick={() => setContextLoadVersion(version => version + 1)}>Retry loading</Button>}</section> : book ? <>
          <SettingsSectionTabs tabs={contextSections} active={contextSection} onChange={setContextSection} idPrefix="context" label="Context type" />
          <div role="tabpanel" id={`context-panel-${contextSection}`} aria-labelledby={`context-tab-${contextSection}`}>
            {contextSection === 'summary'
              ? book.currentSummary ? <SummaryContextSettings book={book} source={summaryPreviewSource} error={summaryPreviewError} settings={settings} /> : <SummaryContextPlaceholder />
              : contextSection === 'note'
                ? <NoteContextPlaceholder />
                : <ContextSettings bookId={book.id} bookTitle={book.title} bookPromptValues={book.promptValues} type={contextSection} currentDocumentId={(book.contextType ?? 'scene') === contextSection ? book.currentDocumentId : undefined} currentDocumentText={(book.contextType ?? 'scene') === contextSection ? book.currentDocumentText : undefined} insertionPosition={(book.contextType ?? 'scene') === contextSection ? book.insertionPosition : undefined} chatId={contextSection === 'chat' ? book.chatId : undefined} settings={settings} value={visibleContextSettings} sources={contextSources} saved={contextSaved} saveError={contextSaveError} onRetry={() => { void saveContextDefaults() }} onChange={(value) => updateContextDefaults(value, contextSection)} />}
          </div>
        </> : <GlobalContextDefaults value={contextSettings} saved={contextSaved} saveError={contextSaveError} onRetry={() => { void saveContextDefaults() }} onChange={updateContextDefaults} />)
          : settingsTab === 'images' ? <ImageSettingsPanel ref={imageSettingsRef} ai={settings} onDirtyChange={setImageSettingsDirty} />
          : settingsTab === 'speech' ? <SpeechSettingsPanel bookId={book?.id} settings={settings} scope={isBookSettings ? 'book' : 'defaults'} onChange={(speech) => update('speech', speech)} />
          : settingsTab === 'sync' ? <SyncSettingsPanel />
          : <SettingsPlaceholder tab={settingsTab} scope={isBookSettings ? 'book' : 'defaults'} />}
      </section>
    </main>
  )
}

const aiSections = [['connection', 'Connection'], ['models', 'Models'], ['prompts', 'Prompts']] as const

const contextSections: ReadonlyArray<readonly [ContextSection, string]> = [
  ['scene', 'Story'],
  ['codex', 'Codex'],
  ['chat', 'Chat'],
  ['summary', 'Summary'],
  ['note', 'Note'],
]


function SummaryRequestPreview({ request, source, error, hasCurrentSummary, model, modelContextLength }: {
  request: NormalizedAssembledRequest | null
  source: SummarySource | null
  error: string
  hasCurrentSummary: boolean
  model: string
  modelContextLength?: number
}) {
  const diagnostics = request && model.trim()
    ? generationContextDiagnostics(model.trim(), modelContextLength, '', normalizedRequestDiagnosticText(request))
    : null
  const exactPreview = request?.providerMessages.map((message) => `${message.role.toUpperCase()}:\n\n${message.content || '[empty]'}`).join('\n\n---\n\n') ?? ''
  return <section className="settings-card context-preview-card summary-request-preview">
    <div className="card-heading"><div><span>04</span><h2>Summary request preview</h2></div><p>{model.trim() ? `Model: ${model.trim()}. ` : ''}Exact normalized request for the open Summary.</p></div>
    {error ? <p className="context-preview-error" role="alert">{error}</p> : !hasCurrentSummary ? <p className="context-preview-empty">Open a Scene, Chapter, Act, or Codex Summary to preview its authoritative source and complete request.</p> : !request || !source ? <p className="context-preview-empty">Preparing authoritative Summary source…</p> : <>
      {diagnostics && <div className={`context-budget ${!diagnostics.fits ? 'over' : diagnostics.warning ? 'warning' : ''}`}><strong>{diagnostics.requestTokens.toLocaleString()} estimated input tokens · {Math.round(diagnostics.usageRatio * 100)}% of usable budget</strong><span>Effective limit: {diagnostics.effectiveContextTokens.toLocaleString()} · Response reserve: {diagnostics.responseReserveTokens.toLocaleString()}</span>{!diagnostics.fits && <small>Over the usable budget. Generation will be refused; Arc will not trim authoritative source material.</small>}</div>}
      <div className="codex-context-representations"><strong>Authoritative source construction</strong>{source.diagnostics.map((item, index) => <span key={`${item.sourceId}-${index}`}><b>{item.title || item.sourceId}</b><em>{item.representation || item.type || 'Source'}{item.reason ? ` · ${item.reason}` : ''}</em></span>)}</div>
      <div className="context-budget"><strong>Likely reusable prefix: {likelyReusablePrefix(request.parts, (name) => promptVariables.find((variable) => variable.name === name)?.stability).partCount} message(s)</strong><span>Reuse stops before the first message that references turn-dynamic target data.</span></div>
      <div className="context-preview-rendered">{request.parts.map((part) => <section key={part.id} className={part.omitted ? 'omitted' : ''}><header><h3>{part.name || part.sourceId || part.id}</h3><span>{part.role?.toUpperCase() ?? 'NO ROLE'} · {part.ownership} · {part.sourceKind}{part.omitted ? ' · omitted' : ''}</span></header>{part.content ? <div className="context-preview-copy">{part.content}</div> : <p className="context-preview-empty">This message is empty.</p>}{part.referencedVariables.length ? <p className="context-preview-empty">References: {part.referencedVariables.map((reference) => `{{${reference}}}`).join(', ')}</p> : null}{part.dynamicVariables?.length ? <ul>{part.dynamicVariables.flatMap((item) => item.sources.map((value) => <li key={`${part.id}-${item.variable}-${value.sourceId}`}>{item.variable}: {value.title || value.sourceId} · {value.representation || value.type}</li>))}</ul> : null}</section>)}</div>
      <Disclosure className="context-preview-raw" title="View message stack"><pre>{exactPreview}</pre></Disclosure>
    </>}
  </section>
}

function PredefinedMessages({ scope = 'story', messages, previewValues, onChange }: { scope?: PromptCompositionScope; messages: PredefinedMessage[]; previewValues?: Record<string, string>; onChange: (messages: PredefinedMessage[]) => void }) {
  const [deletedMessage, setDeletedMessage] = useState<{ message: PredefinedMessage; index: number } | null>(null)
  const updateMessage = (id: string, patch: Partial<PredefinedMessage>) => onChange(messages.map((message) => message.id === id ? { ...message, ...patch } : message))
  const moveMessage = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= messages.length) return
    const next = [...messages]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }
  const scopeLabel = scope === 'story' ? 'Story' : scope === 'lore' ? 'Codex' : scope === 'summarize' ? 'Summary' : 'Chat'
  return <section className="story-predefined" aria-label={`${scopeLabel} predefined messages`}>
    <header><div><strong>Predefined messages</strong><span>Sent in this order between the System prompt and {scope === 'assistant' ? 'real Chat history' : 'Arc’s current instruction'}.</span></div><button type="button" onClick={() => onChange([...messages, makePredefinedMessage({ name: 'New message', role: 'user' })])}><Plus aria-hidden="true" /> Add message</button></header>
    {deletedMessage && <div className="message-undo" role="status">Message deleted<button type="button" onClick={() => { const next = [...messages]; next.splice(Math.min(deletedMessage.index, next.length), 0, deletedMessage.message); onChange(next); setDeletedMessage(null) }}>Undo</button></div>}
    {messages.map((message, index) => {
      const diagnostics = promptTemplateDiagnostics(message.template, scope, previewValues)
      const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
      return <article key={message.id} className={!message.enabled ? 'disabled' : ''}>
        <div className="story-message-toolbar">
          <label><span>Name</span><input value={message.name ?? ''} onChange={(event) => updateMessage(message.id, { name: event.target.value })} placeholder="Optional label" /></label>
          <label><span>Role</span><select value={message.role} onChange={(event) => updateMessage(message.id, { role: event.target.value as PredefinedMessage['role'] })}><option value="system">System</option><option value="user">User</option><option value="assistant">Assistant</option></select></label>
          <label className="story-message-enabled"><input type="checkbox" checked={message.enabled} onChange={(event) => updateMessage(message.id, { enabled: event.target.checked })} /><span>Enabled</span></label>
          <div className="story-message-actions"><button type="button" disabled={index === 0} onClick={() => moveMessage(index, -1)} aria-label={`Move ${message.name || 'message'} up`}>↑</button><button type="button" disabled={index === messages.length - 1} onClick={() => moveMessage(index, 1)} aria-label={`Move ${message.name || 'message'} down`}>↓</button><button type="button" onClick={() => { setDeletedMessage({ message, index }); onChange(messages.filter((candidate) => candidate.id !== message.id)) }} aria-label={`Delete ${message.name || 'message'}`}><Trash2 aria-hidden="true" /></button></div>
        </div>
        <PromptTemplateEditor value={message.template} diagnostics={diagnostics} ariaLabel={`${message.name || `${scopeLabel} message ${index + 1}`} template`} onChange={(template) => updateMessage(message.id, { template })} />
        <small className={errors.length ? 'story-message-error' : ''}>{errors.length ? `${errors.length} error${errors.length === 1 ? '' : 's'} — generation is blocked` : message.enabled ? `Message ${index + 1} · ${message.role}` : `Message ${index + 1} · omitted while disabled`}</small>
      </article>
    })}
    {!messages.length && <p>No predefined messages. Only the System prompt and Arc’s current instruction will be sent.</p>}
  </section>
}

function ContextSaveStatus({ saved, error, onRetry }: { saved: boolean; error: string; onRetry: () => void }) {
  return <div className={`context-save-status ${error ? 'error' : ''}`} role="status" aria-live="polite"><span>{error ? 'Save failed' : saved ? 'Saved' : 'Saving…'}</span>{error && <><small>{error}</small><Button size="small" onClick={onRetry}>Retry saving</Button></>}</div>
}

function SummaryContextSettings({ book, source, error, settings }: { book: NonNullable<AiSettingsProps['book']>; source: SummarySource | null; error: string; settings: AiSettings }) {
  const summary = book.currentSummary!
  const metadata = { ...(book.promptValues ?? { title: book.title, series: '', seriesOrder: '', overview: '', genre: '', style: '', pov: '', tense: '', language: '' }), responseLength: settings.responseLengths.summary }
  const request = source ? assembleSummaryGenerationRequest({ composition: settings.promptCompositions.summarize, book: metadata, responseLength: settings.responseLengths.summary, summary: { id: summary.id, content: source.previousSummary ?? '' }, target: { id: source.source.id, type: source.source.type, title: source.source.title, source: source.content }, sourceDiagnostics: source.diagnostics }) : null
  const promptErrors = [settings.promptCompositions.summarize.systemPrompt, ...settings.promptCompositions.summarize.predefinedMessages.filter(message => message.enabled).map(message => message.template)].flatMap(template => promptTemplateDiagnostics(template, 'summarize')).filter(diagnostic => diagnostic.severity === 'error')
  const diagnostics = request && settings.supportModel.trim() && !promptErrors.length ? generationContextDiagnostics(settings.supportModel, settings.supportModelContextLength, '', normalizedRequestDiagnosticText(request)) : null
  return <section className="context-defaults-settings"><header className="page-heading"><div><p>Summary source</p><h1 id="page-title">Summary context</h1><span>{source?.source.title || 'Loading source…'} · {book.title} · Read-only</span></div></header>
    <p className="context-scope-banner">Summary generation builds its source from the entity being summarized. Story, Codex, and Chat selections do not change this source.</p>
    <ContextBudget diagnostics={diagnostics} model={settings.supportModel} pending={!source && !error} error={error || promptErrors.map(item => item.message).join(' ')} />
    <section className="settings-card"><h2>Source material</h2><p className="context-help">Scenes and Codex entries use their full body. Chapters and Acts use current child summaries where available, with full-source fallbacks for missing or outdated summaries.</p>{source?.diagnostics.map((item, index) => <article className="context-source-row" key={`${item.sourceId}-${index}`}><strong>{item.title || 'Untitled'}</strong><span>{item.representation}</span><small>{item.reason?.replace(/#77 hierarchy/g, 'summary hierarchy')}</small></article>)}{source && !source.diagnostics.length && <p>No child source material is available.</p>}</section>
    <Disclosure className="settings-card context-inspector" title="Inspect summary request"><SummaryRequestPreview request={request} source={source} error={error} hasCurrentSummary model={settings.supportModel} modelContextLength={settings.supportModelContextLength} /></Disclosure>
  </section>
}

function GlobalContextDefaults({ value, saved, saveError, onRetry, onChange }: { value: BookContextSettings; saved: boolean; saveError: string; onRetry: () => void; onChange: (value: BookContextSettings) => void }) {
  return <section className="context-defaults-settings">
    <header className="page-heading"><div><p>Default Context</p><h1 id="page-title">Context defaults</h1><span>Copied into new books. Existing books keep their own Context settings.</span></div><ContextSaveStatus saved={saved} error={saveError} onRetry={onRetry} /></header>
    <section className="settings-card context-defaults-card"><div className="card-heading"><div><span>01</span><h2>Automatic Codex</h2></div></div>
      <Input className="context-trigger-window" label="Previous Scenes to scan for Codex triggers" description="The current Scene is included in addition to this many immediately previous Scenes. 0 means current Scene only." type="number" min="0" step="1" value={value.previousScenesForCodexTriggers} onChange={(event) => onChange({ ...value, previousScenesForCodexTriggers: Math.max(0, Math.floor(Number(event.target.value) || 0)) })} />
    </section>
  </section>
}

function NoteContextPlaceholder() {
  return <section className="compact-settings-empty" aria-labelledby="page-title">
    <MessageCircle aria-hidden="true" />
    <h1 id="page-title">Note context</h1>
    <p>Notes have no direct generation settings. Use Chat to create or revise a note, and choose its context in that conversation. Notes can also be selected as additional context for Story, Codex, and Chat.</p>
  </section>
}

function SummaryContextPlaceholder() {
  return <section className="compact-settings-empty" aria-labelledby="page-title">
    <SlidersHorizontal aria-hidden="true" />
    <h1 id="page-title">Summary context</h1>
    <p>Summary context is assembled automatically from the item being summarized. Open a Summary to inspect its authoritative source and request preview.</p>
  </section>
}

function ContextSettings({ bookId, bookTitle, bookPromptValues, type, currentDocumentId, currentDocumentText, insertionPosition, chatId, settings, value, sources, saved, saveError, onRetry, onChange }: { bookId: string; bookTitle: string; bookPromptValues?: BookPromptValues; type: Exclude<GenerationContextType, 'note'>; currentDocumentId?: string; currentDocumentText?: string; insertionPosition?: number; chatId?: string; settings: AiSettings; value: BookContextSettings; sources: ArcEntity[]; saved: boolean; saveError: string; onRetry: () => void; onChange: (value: BookContextSettings) => void }) {
  const [previewPending, setPreviewPending] = useState(true)
  const [preview, setPreview] = useState<PreparedContextValues | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [previewChat, setPreviewChat] = useState<ChatEntity | null>(null)
  const [previewCharacter, setPreviewCharacter] = useState<CharacterFrame>()
  const [previewHistory, setPreviewHistory] = useState<ChatMessageEntity[]>([])
  const profile = value.profiles[type]
  const updateProfile = (next: typeof profile) => onChange({ ...value, profiles: { ...value.profiles, [type]: next } })
  const toggle = (key: 'structuralIds' | 'noteIds' | 'codexEntryIds', id: string) => updateProfile({ ...profile, [key]: profile[key].includes(id) ? profile[key].filter((item) => item !== id) : [...profile[key], id] })
  const archivedSelectedCodex = sources.filter((item) => item.type === 'codexEntry' && isCodexEntryArchived(item) && profile.codexEntryIds.includes(item.id))
  const archivedSelectedIds = new Set(archivedSelectedCodex.map((item) => item.id))
  useEffect(() => {
    let cancelled = false
    setPreviewPending(true)
    setPreview(null)
    setPreviewError('')
    const currentSceneId = type === 'scene' ? currentDocumentId : value.lastOpenedSceneId || undefined
    ;(async () => {
      try {
        let chat: ChatEntity | null = null
        let history: ChatMessageEntity[] = []
        if (type === 'chat' && chatId) {
          const [loadedChat, loadedHistory] = await Promise.all([getChat(chatId), listChatMessages(bookId, chatId)])
          chat = loadedChat ?? null
          history = loadedHistory
        }
        if (!cancelled) setPreviewChat(chat)
        const character = chat?.character ? await captureCharacterFrame(chat, history, profile) : undefined
        const prepared = character?.context ?? await buildContextValues({ bookId, type, currentSceneId, currentSceneText: type === 'scene' ? currentDocumentText : undefined, currentDocumentId, previousScenesForCodexTriggers: value.previousScenesForCodexTriggers, profile })
        if (!cancelled) {
          setPreviewCharacter(character)
          setPreviewPending(false)
          setPreview(prepared)
          setPreviewChat(chat)
          setPreviewHistory(history)
          setPreviewError(type === 'chat' && !chatId ? 'Open a chat to preview its request.' : '')
        }
      } catch (error) {
        if (!cancelled) {
          setPreviewPending(false)
          setPreview(null)
          setPreviewCharacter(undefined)
          setPreviewHistory([])
          setPreviewError(error instanceof Error ? error.message : 'Request preview could not be prepared.')
        }
      }
    })()
    return () => { cancelled = true }
  }, [bookId, chatId, currentDocumentId, currentDocumentText, profile, sources, type, value.lastOpenedSceneId, value.previousScenesForCodexTriggers])

  const currentDocument = sources.find((item) => item.id === currentDocumentId)
  const anchor = sources.find(item => item.id === (type === 'scene' ? currentDocumentId : previewChat?.character?.cutoff.sceneId ?? value.lastOpenedSceneId) && item.type === 'scene')
  const anchorLabel = anchor?.title || 'No reference scene'
  const scopeLabel = type === 'chat' ? (chatId ? 'This chat only' : 'Chat defaults for this book') : type === 'scene' ? 'All scenes in this book' : 'All Codex entries in this book'
  const responseLength = type === 'codex' ? settings.responseLengths.codex : type === 'scene' ? settings.responseLengths.story : ''
  const metadata: BookPromptValues = { ...(bookPromptValues ?? { title: bookTitle, series: '', seriesOrder: '', overview: '', genre: '', style: '', pov: '', tense: '', language: '' }), responseLength }
  const typeLabel = type === 'scene' ? 'Story' : type === 'codex' ? 'Codex' : 'Chat'
  const previewPromptScope = type === 'scene' ? 'story' : type === 'codex' ? 'lore' : 'assistant'
  const previewComposition = type === 'chat' ? previewChat?.promptComposition : settings.promptCompositions[previewPromptScope]
  const previewPromptDiagnostics = previewComposition
    ? [previewComposition.systemPrompt, ...previewComposition.predefinedMessages.filter((message) => message.enabled).map((message) => message.template)]
      .flatMap((template) => promptTemplateDiagnostics(template, previewPromptScope, bookTemplateValues(metadata)))
    : []
  const previewPromptErrors = previewPromptDiagnostics.filter((diagnostic) => diagnostic.severity === 'error')
  const requestMessages: RequestPreviewMessage[] = []
  let storyNormalizedRequest: NormalizedAssembledRequest | null = null
  let codexNormalizedRequest: NormalizedAssembledRequest | null = null
  let chatNormalizedRequest: NormalizedAssembledRequest | null = null

  if (preview && type === 'scene') {
    storyNormalizedRequest = assembleStoryGenerationRequest({
      composition: settings.promptCompositions.story,
      book: metadata,
      sceneText: currentDocumentText ?? String(currentDocument?.content ?? preview.currentSceneText),
      insertionPosition: insertionPosition ?? (currentDocumentText ?? String(currentDocument?.content ?? preview.currentSceneText)).length,
      sceneOverrides: sceneWritingValues(currentDocument),
      context: preview,
      responseLength: settings.responseLengths.story,
      instruction: '',
    })
    storyNormalizedRequest.parts.forEach((part, index) => requestMessages.push({
      key: part.id,
      role: part.role ?? 'user',
      title: part.name || (part.sourceKind === 'current-turn' ? 'Current instruction' : `Message ${index + 1}`),
      detail: `${part.role?.toUpperCase() ?? 'NO ROLE'} · ${part.sourceKind}${part.omitted ? ' · omitted' : ''}`,
      content: part.content,
      omitted: part.omitted,
      references: part.referencedVariables,
      diagnostics: part.dynamicVariables?.flatMap((item) => item.sources.map((source) => `${item.variable}: ${source.title || source.sourceId}${source.representation ? ` · ${source.representation}` : ''}${source.reason ? ` · ${source.reason}` : ''}`)),
    }))
  }

  if (preview && type === 'codex') {
    const entryContent = currentDocumentText ?? String(currentDocument?.content ?? '')
    codexNormalizedRequest = assembleCodexGenerationRequest({
      composition: settings.promptCompositions.lore,
      book: metadata,
      responseLength: settings.responseLengths.codex,
      entry: {
        id: currentDocument?.id ?? currentDocumentId ?? 'current-codex-entry',
        title: currentDocument?.title ?? '',
        category: typeof currentDocument?.category === 'string' ? currentDocument.category : '',
        typeId: typeof currentDocument?.typeId === 'string' ? currentDocument.typeId : '',
        content: entryContent,
      },
      insertionPosition: insertionPosition ?? entryContent.length,
      context: preview,
      instruction: '',
    })
    codexNormalizedRequest.parts.forEach((part, index) => requestMessages.push({
      key: part.id,
      role: part.role ?? 'user',
      title: part.name || (part.sourceKind === 'current-turn' ? 'Current instruction' : `Message ${index + 1}`),
      detail: `${part.role?.toUpperCase() ?? 'NO ROLE'} · ${part.ownership} · ${part.sourceKind}${part.omitted ? ' · omitted' : ''}`,
      content: part.content,
      omitted: part.omitted,
      references: part.referencedVariables,
      diagnostics: part.dynamicVariables?.flatMap((item) => item.sources.map((source) => `${item.variable}: ${source.title || source.sourceId}${source.representation ? ` · ${source.representation}` : ''}${source.reason ? ` · ${source.reason}` : ''}`)),
    }))
  }

  if (preview && type === 'chat' && previewChat) {
    chatNormalizedRequest = assembleChatGenerationRequest({ composition: previewChat.promptComposition, book: metadata, context: preview, history: previewHistory, restrictedInstructions: previewCharacter?.instructions, tools: availableChatTools(Boolean(previewChat.character), previewHistory) })
    chatNormalizedRequest.parts.forEach((part, index) => requestMessages.push({
      key: part.id,
      role: part.role ?? 'user',
      title: part.name || `Message ${index + 1}`,
      detail: `${part.role?.toUpperCase() ?? 'NO ROLE'} · ${part.ownership} · ${part.sourceKind}${part.omitted ? ' · omitted' : ''}`,
      content: part.content,
      omitted: part.omitted,
      references: part.referencedVariables,
      diagnostics: part.dynamicVariables?.flatMap((item) => item.sources.map((source) => `${item.variable}: ${source.title || source.sourceId}${source.representation ? ` · ${source.representation}` : ''}${source.reason ? ` · ${source.reason}` : ''}`)),
      reasoning: part.providerMessage?.reasoning_content,
    }))
  }

  const normalizedRequest = storyNormalizedRequest ?? codexNormalizedRequest ?? chatNormalizedRequest
  const providerPreviewMessages = normalizedRequest?.providerMessages ?? requestMessages.filter((message) => !message.omitted).map((message) => ({ role: message.role, content: message.content }))
  const exactPreview = providerPreviewMessages.map((message) => `${message.role.toUpperCase()}:\n\n${message.content || '[empty]'}`).join('\n\n---\n\n')
  const selectedModel = type === 'codex' ? settings.codexModel.trim() || settings.mainModel.trim() : type === 'chat' ? previewChat?.model.trim() : settings.mainModel.trim()
  const selectedModelContextLength = type === 'codex'
    ? (settings.codexModel.trim() ? settings.codexModelContextLength : settings.mainModelContextLength)
    : type === 'chat' ? previewChat?.modelContextLength : settings.mainModelContextLength
  const effectiveLimitInput = type === 'codex'
    ? (settings.codexModel.trim() ? settings.codexEffectiveContextLimit : settings.mainEffectiveContextLimit)
    : type === 'chat' ? previewChat?.effectiveContextLimit ?? '' : settings.mainEffectiveContextLimit
  const diagnosticMessages = normalizedRequest?.providerMessages ?? requestMessages.filter((message) => !message.omitted).map((message) => ({ role: message.role, content: message.content || null, ...(message.reasoning ? { reasoning_content: message.reasoning } : {}) }))
  const diagnostics = selectedModel && requestMessages.length && !previewPromptErrors.length
    ? generationContextDiagnostics(selectedModel, selectedModelContextLength, effectiveLimitInput, type === 'chat' && chatNormalizedRequest ? finalizeChatProviderRequest(chatNormalizedRequest).diagnosticText : JSON.stringify({ messages: diagnosticMessages }))
    : null

  return <section className="context-defaults-settings">
    <header className="page-heading"><div><p>{typeLabel} generation</p><h1 id="page-title">{typeLabel} context</h1><span>{scopeLabel} · {bookTitle}</span></div><ContextSaveStatus saved={saved} error={saveError} onRetry={onRetry} /></header>
    <div className="context-scope-banner"><strong>Previewing: {type === 'chat' ? previewChat?.title || 'Chat' : currentDocument?.title || 'No document selected'}</strong><span>Reference scene: {anchorLabel}</span>{type !== 'scene' && !previewChat?.character && <small>Opening another scene changes the reference scene for Chat and Codex. {type === 'codex' && !profile.includeLastScene ? 'Story context is off; Codex trigger scanning still uses this scene.' : ''}</small>}</div>
    <ContextBudget diagnostics={diagnostics} model={selectedModel} pending={previewPending} error={previewError || (previewPromptErrors.length ? 'Fix the prompt errors before generating.' : '')} />
    {previewChat?.character && <p className="context-help">Each participant’s full Codex profile is always included. Automatic manuscript context follows the chat’s story position. Add Codex entries, notes, manuscript sections or summaries below; selected references are sent with every reply, including in existing chats.</p>}
    {!previewChat?.character && <section className="settings-card context-defaults-card"><div className="card-heading"><div><span>01</span><h2>Automatic context</h2></div></div>
      <Input className="context-trigger-window" label="Previous Scenes to scan for Codex triggers" description={`Book-wide setting. Scan “${anchorLabel}” plus this many preceding scenes. ${type === 'chat' ? 'Change this from a Scene or Codex Context tab; it is read-only in Chat.' : 'Changes affect Story, Codex, and Chat in this book.'}`} type="number" min="0" step="1" disabled={type === 'chat'} value={value.previousScenesForCodexTriggers} onChange={(event) => onChange({ ...value, previousScenesForCodexTriggers: Math.max(0, Math.floor(Number(event.target.value) || 0)) })} />
      {archivedSelectedCodex.length > 0 && <div className="context-inactive-source"><div><strong>{archivedSelectedCodex.length} archived Codex {archivedSelectedCodex.length === 1 ? 'selection is' : 'selections are'} inactive</strong><small>{archivedSelectedCodex.map((item) => item.title ?? 'Untitled').join(', ')}. Archived lore is skipped from requests.</small></div><Button size="small" variant="danger" onClick={() => updateProfile({ ...profile, codexEntryIds: profile.codexEntryIds.filter((id) => !archivedSelectedIds.has(id)) })}>Remove inactive</Button></div>}
      <div className="context-default-locked"><Check aria-hidden="true" /><span><strong>Book metadata</strong><small>Provided through the book prompt variables.</small></span><b>Available</b></div>
      {type === 'scene' ? <><div className="context-default-locked"><Check aria-hidden="true" /><span><strong>Current Scene</strong><small>The active editor content is available to the Story prompt. See Included sources below for what this template sends.</small></span><b>Available</b></div><Checkbox label="Previous Scene when empty" description="Use the immediately previous Scene only when the current Scene has no text." checked={profile.includePreviousSceneWhenEmpty} onChange={(event) => updateProfile({ ...profile, includePreviousSceneWhenEmpty: event.target.checked })} /><div className="context-default-locked"><Check aria-hidden="true" /><span><strong>Earlier summaries</strong><small>Uses the highest completed Act or Chapter summary without exposing later material.</small></span><b>Automatic</b></div></> : type === 'codex' ? <><div className="context-default-locked"><Check aria-hidden="true" /><span><strong>Current entry</strong><small>Title, category, full body, and the captured insertion point are available through <code>entry.*</code> variables.</small></span><b>Available</b></div><Checkbox label={`Story context from ${anchorLabel}`} description="Use the Book’s last-opened Scene and earlier story summaries as the Codex story anchor." checked={profile.includeLastScene} onChange={(event) => updateProfile({ ...profile, includeLastScene: event.target.checked })} /><Checkbox label="Previous Scene when anchor is empty" description="Use the immediately previous Scene as the full anchor without duplicating its summary." checked={profile.includePreviousSceneWhenEmpty} onChange={(event) => updateProfile({ ...profile, includePreviousSceneWhenEmpty: event.target.checked })} disabled={!profile.includeLastScene} /></> : <><div className="context-default-locked"><Check aria-hidden="true" /><span><strong>{anchorLabel} and earlier summaries</strong><small>Available through Chat composition variables from the book's last-opened Scene anchor.</small></span><b>Automatic</b></div><Checkbox label="Previous Scene when empty" description="Expose the immediately previous Scene only when the anchor Scene has no text." checked={profile.includePreviousSceneWhenEmpty} onChange={(event) => updateProfile({ ...profile, includePreviousSceneWhenEmpty: event.target.checked })} /></>}
    </section>}
    <ContextSourceInventory preview={preview} request={normalizedRequest} sources={sources} pending={previewPending} />
    <section className="settings-card context-sources-card"><div className="card-heading"><div><span>02</span><h2>Additional context</h2></div><p>{previewChat?.character ? 'Selected references are included automatically.' : <>Available as <code>{'{{context.additional}}'}</code>.</>}</p></div>
      {previewChat?.character && <p className="context-help">Your selections can include material outside the story position. Removing a selection affects future requests; it does not erase earlier conversation messages.</p>}
      {type !== 'scene' && <Checkbox label="Resolve Codex at the reference scene" description={previewChat?.character ? 'Selected Codex entries use their full body at the story position. Off uses their full baseline body. Automatic character profiles continue to follow the story position.' : 'Uses eligible checkpoint bodies and their matching summaries. Off uses baseline lore for unrestricted author planning.'} checked={profile.loreAtCurrentScene === true} onChange={event => updateProfile({ ...profile, loreAtCurrentScene: event.target.checked })} />}
      <RadioGroup label="Additional summaries" name={`summary-range-${type}`} value={profile.summaryRange} onChange={range => updateProfile({ ...profile, summaryRange: range as typeof profile.summaryRange })} options={[{ value: 'none', label: 'None' }, { value: 'all', label: 'All summaries' }, { value: 'before', label: `Before ${anchorLabel}`, disabled: !anchor }, { value: 'after', label: `After ${anchorLabel}`, disabled: !anchor }]} />
      <p className="context-help">None turns off additional summaries only. Automatic earlier-story summaries stay available. {(!anchor && (profile.summaryRange === 'before' || profile.summaryRange === 'after')) && 'Open a scene to resolve this range.'}</p>
      {(profile.summaryRange === 'all' || profile.summaryRange === 'after') && <p className="context-caution" role="status">This range can include material later than the reference scene.</p>}
      <ContextSourcePicker sources={sources} currentDocumentId={type === 'chat' ? undefined : currentDocumentId} anchorId={anchor?.id} profile={profile} fullCodex={Boolean(previewChat?.character)} onToggle={toggle} onClear={() => updateProfile({ ...profile, structuralIds: [], noteIds: [], codexEntryIds: [] })} />
    </section>
    <Disclosure className="settings-card context-inspector" eyebrow="04" title="Inspect request" description={`${selectedModel ? `Model: ${selectedModel}. ` : ''}Rendered message stack for the current ${typeLabel.toLowerCase()} request.`}>
      {type !== 'chat' && <p className="context-preview-empty">The generation instruction below shows the fallback used when the generation drawer is empty. Custom drawer text replaces it when you generate.</p>}
      {type === 'scene' && <p className="context-preview-empty">Captured generation point: {(insertionPosition ?? currentDocumentText?.length ?? 0).toLocaleString()} of {(currentDocumentText?.length ?? 0).toLocaleString()} characters. Empty instruction fallback: “{STORY_CONTINUE_FALLBACK}”</p>}
      {type === 'codex' && <p className="context-preview-empty">Captured generation point: {(insertionPosition ?? currentDocumentText?.length ?? 0).toLocaleString()} of {(currentDocumentText?.length ?? 0).toLocaleString()} characters. Empty instruction fallback: “{CODEX_CONTINUE_FALLBACK}”</p>}
      {(type === 'scene' || type === 'codex') && <p className="context-preview-empty">Automatic and Additional sources are deduplicated by stable source identity; matching text is never used as identity.</p>}
      {previewError ? <p className="context-preview-error" role="alert">{previewError}</p> : preview ? <>
        {previewPromptErrors.length > 0 && <div className="context-preview-error" role="alert"><strong>Request blocked by an invalid {previewPromptScope} prompt.</strong><ul>{previewPromptErrors.map((diagnostic, index) => <li key={`${diagnostic.code}-${diagnostic.from}-${index}`}>{diagnostic.message}</li>)}</ul></div>}
        {diagnostics && <div className={`context-budget ${!diagnostics.limitValid || !diagnostics.fits ? 'over' : diagnostics.warning ? 'warning' : ''}`}><strong>{diagnostics.limitValid ? `${diagnostics.requestTokens.toLocaleString()} estimated input tokens · ${Math.round(diagnostics.usageRatio * 100)}% of usable budget` : 'Invalid effective context cap'}</strong><span>Effective limit: {diagnostics.effectiveContextTokens.toLocaleString()} · Response reserve: {diagnostics.responseReserveTokens.toLocaleString()} · {diagnostics.modelContextKnown ? `Model hard window: ${diagnostics.modelContextTokens.toLocaleString()}` : `Model window estimate: ${diagnostics.modelContextTokens.toLocaleString()}`}</span>{diagnostics.wasClamped && <small>Your configured cap is above the model hard maximum, so Arc uses the model maximum.</small>}{diagnostics.limitError && <small>{diagnostics.limitError}</small>}{diagnostics.warning && diagnostics.fits && <small>Near the limit. Consider summaries, deselecting full-text context, or raising the cap.</small>}{!diagnostics.fits && diagnostics.limitValid && <small>Over the usable budget. Generation will be refused; Arc will not trim or replace context automatically.</small>}</div>}
        {preview.automaticCodex.length > 0 && <div className="automatic-codex-preview"><strong>Automatic Codex</strong>{preview.automaticCodex.map((item) => <article key={item.entryId} className={item.source === 'dependency' ? 'dependency-cascade' : 'trigger-match'}><header><b>{item.title}</b><small>{item.source === 'dependency' ? 'Dependency cascade' : 'Direct trigger'} · {item.representation === 'Summary' ? 'Summary' : 'Full entry'}{item.fallbackReason ? ` · ${item.fallbackReason}` : ''}</small></header>{item.source === 'dependency' ? <p>Dependency path: {(item.dependencyPath ?? []).map((step) => step.title).join(' → ')}</p> : <ul>{item.matches.map((match, index) => <li key={`${item.entryId}-${match.sceneId}-${match.trigger}-${index}`}><code>{match.trigger}</code> · {match.sceneTitle}</li>)}</ul>}</article>)}</div>}
        {preview.codexRepresentations.length > 0 && <div className="codex-context-representations"><strong>Codex context representation</strong>{preview.codexRepresentations.map((item) => <span key={item.entryId}><b>{item.title}</b><em>{item.representation}{item.fallbackReason ? ` · ${item.fallbackReason}` : ''}</em></span>)}</div>}
        {normalizedRequest?.dynamicSourceDedupe.length ? <div className="codex-context-representations"><strong>Deduplicated Additional sources</strong>{normalizedRequest.dynamicSourceDedupe.map((decision) => <span key={decision.sourceId}><b>{decision.omittedAdditional.title || decision.sourceId}</b><em>Omitted because this source is already represented automatically{decision.automatic.representation ? ` as ${decision.automatic.representation}` : ''}.</em></span>)}</div> : null}
        {normalizedRequest?.dynamicSourceExclusions.length ? <div className="codex-context-representations"><strong>Excluded current target</strong>{normalizedRequest.dynamicSourceExclusions.map((decision, index) => <span key={`${decision.sourceId}-${index}`}><b>{decision.omitted.title || decision.sourceId}</b><em>Omitted because the current Codex target is represented through entry variables.</em></span>)}</div> : null}
        {normalizedRequest && <div className="context-budget"><strong>Likely reusable prefix: {likelyReusablePrefix(normalizedRequest.parts, (name) => promptVariables.find((variable) => variable.name === name)?.stability).partCount} message(s)</strong><span>Reuse stops before the first message that references turn-dynamic data.</span></div>}
        {chatNormalizedRequest?.structuredParts.map((part) => <Disclosure className="context-preview-raw" key={part.id} title={part.name || 'Structured request data'} description="App managed"><pre>{JSON.stringify(part.value, null, 2)}</pre></Disclosure>)}
        {type === 'scene' && <section className="context-preview-rendered"><h3>Effective scene writing settings</h3>{Object.entries(resolveSceneWriting(metadata, sceneWritingValues(currentDocument))).map(([key, item]) => <p key={key}>{key}: {item.value || 'Not set'} · {item.origin}</p>)}</section>}
        <div className="context-preview-rendered">{requestMessages.map((message) => <section key={message.key} className={message.omitted ? 'omitted' : ''}><header><h3>{message.title}</h3><span>{message.detail}</span></header>{message.content ? <div className="context-preview-copy">{message.content}</div> : <p className="context-preview-empty">This message is empty.</p>}{message.references?.length ? <p className="context-preview-empty">References: {message.references.map((reference) => `{{${reference}}}`).join(', ')}</p> : null}{message.diagnostics?.length ? <ul>{message.diagnostics.map((diagnostic) => <li key={diagnostic}>{diagnostic}</li>)}</ul> : null}{message.reasoning && <div className="context-preview-copy"><strong>Reasoning</strong>\n\n{message.reasoning}</div>}</section>)}</div>
        <Disclosure className="context-preview-raw" title="View message stack"><pre>{exactPreview || '[No messages would be sent yet.]'}</pre></Disclosure>
      </> : <p className="context-preview-empty">Preparing preview…</p>}
    </Disclosure>
  </section>
}

function SpeechSettingsPanel({ bookId, settings, scope, onChange }: { bookId?: string; settings: AiSettings; scope: 'book' | 'defaults'; onChange: (speech: AiSettings['speech']) => void }) {
  const [models, setModels] = useState<SpeechModel[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [sttModels, setSttModels] = useState<SttModel[]>([])
  const [sttLoading, setSttLoading] = useState(false)
  const [sttMessage, setSttMessage] = useState('')
  const latestSpeechRef = useRef(settings.speech)
  const ttsLoadSequenceRef = useRef(0)
  const ttsLoadControllerRef = useRef<AbortController | null>(null)
  const sttLoadSequenceRef = useRef(0)
  const sttLoadControllerRef = useRef<AbortController | null>(null)
  latestSpeechRef.current = settings.speech
  const selected = models.find((model) => model.id === settings.speech.model)
  const selectedStt = sttModels.find((model) => model.id === settings.speech.transcriptionModel)
  const voices = selected?.voices ?? []

  function invalidateTtsLoad() {
    ttsLoadSequenceRef.current += 1
    ttsLoadControllerRef.current?.abort()
    ttsLoadControllerRef.current = null
    setLoading(false)
  }

  function invalidateSttLoad() {
    sttLoadSequenceRef.current += 1
    sttLoadControllerRef.current?.abort()
    sttLoadControllerRef.current = null
    setSttLoading(false)
  }

  async function loadModels() {
    const speechSnapshot = latestSpeechRef.current
    ttsLoadControllerRef.current?.abort()
    const requestId = ++ttsLoadSequenceRef.current
    const connectionKey = ttsCatalogConnectionKey(speechSnapshot)
    const controller = new AbortController()
    ttsLoadControllerRef.current = controller
    const ownsRequest = () => requestId === ttsLoadSequenceRef.current && ttsCatalogConnectionKey(latestSpeechRef.current) === connectionKey
    setLoading(true)
    setMessage('Loading NanoGPT audio models…')
    try {
      const next = await fetchSpeechModels(speechSnapshot.apiKey, controller.signal)
      if (!ownsRequest()) return
      setModels(next)
      setMessage(next.length ? `${next.length} text-to-speech models available.` : 'NanoGPT returned no text-to-speech models.')
    } catch (error) {
      if (!ownsRequest() || isAbortError(error)) return
      setModels([])
      setMessage(error instanceof Error ? error.message : 'Could not load NanoGPT audio models.')
    } finally {
      if (requestId === ttsLoadSequenceRef.current) {
        if (ttsLoadControllerRef.current === controller) ttsLoadControllerRef.current = null
        setLoading(false)
      }
    }
  }

  async function loadSttModels() {
    const speechSnapshot = latestSpeechRef.current
    sttLoadControllerRef.current?.abort()
    const requestId = ++sttLoadSequenceRef.current
    const connectionKey = sttCatalogConnectionKey(speechSnapshot)
    const controller = new AbortController()
    sttLoadControllerRef.current = controller
    const ownsRequest = () => requestId === sttLoadSequenceRef.current && sttCatalogConnectionKey(latestSpeechRef.current) === connectionKey
    setSttLoading(true)
    setSttMessage('Loading transcription models…')
    try {
      const next = await fetchTranscriptionModels(speechSnapshot, controller.signal)
      if (!ownsRequest()) return
      setSttModels(next)
      setSttMessage(next.length ? `${next.length} transcription models available across OpenAI and NanoGPT.` : 'No transcription models were returned.')
    } catch (error) {
      if (!ownsRequest() || isAbortError(error)) return
      setSttModels([])
      setSttMessage(error instanceof Error ? error.message : 'Could not load transcription models.')
    } finally {
      if (requestId === sttLoadSequenceRef.current) {
        if (sttLoadControllerRef.current === controller) sttLoadControllerRef.current = null
        setSttLoading(false)
      }
    }
  }

  useEffect(() => {
    void loadModels()
    void loadSttModels()
    return () => {
      ttsLoadSequenceRef.current += 1
      ttsLoadControllerRef.current?.abort()
      ttsLoadControllerRef.current = null
      sttLoadSequenceRef.current += 1
      sttLoadControllerRef.current?.abort()
      sttLoadControllerRef.current = null
    }
  }, [])

  function updateSpeech(patch: Partial<AiSettings['speech']>) {
    const current = latestSpeechRef.current
    const next = { ...current, ...patch }
    const nanoKeyChanged = next.apiKey !== current.apiKey
    const openAiKeyChanged = next.openaiApiKey !== current.openaiApiKey
    latestSpeechRef.current = next
    if (nanoKeyChanged) {
      invalidateTtsLoad()
      invalidateSttLoad()
      setModels([])
      setMessage('NanoGPT Speech credential changed. Reload the TTS model list.')
      setSttModels([])
      setSttMessage('Speech credentials changed. Reload the transcription model list.')
    } else if (openAiKeyChanged) {
      invalidateSttLoad()
      setSttModels([])
      setSttMessage('OpenAI Speech credential changed. Reload the transcription model list.')
    }
    onChange(next)
  }

  const unavailableModel = models.length > 0 && !selected
  const unavailableVoice = Boolean(selected?.voices.length && settings.speech.voice && !selected.voices.includes(settings.speech.voice))
  const unavailableStt = sttModels.length > 0 && !selectedStt
  const liveSupported = selectedStt?.supportsLive === true

  return <section className="speech-settings">
    <header className="page-heading"><div><p>{scope === 'book' ? 'Book Speech' : 'Default Speech'}</p><h1 id="page-title">Speech</h1><span>{scope === 'book' ? 'Independent TTS and dictation settings for this book.' : 'Copied into each new book, then edited independently.'}</span></div></header>
    <TtsCacheSettings bookId={bookId} />
    <section className="settings-card">
      <div className="card-heading"><div><span>01</span><h2>Speech credentials</h2></div><p>Speech credentials are separate from text AI.</p></div>
      <div className="speech-settings-grid">
        <label><span>NanoGPT Speech API key</span><div className="speech-key-row"><input type="password" value={settings.speech.apiKey} onChange={(event) => updateSpeech({ apiKey: event.target.value })} autoComplete="off" spellCheck={false} />{settings.provider === 'nanogpt' && settings.apiKey.trim() && <button type="button" onClick={() => updateSpeech({ apiKey: settings.apiKey })}>Copy NanoGPT key from AI settings</button>}</div><small className="speech-help">Used by NanoGPT TTS and NanoGPT transcription models.</small></label>
        <Input label="OpenAI Speech API key" description="Used only for OpenAI transcription. Stored with this Speech configuration on this device." type="password" value={settings.speech.openaiApiKey} onChange={(event) => updateSpeech({ openaiApiKey: event.target.value })} autoComplete="off" spellCheck={false} />
      </div>
    </section>
    <section className="settings-card">
      <div className="card-heading"><div><span>02</span><h2>Text to speech</h2></div><Button size="small" variant="ghost" onClick={() => { void loadModels() }} disabled={loading} leadingIcon={<RefreshCw className={loading ? 'spinning' : ''} aria-hidden="true" />}>{loading ? 'Loading…' : 'Reload'}</Button></div>
      {message && <p className="speech-help">{message}</p>}
      {unavailableModel && <p className="speech-model-unavailable" role="alert">Saved model “{settings.speech.model}” is unavailable. Arc will not silently switch paid models.</p>}
      <SearchableSelect label="Text-to-speech model" value={settings.speech.model} searchPlaceholder="Search TTS models" emptyText={models.length ? 'No TTS models match that search.' : 'Reload to fetch TTS models.'} description={`${models.length} text-to-speech model${models.length === 1 ? '' : 's'} available.`} options={[...(!selected && settings.speech.model ? [{ value: settings.speech.model, title: settings.speech.model, subtitle: 'Saved model is unavailable', disabled: true }] : []), ...models.map(model => ({ value: model.id, title: model.name, subtitle: model.id, meta: model.price || 'Price unavailable', badges: model.voices.length ? [`${model.voices.length} voices`] : undefined }))]} onChange={modelId => { const model = models.find(candidate => candidate.id === modelId); if (model) updateSpeech({ model: model.id, voice: model.voices.includes(settings.speech.voice) ? settings.speech.voice : model.voices[0] ?? '' }) }} />
      <div className="speech-settings-grid">
        {voices.length ? <Select label="Voice" error={unavailableVoice ? 'Choose an available voice before reading aloud.' : undefined} description={unavailableVoice ? undefined : `${voices.length} voices supplied by NanoGPT for this model.`} value={settings.speech.voice} onChange={(event) => updateSpeech({ voice: event.target.value })}>{unavailableVoice && <option value={settings.speech.voice}>{settings.speech.voice} — unavailable</option>}{voices.map((voice) => <option key={voice} value={voice}>{voice}</option>)}</Select> : <Input label="Voice" description="NanoGPT supplied no voice list; enter a provider-supported voice ID manually." value={settings.speech.voice} onChange={(event) => updateSpeech({ voice: event.target.value })} placeholder="Enter provider voice ID" />}
        <Input label="Maximum parallel TTS requests" description="Default 1. Audio may generate concurrently but always plays in prose order." type="number" min="1" max="8" value={settings.speech.maxParallelRequests} onChange={(event) => updateSpeech({ maxParallelRequests: event.target.value })} />
      </div>
      <Checkbox className="speech-toggle" label="Read aloud after generation" description="Story reads only the latest generated passage; Codex reads the resulting entry; Chat reads the new visible assistant answer." checked={settings.speech.readAloudAfterGeneration} onChange={(event) => updateSpeech({ readAloudAfterGeneration: event.target.checked })} />
    </section>
    <section className="settings-card stt-settings-card">
      <div className="card-heading"><div><span>03</span><h2>Speech to text</h2></div><Button size="small" variant="ghost" onClick={() => { void loadSttModels() }} disabled={sttLoading} leadingIcon={<RefreshCw className={sttLoading ? 'spinning' : ''} aria-hidden="true" />}>{sttLoading ? 'Loading…' : 'Reload'}</Button></div>
      <p className="speech-help">Dictation sends microphone audio only to the provider named by the selected transcription model. Raw recordings are not stored by Arc.</p>
      {sttMessage && <p className="speech-help">{sttMessage}</p>}
      {unavailableStt && <p className="speech-model-unavailable" role="alert">Saved transcription model “{settings.speech.transcriptionModel}” is unavailable in the loaded catalogs. Arc will not silently substitute another paid model.</p>}
      <SearchableSelect label="Transcription model" value={settings.speech.transcriptionModel} searchPlaceholder="Search transcription models" emptyText={sttModels.length ? 'No transcription models match that search.' : 'Reload to fetch transcription models.'} description={`${sttModels.length} transcription model${sttModels.length === 1 ? '' : 's'} available.`} options={[...(!selectedStt && settings.speech.transcriptionModel ? [{ value: settings.speech.transcriptionModel, title: settings.speech.transcriptionModel, subtitle: 'Saved model is unavailable', disabled: true }] : []), ...sttModels.map(model => ({ value: model.id, title: model.name, subtitle: `${model.provider === 'openai' ? 'OpenAI' : 'NanoGPT'} · ${model.modelId}`, meta: model.price || 'Price unavailable', badges: [model.supportsLive ? 'Live' : 'File'] }))]} onChange={modelId => { const model = sttModels.find(candidate => candidate.id === modelId); if (model) updateSpeech({ transcriptionModel: model.id, streamTranscription: model.supportsLive }) }} />
      <div className="speech-settings-grid">
        <Input label="Language hint" description="Leave empty for Auto-detect. Enter a provider-supported language code/name to provide a hint." value={settings.speech.transcriptionLanguage === 'auto' ? '' : settings.speech.transcriptionLanguage} onChange={(event) => updateSpeech({ transcriptionLanguage: event.target.value.trim() || 'auto' })} placeholder="Auto-detect" />
        <Checkbox className="speech-toggle stt-live-toggle" label="Stream text while speaking" description={liveSupported ? 'Supported by this model. Partial text stays provisional until Stop/finalization.' : selectedStt ? 'This selected model does not expose live partial transcription.' : 'Load/select a model to check live-transcription capability.'} checked={settings.speech.streamTranscription && liveSupported} disabled={!liveSupported} onChange={(event) => updateSpeech({ streamTranscription: event.target.checked })} />
      </div>
      {settings.speech.transcriptionModel.startsWith('openai:') && <p className="speech-help speech-provider-note"><Mic aria-hidden="true" /><span>OpenAI live-capable models use a direct browser Realtime connection; ordinary models record locally and upload once after Stop.</span></p>}
    </section>
  </section>
}

function SettingsPlaceholder({ tab, scope }: { tab: Exclude<SettingsTab, 'ai'>; scope: 'book' | 'defaults' }) {
  if (tab === 'appearance') return <AppearanceSettings scope={scope} />

  const content = tab === 'context'
    ? { Icon: SlidersHorizontal, title: 'Context defaults' }
    : tab === 'speech'
      ? { Icon: Volume2, title: 'Speech defaults' }
      : { Icon: ImageIcon, title: 'Image defaults' }
  const Icon = content.Icon
  return <section className="compact-settings-empty" aria-labelledby="page-title">
    <Icon aria-hidden="true" />
    <h1 id="page-title">{content.title}</h1>
    <p>{scope === 'book' ? 'Book-level controls will live here.' : 'Saved as the starting point for new books.'}</p>
  </section>
}

function AppearanceSettings({ scope }: { scope: 'book' | 'defaults' }) {
  const [textSize, setTextSize] = useState(21)
  const [theme, setTheme] = useState<'night' | 'paper'>('night')

  return <section className="appearance-settings">
    <div className="page-heading"><div><p>{scope === 'book' ? 'Book UI' : 'Default UI'}</p><h1 id="page-title">Reading surface</h1><span>{scope === 'book' ? 'These values will apply only to this book.' : 'These values are copied when a new book is created.'}</span></div><Type aria-hidden="true" /></div>
    <div className="settings-card appearance-card">
      <Select className="appearance-field" label="Editor font" defaultValue="Iowan Old Style"><option>Iowan Old Style</option><option>Literata</option><option>Source Serif</option></Select>
      <label className="appearance-field"><span>Text size <b>{textSize} px</b></span><input type="range" min="16" max="30" value={textSize} onChange={(event) => setTextSize(Number(event.target.value))} /></label>
      <div className="theme-grid" aria-label="Default theme">
        <button className={`theme-card ${theme === 'night' ? 'selected' : ''}`} type="button" onClick={() => setTheme('night')}><i className="theme-night" /><span>Ink at Night</span>{theme === 'night' && <Check aria-hidden="true" />}</button>
        <button className={`theme-card ${theme === 'paper' ? 'selected' : ''}`} type="button" onClick={() => setTheme('paper')}><i className="theme-paper" /><span>Paper</span>{theme === 'paper' && <Check aria-hidden="true" />}</button>
      </div>
      <button className="create-theme" type="button"><Plus aria-hidden="true" /> Create theme</button>
    </div>
  </section>
}

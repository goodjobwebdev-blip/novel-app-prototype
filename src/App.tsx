import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  Check,
  CircleHelp,
  Home,
  Image as ImageIcon,
  MessageCircle,
  Mic,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Star,
  Type,
  Volume2,
  X,
} from 'lucide-react'
import {
  defaultAiPrompts,
  initialAiSettings,
  loadAiSettings,
  RESPONSE_LENGTH_PRESETS,
  saveAiSettings,
  saveGlobalFavorites,
  type AiPrompts,
  type AiProvider,
  type AiSettings,
} from './ai-settings'
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
  type GenerationContextType,
} from './persistence'
import { bookTemplateValues, generationInstructionMessage, promptVariables, renderPromptTemplate, responseLengthMessage, type BookPromptValues } from './prompt-template'
import { buildContextValues, contextLimitInputError, generationContextDiagnostics, type PreparedContextValues } from './context-service'
import { getChat, listChatMessages, saveChatContextProfile, type ChatEntity, type ChatMessageEntity } from './chat-service'
import { CHAT_TOOL_DEFINITIONS, CHAT_WORKSPACE_INSTRUCTIONS, serializeChatModelInput } from './chat-request'
import { renderLorePrompt, renderStoryPrompt } from './nanogpt'
import { clearModelCatalog, getCachedModelCatalog, providerModelEndpoint, saveModelCatalog, type ProviderModel } from './model-catalog'
import { KeyedAsyncQueue } from './keyed-async-queue'
import { saveRequiredSettingsForLeave } from './settings-leave-policy'
import { fetchSpeechModels, type SpeechModel } from './tts-service'
import { fetchTranscriptionModels, type SttModel } from './stt-service'
import './response-length-settings.css'
import './context-limit-settings.css'
import './codex-archive.css'
import './codex-summary.css'
import './tts.css'
import './codex-triggers.css'
import './settings-save-recovery.css'
type SettingsTab = 'ai' | 'context' | 'appearance' | 'speech' | 'images'
type SaveState = 'loading' | 'saved' | 'saving' | 'error'
type RequestPreviewMessage = {
  key: string
  role: 'system' | 'user' | 'assistant'
  title: string
  detail: string
  content: string
  reasoning?: string
}

const providerLabels: Record<AiProvider, string> = { openrouter: 'OpenRouter', nanogpt: 'nano-gpt.com', openai: 'OpenAI', compatible: 'OpenAI-compatible' }
function formatContext(value?: number) {
  if (!value) return 'Context unknown'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 ? 1 : 0)}m context`
  return `${Math.round(value / 1000)}k context`
}

function textModelConnectionKey(settings: Pick<AiSettings, 'provider' | 'baseUrl' | 'apiKey'>) {
  return `${settings.provider}\n${providerModelEndpoint(settings)}\n${settings.apiKey.trim()}`
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

function chatHistoryContent(message: ChatMessageEntity) {
  const editState = message.role === 'assistant' && message.documentEdits?.length
    ? `\n\n[Workspace edit proposals: ${message.documentEdits.map((proposal) => `${proposal.entityTitle}: ${proposal.status}`).join('; ')}]`
    : ''
  const creationState = message.role === 'assistant' && message.codexCreations?.length
    ? `\n\n[Codex creation proposals: ${message.codexCreations.map((proposal) => `${proposal.title}: ${proposal.status}`).join('; ')}]`
    : ''
  const outlineState = message.role === 'assistant' && message.outlineActions?.length
    ? `\n\n[Outline proposals: ${message.outlineActions.map((proposal) => `${proposal.action} ${proposal.entityTitle}: ${proposal.status}`).join('; ')}]`
    : ''
  const entityActionState = message.role === 'assistant' && message.entityActions?.length
    ? `\n\n[Entity proposals: ${message.entityActions.map((proposal) => `${proposal.action} ${proposal.entityTitle}: ${proposal.status}`).join('; ')}]`
    : ''
  return `${message.content}${editState}${creationState}${outlineState}${entityActionState}`
}

type AiSettingsProps = {
  onHome?: () => void
  onBack?: () => void
  onSaved?: (settings: AiSettings) => void
  book?: { id: string; title: string; contextType?: GenerationContextType; currentDocumentId?: string; currentDocumentText?: string; promptValues?: BookPromptValues; chatId?: string }
}

export default function App({ onHome, onBack, onSaved, book }: AiSettingsProps) {
  const [settings, setSettings] = useState<AiSettings>(initialAiSettings)
  const [models, setModels] = useState<ProviderModel[]>([])
  const [promptTab, setPromptTab] = useState<keyof AiPrompts>('story')
  const [modelSearch, setModelSearch] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('Add an API key, then reload the model list.')
  const [statusKind, setStatusKind] = useState<'quiet' | 'success' | 'error'>('quiet')
  const [saveState, setSaveState] = useState<SaveState>(book ? 'loading' : 'saved')
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('ai')
  const [settingsLoading, setSettingsLoading] = useState(Boolean(book))
  const [contextSettings, setContextSettings] = useState<BookContextSettings>(defaultBookContextSettings)
  const [contextSources, setContextSources] = useState<ArcEntity[]>([])
  const [contextSaved, setContextSaved] = useState(true)
  const [leaveRecoveryOpen, setLeaveRecoveryOpen] = useState(false)
  const [leaveSaving, setLeaveSaving] = useState(false)
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
  const isBookSettings = Boolean(book)
  onSavedRef.current = onSaved

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
      const cachedModels = getCachedModelCatalog(defaults)
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
        const cachedModels = getCachedModelCatalog(bookSettings)
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
      setContextSettings(loadDefaultBookContextSettings())
      setContextSources([])
      setContextSaved(true)
      return () => { cancelled = true }
    }
    void Promise.all([getBookContextSettings(book.id), listEntitiesByBook(book.id), book.chatId ? getChat(book.chatId) : Promise.resolve(undefined)]).then(([value, entities, chat]) => {
      if (!cancelled) {
        const scopedValue = book.contextType === 'chat' && chat
          ? { ...value, profiles: { ...value.profiles, chat: chat.contextProfile } }
          : value
        setContextSettings(scopedValue)
        setContextSources(entities)
        setContextSaved(true)
      }
    })
    return () => { cancelled = true }
  }, [book?.id, book?.chatId, book?.contextType])

  const visibleModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase()
    return models.filter((model) => !query || `${model.id} ${model.name ?? ''}`.toLowerCase().includes(query)).sort((a, b) => Number(settings.favorites.includes(b.id)) - Number(settings.favorites.includes(a.id))).slice(0, 8)
  }, [modelSearch, models, settings.favorites])

  function persistAiSettings(snapshot: AiSettings, scope: string, version: number): Promise<boolean> {
    const pending = aiSaveQueueRef.current.run(scope, async () => {
      const savedSettings = scope === 'defaults'
        ? saveAiSettings(snapshot)
        : await saveBookAiSettings(scope, snapshot)
      if (scope !== 'defaults') saveGlobalFavorites(snapshot.favorites)
      if (version !== aiSaveVersionRef.current || scope !== aiLoadedScopeRef.current) return false
      aiSavedRef.current = JSON.stringify(snapshot)
      setSaveState('saved')
      setStatus(scope === 'defaults' ? 'AI defaults saved automatically on this device.' : `AI settings saved automatically for “${book?.title ?? 'this book'}”.`)
      setStatusKind('success')
      onSavedRef.current?.(savedSettings)
      return true
    })
    return pending.catch(() => {
      if (version !== aiSaveVersionRef.current || scope !== aiLoadedScopeRef.current) return false
      setSaveState('error')
      setStatus('Settings could not be saved. Your changes are still shown; edit a setting to try again.')
      setStatusKind('error')
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
    const baseUrl = provider === 'nanogpt' ? 'https://nano-gpt.com/api/v1' : provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : provider === 'openai' ? 'https://api.openai.com/v1' : current.baseUrl
    const next = { ...current, provider, baseUrl, mainModel: '', mainModelContextLength: undefined, supportModel: '', supportModelContextLength: undefined, codexModel: '', codexModelContextLength: undefined }
    clearModelCatalog(current)
    clearModelCatalog(next)
    changeAiSettings(() => next)
    setModels([]); setStatus('Provider changed. Reload its model list when ready.'); setStatusKind('quiet')
  }
  function selectModel(kind: 'main' | 'support' | 'codex', id: string) {
    const contextLength = models.find((model) => model.id === id)?.context_length
    changeAiSettings((current) => kind === 'main'
      ? { ...current, mainModel: id, mainModelContextLength: contextLength }
      : kind === 'support' ? { ...current, supportModel: id, supportModelContextLength: contextLength } : { ...current, codexModel: id, codexModelContextLength: contextLength })
  }
  async function refreshModels() {
    const requestSettings = latestAiSettingsRef.current
    if (!requestSettings.apiKey.trim()) { setStatus('Enter an API key before loading models.'); setStatusKind('error'); return }
    if (requestSettings.provider === 'compatible' && !requestSettings.baseUrl.trim()) { setStatus('Enter the compatible provider endpoint first.'); setStatusKind('error'); return }
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
  function toggleFavorite(id: string) { changeAiSettings((current) => ({ ...current, favorites: current.favorites.includes(id) ? current.favorites.filter((favorite) => favorite !== id) : [...current.favorites, id] })) }

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
    setModels(getCachedModelCatalog(defaults)?.models ?? [])

    try {
      await aiSaveQueueRef.current.run(scope, async () => {
        const copied = await copyDefaultAiSettingsToBook(scope, defaults)
        if (version !== aiSaveVersionRef.current || scope !== aiLoadedScopeRef.current) return
        latestAiSettingsRef.current = copied
        aiSavedRef.current = JSON.stringify(copied)
        setSettings(copied)
        setSaveState('saved')
        setModels(getCachedModelCatalog(copied)?.models ?? [])
        setStatus(`Current defaults copied to “${book.title}”.`)
        setStatusKind('success')
        onSavedRef.current?.(copied)
      })
    } catch {
      if (version !== aiSaveVersionRef.current || scope !== aiLoadedScopeRef.current) return
      setSaveState('error')
      setStatus('Defaults could not be copied to this book. Try again.')
      setStatusKind('error')
    }
  }

  async function saveContextDefaults(): Promise<boolean> {
    const value = contextSettings
    if (!book) {
      try {
        const saved = saveDefaultBookContextSettings(value)
        setContextSettings(saved)
        setContextSaved(true)
        return true
      } catch {
        setContextSaved(false)
        return false
      }
    }

    const version = ++contextSaveVersionRef.current
    if (book.contextType === 'chat' && book.chatId) {
      try {
        await saveChatContextProfile(book.chatId, value.profiles.chat)
        if (version !== contextSaveVersionRef.current) return false
        setContextSaved(true)
        return true
      } catch {
        if (version === contextSaveVersionRef.current) setContextSaved(false)
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
      if (version === contextSaveVersionRef.current) setContextSaved(false)
      return false
    }
  }

  function updateContextDefaults(value: BookContextSettings) {
    setContextSettings(value)
    setContextSaved(false)
    if (!book) {
      try {
        const saved = saveDefaultBookContextSettings(value)
        setContextSettings(saved)
        setContextSaved(true)
      } catch {
        setContextSaved(false)
      }
      return
    }
    const version = ++contextSaveVersionRef.current
    if (book.contextType === 'chat' && book.chatId) {
      contextSaveQueueRef.current = contextSaveQueueRef.current.catch(() => undefined).then(async () => {
        await saveChatContextProfile(book.chatId!, value.profiles.chat)
        if (version === contextSaveVersionRef.current) setContextSaved(true)
      }).catch(() => {
        if (version === contextSaveVersionRef.current) setContextSaved(false)
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
      if (version === contextSaveVersionRef.current) setContextSaved(false)
    })
  }

  async function leaveSettings(destination?: () => void) {
    if (!destination || leaveSavingRef.current) return
    pendingLeaveDestinationRef.current = destination
    leaveSavingRef.current = true
    setLeaveSaving(true)
    const saved = await saveRequiredSettingsForLeave([
      () => flushAiSettings(),
      ...(!contextSaved ? [() => saveContextDefaults()] : []),
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
    setLeaveRecoveryOpen(false)
    pendingLeaveDestinationRef.current = null
    destination()
  }

  return (
    <main className="app-shell">
      <aside className="settings-rail" aria-label={`${isBookSettings ? 'Book' : 'Default'} settings navigation`}>
        <div className="rail-header"><button className="home-button" type="button" aria-label="Back to library" onClick={() => { void leaveSettings(onHome) }} disabled={leaveSaving}><Home aria-hidden="true" /><b>Home</b></button>{onBack && <button className="settings-close" type="button" onClick={() => { void leaveSettings(onBack) }} aria-label="Close settings" disabled={leaveSaving}><X aria-hidden="true" /></button>}</div>
        <nav>
          {([['ai', Bot, 'AI'], ['context', SlidersHorizontal, 'Context'], ['appearance', Type, 'UI'], ['speech', Volume2, 'Speech'], ['images', ImageIcon, 'Images']] as const).map(([key, Icon, label]) => (
            <button className={settingsTab === key ? 'active' : ''} type="button" onClick={() => setSettingsTab(key)} key={key}><Icon aria-hidden="true" /><span>{label}</span></button>
          ))}
        </nav>
        <p>{isBookSettings ? `Changes here affect only “${book?.title}”. Favorite models are shared across books.` : 'Defaults are copied into a new book. After that, each book keeps its own settings.'}</p>
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

        <section className="settings-card provider-card">
          <div className="card-heading"><div><span>01</span><h2>Provider</h2></div><p>Connection details stay in this browser.</p></div>
          <div className="provider-grid">{(Object.keys(providerLabels) as AiProvider[]).map((provider) => <button key={provider} className={settings.provider === provider ? 'selected' : ''} type="button" onClick={() => selectProvider(provider)}><i>{provider === 'nanogpt' ? 'N' : provider === 'openrouter' ? 'O' : provider === 'openai' ? 'AI' : '{ }'}</i><span><strong>{providerLabels[provider]}</strong><small>{provider === 'compatible' ? 'Custom endpoint' : 'Managed endpoint'}</small></span><b>{settings.provider === provider ? '✓' : ''}</b></button>)}</div>
          <div className="connection-fields">
            {settings.provider === 'compatible' && <label><span>Endpoint URL</span><input value={settings.baseUrl} onChange={(event) => updateConnection('baseUrl', event.target.value)} placeholder="https://provider.example/v1" /></label>}
            <label><span>API key</span><div className="input-action"><input
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
            /><button type="button" onClick={() => setShowKey((value) => !value)}>{showKey ? 'Hide' : 'Show'}</button></div></label>
            <button className="reload-button" type="button" onClick={refreshModels} disabled={loading}><RefreshCw className={loading ? 'spinning' : ''} aria-hidden="true" />{loading ? 'Loading models…' : 'Reload model list'}</button>
          </div>
          <p className={`status ${statusKind}`} role="status"><i />{status}</p>
        </section>

        <section className="settings-card models-card">
          <div className="card-heading"><div><span>02</span><h2>Models</h2></div><p>{isBookSettings ? 'Favorites are shared; model choices belong to this book.' : 'Main writes; Support handles summaries and autotitles.'}</p></div>
          <div className="model-pickers"><label><span>Main model <em>Story generation and fallback</em></span><input list="model-options" value={settings.mainModel} onChange={(event) => selectModel('main', event.target.value)} placeholder={models.length ? 'Search models…' : 'Reload models first'} /></label><label><span>Support model <em>Fast utility tasks</em></span><input list="model-options" value={settings.supportModel} onChange={(event) => selectModel('support', event.target.value)} placeholder={models.length ? 'Search models…' : 'Reload models first'} /></label><label><span>Codex model <em>Optional · uses Main when empty</em></span><input list="model-options" value={settings.codexModel} onChange={(event) => selectModel('codex', event.target.value)} placeholder="Use Main model" /></label><datalist id="model-options">{models.map((model) => <option key={model.id} value={model.id}>{model.name ?? model.id}</option>)}</datalist></div>
          <label className="generation-speed-setting">
            <span><strong>Writing pace</strong><em>Milliseconds per word</em></span>
            <input type="text" inputMode="numeric" pattern="[0-9]*" value={settings.generationWordDelayMs} onChange={(event) => update('generationWordDelayMs', event.target.value)} aria-describedby="generation-speed-help" spellCheck={false} />
            <small id="generation-speed-help">40 ms is the default. Use a lower value for faster writing or a higher value for slower writing (1–2000).</small>
          </label>
          <div className="context-limit-grid">
            <label className={contextLimitInputError(settings.mainEffectiveContextLimit) ? 'invalid' : ''}><span><strong>Story / Main context cap</strong><em>Effective input window</em></span><input type="text" value={settings.mainEffectiveContextLimit} onChange={(event) => update('mainEffectiveContextLimit', event.target.value)} placeholder="Model maximum" spellCheck={false} /><small>{contextLimitInputError(settings.mainEffectiveContextLimit) || 'Optional. Accepts tokens such as 32000, 32k, or 1m. The model hard maximum still wins.'}</small></label>
            <label className={contextLimitInputError(settings.codexEffectiveContextLimit) ? 'invalid' : ''}><span><strong>Codex model context cap</strong><em>Used when a Codex model is set</em></span><input type="text" value={settings.codexEffectiveContextLimit} onChange={(event) => update('codexEffectiveContextLimit', event.target.value)} placeholder="Model maximum" spellCheck={false} /><small>{contextLimitInputError(settings.codexEffectiveContextLimit) || (settings.codexModel.trim() ? 'Optional cap for the selected Codex model.' : 'Codex currently falls back to Main, so the Story / Main cap applies.')}</small></label>
          </div>
          <div className="response-length-setting">
            <label htmlFor="response-length"><span><strong>Response length</strong><em>Story, Codex, and Chat</em></span><textarea id="response-length" value={settings.responseLength} onChange={(event) => update('responseLength', event.target.value)} placeholder="Leave empty to let the model decide." /></label>
            <div className="response-length-presets" aria-label="Response length presets">{RESPONSE_LENGTH_PRESETS.map((preset) => <button type="button" key={preset.label} onClick={() => update('responseLength', preset.value)}>{preset.label}</button>)}</div>
            <small>Applied near the end of each request, immediately before the current instruction. Custom prompts can place <code>{'{{response.length}}'}</code> explicitly instead.</small>
          </div>
          <div className="model-browser"><div className="model-search"><Search aria-hidden="true" /><input value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="Search loaded models" /></div>{models.length ? <div className="model-list">{visibleModels.map((model) => <article key={model.id}><button className={`favorite ${settings.favorites.includes(model.id) ? 'active' : ''}`} type="button" onClick={() => toggleFavorite(model.id)} aria-label={`Favorite ${model.id}`}><Star fill={settings.favorites.includes(model.id) ? 'currentColor' : 'none'} aria-hidden="true" /></button><div><strong>{model.name || model.id}</strong>{model.name && model.name !== model.id && <small>{model.id}</small>}<p><span>{formatContext(model.context_length)}</span><span>{model.architecture?.modality || 'Text'}</span>{model.pricing?.prompt && <span>Pricing supplied</span>}</p></div><button className="use-model" type="button" onClick={() => selectModel('main', model.id)}>Use</button></article>)}</div> : <div className="model-empty"><Bot aria-hidden="true" /><strong>No models loaded</strong><p>Enter your key and reload the provider model list.</p></div>}</div>
        </section>

        <section className="settings-card prompts-card">
          <div className="card-heading"><div><span>03</span><h2>System prompts</h2></div></div>
          <div className="prompt-tabs" role="tablist">{([['story', 'Story'], ['summarize', 'Summarize'], ['lore', 'Lore entries'], ['assistant', 'Assistant']] as const).map(([key, label]) => <button key={key} className={promptTab === key ? 'active' : ''} type="button" onClick={() => setPromptTab(key)}>{label}</button>)}</div>
          <textarea className="prompt-editor" value={settings.prompts[promptTab]} onChange={(event) => update('prompts', { ...settings.prompts, [promptTab]: event.target.value })} spellCheck={false} />
          <details className="prompt-reference">
            <summary><CircleHelp aria-hidden="true" /><span>Variables & syntax</span></summary>
            <div className="prompt-syntax"><span>Insert a value</span><code>{'{{book.title}}'}</code><span>Include a block only when a value exists</span><code>{'{% if book.genre %}Genre: {{book.genre}}{% endif %}'}</code></div>
            <div className="prompt-variable-list">{promptVariables.filter((variable) => variable.scopes.includes(promptTab)).map((variable) => <div key={variable.name}><code>{`{{${variable.name}}}`}</code><span>{variable.description}</span></div>)}</div>
          </details>
          <div className="prompt-footer"><button type="button" onClick={() => update('prompts', { ...settings.prompts, [promptTab]: defaultAiPrompts[promptTab] })}>Reset default</button></div>
        </section>
        {book && <footer className="save-bar"><div><strong>{book.title}</strong><span>Changes save automatically</span></div><div className="save-actions"><button className="reset-settings" type="button" onClick={() => { void resetFromDefaults() }} disabled={settingsLoading}><RefreshCw aria-hidden="true" /> Reset from defaults</button></div></footer>}
        </> : settingsTab === 'context' ? (book ? (book.contextType === 'note'
          ? <NoteContextPlaceholder />
          : <ContextSettings bookId={book.id} bookTitle={book.title} bookPromptValues={book.promptValues} type={book.contextType ?? 'scene'} currentDocumentId={book.currentDocumentId} currentDocumentText={book.currentDocumentText} chatId={book.chatId} settings={settings} value={contextSettings} sources={contextSources} saved={contextSaved} onChange={updateContextDefaults} />)
          : <GlobalContextDefaults value={contextSettings} onChange={updateContextDefaults} />)
          : settingsTab === 'speech' ? <SpeechSettingsPanel settings={settings} scope={isBookSettings ? 'book' : 'defaults'} onChange={(speech) => update('speech', speech)} />
          : <SettingsPlaceholder tab={settingsTab} scope={isBookSettings ? 'book' : 'defaults'} />}
      </section>
    </main>
  )
}

function GlobalContextDefaults({ value, onChange }: { value: BookContextSettings; onChange: (value: BookContextSettings) => void }) {
  return <section className="context-defaults-settings">
    <header className="page-heading"><div><p>Default Context</p><h1 id="page-title">Context defaults</h1><span>Copied into new books. Existing books keep their own Context settings.</span></div></header>
    <section className="settings-card context-defaults-card"><div className="card-heading"><div><span>01</span><h2>Automatic Codex</h2></div></div>
      <label className="context-trigger-window"><span><strong>Previous Scenes to scan for Codex triggers</strong><small>The current Scene is included in addition to this many immediately previous Scenes. 0 means current Scene only.</small></span><input type="number" min="0" step="1" value={value.previousScenesForCodexTriggers} onChange={(event) => onChange({ ...value, previousScenesForCodexTriggers: Math.max(0, Math.floor(Number(event.target.value) || 0)) })} /></label>
    </section>
  </section>
}

function NoteContextPlaceholder() {
  return <section className="compact-settings-empty" aria-labelledby="page-title">
    <MessageCircle aria-hidden="true" />
    <h1 id="page-title">Context Management</h1>
    <p>You can use Chat to generate notes!</p>
  </section>
}

function ContextSettings({ bookId, bookTitle, bookPromptValues, type, currentDocumentId, currentDocumentText, chatId, settings, value, sources, saved, onChange }: { bookId: string; bookTitle: string; bookPromptValues?: BookPromptValues; type: Exclude<GenerationContextType, 'note'>; currentDocumentId?: string; currentDocumentText?: string; chatId?: string; settings: AiSettings; value: BookContextSettings; sources: ArcEntity[]; saved: boolean; onChange: (value: BookContextSettings) => void }) {
  const [query, setQuery] = useState('')
  const [preview, setPreview] = useState<PreparedContextValues | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [previewChat, setPreviewChat] = useState<ChatEntity | null>(null)
  const [previewHistory, setPreviewHistory] = useState<ChatMessageEntity[]>([])
  const profile = value.profiles[type]
  const updateProfile = (next: typeof profile) => onChange({ ...value, profiles: { ...value.profiles, [type]: next } })
  const toggle = (key: 'structuralIds' | 'noteIds' | 'codexEntryIds', id: string) => updateProfile({ ...profile, [key]: profile[key].includes(id) ? profile[key].filter((item) => item !== id) : [...profile[key], id] })
  const normalized = query.trim().toLowerCase()
  const archivedSelectedCodex = sources.filter((item) => item.type === 'codexEntry' && isCodexEntryArchived(item) && profile.codexEntryIds.includes(item.id))
  const archivedSelectedIds = new Set(archivedSelectedCodex.map((item) => item.id))
  const visible = sources.filter((item) => ['act', 'chapter', 'scene', 'note', 'codexEntry'].includes(item.type) && !(item.type === 'codexEntry' && isCodexEntryArchived(item)) && (type === 'chat' || item.id !== currentDocumentId) && (!normalized || `${item.title ?? ''} ${item.type} ${item.category ?? ''}`.toLowerCase().includes(normalized)))
  const groups = [
    ['Acts & chapters', visible.filter((item) => item.type === 'act' || item.type === 'chapter'), 'structuralIds'],
    ['Scenes', visible.filter((item) => item.type === 'scene'), 'structuralIds'],
    ['Notes', visible.filter((item) => item.type === 'note'), 'noteIds'],
    ['Codex', visible.filter((item) => item.type === 'codexEntry'), 'codexEntryIds'],
  ] as const
  useEffect(() => {
    let cancelled = false
    const currentSceneId = type === 'scene' ? currentDocumentId : value.lastOpenedSceneId || undefined
    ;(async () => {
      try {
        const prepared = await buildContextValues({ bookId, type, currentSceneId, currentSceneText: type === 'scene' ? currentDocumentText : undefined, currentDocumentId, previousScenesForCodexTriggers: value.previousScenesForCodexTriggers, profile })
        let chat: ChatEntity | null = null
        let history: ChatMessageEntity[] = []
        if (type === 'chat' && chatId) {
          const [loadedChat, loadedHistory] = await Promise.all([getChat(chatId), listChatMessages(bookId, chatId)])
          chat = loadedChat ?? null
          history = loadedHistory
        }
        if (!cancelled) {
          setPreview(prepared)
          setPreviewChat(chat)
          setPreviewHistory(history)
          setPreviewError(type === 'chat' && !chatId ? 'Open a chat to preview its request.' : '')
        }
      } catch {
        if (!cancelled) {
          setPreview(null)
          setPreviewChat(null)
          setPreviewHistory([])
          setPreviewError('Request preview could not be prepared.')
        }
      }
    })()
    return () => { cancelled = true }
  }, [bookId, chatId, currentDocumentId, currentDocumentText, profile, sources, type, value.lastOpenedSceneId, value.previousScenesForCodexTriggers])

  const currentDocument = sources.find((item) => item.id === currentDocumentId)
  const metadata: BookPromptValues = { ...(bookPromptValues ?? { title: bookTitle, series: '', seriesOrder: '', overview: '', genre: '', style: '', pov: '', tense: '', language: '' }), responseLength: settings.responseLength }
  const typeLabel = type === 'scene' ? 'Story' : type === 'codex' ? 'Codex' : 'Chat'
  const requestMessages: RequestPreviewMessage[] = []

  if (preview && type === 'scene') {
    const systemPrompt = renderStoryPrompt(settings.prompts.story, {
      book: metadata,
      sceneText: preview.currentSceneText,
      scenePov: typeof currentDocument?.pov === 'string' ? currentDocument.pov : undefined,
      previousSceneText: preview.previousSceneText,
      summaryContext: preview.summaryContext,
      additionalContext: preview.additionalContext,
    })
    requestMessages.push({ key: 'story-system', role: 'system', title: 'Story system prompt', detail: 'SYSTEM', content: systemPrompt })
    if (!/{{\s*additional_context\s*}}/.test(settings.prompts.story) && preview.additionalContext.trim()) {
      requestMessages.push({ key: 'story-context', role: 'user', title: 'Additional context', detail: 'USER', content: `# Additional context\n\n${preview.additionalContext}` })
    }
    requestMessages.push({ key: 'story-instruction', role: 'user', title: 'Generation instruction', detail: 'USER · default shown', content: generationInstructionMessage(settings.prompts.story, settings.responseLength, 'Continue the story.') })
  }

  if (preview && type === 'codex') {
    const systemPrompt = renderLorePrompt(settings.prompts.lore, {
      book: metadata,
      entryTitle: currentDocument?.title ?? '',
      entryCategory: typeof currentDocument?.category === 'string' ? currentDocument.category : '',
      entryContent: currentDocumentText ?? String(currentDocument?.content ?? ''),
      sceneText: preview.lastSceneText,
      additionalContext: preview.additionalContext,
    })
    requestMessages.push({ key: 'codex-system', role: 'system', title: 'Lore system prompt', detail: 'SYSTEM', content: systemPrompt })
    if (!/{{\s*additional_context\s*}}/.test(settings.prompts.lore) && preview.additionalContext.trim()) {
      requestMessages.push({ key: 'codex-context', role: 'user', title: 'Additional context', detail: 'USER', content: `# Additional context\n\n${preview.additionalContext}` })
    }
    requestMessages.push({ key: 'codex-instruction', role: 'user', title: 'Generation instruction', detail: 'USER · default shown', content: generationInstructionMessage(settings.prompts.lore, settings.responseLength, 'Create a complete Codex entry.') })
  }

  if (preview && type === 'chat' && previewChat) {
    const systemPrompt = renderPromptTemplate(previewChat.systemPrompt, bookTemplateValues(metadata))
    requestMessages.push({ key: 'chat-system', role: 'system', title: 'Chat system prompt', detail: 'SYSTEM', content: systemPrompt })
    requestMessages.push({ key: 'chat-workspace', role: 'system', title: 'Workspace instructions', detail: 'SYSTEM', content: CHAT_WORKSPACE_INSTRUCTIONS })
    const contextSections = [
      preview.lastSceneText ? `# Current scene${preview.lastSceneTitle ? ` — ${preview.lastSceneTitle}` : ''}\n\n${preview.lastSceneText.trim()}` : '',
      preview.additionalContext ? `# Additional context\n\n${preview.additionalContext.trim()}` : '',
    ].filter(Boolean)
    if (contextSections.length) {
      requestMessages.push({ key: 'chat-context', role: 'system', title: 'Selected book context', detail: 'SYSTEM', content: `# Selected book context\n\n${contextSections.join('\n\n')}` })
    }
    const lengthMessage = responseLengthMessage(previewChat.systemPrompt, settings.responseLength)
    let latestUserIndex = -1
    previewHistory.forEach((message, index) => { if (message.role === 'user') latestUserIndex = index })
    previewHistory.forEach((message, index) => {
      if (lengthMessage && index === latestUserIndex) {
        requestMessages.push({ key: 'chat-response-length', role: 'user', title: 'Response length', detail: 'USER · before latest instruction', content: lengthMessage })
      }
      requestMessages.push({
        key: message.id,
        role: message.role,
        title: message.role === 'user' ? 'User message' : 'Assistant message',
        detail: message.role.toUpperCase(),
        content: chatHistoryContent(message),
        reasoning: message.role === 'assistant' ? message.thoughts : undefined,
      })
    })
    if (lengthMessage && latestUserIndex < 0) {
      requestMessages.push({ key: 'chat-response-length', role: 'user', title: 'Response length', detail: 'USER · before next message', content: lengthMessage })
    }
  }

  const exactPreview = requestMessages.map((message) => `${message.role.toUpperCase()}:\n\n${message.content || '[empty]'}${message.reasoning ? `\n\nreasoning:\n${message.reasoning}` : ''}`).join('\n\n---\n\n')
  const selectedModel = type === 'codex' ? settings.codexModel.trim() || settings.mainModel.trim() : type === 'chat' ? previewChat?.model.trim() : settings.mainModel.trim()
  const selectedModelContextLength = type === 'codex'
    ? (settings.codexModel.trim() ? settings.codexModelContextLength : settings.mainModelContextLength)
    : type === 'chat' ? previewChat?.modelContextLength : settings.mainModelContextLength
  const effectiveLimitInput = type === 'codex'
    ? (settings.codexModel.trim() ? settings.codexEffectiveContextLimit : settings.mainEffectiveContextLimit)
    : type === 'chat' ? previewChat?.effectiveContextLimit ?? '' : settings.mainEffectiveContextLimit
  const diagnosticMessages = requestMessages.map((message) => ({ role: message.role, content: message.content || null, ...(message.reasoning ? { reasoning_content: message.reasoning } : {}) }))
  const diagnostics = selectedModel && requestMessages.length
    ? generationContextDiagnostics(selectedModel, selectedModelContextLength, effectiveLimitInput, type === 'chat' ? serializeChatModelInput(diagnosticMessages) : JSON.stringify({ messages: diagnosticMessages }))
    : null

  return <section className="context-defaults-settings">
    <header className="page-heading"><div><p>{typeLabel} generation</p><h1 id="page-title">Context Management</h1><span>Saved independently for {typeLabel.toLowerCase()} generation in “{bookTitle}”.</span></div><div className={`save-state ${saved ? 'saved' : ''}`}><i />{saved ? 'Saved' : 'Saving…'}</div></header>
    <section className="settings-card context-defaults-card"><div className="card-heading"><div><span>01</span><h2>Automatic context</h2></div></div>
      <label className="context-trigger-window"><span><strong>Previous Scenes to scan for Codex triggers</strong><small>The current/last-opened Scene is always scanned; this controls how many immediately previous Scenes join it.</small></span><input type="number" min="0" step="1" value={value.previousScenesForCodexTriggers} onChange={(event) => onChange({ ...value, previousScenesForCodexTriggers: Math.max(0, Math.floor(Number(event.target.value) || 0)) })} /></label>
      {archivedSelectedCodex.length > 0 && <div className="context-inactive-source"><div><strong>{archivedSelectedCodex.length} archived Codex {archivedSelectedCodex.length === 1 ? 'selection is' : 'selections are'} inactive</strong><small>{archivedSelectedCodex.map((item) => item.title ?? 'Untitled').join(', ')}. Archived lore is skipped from requests.</small></div><button type="button" onClick={() => updateProfile({ ...profile, codexEntryIds: profile.codexEntryIds.filter((id) => !archivedSelectedIds.has(id)) })}>Remove inactive</button></div>}
      <div className="context-default-locked"><Check aria-hidden="true" /><span><strong>Book metadata</strong><small>Provided through the book prompt variables.</small></span><b>Required</b></div>
      {type === 'scene' ? <><div className="context-default-locked"><Check aria-hidden="true" /><span><strong>Current Scene</strong><small>The active editor content is always included.</small></span><b>Required</b></div><label><input type="checkbox" checked={profile.includePreviousSceneWhenEmpty} onChange={(event) => updateProfile({ ...profile, includePreviousSceneWhenEmpty: event.target.checked })} /><span><strong>Previous Scene when empty</strong><small>Use the immediately previous Scene only when the current Scene has no text.</small></span></label><div className="context-default-locked"><Check aria-hidden="true" /><span><strong>Earlier summaries</strong><small>Uses the highest completed Act or Chapter summary without exposing later material.</small></span><b>Automatic</b></div></> : type === 'codex' ? <><div className="context-default-locked"><Check aria-hidden="true" /><span><strong>Current entry</strong><small>Title, category, and existing body are supplied through lore prompt variables.</small></span><b>Required</b></div><label><input type="checkbox" checked={profile.includeLastScene} onChange={(event) => updateProfile({ ...profile, includeLastScene: event.target.checked })} /><span><strong>Last-opened Scene</strong><small>Included by default for Codex generation.</small></span></label></> : <label><input type="checkbox" checked={profile.includeLastScene} onChange={(event) => updateProfile({ ...profile, includeLastScene: event.target.checked })} /><span><strong>Current Scene</strong><small>The book's last-opened Scene is included automatically for this chat.</small></span></label>}
    </section>
    <section className="settings-card context-sources-card"><div className="card-heading"><div><span>02</span><h2>Additional context</h2></div><p>Inserted as <code>{'{{additional_context}}'}</code>.</p></div>
      <fieldset className="summary-range"><legend>Summaries</legend>{([['none','None'],['all','All summaries'],['before','Before current Scene'],['after','After current Scene']] as const).map(([range,label]) => <label key={range}><input type="radio" name="summary-range" checked={profile.summaryRange === range} onChange={() => updateProfile({ ...profile, summaryRange: range })}/><span>{label}</span></label>)}</fieldset>
      <div className="context-source-search"><Search aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find Acts, Chapters, Scenes, Notes, or Codex" /></div>
      <div className="context-managed-list">{groups.map(([label, items, key]) => items.length > 0 && <section key={label}><h3>{label}</h3>{items.map((item) => <label key={item.id}><input type="checkbox" checked={profile[key].includes(item.id)} onChange={() => toggle(key, item.id)} /><span><strong>{item.title || 'Untitled'}</strong><small>{item.type}</small></span></label>)}</section>)}{!visible.length && <p>No matching sources.</p>}</div>
    </section>
    <section className="settings-card context-preview-card"><div className="card-heading"><div><span>03</span><h2>Request preview</h2></div><p>{selectedModel ? `Model: ${selectedModel}. ` : ''}Rendered message stack for the current {typeLabel.toLowerCase()} request.</p></div>
      {type !== 'chat' && <p className="context-preview-empty">The generation instruction below shows the fallback used when the generation drawer is empty. Custom drawer text replaces it when you generate.</p>}
      {previewError ? <p className="context-preview-error" role="alert">{previewError}</p> : preview ? <>
        {diagnostics && <div className={`context-budget ${!diagnostics.limitValid || !diagnostics.fits ? 'over' : diagnostics.warning ? 'warning' : ''}`}><strong>{diagnostics.limitValid ? `${diagnostics.requestTokens.toLocaleString()} estimated input tokens · ${Math.round(diagnostics.usageRatio * 100)}% of usable budget` : 'Invalid effective context cap'}</strong><span>Effective limit: {diagnostics.effectiveContextTokens.toLocaleString()} · Response reserve: {diagnostics.responseReserveTokens.toLocaleString()} · {diagnostics.modelContextKnown ? `Model hard window: ${diagnostics.modelContextTokens.toLocaleString()}` : `Model window estimate: ${diagnostics.modelContextTokens.toLocaleString()}`}</span>{diagnostics.wasClamped && <small>Your configured cap is above the model hard maximum, so Arc uses the model maximum.</small>}{diagnostics.limitError && <small>{diagnostics.limitError}</small>}{diagnostics.warning && diagnostics.fits && <small>Near the limit. Consider summaries, deselecting full-text context, or raising the cap.</small>}{!diagnostics.fits && diagnostics.limitValid && <small>Over the usable budget. Generation will be refused; Arc will not trim or replace context automatically.</small>}</div>}
        {preview.automaticCodex.length > 0 && <div className="automatic-codex-preview"><strong>Automatic Codex</strong>{preview.automaticCodex.map((item) => <article key={item.entryId} className={item.source === 'dependency' ? 'dependency-cascade' : 'trigger-match'}><header><b>{item.title}</b><small>{item.source === 'dependency' ? 'Dependency cascade' : 'Direct trigger'} · {item.representation === 'Summary' ? 'Summary' : 'Full entry'}{item.fallbackReason ? ` · ${item.fallbackReason}` : ''}</small></header>{item.source === 'dependency' ? <p>Dependency path: {(item.dependencyPath ?? []).map((step) => step.title).join(' → ')}</p> : <ul>{item.matches.map((match, index) => <li key={`${item.entryId}-${match.sceneId}-${match.trigger}-${index}`}><code>{match.trigger}</code> · {match.sceneTitle}</li>)}</ul>}</article>)}</div>}
        {preview.codexRepresentations.length > 0 && <div className="codex-context-representations"><strong>Codex context representation</strong>{preview.codexRepresentations.map((item) => <span key={item.entryId}><b>{item.title}</b><em>{item.representation}{item.fallbackReason ? ` · ${item.fallbackReason}` : ''}</em></span>)}</div>}
        <div className="context-preview-rendered">{requestMessages.map((message) => <section key={message.key}><header><h3>{message.title}</h3><span>{message.detail}</span></header>{message.content ? <div className="context-preview-copy">{message.content}</div> : <p className="context-preview-empty">This message is empty.</p>}{message.reasoning && <div className="context-preview-copy"><strong>Reasoning</strong>\n\n{message.reasoning}</div>}</section>)}</div>
        <details className="context-preview-raw"><summary>View message stack</summary><pre>{exactPreview || '[No messages would be sent yet.]'}</pre></details>
      </> : <p className="context-preview-empty">Preparing preview…</p>}
    </section>
  </section>
}

function SpeechSettingsPanel({ settings, scope, onChange }: { settings: AiSettings; scope: 'book' | 'defaults'; onChange: (speech: AiSettings['speech']) => void }) {
  const [models, setModels] = useState<SpeechModel[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [sttModels, setSttModels] = useState<SttModel[]>([])
  const [sttQuery, setSttQuery] = useState('')
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
  const filtered = models.filter((model) => !query.trim() || `${model.id} ${model.name}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 80)
  const filteredStt = sttModels.filter((model) => !sttQuery.trim() || `${model.provider} ${model.modelId} ${model.name}`.toLowerCase().includes(sttQuery.trim().toLowerCase())).slice(0, 100)

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
    <header className="page-heading"><div><p>{scope === 'book' ? 'Book Speech' : 'Default Speech'}</p><h1 id="page-title">Speech</h1><span>{scope === 'book' ? 'Independent TTS and dictation settings for this book.' : 'Copied into each new book, then edited independently.'}</span></div><Volume2 aria-hidden="true" /></header>
    <section className="settings-card">
      <div className="card-heading"><div><span>01</span><h2>Speech credentials</h2></div><p>Speech credentials are separate from text AI.</p></div>
      <div className="speech-settings-grid">
        <label><span>NanoGPT Speech API key</span><div className="speech-key-row"><input type="password" value={settings.speech.apiKey} onChange={(event) => updateSpeech({ apiKey: event.target.value })} autoComplete="off" spellCheck={false} />{settings.provider === 'nanogpt' && settings.apiKey.trim() && <button type="button" onClick={() => updateSpeech({ apiKey: settings.apiKey })}>Copy NanoGPT key from AI settings</button>}</div><small className="speech-help">Used by NanoGPT TTS and NanoGPT transcription models.</small></label>
        <label><span>OpenAI Speech API key</span><input type="password" value={settings.speech.openaiApiKey} onChange={(event) => updateSpeech({ openaiApiKey: event.target.value })} autoComplete="off" spellCheck={false} /><small className="speech-help">Used only for OpenAI transcription. Stored with this Speech configuration on this device.</small></label>
      </div>
    </section>
    <section className="settings-card">
      <div className="card-heading"><div><span>02</span><h2>Text to speech</h2></div><button type="button" onClick={() => { void loadModels() }} disabled={loading}><RefreshCw className={loading ? 'spinning' : ''} aria-hidden="true" /> Reload</button></div>
      <div className="speech-model-search"><Search aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search TTS models" /></div>
      {message && <p className="speech-help">{message}</p>}
      {unavailableModel && <p className="speech-model-unavailable" role="alert">Saved model “{settings.speech.model}” is unavailable. Arc will not silently switch paid models.</p>}
      <div className="speech-model-list">{filtered.map((model) => <button type="button" key={model.id} className={model.id === settings.speech.model ? 'selected' : ''} onClick={() => updateSpeech({ model: model.id, voice: model.voices.includes(settings.speech.voice) ? settings.speech.voice : model.voices[0] ?? '' })}><span><strong>{model.name}</strong><small>{model.id}</small></span><small>{model.averagePrice ? `Avg. ${model.averagePrice}` : 'Price not supplied'}</small></button>)}</div>
      <div className="speech-settings-grid">
        <label><span>Voice</span><select value={settings.speech.voice} onChange={(event) => updateSpeech({ voice: event.target.value })}>{unavailableVoice && <option value={settings.speech.voice}>{settings.speech.voice} — unavailable</option>}{!voices.length && settings.speech.voice && <option value={settings.speech.voice}>{settings.speech.voice}</option>}{voices.map((voice) => <option key={voice} value={voice}>{voice}</option>)}</select>{unavailableVoice && <small className="speech-model-unavailable">Choose an available voice before reading aloud.</small>}</label>
        <label><span>Maximum parallel TTS requests</span><input type="number" min="1" max="8" value={settings.speech.maxParallelRequests} onChange={(event) => updateSpeech({ maxParallelRequests: event.target.value })} /><small className="speech-help">Default 1. Audio may generate concurrently but always plays in prose order.</small></label>
      </div>
      <label className="speech-toggle"><span><input type="checkbox" checked={settings.speech.readAloudAfterGeneration} onChange={(event) => updateSpeech({ readAloudAfterGeneration: event.target.checked })} /> Read aloud after generation</span><small className="speech-help">Story reads only the latest generated passage; Codex reads the resulting entry; Chat reads the new visible assistant answer.</small></label>
    </section>
    <section className="settings-card stt-settings-card">
      <div className="card-heading"><div><span>03</span><h2>Speech to text</h2></div><button type="button" onClick={() => { void loadSttModels() }} disabled={sttLoading}><RefreshCw className={sttLoading ? 'spinning' : ''} aria-hidden="true" /> Reload</button></div>
      <p className="speech-help">Dictation sends microphone audio only to the provider named by the selected transcription model. Raw recordings are not stored by Arc.</p>
      <div className="speech-model-search"><Search aria-hidden="true" /><input value={sttQuery} onChange={(event) => setSttQuery(event.target.value)} placeholder="Search transcription models" /></div>
      {sttMessage && <p className="speech-help">{sttMessage}</p>}
      {unavailableStt && <p className="speech-model-unavailable" role="alert">Saved transcription model “{settings.speech.transcriptionModel}” is unavailable in the loaded catalogs. Arc will not silently substitute another paid model.</p>}
      <div className="speech-model-list stt-model-list">{filteredStt.map((model) => <button type="button" key={model.id} className={model.id === settings.speech.transcriptionModel ? 'selected' : ''} onClick={() => updateSpeech({ transcriptionModel: model.id, streamTranscription: model.supportsLive })}><span><strong>{model.provider === 'openai' ? 'OpenAI' : 'NanoGPT'} · {model.name}</strong><small>{model.modelId} · {model.supportsLive ? 'Live + file transcription' : 'File transcription'}</small></span><small>{model.price || 'Price not supplied by catalog'}</small></button>)}</div>
      <div className="speech-settings-grid">
        <label><span>Language hint</span><input value={settings.speech.transcriptionLanguage === 'auto' ? '' : settings.speech.transcriptionLanguage} onChange={(event) => updateSpeech({ transcriptionLanguage: event.target.value.trim() || 'auto' })} placeholder="Auto-detect" /><small className="speech-help">Leave empty for Auto-detect. Enter a provider-supported language code/name to provide a hint.</small></label>
        <label className="speech-toggle stt-live-toggle"><span><input type="checkbox" checked={settings.speech.streamTranscription && liveSupported} disabled={!liveSupported} onChange={(event) => updateSpeech({ streamTranscription: event.target.checked })} /> Stream text while speaking</span><small className="speech-help">{liveSupported ? 'Supported by this model. Partial text stays provisional until Stop/finalization.' : selectedStt ? 'This selected model does not expose live partial transcription.' : 'Load/select a model to check live-transcription capability.'}</small></label>
      </div>
      {settings.speech.transcriptionModel.startsWith('openai:') && <p className="speech-help"><Mic aria-hidden="true" /> OpenAI live-capable models use a direct browser Realtime connection; ordinary models record locally and upload once after Stop.</p>}
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
      <label className="appearance-field"><span>Editor font</span><select defaultValue="Iowan Old Style"><option>Iowan Old Style</option><option>Literata</option><option>Source Serif</option></select></label>
      <label className="appearance-field"><span>Text size <b>{textSize} px</b></span><input type="range" min="16" max="30" value={textSize} onChange={(event) => setTextSize(Number(event.target.value))} /></label>
      <div className="theme-grid" aria-label="Default theme">
        <button className={`theme-card ${theme === 'night' ? 'selected' : ''}`} type="button" onClick={() => setTheme('night')}><i className="theme-night" /><span>Ink at Night</span>{theme === 'night' && <Check aria-hidden="true" />}</button>
        <button className={`theme-card ${theme === 'paper' ? 'selected' : ''}`} type="button" onClick={() => setTheme('paper')}><i className="theme-paper" /><span>Paper</span>{theme === 'paper' && <Check aria-hidden="true" />}</button>
      </div>
      <button className="create-theme" type="button"><Plus aria-hidden="true" /> Create theme</button>
    </div>
  </section>
}
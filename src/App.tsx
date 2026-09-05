import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  Check,
  CircleHelp,
  Home,
  Image as ImageIcon,
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
  listEntitiesByBook,
  saveBookContextSettings,
  saveBookAiSettings,
  defaultBookContextSettings,
  type ArcEntity,
  type BookContextSettings,
  type GenerationContextType,
} from './persistence'
import { promptVariables } from './prompt-template'
import type { BookPromptValues } from './prompt-template'
import { buildContextValues, type PreparedContextValues } from './context-service'
import { getChat, saveChatContextProfile } from './chat-service'

type Model = { id: string; name?: string; context_length?: number; pricing?: { prompt?: string; completion?: string }; architecture?: { modality?: string } }
type SettingsTab = 'ai' | 'context' | 'appearance' | 'speech' | 'images'
type SaveState = 'loading' | 'saved' | 'saving' | 'error'

const providerLabels: Record<AiProvider, string> = { openrouter: 'OpenRouter', nanogpt: 'nano-gpt.com', openai: 'OpenAI', compatible: 'OpenAI-compatible' }

function endpointFor(settings: AiSettings) {
  if (settings.provider === 'openrouter') return 'https://openrouter.ai/api/v1/models'
  if (settings.provider === 'openai') return 'https://api.openai.com/v1/models'
  if (settings.provider === 'nanogpt') return 'https://nano-gpt.com/api/v1/models?detailed=true&sort=favorites'
  return `${settings.baseUrl.trim().replace(/\/$/, '')}/models`
}
function formatContext(value?: number) {
  if (!value) return 'Context unknown'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 ? 1 : 0)}m context`
  return `${Math.round(value / 1000)}k context`
}

type AiSettingsProps = {
  onHome?: () => void
  onBack?: () => void
  onSaved?: (settings: AiSettings) => void
  book?: { id: string; title: string; contextType?: GenerationContextType; currentDocumentId?: string; currentDocumentText?: string; promptValues?: BookPromptValues; chatId?: string }
}

export default function App({ onHome, onBack, onSaved, book }: AiSettingsProps) {
  const [settings, setSettings] = useState<AiSettings>(initialAiSettings)
  const [models, setModels] = useState<Model[]>([])
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
  const aiLoadedScopeRef = useRef<string | null>(null)
  const aiSavedRef = useRef('')
  const latestAiSettingsRef = useRef(settings)
  const aiSaveTimerRef = useRef<number | null>(null)
  const aiSaveVersionRef = useRef(0)
  const aiSaveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const onSavedRef = useRef(onSaved)
  const contextSaveVersionRef = useRef(0)
  const contextSaveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const isBookSettings = Boolean(book)
  onSavedRef.current = onSaved

  useEffect(() => {
    let cancelled = false
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
      setStatus('Saved AI defaults loaded from this device.')
      setStatusKind('success')
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
        setStatus(`AI settings loaded for “${book.title}”.`)
        setStatusKind('success')
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
      setContextSettings(defaultBookContextSettings)
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

  function persistAiSettings(snapshot: AiSettings, scope: string, version: number) {
    const pending = aiSaveQueueRef.current.catch(() => undefined).then(async () => {
      const savedSettings = scope === 'defaults'
        ? saveAiSettings(snapshot)
        : await saveBookAiSettings(scope, snapshot)
      if (scope !== 'defaults') saveGlobalFavorites(snapshot.favorites)
      if (version !== aiSaveVersionRef.current || scope !== aiLoadedScopeRef.current) return
      aiSavedRef.current = JSON.stringify(snapshot)
      setSaveState('saved')
      setStatus(scope === 'defaults' ? 'AI defaults saved automatically on this device.' : `AI settings saved automatically for “${book?.title ?? 'this book'}”.`)
      setStatusKind('success')
      onSavedRef.current?.(savedSettings)
    })
    aiSaveQueueRef.current = pending
    return pending.catch(() => {
      if (version !== aiSaveVersionRef.current || scope !== aiLoadedScopeRef.current) return
      setSaveState('error')
      setStatus('Settings could not be saved. Your changes are still shown; edit a setting to try again.')
      setStatusKind('error')
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

  async function flushAiSettings() {
    const scope = aiLoadedScopeRef.current
    const snapshot = latestAiSettingsRef.current
    if (!scope || JSON.stringify(snapshot) === aiSavedRef.current) return
    if (aiSaveTimerRef.current !== null) window.clearTimeout(aiSaveTimerRef.current)
    aiSaveTimerRef.current = null
    setSaveState('saving')
    const version = ++aiSaveVersionRef.current
    await persistAiSettings(snapshot, scope, version)
  }

  function update<K extends keyof AiSettings>(key: K, value: AiSettings[K]) { changeAiSettings((current) => ({ ...current, [key]: value })) }
  function selectProvider(provider: AiProvider) {
    changeAiSettings((current) => {
      const baseUrl = provider === 'nanogpt' ? 'https://nano-gpt.com/api/v1' : provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : provider === 'openai' ? 'https://api.openai.com/v1' : current.baseUrl
      return { ...current, provider, baseUrl, mainModel: '', mainModelContextLength: undefined, supportModel: '', supportModelContextLength: undefined, codexModel: '', codexModelContextLength: undefined }
    })
    setModels([]); setStatus('Provider changed. Reload its model list when ready.'); setStatusKind('quiet')
  }
  function selectModel(kind: 'main' | 'support' | 'codex', id: string) {
    const contextLength = models.find((model) => model.id === id)?.context_length
    changeAiSettings((current) => kind === 'main'
      ? { ...current, mainModel: id, mainModelContextLength: contextLength }
      : kind === 'support' ? { ...current, supportModel: id, supportModelContextLength: contextLength } : { ...current, codexModel: id, codexModelContextLength: contextLength })
  }
  async function refreshModels() {
    if (!settings.apiKey.trim()) { setStatus('Enter an API key before loading models.'); setStatusKind('error'); return }
    if (settings.provider === 'compatible' && !settings.baseUrl.trim()) { setStatus('Enter the compatible provider endpoint first.'); setStatusKind('error'); return }
    setLoading(true); setStatus('Contacting the provider…'); setStatusKind('quiet')
    try {
      const response = await fetch(endpointFor(settings), { headers: { Accept: 'application/json', Authorization: `Bearer ${settings.apiKey.trim()}` } })
      const payload = await response.json().catch(() => ({})) as { data?: Model[]; message?: string; error?: { message?: string } }
      if (!response.ok) throw new Error(payload.error?.message || payload.message || `Provider returned ${response.status}.`)
      const nextModels = Array.isArray(payload.data) ? payload.data.filter((model) => typeof model.id === 'string' && model.id.length > 0) : []
      changeAiSettings((current) => ({
        ...current,
        mainModelContextLength: nextModels.find((model) => model.id === current.mainModel)?.context_length ?? current.mainModelContextLength,
        supportModelContextLength: nextModels.find((model) => model.id === current.supportModel)?.context_length ?? current.supportModelContextLength,
        codexModelContextLength: nextModels.find((model) => model.id === current.codexModel)?.context_length ?? current.codexModelContextLength,
      }))
      setModels(nextModels); setStatus(nextModels.length ? `${nextModels.length} models available.` : 'The provider returned no models.'); setStatusKind(nextModels.length ? 'success' : 'error')
    } catch (error) {
      setModels([]); setStatus(error instanceof Error ? error.message : 'Could not load the model list.'); setStatusKind('error')
    } finally { setLoading(false) }
  }
  function toggleFavorite(id: string) { changeAiSettings((current) => ({ ...current, favorites: current.favorites.includes(id) ? current.favorites.filter((favorite) => favorite !== id) : [...current.favorites, id] })) }

  async function resetFromDefaults() {
    if (!book || !window.confirm(`Replace the AI settings for “${book.title}” with the current defaults?`)) return
    try {
      const defaults = loadAiSettings()
      const copied = await copyDefaultAiSettingsToBook(book.id, defaults)
      if (aiSaveTimerRef.current !== null) window.clearTimeout(aiSaveTimerRef.current)
      aiSaveTimerRef.current = null
      aiSaveVersionRef.current += 1
      latestAiSettingsRef.current = copied
      aiSavedRef.current = JSON.stringify(copied)
      setSettings(copied)
      setSaveState('saved')
      setModels([])
      setStatus(`Current defaults copied to “${book.title}”.`)
      setStatusKind('success')
      onSaved?.(copied)
    } catch {
      setStatus('Defaults could not be copied to this book. Try again.')
      setStatusKind('error')
    }
  }

  async function saveContextDefaults() {
    if (!book) return
    const version = ++contextSaveVersionRef.current
    const value = contextSettings
    if (book.contextType === 'chat' && book.chatId) {
      try {
        await saveChatContextProfile(book.chatId, value.profiles.chat)
        if (version === contextSaveVersionRef.current) setContextSaved(true)
      } catch {
        if (version === contextSaveVersionRef.current) setContextSaved(false)
      }
      return
    }
    try {
      const pending = contextSaveQueueRef.current.catch(() => undefined).then(async () => {
        const savedDefaults = await saveBookContextSettings(book.id, value)
        if (version === contextSaveVersionRef.current) {
          setContextSettings(savedDefaults)
          setContextSaved(true)
        }
      })
      contextSaveQueueRef.current = pending
      await pending
    } catch {
      if (version === contextSaveVersionRef.current) setContextSaved(false)
    }
  }

  function updateContextDefaults(value: BookContextSettings) {
    setContextSettings(value)
    setContextSaved(false)
    if (!book) return
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
    if (!destination) return
    await Promise.allSettled([
      flushAiSettings(),
      book && !contextSaved ? saveContextDefaults() : Promise.resolve(),
    ])
    destination()
  }

  return (
    <main className="app-shell">
      <aside className="settings-rail" aria-label={`${isBookSettings ? 'Book' : 'Default'} settings navigation`}>
        <div className="rail-header"><button className="home-button" type="button" aria-label="Back to library" onClick={() => { void leaveSettings(onHome) }}><Home aria-hidden="true" /><b>Home</b></button>{onBack && <button className="settings-close" type="button" onClick={() => { void leaveSettings(onBack) }} aria-label="Close settings"><X aria-hidden="true" /></button>}</div>
        <nav>
          {([['ai', Bot, 'AI'], ['context', SlidersHorizontal, 'Context'], ['appearance', Type, 'UI'], ['speech', Volume2, 'Speech'], ['images', ImageIcon, 'Images']] as const).map(([key, Icon, label]) => (
            <button className={settingsTab === key ? 'active' : ''} type="button" onClick={() => setSettingsTab(key)} key={key}><Icon aria-hidden="true" /><span>{label}</span></button>
          ))}
        </nav>
        <p>{isBookSettings ? `Changes here affect only “${book?.title}”. Favorite models are shared across books.` : 'Defaults are copied into a new book. After that, each book keeps its own settings.'}</p>
      </aside>

      <section className="settings-page" aria-labelledby="page-title">
        {settingsTab === 'ai' ? <>
        <header className="page-heading"><div><p>{isBookSettings ? 'Book AI' : 'Default AI'}</p><h1 id="page-title">Models & prompts</h1><span>{isBookSettings ? `Configure AI for “${book?.title}”. These settings are independent from the defaults.` : 'Configure the writing and support models used when a book is created.'}</span></div><div className={`save-state ${saveState}`} aria-live="polite"><i />{saveState === 'loading' || settingsLoading ? 'Loading' : saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : 'Saved'}</div></header>

        <section className="settings-card provider-card">
          <div className="card-heading"><div><span>01</span><h2>Provider</h2></div><p>Connection details stay in this browser.</p></div>
          <div className="provider-grid">{(Object.keys(providerLabels) as AiProvider[]).map((provider) => <button key={provider} className={settings.provider === provider ? 'selected' : ''} type="button" onClick={() => selectProvider(provider)}><i>{provider === 'nanogpt' ? 'N' : provider === 'openrouter' ? 'O' : provider === 'openai' ? 'AI' : '{ }'}</i><span><strong>{providerLabels[provider]}</strong><small>{provider === 'compatible' ? 'Custom endpoint' : 'Managed endpoint'}</small></span><b>{settings.provider === provider ? '✓' : ''}</b></button>)}</div>
          <div className="connection-fields">
            {settings.provider === 'compatible' && <label><span>Endpoint URL</span><input value={settings.baseUrl} onChange={(event) => update('baseUrl', event.target.value)} placeholder="https://provider.example/v1" /></label>}
            <label><span>API key</span><div className="input-action"><input
              type={showKey ? 'text' : 'password'}
              name="arc-provider-token"
              value={settings.apiKey}
              onChange={(event) => update('apiKey', event.target.value)}
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
          <div className="card-heading"><div><span>02</span><h2>Models</h2></div><p>{isBookSettings ? 'Favorites are shared; model choices belong to this book.' : 'Main writes; Support handles summaries and names.'}</p></div>
          <div className="model-pickers"><label><span>Main model <em>Story generation and fallback</em></span><input list="model-options" value={settings.mainModel} onChange={(event) => selectModel('main', event.target.value)} placeholder={models.length ? 'Search models…' : 'Reload models first'} /></label><label><span>Support model <em>Fast utility tasks</em></span><input list="model-options" value={settings.supportModel} onChange={(event) => selectModel('support', event.target.value)} placeholder={models.length ? 'Search models…' : 'Reload models first'} /></label><label><span>Codex model <em>Optional · uses Main when empty</em></span><input list="model-options" value={settings.codexModel} onChange={(event) => selectModel('codex', event.target.value)} placeholder="Use Main model" /></label><datalist id="model-options">{models.map((model) => <option key={model.id} value={model.id}>{model.name ?? model.id}</option>)}</datalist></div>
          <label className="generation-speed-setting">
            <span><strong>Writing pace</strong><em>Milliseconds per word</em></span>
            <input type="text" inputMode="numeric" pattern="[0-9]*" value={settings.generationWordDelayMs} onChange={(event) => update('generationWordDelayMs', event.target.value)} aria-describedby="generation-speed-help" spellCheck={false} />
            <small id="generation-speed-help">40 ms is the default. Use a lower value for faster writing or a higher value for slower writing (1–2000).</small>
          </label>
          <div className="model-browser"><div className="model-search"><Search aria-hidden="true" /><input value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="Search loaded models" /></div>{models.length ? <div className="model-list">{visibleModels.map((model) => <article key={model.id}><button className={`favorite ${settings.favorites.includes(model.id) ? 'active' : ''}`} type="button" onClick={() => toggleFavorite(model.id)} aria-label={`Favorite ${model.id}`}><Star fill={settings.favorites.includes(model.id) ? 'currentColor' : 'none'} aria-hidden="true" /></button><div><strong>{model.name || model.id}</strong>{model.name && model.name !== model.id && <small>{model.id}</small>}<p><span>{formatContext(model.context_length)}</span><span>{model.architecture?.modality || 'Text'}</span>{model.pricing?.prompt && <span>Pricing supplied</span>}</p></div><button className="use-model" type="button" onClick={() => selectModel('main', model.id)}>Use</button></article>)}</div> : <div className="model-empty"><Bot aria-hidden="true" /><strong>No models loaded</strong><p>Enter your key and reload the provider model list.</p></div>}</div>
        </section>

        <section className="settings-card prompts-card">
          <div className="card-heading"><div><span>03</span><h2>System prompts</h2></div></div>
          <div className="prompt-tabs" role="tablist">{([['story', 'Story'], ['summarize', 'Summarize'], ['titles', 'Titles & names'], ['lore', 'Lore entries'], ['assistant', 'Assistant']] as const).map(([key, label]) => <button key={key} className={promptTab === key ? 'active' : ''} type="button" onClick={() => setPromptTab(key)}>{label}</button>)}</div>
          <textarea className="prompt-editor" value={settings.prompts[promptTab]} onChange={(event) => update('prompts', { ...settings.prompts, [promptTab]: event.target.value })} spellCheck={false} />
          <details className="prompt-reference">
            <summary><CircleHelp aria-hidden="true" /><span>Variables & syntax</span></summary>
            <div className="prompt-syntax"><span>Insert a value</span><code>{'{{book.title}}'}</code><span>Include a block only when a value exists</span><code>{'{% if book.genre %}Genre: {{book.genre}}{% endif %}'}</code></div>
            <div className="prompt-variable-list">{promptVariables.filter((variable) => variable.scopes.includes(promptTab)).map((variable) => <div key={variable.name}><code>{`{{${variable.name}}}`}</code><span>{variable.description}</span></div>)}</div>
          </details>
          <div className="prompt-footer"><button type="button" onClick={() => update('prompts', { ...settings.prompts, [promptTab]: defaultAiPrompts[promptTab] })}>Reset default</button></div>
        </section>
        {book && <footer className="save-bar"><div><strong>{book.title}</strong><span>Changes save automatically</span></div><div className="save-actions"><button className="reset-settings" type="button" onClick={() => { void resetFromDefaults() }} disabled={settingsLoading}><RefreshCw aria-hidden="true" /> Reset from defaults</button></div></footer>}
        </> : settingsTab === 'context' && book ? <ContextSettings bookId={book.id} bookTitle={book.title} bookPromptValues={book.promptValues} type={book.contextType ?? 'scene'} currentDocumentId={book.currentDocumentId} currentDocumentText={book.currentDocumentText} value={contextSettings} sources={contextSources} saved={contextSaved} onChange={updateContextDefaults} /> : <SettingsPlaceholder tab={settingsTab} scope={isBookSettings ? 'book' : 'defaults'} />}
      </section>
    </main>
  )
}

function ContextSettings({ bookId, bookTitle, bookPromptValues, type, currentDocumentId, currentDocumentText, value, sources, saved, onChange }: { bookId: string; bookTitle: string; bookPromptValues?: BookPromptValues; type: GenerationContextType; currentDocumentId?: string; currentDocumentText?: string; value: BookContextSettings; sources: ArcEntity[]; saved: boolean; onChange: (value: BookContextSettings) => void }) {
  const [query, setQuery] = useState('')
  const [preview, setPreview] = useState<PreparedContextValues | null>(null)
  const [previewError, setPreviewError] = useState('')
  const profile = value.profiles[type]
  const updateProfile = (next: typeof profile) => onChange({ ...value, profiles: { ...value.profiles, [type]: next } })
  const toggle = (key: 'structuralIds' | 'noteIds' | 'codexEntryIds', id: string) => updateProfile({ ...profile, [key]: profile[key].includes(id) ? profile[key].filter((item) => item !== id) : [...profile[key], id] })
  const normalized = query.trim().toLowerCase()
  const visible = sources.filter((item) => ['act', 'chapter', 'scene', 'note', 'codexEntry'].includes(item.type) && (type === 'chat' || item.id !== currentDocumentId) && (!normalized || `${item.title ?? ''} ${item.type} ${item.category ?? ''}`.toLowerCase().includes(normalized)))
  const groups = [
    ['Acts & chapters', visible.filter((item) => item.type === 'act' || item.type === 'chapter'), 'structuralIds'],
    ['Scenes', visible.filter((item) => item.type === 'scene'), 'structuralIds'],
    ['Notes', visible.filter((item) => item.type === 'note'), 'noteIds'],
    ['Codex', visible.filter((item) => item.type === 'codexEntry'), 'codexEntryIds'],
  ] as const
  useEffect(() => {
    let cancelled = false
    const currentSceneId = type === 'scene' ? currentDocumentId : value.lastOpenedSceneId || undefined
    void buildContextValues({ bookId, type, currentSceneId, currentSceneText: type === 'scene' ? currentDocumentText : undefined, currentDocumentId, profile }).then((prepared) => {
      if (!cancelled) { setPreview(prepared); setPreviewError('') }
    }).catch(() => {
      if (!cancelled) { setPreview(null); setPreviewError('Context preview could not be prepared.') }
    })
    return () => { cancelled = true }
  }, [bookId, currentDocumentId, currentDocumentText, profile, sources, type, value.lastOpenedSceneId])

  const currentDocument = sources.find((item) => item.id === currentDocumentId)
  const metadata = bookPromptValues ?? { title: bookTitle, series: '', seriesOrder: '', overview: '', genre: '', style: '', pov: '', tense: '', language: '' }
  const metadataText = [
    ['Title', metadata.title], ['Series', metadata.series], ['Series order', metadata.seriesOrder], ['Overview', metadata.overview],
    ['Genre', metadata.genre], ['Style', metadata.style], ['Point of view', metadata.pov], ['Tense', metadata.tense], ['Language', metadata.language],
  ].filter((item) => item[1]).map(([label, content]) => `${label}: ${content}`).join('\n')
  const previewSections = preview ? [
    { title: 'Book metadata', detail: 'Prompt variables', content: metadataText },
    ...(type === 'scene' && preview.previousSceneText ? [{ title: `Previous scene${preview.previousSceneTitle ? ` — ${preview.previousSceneTitle}` : ''}`, detail: 'Empty-scene fallback', content: preview.previousSceneText }] : []),
    ...(type === 'scene' && preview.summaryContext ? [{ title: 'Earlier summaries', detail: 'Automatic', content: preview.summaryContext }] : []),
    ...(type === 'codex' ? [{ title: `Current entry${currentDocument?.title ? ` — ${currentDocument.title}` : ''}`, detail: 'Required', content: currentDocumentText ?? String(currentDocument?.content ?? '') }] : []),
    ...(type === 'codex' && preview.lastSceneText ? [{ title: `Last-opened scene${preview.lastSceneTitle ? ` — ${preview.lastSceneTitle}` : ''}`, detail: 'Automatic', content: preview.lastSceneText }] : []),
    ...(type === 'chat' && preview.lastSceneText ? [{ title: `Current scene${preview.lastSceneTitle ? ` — ${preview.lastSceneTitle}` : ''}`, detail: 'Automatic', content: preview.lastSceneText }] : []),
    ...(preview.additionalContext ? [{ title: 'Additional context', detail: 'Selected', content: preview.additionalContext }] : []),
    ...(type === 'scene' ? [{ title: `Current scene${preview.currentSceneTitle ? ` — ${preview.currentSceneTitle}` : ''}`, detail: 'Required', content: preview.currentSceneText }] : []),
  ] : []
  const exactPreview = previewSections.map((item) => `# ${item.title}\n\n${item.content || '[empty]'}`).join('\n\n')
  return <section className="context-defaults-settings">
    <header className="page-heading"><div><p>{type} generation</p><h1 id="page-title">Context Management</h1><span>Saved independently for {type} generation in “{bookTitle}”.</span></div><div className={`save-state ${saved ? 'saved' : ''}`}><i />{saved ? 'Saved' : 'Saving…'}</div></header>
    <section className="settings-card context-defaults-card"><div className="card-heading"><div><span>01</span><h2>Automatic context</h2></div></div>
      <div className="context-default-locked"><Check aria-hidden="true" /><span><strong>Book metadata</strong><small>Provided through the book prompt variables.</small></span><b>Required</b></div>
      {type === 'scene' ? <><div className="context-default-locked"><Check aria-hidden="true" /><span><strong>Current Scene</strong><small>The active editor content is always included.</small></span><b>Required</b></div><label><input type="checkbox" checked={profile.includePreviousSceneWhenEmpty} onChange={(event) => updateProfile({ ...profile, includePreviousSceneWhenEmpty: event.target.checked })} /><span><strong>Previous Scene when empty</strong><small>Use the immediately previous Scene only when the current Scene has no text.</small></span></label><div className="context-default-locked"><Check aria-hidden="true" /><span><strong>Earlier summaries</strong><small>Uses the highest completed Act or Chapter summary without exposing later material.</small></span><b>Automatic</b></div></> : type === 'codex' ? <><div className="context-default-locked"><Check aria-hidden="true" /><span><strong>Current entry</strong><small>Title, category, and existing body are supplied through lore prompt variables.</small></span><b>Required</b></div><label><input type="checkbox" checked={profile.includeLastScene} onChange={(event) => updateProfile({ ...profile, includeLastScene: event.target.checked })} /><span><strong>Last-opened Scene</strong><small>Included by default for Codex generation.</small></span></label></> : type === 'chat' ? <label><input type="checkbox" checked={profile.includeLastScene} onChange={(event) => updateProfile({ ...profile, includeLastScene: event.target.checked })} /><span><strong>Current Scene</strong><small>The book's last-opened Scene is included automatically for this chat.</small></span></label> : <div className="context-default-locked"><Check aria-hidden="true" /><span><strong>Type-specific sources</strong><small>Automatic sources will be defined when {type} generation is implemented.</small></span><b>Planned</b></div>}
    </section>
    <section className="settings-card context-sources-card"><div className="card-heading"><div><span>02</span><h2>Additional context</h2></div><p>Inserted as <code>{'{{additional_context}}'}</code>.</p></div>
      <fieldset className="summary-range"><legend>Summaries</legend>{([['none','None'],['all','All summaries'],['before','Before current Scene'],['after','After current Scene']] as const).map(([range,label]) => <label key={range}><input type="radio" name="summary-range" checked={profile.summaryRange === range} onChange={() => updateProfile({ ...profile, summaryRange: range })}/><span>{label}</span></label>)}</fieldset>
      <div className="context-source-search"><Search aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find Acts, Chapters, Scenes, Notes, or Codex" /></div>
      <div className="context-managed-list">{groups.map(([label, items, key]) => items.length > 0 && <section key={label}><h3>{label}</h3>{items.map((item) => <label key={item.id}><input type="checkbox" checked={profile[key].includes(item.id)} onChange={() => toggle(key, item.id)} /><span><strong>{item.title || 'Untitled'}</strong><small>{item.type}</small></span></label>)}</section>)}{!visible.length && <p>No matching sources.</p>}</div>
    </section>
    <section className="settings-card context-preview-card"><div className="card-heading"><div><span>03</span><h2>Context to be sent</h2></div><p>Live preview of the material available to the generation prompt.</p></div>
      {previewError ? <p className="context-preview-error" role="alert">{previewError}</p> : preview ? <>
        <div className="context-preview-rendered">{previewSections.map((item) => <section key={`${item.title}-${item.detail}`}><header><h3>{item.title}</h3><span>{item.detail}</span></header>{item.content ? <div className="context-preview-copy">{item.content}</div> : <p className="context-preview-empty">No content will be sent for this section.</p>}</section>)}</div>
        <details className="context-preview-raw"><summary>View exact context text</summary><pre>{exactPreview}</pre></details>
      </> : <p className="context-preview-empty">Preparing preview…</p>}
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

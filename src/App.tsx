import { useEffect, useMemo, useState } from 'react'
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
  getBookContextDefaults,
  getBookAiSettings,
  saveBookContextDefaults,
  saveBookAiSettings,
  defaultBookContextDefaults,
  type BookContextDefaults,
} from './persistence'
import { promptVariables } from './prompt-template'

type Model = { id: string; name?: string; context_length?: number; pricing?: { prompt?: string; completion?: string }; architecture?: { modality?: string } }
type SettingsTab = 'ai' | 'context' | 'appearance' | 'speech' | 'images'

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
  book?: { id: string; title: string }
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
  const [saved, setSaved] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('ai')
  const [settingsLoading, setSettingsLoading] = useState(Boolean(book))
  const [contextDefaults, setContextDefaults] = useState<BookContextDefaults>(defaultBookContextDefaults)
  const [contextSaved, setContextSaved] = useState(true)
  const isBookSettings = Boolean(book)

  useEffect(() => {
    let cancelled = false
    const defaults = loadAiSettings()
    if (!book) {
      setSettings(defaults)
      setStatus('Saved AI defaults loaded from this device.')
      setStatusKind('success')
      setSettingsLoading(false)
      return () => { cancelled = true }
    }

    setSettingsLoading(true)
    ;(async () => {
      try {
        await ensureBookAiSettings(book.id, defaults)
        const bookSettings = await getBookAiSettings(book.id, defaults.favorites)
        if (cancelled) return
        setSettings(bookSettings)
        setStatus(`AI settings loaded for “${book.title}”.`)
        setStatusKind('success')
      } catch {
        if (cancelled) return
        setSettings(defaults)
        setStatus('Book settings could not be read. No changes have been saved.')
        setStatusKind('error')
      } finally {
        if (!cancelled) setSettingsLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [book?.id, book?.title])

  useEffect(() => {
    let cancelled = false
    if (!book) {
      setContextDefaults(defaultBookContextDefaults)
      setContextSaved(true)
      return () => { cancelled = true }
    }
    void getBookContextDefaults(book.id).then((value) => {
      if (!cancelled) {
        setContextDefaults(value)
        setContextSaved(true)
      }
    })
    return () => { cancelled = true }
  }, [book?.id])

  const visibleModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase()
    return models.filter((model) => !query || `${model.id} ${model.name ?? ''}`.toLowerCase().includes(query)).sort((a, b) => Number(settings.favorites.includes(b.id)) - Number(settings.favorites.includes(a.id))).slice(0, 8)
  }, [modelSearch, models, settings.favorites])

  function update<K extends keyof AiSettings>(key: K, value: AiSettings[K]) { setSettings((current) => ({ ...current, [key]: value })); setSaved(false) }
  function selectProvider(provider: AiProvider) {
    const baseUrl = provider === 'nanogpt' ? 'https://nano-gpt.com/api/v1' : provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : provider === 'openai' ? 'https://api.openai.com/v1' : settings.baseUrl
    setSettings((current) => ({ ...current, provider, baseUrl, mainModel: '', mainModelContextLength: undefined, supportModel: '', supportModelContextLength: undefined }))
    setModels([]); setStatus('Provider changed. Reload its model list when ready.'); setStatusKind('quiet'); setSaved(false)
  }
  function selectModel(kind: 'main' | 'support', id: string) {
    const contextLength = models.find((model) => model.id === id)?.context_length
    setSettings((current) => kind === 'main'
      ? { ...current, mainModel: id, mainModelContextLength: contextLength }
      : { ...current, supportModel: id, supportModelContextLength: contextLength })
    setSaved(false)
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
      setSettings((current) => ({
        ...current,
        mainModelContextLength: nextModels.find((model) => model.id === current.mainModel)?.context_length ?? current.mainModelContextLength,
        supportModelContextLength: nextModels.find((model) => model.id === current.supportModel)?.context_length ?? current.supportModelContextLength,
      }))
      if (nextModels.some((model) => model.id === settings.mainModel || model.id === settings.supportModel)) setSaved(false)
      setModels(nextModels); setStatus(nextModels.length ? `${nextModels.length} models available.` : 'The provider returned no models.'); setStatusKind(nextModels.length ? 'success' : 'error')
    } catch (error) {
      setModels([]); setStatus(error instanceof Error ? error.message : 'Could not load the model list.'); setStatusKind('error')
    } finally { setLoading(false) }
  }
  function toggleFavorite(id: string) { update('favorites', settings.favorites.includes(id) ? settings.favorites.filter((favorite) => favorite !== id) : [...settings.favorites, id]) }
  async function saveSettings() {
    try {
      const savedSettings = book
        ? await saveBookAiSettings(book.id, settings)
        : saveAiSettings(settings)
      if (book) saveGlobalFavorites(settings.favorites)
      setSettings(savedSettings)
      setSaved(true)
      setStatus(book ? `AI settings saved for “${book.title}”.` : 'AI defaults saved on this device. New books will copy them.')
      setStatusKind('success')
      onSaved?.(savedSettings)
    } catch {
      setStatus('Settings could not be saved. Try again.')
      setStatusKind('error')
    }
  }

  async function resetFromDefaults() {
    if (!book || !window.confirm(`Replace the AI settings for “${book.title}” with the current defaults?`)) return
    try {
      const defaults = loadAiSettings()
      const copied = await copyDefaultAiSettingsToBook(book.id, defaults)
      setSettings(copied)
      setSaved(true)
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
    try {
      const savedDefaults = await saveBookContextDefaults(book.id, contextDefaults)
      setContextDefaults(savedDefaults)
      setContextSaved(true)
    } catch {
      setContextSaved(false)
    }
  }

  return (
    <main className="app-shell">
      <aside className="settings-rail" aria-label={`${isBookSettings ? 'Book' : 'Default'} settings navigation`}>
        <div className="rail-header"><button className="home-button" type="button" aria-label="Back to library" onClick={onHome}><Home aria-hidden="true" /><b>Home</b></button>{onBack && <button className="settings-close" type="button" onClick={onBack} aria-label="Close settings"><X aria-hidden="true" /></button>}</div>
        <nav>
          {([['ai', Bot, 'AI'], ['context', SlidersHorizontal, 'Context'], ['appearance', Type, 'UI'], ['speech', Volume2, 'Speech'], ['images', ImageIcon, 'Images']] as const).map(([key, Icon, label]) => (
            <button className={settingsTab === key ? 'active' : ''} type="button" onClick={() => setSettingsTab(key)} key={key}><Icon aria-hidden="true" /><span>{label}</span></button>
          ))}
        </nav>
        <p>{isBookSettings ? `Changes here affect only “${book?.title}”. Favorite models are shared across books.` : 'Defaults are copied into a new book. After that, each book keeps its own settings.'}</p>
      </aside>

      <section className="settings-page" aria-labelledby="page-title">
        {settingsTab === 'ai' ? <>
        <header className="page-heading"><div><p>{isBookSettings ? 'Book AI' : 'Default AI'}</p><h1 id="page-title">Models & prompts</h1><span>{isBookSettings ? `Configure AI for “${book?.title}”. These settings are independent from the defaults.` : 'Configure the writing and support models used when a book is created.'}</span></div><div className={`save-state ${saved ? 'saved' : ''}`}><i />{settingsLoading ? 'Loading' : saved ? 'Saved' : 'Unsaved changes'}</div></header>

        <section className="settings-card provider-card">
          <div className="card-heading"><div><span>01</span><h2>Provider</h2></div><p>Connection details stay in this browser.</p></div>
          <div className="provider-grid">{(Object.keys(providerLabels) as AiProvider[]).map((provider) => <button key={provider} className={settings.provider === provider ? 'selected' : ''} type="button" onClick={() => selectProvider(provider)}><i>{provider === 'nanogpt' ? 'N' : provider === 'openrouter' ? 'O' : provider === 'openai' ? 'AI' : '{ }'}</i><span><strong>{providerLabels[provider]}</strong><small>{provider === 'compatible' ? 'Custom endpoint' : 'Managed endpoint'}</small></span><b>{settings.provider === provider ? '✓' : ''}</b></button>)}</div>
          <div className="connection-fields">
            {settings.provider === 'compatible' && <label><span>Endpoint URL</span><input value={settings.baseUrl} onChange={(event) => update('baseUrl', event.target.value)} placeholder="https://provider.example/v1" /></label>}
            <label><span>API key</span><div className="input-action"><input type={showKey ? 'text' : 'password'} value={settings.apiKey} onChange={(event) => update('apiKey', event.target.value)} placeholder="Enter API key" autoComplete="off" spellCheck={false} /><button type="button" onClick={() => setShowKey((value) => !value)}>{showKey ? 'Hide' : 'Show'}</button></div></label>
            <button className="reload-button" type="button" onClick={refreshModels} disabled={loading}><RefreshCw className={loading ? 'spinning' : ''} aria-hidden="true" />{loading ? 'Loading models…' : 'Reload model list'}</button>
          </div>
          <p className={`status ${statusKind}`} role="status"><i />{status}</p>
        </section>

        <section className="settings-card models-card">
          <div className="card-heading"><div><span>02</span><h2>Models</h2></div><p>{isBookSettings ? 'Favorites are shared; model choices belong to this book.' : 'Main writes; Support handles summaries and names.'}</p></div>
          <div className="model-pickers"><label><span>Main model <em>Story generation</em></span><input list="model-options" value={settings.mainModel} onChange={(event) => selectModel('main', event.target.value)} placeholder={models.length ? 'Search models…' : 'Reload models first'} /></label><label><span>Support model <em>Fast utility tasks</em></span><input list="model-options" value={settings.supportModel} onChange={(event) => selectModel('support', event.target.value)} placeholder={models.length ? 'Search models…' : 'Reload models first'} /></label><datalist id="model-options">{models.map((model) => <option key={model.id} value={model.id}>{model.name ?? model.id}</option>)}</datalist></div>
          <div className="model-browser"><div className="model-search"><Search aria-hidden="true" /><input value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="Search loaded models" /></div>{models.length ? <div className="model-list">{visibleModels.map((model) => <article key={model.id}><button className={`favorite ${settings.favorites.includes(model.id) ? 'active' : ''}`} type="button" onClick={() => toggleFavorite(model.id)} aria-label={`Favorite ${model.id}`}><Star fill={settings.favorites.includes(model.id) ? 'currentColor' : 'none'} aria-hidden="true" /></button><div><strong>{model.name || model.id}</strong>{model.name && model.name !== model.id && <small>{model.id}</small>}<p><span>{formatContext(model.context_length)}</span><span>{model.architecture?.modality || 'Text'}</span>{model.pricing?.prompt && <span>Pricing supplied</span>}</p></div><button className="use-model" type="button" onClick={() => selectModel('main', model.id)}>Use</button></article>)}</div> : <div className="model-empty"><Bot aria-hidden="true" /><strong>No models loaded</strong><p>Enter your key and reload the provider model list.</p></div>}</div>
        </section>

        <section className="settings-card prompts-card">
          <div className="card-heading"><div><span>03</span><h2>System prompts</h2></div></div>
          <div className="prompt-tabs" role="tablist">{([['story', 'Story'], ['summarize', 'Summarize'], ['titles', 'Titles & names']] as const).map(([key, label]) => <button key={key} className={promptTab === key ? 'active' : ''} type="button" onClick={() => setPromptTab(key)}>{label}</button>)}</div>
          <textarea className="prompt-editor" value={settings.prompts[promptTab]} onChange={(event) => update('prompts', { ...settings.prompts, [promptTab]: event.target.value })} spellCheck={false} />
          <details className="prompt-reference">
            <summary><CircleHelp aria-hidden="true" /><span>Variables & syntax</span></summary>
            <div className="prompt-syntax"><span>Insert a value</span><code>{'{{book.title}}'}</code><span>Include a block only when a value exists</span><code>{'{% if book.genre %}Genre: {{book.genre}}{% endif %}'}</code></div>
            <div className="prompt-variable-list">{promptVariables.filter((variable) => variable.scopes.includes(promptTab)).map((variable) => <div key={variable.name}><code>{`{{${variable.name}}}`}</code><span>{variable.description}</span></div>)}</div>
          </details>
          <div className="prompt-footer"><button type="button" onClick={() => update('prompts', { ...settings.prompts, [promptTab]: defaultAiPrompts[promptTab] })}>Reset default</button></div>
        </section>
        <footer className="save-bar"><div><strong>{isBookSettings ? book?.title : 'AI defaults'}</strong><span>{isBookSettings ? 'Independent book configuration' : settings.mainModel ? 'Ready to save for new books' : 'Choose models now or save them later'}</span></div><div className="save-actions">{book && <button className="reset-settings" type="button" onClick={() => { void resetFromDefaults() }} disabled={settingsLoading}><RefreshCw aria-hidden="true" /> Reset from defaults</button>}<button type="button" onClick={() => { void saveSettings() }} disabled={settingsLoading}><Check aria-hidden="true" /> {isBookSettings ? 'Save book settings' : 'Save defaults'}</button></div></footer>
        </> : settingsTab === 'context' && book ? <ContextDefaultsSettings bookTitle={book.title} value={contextDefaults} saved={contextSaved} onChange={(value) => { setContextDefaults(value); setContextSaved(false) }} onSave={() => { void saveContextDefaults() }} /> : <SettingsPlaceholder tab={settingsTab} scope={isBookSettings ? 'book' : 'defaults'} />}
      </section>
    </main>
  )
}

function ContextDefaultsSettings({ bookTitle, value, saved, onChange, onSave }: {
  bookTitle: string
  value: BookContextDefaults
  saved: boolean
  onChange: (value: BookContextDefaults) => void
  onSave: () => void
}) {
  return <section className="context-defaults-settings">
    <header className="page-heading"><div><p>Book context</p><h1 id="page-title">Generation defaults</h1><span>Automatic sources for every scene in “{bookTitle}”. Notes and Codex selections stay scene-specific.</span></div><div className={`save-state ${saved ? 'saved' : ''}`}><i />{saved ? 'Saved' : 'Unsaved changes'}</div></header>
    <section className="settings-card context-defaults-card">
      <div className="card-heading"><div><span>01</span><h2>Automatic context</h2></div><p>Current scene is always included and cannot be disabled.</p></div>
      <div className="context-default-locked"><Check aria-hidden="true" /><span><strong>Whole current scene</strong><small>When empty, the full immediately previous scene is included instead.</small></span><b>Required</b></div>
      <label><input type="checkbox" checked={value.includePreviousScene} onChange={(event) => onChange({ ...value, includePreviousScene: event.target.checked })} /><span><strong>Full previous scene</strong><small>Off by default; automatically included whenever the current scene is empty.</small></span></label>
      <label><input type="checkbox" checked={value.includePreviousSummaries} onChange={(event) => onChange({ ...value, includePreviousSummaries: event.target.checked })} /><span><strong>All previous scene summaries</strong><small>A summary is skipped when that scene’s full text is already present.</small></span></label>
      <label><input type="checkbox" checked={value.includeChapterSummary} onChange={(event) => onChange({ ...value, includeChapterSummary: event.target.checked })} /><span><strong>Current chapter summary</strong><small>Included only when a persisted summary exists.</small></span></label>
      <label><input type="checkbox" checked={value.includeActSummary} onChange={(event) => onChange({ ...value, includeActSummary: event.target.checked })} /><span><strong>Current act summary</strong><small>Included only when the chapter belongs to an Act with a summary.</small></span></label>
    </section>
    <footer className="save-bar"><div><strong>{bookTitle}</strong><span>Context budget is derived from the selected Main model.</span></div><button type="button" onClick={onSave}><Check aria-hidden="true" /> Save context defaults</button></footer>
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

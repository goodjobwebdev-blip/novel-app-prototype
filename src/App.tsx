import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Bot,
  Check,
  CircleHelp,
  Home,
  Image as ImageIcon,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Star,
  Type,
  Volume2,
} from 'lucide-react'

type Provider = 'openrouter' | 'nanogpt' | 'openai' | 'compatible'
type Model = { id: string; name?: string; context_length?: number; pricing?: { prompt?: string; completion?: string }; architecture?: { modality?: string } }
type Prompts = { story: string; summarize: string; titles: string }
type Settings = { provider: Provider; apiKey: string; baseUrl: string; mainModel: string; supportModel: string; favorites: string[]; prompts: Prompts }
type SettingsTab = 'ai' | 'context' | 'appearance' | 'speech' | 'images'

const STORAGE_KEY = 'arc-ai-defaults-v1'
const defaultPrompts: Prompts = {
  story: `You are the story writer for {{book.title}}.

{% if scene.pov %}
Stay close to {{scene.pov}} and preserve the established voice.
{% endif %}

Continue from {{scene.text}} without summarizing it.`,
  summarize: `Summarize {{target.type}} for future story context.

Keep names, decisions, promises, and unresolved questions.
{% if target.previous_summary %}
Update the existing summary instead of starting over.
{% endif %}`,
  titles: `Generate concise names or titles for {{target.type}}.

Tone: {{book.style}}
Return {{count}} distinct options without commentary.`,
}
const initialSettings: Settings = { provider: 'nanogpt', apiKey: '', baseUrl: 'https://nano-gpt.com/api/v1', mainModel: '', supportModel: '', favorites: [], prompts: defaultPrompts }
const providerLabels: Record<Provider, string> = { openrouter: 'OpenRouter', nanogpt: 'nano-gpt.com', openai: 'OpenAI', compatible: 'OpenAI-compatible' }

function endpointFor(settings: Settings) {
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
  onSaved?: () => void
}

export default function App({ onHome, onBack, onSaved }: AiSettingsProps) {
  const [settings, setSettings] = useState<Settings>(initialSettings)
  const [models, setModels] = useState<Model[]>([])
  const [promptTab, setPromptTab] = useState<keyof Prompts>('story')
  const [modelSearch, setModelSearch] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('Add an API key, then reload the model list.')
  const [statusKind, setStatusKind] = useState<'quiet' | 'success' | 'error'>('quiet')
  const [saved, setSaved] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('ai')

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return
    try {
      const parsed = JSON.parse(stored) as Partial<Settings>
      setSettings({ ...initialSettings, ...parsed, prompts: { ...defaultPrompts, ...parsed.prompts }, favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [] })
      setStatus('Saved AI defaults loaded from this device.')
      setStatusKind('success')
    } catch {
      setStatus('Saved settings could not be read. Using defaults.')
      setStatusKind('error')
    }
  }, [])

  const visibleModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase()
    return models.filter((model) => !query || `${model.id} ${model.name ?? ''}`.toLowerCase().includes(query)).sort((a, b) => Number(settings.favorites.includes(b.id)) - Number(settings.favorites.includes(a.id))).slice(0, 8)
  }, [modelSearch, models, settings.favorites])

  function update<K extends keyof Settings>(key: K, value: Settings[K]) { setSettings((current) => ({ ...current, [key]: value })); setSaved(false) }
  function selectProvider(provider: Provider) {
    const baseUrl = provider === 'nanogpt' ? 'https://nano-gpt.com/api/v1' : provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : provider === 'openai' ? 'https://api.openai.com/v1' : settings.baseUrl
    setSettings((current) => ({ ...current, provider, baseUrl, mainModel: '', supportModel: '' }))
    setModels([]); setStatus('Provider changed. Reload its model list when ready.'); setStatusKind('quiet'); setSaved(false)
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
      setModels(nextModels); setStatus(nextModels.length ? `${nextModels.length} models available.` : 'The provider returned no models.'); setStatusKind(nextModels.length ? 'success' : 'error')
    } catch (error) {
      setModels([]); setStatus(error instanceof Error ? error.message : 'Could not load the model list.'); setStatusKind('error')
    } finally { setLoading(false) }
  }
  function toggleFavorite(id: string) { update('favorites', settings.favorites.includes(id) ? settings.favorites.filter((favorite) => favorite !== id) : [...settings.favorites, id]) }
  function saveDefaults() { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); setSaved(true); setStatus('AI defaults saved on this device. New books will copy them.'); setStatusKind('success'); onSaved?.() }

  return (
    <main className="app-shell">
      <aside className="settings-rail" aria-label="Default settings navigation">
        <div className="rail-header"><button className="home-button" type="button" aria-label="Back to library" onClick={onHome}><Home aria-hidden="true" /><b>Home</b></button><div><small>Defaults</small><strong>New books</strong></div></div>
        <nav>
          {([['ai', Bot, 'AI'], ['context', SlidersHorizontal, 'Context'], ['appearance', Type, 'UI'], ['speech', Volume2, 'Speech'], ['images', ImageIcon, 'Images']] as const).map(([key, Icon, label]) => (
            <button className={settingsTab === key ? 'active' : ''} type="button" onClick={() => setSettingsTab(key)} key={key}><Icon aria-hidden="true" /><span>{label}</span></button>
          ))}
        </nav>
        <p>Defaults are copied into a new book. After that, each book keeps its own settings.</p>
      </aside>

      <section className="settings-page" aria-labelledby="page-title">
        {onBack && <button className="settings-back" type="button" onClick={onBack}><ArrowLeft aria-hidden="true" /> Back to book</button>}
        {settingsTab === 'ai' ? <>
        <header className="page-heading"><div><p>Default AI</p><h1 id="page-title">Models & prompts</h1><span>Configure the writing and support models used when a book is created.</span></div><div className={`save-state ${saved ? 'saved' : ''}`}><i />{saved ? 'Saved' : 'Unsaved changes'}</div></header>

        <section className="settings-card provider-card">
          <div className="card-heading"><div><span>01</span><h2>Provider</h2></div><p>Connection details stay in this browser.</p></div>
          <div className="provider-grid">{(Object.keys(providerLabels) as Provider[]).map((provider) => <button key={provider} className={settings.provider === provider ? 'selected' : ''} type="button" onClick={() => selectProvider(provider)}><i>{provider === 'nanogpt' ? 'N' : provider === 'openrouter' ? 'O' : provider === 'openai' ? 'AI' : '{ }'}</i><span><strong>{providerLabels[provider]}</strong><small>{provider === 'compatible' ? 'Custom endpoint' : 'Managed endpoint'}</small></span><b>{settings.provider === provider ? '✓' : ''}</b></button>)}</div>
          <div className="connection-fields">
            {settings.provider === 'compatible' && <label><span>Endpoint URL</span><input value={settings.baseUrl} onChange={(event) => update('baseUrl', event.target.value)} placeholder="https://provider.example/v1" /></label>}
            <label><span>API key</span><div className="input-action"><input type={showKey ? 'text' : 'password'} value={settings.apiKey} onChange={(event) => update('apiKey', event.target.value)} placeholder="Enter API key" autoComplete="off" spellCheck={false} /><button type="button" onClick={() => setShowKey((value) => !value)}>{showKey ? 'Hide' : 'Show'}</button></div></label>
            <button className="reload-button" type="button" onClick={refreshModels} disabled={loading}><RefreshCw className={loading ? 'spinning' : ''} aria-hidden="true" />{loading ? 'Loading models…' : 'Reload model list'}</button>
          </div>
          <p className={`status ${statusKind}`} role="status"><i />{status}</p>
        </section>

        <section className="settings-card models-card">
          <div className="card-heading"><div><span>02</span><h2>Models</h2></div><p>Main writes; Support handles summaries and names.</p></div>
          <div className="model-pickers"><label><span>Main model <em>Story generation</em></span><input list="model-options" value={settings.mainModel} onChange={(event) => update('mainModel', event.target.value)} placeholder={models.length ? 'Search models…' : 'Reload models first'} /></label><label><span>Support model <em>Fast utility tasks</em></span><input list="model-options" value={settings.supportModel} onChange={(event) => update('supportModel', event.target.value)} placeholder={models.length ? 'Search models…' : 'Reload models first'} /></label><datalist id="model-options">{models.map((model) => <option key={model.id} value={model.id}>{model.name ?? model.id}</option>)}</datalist></div>
          <div className="model-browser"><div className="model-search"><Search aria-hidden="true" /><input value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="Search loaded models" /></div>{models.length ? <div className="model-list">{visibleModels.map((model) => <article key={model.id}><button className={`favorite ${settings.favorites.includes(model.id) ? 'active' : ''}`} type="button" onClick={() => toggleFavorite(model.id)} aria-label={`Favorite ${model.id}`}><Star fill={settings.favorites.includes(model.id) ? 'currentColor' : 'none'} aria-hidden="true" /></button><div><strong>{model.name || model.id}</strong>{model.name && model.name !== model.id && <small>{model.id}</small>}<p><span>{formatContext(model.context_length)}</span><span>{model.architecture?.modality || 'Text'}</span>{model.pricing?.prompt && <span>Pricing supplied</span>}</p></div><button className="use-model" type="button" onClick={() => update('mainModel', model.id)}>Use</button></article>)}</div> : <div className="model-empty"><Bot aria-hidden="true" /><strong>No models loaded</strong><p>Enter your key and reload the provider model list.</p></div>}</div>
        </section>

        <section className="settings-card prompts-card">
          <div className="card-heading"><div><span>03</span><h2>System prompts</h2></div><button className="help-button" type="button" title="Use {{variable}} for values and {% if condition %}…{% endif %} for optional instructions."><CircleHelp aria-hidden="true" /><b>Prompt syntax</b></button></div>
          <div className="prompt-tabs" role="tablist">{([['story', 'Story'], ['summarize', 'Summarize'], ['titles', 'Titles & names']] as const).map(([key, label]) => <button key={key} className={promptTab === key ? 'active' : ''} type="button" onClick={() => setPromptTab(key)}>{label}</button>)}</div>
          <textarea className="prompt-editor" value={settings.prompts[promptTab]} onChange={(event) => update('prompts', { ...settings.prompts, [promptTab]: event.target.value })} spellCheck={false} />
          <div className="prompt-footer"><span>Variables: <code>{'{{book.title}}'}</code> <code>{'{{scene.pov}}'}</code> <code>{'{{target.type}}'}</code></span><button type="button" onClick={() => update('prompts', { ...settings.prompts, [promptTab]: defaultPrompts[promptTab] })}>Reset default</button></div>
        </section>
        <footer className="save-bar"><div><strong>AI defaults</strong><span>{settings.mainModel ? 'Ready to save for new books' : 'Choose models now or save them later'}</span></div><button type="button" onClick={saveDefaults}><Check aria-hidden="true" /> Save defaults</button></footer>
        </> : <SettingsPlaceholder tab={settingsTab} />}
      </section>
    </main>
  )
}

function SettingsPlaceholder({ tab }: { tab: Exclude<SettingsTab, 'ai'> }) {
  const content = {
    context: { Icon: SlidersHorizontal, eyebrow: 'Context', title: 'Context management', description: 'Control how scenes, summaries, notes, and Codex entries are assembled for generation.', items: ['Context budget and priority', 'Automatic summary selection', 'Include or exclude book sources'] },
    appearance: { Icon: Type, eyebrow: 'UI', title: 'Reading surface', description: 'Choose editor typography, spacing, themes, and motion preferences.', items: ['Editor font, size, and line height', 'Paragraph spacing and first-line indent', 'Theme library and custom theme editor'] },
    speech: { Icon: Volume2, eyebrow: 'Speech', title: 'Speech settings', description: 'Configure dictation for the editor and Arc, plus read-aloud voices.', items: ['Dictation language and microphone', 'Editor and Arc insertion behavior', 'Read-aloud voice and speed'] },
    images: { Icon: ImageIcon, eyebrow: 'Images', title: 'Image settings', description: 'Set defaults for character, location, and reference image generation.', items: ['Image provider and model', 'Default style and aspect ratio', 'Storage and attachment preferences'] },
  }[tab]
  const Icon = content.Icon
  return <section className="placeholder-settings">
    <div className="page-heading"><div><p>{content.eyebrow}</p><h1 id="page-title">{content.title}</h1><span>{content.description}</span></div><Icon aria-hidden="true" /></div>
    <div className="settings-card placeholder-card"><Icon aria-hidden="true" /><strong>Reserved for a later implementation</strong><p>This screen is part of the approved settings structure. Its controls are intentionally placeholders for now.</p><ul>{content.items.map((item) => <li key={item}>{item}</li>)}</ul></div>
  </section>
}

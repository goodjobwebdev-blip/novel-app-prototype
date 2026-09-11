import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import type { AiSettings } from './ai-settings'
import type { ImageModel, ImageProvider, ImageSettings, OpenAIImageQuality, OpenAIImageModeration } from './image-generation-types'
import { documentedImageModels, imageSize, imageFavorite, imageProviderNames, imageRatio, IMAGE_PROVIDERS, loadImageSettings, resolveImageKey, saveImageSettings } from './image-settings'
import { fetchImageModels } from './image-providers'
export type ImageSettingsPanelRef = { save(): boolean; discard(): void; isDirty(): boolean }
export type ImageSettingsPanelProps = { ai: AiSettings; onDirtyChange?: (dirty: boolean) => void }

const ImageSettingsPanel = forwardRef<ImageSettingsPanelRef, ImageSettingsPanelProps>(function ImageSettingsPanel({ ai, onDirtyChange }, ref) {
  const [settings, setSettings] = useState<ImageSettings>(loadImageSettings)
  const [provider, setProvider] = useState<ImageProvider>('nanogpt'), [query, setQuery] = useState('')
  const [catalogs, setCatalogs] = useState<Partial<Record<ImageProvider, ImageModel[]>>>(() => { try { const data = JSON.parse(localStorage.getItem('arc-image-catalog-v1') || '{}'); return Object.fromEntries(IMAGE_PROVIDERS.filter((p) => Array.isArray(data?.[p])).map((p) => [p, data[p].filter((m: ImageModel) => m?.provider === p && typeof m.id === 'string' && typeof m.name === 'string' && Array.isArray(m.sizes) && m.sizes.length && m.sizes.every((s) => typeof s?.value === 'string' && imageSize(s.value)))])) } catch { return {} } })
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [dirty, setDirty] = useState(false)
  const [editingFavorite, setEditingFavorite] = useState<number | null>(settings.favorites.length ? 0 : null)
  const change = (value: ImageSettings) => { setSettings(value); setDirty(true); setMessage('') }
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  const models = provider === 'pruna' ? documentedImageModels.filter((m) => m.provider === provider) : catalogs[provider] ?? documentedImageModels.filter((m) => m.provider === provider)
  const refresh = async () => {
    setBusy(true); setError('')
    const selectedProvider = provider
    try {
      const models = await fetchImageModels(selectedProvider, resolveImageKey(selectedProvider, settings, ai))
      const next = { ...catalogs, [selectedProvider]: models }
      setCatalogs(next)
      try { localStorage.setItem('arc-image-catalog-v1', JSON.stringify(next)) } catch { /* Favorites can still be saved separately. */ }
      setMessage(selectedProvider === 'pruna' ? `${models.length} documented Pruna text-to-image models loaded.` : `${models.length} text-to-image models with supported sizes loaded.`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Models could not be loaded.') }
    finally { setBusy(false) }
  }
  const save = () => {
    try { setSettings(saveImageSettings(settings)); setDirty(false); setMessage('Image settings saved'); setError(''); return true }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Settings could not be saved.'); return false }
  }
  const discard = () => { const saved = loadImageSettings(); setSettings(saved); setDirty(false); setError(''); setMessage('Changes discarded'); setEditingFavorite(saved.favorites.length ? 0 : null) }
  useImperativeHandle(ref, () => ({ save, discard, isDirty: () => dirty }), [dirty, settings])
  return <section className="image-settings image-ui">
    <h1 id="page-title">Image generation</h1>
    <p className="image-help">Configure device-global image providers and favorite models. These settings apply to every book on this device. Save changes before generating.</p>
    <details className="image-settings-section" open={!settings.favorites.length}>
      <summary>Provider API keys</summary>
      <div className="image-provider-fields">{IMAGE_PROVIDERS.map((p) => <label key={p}>
        {imageProviderNames[p]} API key
        <input type="password" autoComplete="off" value={settings.keys[p]} placeholder={p === 'pruna' ? 'Enter Pruna API key' : 'Use this provider’s AI-settings key'} onChange={(e) => change({ ...settings, keys: { ...settings.keys, [p]: e.target.value } })} />
        <small>{settings.keys[p] ? 'Using the image key' : p !== 'pruna' && resolveImageKey(p, settings, ai) ? 'Using saved AI-settings key' : 'No key configured'}</small>
      </label>)}</div>
    </details>
    <h2>Favorite models</h2>
    <details className="image-settings-section" open={!settings.favorites.length}>
      <summary>Add a favorite model</summary>
      <div className="image-model-discovery">
        <label>Provider<select value={provider} onChange={(e) => { setProvider(e.target.value as ImageProvider); setQuery('') }}>{IMAGE_PROVIDERS.map((p) => <option key={p} value={p}>{imageProviderNames[p]}</option>)}</select></label>
        <button type="button" disabled={busy} onClick={() => { void refresh() }}>{busy ? 'Loading models…' : provider === 'pruna' ? 'Load documented models' : 'Refresh models'}</button>
      </div>
      <label>Find a model<input type="search" placeholder="Search models" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      <div className="image-catalog">{models.filter((m) => `${m.id} ${m.name}`.toLowerCase().includes(query.toLowerCase())).slice(0, 100).map((m) => <div key={m.id}>
        <span>{m.name}<small>{m.id}{m.cost != null ? ` · $${m.cost.toFixed(4)} per image` : ''}</small>{m.description && <small>{m.description}</small>}</span>
        <button type="button" disabled={settings.favorites.some((f) => f.provider === m.provider && f.id === m.id)} onClick={() => change({ ...settings, favorites: [...settings.favorites, imageFavorite(m, settings.favorites)] })}>Favorite</button>
      </div>)}{!models.length && <p>Refresh models to discover supported image sizes.</p>}</div>
    </details>
    {settings.favorites.map((f, index) => {
      const update = (patch: Partial<typeof f>) => change({ ...settings, favorites: settings.favorites.map((m, i) => i === index ? { ...m, ...patch } : m) })
      const discovered = (f.provider === 'pruna' ? documentedImageModels : catalogs[f.provider])?.find((m) => m.id === f.id)
      return <details className="image-favorite" open={editingFavorite === index} onToggle={(event) => { if (event.currentTarget.open && editingFavorite !== index) setEditingFavorite(index); else if (!event.currentTarget.open && editingFavorite === index) setEditingFavorite(null) }} key={`${f.provider}/${f.id}`}>
        <summary className="image-favorite-heading"><span><small>{imageProviderNames[f.provider]}{(discovered?.cost ?? f.cost) != null ? ` · $${(discovered?.cost ?? f.cost)!.toFixed(4)} per image` : ''}</small><strong>{f.name}</strong>{(discovered?.description ?? f.description) && <small>{discovered?.description ?? f.description}</small>}</span></summary>
        <label>Chat model alias<input maxLength={64} value={f.alias} onChange={(e) => { const alias = e.target.value; change({ ...settings, defaultAlias: settings.defaultAlias === f.alias ? alias : settings.defaultAlias, favorites: settings.favorites.map((m, i) => i === index ? { ...m, alias } : m) }) }} /></label>
        <label className="image-check image-default-choice"><input type="radio" name="default-image-model" checked={settings.defaultAlias === f.alias || (!settings.defaultAlias && index === 0)} onChange={() => change({ ...settings, defaultAlias: f.alias })} /><span>Default image model</span></label>
        <fieldset className="image-size-options">
          <legend>Enabled ratios and sizes <small>{f.enabledSizes.length} selected</small></legend>
          <div className="image-size-grid">{f.sizes.map((s) => <label className="image-check image-size-option" key={s.value}>
            <input type="checkbox" checked={f.enabledSizes.includes(s.value)} onChange={(e) => { const enabledSizes = e.target.checked ? [...f.enabledSizes, s.value] : f.enabledSizes.filter((v) => v !== s.value); update({ enabledSizes, defaultSize: enabledSizes.includes(f.defaultSize) ? f.defaultSize : enabledSizes[0] || '' }) }} />
            <span><strong>{imageRatio(s)}</strong><small>{s.width} × {s.height}</small></span>
          </label>)}</div>
        </fieldset>
        <div className="image-favorite-defaults">
          <label className="image-default-size">Default size<select value={f.defaultSize} onChange={(e) => update({ defaultSize: e.target.value })}>{f.sizes.filter((s) => f.enabledSizes.includes(s.value)).map((s) => <option key={s.value} value={s.value}>{s.value}</option>)}</select></label>
          {f.provider === 'openai' && <>
            <label>Image quality<select value={f.quality ?? 'low'} onChange={(e) => update({ quality: e.target.value as OpenAIImageQuality })}>
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="auto">Auto</option>
            </select><small>Higher quality can take longer and cost more.</small></label>
            <label>Image moderation<select value={f.moderation ?? 'low'} onChange={(e) => update({ moderation: e.target.value as OpenAIImageModeration })}>
              <option value="low">Low</option><option value="auto">Auto</option>
            </select><small>Low uses less restrictive filtering. Auto uses OpenAI’s default filtering.</small></label>
          </>}
        </div>
        <div className="image-favorite-actions">
          {discovered && <button type="button" onClick={() => { const enabledSizes = discovered.sizes.map((s) => s.value).filter((s) => f.enabledSizes.includes(s)); const active = enabledSizes.length ? enabledSizes : [discovered.sizes[0].value]; update({ name: discovered.name, source: discovered.source, cost: discovered.cost, description: discovered.description, sizes: discovered.sizes, enabledSizes: active, defaultSize: active.includes(f.defaultSize) ? f.defaultSize : active[0] }) }}>Update supported sizes</button>}
          <a href={f.source} target="_blank" rel="noreferrer">Provider documentation</a>
          <button className="image-remove-favorite" type="button" onClick={() => { change({ ...settings, favorites: settings.favorites.filter((_, i) => i !== index) }); setEditingFavorite(null) }}>Remove favorite</button>
        </div>
      </details>
    })}
    <div className="image-settings-save">
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={save}>Save image settings{dirty ? ' *' : ''}</button>
      <span role="status">{message || (dirty ? 'Unsaved changes' : '')}</span>
    </div>
  </section>
})

export default ImageSettingsPanel

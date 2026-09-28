import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { AiSettings } from '../../shared/ai/ai-settings'
import { modelTasks, type ImageModel, type ImageProvider, type ImageSettings, type OpenAIImageQuality, type OpenAIImageModeration } from './image-generation-types'
import { documentedImageModels, generationTaskNames, imageSize, imageFavorite, imageProviderNames, imageRatio, IMAGE_PROVIDERS, loadImageSettings, resolveImageKey, resolvePrunaGatewayUrl, saveImageSettings } from './image-settings'
import { fetchImageModels } from './image-providers'
import Button from '../../shared/ui/Button'
import Checkbox from '../../shared/ui/Checkbox'
import Choice from '../../shared/ui/Choice'
import Disclosure from '../../shared/ui/Disclosure'
import Input from '../../shared/ui/Input'
import SearchField from '../../shared/ui/SearchField'
import Select from '../../shared/ui/Select'
export type ImageSettingsPanelRef = { save(): boolean; discard(): void }
export type ImageSettingsPanelProps = { ai: AiSettings; onDirtyChange?: (dirty: boolean) => void }

const ImageSettingsPanel = forwardRef<ImageSettingsPanelRef, ImageSettingsPanelProps>(function ImageSettingsPanel({ ai, onDirtyChange }, ref) {
  const [settings, setSettings] = useState<ImageSettings>(loadImageSettings)
  const [provider, setProvider] = useState<ImageProvider>('nanogpt'), [query, setQuery] = useState('')
  const [catalogs, setCatalogs] = useState<Partial<Record<ImageProvider, ImageModel[]>>>(() => { try { const data = JSON.parse(localStorage.getItem('arc-image-catalog-v1') || '{}'); return Object.fromEntries(IMAGE_PROVIDERS.filter((p) => Array.isArray(data?.[p])).map((p) => [p, data[p].filter((m: ImageModel) => m?.provider === p && typeof m.id === 'string' && typeof m.name === 'string' && Array.isArray(m.sizes) && m.sizes.length && m.sizes.every((s) => typeof s?.value === 'string' && imageSize(s.value)))])) } catch { return {} } })
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [dirty, setDirty] = useState(false)
  const [editingFavorite, setEditingFavorite] = useState<number | null>(settings.favorites.length ? 0 : null)
  const saveTimerRef = useRef<number | null>(null)
  const persist = (value: ImageSettings, normalizeState = false) => {
    try {
      const saved = saveImageSettings(value)
      if (normalizeState) setSettings(saved)
      setDirty(false)
      setMessage('Saved automatically')
      setError('')
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Settings could not be saved.')
      return false
    }
  }
  const change = (value: ImageSettings) => {
    setSettings(value)
    setDirty(true)
    setError('')
    setMessage('Saving…')
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => { saveTimerRef.current = null; persist(value) }, 400)
  }
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => { if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current) }, [])
  const models = provider === 'pruna' ? documentedImageModels.filter((m) => m.provider === provider) : catalogs[provider] ?? documentedImageModels.filter((m) => m.provider === provider)
  const visibleModels = models.filter((model) => `${model.id} ${model.name}`.toLowerCase().includes(query.toLowerCase())).slice(0, 100)
  const refresh = async () => {
    setBusy(true); setError('')
    const selectedProvider = provider
    try {
      const models = await fetchImageModels(selectedProvider, resolveImageKey(selectedProvider, settings, ai))
      const next = { ...catalogs, [selectedProvider]: models }
      setCatalogs(next)
      try { localStorage.setItem('arc-image-catalog-v1', JSON.stringify(next)) } catch { /* Favorites can still be saved separately. */ }
      setMessage(`${models.length} generation models with verified capabilities loaded.`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Models could not be loaded.') }
    finally { setBusy(false) }
  }
  const save = () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = null
    return persist(settings, true)
  }
  const discard = () => { if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current); saveTimerRef.current = null; const saved = loadImageSettings(); setSettings(saved); setDirty(false); setError(''); setMessage('Changes discarded'); setEditingFavorite(saved.favorites.length ? 0 : null) }
  useImperativeHandle(ref, () => ({ save, discard }), [settings])
  return <section className="image-settings image-ui">
    <h1 id="page-title">Image & video generation</h1>
    <p className="image-help">Configure device-global visual providers and favorite models. Source images are sent to the selected provider only when generation starts. These settings apply to every book on this device.</p>
    <Disclosure className="image-settings-section" title="Provider API keys" description="Credentials used only by image and video providers." open={!settings.favorites.length}>
      <div className="image-provider-fields">{IMAGE_PROVIDERS.map((p) => <Input
        key={p}
        label={p === 'pruna' ? 'Optional LiteLLM API key for images' : `${imageProviderNames[p]} API key`}
        type="password"
        autoComplete="off"
        value={settings.keys[p]}
        placeholder={p === 'pruna' ? 'Leave empty to use the AI settings LiteLLM key' : 'Use this provider’s AI-settings key'}
        description={p === 'pruna' ? settings.keys.pruna ? 'Using the image-specific LiteLLM key' : resolveImageKey('pruna', settings, ai) ? `Using the AI settings LiteLLM key via ${resolvePrunaGatewayUrl(ai) || 'the configured gateway'}` : 'Configure LiteLLM in AI settings or enter an image-specific key' : settings.keys[p] ? 'Using the image key' : resolveImageKey(p, settings, ai) ? 'Using saved AI-settings key' : 'No key configured'}
        onChange={(e) => change({ ...settings, keys: { ...settings.keys, [p]: e.target.value } })}
      />)}</div>
    </Disclosure>
    <h2>Favorite models</h2>
    <Disclosure className="image-settings-section" title="Add a favorite model" description="Load provider models, then save the ones you use for generation." open={!settings.favorites.length}>
      <div className="image-model-discovery">
        <Select label="Provider" value={provider} onChange={(e) => { setProvider(e.target.value as ImageProvider); setQuery('') }}>{IMAGE_PROVIDERS.map((p) => <option key={p} value={p}>{imageProviderNames[p]}</option>)}</Select>
        <Button disabled={busy} loading={busy} onClick={() => { void refresh() }}>{provider === 'pruna' ? 'Load documented models' : 'Refresh models'}</Button>
      </div>
      <span className="image-catalog-label">Find a model</span>
      <div className="image-catalog-browser"><SearchField placeholder="Search models" aria-label="Search image and video models" value={query} onChange={(e) => setQuery(e.target.value)} /><div className="image-catalog">{visibleModels.map((m) => <div key={m.id}>
        <span><strong>{m.name}</strong><small>{m.id}{m.cost != null ? ` · estimated $${m.cost.toFixed(4)} per output` : ''}</small><small>{modelTasks(m).map((task) => generationTaskNames[task]).join(' · ')}</small>{m.description && <small>{m.description}</small>}</span>
        <Button size="small" disabled={settings.favorites.some((f) => f.provider === m.provider && f.id === m.id)} onClick={() => change({ ...settings, favorites: [...settings.favorites, imageFavorite(m, settings.favorites)] })}>Favorite</Button>
      </div>)}{!visibleModels.length && <p>{models.length ? 'No models match that search.' : 'Refresh models to discover supported generation capabilities.'}</p>}</div></div>
    </Disclosure>
    {settings.favorites.map((f, index) => {
      const update = (patch: Partial<typeof f>) => change({ ...settings, favorites: settings.favorites.map((m, i) => i === index ? { ...m, ...patch } : m) })
      const discovered = (f.provider === 'pruna' ? documentedImageModels : catalogs[f.provider])?.find((m) => m.id === f.id)
      return <Disclosure className="image-favorite" title={f.name} eyebrow={`${imageProviderNames[f.provider]}${(discovered?.cost ?? f.cost) != null ? ` · estimated $${(discovered?.cost ?? f.cost)!.toFixed(4)} per output` : ''}`} description={`${modelTasks(f).map((task) => generationTaskNames[task]).join(' · ')}${(discovered?.description ?? f.description) ? ` · ${discovered?.description ?? f.description}` : ''}`} open={editingFavorite === index} onToggle={(event) => { if (event.currentTarget.open && editingFavorite !== index) setEditingFavorite(index); else if (!event.currentTarget.open && editingFavorite === index) setEditingFavorite(null) }} key={`${f.provider}/${f.id}`}>
        <div className="image-favorite-identity"><Input label="Chat model alias" maxLength={64} value={f.alias} onChange={(e) => { const alias = e.target.value; change({ ...settings, defaultAlias: settings.defaultAlias === f.alias ? alias : settings.defaultAlias, favorites: settings.favorites.map((m, i) => i === index ? { ...m, alias } : m) }) }} />
        <Choice className="image-default-choice" type="radio" name="default-image-model" title="Use as default image model" checked={settings.defaultAlias === f.alias || (!settings.defaultAlias && index === 0)} onChange={() => change({ ...settings, defaultAlias: f.alias })} /></div>
        <fieldset className="image-size-options">
          <legend>Enabled ratios and sizes <small>{f.enabledSizes.length} selected</small></legend>
          <div className="image-size-grid">{f.sizes.map((s) => <Checkbox className="image-size-option" key={s.value} label={imageRatio(s)} description={`${s.width} × ${s.height}`} checked={f.enabledSizes.includes(s.value)} onChange={(e) => { const enabledSizes = e.target.checked ? [...f.enabledSizes, s.value] : f.enabledSizes.filter((v) => v !== s.value); update({ enabledSizes, defaultSize: enabledSizes.includes(f.defaultSize) ? f.defaultSize : enabledSizes[0] || '' }) }} />)}</div>
        </fieldset>
        <div className="image-favorite-defaults">
          <Select className="image-default-size" label="Default size" value={f.defaultSize} onChange={(e) => update({ defaultSize: e.target.value })}>{f.sizes.filter((s) => f.enabledSizes.includes(s.value)).map((s) => <option key={s.value} value={s.value}>{s.value}</option>)}</Select>
          {f.provider === 'openai' && <>
            <Select label="Image quality" description="Higher quality can take longer and cost more." value={f.quality ?? 'low'} onChange={(e) => update({ quality: e.target.value as OpenAIImageQuality })}>
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>{/^gpt-image-2\.5-/.test(f.id) && <><option value="xhigh">Extra high</option><option value="max">Maximum</option></>}<option value="auto">Auto</option>
            </Select>
            <Select label="Image moderation" description="Low uses less restrictive filtering. Auto uses OpenAI’s default filtering." value={f.moderation ?? 'low'} onChange={(e) => update({ moderation: e.target.value as OpenAIImageModeration })}>
              <option value="low">Low</option><option value="auto">Auto</option>
            </Select>
          </>}
        </div>
        <div className="image-favorite-actions">
          {discovered && <Button onClick={() => { const enabledSizes = discovered.sizes.map((s) => s.value).filter((s) => f.enabledSizes.includes(s)); const active = enabledSizes.length ? enabledSizes : [discovered.sizes[0].value]; update({ name: discovered.name, source: discovered.source, cost: discovered.cost, description: discovered.description, tasks: discovered.tasks, maxSourceImages: discovered.maxSourceImages, videoResolutions: discovered.videoResolutions, videoDurations: discovered.videoDurations, aspectRatios: discovered.aspectRatios, sizes: discovered.sizes, enabledSizes: active, defaultSize: active.includes(f.defaultSize) ? f.defaultSize : active[0] }) }}>Update capabilities</Button>}
          <a href={f.source} target="_blank" rel="noreferrer">Provider documentation</a>
          <Button className="image-remove-favorite" variant="danger" onClick={() => { change({ ...settings, favorites: settings.favorites.filter((_, i) => i !== index) }); setEditingFavorite(null) }}>Remove favorite</Button>
        </div>
      </Disclosure>
    })}
    <div className={`image-settings-status ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'} aria-live="polite"><i />{error || message || (dirty ? 'Saving…' : 'Saved automatically')}</div>
  </section>
})

export default ImageSettingsPanel

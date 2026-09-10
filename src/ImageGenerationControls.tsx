import { useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import IllustrationModal from './IllustrationModal'
import { imageRatio, imageProviderNames } from './image-settings'
import { useImageSettings } from './image-hooks'
import type { FavoriteImageModel } from './image-generation-types'
export type ImageDraft = { prompt: string; alias: string; size: string }
export function ImageModelPicker({ models, value, onChange }: { models: FavoriteImageModel[]; value: string; onChange: (model: FavoriteImageModel) => void }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState('')
  return <><button type="button" className="image-model-picker" onClick={() => { setQuery(''); setOpen(true) }} aria-haspopup="dialog"><span>{value || 'Choose model'}</span><ChevronDown size={18} /></button>{open && <IllustrationModal title="Choose image model" onClose={() => setOpen(false)}><label className="image-search"><Search size={18} /><input type="search" aria-label="Search image models" placeholder="Search favorites" value={query} onChange={(e) => setQuery(e.target.value)} /></label><div className="image-model-options">{models.filter((m) => `${m.alias} ${m.name} ${m.provider}`.toLowerCase().includes(query.toLowerCase())).map((m) => <button type="button" key={m.alias} aria-pressed={value === m.alias} onClick={() => { onChange(m); setOpen(false) }}><strong>{m.alias}</strong><small>{imageProviderNames[m.provider]} · {m.name}</small></button>)}{!models.length && <p>Add favorite models in Images → Settings.</p>}</div></IllustrationModal>}</>
}
export default function ImageGenerationControls({ value, onChange, disabled = false }: { value: ImageDraft; onChange: (value: ImageDraft) => void; disabled?: boolean }) {
  const settings = useImageSettings()
  const favorite = settings.favorites.find((m) => m.alias === value.alias)
  return <fieldset className="image-generation-controls" disabled={disabled}><label>Prompt<textarea rows={4} maxLength={32000} value={value.prompt} onChange={(e) => onChange({ ...value, prompt: e.target.value })} placeholder="Describe your illustration…" /></label><div className="image-generation-pickers"><label>Model<ImageModelPicker value={value.alias} models={settings.favorites} onChange={(m) => onChange({ ...value, alias: m.alias, size: m.enabledSizes.includes(value.size) ? value.size : m.defaultSize })} /></label><label>Size<select value={value.size} onChange={(e) => onChange({ ...value, size: e.target.value })}>{!favorite?.enabledSizes.includes(value.size) && <option value={value.size}>{value.size || 'Choose size'} — unavailable</option>}{favorite?.sizes.filter((s) => favorite.enabledSizes.includes(s.value)).map((s) => <option key={s.value} value={s.value}>{imageRatio(s)} · {s.width} × {s.height}</option>)}</select></label></div>{!settings.favorites.length && <p className="image-help">Add favorite models in Images → Settings before generating.</p>}</fieldset>
}

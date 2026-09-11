import { useState } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'
import IllustrationModal from './IllustrationModal'
import { generationTaskNames, imageRatio, imageProviderNames } from './image-settings'
import { useImageSettings, useImageUrl } from './image-hooks'
import { assertImageFile } from './illustration-image'
import { generationTask, modelTasks, type FavoriteImageModel, type GalleryImage, type GenerationSource, type GenerationTask } from './image-generation-types'
export type ImageDraft = {
  prompt: string
  alias: string
  size: string
  task?: GenerationTask
  sources?: GenerationSource[]
  resolution?: string
  duration?: number
  aspectRatio?: string
  fps?: number
  numFrames?: number
  seed?: number
  draftVideo?: boolean
}
export function ImageModelPicker({ models, value, onChange }: { models: FavoriteImageModel[]; value: string; onChange: (model: FavoriteImageModel) => void }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState('')
  const visible = models.filter((model) => `${model.alias} ${model.name} ${model.provider}`.toLowerCase().includes(query.toLowerCase()))
  return <><button type="button" className="image-model-picker" onClick={() => { setQuery(''); setOpen(true) }} aria-haspopup="dialog"><span>{value || 'Choose model'}</span><ChevronDown size={18} /></button>{open && <IllustrationModal title="Choose generation model" onClose={() => setOpen(false)}><label className="image-search"><Search size={18} /><input type="search" aria-label="Search generation models" placeholder="Search favorites" value={query} onChange={(event) => setQuery(event.target.value)} /></label><div className="image-model-options">{visible.map((model) => <button type="button" key={model.alias} aria-pressed={value === model.alias} onClick={() => { onChange(model); setOpen(false) }}><strong>{model.alias}</strong><small>{imageProviderNames[model.provider]} · {model.name}</small></button>)}{!visible.length && <p>{models.length ? 'No favorite models match that search.' : 'Add a compatible favorite model in Settings → Images.'}</p>}</div></IllustrationModal>}</>
}
function SourcePreview({ source, onRemove }: { source: GenerationSource; onRemove: () => void }) {
  const url = useImageUrl(source.data)
  return <li>{url && <img src={url} alt="" />}<span>{source.name || 'Source image'}</span><button type="button" onClick={onRemove} aria-label={`Remove ${source.name || 'source image'}`}><X size={16} /></button></li>
}
async function sourceFromBlob(blob: Blob, id: string, name?: string): Promise<GenerationSource> {
  await assertImageFile(blob)
  const bitmap = await createImageBitmap(blob)
  try {
    const mime = blob.type === 'image/jpeg' || blob.type === 'image/webp' ? blob.type : 'image/png'
    return { id, name, mime, data: blob.slice(0, blob.size, mime), width: bitmap.width, height: bitmap.height }
  } finally { bitmap.close() }
}
export default function ImageGenerationControls({ value, onChange, disabled = false, sourceAssets = [] }: { value: ImageDraft; onChange: (value: ImageDraft) => void; disabled?: boolean; sourceAssets?: GalleryImage[] }) {
  const settings = useImageSettings()
  const [sourceError, setSourceError] = useState('')
  const task = generationTask(value)
  const compatible = settings.favorites.filter((model) => modelTasks(model).includes(task))
  const favorite = compatible.find((model) => model.alias === value.alias)
  const needsSource = task === 'image-to-image' || task === 'image-to-video'
  const isVideo = task.endsWith('video')
  const sources = value.sources ?? []
  const selectTask = (nextTask: GenerationTask) => {
    const nextModel = settings.favorites.find((model) => modelTasks(model).includes(nextTask))
    onChange({ ...value, task: nextTask, alias: nextModel?.alias ?? '', size: nextModel?.defaultSize ?? value.size, sources: nextTask.startsWith('image-to-') ? sources.slice(0, nextModel?.maxSourceImages ?? 1) : [], resolution: nextModel?.videoResolutions?.[0], duration: nextModel?.videoDurations?.[0] ?? 5, aspectRatio: nextModel?.aspectRatios?.[0] })
  }
  const chooseModel = (model: FavoriteImageModel) => onChange({ ...value, alias: model.alias, size: model.enabledSizes.includes(value.size) ? value.size : model.defaultSize, sources: sources.slice(0, model.maxSourceImages ?? 0), resolution: model.videoResolutions?.includes(value.resolution ?? '') ? value.resolution : model.videoResolutions?.[0], duration: model.videoDurations?.includes(value.duration ?? -1) ? value.duration : model.videoDurations?.[0] ?? value.duration, aspectRatio: model.aspectRatios?.includes(value.aspectRatio ?? '') ? value.aspectRatio : model.aspectRatios?.[0] })
  const addSource = (source: GenerationSource) => {
    const max = favorite?.maxSourceImages ?? 0
    if (!max || sources.some((item) => item.id === source.id) || sources.length >= max) return
    onChange({ ...value, sources: [...sources, source] })
  }
  const upload = async (files: FileList | null) => {
    if (!files) return
    setSourceError('')
    try {
      const added: GenerationSource[] = []
      for (const file of Array.from(files).slice(0, Math.max(0, (favorite?.maxSourceImages ?? 0) - sources.length))) {
        if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name} exceeds the 20 MB source-image limit.`)
        added.push(await sourceFromBlob(file, `upload:${crypto.randomUUID()}`, file.name))
      }
      if (added.length) onChange({ ...value, sources: [...sources, ...added] })
    } catch (reason) { setSourceError(reason instanceof Error ? reason.message : 'Could not read that source image.') }
  }
  const addAsset = async (asset: GalleryImage) => addSource(await sourceFromBlob(asset.image, asset.id, asset.prompt || asset.modelAlias || 'Gallery image'))
  return <fieldset className="image-generation-controls" disabled={disabled}>
    <div className="image-task-options" role="group" aria-label="Generation type">{(Object.keys(generationTaskNames) as GenerationTask[]).map((option) => <button type="button" key={option} aria-pressed={task === option} onClick={() => selectTask(option)}>{generationTaskNames[option]}</button>)}</div>
    <label>Prompt<textarea rows={5} maxLength={32000} value={value.prompt} onChange={(event) => onChange({ ...value, prompt: event.target.value })} placeholder={isVideo ? 'Describe the motion, scene, and camera…' : needsSource ? 'Describe how to transform the source image…' : 'Describe your illustration…'} /></label>
    <div className="image-generation-pickers">
      <label>Model<ImageModelPicker value={favorite?.alias ?? ''} models={compatible} onChange={chooseModel} /></label>
      {!isVideo && <label>Size<select value={value.size} onChange={(event) => onChange({ ...value, size: event.target.value })}>{!favorite?.enabledSizes.includes(value.size) && <option value={value.size}>{value.size || 'Choose size'} — unavailable</option>}{favorite?.sizes.filter((size) => favorite.enabledSizes.includes(size.value)).map((size) => <option key={size.value} value={size.value}>{imageRatio(size)} · {size.width} × {size.height}</option>)}</select></label>}
      {isVideo && <><label>Resolution<select value={value.resolution ?? favorite?.videoResolutions?.[0] ?? ''} onChange={(event) => onChange({ ...value, resolution: event.target.value })}>{(favorite?.videoResolutions ?? []).map((resolution) => <option key={resolution}>{resolution}</option>)}</select></label><label>Duration<select value={value.duration ?? favorite?.videoDurations?.[0] ?? 5} onChange={(event) => onChange({ ...value, duration: Number(event.target.value) })}>{(favorite?.videoDurations?.length ? favorite.videoDurations : [5]).map((duration) => <option key={duration} value={duration}>{duration} seconds</option>)}</select></label><label>Aspect ratio<select value={value.aspectRatio ?? favorite?.aspectRatios?.[0] ?? '16:9'} onChange={(event) => onChange({ ...value, aspectRatio: event.target.value })}>{(favorite?.aspectRatios ?? ['16:9']).map((ratio) => <option key={ratio}>{ratio}</option>)}</select></label></>}
    </div>
    {needsSource && <section className="image-source-picker" aria-labelledby="image-source-heading"><h3 id="image-source-heading">Source {favorite?.maxSourceImages === 1 ? 'image' : 'images'}</h3><p className="image-help">Source images are copied into the queued request and uploaded to {favorite ? imageProviderNames[favorite.provider] : 'the selected provider'} only after you press Generate.</p><label className="image-source-upload">Upload image<input type="file" accept="image/png,image/jpeg,image/webp" multiple={(favorite?.maxSourceImages ?? 1) > 1} onChange={(event) => { void upload(event.target.files); event.target.value = '' }} /></label>{Boolean(sourceAssets.length) && <div className="image-source-library">{sourceAssets.filter((asset) => (asset.kind ?? 'image') === 'image').slice(0, 30).map((asset) => <button type="button" key={asset.id} disabled={sources.some((source) => source.id === asset.id) || sources.length >= (favorite?.maxSourceImages ?? 0)} onClick={() => { void addAsset(asset) }}><span>{asset.prompt || asset.modelAlias || 'Gallery image'}</span></button>)}</div>}{sourceError && <p role="alert">{sourceError}</p>}<ol className="image-source-list">{sources.map((source) => <SourcePreview key={source.id} source={source} onRemove={() => onChange({ ...value, sources: sources.filter((item) => item.id !== source.id) })} />)}</ol><small>{sources.length} / {favorite?.maxSourceImages ?? 0} selected</small></section>}
    {favorite && <p className="image-model-summary"><strong>{favorite.name}</strong><span>{imageProviderNames[favorite.provider]}{favorite.cost != null ? ` · estimated $${favorite.cost.toFixed(4)} per output` : ' · Cost unavailable'}</span></p>}
    {!compatible.length && <p className="image-help">Add a favorite model supporting {generationTaskNames[task].toLowerCase()} in Settings → Images.</p>}
  </fieldset>
}

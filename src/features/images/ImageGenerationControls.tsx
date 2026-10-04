import MediaPromptEditor from './MediaPromptEditor'
import { useState } from 'react'
import { X } from 'lucide-react'
import SearchableSelect from '../../shared/ui/SearchableSelect'
import Select from '../../shared/ui/Select'
import Tabs from '../../shared/ui/Tabs'
import { generationTaskNames, imageRatio, imageProviderNames } from './image-settings'
import { useImageSettings, useImageUrl } from './image-hooks'
import { assertImageFile } from './illustration-image'
import { generationTask, modelTasks, type FavoriteImageModel, type GalleryImage, type GenerationSource, type GenerationTask } from './image-generation-types'
export type { MediaGenerationDraft as ImageDraft } from './image-generation-types'
import type { MediaGenerationDraft as ImageDraft } from './image-generation-types'
export function ImageModelPicker({ models, value, onChange, disabled = false }: { models: FavoriteImageModel[]; value: string; onChange: (model: FavoriteImageModel) => void; disabled?: boolean }) {
  return <SearchableSelect
    label="Model"
    value={value}
    disabled={disabled}
    placeholder="Choose model"
    searchPlaceholder="Search favorites"
    emptyText={models.length ? 'No favorite models match that search.' : 'Add a compatible favorite model in global Settings → Image or Video profiles.'}
    options={models.map(model => ({ value: model.alias, title: model.alias, subtitle: `${imageProviderNames[model.provider]} · ${model.name}` }))}
    onChange={alias => { const model = models.find(candidate => candidate.alias === alias); if (model) onChange(model) }}
  />
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
export default function ImageGenerationControls({ value, onChange, disabled = false, sourceAssets = [], bookId }: { bookId?: string; value: ImageDraft; onChange: (value: ImageDraft) => void; disabled?: boolean; sourceAssets?: GalleryImage[] }) {
  const settings = useImageSettings(bookId)
  const [sourceError, setSourceError] = useState('')
  const task = generationTask(value)
  const compatible = settings.favorites.filter((model) => modelTasks(model).includes(task))
  const favorite = compatible.find((model) => model.alias === value.alias)
  const needsSource = task === 'image-to-image' || task === 'image-to-video'
  const isVideo = task.endsWith('video')
  const sources = value.sources ?? []
  const selectTask = (nextTask: GenerationTask) => {
    const nextAlias = settings.defaultAliases?.[nextTask] ?? settings.defaultAlias
    const nextModel = settings.favorites.find((model) => model.alias === nextAlias && modelTasks(model).includes(nextTask))
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
    <Tabs label="Generation type" value={task} items={(Object.keys(generationTaskNames) as GenerationTask[]).map(option => ({ value: option, label: generationTaskNames[option] }))} onChange={selectTask} className="image-generation-task-control" />
    <MediaPromptEditor key={bookId ?? 'global'} value={value} onChange={onChange} bookId={bookId} capability={favorite ? `${favorite.name}: ${favorite.description ?? ''}. Tasks: ${modelTasks(favorite).join(', ')}.` : 'No media model selected'} />
    <div className="image-generation-pickers">
      <ImageModelPicker value={value.alias} models={compatible} onChange={chooseModel} disabled={disabled} />
      {!isVideo && <Select label="Size" value={value.size} disabled={disabled} onChange={event => onChange({ ...value, size: event.target.value })}>
        {!favorite?.enabledSizes.includes(value.size) && <option value={value.size} disabled>{value.size || 'Choose size'} — unavailable</option>}
        {favorite?.sizes.filter(size => favorite.enabledSizes.includes(size.value)).map(size => <option key={size.value} value={size.value}>{imageRatio(size)} · {size.width} × {size.height}</option>)}
      </Select>}
      {isVideo && <>
        <Select label="Resolution" value={value.resolution ?? favorite?.videoResolutions?.[0] ?? ''} disabled={disabled} onChange={event => onChange({ ...value, resolution: event.target.value })}>{(favorite?.videoResolutions ?? []).map(resolution => <option key={resolution} value={resolution}>{resolution}</option>)}</Select>
        <Select label="Duration" value={value.duration ?? favorite?.videoDurations?.[0] ?? 5} disabled={disabled} onChange={event => onChange({ ...value, duration: Number(event.target.value) })}>{(favorite?.videoDurations?.length ? favorite.videoDurations : [5]).map(duration => <option key={duration} value={duration}>{duration} seconds</option>)}</Select>
        <Select label="Aspect ratio" value={value.aspectRatio ?? favorite?.aspectRatios?.[0] ?? '16:9'} disabled={disabled} onChange={event => onChange({ ...value, aspectRatio: event.target.value })}>{(favorite?.aspectRatios ?? ['16:9']).map(ratio => <option key={ratio} value={ratio}>{ratio}</option>)}</Select>
      </>}
    </div>
    {needsSource && <section className="image-source-picker" aria-labelledby="image-source-heading"><h3 id="image-source-heading">Source {favorite?.maxSourceImages === 1 ? 'image' : 'images'}</h3><p className="image-help">Source images are copied into the queued request and uploaded to {favorite ? imageProviderNames[favorite.provider] : 'the selected provider'} only after you press Generate.</p><label className="image-source-upload">Upload image<input type="file" accept="image/png,image/jpeg,image/webp" multiple={(favorite?.maxSourceImages ?? 1) > 1} onChange={(event) => { void upload(event.target.files); event.target.value = '' }} /></label>{Boolean(sourceAssets.length) && <div className="image-source-library">{sourceAssets.filter((asset) => (asset.kind ?? 'image') === 'image').slice(0, 30).map((asset) => <button type="button" key={asset.id} disabled={sources.some((source) => source.id === asset.id) || sources.length >= (favorite?.maxSourceImages ?? 0)} onClick={() => { void addAsset(asset) }}><span>{asset.prompt || asset.modelAlias || 'Gallery image'}</span></button>)}</div>}{sourceError && <p role="alert">{sourceError}</p>}<ol className="image-source-list">{sources.map((source) => <SourcePreview key={source.id} source={source} onRemove={() => onChange({ ...value, sources: sources.filter((item) => item.id !== source.id) })} />)}</ol><small>{sources.length} / {favorite?.maxSourceImages ?? 0} selected</small></section>}
    {favorite && <p className="image-model-summary"><strong>{favorite.name}</strong><span>{imageProviderNames[favorite.provider]}{favorite.cost != null ? ` · estimated $${favorite.cost.toFixed(4)} per output` : ' · Cost unavailable'}</span></p>}
    {settings.error && <p role="alert">{settings.error}</p>}
    {!settings.loading && value.alias && !favorite && <p role="alert">The selected model “{value.alias}” is unavailable for this task in the current media profiles. Choose a model explicitly or edit the profile in global Settings.</p>}
    {!settings.loading && !compatible.length && <p className="image-help">Add a favorite model supporting {generationTaskNames[task].toLowerCase()} in global Settings → {isVideo ? 'Video' : 'Image'} profiles.</p>}
  </fieldset>
}

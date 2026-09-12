import { selectedMediaPrompt } from './media-prompt'
import { useState, type KeyboardEvent } from 'react'
import { ArrowLeft, Settings } from 'lucide-react'
import ImageGenerationControls, { type ImageDraft } from './ImageGenerationControls'
import ImageJobs, { ImageAssetPreview } from './ImageResults'
import { useImageQuery, useImageSettings } from './image-hooks'
import { availableImageCodex, deleteGalleryImage, enqueueImageJob, listGalleryImages, notifyImageStore } from './image-store'
import { loadImageSettings, resolveImageSpec } from './image-settings'
import { checkStorageHeadroom, prepareIllustration } from './illustration-image'
import { getIllustration, removeIllustration, saveIllustration } from './persistence'
import { generationTask, type GalleryImage } from './image-generation-types'
import './image-generation.css'

export type ImageWorkspaceTab = 'generate' | 'gallery'
export type ImageGalleryScope = 'all' | 'book'
export type ImageWorkspaceState = {
  tab: ImageWorkspaceTab
  draft: ImageDraft
  gallery: { query: string; scope: ImageGalleryScope; limit: number }
}

export function createImageWorkspaceState(): ImageWorkspaceState {
  const settings = loadImageSettings()
  const favorite = settings.favorites.find((model) => model.alias === settings.defaultAlias) ?? settings.favorites[0]
  return {
    tab: 'generate',
    draft: { prompt: '', alias: favorite?.alias ?? '', size: favorite?.defaultSize ?? '1024x1024', task: 'text-to-image', sources: [] },
    gallery: { query: '', scope: 'all', limit: 40 },
  }
}

type ImageWorkspaceViewProps = {
  bookId?: string
  state: ImageWorkspaceState
  onStateChange: (state: ImageWorkspaceState) => void
  onSettings: () => void
}

export function ImageGenerateView({ bookId, state, onStateChange, onSettings }: ImageWorkspaceViewProps) {
  const settings = useImageSettings()
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const { data: sourceAssets } = useImageQuery(() => listGalleryImages(), [], [])
  const favorite = settings.favorites.find((model) => model.alias === state.draft.alias)
  const validSize = Boolean(favorite?.enabledSizes.includes(state.draft.size) && favorite.sizes.some((size) => size.value === state.draft.size))
  const task = generationTask(state.draft)
  const needsSource = task === 'image-to-image' || task === 'image-to-video'
  const canGenerate = Boolean(selectedMediaPrompt(state.draft).trim() && favorite && validSize && (!needsSource || state.draft.sources?.length))
  const setDraft = (draft: ImageDraft) => onStateChange({ ...state, draft })
  const generate = async () => {
    setBusy(true)
    setError('')
    setStatus('Queued')
    try {
      await enqueueImageJob(resolveImageSpec(selectedMediaPrompt(state.draft), state.draft.alias, state.draft.size, undefined, undefined, task, state.draft.sources ?? [], { resolution: state.draft.resolution, duration: state.draft.duration, aspectRatio: state.draft.aspectRatio, fps: state.draft.fps, numFrames: state.draft.numFrames, seed: state.draft.seed, draft: state.draft.draftVideo }), { bookId })
    } catch (reason) {
      setStatus('')
      setError(reason instanceof Error ? reason.message : 'Could not queue image.')
    } finally { setBusy(false) }
  }
  return <section className="image-generate-view" aria-labelledby="image-generate-heading">
    <div className="image-composer">
      <h2 id="image-generate-heading">Create visual media</h2>
      <ImageGenerationControls bookId={bookId} value={state.draft} onChange={setDraft} disabled={busy} sourceAssets={sourceAssets} />

      {!settings.favorites.length && <button type="button" onClick={onSettings}>Set up image models</button>}
      <div className="image-generate-actions">
        <button className="image-primary-action" type="button" disabled={busy || !canGenerate} onClick={() => { void generate() }}>Generate</button>
        <button type="button" disabled={busy || !state.draft.prompt} onClick={() => setDraft({ ...state.draft, prompt: '' })}>Clear prompt</button>
      </div>
      <p className="image-queue-status" role="status" aria-live="polite">{status}</p>
      {error && <p role="alert">{error}</p>}
      <p className="image-help">Each tap queues one output. Source images are frozen with the request. Your draft stays here and the queue continues while you switch chats or books. Keep the app open while generating; interrupted requests are never automatically resubmitted.</p>
    </div>
    <div className="image-queue-pane"><h2>Generation queue</h2><ImageJobs /></div>
  </section>
}

export function ImageGalleryView({ bookId, state, onStateChange }: Omit<ImageWorkspaceViewProps, 'onSettings'>) {
  const scope = bookId && state.gallery.scope === 'book' ? 'book' : 'all'
  const { data: assets, error } = useImageQuery(() => listGalleryImages(scope === 'book' ? bookId : undefined), [scope, bookId], [])
  const { data: entries } = useImageQuery(() => availableImageCodex(bookId), [bookId], [])
  const [entryId, setEntryId] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const updateGallery = (patch: Partial<ImageWorkspaceState['gallery']>) => onStateChange({ ...state, gallery: { ...state.gallery, ...patch } })
  const action = async (fn: () => Promise<void>) => {
    setMessage('')
    setBusy(true)
    try { await fn() } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Image action failed.') } finally { setBusy(false) }
  }
  const attach = async (asset: GalleryImage) => {
    if (!entryId) return false
    const previous = await getIllustration(entryId)
    if (previous && !window.confirm('Replace this Codex entry’s illustration? You can undo it from the entry.')) return false
    if ((asset.kind ?? 'image') !== 'image') throw new Error('Only still images can be used as Codex illustrations.')
    const pixels = await prepareIllustration(asset.image)
    await checkStorageHeadroom(pixels.image.size + pixels.thumbnail.size)
    await saveIllustration(entryId, pixels, { caption: asset.prompt.slice(0, 2000), alt: '', cropX: 50, cropY: 50 }, previous?.id)
    window.dispatchEvent(new CustomEvent('arc-illustrations-changed', { detail: { entryId } }))
    notifyImageStore()
    setMessage('Added to Codex entry')
    return true
  }
  const remove = async (asset: GalleryImage) => {
    if (asset.entryId) {
      await removeIllustration(asset.entryId, asset.illustrationId!)
      window.dispatchEvent(new CustomEvent('arc-illustrations-changed', { detail: { entryId: asset.entryId } }))
    } else await deleteGalleryImage(asset.id)
  }
  const normalizedQuery = state.gallery.query.toLowerCase()
  const visible = assets.filter((asset) => `${asset.prompt} ${asset.modelAlias || ''} ${asset.bookTitle || ''}`.toLowerCase().includes(normalizedQuery))
  return <section className="image-gallery-view" aria-labelledby="image-gallery-heading">
    <h2 id="image-gallery-heading">Your gallery</h2>
    <div className="image-gallery-tools">
      <div className="image-scope-chips" aria-label="Gallery scope">
        <button type="button" aria-pressed={scope === 'all'} onClick={() => updateGallery({ scope: 'all', limit: 40 })}>All</button>
        {bookId && <button type="button" aria-pressed={scope === 'book'} onClick={() => updateGallery({ scope: 'book', limit: 40 })}>This book</button>}
      </div>
      <input type="search" aria-label="Search gallery" placeholder="Search images" value={state.gallery.query} onChange={(event) => updateGallery({ query: event.target.value, limit: 40 })} />
    </div>
    <p className="image-help">All kept images and Codex illustrations on this device. Removing an image from chat keeps its gallery copy.</p>
    {(error || message) && <p role="status">{error || message}</p>}
    <div className="image-gallery-grid">{visible.slice(0, state.gallery.limit).map((asset) => <article key={asset.id}>
      <ImageAssetPreview asset={asset} onOpen={() => { setEntryId(''); setMessage('') }} renderViewerActions={(close) => <div className="image-gallery-viewer-actions">
        {bookId && (asset.kind ?? 'image') === 'image' && <div className="image-codex-action"><label>Codex entry<select value={entryId} onChange={(event) => setEntryId(event.target.value)}><option value="">Choose an entry</option>{entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select></label>{!entries.length && <p>Create a Codex entry in this book first.</p>}<button type="button" disabled={!entryId || busy} onClick={() => { void action(async () => { if (await attach(asset)) close() }) }}>Use in Codex</button></div>}
        <button className="image-danger-action" type="button" disabled={busy} onClick={() => { const kind = asset.kind ?? 'image'; const confirmed = window.confirm(asset.entryId ? 'Remove this illustration from its Codex entry? You can undo it from the entry.' : `Delete this ${kind} from the gallery and its chat results? Download it first if you want a backup.`); if (confirmed) void action(async () => { await remove(asset); close() }) }}>Delete {asset.kind ?? 'image'}</button>
        {message && <p role="alert">{message}</p>}
      </div>} />
      <p className="image-prompt-preview">{asset.prompt || 'Codex illustration'}</p>
      <small>{asset.modelAlias || 'Uploaded illustration'}</small>
    </article>)}</div>
    {!visible.length && <p>No media match. Generate and keep an image or video, or upload a Codex illustration.</p>}
    {visible.length > state.gallery.limit && <button type="button" onClick={() => updateGallery({ limit: state.gallery.limit + 40 })}>Show more images</button>}
  </section>
}

export type ImageWorkspaceProps = {
  storageError?: string
  bookId?: string
  bookTitle?: string
  state: ImageWorkspaceState
  onStateChange: (state: ImageWorkspaceState) => void
  onBack: () => void
  onSettings: () => void
}

export default function ImageWorkspace({ bookId, bookTitle, state, onStateChange, onBack, onSettings, storageError }: ImageWorkspaceProps) {
  const tabs: ImageWorkspaceTab[] = ['generate', 'gallery']
  const selectTab = (tab: ImageWorkspaceTab) => onStateChange({ ...state, tab })
  const selectTabFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
        : event.key === 'Home' ? 0
          : event.key === 'End' ? tabs.length - 1
            : -1
    if (next < 0) return
    event.preventDefault()
    selectTab(tabs[next])
    document.getElementById(`image-tab-${tabs[next]}`)?.focus()
  }
  return <main className="image-ui image-workspace">
    <header className="image-workspace-header">
      <button type="button" onClick={onBack} aria-label="Back"><ArrowLeft aria-hidden="true" /><span>Back</span></button>
      <div><h1 id="page-title">Images</h1>{bookTitle && <p>{bookTitle}</p>}</div>
      <button type="button" onClick={onSettings} aria-label="Image settings"><Settings aria-hidden="true" /><span>Settings</span></button>
    </header>
    {storageError && <p role="alert">{storageError}</p>}
    <nav className="image-tabs" aria-label="Image workspace" role="tablist">
      <button type="button" role="tab" id="image-tab-generate" aria-selected={state.tab === 'generate'} aria-controls="image-panel-generate" tabIndex={state.tab === 'generate' ? 0 : -1} onKeyDown={(event) => selectTabFromKeyboard(event, 0)} onClick={() => selectTab('generate')}>Generate</button>
      <button type="button" role="tab" id="image-tab-gallery" aria-selected={state.tab === 'gallery'} aria-controls="image-panel-gallery" tabIndex={state.tab === 'gallery' ? 0 : -1} onKeyDown={(event) => selectTabFromKeyboard(event, 1)} onClick={() => selectTab('gallery')}>Gallery</button>
    </nav>
    <div className="image-workspace-content" id={`image-panel-${state.tab}`} role="tabpanel" aria-labelledby={`image-tab-${state.tab}`}>
      {state.tab === 'generate' ? <ImageGenerateView bookId={bookId} state={state} onStateChange={onStateChange} onSettings={onSettings} /> : <ImageGalleryView bookId={bookId} state={state} onStateChange={onStateChange} />}
    </div>
  </main>
}

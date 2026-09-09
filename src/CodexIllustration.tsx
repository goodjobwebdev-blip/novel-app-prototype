import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ImagePlus, MoreHorizontal, Upload, Crop, Pencil, Trash2 } from 'lucide-react'
import { dismissIllustrationUndo, getIllustration, getIllustrationUndo, removeIllustration, saveIllustration, undoIllustration, type CodexEntryEntity, type Illustration, type IllustrationUndo } from './persistence'
import { checkStorageHeadroom, formatBytes, imageStorageError, makeThumbnail, prepareIllustration, type ImageDetails } from './illustration-image'
import { centeredImageView, type ImageView } from './image-gestures'
import { clearDescriptionDraft, readDescriptionDraft, saveDescriptionDraft } from './illustration-drafts'
import IllustrationModal from './IllustrationModal'
import IllustrationGestures from './IllustrationGestures'
import './illustrations.css'

export const IMAGE_CHANGED = 'arc-illustrations-changed'
function notify(entryId: string) { window.dispatchEvent(new CustomEvent(IMAGE_CHANGED, { detail: { entryId } })) }

function useIllustration(entryId: string, withUndo = false) {
  const [state, setState] = useState<{ entryId: string; image?: Illustration; undo?: IllustrationUndo; error?: string; loading: boolean }>({ entryId, loading: true })
  useEffect(() => {
    let alive = true
    let sequence = 0
    const load = async () => {
      const ticket = ++sequence
      try {
        const [image, undo] = await Promise.all([getIllustration(entryId), withUndo ? getIllustrationUndo(entryId) : undefined])
        if (alive && ticket === sequence) setState({ entryId, image, undo, loading: false })
      } catch {
        if (alive && ticket === sequence) setState({ entryId, error: 'The illustration could not be loaded.', loading: false })
      }
    }
    const changed = (event: Event) => { if ((event as CustomEvent).detail?.entryId === entryId) void load() }
    void load()
    window.addEventListener(IMAGE_CHANGED, changed)
    return () => { alive = false; window.removeEventListener(IMAGE_CHANGED, changed) }
  }, [entryId, withUndo])
  return state.entryId === entryId ? state : { entryId, loading: true }
}

function useBlobUrl(blob?: Blob) {
  const [value, setValue] = useState<{ blob: Blob; url: string }>()
  useEffect(() => {
    if (!blob) { setValue(undefined); return }
    const url = URL.createObjectURL(blob)
    setValue({ blob, url })
    return () => URL.revokeObjectURL(url)
  }, [blob])
  return value?.blob === blob ? value?.url : undefined
}

export function CodexThumbnail({ entryId, title }: { entryId: string; title: string }) {
  const { image } = useIllustration(entryId)
  const src = useBlobUrl(image?.thumbnail)
  return <i className="codex-thumbnail">{src ? <img src={src} alt="" loading="lazy" width={44} height={44} /> : title.slice(0, 1).toUpperCase()}</i>
}

function DescriptionEditor({ image, busy, error, onClose, onSave }: {
  image: Illustration; busy: boolean; error: string; onClose: () => void; onSave: (details: ImageDetails) => Promise<void>
}) {
  const [draft, setDraft] = useState(() => readDescriptionDraft(image.entryId, image.id) ?? { caption: image.caption, alt: image.alt })
  const change = (value: typeof draft) => { setDraft(value); saveDescriptionDraft(image.entryId, image.id, value) }
  return <IllustrationModal title="Image description" onClose={onClose} footer={<><span>Draft kept when closed</span><button className="image-primary" disabled={busy} type="button" onClick={() => { void onSave({ ...image, ...draft }) }}>{busy ? 'Saving…' : 'Save description'}</button></>}>
    <fieldset disabled={busy} className="image-description-fields"><label>Caption<input maxLength={2000} value={draft.caption} onChange={(event) => change({ ...draft, caption: event.target.value })} /></label><label>Image description (alt text)<textarea rows={4} maxLength={2000} value={draft.alt} onChange={(event) => change({ ...draft, alt: event.target.value })} /></label><p className="illustration-help">Describe the important visual details for someone who cannot see the image.</p></fieldset>
    {error && <p className="illustration-error" role="alert">{error}</p>}
  </IllustrationModal>
}

function CropEditor({ image, src, busy, error, onClose, onSave }: {
  image: Illustration; src: string; busy: boolean; error: string; onClose: () => void; onSave: (details: ImageDetails) => Promise<void>
}) {
  const [crop, setCrop] = useState<ImageView>({ x: image.cropX, y: image.cropY, zoom: image.cropZoom ?? 1 })
  return <IllustrationModal title="Adjust thumbnail" onClose={onClose} footer={<><span>Full image stays unchanged</span><button type="button" className="image-primary" disabled={busy} onClick={() => { void onSave({ ...image, cropX: crop.x, cropY: crop.y, cropZoom: crop.zoom }) }}>{busy ? 'Saving…' : 'Done'}</button></>}>
    <p className="illustration-help">Drag to position. Pinch or use the buttons to zoom.</p>
    <IllustrationGestures src={src} alt="Thumbnail crop preview" image={image} value={crop} onChange={setCrop} crop disabled={busy} />
    {error && <p className="illustration-error" role="alert">{error}</p>}
  </IllustrationModal>
}

function FullImage({ image, title, onClose }: { image: Illustration; title: string; onClose: () => void }) {
  const src = useBlobUrl(image.image)
  const [view, setView] = useState<ImageView>({ ...centeredImageView })
  return <IllustrationModal title={title} onClose={onClose} fullScreen>
    {src && <IllustrationGestures src={src} alt={image.alt || `Illustration of ${title}`} image={image} value={view} onChange={setView} />}
    {image.caption && <p className="image-view-caption">{image.caption}</p>}
  </IllustrationModal>
}

type Panel = 'actions' | 'crop' | 'description' | 'view' | null
export default function CodexIllustration({ entry, readOnly, children }: { entry: CodexEntryEntity; readOnly: boolean; children: ReactNode }) {
  const { image, undo, error: loadError, loading } = useIllustration(entry.id, true)
  const input = useRef<HTMLInputElement>(null)
  const working = useRef(false)
  const alive = useRef(true)
  const [phase, setPhase] = useState<'preparing' | 'saving' | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [panel, setPanel] = useState<Panel>(null)
  const src = useBlobUrl(panel === 'crop' ? image?.image : undefined)
  const thumbnail = useBlobUrl(image?.thumbnail)
  const busy = phase !== null
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  async function run(action: () => Promise<void>, preparing = false, success = 'Saved on this device') {
    if (working.current || readOnly) return
    working.current = true
    setPhase(preparing ? 'preparing' : 'saving')
    setError('')
    setMessage('')
    try {
      await action()
      notify(entry.id)
      if (alive.current) { setPanel(null); setMessage(success) }
    } catch (error) { if (alive.current) setError(imageStorageError(error)) }
    finally { working.current = false; if (alive.current) setPhase(null) }
  }
  async function upload(file: File) {
    await run(async () => {
      const pixels = await prepareIllustration(file)
      await checkStorageHeadroom(pixels.image.size + pixels.thumbnail.size)
      if (alive.current) setPhase('saving')
      await saveIllustration(entry.id, pixels, { caption: '', alt: '', cropX: 50, cropY: 50, cropZoom: 1 }, image?.id)
      if (image) clearDescriptionDraft(entry.id, image.id)
    }, true)
  }
  async function saveDetails(details: ImageDetails, crop: boolean) {
    if (!image) return
    await run(async () => {
      const thumbnail = crop ? await makeThumbnail(image.image, details.cropX, details.cropY, details.cropZoom ?? 1) : image.thumbnail
      // Do not pass a stale whole image record as metadata.
      const saved = await saveIllustration(entry.id, { image: image.image, thumbnail, width: image.width, height: image.height }, {
        caption: details.caption, alt: details.alt, cropX: details.cropX, cropY: details.cropY, cropZoom: details.cropZoom ?? 1,
      }, image.id)
      const draft = crop ? readDescriptionDraft(entry.id, image.id) : undefined
      if (draft) saveDescriptionDraft(entry.id, saved.id, draft)
      clearDescriptionDraft(entry.id, image.id)
    })
  }
  const open = (next: Panel) => { setError(''); setPanel(next) }
  const close = () => setPanel(null)
  return <div className="codex-image-identity">
    <div className="codex-title-main">
      {image && thumbnail && <button className="codex-title-image" type="button" onClick={() => open('view')} aria-label={`View illustration of ${entry.title}`}><img src={thumbnail} alt="" /></button>}
      <div className="codex-title-text">{children}</div>
      {image && !readOnly && <button className="codex-image-menu" type="button" disabled={busy} onClick={() => open('actions')} aria-label={`Image actions for ${entry.title}`} aria-haspopup="dialog"><MoreHorizontal aria-hidden="true" /></button>}
    </div>
    {!image && !readOnly && <button className="image-add" type="button" disabled={busy || loading || Boolean(loadError)} onClick={() => open('actions')}><ImagePlus aria-hidden="true" />Add image</button>}
    {!readOnly && <input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload Codex illustration" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file) }} />}
    <div className="image-inline-feedback" aria-busy={busy}>
      {(busy || message || (undo && !readOnly)) && <div className="image-change-status"><span role="status">{phase === 'preparing' ? 'Preparing image…' : phase === 'saving' ? 'Saving…' : message || 'Image change saved on this device'}</span>{undo && !readOnly && !busy && <><button type="button" onClick={() => { void run(() => undoIllustration(entry.id, undo.id), false, 'Image change undone') }} aria-label="Undo image change">Undo</button><button type="button" aria-label="Dismiss image undo" onClick={() => { void run(() => dismissIllustrationUndo(entry.id, undo.id), false, 'Undo dismissed') }}>Dismiss</button></>}</div>}
      {(error || loadError) && <p className="illustration-error" role="alert">{error || loadError}<button type="button" onClick={() => { setError(''); notify(entry.id) }}>Reload</button></p>}
    </div>
    {panel === 'actions' && !readOnly && <IllustrationModal title={image ? 'Illustration' : 'Add image'} onClose={close}>
      <p className="illustration-help">PNG, JPEG or WebP, up to 20 MB. Saved on this device at up to 1600 pixels. Keep the original for print quality.{image ? ` Current image: ${formatBytes(image.image.size + image.thumbnail.size)}.` : ''}</p>
      <div className="image-sheet-actions"><button disabled={busy} type="button" onClick={() => input.current?.click()}><Upload aria-hidden="true" />{image ? 'Replace image' : 'Choose image'}</button>{image && <><button disabled={busy} type="button" onClick={() => open('crop')}><Crop aria-hidden="true" />Adjust thumbnail</button><button disabled={busy} type="button" onClick={() => open('description')}><Pencil aria-hidden="true" />Edit description</button><button disabled={busy} className="image-remove" type="button" onClick={() => { void run(() => removeIllustration(entry.id, image.id)) }}><Trash2 aria-hidden="true" />Remove image</button></>}</div>
      {busy && <p role="status">{phase === 'preparing' ? 'Preparing image…' : 'Saving…'}</p>}
      {error && <p className="illustration-error" role="alert">{error}</p>}
    </IllustrationModal>}
    {panel === 'description' && image && !readOnly && <DescriptionEditor key={image.id} image={image} busy={busy} error={error} onClose={close} onSave={(details) => saveDetails(details, false)} />}
    {panel === 'crop' && image && src && !readOnly && <CropEditor key={image.id} image={image} src={src} busy={busy} error={error} onClose={close} onSave={(details) => saveDetails(details, true)} />}
    {panel === 'view' && image && <FullImage key={image.id} image={image} title={entry.title} onClose={close} />}
  </div>
}

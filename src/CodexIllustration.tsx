import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ImagePlus, Maximize2, Upload, X } from 'lucide-react'
import { getIllustration, removeIllustration, saveIllustration, type CodexEntryEntity, type Illustration } from './persistence'
import { checkStorageHeadroom, formatBytes, imageStorageError, makeThumbnail, prepareIllustration, type ImageDetails } from './illustration-image'
import './illustrations.css'

export const IMAGE_CHANGED = 'arc-illustrations-changed'
function notify(entryId: string) { window.dispatchEvent(new CustomEvent(IMAGE_CHANGED, { detail: { entryId } })) }

function useIllustration(entryId: string) {
  const [state, setState] = useState<{ entryId: string; image?: Illustration; error?: string; loading: boolean }>({ entryId, loading: true })
  useEffect(() => {
    let alive = true
    let sequence = 0
    const load = async () => {
      const ticket = ++sequence
      try {
        const image = await getIllustration(entryId)
        if (alive && ticket === sequence) setState({ entryId, image, loading: false })
      } catch {
        if (alive && ticket === sequence) setState({ entryId, error: 'The illustration could not be loaded. Reopen this entry to retry.', loading: false })
      }
    }
    const changed = (event: Event) => { if ((event as CustomEvent).detail?.entryId === entryId) void load() }
    void load()
    window.addEventListener(IMAGE_CHANGED, changed)
    return () => { alive = false; window.removeEventListener(IMAGE_CHANGED, changed) }
  }, [entryId])
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

function FullImage({ image, title, onClose }: { image: Illustration; title: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const src = useBlobUrl(image.image)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.showModal()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  return createPortal(<dialog className="illustration-dialog" ref={dialog} onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose() }} aria-label={`Illustration of ${title}`}>
    <button type="button" className="illustration-close" onClick={onClose} autoFocus aria-label="Close illustration"><X aria-hidden="true" /></button>
    {src && <img src={src} alt={image.alt || `Illustration of ${title}`} />}
    {image.caption && <p>{image.caption}</p>}
  </dialog>, document.body)
}

export default function CodexIllustration({ entry, readOnly }: { entry: CodexEntryEntity; readOnly: boolean }) {
  const { image, error: loadError, loading } = useIllustration(entry.id)
  const input = useRef<HTMLInputElement>(null)
  const working = useRef(false)
  const alive = useRef(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [shown, setShown] = useState(true)
  const [editing, setEditing] = useState(false)
  const [removeConfirm, setRemoveConfirm] = useState(false)
  const [details, setDetails] = useState<ImageDetails>({ caption: '', alt: '', cropX: 50, cropY: 50 })
  const src = useBlobUrl(image?.image)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    if (image) setDetails({ caption: image.caption, alt: image.alt, cropX: image.cropX, cropY: image.cropY })
  }, [image?.id])
  async function run(action: () => Promise<void>) {
    if (working.current || readOnly) return
    working.current = true
    setBusy(true)
    setError('')
    try { await action(); notify(entry.id) } catch (error) { if (alive.current) setError(imageStorageError(error)) }
    finally { working.current = false; if (alive.current) setBusy(false) }
  }
  async function upload(file: File) {
    await run(async () => {
      const pixels = await prepareIllustration(file)
      await checkStorageHeadroom(pixels.image.size + pixels.thumbnail.size)
      await saveIllustration(entry.id, pixels, { caption: '', alt: '', cropX: 50, cropY: 50 }, image?.id)
      if (alive.current) { setEditing(false); setRemoveConfirm(false) }
    })
  }
  async function saveDetails() {
    if (!image) return
    await run(async () => {
      const thumbnail = await makeThumbnail(image.image, details.cropX, details.cropY)
      await saveIllustration(entry.id, { image: image.image, thumbnail, width: image.width, height: image.height }, details, image.id)
      if (alive.current) setEditing(false)
    })
  }
  return <details className="codex-illustration" open={shown} onToggle={(event) => setShown(event.currentTarget.open)}>
    <summary><ImagePlus aria-hidden="true" /><span>Illustration</span><small>{loading ? 'Loading…' : image ? formatBytes(image.image.size + image.thumbnail.size) : 'Add a visual reference'}</small></summary>
    <div className="illustration-body" aria-busy={busy}>
      {image && src && <figure><button className="illustration-preview" type="button" onClick={() => setExpanded(true)} aria-label={`Enlarge illustration of ${entry.title}`}><img src={src} alt={image.alt || `Illustration of ${entry.title}`} /><span><Maximize2 aria-hidden="true" /> Enlarge</span></button>{image.caption && <figcaption>{image.caption}</figcaption>}</figure>}
      {!readOnly && <>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload Codex illustration" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file) }} />
        <div className="illustration-actions"><button type="button" disabled={busy || loading || Boolean(loadError)} onClick={() => input.current?.click()}><Upload aria-hidden="true" />{busy ? 'Saving…' : image ? 'Replace image' : 'Upload image'}</button>{image && <><button type="button" disabled={busy} onClick={() => { setEditing(!editing); setRemoveConfirm(false) }}>Caption & crop</button><button type="button" disabled={busy} onClick={() => setRemoveConfirm(true)}>Remove</button></>}</div>
        {!image && !loading && <p className="illustration-help">PNG, JPEG or WebP, up to 20 MB. Saved on this device at up to 1600 pixels; keep your original for print quality.</p>}
        {removeConfirm && image && <div className="illustration-confirm"><p>Remove this illustration? The entry text stays saved.</p><button type="button" disabled={busy} onClick={() => { void run(async () => { await removeIllustration(entry.id, image.id); if (alive.current) { setRemoveConfirm(false); setEditing(false) } }) }}>Remove illustration</button><button type="button" disabled={busy} onClick={() => setRemoveConfirm(false)}>Keep image</button></div>}
        {editing && image && <fieldset disabled={busy} className="illustration-details"><legend>Caption & thumbnail crop</legend><label>Caption<input maxLength={2000} value={details.caption} onChange={(e) => setDetails({ ...details, caption: e.target.value })} /></label><label>Image description (alt text)<textarea rows={2} maxLength={2000} value={details.alt} onChange={(e) => setDetails({ ...details, alt: e.target.value })} /></label><div className="illustration-crop">{src && <img src={src} alt="Thumbnail crop preview" style={{ objectPosition: `${details.cropX}% ${details.cropY}%` }} />}<div><label>Horizontal position<input type="range" min={0} max={100} value={details.cropX} onChange={(e) => setDetails({ ...details, cropX: Number(e.target.value) })} /></label><label>Vertical position<input type="range" min={0} max={100} value={details.cropY} onChange={(e) => setDetails({ ...details, cropY: Number(e.target.value) })} /></label></div></div><div className="illustration-actions"><button type="button" onClick={() => { void saveDetails() }}>Save details</button><button type="button" onClick={() => { setDetails({ caption: image.caption, alt: image.alt, cropX: image.cropX, cropY: image.cropY }); setEditing(false) }}>Cancel</button></div></fieldset>}
      </>}
      {(error || loadError) && <p className="illustration-error" role="alert">{error || loadError}</p>}
      {readOnly && !image && !loading && <p className="illustration-help">No illustration saved.</p>}
    </div>
    {expanded && image && <FullImage image={image} title={entry.title} onClose={() => setExpanded(false)} />}
  </details>
}

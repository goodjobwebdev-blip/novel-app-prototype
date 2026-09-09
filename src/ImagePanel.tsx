import { useState } from 'react'
import type { AiSettings } from './ai-settings'
import { loadAiSettings } from './ai-settings'
import { ImageAssetPreview } from './ImageResults'
import ImageJobs from './ImageResults'
import ImageSettingsPanel from './ImageSettingsPanel'
import ImageGenerationControls, { type ImageDraft } from './ImageGenerationControls'
import { useImageQuery, useImageSettings } from './image-hooks'
import { availableImageCodex, deleteGalleryImage, enqueueImageJob, listGalleryImages, notifyImageStore } from './image-store'
import { loadImageSettings, resolveImageSpec } from './image-settings'
import { getIllustration, removeIllustration, saveIllustration } from './persistence'
import { checkStorageHeadroom, prepareIllustration } from './illustration-image'
import IllustrationModal from './IllustrationModal'
import type { GalleryImage } from './image-generation-types'
import './image-generation.css'
function Gallery({ bookId }: { bookId?: string }) {
  const [onlyBook, setOnlyBook] = useState(false), [query, setQuery] = useState(''), [limit, setLimit] = useState(40)
  const { data: assets, error } = useImageQuery(() => listGalleryImages(onlyBook ? bookId : undefined), [onlyBook, bookId], [])
  const { data: entries } = useImageQuery(() => availableImageCodex(bookId), [bookId], [])
  const [target, setTarget] = useState<GalleryImage>(), [entryId, setEntryId] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  const action = async (fn: () => Promise<void>) => { setMessage(''); setBusy(true); try { await fn() } catch (e) { setMessage(e instanceof Error ? e.message : 'Image action failed.') } finally { setBusy(false) } }
  const attach = async () => {
    if (!target || !entryId) return
    const previous = await getIllustration(entryId)
    if (previous && !window.confirm('Replace this Codex entry’s illustration? You can undo it from the entry.')) return
    const pixels = await prepareIllustration(target.image)
    await checkStorageHeadroom(pixels.image.size + pixels.thumbnail.size)
    await saveIllustration(entryId, pixels, { caption: target.prompt.slice(0, 2000), alt: '', cropX: 50, cropY: 50 }, previous?.id)
    window.dispatchEvent(new CustomEvent('arc-illustrations-changed', { detail: { entryId } }))
    notifyImageStore(); setTarget(undefined); setMessage('Added to Codex entry')
  }
  const visible = assets.filter((a) => `${a.prompt} ${a.modelAlias || ''} ${a.bookTitle || ''}`.toLowerCase().includes(query.toLowerCase()))
  return <section><div className="image-gallery-tools"><label className="image-check"><input type="checkbox" disabled={!bookId} checked={onlyBook} onChange={(e) => { setOnlyBook(e.target.checked); setLimit(40) }} />Only this book</label><input type="search" aria-label="Search gallery" placeholder="Search images" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(40) }} /></div><p className="image-help">All kept images and Codex illustrations on this device. Removing an image from chat keeps its gallery copy.</p>{(error || message) && <p role="status">{error || message}</p>}<div className="image-gallery-grid">{visible.slice(0, limit).map((asset) => <article key={asset.id}><ImageAssetPreview asset={asset} /><p className="image-prompt-preview">{asset.prompt || 'Codex illustration'}</p><small>{asset.modelAlias || 'Uploaded illustration'}</small><div className="image-actions">{bookId && <button type="button" disabled={busy} onClick={() => { setTarget(asset); setEntryId('') }}>Use in Codex</button>}<button type="button" disabled={busy} onClick={() => { if (window.confirm(asset.entryId ? 'Remove this illustration from its Codex entry? You can undo it from the entry.' : 'Delete this image from the gallery and its chat results? Download it first if you want a backup.')) void action(async () => { if (asset.entryId) { await removeIllustration(asset.entryId!, asset.illustrationId!); window.dispatchEvent(new CustomEvent('arc-illustrations-changed', { detail: { entryId: asset.entryId } })) } else await deleteGalleryImage(asset.id) }) }}>Delete image</button></div></article>)}</div>{!visible.length && <p>No images match. Generate and keep an image, or upload a Codex illustration.</p>}{visible.length > limit && <button type="button" onClick={() => setLimit(limit + 40)}>Show more images</button>}{target && <IllustrationModal title="Use in Codex" onClose={() => setTarget(undefined)}><label>Codex entry<select value={entryId} onChange={(e) => setEntryId(e.target.value)}><option value="">Choose an entry</option>{entries.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}</select></label>{!entries.length && <p>Create a Codex entry in this book first.</p>}<button type="button" disabled={!entryId || busy} onClick={() => { void action(attach) }}>Use illustration</button>{message && <p role="alert">{message}</p>}</IllustrationModal>}</section>
}
function Generate({ bookId, onSettings }: { bookId?: string; onSettings: () => void }) {
  const settings = useImageSettings()
  const [draft, setDraft] = useState<ImageDraft>(() => { const s = loadImageSettings(), favorite = s.favorites.find((f) => f.alias === s.defaultAlias); return { prompt: '', alias: favorite?.alias || '', size: favorite?.defaultSize || '1024x1024' } })
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const generate = async () => { setBusy(true); setError(''); try { await enqueueImageJob(resolveImageSpec(draft.prompt, draft.alias, draft.size), { bookId }) } catch (e) { setError(e instanceof Error ? e.message : 'Could not queue image.') } finally { setBusy(false) } }
  return <section><ImageGenerationControls value={draft} onChange={setDraft} disabled={busy} />{!settings.favorites.length && <button type="button" onClick={onSettings}>Set up image models</button>}<button type="button" disabled={busy || !settings.favorites.length} onClick={() => { void generate() }}>Generate</button>{error && <p role="alert">{error}</p>}<p className="image-help">Each tap queues one image. The queue continues while you switch chats or books. Keep the app open while generating; interrupted requests are never automatically resubmitted.</p><h2>Generation queue</h2><ImageJobs /></section>
}
export default function ImagePanel({ bookId, ai = loadAiSettings() }: { bookId?: string; ai?: AiSettings }) {
  const [tab, setTab] = useState<'generate' | 'gallery' | 'settings'>('generate')
  return <div className="image-ui image-panel"><h1 id="page-title">Images</h1><nav className="image-tabs" aria-label="Images">{(['generate', 'gallery', 'settings'] as const).map((t) => <button type="button" key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>{t === 'generate' ? 'Generate' : t === 'gallery' ? 'Gallery' : 'Settings'}</button>)}</nav>{tab === 'gallery' ? <Gallery bookId={bookId} /> : tab === 'settings' ? <ImageSettingsPanel ai={ai} /> : <Generate bookId={bookId} onSettings={() => setTab('settings')} />}</div>
}

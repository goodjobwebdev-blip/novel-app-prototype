import { useEffect, useState } from 'react'
import { Download, Expand, Trash2 } from 'lucide-react'
import IllustrationModal from './IllustrationModal'
import IllustrationGestures from './IllustrationGestures'
import { centeredImageView } from './image-gestures'
import { useImageQuery, useImageUrl } from './image-hooks'
import { cancelImageJob, clearImageQueue, decideImageJob, getGalleryImage, hideImageFromChat, listImageJobs, retryImageJob } from './image-store'
import { imageProviderNames } from './image-settings'
import type { GalleryImage, ImageJob } from './image-generation-types'
export function GeneratedImageViewer({ asset, onClose }: { asset: GalleryImage; onClose: () => void }) {
  const url = useImageUrl(asset.image)
  const [view, setView] = useState({ ...centeredImageView })
  return <IllustrationModal title="Image" fullScreen onClose={onClose}>{url && <IllustrationGestures src={url} alt={asset.prompt || 'Book illustration'} image={asset} value={view} onChange={setView} />}<details className="image-result-metadata"><summary>Prompt and image details</summary><p>{asset.prompt || 'Uploaded illustration'}</p>{asset.revisedPrompt && <p>Provider prompt: {asset.revisedPrompt}</p>}<dl><dt>Model</dt><dd>{asset.modelAlias || asset.model || 'Uploaded image'}{asset.provider ? ` · ${imageProviderNames[asset.provider]}` : ''}</dd><dt>Dimensions</dt><dd>{asset.width} × {asset.height}{asset.requestedSize && ` (requested ${asset.requestedSize})`}</dd><dt>Created</dt><dd>{new Date(asset.createdAt).toLocaleString()}</dd>{asset.durationMs !== undefined && <><dt>Generation time</dt><dd>{Math.round(asset.durationMs / 1000)} s</dd></>}{asset.seed !== undefined && <><dt>Seed</dt><dd>{asset.seed}</dd></>}{asset.cost !== undefined && <><dt>Provider cost</dt><dd>${asset.cost.toFixed(4)}</dd></>}{asset.bookTitle && <><dt>Book</dt><dd>{asset.bookTitle}</dd></>}</dl>{url && <a className="image-download" href={url} download={`arc-image-${asset.id}.${asset.image.type === 'image/jpeg' ? 'jpg' : asset.image.type === 'image/webp' ? 'webp' : 'png'}`}><Download size={18} /> Download image</a>}</details></IllustrationModal>
}
export function ImageAssetPreview({ asset }: { asset: GalleryImage }) {
  const thumb = useImageUrl(asset.thumbnail)
  const [open, setOpen] = useState(false)
  return <><button type="button" className="image-result-preview" onClick={() => setOpen(true)} aria-label="View image and prompt">{thumb && <img loading="lazy" src={thumb} alt={asset.prompt || 'Book illustration'} />}<Expand aria-hidden="true" size={20} /></button>{open && <GeneratedImageViewer asset={asset} onClose={() => setOpen(false)} />}</>
}
function JobResult({ job, chat }: { job: ImageJob; chat: boolean }) {
  const { data: asset, error: loadError } = useImageQuery(() => job.assetId ? getGalleryImage(job.assetId) : Promise.resolve(undefined), [job.assetId], undefined)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const action = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn() } catch (e) { setError(e instanceof Error ? e.message : 'Image action failed.') } finally { setBusy(false) } }
  if (job.decision === 'discarded') return <p className="image-help">Image discarded</p>
  return <div className="image-job-result">{asset ? <ImageAssetPreview asset={asset} /> : <p>{loadError || 'Loading image…'}</p>}<div className="image-actions">{!job.decision && asset && <><button disabled={busy} type="button" onClick={() => { void action(() => decideImageJob(job.id, true)) }}>Keep image</button><button disabled={busy} type="button" onClick={() => { void action(async () => { await decideImageJob(job.id, false); if (!chat) await clearImageQueue([job.id]) }) }}>Discard</button></>}{job.decision === 'kept' && <span>Saved to gallery</span>}{chat && <button disabled={busy} type="button" onClick={() => { void action(() => hideImageFromChat(job.id)) }}><Trash2 size={16} /> Remove from chat</button>}</div>{error && <p role="alert">{error}</p>}</div>
}
export default function ImageJobs({ proposalId, messageId }: { proposalId?: string; messageId?: string }) {
  const { data: jobs, error } = useImageQuery(listImageJobs, [], [])
  const [limit, setLimit] = useState(30), [clearing, setClearing] = useState(false)
  const [now, setNow] = useState(Date.now()), [actionError, setActionError] = useState('')
  const active = jobs.some((j) => ['queued', 'running'].includes(j.status))
  useEffect(() => { if (!active) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [active])
  const matching = jobs.filter((j) => proposalId ? (j.proposalId === proposalId && j.messageId === messageId && !j.hiddenInChat) : !j.hiddenInQueue)
  const visible = matching.filter((j, i) => ['queued', 'running'].includes(j.status) || i >= matching.length - limit)
  const action = (fn: () => Promise<unknown>) => { setActionError(''); void fn().catch((e) => setActionError(e instanceof Error ? e.message : 'Could not update this job.')) }
  const clear = async () => {
    const activeJobs = matching.some((j) => ['queued', 'running'].includes(j.status))
    const unkept = matching.some((j) => j.status === 'completed' && j.assetId && !j.decision)
    const warning = [
      'Clear the queue?',
      activeJobs ? 'Queued work will be cancelled and active requests stopped locally.' : '',
      unkept ? 'Unkept images will be discarded, including their chat results.' : '',
      'Kept gallery images and their chat attachments stay saved.',
      matching.some((j) => j.status === 'running') ? 'The provider may still finish or charge for requests already sent.' : '',
    ].filter(Boolean).join(' ')
    if ((activeJobs || unkept) && !window.confirm(warning)) return
    setClearing(true); setActionError('')
    try { await clearImageQueue(matching.map((j) => j.id)) }
    catch (e) { setActionError(e instanceof Error ? e.message : 'Could not clear the queue.') }
    finally { setClearing(false) }
  }
  return <div className="image-jobs">
    {!proposalId && matching.length > 0 && <div className="image-queue-actions">
      <span>{matching.length} {matching.length === 1 ? 'generation' : 'generations'}</span>
      <button type="button" disabled={clearing} onClick={() => { void clear() }}>Clear queue</button>
      <small>Removes jobs from this view. Kept gallery images stay saved.</small>
    </div>}
    {(error || actionError) && <p role="alert">{error || actionError}</p>}
    {!visible.length && !proposalId && <p className="image-help">Your generation queue is empty.</p>}
    {visible.map((job) => <article className="image-job" key={job.id}>
      <header><strong>{job.modelAlias}</strong><span>{job.status === 'running' ? `Generating · ${Math.max(0, Math.floor((now - (job.startedAt ?? now)) / 1000))} s` : job.status === 'queued' ? `Queued · #${jobs.filter((j) => j.provider === job.provider && j.status === 'queued').findIndex((j) => j.id === job.id) + 1}` : job.status}</span></header>
      <small>{job.size.width} × {job.size.height}{!proposalId && job.bookTitle ? ` · ${job.bookTitle}` : ''}</small>
      {!proposalId && <p className="image-prompt-preview">{job.prompt}</p>}
      {job.error && <p role="alert">{job.error}</p>}
      {job.status === 'completed' && <JobResult job={job} chat={Boolean(proposalId)} />}
      <div className="image-actions">
        {['queued', 'running'].includes(job.status) && <button type="button" onClick={() => action(() => cancelImageJob(job.id))}>{job.status === 'running' ? 'Stop waiting' : 'Cancel queued image'}</button>}
        {['failed', 'interrupted', 'cancelled'].includes(job.status) && <button type="button" onClick={() => action(() => retryImageJob(job.id))}>{job.providerJobId ? 'Check existing result' : 'Retry as new generation'}</button>}
        {!proposalId && !['queued', 'running'].includes(job.status) && (job.status !== 'completed' || job.decision || !job.assetId) && <button type="button" disabled={clearing} onClick={() => action(() => clearImageQueue([job.id]))}>Remove from queue</button>}
      </div>
      {job.status === 'running' && <small>Stopping does not guarantee the provider cancels its charge.</small>}
    </article>)}
    {visible.length < matching.length && <button type="button" onClick={() => setLimit(limit + 30)}>Show earlier generations</button>}
  </div>
}

import { useEffect, useState, type ReactNode } from 'react'
import { Download, Expand, Trash2 } from 'lucide-react'
import IllustrationModal from './IllustrationModal'
import IllustrationGestures from './IllustrationGestures'
import { centeredImageView } from './image-gestures'
import { useImageQuery, useImageUrl } from './image-hooks'
import { cancelImageJob, clearImageQueue, decideImageJob, getGalleryImage, hideImageFromChat, listImageJobs, retryImageJob } from './image-store'
import { imageProviderNames } from './image-settings'
import type { GalleryImage, ImageJob } from './image-generation-types'
export function GeneratedImageViewer({ asset, onClose, actions }: { asset: GalleryImage; onClose: () => void; actions?: ReactNode }) {
  const url = useImageUrl(asset.image)
  const [view, setView] = useState({ ...centeredImageView })
  const kind = asset.kind ?? 'image'
  const extension = asset.image.type === 'image/jpeg' ? 'jpg' : asset.image.type === 'image/webp' ? 'webp' : asset.image.type === 'video/webm' ? 'webm' : kind === 'video' ? 'mp4' : 'png'
  return <IllustrationModal title={kind === 'video' ? 'Video' : 'Image'} fullScreen onClose={onClose}>
    {url && (kind === 'video' ? <video className="image-video-player" src={url} controls playsInline preload="metadata" /> : <IllustrationGestures src={url} alt={asset.prompt || 'Book illustration'} image={asset} value={view} onChange={setView} />)}
    <div className="image-viewer-actions">
      {url && <a className="image-download" href={url} download={`arc-${kind}-${asset.id}.${extension}`}><Download size={18} /> Download {kind}</a>}
      {actions}
    </div>
    <details className="image-result-metadata"><summary>Prompt and {kind} details</summary><p>{asset.prompt || 'Uploaded illustration'}</p>{asset.revisedPrompt && <p>Provider prompt: {asset.revisedPrompt}</p>}<dl><dt>Model</dt><dd>{asset.modelAlias || asset.model || `Uploaded ${kind}`}{asset.provider ? ` · ${imageProviderNames[asset.provider]}` : ''}</dd><dt>Dimensions</dt><dd>{asset.width} × {asset.height}{asset.requestedSize && ` (requested ${asset.requestedSize})`}</dd>{asset.mediaDurationMs !== undefined && <><dt>Video duration</dt><dd>{(asset.mediaDurationMs / 1000).toFixed(1)} s</dd></>}<dt>Created</dt><dd>{new Date(asset.createdAt).toLocaleString()}</dd>{asset.durationMs !== undefined && <><dt>Generation time</dt><dd>{Math.round(asset.durationMs / 1000)} s</dd></>}{asset.seed !== undefined && <><dt>Seed</dt><dd>{asset.seed}</dd></>}{asset.cost !== undefined && <><dt>Provider cost</dt><dd>${asset.cost.toFixed(4)}</dd></>}{asset.bookTitle && <><dt>Book</dt><dd>{asset.bookTitle}</dd></>}</dl></details>
  </IllustrationModal>
}
export function ImageAssetPreview({ asset, renderViewerActions, onOpen }: { asset: GalleryImage; renderViewerActions?: (close: () => void) => ReactNode; onOpen?: () => void }) {
  const thumb = useImageUrl(asset.thumbnail)
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  const kind = asset.kind ?? 'image'
  return <><button type="button" className="image-result-preview" onClick={() => { onOpen?.(); setOpen(true) }} aria-label={`View ${kind} and prompt`}>{thumb && <img loading="lazy" src={thumb} alt={asset.prompt || (kind === 'video' ? 'Generated video' : 'Book illustration')} />}{kind === 'video' && <span className="image-video-badge">Video</span>}<Expand aria-hidden="true" size={20} /></button>{open && <GeneratedImageViewer asset={asset} onClose={close} actions={renderViewerActions?.(close)} />}</>
}
function JobResult({ job, chat }: { job: ImageJob; chat: boolean }) {
  const { data: asset, error: loadError } = useImageQuery(() => job.assetId ? getGalleryImage(job.assetId) : Promise.resolve(undefined), [job.assetId], undefined)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const action = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn() } catch (e) { setError(e instanceof Error ? e.message : 'Image action failed.') } finally { setBusy(false) } }
  const kind = job.task?.endsWith('video') ? 'video' : 'image'
  if (job.decision === 'discarded') return <p className="image-help">{kind === 'video' ? 'Video' : 'Image'} discarded</p>
  return <div className="image-job-result">{asset ? <ImageAssetPreview asset={asset} /> : <p>{loadError || `Loading ${kind}…`}</p>}<div className="image-actions">{!job.decision && asset && <><button disabled={busy} type="button" onClick={() => { void action(() => decideImageJob(job.id, true)) }}>Keep {kind}</button><button disabled={busy} type="button" onClick={() => { void action(async () => { await decideImageJob(job.id, false); if (!chat) await clearImageQueue([job.id]) }) }}>Discard</button></>}{job.decision === 'kept' && <span>Saved to gallery</span>}{chat && <button disabled={busy} type="button" onClick={() => { void action(() => hideImageFromChat(job.id)) }}><Trash2 size={16} /> Remove from chat</button>}</div>{error && <p role="alert">{error}</p>}</div>
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
  const groups = [
    { title: 'Active', jobs: visible.filter((job) => ['queued', 'running'].includes(job.status)) },
    { title: 'Needs review', jobs: visible.filter((job) => job.status === 'completed' && Boolean(job.assetId) && !job.decision) },
    { title: 'Attention', jobs: visible.filter((job) => ['failed', 'interrupted', 'cancelled'].includes(job.status)) },
    { title: 'Earlier', jobs: visible.filter((job) => job.status === 'completed' && (!job.assetId || Boolean(job.decision))) },
  ].filter((group) => group.jobs.length)
  const jobCard = (job: ImageJob) => <article className="image-job" key={job.id}>
    <header><strong>{job.modelAlias}</strong><span>{job.status === 'running' ? `Generating · ${Math.max(0, Math.floor((now - (job.startedAt ?? now)) / 1000))} s` : job.status === 'queued' ? `Queued · #${jobs.filter((item) => item.provider === job.provider && item.status === 'queued').findIndex((item) => item.id === job.id) + 1}` : job.status}</span></header>
    <small>{job.task?.endsWith('video') ? `${job.video?.resolution ?? `${job.size.width} × ${job.size.height}`}${job.video?.duration ? ` · ${job.video.duration} s` : ''}` : `${job.size.width} × ${job.size.height}`}{!proposalId && job.bookTitle ? ` · ${job.bookTitle}` : ''}</small>
    {!proposalId && <p className="image-prompt-preview">{job.prompt}</p>}
    {job.error && <p role="alert">{job.error}</p>}
    {job.status === 'completed' && <JobResult job={job} chat={Boolean(proposalId)} />}
    <div className="image-actions">
      {['queued', 'running'].includes(job.status) && <button type="button" onClick={() => action(() => cancelImageJob(job.id))}>{job.status === 'running' ? 'Stop waiting' : 'Cancel queued image'}</button>}
      {['failed', 'interrupted', 'cancelled'].includes(job.status) && <button type="button" onClick={() => action(() => retryImageJob(job.id))}>{job.providerJobId ? 'Check existing result' : 'Retry as new generation'}</button>}
      {!proposalId && !['queued', 'running'].includes(job.status) && (job.status !== 'completed' || job.decision || !job.assetId) && <button type="button" disabled={clearing} onClick={() => action(() => clearImageQueue([job.id]))}>Remove from queue</button>}
    </div>
    {job.status === 'running' && <small>Stopping does not guarantee the provider cancels its charge.</small>}
  </article>
  return <div className="image-jobs">
    {!proposalId && matching.length > 0 && <div className="image-queue-actions">
      <span>{matching.length} {matching.length === 1 ? 'generation' : 'generations'}</span>
      <button type="button" disabled={clearing} onClick={() => { void clear() }}>Clear queue</button>
      <small>Removes jobs from this view. Kept gallery images stay saved.</small>
    </div>}
    {(error || actionError) && <p role="alert">{error || actionError}</p>}
    {!visible.length && !proposalId && <p className="image-help">Your generation queue is empty.</p>}
    {groups.map((group) => <section className="image-job-group" aria-labelledby={`image-job-group-${group.title.toLowerCase().replace(' ', '-')}`} key={group.title}>
      <h3 id={`image-job-group-${group.title.toLowerCase().replace(' ', '-')}`}>{group.title}<span>{group.jobs.length}</span></h3>
      <div className="image-job-list">{group.jobs.map(jobCard)}</div>
    </section>)}
    {visible.length < matching.length && <button type="button" onClick={() => setLimit(limit + 30)}>Show earlier generations</button>}
  </div>
}

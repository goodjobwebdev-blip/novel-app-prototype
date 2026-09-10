import { database, getEntity, type ArcEntity, type Illustration } from './persistence'
import { resolveImageSpec } from './image-settings'
import type { ChatImageProposal, GalleryImage, ImageGenerationSpec, ImageJob, ImageProvider } from './image-generation-types'
import type { ImageOutput } from './image-providers'
export const IMAGE_STORE_CHANGED = 'arc-image-store-changed'
export function notifyImageStore() { if (typeof window !== 'undefined') window.dispatchEvent(new Event(IMAGE_STORE_CHANGED)) }
export function imageId(prefix: string) { return `${prefix}-${crypto.randomUUID()}` }
export async function listImageJobs(): Promise<ImageJob[]> {
  return (await (await database()).table('imageJobs').toArray()).sort((a: ImageJob, b: ImageJob) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}
export async function getGalleryImage(id: string): Promise<GalleryImage | undefined> { return (await database()).table('galleryImages').get(id) }
export async function listGalleryImages(bookId?: string): Promise<GalleryImage[]> {
  const db = await database()
  const generated: GalleryImage[] = await db.table('galleryImages').toArray()
  const uploads: Illustration[] = await db.table('illustrations').toArray()
  return [...generated.filter((a) => a.kept), ...uploads.map((a): GalleryImage => ({ id: `codex:${a.id}`, entryId: a.entryId, illustrationId: a.id, bookId: a.bookId, prompt: a.caption, image: a.image, thumbnail: a.thumbnail, width: a.width, height: a.height, createdAt: a.createdAt, kept: true }))]
    .filter((a) => !bookId || a.bookId === bookId).sort((a, b) => b.createdAt - a.createdAt)
}
export type ImageJobOrigin = { bookId?: string; chatId?: string; messageId?: string; proposalId?: string }
export async function enqueueImageJob(spec: ImageGenerationSpec, origin: ImageJobOrigin = {}): Promise<ImageJob> {
  // Revalidate the current favorites on every Generate click, then freeze this request.
  const clean = resolveImageSpec(spec.prompt, spec.modelAlias, spec.size.value)
  const db = await database()
  const job = await db.transaction('rw', db.table('entities'), db.table('imageJobs'), async () => {
    const book = origin.bookId ? await db.table('entities').get(origin.bookId) : undefined
    if (origin.bookId && book?.type !== 'book') throw new Error('This book no longer exists.')
    if (origin.messageId) {
      const message = await db.table('entities').get(origin.messageId)
      const chat = await db.table('entities').get(origin.chatId)
      const proposal: ChatImageProposal | undefined = message?.imageGenerations?.find((p: ChatImageProposal) => p.id === origin.proposalId)
      if (chat?.type !== 'chat' || message?.type !== 'chatMessage' || message.parentId !== origin.chatId || message.bookId !== origin.bookId || chat.bookId !== origin.bookId || proposal?.status !== 'accepted') throw new Error('Accept an available image proposal before generating.')
    } else if (origin.chatId || origin.proposalId) throw new Error('This image proposal is no longer available.')
    const record: ImageJob = { ...clean, ...origin, id: imageId('image-job'), bookTitle: book?.title, status: 'queued', createdAt: Date.now() }
    await db.table('imageJobs').add(record)
    return record
  })
  notifyImageStore()
  return job
}
export async function claimImageJob(provider: ImageProvider, owner: string): Promise<ImageJob | undefined> {
  const db = await database()
  return db.transaction('rw', db.table('imageJobs'), async () => {
    const jobs: ImageJob[] = await db.table('imageJobs').where('provider').equals(provider).toArray()
    if (jobs.some((j) => j.status === 'running')) return
    const next = jobs.filter((j) => j.status === 'queued').sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))[0]
    if (!next) return
    const job = { ...next, status: 'running' as const, owner, startedAt: next.providerJobId ? next.startedAt ?? Date.now() : Date.now(), heartbeat: Date.now(), error: undefined }
    await db.table('imageJobs').put(job)
    return job
  })
}
export async function patchOwnedImageJob(id: string, owner: string, patch: Partial<ImageJob>) {
  const db = await database()
  const changed = await db.transaction('rw', db.table('imageJobs'), async () => {
    const current = await db.table('imageJobs').get(id)
    if (current?.status !== 'running' || current.owner !== owner) return false
    await db.table('imageJobs').update(id, patch)
    return true
  })
  notifyImageStore()
  return changed
}
export async function completeImageJob(job: ImageJob, output: ImageOutput) {
  const db = await database()
  await db.transaction('rw', db.table('imageJobs'), db.table('galleryImages'), async () => {
    const current: ImageJob | undefined = await db.table('imageJobs').get(job.id)
    if (current?.status !== 'running' || current.owner !== job.owner) return
    const asset: GalleryImage = { ...output, id: imageId('generated'), kept: false, bookId: job.bookId, bookTitle: job.bookTitle, prompt: job.prompt, provider: job.provider, model: job.model, modelAlias: job.modelAlias, requestedSize: job.size.value, createdAt: Date.now(), durationMs: Date.now() - (job.startedAt ?? job.createdAt) }
    await db.table('galleryImages').add(asset)
    await db.table('imageJobs').update(job.id, { status: 'completed', completedAt: Date.now(), assetId: asset.id })
  })
  notifyImageStore()
}
export async function decideImageJob(id: string, keep: boolean) {
  const db = await database()
  await db.transaction('rw', db.table('imageJobs'), db.table('galleryImages'), async () => {
    const job: ImageJob | undefined = await db.table('imageJobs').get(id)
    if (!job?.assetId || job.status !== 'completed' || job.decision) return
    const asset = await db.table('galleryImages').get(job.assetId)
    if (!asset) throw new Error('This image is no longer available.')
    if (keep) await db.table('galleryImages').update(asset.id, { kept: true })
    else await db.table('galleryImages').delete(asset.id)
    await db.table('imageJobs').update(id, { decision: keep ? 'kept' : 'discarded' })
  })
  notifyImageStore()
}
export async function cancelImageJob(id: string) {
  const db = await database()
  await db.transaction('rw', db.table('imageJobs'), async () => {
    const job = await db.table('imageJobs').get(id)
    if (job && ['queued', 'running'].includes(job.status)) await db.table('imageJobs').update(id, { status: 'cancelled', completedAt: Date.now() })
  })
  notifyImageStore()
}
export async function hideImageFromChat(id: string) {
  await (await database()).table('imageJobs').update(id, { hiddenInChat: true })
  notifyImageStore()
}
export async function clearImageQueue(ids: string[]) {
  const db = await database()
  await db.transaction('rw', db.table('imageJobs'), db.table('galleryImages'), async () => {
    // Clear only the selected snapshot, so newly queued jobs are left alone.
    const jobs: (ImageJob | undefined)[] = await db.table('imageJobs').bulkGet([...new Set(ids)])
    for (const job of jobs) {
      if (!job || job.hiddenInQueue) continue
      const patch: Partial<ImageJob> = { hiddenInQueue: true }
      if (['queued', 'running'].includes(job.status)) {
        patch.status = 'cancelled'
        patch.completedAt = Date.now()
      }
      if (job.assetId) {
        const asset: GalleryImage | undefined = await db.table('galleryImages').get(job.assetId)
        if (!asset?.kept) {
          await db.table('galleryImages').delete(job.assetId)
          patch.assetId = undefined
          patch.decision = 'discarded'
        }
      }
      // Retain job metadata for chat references and kept-image backups.
      await db.table('imageJobs').update(job.id, patch)
    }
  })
  // The queue manager aborts local waiting; late responses cannot restore cancelled jobs.
  notifyImageStore()
}
export async function deleteGalleryImage(id: string) {
  const db = await database()
  await db.transaction('rw', db.table('galleryImages'), db.table('imageJobs'), async () => {
    await db.table('galleryImages').delete(id)
    await db.table('imageJobs').filter((j: ImageJob) => j.assetId === id).modify({ decision: 'discarded', assetId: undefined })
  })
  notifyImageStore()
}
// Call only while holding the provider's browser lock; no other tab can be its worker.
export async function recoverImageJobs(provider: ImageProvider, staleBefore?: number) {
  const db = await database()
  await db.transaction('rw', db.table('imageJobs'), async () => {
    const jobs: ImageJob[] = await db.table('imageJobs').where('provider').equals(provider).toArray()
    for (const job of jobs.filter((j) => j.status === 'running' && (staleBefore === undefined || (j.heartbeat ?? j.startedAt ?? 0) < staleBefore))) await db.table('imageJobs').update(job.id, { status: job.providerJobId ? 'queued' : 'interrupted', error: job.providerJobId ? undefined : 'The app closed before the response was saved. Check the provider before starting another paid generation.' })
  })
  notifyImageStore()
}
export async function retryImageJob(id: string) {
  const db = await database()
  const job: ImageJob | undefined = await db.table('imageJobs').get(id)
  if (!job || !['failed', 'interrupted', 'cancelled'].includes(job.status)) throw new Error('This job cannot be retried.')
  if (job.provider === 'pruna' && job.providerJobId) {
    await db.transaction('rw', db.table('imageJobs'), async () => {
      const current = await db.table('imageJobs').get(id)
      if (current && ['failed', 'interrupted', 'cancelled'].includes(current.status)) await db.table('imageJobs').update(id, { status: 'queued', error: undefined, hiddenInQueue: false })
    })
    notifyImageStore()
  } else await enqueueImageJob(job, { bookId: job.bookId, chatId: job.chatId, messageId: job.messageId, proposalId: job.proposalId })
}
export async function setImageProposal(messageId: string, proposalId: string, status: 'accepted' | 'rejected', input?: { prompt: string; alias: string; size: string }) {
  const spec = input ? resolveImageSpec(input.prompt, input.alias, input.size) : undefined
  const db = await database()
  await db.transaction('rw', db.table('entities'), async () => {
    const message = await db.table('entities').get(messageId)
    if (message?.type !== 'chatMessage') throw new Error('This message no longer exists.')
    const proposals: ChatImageProposal[] = message.imageGenerations ?? []
    const proposal = proposals.find((p) => p.id === proposalId)
    if (!proposal || proposal.status !== 'proposed') throw new Error('This proposal has already been handled.')
    const next = { ...proposal, status, ...(spec ? { prompt: spec.prompt, modelAlias: spec.modelAlias, size: spec.size.value } : {}) }
    await db.table('entities').update(messageId, { imageGenerations: proposals.map((p) => p.id === proposalId ? next : p), updatedAt: Date.now() })
  })
  notifyImageStore()
}
export async function availableImageCodex(bookId?: string): Promise<ArcEntity[]> {
  return bookId ? (await (await database()).table('entities').where('bookId').equals(bookId).toArray()).filter((e: ArcEntity) => e.type === 'codexEntry' && !e.archivedAt) : []
}
export { getEntity }

import { checkStorageHeadroom } from './illustration-image'
import { loadAiSettings } from './ai-settings'
import { getBookAiSettings } from './persistence'
import { IMAGE_PROVIDERS, resolveImageKey } from './image-settings'
import { claimImageJob, completeImageJob, getEntity, IMAGE_STORE_CHANGED, listImageJobs, notifyImageStore, patchOwnedImageJob, recoverImageJobs } from './image-store'
import { generateProviderImage, prepareGeneratedImage, safeImageError } from './image-providers'
import { IMAGE_QUEUE_CONCURRENCY, generationTask, type ImageJob, type ImageProvider } from './image-generation-types'

const active = new Map<string, AbortController>()
let stopQueue: (() => void) | undefined
export type ImageQueueDependencies = { generate: typeof generateProviderImage; prepare: typeof prepareGeneratedImage; key: (job: ImageJob) => Promise<string> }
const dependencies: ImageQueueDependencies = {
  generate: generateProviderImage, prepare: prepareGeneratedImage,
  key: async (job) => resolveImageKey(job.provider, undefined, job.bookId ? await getBookAiSettings(job.bookId, loadAiSettings().favorites) : loadAiSettings()),
}
async function runClaimedImageJob(job: ImageJob, owner: string, deps: ImageQueueDependencies) {
  const controller = new AbortController()
  active.set(job.id, controller)
  notifyImageStore()
  const heartbeat = setInterval(() => { void patchOwnedImageJob(job.id, owner, { heartbeat: Date.now() }).then((exists) => { if (!exists) controller.abort() }).catch(() => controller.abort()) }, 5000)
  let key = ''
  try {
    if (job.messageId && !await getEntity(job.messageId)) throw new Error('The source chat message was deleted.')
    const video = generationTask(job).endsWith('video')
    await checkStorageHeadroom((video ? 200 : 20) * 1024 * 1024)
    key = await deps.key(job)
    const output = await deps.generate(job, key, AbortSignal.any([controller.signal, AbortSignal.timeout((video ? 20 : 10) * 60_000)]), async (id) => {
      if (!await patchOwnedImageJob(job.id, owner, { providerJobId: id })) throw new Error('The job was cancelled before its provider ID could be saved.')
    })
    controller.signal.throwIfAborted()
    await completeImageJob(job, await deps.prepare(output))
  } catch (error) {
    await patchOwnedImageJob(job.id, owner, { status: controller.signal.aborted ? 'interrupted' : 'failed', completedAt: Date.now(), error: safeImageError(error, key) }).catch(() => undefined)
  } finally { clearInterval(heartbeat); active.delete(job.id) }
}

export async function runImageQueue(provider: ImageProvider, deps = dependencies, canContinue = () => true) {
  const owner = crypto.randomUUID()
  const running = new Set<Promise<void>>()
  let revision = 0
  let wake: (() => void) | undefined
  const changed = () => { revision++; wake?.() }
  if (typeof window !== 'undefined') window.addEventListener(IMAGE_STORE_CHANGED, changed)
  try {
    while (canContinue()) {
      const observed = revision
      // Claims enforce the same cap transactionally across all workers and tabs.
      while (canContinue() && running.size < IMAGE_QUEUE_CONCURRENCY) {
        const job = await claimImageJob(provider, owner)
        if (!job) break
        const task = runClaimedImageJob(job, owner, deps).finally(() => { running.delete(task); changed() })
        running.add(task)
      }
      if (!running.size) return
      if (revision !== observed) continue
      // New clicks can fill a free slot while an earlier request is still running.
      // Polling also notices work queued by another tab, whose DOM events are local.
      let timer: ReturnType<typeof setTimeout> | undefined
      await new Promise<void>((resolve) => { wake = resolve; timer = setTimeout(resolve, 2500) })
      clearTimeout(timer); wake = undefined
    }
  } finally {
    if (typeof window !== 'undefined') window.removeEventListener(IMAGE_STORE_CHANGED, changed)
    // Keep the provider lock until every claimed request has settled.
    await Promise.all(running)
  }
}

export function startImageQueue() {
  if (stopQueue) return () => {}
  let stopped = false
  const busy = new Set<ImageProvider>()
  const kick = () => {
    if (stopped) return
    void listImageJobs().then((jobs) => {
      for (const [id, controller] of active) if (!jobs.some((j) => j.id === id && j.status === 'running')) controller.abort()
      for (const provider of IMAGE_PROVIDERS) {
        if (busy.has(provider) || !jobs.some((j) => j.provider === provider && ['queued', 'running'].includes(j.status))) continue
        busy.add(provider)
        const work = async () => {
          if (stopped) return
          await recoverImageJobs(provider)
          await runImageQueue(provider, dependencies, () => !stopped)
        }
        // A browser lock spans network requests: another tab cannot submit the same
        // jobs or misclassify this tab's active request as interrupted.
        const task = navigator.locks
          ? navigator.locks.request(`arc-image-queue-${provider}`, { ifAvailable: true }, async (lock) => { if (lock) await work() })
          : recoverImageJobs(provider, Date.now() - 120000).then(() => runImageQueue(provider, dependencies, () => !stopped))
        void task.catch(() => undefined).finally(() => busy.delete(provider))
      }
    }).catch(() => undefined)
  }
  const timer = setInterval(kick, 2500)
  window.addEventListener(IMAGE_STORE_CHANGED, kick)
  window.addEventListener('online', kick)
  kick()
  stopQueue = () => { stopped = true; clearInterval(timer); window.removeEventListener(IMAGE_STORE_CHANGED, kick); window.removeEventListener('online', kick); active.forEach((controller) => controller.abort()); stopQueue = undefined }
  return stopQueue
}

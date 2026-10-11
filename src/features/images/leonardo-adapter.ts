import { buildLeonardoRequest, LEONARDO_API } from './leonardo-contracts'
import type { ImageJob } from './image-generation-types'
function ticket(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) throw new Error('Leonardo returned an invalid generation ID. Check provider history before starting another paid generation.')
  return value
}
async function json(response: Response, retryNetworkErrors = false) {
  if (!response.ok) throw new Error(`Leonardo request failed (${response.status}).`)
  try { return await response.json() } catch (error) {
    if (retryNetworkErrors && error instanceof TypeError) throw error
    throw new Error('Leonardo returned invalid JSON.')
  }
}
const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504])
function retryDelay(response: Response | undefined, attempt: number): number {
  const fallback = Math.min(2000 * 2 ** attempt, 30000)
  const value = response?.headers.get('Retry-After')?.trim()
  if (!value) return fallback
  const delay = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now()
  return Number.isFinite(delay) ? Math.max(2000, Math.min(delay, 30000)) : fallback
}
async function poll(url: string, init: RequestInit, signal: AbortSignal, fetcher: typeof fetch, pause: (ms: number) => Promise<void>) {
  for (let attempt = 0; attempt < 5; attempt++) {
    signal.throwIfAborted()
    let response: Response | undefined
    try {
      response = await fetcher(url, init)
      if (!TRANSIENT_STATUS.has(response.status) || attempt === 4) return await json(response, true)
    } catch (error) {
      signal.throwIfAborted()
      if (!(error instanceof TypeError)) throw error
      if (attempt === 4) throw new Error('Leonardo polling network request failed. Resume the saved ticket; do not start another paid generation.')
    }
    // Only the idempotent ticket reader retries. Submission is never retried.
    await pause(retryDelay(response, attempt))
  }
  throw new Error('Leonardo polling retries exhausted.')
}
export async function generateLeonardo(job: ImageJob, key: string, signal: AbortSignal, onSubmitted: (id: string) => Promise<void>, fetcher: typeof fetch, pause: (ms: number) => Promise<void>): Promise<string> {
  const headers = { Authorization: `Bearer ${key}`, Accept: 'application/json' }
  let id = job.providerJobId ? ticket(job.providerJobId) : undefined
  if (!id) {
    const body = JSON.stringify(buildLeonardoRequest(job))
    let submission: Response
    try {
      submission = await fetcher(`${LEONARDO_API}/v2/generations`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body, credentials: 'omit', redirect: 'error', signal })
    } catch {
      throw new Error('Leonardo submission outcome is unknown. Check provider history before starting another paid generation.')
    }
    const submitted = await json(submission)
    id = ticket(submitted?.generationId)
    await onSubmitted(id)
  }
  for (let attempt = 0; attempt < 300; attempt++) {
    signal.throwIfAborted()
    const data = await poll(`${LEONARDO_API}/v1/generations/${encodeURIComponent(id)}`, { headers, credentials: 'omit', redirect: 'error', signal }, signal, fetcher, pause)
    const result = data?.generations_by_pk
    if (!result || !['PENDING', 'COMPLETE', 'FAILED'].includes(result.status) || !Array.isArray(result.generated_images)) throw new Error('Leonardo returned an invalid generation result.')
    if (result.status === 'FAILED') throw new Error('Leonardo generation failed. Provider moderation and other failures cannot be bypassed.')
    if (result.status === 'COMPLETE') {
      if (result.generated_images.length !== 1 || typeof result.generated_images[0]?.url !== 'string' || !result.generated_images[0]?.id) throw new Error('Leonardo completed without exactly one downloadable output.')
      return result.generated_images[0].url
    }
    await pause(2000)
  }
  throw new Error('Leonardo waiting timed out. Retry this saved ticket to continue polling, not to submit again.')
}

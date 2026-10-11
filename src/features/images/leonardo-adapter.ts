import { buildLeonardoRequest, LEONARDO_API } from './leonardo-contracts'
import type { ImageJob } from './image-generation-types'
function ticket(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) throw new Error('Leonardo returned an invalid generation ID. Check provider history before starting another paid generation.')
  return value
}
async function json(response: Response) {
  if (!response.ok) throw new Error(`Leonardo request failed (${response.status}).`)
  try { return await response.json() } catch { throw new Error('Leonardo returned invalid JSON.') }
}
export async function generateLeonardo(job: ImageJob, key: string, signal: AbortSignal, onSubmitted: (id: string) => Promise<void>, fetcher: typeof fetch, pause: (ms: number) => Promise<void>): Promise<string> {
  const headers = { Authorization: `Bearer ${key}`, Accept: 'application/json' }
  let id = job.providerJobId ? ticket(job.providerJobId) : undefined
  if (!id) {
    const body = JSON.stringify(buildLeonardoRequest(job))
    const submitted = await json(await fetcher(`${LEONARDO_API}/v2/generations`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body, credentials: 'omit', redirect: 'error', signal }))
    id = ticket(submitted?.generationId)
    await onSubmitted(id)
  }
  for (let attempt = 0; attempt < 300; attempt++) {
    signal.throwIfAborted()
    const data = await json(await fetcher(`${LEONARDO_API}/v1/generations/${encodeURIComponent(id)}`, { headers, credentials: 'omit', redirect: 'error', signal }))
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

import { loadAiSettings } from '../../shared/ai/ai-settings'
import { generationTask, type ImageJob, type ImageProvider } from './image-generation-types'
import type { ImageProviderCredentials } from './image-providers'
import { loadImageSettings, resolveImageKey, resolvePrunaGatewayUrl } from './image-settings'

export function captureImageCredentials(provider: ImageProvider): ImageProviderCredentials {
  // Resolve only connections, never the current media profile/model inventory.
  const ai = loadAiSettings(), settings = loadImageSettings()
  const key = resolveImageKey(provider, settings, ai)
  return provider === 'pruna' ? { key, gatewayUrl: resolvePrunaGatewayUrl(ai) } : key
}

export async function imageConnectionFingerprint(provider: ImageProvider, credentials: ImageProviderCredentials): Promise<string> {
  const key = typeof credentials === 'string' ? credentials : credentials.key
  const gatewayUrl = typeof credentials === 'string' ? '' : credentials.gatewayUrl
  const endpoint = provider === 'pruna' ? (gatewayUrl ? new URL(gatewayUrl).href.replace(/\/$/, '') : '') : provider === 'openai' ? 'https://api.openai.com/v1' : 'https://nano-gpt.com'
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([provider, endpoint, key])))
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`
}

export function assertImageJobConnection(job: ImageJob, fingerprint: string) {
  if (job.providerJobId) {
    const resumable = job.provider === 'pruna' || (job.provider === 'nanogpt' && generationTask(job).endsWith('video'))
    if (!resumable || !job.localConnectionFingerprint) throw new Error('This provider ticket has no verified local connection. Review the provider history before restarting a new paid generation.')
  }
  // Only legacy jobs without a ticket may acquire their first connection at execution.
  if (job.localConnectionFingerprint && job.localConnectionFingerprint !== fingerprint) throw new Error(job.providerJobId
    ? 'The provider endpoint or account changed since this ticket was submitted. Restore the original connection to retry, or review the provider history before restarting a new paid generation.'
    : 'The provider endpoint or account changed since this generation was queued. Restore the original connection, or explicitly retry to approve a new paid generation using the current connection.')
}

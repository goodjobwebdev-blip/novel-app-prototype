export const NANOGPT_BASE_URL = 'https://api.nano-gpt.com/api/v1'

/** Upgrade only the former built-in endpoint; leave custom gateways unchanged. */
export function normalizeNanoGPTBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  return !normalized || normalized === 'https://nano-gpt.com/api/v1' ? NANOGPT_BASE_URL : baseUrl
}

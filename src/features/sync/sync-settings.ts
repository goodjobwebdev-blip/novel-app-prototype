export const SYNC_SETTINGS_KEY = 'arc.sync.settings.v1'
export const SYNC_SETTINGS_EVENT = 'arc-sync-settings-changed'

export type SyncSettings = {
  endpoint: string
  basicUsername: string
  basicPassword: string
  token: string
  automaticUpload: boolean
}

export const defaultSyncSettings: SyncSettings = {
  endpoint: '',
  basicUsername: '',
  basicPassword: '',
  token: '',
  automaticUpload: false,
}

export function normalizeSyncEndpoint(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  let url: URL
  try { url = new URL(trimmed) } catch { throw new Error('Enter a valid sync server URL.') }
  if (url.username || url.password) throw new Error('Do not place credentials in the sync server URL.')
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !localHttp) throw new Error('The sync server must use HTTPS.')
  url.pathname = url.pathname.replace(/\/+$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

export function loadSyncSettings(): SyncSettings {
  if (typeof localStorage === 'undefined') return { ...defaultSyncSettings }
  try {
    const value = JSON.parse(localStorage.getItem(SYNC_SETTINGS_KEY) ?? '{}')
    return {
      endpoint: typeof value.endpoint === 'string' ? value.endpoint : '',
      basicUsername: typeof value.basicUsername === 'string' ? value.basicUsername : '',
      basicPassword: typeof value.basicPassword === 'string' ? value.basicPassword : '',
      token: typeof value.token === 'string' ? value.token : '',
      automaticUpload: value.automaticUpload === true,
    }
  } catch {
    return { ...defaultSyncSettings }
  }
}

export function saveSyncSettings(value: SyncSettings): SyncSettings {
  const normalized = { ...value, endpoint: normalizeSyncEndpoint(value.endpoint) }
  if (normalized.endpoint && (!normalized.basicUsername.trim() || !normalized.basicPassword || normalized.token.trim().length < 32)) {
    throw new Error('Enter the Basic Auth username and password plus a sync token of at least 32 characters.')
  }
  localStorage.setItem(SYNC_SETTINGS_KEY, JSON.stringify(normalized))
  window.dispatchEvent(new CustomEvent(SYNC_SETTINGS_EVENT))
  return normalized
}

export function syncIsConfigured(value = loadSyncSettings()): boolean {
  try {
    return Boolean(normalizeSyncEndpoint(value.endpoint) && value.basicUsername.trim() && value.basicPassword && value.token.trim().length >= 32)
  } catch {
    return false
  }
}

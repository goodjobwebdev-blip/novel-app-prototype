import type { SyncSettings } from './sync-settings'
import { normalizeSyncEndpoint } from './sync-settings'

export type RemoteBook = {
  id: string
  clientBookId: string
  title: string
  currentRevision: number
  currentEtag: string
  currentContentHash?: string
  currentSize: number
  createdAt: string
  updatedAt: string
}

export class SyncApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(message: string, status: number, code = '') {
    super(message)
    this.status = status
    this.code = code
  }
}

function basicAuthorization(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `Basic ${btoa(binary)}`
}

function headers(settings: SyncSettings, extra?: HeadersInit): Headers {
  const result = new Headers(extra)
  result.set('Authorization', basicAuthorization(settings.basicUsername.trim(), settings.basicPassword))
  result.set('X-Sync-Token', settings.token.trim())
  return result
}

async function apiFetch(settings: SyncSettings, path: string, init: RequestInit = {}): Promise<Response> {
  const endpoint = normalizeSyncEndpoint(settings.endpoint)
  const response = await fetch(`${endpoint}/api/v1${path}`, { ...init, credentials: 'include', cache: 'no-store', headers: headers(settings, init.headers) })
  if (!response.ok) {
    let code = ''
    let message = `Sync server returned ${response.status}.`
    try {
      const body = await response.json()
      code = typeof body?.error?.code === 'string' ? body.error.code : ''
      if (typeof body?.error?.message === 'string') message = body.error.message
    } catch { /* Never expose an HTML proxy response. */ }
    throw new SyncApiError(message, response.status, code)
  }
  return response
}

export async function testSyncConnection(settings: SyncSettings): Promise<{ id: string; email: string }> {
  return (await apiFetch(settings, '/me')).json()
}

export async function listRemoteBooks(settings: SyncSettings): Promise<RemoteBook[]> {
  const result = await (await apiFetch(settings, '/books')).json()
  return Array.isArray(result.books) ? result.books : []
}

export async function createRemoteBook(settings: SyncSettings, clientBookId: string, title: string): Promise<{ book: RemoteBook; etag: string }> {
  const response = await apiFetch(settings, '/books', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientBookId, title }) })
  return { book: await response.json(), etag: response.headers.get('ETag') ?? '"rev-0-empty"' }
}

export async function getRemoteBook(settings: SyncSettings, remoteBookId: string): Promise<{ book: RemoteBook; etag: string }> {
  const response = await apiFetch(settings, `/books/${encodeURIComponent(remoteBookId)}`)
  const book = await response.json() as RemoteBook
  return { book, etag: response.headers.get('ETag') ?? `"${book.currentEtag}"` }
}

export async function uploadRemoteBook(settings: SyncSettings, remoteBookId: string, archive: Blob, etag: string, deviceId: string): Promise<{ book: RemoteBook; etag: string }> {
  const response = await apiFetch(settings, `/books/${encodeURIComponent(remoteBookId)}/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/vnd.arc-book', 'If-Match': etag, 'X-Device-ID': deviceId },
    body: archive,
  })
  const book = await response.json() as RemoteBook
  return { book, etag: response.headers.get('ETag') ?? `"${book.currentEtag}"` }
}

export async function downloadRemoteBook(settings: SyncSettings, remoteBookId: string): Promise<{ archive: Blob; etag: string }> {
  const response = await apiFetch(settings, `/books/${encodeURIComponent(remoteBookId)}/state`)
  return { archive: await response.blob(), etag: response.headers.get('ETag') ?? '' }
}

export async function deleteRemoteBook(settings: SyncSettings, remoteBookId: string): Promise<void> {
  await apiFetch(settings, `/books/${encodeURIComponent(remoteBookId)}`, { method: 'DELETE' })
}

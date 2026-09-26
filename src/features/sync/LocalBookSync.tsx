import { useState } from 'react'
import { CloudUpload, X } from 'lucide-react'
import type { BookEntity } from '../../data/persistence'
import { enableBookSync, syncBookNow } from './sync-service'
import { listSyncLinks } from './sync-persistence'
import { loadSyncSettings, normalizeSyncEndpoint, syncIsConfigured } from './sync-settings'
import './sync.css'

export default function LocalBookSync({ books, beforeSync, onConfigure, onRemoteApplied }: {
  books: BookEntity[]
  beforeSync: () => Promise<void>
  onConfigure: () => void
  onRemoteApplied: (bookId: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [connected, setConnected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function refreshConnections() {
    const settings = loadSyncSettings()
    const endpoint = normalizeSyncEndpoint(settings.endpoint)
    const links = await listSyncLinks()
    setConnected(new Set(links.filter(link => link.endpoint === endpoint).map(link => link.bookId)))
  }

  async function show() {
    if (!syncIsConfigured()) {
      onConfigure()
      return
    }
    setOpen(true)
    setBusy('list')
    setMessage('')
    setError('')
    try { await refreshConnections() }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not read cloud connections.') }
    finally { setBusy('') }
  }

  async function sync(book: BookEntity) {
    setBusy(book.id)
    setMessage('')
    setError('')
    try {
      const wasConnected = connected.has(book.id)
      const result = wasConnected
        ? await syncBookNow(book.id, beforeSync)
        : await enableBookSync(book.id, book.title, beforeSync)
      await refreshConnections()
      setMessage(`${book.title}: ${result.message}`)
      if (result.kind === 'pulled') {
        setOpen(false)
        await onRemoteApplied(book.id)
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not sync this book.')
    } finally { setBusy('') }
  }

  return <div className="local-book-sync">
    <button type="button" onClick={() => { void show() }}><CloudUpload size={17} />Send books to cloud</button>
    {open && <div className="sync-dialog-backdrop" role="presentation"><section className="sync-dialog" role="dialog" aria-modal="true" aria-labelledby="local-cloud-books-title">
      <header><div><small>Self-hosted sync</small><h2 id="local-cloud-books-title">Send books to cloud</h2></div><button type="button" onClick={() => setOpen(false)} aria-label="Close local books"><X /></button></header>
      <p className="sync-dialog-help">Choose a local book for its first upload, or manually sync one that is already connected.</p>
      {busy === 'list' ? <p role="status">Loading local books…</p> : !books.length ? <p>No local books are available.</p> : <ul>{books.map(book => {
        const isConnected = connected.has(book.id)
        return <li key={book.id}><div><strong>{book.title}</strong><small>{isConnected ? 'Connected to cloud sync' : 'Stored only on this device'}</small></div><button type="button" disabled={Boolean(busy)} onClick={() => { void sync(book) }}>{busy === book.id ? 'Syncing…' : isConnected ? 'Sync now' : 'Upload & connect'}</button></li>
      })}</ul>}
      {message && <p role="status" className="sync-success">{message}</p>}
      {error && <p role="alert" className="illustration-error">{error}</p>}
    </section></div>}
  </div>
}

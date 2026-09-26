import { useState } from 'react'
import { CloudDownload, X } from 'lucide-react'
import { listRemoteBooks, type RemoteBook } from './sync-api'
import { importCloudBook } from './sync-service'
import { loadSyncSettings, normalizeSyncEndpoint, syncIsConfigured } from './sync-settings'
import { listSyncLinks } from './sync-persistence'
import './sync.css'

export default function CloudBookImport({ onImported }: { onImported: (bookId: string) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [books, setBooks] = useState<RemoteBook[]>([])
  const [connected, setConnected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  if (!syncIsConfigured()) return null

  async function show() {
    setOpen(true); setError(''); setBusy('list')
    try {
      const settings = loadSyncSettings()
      const [remote, links] = await Promise.all([listRemoteBooks(settings), listSyncLinks()])
      const endpoint = normalizeSyncEndpoint(settings.endpoint)
      setBooks(remote); setConnected(new Set(links.filter(link => link.endpoint === endpoint).map(link => link.remoteBookId)))
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not load cloud books.') }
    finally { setBusy('') }
  }

  async function importBook(book: RemoteBook) {
    setBusy(book.id); setError('')
    try { await onImported(await importCloudBook(book)); setOpen(false) }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not import this cloud book.') }
    finally { setBusy('') }
  }

  return <div className="cloud-book-import"><button type="button" onClick={() => { void show() }}><CloudDownload size={17} />Cloud books</button>{open && <div className="sync-dialog-backdrop" role="presentation"><section className="sync-dialog" role="dialog" aria-modal="true" aria-labelledby="cloud-books-title"><header><div><small>Self-hosted sync</small><h2 id="cloud-books-title">Cloud books</h2></div><button type="button" onClick={() => setOpen(false)} aria-label="Close cloud books"><X /></button></header>{busy === 'list' ? <p role="status">Loading cloud books…</p> : !books.length ? <p>No cloud books are available.</p> : <ul>{books.map(book => <li key={book.id}><div><strong>{book.title}</strong><small>Revision {book.currentRevision} · {book.currentSize ? `${Math.ceil(book.currentSize / 1024)} KB` : 'No archive yet'}</small></div><button type="button" disabled={connected.has(book.id) || busy === book.id || book.currentRevision < 1} onClick={() => { void importBook(book) }}>{connected.has(book.id) ? 'Connected' : busy === book.id ? 'Importing…' : 'Import & connect'}</button></li>)}</ul>}{error && <p role="alert" className="illustration-error">{error}</p>}</section></div>}</div>
}

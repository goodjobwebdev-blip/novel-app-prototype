import { useEffect, useState } from 'react'
import { Cloud, CloudOff, Download, RefreshCw, Upload } from 'lucide-react'
import Button from '../../shared/ui/Button'
import { loadSyncSettings, syncIsConfigured, SYNC_SETTINGS_EVENT } from './sync-settings'
import { SYNC_CHANGED, getBookSyncState, getSyncLink, updateBookSyncState, type BookSyncState, type SyncLink } from './sync-persistence'
import { disconnectBookSync, downloadRemoteBackup, enableBookSync, forceOverwriteRemote, importRemoteRecoveryCopy, syncBookNow } from './sync-service'
import './sync.css'

export default function BookSyncControls({ bookId, title, beforeSync, onImported, onRemoteApplied }: { bookId: string; title: string; beforeSync: () => Promise<void>; onImported: (bookId: string) => Promise<void>; onRemoteApplied: () => Promise<void> }) {
  const [link, setLink] = useState<SyncLink>()
  const [state, setState] = useState<BookSyncState>()
  const [configured, setConfigured] = useState(() => syncIsConfigured())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function refresh() {
    setLink(await getSyncLink(bookId)); setState(await getBookSyncState(bookId)); setConfigured(syncIsConfigured())
  }
  useEffect(() => {
    void refresh()
    const changed = (event: Event) => { if (!(event instanceof CustomEvent) || !event.detail?.bookId || event.detail.bookId === bookId) void refresh() }
    window.addEventListener(SYNC_CHANGED, changed); window.addEventListener(SYNC_SETTINGS_EVENT, changed)
    return () => { window.removeEventListener(SYNC_CHANGED, changed); window.removeEventListener(SYNC_SETTINGS_EVENT, changed) }
  }, [bookId])

  async function run(action: () => Promise<{ message?: string; kind?: string } | void>) {
    if (busy) return
    setBusy(true); setMessage(''); setError('')
    try {
      const result = await action()
      if (result?.message) setMessage(result.message)
      if (result?.kind === 'pulled') await onRemoteApplied()
      await refresh()
    } catch (error) { setError(error instanceof Error ? error.message : 'Sync failed.') }
    finally { setBusy(false) }
  }

  const conflict = state?.status === 'conflict'
  return <section className="book-sync" aria-label="Cloud sync"><div className="sync-card-title">{link ? <Cloud aria-hidden="true" /> : <CloudOff aria-hidden="true" />}<div><h3>Cloud sync</h3><p>{!configured ? 'Configure the sync server in global Settings → Sync.' : link ? state?.message || `Connected · ${state?.lastSyncedAt ? `last synced ${new Date(state.lastSyncedAt).toLocaleString()}` : 'not synced yet'}` : 'Connect this book without changing its local-first behavior.'}</p></div></div>
    {!link ? <div className="sync-actions"><Button disabled={!configured || busy} leadingIcon={<Upload />} onClick={() => { void run(() => enableBookSync(bookId, title, beforeSync)) }}>{busy ? 'Connecting…' : 'Enable cloud sync'}</Button></div>
      : <><div className="sync-actions"><Button variant="primary" disabled={busy || !configured} leadingIcon={<RefreshCw />} onClick={() => { void run(() => syncBookNow(bookId, beforeSync)) }}>{busy ? 'Syncing…' : 'Sync now'}</Button><Button disabled={busy} leadingIcon={<CloudOff />} onClick={() => { if (window.confirm('Disconnect this local book from cloud sync? The remote copy will be kept.')) void run(() => disconnectBookSync(bookId)) }}>Disconnect</Button></div>
        {conflict && <div className="sync-conflict" role="alert"><strong>Both copies changed</strong><p>Nothing was overwritten. Preserve a copy before choosing which version continues.</p><div className="sync-actions"><Button disabled={busy} leadingIcon={<Download />} onClick={() => { void run(async () => { await onImported(await importRemoteRecoveryCopy(bookId)); return { message: 'Imported the cloud version as a separate recovery book.' } }) }}>Import cloud recovery copy</Button><Button disabled={busy} onClick={() => { void run(async () => { await downloadRemoteBackup(bookId); return { message: 'Cloud backup download started.' } }) }}>Download cloud backup</Button><Button variant="danger" disabled={busy} leadingIcon={<Upload />} onClick={() => { if (window.confirm('Replace the cloud version with this device’s book? The current cloud version remains in server history, but other devices will conflict.')) void run(() => forceOverwriteRemote(bookId, beforeSync)) }}>Keep local & overwrite cloud</Button><Button disabled={busy} onClick={() => { void run(async () => { await updateBookSyncState(bookId, { status: 'idle', message: undefined }); return { message: 'Conflict left unresolved.' } }) }}>Decide later</Button></div></div>}
      </>}
    {message && <p role="status" className="sync-success">{message}</p>}{error && <p role="alert" className="illustration-error">{error}</p>}
  </section>
}

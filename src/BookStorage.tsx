import { useEffect, useRef, useState } from 'react'
import { readBookArchive, writeBookArchive } from './persistence'
import { copyBookArchive, decodeBookArchive, encodeBookArchive } from './book-archive'
import { checkStorageHeadroom, formatBytes, imageStorageError } from './illustration-image'
import { IMAGE_CHANGED } from './CodexIllustration'

export function BookBackupImport({ onImported }: { onImported: (bookId: string) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null)
  const working = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function restore(file: File) {
    if (working.current) return
    working.current = true
    setBusy(true)
    setError('')
    try {
      const archive = await decodeBookArchive(file)
      await checkStorageHeadroom(file.size)
      const copy = copyBookArchive(archive)
      await writeBookArchive(copy.data)
      await onImported(copy.bookId)
    } catch (error) { setError(imageStorageError(error)) }
    finally { working.current = false; setBusy(false) }
  }
  return <div className="book-backup-import"><input hidden ref={input} type="file" accept=".arcbook" aria-label="Import book backup file" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void restore(file) }} /><button type="button" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Importing…' : 'Import book backup'}</button>{error && <p className="illustration-error" role="alert">{error}</p>}</div>
}

export default function BookStorage({ bookId, beforeExport, onImported }: { bookId: string; beforeExport: () => Promise<void>; onImported: (bookId: string) => Promise<void> }) {
  const [estimate, setEstimate] = useState<StorageEstimate>()
  const [persistent, setPersistent] = useState<boolean>()
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const working = useRef(false)
  async function refresh() {
    try { setEstimate(await navigator.storage?.estimate?.()); setPersistent(await navigator.storage?.persisted?.()) } catch { setEstimate(undefined) }
  }
  useEffect(() => {
    void refresh()
    window.addEventListener(IMAGE_CHANGED, refresh)
    return () => window.removeEventListener(IMAGE_CHANGED, refresh)
  }, [bookId])
  async function backup() {
    if (working.current) return
    working.current = true
    setBusy(true)
    setMessage('')
    try {
      await beforeExport()
      const data = await readBookArchive(bookId)
      const file = encodeBookArchive(data)
      const title = String(data.entities.find((entry) => entry.type === 'book')?.title ?? 'book').replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 80)
      const url = URL.createObjectURL(file)
      const link = document.createElement('a')
      link.href = url
      link.download = `${title}-${new Date().toISOString().slice(0, 10)}.arcbook`
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      setMessage('Backup download started. Keep the file somewhere safe.')
    } catch (error) { setMessage(imageStorageError(error)) }
    finally { working.current = false; setBusy(false); void refresh() }
  }
  const usage = estimate?.usage ?? 0
  const quota = estimate?.quota ?? 0
  return <section className="book-storage" aria-label="Storage and backups"><h3>Storage & backups</h3>
    {quota > 0 ? <><label className="storage-meter-label">{formatBytes(usage)} used · {formatBytes(quota)} browser allowance<meter min={0} max={quota} value={Math.min(usage, quota)} low={quota * .7} high={quota * .85} optimum={0} /></label><p className="illustration-help">Estimate for all books and app data on this browser. Available disk space may be lower.</p>{usage / quota > .85 && <p className="illustration-error">Storage is nearly full. Export a backup and free space before adding images.</p>}</> : <p className="illustration-help">This browser does not report its storage allowance.</p>}
    <div className="illustration-actions"><button type="button" onClick={() => { void refresh() }}>Refresh usage</button>{navigator.storage?.persist && <button type="button" disabled={persistent === true} onClick={() => { void navigator.storage.persist().then((granted) => { setPersistent(granted); setMessage(granted ? 'Persistent storage enabled. Clearing browser data can still remove your books.' : 'The browser did not grant persistent storage. Download backups regularly.') }).catch(() => setMessage('Persistent storage is unavailable. Download backups regularly.')) }}>{persistent ? 'Storage protection enabled' : 'Protect local storage'}</button>}</div>
    <p className="illustration-help">Backups include this book’s text, chats, history, settings and illustrations. API keys are excluded. Import creates a new book; add your API keys again afterward.</p>
    <div className="illustration-actions"><button type="button" disabled={busy} onClick={() => { void backup() }}>{busy ? 'Preparing backup…' : 'Export book backup'}</button><BookBackupImport onImported={onImported} /></div>
    {message && <p role="status" className="illustration-help">{message}</p>}
  </section>
}

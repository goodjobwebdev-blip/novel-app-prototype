import { useEffect, useRef, useState } from 'react'
import Button from '../../shared/ui/Button'
import { decodeWorldArchive, exportWorldArchiveBlob, importWorldArchiveBlob, resolveWorldArchiveConflict, WORLD_ARCHIVE_CHANGED, type WorldArchiveConflict } from '../../data/world-archive'
import { disconnectWorldSync, enableWorldSync, getWorldSyncState, listWorldArchiveConflicts, resolveWorldSyncConflict, syncWorldNow, WORLD_SYNC_CHANGED, type WorldSyncState } from './world-sync-service'
import { syncIsConfigured, SYNC_SETTINGS_EVENT } from './sync-settings'
import './sync.css'

export function downloadWorldArchive(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = filename; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export type WorldSyncPanelProps = { worldId: string; beforeSync: () => Promise<void>; onRemoteApplied: () => Promise<void> }
export default function WorldSyncPanel({ worldId, beforeSync, onRemoteApplied }: WorldSyncPanelProps) {
  const [state, setState] = useState<WorldSyncState>()
  const [copies, setCopies] = useState<WorldArchiveConflict[]>([])
  const [configured, setConfigured] = useState(syncIsConfigured)
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('')
  const running = useRef(false), current = useRef(worldId), fileInput = useRef<HTMLInputElement>(null)
  current.current = worldId
  useEffect(() => {
    let active = true, version = 0
    setState(undefined); setCopies([]); setMessage(''); setError('')
    async function refresh() {
      const request = ++version
      try {
        const [next, conflicts] = await Promise.all([getWorldSyncState(worldId), listWorldArchiveConflicts(worldId, true)])
        if (active && request === version) { setState(next); setCopies(conflicts); setConfigured(syncIsConfigured()) }
      } catch (error) { if (active && request === version) setError(error instanceof Error ? error.message : 'Cannot read World sync state.') }
    }
    const changed = (event: Event) => { if (!(event instanceof CustomEvent) || !event.detail?.worldId || event.detail.worldId === worldId) void refresh() }
    void refresh()
    for (const event of [WORLD_SYNC_CHANGED, WORLD_ARCHIVE_CHANGED, SYNC_SETTINGS_EVENT]) window.addEventListener(event, changed)
    return () => { active = false; version++; for (const event of [WORLD_SYNC_CHANGED, WORLD_ARCHIVE_CHANGED, SYNC_SETTINGS_EVENT]) window.removeEventListener(event, changed) }
  }, [worldId])
  async function run(action: () => Promise<{ kind?: string; message?: string } | void>) {
    if (running.current) return
    const owner = worldId
    running.current = true; setBusy(true); setError(''); setMessage('')
    try {
      const result = await action()
      if (current.current !== owner) return
      if (result?.kind === 'pulled' || result?.kind === 'imported' || result?.kind === 'deleted') await onRemoteApplied()
      const [next, conflicts] = await Promise.all([getWorldSyncState(owner), listWorldArchiveConflicts(owner, true)])
      if (current.current === owner) { setState(next); setCopies(conflicts); setMessage(result?.message ?? '') }
    } catch (error) { if (current.current === owner) setError(error instanceof Error ? error.message : 'World sync failed.') }
    finally { running.current = false; setBusy(false) }
  }
  async function choose(conflict: WorldArchiveConflict, choice: 'local' | 'incoming') {
    if (!window.confirm(choice === 'local' ? 'Keep the captured local World? For cloud conflicts this uploads it conditionally. Both captured archives remain downloadable.' : 'Apply the incoming World and replace this local version? Both captured archives remain downloadable.')) return
    await run(async () => {
      if (conflict.remoteETag) return resolveWorldSyncConflict(worldId, conflict.id, choice, beforeSync)
      await beforeSync()
      return resolveWorldArchiveConflict(conflict.id, choice)
    })
  }
  return <section className="book-sync" aria-label="World cloud sync">
    <div className="sync-card-title"><div><h3>World cloud sync</h3><p>{!configured ? 'Configure the sync server in global Settings → Sync.' : state ? state.message || `Connected · ${state.status}` : 'Sync this canonical World separately from Book snapshots.'}</p></div></div>
    <div className="sync-actions">
      <Button disabled={busy || !configured} onClick={() => { void run(() => state ? syncWorldNow(worldId, beforeSync) : enableWorldSync(worldId, beforeSync)) }}>{busy ? 'Working…' : !state ? 'Enable cloud sync' : error || state.status === 'error' || state.status === 'offline' ? 'Retry sync' : 'Sync now'}</Button>
      {state && <Button disabled={busy} onClick={() => { if (window.confirm('Disconnect this World? Cloud data, tombstones and preserved conflict archives are kept.')) void run(() => disconnectWorldSync(worldId)) }}>Disconnect</Button>}
      <Button disabled={busy} onClick={() => { void run(async () => { await beforeSync(); downloadWorldArchive(await exportWorldArchiveBlob(worldId), 'world.arcworld'); return { message: 'World archive download started.' } }) }}>Export World archive</Button>
      <Button disabled={busy} onClick={() => fileInput.current?.click()}>Import World archive</Button>
      <input ref={fileInput} hidden type="file" accept=".arcworld,.arcbook,application/octet-stream" aria-label="Import World archive" onChange={event => {
        const file = event.target.files?.[0]; event.target.value = ''
        if (file) void run(async () => { await beforeSync(); const data = await decodeWorldArchive(file); if (data.worldId !== worldId) throw new Error('This archive belongs to a different World. Import it from the World library.'); return importWorldArchiveBlob(file) })
      }} />
    </div>
    {copies.filter(copy => !copy.resolution && !copy.supersededAt).map(conflict => <div key={conflict.id} className="sync-conflict" role="alert"><strong>Choose a World version explicitly</strong><p>{conflict.reason} No version is selected automatically. Both full archives are preserved.</p><div className="sync-actions"><Button disabled={busy} onClick={() => { void choose(conflict, 'local') }}>Keep local version</Button><Button disabled={busy} onClick={() => { void choose(conflict, 'incoming') }}>Use incoming version</Button></div></div>)}
    {!!copies.length && <details><summary>Preserved World archives</summary>{copies.map(copy => <div key={copy.id}><p>{new Date(copy.createdAt).toLocaleString()} · {copy.resolution ? `Resolved: ${copy.resolution}` : copy.supersededAt ? 'Superseded' : 'Unresolved'}</p><div className="sync-actions">{copy.local && <Button onClick={() => downloadWorldArchive(copy.local!, `world-${copy.createdAt}-local.arcworld`)}>Download preserved local archive</Button>}<Button onClick={() => downloadWorldArchive(copy.incoming, `world-${copy.createdAt}-incoming.arcworld`)}>Download preserved incoming archive</Button></div></div>)}</details>}
    {message && <p role="status" className="sync-success">{message}</p>}{(error || state?.status === 'error' && state.message) && <p role="alert" className="illustration-error">{error || state?.message}</p>}
  </section>
}
export { WorldSyncPanel }

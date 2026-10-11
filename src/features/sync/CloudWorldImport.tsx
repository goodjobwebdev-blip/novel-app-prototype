import { useEffect, useRef, useState } from 'react'
import Button from '../../shared/ui/Button'
import { importCloudWorld, listCloudWorlds } from './world-sync-service'
import { syncIsConfigured, SYNC_SETTINGS_EVENT } from './sync-settings'
import type { RemoteBook } from './sync-api'
import { importWorldArchiveBlob } from '../../data/world-archive'
import './sync.css'

/** Reusable World-library importer; callback opens/refreshes the canonical owner. */
export default function CloudWorldImport({ onImported, beforeImport = async () => {} }: { onImported: (worldId: string) => Promise<void>; beforeImport?: () => Promise<void> }) {
  const [open, setOpen] = useState(false), [worlds, setWorlds] = useState<RemoteBook[]>([])
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [configured, setConfigured] = useState(syncIsConfigured)
  const fileInput = useRef<HTMLInputElement>(null), running = useRef(false)
  useEffect(() => { const changed = () => setConfigured(syncIsConfigured()); window.addEventListener(SYNC_SETTINGS_EVENT, changed); return () => window.removeEventListener(SYNC_SETTINGS_EVENT, changed) }, [])
  async function run(action: () => Promise<void>) {
    if (running.current) return
    running.current = true; setBusy(true); setError('')
    try { await action() } catch (error) { setError(error instanceof Error ? error.message : 'World import failed.') }
    finally { running.current = false; setBusy(false) }
  }
  return <div className="cloud-book-import"><div className="sync-actions"><Button disabled={!configured || busy} onClick={() => { setOpen(true); void run(async () => setWorlds(await listCloudWorlds())) }}>Cloud Worlds</Button><Button disabled={busy} onClick={() => fileInput.current?.click()}>Import World archive</Button></div>
    <input hidden ref={fileInput} type="file" accept=".arcworld,.arcbook,application/octet-stream" aria-label="Import World archive" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void run(async () => { await beforeImport(); const result = await importWorldArchiveBlob(file); await onImported(result.worldId) }) }} />
    {open && <div className="sync-dialog-backdrop" role="presentation"><section className="sync-dialog" role="dialog" aria-modal="true" aria-labelledby="cloud-worlds-title"><header><h2 id="cloud-worlds-title">Cloud Worlds</h2><Button disabled={busy} onClick={() => setOpen(false)}>Close</Button></header>
      {busy ? <p role="status">Loading…</p> : worlds.length ? <ul>{worlds.map(world => <li key={world.id}><div><strong>{world.title}</strong><small>Revision {world.currentRevision}</small></div><Button disabled={busy || world.currentRevision < 1} onClick={() => { void run(async () => { await beforeImport(); const result = await importCloudWorld(world); await onImported(result.worldId); setOpen(false) }) }}>Import & connect</Button></li>)}</ul> : <p>No cloud Worlds are available.</p>}
      {error && <p role="alert" className="illustration-error">{error}</p>}<Button disabled={busy} onClick={() => { void run(async () => setWorlds(await listCloudWorlds())) }}>Refresh / retry</Button>
    </section></div>}{!open && error && <p role="alert" className="illustration-error">{error}</p>}
  </div>
}
export { CloudWorldImport }

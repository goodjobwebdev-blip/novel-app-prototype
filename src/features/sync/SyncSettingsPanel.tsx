import { useState } from 'react'
import { Check, Cloud, Eye, EyeOff } from 'lucide-react'
import { testSyncConnection } from './sync-api'
import { loadSyncSettings, saveSyncSettings, type SyncSettings } from './sync-settings'
import './sync.css'

export default function SyncSettingsPanel() {
  const [draft, setDraft] = useState<SyncSettings>(() => loadSyncSettings())
  const [showSecrets, setShowSecrets] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const update = <K extends keyof SyncSettings>(key: K, value: SyncSettings[K]) => setDraft(current => ({ ...current, [key]: value }))

  async function saveAndTest() {
    if (busy) return
    setBusy(true); setStatus(''); setError('')
    try {
      const saved = saveSyncSettings(draft)
      setDraft(saved)
      const account = await testSyncConnection(saved)
      setStatus(`Connected as ${account.email}.`)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not connect to the sync server.')
    } finally { setBusy(false) }
  }

  return <section className="sync-settings" aria-labelledby="page-title">
    <header className="page-heading"><div><p>Cloud sync</p><h1 id="page-title">Your sync server</h1><span>Connect this browser to your self-hosted archive service.</span></div>{status && <div className="save-state saved"><i /><Check size={15} /> Connected</div>}</header>
    <section className="settings-card sync-settings-card">
      <div className="sync-card-title"><Cloud aria-hidden="true" /><div><h2>Connection</h2><p>These credentials stay on this browser and are never included in book backups.</p></div></div>
      <label><span>Server URL</span><input type="url" value={draft.endpoint} onChange={event => update('endpoint', event.target.value)} placeholder="https://sync.example.com" autoComplete="url" /></label>
      <label><span>Basic Auth username</span><input value={draft.basicUsername} onChange={event => update('basicUsername', event.target.value)} autoComplete="username" /></label>
      <label><span>Basic Auth password</span><div className="sync-secret"><input type={showSecrets ? 'text' : 'password'} value={draft.basicPassword} onChange={event => update('basicPassword', event.target.value)} autoComplete="current-password" /><button type="button" onClick={() => setShowSecrets(value => !value)} aria-label={showSecrets ? 'Hide credentials' : 'Show credentials'}>{showSecrets ? <EyeOff /> : <Eye />}</button></div></label>
      <label><span>Sync token</span><input type={showSecrets ? 'text' : 'password'} value={draft.token} onChange={event => update('token', event.target.value)} autoComplete="off" /></label>
      <label className="sync-checkbox"><input type="checkbox" checked={draft.automaticUpload} onChange={event => update('automaticUpload', event.target.checked)} /><span><strong>Automatic upload when idle</strong><small>After local changes, wait two quiet minutes before uploading. Large media-rich books may use substantial bandwidth.</small></span></label>
      <p className="sync-security-note">Browser storage is not a secure vault. Any script running on this application origin can access these credentials.</p>
      <div className="illustration-actions"><button className="primary" type="button" disabled={busy} onClick={() => { void saveAndTest() }}>{busy ? 'Testing…' : 'Save & test connection'}</button></div>
      {status && <p role="status" className="sync-success">{status}</p>}
      {error && <p role="alert" className="illustration-error">{error}</p>}
    </section>
  </section>
}

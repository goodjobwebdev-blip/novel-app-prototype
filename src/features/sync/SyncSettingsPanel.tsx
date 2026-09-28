import { useState } from 'react'
import { Check, Cloud, Eye, EyeOff } from 'lucide-react'
import Button from '../../shared/ui/Button'
import Checkbox from '../../shared/ui/Checkbox'
import Input from '../../shared/ui/Input'
import { testSyncConnection } from './sync-api'
import { loadSyncSettings, normalizeSyncEndpoint, saveSyncSettings, type SyncSettings } from './sync-settings'
import './sync.css'

export default function SyncSettingsPanel() {
  const [draft, setDraft] = useState<SyncSettings>(() => loadSyncSettings())
  const [showSecrets, setShowSecrets] = useState(false)
  const [status, setStatus] = useState('')
  const [testError, setTestError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [busy, setBusy] = useState(false)
  const update = <K extends keyof SyncSettings>(key: K, value: SyncSettings[K]) => {
    const next = { ...draft, [key]: value }
    setDraft(next)
    setStatus('')
    setTestError('')
    try { saveSyncSettings(next); setSaveError('') } catch { setSaveError('Sync settings could not be saved on this device.') }
  }

  async function testConnection() {
    if (busy) return
    setBusy(true); setStatus(''); setTestError('')
    try {
      const endpoint = normalizeSyncEndpoint(draft.endpoint)
      if (!endpoint || !draft.basicUsername.trim() || !draft.basicPassword || draft.token.trim().length < 32) throw new Error('Enter the server URL, Basic Auth username and password, and a sync token of at least 32 characters.')
      const account = await testSyncConnection({ ...draft, endpoint })
      setStatus(`Connected as ${account.email}.`)
    } catch (error) {
      setTestError(error instanceof Error ? error.message : 'Could not connect to the sync server.')
    } finally { setBusy(false) }
  }

  return <section className="sync-settings" aria-labelledby="page-title">
    <header className="page-heading"><div><p>Cloud sync</p><h1 id="page-title">Your sync server</h1><span>Connect this browser to your self-hosted archive service.</span></div><div className={`save-state ${saveError ? 'error' : 'saved'}`} role="status" aria-live="polite"><i />{saveError ? 'Not saved' : 'Saved'}</div></header>
    <section className="settings-card sync-settings-card">
      <div className="sync-card-title"><Cloud aria-hidden="true" /><div><h2>Connection</h2><p>These credentials stay on this browser and are never included in book backups.</p></div></div>
      <Input label="Server URL" type="url" value={draft.endpoint} onChange={event => update('endpoint', event.target.value)} placeholder="https://sync.example.com" autoComplete="url" />
      <Input label="Basic Auth username" value={draft.basicUsername} onChange={event => update('basicUsername', event.target.value)} autoComplete="username" />
      <div className="sync-secret-field"><label className="sync-secret-label" htmlFor="sync-basic-password">Basic Auth password</label><div className="sync-secret"><Input id="sync-basic-password" aria-label="Basic Auth password" type={showSecrets ? 'text' : 'password'} value={draft.basicPassword} onChange={event => update('basicPassword', event.target.value)} autoComplete="current-password" /><Button className="sync-icon-button" variant="ghost" onClick={() => setShowSecrets(value => !value)} aria-label={showSecrets ? 'Hide credentials' : 'Show credentials'} leadingIcon={showSecrets ? <EyeOff /> : <Eye />} /></div></div>
      <Input label="Sync token" type={showSecrets ? 'text' : 'password'} value={draft.token} onChange={event => update('token', event.target.value)} autoComplete="off" />
      <Checkbox className="sync-checkbox" label="Automatic upload when idle" description="After local changes, wait two quiet minutes before uploading. Large media-rich books may use substantial bandwidth." checked={draft.automaticUpload} onChange={event => update('automaticUpload', event.target.checked)} />
      <p className="sync-security-note">Browser storage is not a secure vault. Any script running on this application origin can access these credentials.</p>
      <div className="sync-actions"><Button variant="primary" disabled={busy} onClick={() => { void testConnection() }}>{busy ? 'Testing…' : 'Test connection'}</Button></div>
      {status && <p role="status" className="sync-success"><Check size={15} aria-hidden="true" />{status}</p>}
      {testError && <p role="alert" className="illustration-error">{testError}</p>}
    </section>
  </section>
}

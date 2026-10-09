import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import { loadAiSettings, saveAiSettings, normalizeAutocompleteSettings, autocompleteDelayInputError, type AiSettings, type AiProvider } from '../../shared/ai/ai-settings'
import { loadImageSettings, saveImageSettings } from '../images/image-settings'
import type { ImageSettings } from '../images/image-generation-types'
import ImageSettingsPanel from '../images/ImageSettingsPanel'
import { UiSettingsPanel } from './UiSettingsPortal'
import { defaultUiSettings } from './ui-settings'
import { switchProviderProfile } from './provider-profiles'
import { TextRevealPreview } from '../../shared/ui/TextRevealPreview'
import Input from '../../shared/ui/Input'
import Select from '../../shared/ui/Select'
import Button from '../../shared/ui/Button'
import SettingsSectionTabs from './SettingsSectionTabs'
import {
  SETTINGS_PROFILES_EVENT, loadSettingsProfiles, saveSettingsProfile, createSettingsProfile,
  deleteSettingsProfile, setDefaultSettingsProfile, resolveProfileSettings,
  type ProfileKind, type SettingsProfile, type SettingsProfileLibrary, type BookProfileSelections,
} from './settings-profiles'
import { listSettingsProfileUsage } from '../../data/persistence'
import { contextLimitInputError } from '../../shared/context/context-service'
import { promptTemplateDiagnostics } from '../../shared/ai/prompt-template'
import type { PromptCompositionScope } from '../../shared/ai/prompt-composition'
import SegmentedControl from '../../shared/ui/SegmentedControl'
import { clearFakeProviderTrace, getFakeProviderTrace, subscribeFakeProviderTrace } from '../../shared/ai/fake-provider'
import Disclosure from '../../shared/ui/Disclosure'
import './settings-profiles.css'

export const bookProfileKinds = ['text', 'story', 'codex', 'summary', 'tts', 'stt', 'image', 'video', 'ui'] as const
export const profileLabels: Record<ProfileKind, string> = {
  text: 'Text models', story: 'Story prompt', codex: 'Codex prompt', summary: 'Summary prompt',
  tts: 'Text to speech', stt: 'Speech to text', image: 'Images', video: 'Video', ui: 'UI',
  chat: 'Chat prompt', character: 'Character chat prompt',
}
const modelKinds = ['text', 'tts', 'stt', 'image', 'video'] as const
const promptKinds = ['story', 'codex', 'summary', 'chat', 'character'] as const
const providers: Record<AiProvider, string> = { openrouter: 'OpenRouter', nanogpt: 'NanoGPT', openai: 'OpenAI', litellm: 'LiteLLM', compatible: 'OpenAI-compatible', fake: 'Fake (testing)' }
export type GlobalSettingsSection = 'ai' | 'appearance' | 'application' | 'sync'
export type SettingsProfilesPanelRef = { requestLeave: (destination: () => void) => void }
export type ProfileEditorProps = { kind: ProfileKind; settings: AiSettings; library: SettingsProfileLibrary; onChange: (settings: AiSettings) => void }

/** Credentials are injected only for catalogs; never write this effective value into a profile. */
export function profileCatalogSettings(settings: AiSettings, connection: AiSettings): AiSettings {
  return { ...settings, provider: connection.provider, apiKey: connection.apiKey, baseUrl: connection.baseUrl,
    providerProfiles: connection.providerProfiles, favorites: connection.favorites,
    speech: { ...settings.speech,
      apiKey: connection.speech.apiKey || (connection.provider === 'nanogpt' ? connection.apiKey : connection.providerProfiles?.nanogpt?.apiKey) || '',
      openaiApiKey: connection.speech.openaiApiKey || (connection.provider === 'openai' ? connection.apiKey : connection.providerProfiles?.openai?.apiKey) || '',
    },
  }
}
export function withoutProfileCredentials(settings: AiSettings): AiSettings {
  return { ...settings, apiKey: '', baseUrl: '', providerProfiles: undefined,
    speech: { ...settings.speech, apiKey: '', openaiApiKey: '' } }
}
function profileSummary(profile?: SettingsProfile) {
  if (!profile) return 'Setup required — select an available profile.'
  const { settings } = profile
  if (profile.kind === 'text') {
    const autocomplete = normalizeAutocompleteSettings(settings.autocomplete)
    return `Main: ${settings.mainModel || 'not selected'} · Support: ${settings.supportModel || 'not selected'} · Codex: ${settings.codexModel || 'Main'} · Chat: ${settings.chatModel || 'Main'} · Character: ${settings.characterModel || 'Main'} · Autocomplete: ${autocomplete.enabled ? 'On' : 'Off'} · ${autocomplete.model || 'model not selected'}`
  }
  if (profile.kind === 'tts') return `${settings.speech.model} · ${settings.speech.voice}`
  if (profile.kind === 'stt') return settings.speech.transcriptionModel
  if (profile.kind === 'image' || profile.kind === 'video') return `${profile.media?.favorites.length ?? 0} favorite models`
  if (profile.kind === 'ui') return `Theme: ${profile.ui?.activeThemeId || 'default'} · Reveal: ${settings.generationWordDelayMs} ms/word`
  return 'Live prompt preset · shared changes apply to the next operation'
}

export function BookProfilesPanel({ library, selections, busy, error, onChange, onEdit, onRetry }: {
  library: SettingsProfileLibrary; selections: BookProfileSelections | null; busy: boolean; error: string;
  onChange: (kind: keyof BookProfileSelections, id: string) => void; onEdit: (id: string) => void; onRetry: () => void;
}) {
  return <section className="book-profiles-panel">
    <header className="page-heading"><div><p>Book settings</p><h1 id="page-title">Profiles</h1><span>Choose shared profiles. Story, Codex, and Summary prompts stay linked; new chats snapshot this book’s text roles. Existing chat overrides stay unchanged.</span></div></header>
    {error && <div className="status error" role="alert">{error}<Button size="small" onClick={onRetry}>Retry</Button></div>}
    {!selections && !error && <p role="status">Loading book profiles…</p>}
    <div className="book-profile-rows">{bookProfileKinds.map(kind => {
      const selected = library.profiles.find(profile => profile.id === selections?.[kind] && profile.kind === kind)
      return <section className="book-profile-row" key={kind}>
        <Select label={profileLabels[kind]} value={selections?.[kind] ?? ''} disabled={busy || !selections} onChange={event => onChange(kind, event.target.value)}>
          {!selected && <option value={selections?.[kind] ?? ''}>Setup required</option>}
          {library.profiles.filter(profile => profile.kind === kind).map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
        </Select>
        <Button disabled={!selected || busy} onClick={() => selected && onEdit(selected.id)} aria-label={`Edit ${profileLabels[kind]} profile`}>Edit</Button>
        <p>{profileSummary(selected)}</p>
      </section>
    })}</div>
    <p className="profile-help">For an independent configuration, Duplicate the shared profile in Global Settings, then select the copy here.</p>
  </section>
}

const SettingsProfilesPanel = forwardRef<SettingsProfilesPanelRef, {
  section: GlobalSettingsSection; initialProfileId?: string;
  renderEditor: (props: ProfileEditorProps) => ReactNode; application: ReactNode; sync: ReactNode;
  onSaved?: (settings: AiSettings) => void;
}>(function SettingsProfilesPanel({ section, initialProfileId, renderEditor, application, sync, onSaved }, ref) {
  const [library, setLibrary] = useState(loadSettingsProfiles)
  const initial = library.profiles.find(profile => profile.id === initialProfileId)
  const [kind, setKind] = useState<ProfileKind>(section === 'appearance' ? 'ui' : initial?.kind ?? 'text')
  const [aiSection, setAiSection] = useState<'connection' | 'models' | 'prompts'>(initial && promptKinds.includes(initial.kind as typeof promptKinds[number]) ? 'prompts' : 'models')
  const [draft, setDraft] = useState<SettingsProfile | undefined>(section === 'appearance' ? initial?.kind === 'ui' ? initial : library.profiles.find(profile => profile.id === library.defaults.ui) : initial ?? library.profiles.find(profile => profile.id === library.defaults.text))
  const [baseline, setBaseline] = useState(() => JSON.stringify(draft))
  const [connection, setConnection] = useState(loadAiSettings)
  const [editedProvider, setEditedProvider] = useState<AiProvider>(connection.provider)
  const [defaultDraft, setDefaultDraft] = useState(library.defaults)
  const [defaultBaseline, setDefaultBaseline] = useState(() => JSON.stringify(library.defaults))
  const [imageKeys, setImageKeys] = useState(() => loadImageSettings().keys)
  const [connectionBaseline, setConnectionBaseline] = useState(() => JSON.stringify({ connection, imageKeys }))
  const [usage, setUsage] = useState<Array<{ id: string; title: string }>>([])
  const [usageReady, setUsageReady] = useState(false)
  const [usageError, setUsageError] = useState('')
  const [error, setError] = useState(initialProfileId && !initial ? 'The requested profile is unavailable. Select an existing profile below.' : '')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<(() => void) | null>(null)
  const [newName, setNewName] = useState('')
  const [fakeTrace, setFakeTrace] = useState(getFakeProviderTrace)
  const [editorEpoch, setEditorEpoch] = useState(0)
  const [usageVersion, setUsageVersion] = useState(0)
  const dialogRef = useRef<HTMLElement | null>(null)

  const busyRef = useRef(false)
  const dirty = JSON.stringify(draft) !== baseline
  const connectionDirty = JSON.stringify({ connection, imageKeys }) !== connectionBaseline
  const defaultsDirty = JSON.stringify(defaultDraft) !== defaultBaseline
  const anyDirty = dirty || connectionDirty || defaultsDirty
  const latest = useRef({ anyDirty, busy, defaultsDirty })
  latest.current = { anyDirty, busy, defaultsDirty }
  const editedConnection = editedProvider === connection.provider ? connection : switchProviderProfile(connection, editedProvider)

  function selectProviderConnection(provider: AiProvider) {
    if (busyRef.current) return
    setEditedProvider(provider)
    setConnection(current => {
      if (provider === current.provider || current.providerProfiles?.[provider]) return current
      // Persist the displayed default endpoint on Save, even when only a media key is edited.
      const edited = switchProviderProfile(current, provider)
      return { ...current, providerProfiles: switchProviderProfile(edited, current.provider).providerProfiles }
    })
  }

  function updateProviderConnection(key: 'apiKey' | 'baseUrl', value: string) {
    if (busyRef.current) return
    setConnection(current => {
      if (editedProvider === current.provider) return { ...current, [key]: value }
      const edited = { ...switchProviderProfile(current, editedProvider), [key]: value }
      const restored = switchProviderProfile(edited, current.provider)
      return { ...current, providerProfiles: restored.providerProfiles }
    })
  }

  function reportError(failure: unknown) {
    setError(failure instanceof Error ? failure.message : 'Changes could not be saved. Your draft is still here.')
  }
  function perform(destination: () => void) {
    try { destination() } catch (failure) { reportError(failure) }
  }
  function requestLeave(destination: () => void) {
    if (latest.current.busy || busyRef.current) return
    if (latest.current.anyDirty) setPending(() => () => perform(destination))
    else perform(destination)
  }
  useImperativeHandle(ref, () => ({ requestLeave }))
  useEffect(() => subscribeFakeProviderTrace(() => setFakeTrace(getFakeProviderTrace())), [])
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => { if (latest.current.anyDirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [])
  useEffect(() => {
    if (!pending) return
    const previous = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    const trap = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) { event.preventDefault(); setPending(null) }
      if (event.key !== 'Tab') return
      const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
      if (!buttons?.length) { event.preventDefault(); return }
      const first = buttons[0], last = buttons[buttons.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', trap)
    return () => { document.removeEventListener('keydown', trap); if (previous?.isConnected) previous.focus() }
  }, [pending])
  useEffect(() => {
    const reload = () => { try { setLibrary(loadSettingsProfiles()); setUsageVersion(version => version + 1) } catch (failure) { setError(failure instanceof Error ? failure.message : 'Profile library could not be reloaded.') } }
    window.addEventListener(SETTINGS_PROFILES_EVENT, reload)
    window.addEventListener('storage', reload)
    return () => { window.removeEventListener(SETTINGS_PROFILES_EVENT, reload); window.removeEventListener('storage', reload) }
  }, [])
  useEffect(() => {
    if (!latest.current.defaultsDirty) { setDefaultDraft(library.defaults); setDefaultBaseline(JSON.stringify(library.defaults)) }
  }, [library])
  useEffect(() => {
    let cancelled = false
    setUsage([]); setUsageReady(false); setUsageError('')
    if (draft) void listSettingsProfileUsage(draft.id).then(value => { if (!cancelled) { setUsage(value); setUsageReady(true) } }).catch(() => { if (!cancelled) setUsageError('Linked books could not be checked. Reopen this profile to retry; Save and Delete are disabled.') })
    return () => { cancelled = true }
  }, [draft?.id, usageVersion])
  useEffect(() => {
    if (section === 'appearance' && kind !== 'ui') selectDefault('ui')
    if (section === 'ai' && kind === 'ui') selectDefault(aiSection === 'prompts' ? 'story' : 'text')
    // The host guards navigation before changing sections.
  }, [section])

  function selectProfile(id: string) {
    try {
      const nextLibrary = loadSettingsProfiles()
      const next = nextLibrary.profiles.find(profile => profile.id === id)
      if (!next) { setError('This profile is no longer available.'); return }
      setLibrary(nextLibrary); setDraft(next); setKind(next.kind); setBaseline(JSON.stringify(next)); setError(''); setEditorEpoch(epoch => epoch + 1)
      latest.current.anyDirty = connectionDirty || defaultsDirty
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Profile could not be loaded.') }
  }
  function selectDefault(next: ProfileKind) { perform(() => selectProfile(loadSettingsProfiles().defaults[next])) }
  function chooseKind(next: ProfileKind) { if (next !== kind) requestLeave(() => selectDefault(next)) }
  function changeDraft(next: SettingsProfile) { if (!busyRef.current) { setDraft(next); setError('') } }
  async function run(action: () => Promise<void>) {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError('')
    try { await action() } catch (failure) { reportError(failure) }
    finally { busyRef.current = false; setBusy(false) }
  }
  function notifySaved() {
    const savedLibrary = loadSettingsProfiles()
    const defaults = Object.fromEntries(bookProfileKinds.map(kind => [kind, savedLibrary.defaults[kind]])) as BookProfileSelections
    onSaved?.(resolveProfileSettings(defaults, loadAiSettings().favorites))
  }
  async function persistDefaults() {
    try {
      for (const kind of Object.keys(defaultDraft) as ProfileKind[]) {
        if (loadSettingsProfiles().defaults[kind] !== defaultDraft[kind]) await setDefaultSettingsProfile(kind, defaultDraft[kind])
      }
    } finally {
      // The shared API writes each kind separately. A partial failure remains dirty for retry.
      const savedLibrary = loadSettingsProfiles()
      setLibrary(savedLibrary); setDefaultBaseline(JSON.stringify(savedLibrary.defaults))
    }
  }
  function makeDefault(profile: SettingsProfile) {
    requestLeave(() => { void run(async () => {
      await setDefaultSettingsProfile(profile.kind, profile.id)
      const savedLibrary = loadSettingsProfiles()
      setLibrary(savedLibrary); setDefaultDraft(savedLibrary.defaults); setDefaultBaseline(JSON.stringify(savedLibrary.defaults))
      notifySaved()
    }) })
  }
  async function save(): Promise<boolean> {
    if (busyRef.current) return false
    if (dirty && draft && !usageReady) { setError('Check linked books before saving this profile.'); return false }
    let succeeded = false
    await run(async () => {
      if (dirty && draft) {
        const current = loadSettingsProfiles().profiles.find(profile => profile.id === draft.id)
        if (JSON.stringify(current) !== baseline) throw new Error('This profile changed in another editor. Your draft is retained; Discard to load the latest saved version before editing again.')
        if (draft.kind === 'text') {
          const capError = contextLimitInputError(draft.settings.mainEffectiveContextLimit) || contextLimitInputError(draft.settings.codexEffectiveContextLimit)
          if (capError) throw new Error(capError)
          const delayError = autocompleteDelayInputError(draft.settings.autocomplete.delayMs)
          if (delayError) throw new Error(delayError)
        }
        if (draft.kind === 'ui' && draft.ui?.customThemes.some(theme => !theme.name.trim())) throw new Error('Give every custom theme a name before saving the UI profile.')
        if (draft.kind === 'ui' && (!/^\d+$/.test(draft.settings.generationWordDelayMs) || Number(draft.settings.generationWordDelayMs) < 1 || Number(draft.settings.generationWordDelayMs) > 2000)) throw new Error('Reveal speed must be between 1 and 2000 milliseconds per word.')
        const scope: PromptCompositionScope | undefined = draft.kind === 'story' ? 'story' : draft.kind === 'codex' ? 'lore' : draft.kind === 'summary' ? 'summarize' : draft.kind === 'chat' || draft.kind === 'character' ? 'assistant' : undefined
        if (scope) {
          const composition = draft.settings.promptCompositions[scope]
          const invalid = [composition.systemPrompt, ...composition.predefinedMessages.filter(message => message.enabled).map(message => message.template)].flatMap(template => promptTemplateDiagnostics(template, scope)).find(diagnostic => diagnostic.severity === 'error')
          if (invalid) throw new Error(`Fix the prompt template before saving: ${invalid.message}`)
        }
        const linked = await listSettingsProfileUsage(draft.id)
        setUsage(linked)
        const autocompleteWarning = draft.kind === 'text' && draft.settings.autocomplete.enabled ? ' Autocomplete will automatically send manuscript excerpts from all linked books to the active global text connection while typing and may incur costs. Saving does not send a request itself.' : ''
        if (linked.length && !window.confirm(`Save “${draft.name}”? This updates ${linked.length} linked book(s): ${linked.map(book => book.title).join(', ')}. Existing chats keep their snapshots.${autocompleteWarning}`)) return
      }
      if (connectionDirty) {
        // Never replace media favorites with the Connections form's older snapshot.
        saveImageSettings({ ...loadImageSettings(), keys: imageKeys })
        const saved = saveAiSettings(connection)
        setConnection(saved); setConnectionBaseline(JSON.stringify({ connection: saved, imageKeys }))

      }
      if (dirty && draft) {
        // The linked-book lookup yields; recheck before writing a potentially stale draft.
        const current = loadSettingsProfiles().profiles.find(profile => profile.id === draft.id)
        if (JSON.stringify(current) !== baseline) throw new Error('This profile changed in another editor. Your draft is retained; Discard to load the latest saved version before editing again.')
        if (!draft.name.trim()) throw new Error('Give this profile a name before saving.')
        const clean = { ...draft, name: draft.name.trim(), settings: withoutProfileCredentials(draft.settings) }
        if (clean.media) {
          const { keys: _keys, ...media } = clean.media as ImageSettings
          clean.media = media
        }
        await saveSettingsProfile(clean)
        const savedLibrary = loadSettingsProfiles()
        const saved = savedLibrary.profiles.find(profile => profile.id === draft.id) ?? clean
        setLibrary(savedLibrary); setDraft(saved); setBaseline(JSON.stringify(saved)); setEditorEpoch(epoch => epoch + 1)

      }
      if (defaultsDirty) await persistDefaults()
      latest.current.anyDirty = false
      latest.current.defaultsDirty = false
      notifySaved()
      succeeded = true
    })
    return succeeded
  }
  function discard(): boolean {
    if (busyRef.current) return false
    try {
      const savedLibrary = loadSettingsProfiles()
      const savedProfile = savedLibrary.profiles.find(profile => profile.id === draft?.id)
      const savedConnection = loadAiSettings(), keys = loadImageSettings().keys
      setLibrary(savedLibrary); setDraft(savedProfile); setBaseline(JSON.stringify(savedProfile)); setEditorEpoch(epoch => epoch + 1)
      setConnection(savedConnection); setImageKeys(keys); setConnectionBaseline(JSON.stringify({ connection: savedConnection, imageKeys: keys })); setError('')
      setDefaultDraft(savedLibrary.defaults); setDefaultBaseline(JSON.stringify(savedLibrary.defaults))
      latest.current.anyDirty = false
      latest.current.defaultsDirty = false
      return true
    } catch (failure) { reportError(failure); return false }
  }
  function create(duplicate = false) {
    if (!newName.trim() && !duplicate) { setError('Enter a name for the new profile.'); return }
    requestLeave(() => { void run(async () => {
      const created = await createSettingsProfile(kind, duplicate ? `${loadSettingsProfiles().profiles.find(profile => profile.id === draft?.id)?.name || profileLabels[kind]} copy` : newName.trim(), duplicate ? draft?.id : undefined)
      setNewName(''); selectProfile(created.id)
    }) })
  }
  function remove() {
    if (!draft || library.defaults[draft.kind] === draft.id || !usageReady || usage.length) return
    requestLeave(() => { if (window.confirm(`Delete “${draft.name}”?`)) void run(async () => { await deleteSettingsProfile(draft.id); selectProfile(loadSettingsProfiles().defaults[draft.kind]) }) })
  }
  const activeKind = section === 'appearance' ? 'ui' : kind
  const isProfileSection = section === 'appearance' ? draft?.kind === 'ui' : section === 'ai' && aiSection !== 'connection' && kind !== 'ui'
  const effective = draft ? profileCatalogSettings(draft.settings, connection) : null
  return <div className="settings-profiles-panel">
    {pending && <section ref={dialogRef} className="profile-leave-dialog settings-save-recovery" role="alertdialog" aria-modal="true" aria-label="Unsaved settings" tabIndex={-1}>
      <div><strong>Unsaved settings</strong><span>Save your changes or explicitly discard them before leaving this editor.</span></div>
      <div className="profile-actions"><Button variant="primary" disabled={busy} onClick={() => { void save().then(saved => { if (saved) { const destination = pending; setPending(null); destination() } }) }}>Save and continue</Button><Button disabled={busy} onClick={() => { if (!discard()) return; const destination = pending; setPending(null); destination() }}>Discard and continue</Button><Button disabled={busy} onClick={() => setPending(null)}>Keep editing</Button></div>
    </section>}
    {error && <div className="status error" role="alert">{error}</div>}
    <div inert={pending !== null || busy}>
    {section === 'ai' && <><header className="page-heading"><div><p>Global Settings</p><h1 id="page-title">AI</h1><span>One active text connection serves every text profile and role. Shared profile changes are explicit.</span></div></header>
      <SettingsSectionTabs tabs={globalAiSections} active={aiSection} onChange={next => { if (next !== aiSection) requestLeave(() => { setAiSection(next); if (next !== 'connection') selectDefault(next === 'models' ? 'text' : 'story') }) }} idPrefix="ai" label="AI sections" />
      {aiSection !== 'connection' && <Select label={aiSection === 'models' ? 'Model profile type' : 'Prompt preset type'} value={kind} onChange={event => chooseKind(event.target.value as ProfileKind)}>{(aiSection === 'models' ? modelKinds : promptKinds).map(value => <option key={value} value={value}>{profileLabels[value]}</option>)}</Select>}
    </>}
    {section === 'ai' && aiSection === 'connection' && <section className="settings-card" role="tabpanel" id="ai-panel-connection" aria-labelledby="ai-tab-connection">
      <h2>Global Connections</h2><p>Credentials and endpoints stay on this device and are not included in backups or archive sync. Models and prompts never contain keys.</p>
      <Select label="Active text provider" value={connection.provider} onChange={event => {
        const switched = switchProviderProfile(connection, event.target.value as AiProvider)
        // Switching a connection must not copy a provider's old role/model configuration.
        if (busyRef.current) return
        setConnection({ ...connection, provider: switched.provider, apiKey: switched.apiKey, baseUrl: switched.baseUrl, providerProfiles: switched.providerProfiles })
        setEditedProvider(switched.provider)
      }}>{Object.entries(providers).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</Select>
      <Select label="Connection provider" description="Edit this provider’s global credentials without changing the active text provider or any profile models." value={editedProvider} disabled={busy} onChange={event => selectProviderConnection(event.target.value as AiProvider)}>{Object.entries(providers).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</Select>
      {editedProvider !== 'fake' && <Input label={editedProvider === 'litellm' ? 'LiteLLM API key' : 'API key'} aria-label="Text API key" type="password" autoComplete="off" value={editedConnection.apiKey} onChange={event => updateProviderConnection('apiKey', event.target.value)} />}
      {(editedProvider === 'compatible' || editedProvider === 'litellm') && <Input label={editedProvider === 'litellm' ? 'LiteLLM base URL' : 'Endpoint URL'} value={editedConnection.baseUrl} onChange={event => updateProviderConnection('baseUrl', event.target.value)} />}
      <div className="profile-connections-grid"><Input label="NanoGPT Speech API key" description="Optional speech override; otherwise uses the global NanoGPT connection." type="password" autoComplete="off" value={connection.speech.apiKey} onChange={event => setConnection({ ...connection, speech: { ...connection.speech, apiKey: event.target.value } })} />
      <Input label="OpenAI Speech API key" description="Optional transcription override; otherwise uses the global OpenAI connection." type="password" autoComplete="off" value={connection.speech.openaiApiKey} onChange={event => setConnection({ ...connection, speech: { ...connection.speech, openaiApiKey: event.target.value } })} />
      {(['nanogpt', 'openai', 'pruna'] as const).map(provider => <Input key={provider} label={`${provider === 'pruna' ? 'Pruna / LiteLLM' : providers[provider]} media API key`} description={provider === 'pruna' ? 'Optional LiteLLM gateway key for Pruna models. Uses the global LiteLLM endpoint; favorite models are preserved.' : 'Optional media override; otherwise uses this provider’s global connection. Favorite models are preserved.'} type="password" autoComplete="off" value={imageKeys[provider]} onChange={event => setImageKeys({ ...imageKeys, [provider]: event.target.value })} />)}</div>
      {connection.provider === 'fake' && <><div className="status success" role="note">Testing provider — responses, errors, reasoning, and tool calls are generated locally and deterministically. No text-AI network request is sent.</div><Disclosure className="settings-card provider-trace" title="Request trace" description="Session only · last 20 requests." aria-label="Fake provider request trace"><p>Inspect the exact provider-boundary payload generated by Arc.</p><Button size="small" disabled={!fakeTrace.length} onClick={clearFakeProviderTrace}>Clear trace</Button><pre>{fakeTrace.length ? JSON.stringify(fakeTrace, null, 2) : 'No Fake requests yet. Fake runs locally without text-AI network calls.'}</pre></Disclosure></>}
      <div className="profile-actions"><Button variant="primary" disabled={busy || !connectionDirty} onClick={() => { void save() }}>Save connections</Button><Button disabled={busy || !connectionDirty} onClick={discard}>Discard</Button></div>
    </section>}
    {isProfileSection && draft && effective && <section className="profile-editor" role={section === 'ai' ? 'tabpanel' : undefined} id={section === 'ai' ? `ai-panel-${aiSection}` : undefined} aria-labelledby={section === 'ai' ? `ai-tab-${aiSection}` : undefined} aria-label={`${profileLabels[activeKind]} editor`}>
      <div className="settings-card profile-library-controls">
        <Select label={activeKind === 'ui' ? 'UI profile' : 'Profile / preset'} value={draft.id} disabled={busy} onChange={event => { const id = event.target.value; requestLeave(() => selectProfile(id)) }}>{library.profiles.filter(profile => profile.kind === activeKind).map(profile => <option key={profile.id} value={profile.id}>{profile.name}{library.defaults[activeKind] === profile.id ? ' · Default' : ''}</option>)}</Select>
        <Input label="Profile name" value={draft.name} maxLength={100} disabled={busy} onChange={event => changeDraft({ ...draft, name: event.target.value })} />
        <div className="profile-actions"><Input label="New profile name" value={newName} disabled={busy} onChange={event => setNewName(event.target.value)} /><Button disabled={busy} onClick={() => create()}>Create</Button><Button disabled={busy} onClick={() => create(true)}>Duplicate</Button></div>
        <div className="profile-actions"><Button disabled={busy || library.defaults[draft.kind] === draft.id} onClick={() => makeDefault(draft)}>{library.defaults[draft.kind] === draft.id ? 'Default · protected' : 'Set as default'}</Button><Button variant="danger" disabled={busy || !usageReady || usage.length > 0 || library.defaults[draft.kind] === draft.id} onClick={remove}>Delete</Button></div>
        <p className="profile-help">Defaults apply to new books and outside a book. Changing a default does not reassign existing books. Used profiles and current defaults cannot be deleted.</p>
        {usageError ? <p role="alert">{usageError}<Button size="small" onClick={() => setUsageVersion(version => version + 1)}>Retry linked books</Button></p> : !usageReady ? <p role="status">Checking linked books…</p> : <details className="profile-usage"><summary>Used in {usage.length} book{usage.length === 1 ? '' : 's'}</summary><ul>{usage.map(book => <li key={book.id}>{book.title}</li>)}</ul></details>}
        {usage.length > 0 && <p className="profile-linked-warning">Saving updates all {usage.length} linked books for their next operation. Existing chats keep their model and prompt snapshots.</p>}
      </div>
      <fieldset key={`${draft.id}-${editorEpoch}`} className="profile-draft-fields" disabled={busy}>
        {draft.kind === 'ui' ? <><UiSettingsPanel value={draft.ui ?? defaultUiSettings} onChange={ui => changeDraft({ ...draft, ui })} />
          <section className="settings-card"><h2>Text reveal speed</h2><SegmentedControl label="Text reveal speed" value={draft.settings.generationWordDelayMs} onChange={delay => changeDraft({ ...draft, settings: { ...draft.settings, generationWordDelayMs: delay } })} options={[{ value: '120', label: 'Slow' }, { value: '40', label: 'Normal' }, { value: '10', label: 'Fast' }]} /><Input label="Custom reveal speed" description="Milliseconds per word, 1–2000. This belongs to the UI profile, not the text model." type="number" min="1" max="2000" value={draft.settings.generationWordDelayMs} onChange={event => changeDraft({ ...draft, settings: { ...draft.settings, generationWordDelayMs: event.target.value } })} /><TextRevealPreview delay={Number(draft.settings.generationWordDelayMs)} /></section></>
          : draft.kind === 'image' || draft.kind === 'video' ? <ImageSettingsPanel ai={connection} value={{ ...(draft.media ?? { favorites: [], defaultAlias: '', defaultAliases: {} }), keys: imageKeys }} hideCredentials mediaKind={draft.kind} onChange={value => { const { keys: _keys, ...media } = value; changeDraft({ ...draft, media }) }} />
          : renderEditor({ kind: draft.kind, settings: effective, library, onChange: settings => changeDraft({ ...draft, settings: withoutProfileCredentials(settings) }) })}
      </fieldset>
      <div className="profile-save-bar"><span role="status">{busy ? 'Saving…' : dirty ? 'Unsaved draft · no linked books changed' : 'Saved'}</span><Button disabled={busy || !dirty} onClick={discard}>Discard</Button><Button variant="primary" disabled={busy || !dirty || !usageReady || !draft.name.trim()} onClick={() => { void save() }}>Save profile</Button></div>
    </section>}
    {section === 'application' && <><header className="page-heading"><div><p>Global Settings</p><h1 id="page-title">Application</h1><span>Defaults are assigned to new books and used outside a book.</span></div></header><section className="settings-card"><h2>Default profiles</h2>{Object.keys(profileLabels).map(value => {
      const profileKind = value as ProfileKind
      return <Select key={value} label={`Default ${profileLabels[profileKind]}`} value={defaultDraft[profileKind]} disabled={busy} onChange={event => { const id = event.target.value; if (!busyRef.current) setDefaultDraft(current => ({ ...current, [profileKind]: id })) }}>{library.profiles.filter(profile => profile.kind === profileKind).map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</Select>
    })}<p className="profile-help">Save default selections explicitly. They apply to new books and outside a book, never to existing book assignments.</p><div className="profile-actions"><Button variant="primary" disabled={busy || !defaultsDirty} onClick={() => { void save() }}>Save defaults</Button><Button disabled={busy || !defaultsDirty} onClick={discard}>Discard defaults</Button><span role="status">{defaultsDirty ? 'Unsaved default selections' : 'Default selections saved'}</span></div></section>{application}</>}
    {section === 'sync' && sync}
    </div>
  </div>
})
const globalAiSections = [['connection', 'Connections'], ['models', 'Models'], ['prompts', 'Prompts']] as const
export default SettingsProfilesPanel

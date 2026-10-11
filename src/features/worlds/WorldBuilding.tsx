import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, BookOpen, Copy, Globe2, Pencil, Plus, Search, Trash2, WandSparkles } from 'lucide-react'
import { createBook, listBooks, type BookEntity, type CodexEntryEntity } from '../../data/persistence'
import { loadAiSettings } from '../../shared/ai/ai-settings'
import ActionMenu from '../../shared/ui/ActionMenu'
import Button from '../../shared/ui/Button'
import Input from '../../shared/ui/Input'
import PanelHeader from '../../shared/ui/PanelHeader'
import ResourceListRow from '../../shared/ui/ResourceListRow'
import IllustrationModal from '../images/IllustrationModal'
import { loadSettingsProfiles, resolveProfileSettings } from '../settings/settings-profiles'
import { generateAutotitleSuggestion, prepareAutotitleRequest, type AutotitleRequest } from '../writing/autotitle-service'
import { copyWorldEntryToAllBooksAndRemove, createWorld, deleteWorld, listWorldEntries, listWorlds, renameWorld, setBookWorld, worldDemotionConflicts, type WorldEntity, type WorldTriggerConflict } from './world-service'
import TriggerConflictsDialog from './TriggerConflictsDialog'
import '../images/illustrations.css'
import './worlds.css'

const message = (reason: unknown) => reason instanceof Error ? reason.message : String(reason)
type WorldRecord = { world: WorldEntity; entries: CodexEntryEntity[]; books: BookEntity[] }

export function WorldWorkspacePanel({ world, tab, beforeChange, onOpenBook, onRefresh, onHome }: {
  world: WorldEntity; tab: 'world' | 'books'; beforeChange: () => Promise<void>; onOpenBook: (id: string) => void; onRefresh: () => Promise<void>; onHome: () => void
}) {
  const { records, loading, error: loadError, reload } = useWorldLibrary()
  const record = records.find(item => item.world.id === world.id)
  const [books, setBooks] = useState<BookEntity[]>([])
  const [selectedBook, setSelectedBook] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  useEffect(() => { let live = true; void listBooks().then(items => { if (live) setBooks(items) }).catch(reason => { if (live) setError(message(reason)) }); return () => { live = false } }, [world.id, record])
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try { await beforeChange(); await action(); await reload(); await onRefresh() }
    catch (reason) { setError(message(reason)) }
    finally { lock.current = false; setBusy(false) }
  }
  const attach = () => run(async () => {
    const book = books.find(item => item.id === selectedBook)
    if (!book) throw new Error('Choose an existing Book.')
    if (book.worldId && book.worldId !== world.id) {
      const previous = records.find(item => item.world.id === book.worldId)?.world.title ?? book.worldId
      if (!window.confirm(`Move “${book.title}” from World “${previous}” to “${world.title}”? Its local content stays unchanged; access to the previous shared lore ends.`)) return
    }
    await setBookWorld(book.id, world.id)
  })
  return <section aria-label={tab === 'world' ? 'World settings' : 'Linked Books'}>
    <PanelHeader title={tab === 'world' ? world.title : 'Books'} eyebrow="World workspace" />
    {(error || loadError) && <p role="alert">{error || loadError}<Button onClick={() => { void reload() }}>Retry</Button></p>}
    {loading && <p role="status">Loading World…</p>}
    {tab === 'world' ? <>
      {record && <WorldActions record={record} disabled={loading || busy} />}
      <p>Articles, Notes and Chat belong to this World. Only an empty World can be deleted; linked Books are disconnected, never deleted.</p>
      <Button onClick={onHome}>Home</Button>
      {record && record.books.length > 0 && <details><summary>Transfer World entries to all linked Books</summary>{record.entries.map(entry => <WorldEntryRow key={entry.id} entry={entry} worldId={world.id} books={record.books} disabled={busy || loading} />)}</details>}
    </> : <>
      {!record?.books.length && <p>No Books linked. Codex, Notes and Chat work without a Book.</p>}
      {record?.books.map(book => <div key={book.id}><ResourceListRow title={book.title} onOpen={() => onOpenBook(book.id)} /><Button disabled={busy} onClick={() => { if (window.confirm(`Disconnect “${book.title}” from “${world.title}”? Local content remains; shared World lore becomes unavailable.`)) void run(async () => { await setBookWorld(book.id, '') }) }}>Disconnect</Button></div>)}
      <Button disabled={busy} onClick={() => { void run(async () => { const created = await createBook(loadAiSettings()); await setBookWorld(created.book.id, world.id) }) }}>New Book in this World</Button>
      <label>Connect existing Book<select aria-label="Connect existing Book" value={selectedBook} disabled={busy} onChange={event => setSelectedBook(event.target.value)}><option value="">Choose Book</option>{books.filter(book => book.worldId !== world.id).map(book => <option key={book.id} value={book.id}>{book.title}</option>)}</select></label>
      <Button disabled={busy || !selectedBook} onClick={() => { void attach() }}>Connect Book</Button>
    </>}
  </section>
}

// These views are mounted only after the parent has finished main-library startup.
function useWorldLibrary() {
  const [records, setRecords] = useState<WorldRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const request = useRef(0)
  const reload = useCallback(async () => {
    const token = ++request.current
    setLoading(true)
    setError('')
    try {
      const [worlds, books] = await Promise.all([listWorlds(), listBooks()])
      const next = await Promise.all(worlds.map(async world => ({ world, entries: await listWorldEntries(world.id), books: books.filter(book => book.worldId === world.id) })))
      if (token === request.current) setRecords(next)
    } catch (reason) {
      if (token === request.current) setError(message(reason))
    } finally {
      if (token === request.current) setLoading(false)
    }
  }, [])
  useEffect(() => {
    let live = true, queued = false
    // One World mutation can notify every linked Book; coalesce that event burst.
    const refresh = () => {
      if (queued) return
      queued = true
      queueMicrotask(() => { queued = false; if (live) void reload() })
    }
    void reload()
    window.addEventListener('arc-worlds-changed', refresh)
    window.addEventListener('arc-entity-changed', refresh)
    return () => {
      live = false
      ++request.current
      window.removeEventListener('arc-worlds-changed', refresh)
      window.removeEventListener('arc-entity-changed', refresh)
    }
  }, [reload])
  return { records, loading, error, reload }
}

function NewWorldButton({ onOpen, disabled = false }: { onOpen: (id: string) => void; disabled?: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const live = useRef(false), lock = useRef(false)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const add = async () => {
    if (lock.current || disabled) return
    lock.current = true
    setBusy(true); setError('')
    try {
      const world = await createWorld()
      if (live.current) onOpen(world.id)
    } catch (reason) {
      if (live.current) setError(message(reason))
    } finally {
      lock.current = false
      if (live.current) setBusy(false)
    }
  }
  return <div className="world-new-action"><Button size="small" leadingIcon={<Plus />} loading={busy} disabled={disabled} onClick={() => { void add() }}>New world</Button>{error && <p role="alert">{error}</p>}</div>
}

const counts = ({ books, entries }: WorldRecord) => `${entries.length} Codex ${entries.length === 1 ? 'entry' : 'entries'} · ${books.length} linked ${books.length === 1 ? 'Book' : 'Books'}`

export function WorldsHomeSection({ onViewAll, onOpen }: { onViewAll: () => void; onOpen: (worldId: string) => void }) {
  const { records, loading, error, reload } = useWorldLibrary()
  return <section className="worlds-home-section" aria-label="Worlds">
    <PanelHeader eyebrow="Shared knowledge" title="Worlds" actions={<><Button size="small" onClick={onViewAll}>View all</Button><NewWorldButton disabled={loading || Boolean(error)} onOpen={onOpen} /></>} />
    <p className="world-help">Shared Codex lore for linked Books.</p>
    {loading && <p role="status">Loading Worlds…</p>}
    {error && <p className="world-error" role="alert">{error} <Button size="small" onClick={() => { void reload() }}>Retry</Button></p>}
    {!loading && !error && !records.length && <p className="world-empty">No Worlds yet. Create a World to share lore between Books.</p>}
    {records.slice(0, 4).map(record => <ResourceListRow key={record.world.id} icon={<Globe2 />} title={record.world.title} meta={counts(record)} onOpen={() => onOpen(record.world.id)} />)}
  </section>
}

function WorldTitleDialog({ world, autotitle, onClose }: { world: WorldEntity; autotitle: boolean; onClose: () => void }) {
  const [title, setTitle] = useState(world.title)
  const [request, setRequest] = useState<AutotitleRequest>()
  const [suggestion, setSuggestion] = useState('')
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const live = useRef(false), saveLock = useRef(false), generation = useRef(0), controller = useRef<AbortController | null>(null)
  const generate = useCallback(async () => {
    if (controller.current || saveLock.current) return
    const token = ++generation.current
    const abort = new AbortController()
    controller.current = abort
    setGenerating(true); setSuggestion(''); setRequest(undefined); setError('')
    try {
      const settings = resolveProfileSettings(loadSettingsProfiles().defaults)
      const prepared = await prepareAutotitleRequest(world.id, world.id, settings)
      if (!live.current || token !== generation.current || abort.signal.aborted) return
      setRequest(prepared)
      const next = await generateAutotitleSuggestion(settings, prepared, abort.signal)
      if (live.current && token === generation.current && !abort.signal.aborted) setSuggestion(next)
    } catch (reason) {
      if (live.current && token === generation.current && !abort.signal.aborted) setError(message(reason))
    } finally {
      if (token === generation.current) {
        controller.current = null
        if (live.current) setGenerating(false)
      }
    }
  }, [world.id])
  useEffect(() => {
    live.current = true
    if (autotitle) void generate()
    return () => { live.current = false; ++generation.current; controller.current?.abort(); controller.current = null }
  }, [autotitle, generate])
  const stop = () => {
    ++generation.current
    controller.current?.abort(); controller.current = null
    setGenerating(false); setSuggestion(''); setRequest(undefined); setError('Generation stopped. Regenerate when ready.')
  }
  const save = async () => {
    const next = autotitle ? suggestion : title.trim()
    if (saveLock.current || generating || !next || (autotitle && !request)) return
    saveLock.current = true; setSaving(true); setError('')
    try {
      await renameWorld(world.id, next, autotitle ? request!.expectedUpdatedAt : world.updatedAt)
      if (live.current) onClose()
    } catch (reason) {
      if (live.current) setError(message(reason))
    } finally {
      saveLock.current = false
      if (live.current) setSaving(false)
    }
  }
  return <IllustrationModal title={autotitle ? `Autotitle World · ${world.title}` : 'Rename World'} onClose={() => { if (!saveLock.current) onClose() }} footer={<>
    <Button disabled={saving} onClick={onClose}>Cancel</Button>
    {autotitle && (generating ? <Button variant="danger" onClick={stop}>Stop</Button> : <Button disabled={saving} onClick={() => { void generate() }}>Regenerate</Button>)}
    <Button variant="primary" loading={saving} disabled={generating || !(autotitle ? suggestion && request : title.trim())} onClick={() => { void save() }}>{autotitle ? 'Use title' : 'Save title'}</Button>
  </>}>
    {autotitle ? <div className="world-autotitle">
      <p className="world-help">Uses the global default text profile and this World’s Codex lore. Nothing changes until you accept a suggestion.</p>
      {generating && <p role="status">Generating suggestion…</p>}
      {suggestion && <div className="world-title-suggestion" aria-live="polite"><small>Suggested title</small><strong>{suggestion}</strong></div>}
      {request && <p className="world-help world-request-meta">{request.model} · ~{request.diagnostics.requestTokens.toLocaleString()} input tokens</p>}
    </div> : <Input label="World title" aria-label="World title" value={title} disabled={saving} onChange={event => setTitle(event.target.value)} />}
    {error && <p className="world-error" role="alert">{error}</p>}
  </IllustrationModal>
}

function WorldActions({ record, disabled }: { record: WorldRecord; disabled: boolean }) {
  const { world, books, entries } = record
  const [open, setOpen] = useState(false)
  const [dialog, setDialog] = useState<'rename' | 'autotitle' | 'delete'>()
  const [snapshot, setSnapshot] = useState(world)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const live = useRef(false), lock = useRef(false)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const show = (next: typeof dialog) => { setSnapshot(world); setError(''); setDialog(next) }
  const remove = async () => {
    if (lock.current || disabled || entries.length) return
    lock.current = true; setBusy(true); setError('')
    try {
      await deleteWorld(world.id)
      if (live.current) setDialog(undefined)
    } catch (reason) {
      if (live.current) setError(message(reason))
    } finally {
      lock.current = false
      if (live.current) setBusy(false)
    }
  }
  return <>
    <ActionMenu title={world.title} open={open} onToggle={() => setOpen(value => !value)} onClose={() => setOpen(false)} actions={[
      { label: 'Rename', icon: <Pencil />, disabled, onSelect: () => show('rename') },
      { label: 'Autotitle', icon: <WandSparkles />, disabled, onSelect: () => show('autotitle') },
      { label: 'Delete World', icon: <Trash2 />, danger: true, disabled: disabled || Boolean(entries.length), onSelect: () => show('delete') },
    ]} />
    {(dialog === 'rename' || dialog === 'autotitle') && <WorldTitleDialog world={snapshot} autotitle={dialog === 'autotitle'} onClose={() => setDialog(undefined)} />}
    {dialog === 'delete' && <IllustrationModal title={`Delete World · ${world.title}`} onClose={() => { if (!lock.current) setDialog(undefined) }} footer={<><Button disabled={busy} onClick={() => setDialog(undefined)}>Cancel</Button><Button variant="danger" loading={busy} disabled={disabled || Boolean(entries.length)} onClick={() => { void remove() }}>Delete empty World</Button></>}>
      <p>Delete this empty World and its World-owned history and media? This cannot be undone.</p>
      <p>{books.length ? `${books.length} linked Books will be disconnected: ${books.map(book => book.title).join(', ')}. Their local content will remain.` : 'No Books are linked to this World.'}</p>
      {Boolean(entries.length) && <p>Only an empty World can be deleted. Its Codex entries must be moved first.</p>}
      {error && <p className="world-error" role="alert">{error}</p>}
    </IllustrationModal>}
  </>
}

function WorldEntryRow({ entry, worldId, books, disabled }: { entry: CodexEntryEntity; worldId: string; books: BookEntity[]; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const [conflicts, setConflicts] = useState<WorldTriggerConflict[]>([])
  const [checking, setChecking] = useState(true)
  const [checkError, setCheckError] = useState('')
  const [dialog, setDialog] = useState<'conflicts' | 'copy'>()
  const [approvedBooks, setApprovedBooks] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const live = useRef(false), checkToken = useRef(0), lock = useRef(false)
  const check = useCallback(async () => {
    const token = ++checkToken.current
    setChecking(true); setCheckError('')
    try {
      const next = await worldDemotionConflicts(worldId, entry.id)
      if (!live.current || token !== checkToken.current) return false
      setConflicts(next)
      return true
    } catch (reason) {
      if (live.current && token === checkToken.current) setCheckError(message(reason))
      return false
    } finally {
      if (live.current && token === checkToken.current) setChecking(false)
    }
  }, [worldId, entry, books])
  useEffect(() => {
    live.current = true
    void check()
    return () => { live.current = false; ++checkToken.current }
  }, [check])
  const blocked = disabled || busy || checking || Boolean(checkError) || Boolean(conflicts.length) || !books.length
  const reason = !books.length ? 'Connect at least one Book before copying and removing this source.' : checking || disabled ? 'Checking linked Books and trigger conflicts…' : checkError || (conflicts.length ? 'Resolve trigger conflicts before copying and removing this source.' : '')
  const viewConflicts = async () => {
    if (await check()) { if (live.current) setDialog('conflicts') }
  }
  const copy = async () => {
    if (lock.current || blocked) return
    lock.current = true; setBusy(true); setError('')
    try {
      const currentBooks = (await listBooks()).filter(book => book.worldId === worldId).map(book => book.id).sort()
      if (currentBooks.join('\n') !== [...approvedBooks].sort().join('\n')) throw new Error('Linked Books changed. Cancel and review the linked Books before confirming again.')
      await copyWorldEntryToAllBooksAndRemove(worldId, entry.id)
      if (live.current) setDialog(undefined)
    } catch (reason) {
      if (live.current) { setError(message(reason)); void check() }
    } finally {
      lock.current = false
      if (live.current) setBusy(false)
    }
  }
  return <article className="world-entry">
    <div className="world-entry-identity"><BookOpen aria-hidden="true" /><div><strong>{entry.title}</strong><small>{entry.category}</small></div>
      <ActionMenu title={entry.title} open={open} onToggle={() => setOpen(value => !value)} onClose={() => setOpen(false)} actions={[
        { label: 'Copy to all linked books and remove from World', icon: <Copy />, disabled: blocked, onSelect: () => { setApprovedBooks(books.map(book => book.id)); setError(''); setDialog('copy') } },
      ]} />
    </div>
    <div className="world-entry-controls"><Button size="small" variant="ghost" disabled={disabled || busy || checking} onClick={() => { void viewConflicts() }}>View trigger conflicts with Books</Button>{reason && <small className={checkError ? 'world-error' : 'world-help'} role={checkError ? 'alert' : undefined}>{reason}</small>}</div>
    {dialog === 'conflicts' && <TriggerConflictsDialog title={`Trigger conflicts · ${entry.title}`} conflicts={conflicts} onClose={() => setDialog(undefined)} />}
    {dialog === 'copy' && <IllustrationModal title={`Copy and remove · ${entry.title}`} onClose={() => { if (!lock.current) setDialog(undefined) }} footer={<><Button disabled={busy} onClick={() => setDialog(undefined)}>Cancel</Button><Button variant="danger" loading={busy} disabled={blocked} onClick={() => { void copy() }}>Copy to all Books and remove source</Button></>}>
      <p>Create an independent local copy in every linked Book, including Books that hide this entry, then remove the shared World source. This cannot be undone here.</p>
      <p>{books.length} linked Books: {books.map(book => book.title).join(', ')}.</p>
      <p>Future edits to the copies will no longer be shared. Trigger conflicts are checked again in the transaction; no partial copies are saved if the operation fails.</p>
      {reason && <p className="world-help">{reason}</p>}{error && <p className="world-error" role="alert">{error}</p>}
    </IllustrationModal>}
  </article>
}

function WorldDetail({ record, disabled, onOpen }: { record: WorldRecord; disabled: boolean; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const normalized = query.trim().toLocaleLowerCase()
  const entries = record.entries.filter(entry => !normalized || `${entry.title} ${entry.category}`.toLocaleLowerCase().includes(normalized)).sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
  return <section className="world-detail" aria-label={`World Codex · ${record.world.title}`}>
    <PanelHeader eyebrow="World Building" title={record.world.title} actions={<WorldActions record={record} disabled={disabled} />} />
    <p className="world-help">{counts(record)}{record.books.length > 0 && `: ${record.books.map(book => book.title).join(', ')}`}</p>
    <Button disabled={disabled} onClick={() => onOpen(record.world.id)}>Open World workspace</Button>
    {record.entries.length > 0 && <p className="world-help">Delete World is unavailable: only an empty World can be deleted.</p>}
    <Input type="search" leadingIcon={<Search />} aria-label="Search World Codex" placeholder="Search title or type" value={query} onChange={event => setQuery(event.target.value)} />
    <div className="world-entry-list" aria-label="World Codex entries">
      {entries.map(entry => <WorldEntryRow key={entry.id} entry={entry} worldId={record.world.id} books={record.books} disabled={disabled} />)}
      {!entries.length && <p className="world-empty">{query ? 'No matching Codex entries.' : 'No Codex entries in this World. Move entries here from a linked Book.'}</p>}
    </div>
  </section>
}

export default function WorldBuilding({ initialWorldId, onHome, onOpen }: { initialWorldId?: string; onHome: () => void; onOpen: (id: string) => void }) {
  const { records, loading, error, reload } = useWorldLibrary()
  const [selectedId, setSelectedId] = useState(initialWorldId ?? '')
  useEffect(() => { setSelectedId(initialWorldId ?? '') }, [initialWorldId])
  const selected = records.find(record => record.world.id === selectedId)
  return <main className="world-building" aria-label="World Building">
    <header className="world-building-header"><Button leadingIcon={<ArrowLeft />} onClick={onHome}>Home</Button><h1>World Building</h1></header>
    <div className="world-building-layout">
      <section className="world-library" aria-label="World library">
        <PanelHeader eyebrow="Library" title="Worlds" actions={<NewWorldButton disabled={loading || Boolean(error)} onOpen={onOpen} />} />
        {loading && <p role="status">Loading Worlds…</p>}
        {error && <p className="world-error" role="alert">{error} <Button size="small" onClick={() => { void reload() }}>Retry</Button></p>}
        {!loading && !error && !records.length && <p className="world-empty">No Worlds yet.</p>}
        {records.map(record => <ResourceListRow key={record.world.id} icon={<Globe2 />} title={record.world.title} meta={counts(record)} selected={record.world.id === selectedId} onOpen={() => onOpen(record.world.id)} />)}
      </section>
      {selected ? <WorldDetail key={selected.world.id} record={selected} disabled={loading || Boolean(error)} onOpen={onOpen} /> : <section className="world-detail world-empty"><p>{loading ? 'Loading World…' : selectedId ? 'This World is no longer available. Select another World.' : 'Select a World to browse its Codex entries.'}</p></section>}
    </div>
  </main>
}

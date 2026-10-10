import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Archive, ArchiveRestore, BookOpen, Copy, EyeOff, Link, Pencil, Plus, LayoutGrid, List, Search, Trash2, WandSparkles } from 'lucide-react'
import CodexActionsMenu, { type CodexAction } from './CodexActionsMenu'
import { useLoreTypes } from './LoreTypesControls'
import { copyWorldEntryToBook, listBookCodexEntries, moveEntryToWorld, setWorldEntryHidden, worldTransferConflicts, type WorldTriggerConflict } from '../worlds/world-service'
import TriggerConflictsDialog from '../worlds/TriggerConflictsDialog'
import { conflictingCodexTriggers } from './codex-trigger-service'
import { readTimelineWorld } from './codex-timeline-service'
import { checkpointPlaced, type TimelineWorld } from './codex-timeline'
import { CODEX_PAGE_SIZE, dashboardPreferences, defaultCodexDashboard, queryCodexDashboard, type CodexDashboardPreferences } from './codex-dashboard'
import { proseText } from '../editor/document-projection'
import { getEntity, setCodexEntryStatus, type BookEntity, type CodexDependencyEdge, type CodexEntryEntity } from '../../data/persistence'
import type { SummaryState } from '../writing/summary-service'
import Button from '../../shared/ui/Button'
import Disclosure from '../../shared/ui/Disclosure'
import Input from '../../shared/ui/Input'
import PanelHeader from '../../shared/ui/PanelHeader'
import SegmentedControl from '../../shared/ui/SegmentedControl'
import Select from '../../shared/ui/Select'
import ResourceListRow from '../../shared/ui/ResourceListRow'
import './codex-ui-kit.css'

function countLabel(count: number, singular: string) {
  return `${count} ${count === 1 ? singular : `${singular}s`}`
}

type DashboardProps = {
  bookId: string; entries: CodexEntryEntity[]; activeId: string | null; summaryStates: Record<string, SummaryState>; dependencies?: CodexDependencyEdge[]; management?: ReactNode
  onCreate: () => void; onOpen: (id: string) => void; onAutotitle: (entry: CodexEntryEntity) => void; onRename: (entry: CodexEntryEntity) => void; onArchive: (entry: CodexEntryEntity) => void; onRestore: (entry: CodexEntryEntity) => void; onDelete: (entry: CodexEntryEntity) => void; onBeforeChange: () => Promise<void>; onRefresh: () => Promise<void>
}

type BookData = { book: BookEntity; allEntries: CodexEntryEntity[]; visibleEntries: CodexEntryEntity[] }
type TransferCheck = { id: string; data: BookData; conflicts?: WorldTriggerConflict[]; error?: string }

// A Book switch resets view preferences and invalidates pending work from the old Book.
export default function CodexDashboard(props: DashboardProps) {
  return <BookCodexDashboard key={props.bookId} {...props} />
}

function BookCodexDashboard({ bookId, entries, activeId, summaryStates, dependencies = [], management, onCreate, onOpen, onAutotitle, onRename, onArchive, onRestore, onDelete, onBeforeChange, onRefresh }: DashboardProps) {
  const key = `arc-codex-dashboard-${bookId}`
  const [prefs, setPrefs] = useState(() => { try { return dashboardPreferences(JSON.parse(localStorage.getItem(key) ?? 'null')) } catch { return { ...defaultCodexDashboard } } })
  const [page, setPage] = useState(0), [error, setError] = useState(''), [saveError, setSaveError] = useState(false), [busy, setBusy] = useState(''), [world, setWorld] = useState<TimelineWorld>()
  const [actionsId, setActionsId] = useState<string | null>(null)
  const [bookData, setBookData] = useState<BookData>(), [loadError, setLoadError] = useState(''), [reload, setReload] = useState(0)
  const [transferCheck, setTransferCheck] = useState<TransferCheck>()
  const [conflictDialog, setConflictDialog] = useState<{ title: string; conflicts: WorldTriggerConflict[] }>()
  const alive = useRef(true), running = useRef(false)
  const closeActions = useCallback(() => setActionsId(null), [])
  const { types } = useLoreTypes(bookId)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(prefs)); setSaveError(false) } catch { setSaveError(true) } }, [key, prefs])
  useEffect(() => { let current = true; setWorld(undefined); if (entries.some(entry => entry.checkpoints?.length)) void readTimelineWorld(bookId).then(world => { if (current) setWorld(world) }).catch(() => {}); return () => { current = false } }, [bookId, entries])
  useEffect(closeActions, [bookId, page, prefs, closeActions])
  useEffect(() => {
    let current = true, request = 0
    const load = async () => {
      const version = ++request
      setBookData(undefined); setLoadError('')
      try {
        const [book, allEntries] = await Promise.all([getEntity<BookEntity>(bookId), listBookCodexEntries(bookId, true)])
        if (!current || version !== request) return
        if (!book || book.type !== 'book') throw new Error('This Book is unavailable.')
        setBookData({ book, allEntries, visibleEntries: entries })
      } catch (reason) { if (current && version === request) setLoadError((reason as Error).message) }
    }
    void load()
    const changed = () => { void load() }
    window.addEventListener('arc-worlds-changed', changed)
    return () => { current = false; window.removeEventListener('arc-worlds-changed', changed) }
  }, [bookId, entries, reload])
  const currentData = bookData?.visibleEntries === entries ? bookData : undefined
  useEffect(() => {
    let current = true
    setTransferCheck(undefined)
    if (actionsId && currentData?.book.worldId) {
      void worldTransferConflicts(bookId, actionsId).then(conflicts => {
        if (current) setTransferCheck({ id: actionsId, data: currentData, conflicts })
      }).catch(reason => { if (current) setTransferCheck({ id: actionsId, data: currentData, error: (reason as Error).message }) })
    }
    return () => { current = false }
  }, [bookId, actionsId, currentData])
  const update = (patch: Partial<CodexDashboardPreferences>) => { setPrefs(value => ({ ...value, ...patch })); if (Object.keys(patch).some(key => key !== 'view')) setPage(0) }
  const hiddenIds = useMemo(() => new Set(currentData?.book.hiddenWorldEntryIds ?? []), [currentData])
  const visibleEntries = useMemo(() => entries.filter(entry => !hiddenIds.has(entry.id)), [entries, hiddenIds])
  const filtered = useMemo(() => queryCodexDashboard(visibleEntries, prefs, summaryStates), [visibleEntries, prefs, summaryStates])
  const pages = Math.max(1, Math.ceil(filtered.length / CODEX_PAGE_SIZE)), currentPage = Math.min(page, pages - 1), visible = filtered.slice(currentPage * CODEX_PAGE_SIZE, (currentPage + 1) * CODEX_PAGE_SIZE)
  const entryIds = useMemo(() => new Set(visibleEntries.map(entry => entry.id)), [visibleEntries])
  const worldEntries = useMemo(() => visibleEntries.filter(entry => entry.worldId && !entry.hiddenInBook), [visibleEntries])
  const hiddenEntries = currentData?.allEntries.filter(entry => entry.worldId && hiddenIds.has(entry.id)) ?? []
  const run = async (id: string, action: () => Promise<unknown>) => {
    if (running.current) return
    running.current = true; setBusy(id); setError('')
    try {
      await onBeforeChange()
      if (!alive.current) return
      await action()
      if (!alive.current) return
      await onRefresh()
      if (alive.current) setReload(value => value + 1)
    } catch (reason) { if (alive.current) setError((reason as Error).message) }
    finally { running.current = false; if (alive.current) setBusy('') }
  }
  return <section className="codex-dashboard" aria-label="Codex browser">
    <PanelHeader eyebrow="Book and World knowledge" title={prefs.archived ? 'Codex archive' : 'Codex'} actions={!prefs.archived && <Button size="small" variant="secondary" leadingIcon={<Plus />} onClick={onCreate}>New</Button>} />
    {management && <div className="codex-dashboard-management">{management}</div>}
    {worldEntries.length > 0 && <p>World entries are shared. Editing, changing status, archiving, or deleting them affects every linked Book. Hiding affects only this Book.</p>}
    <div className="codex-view-controls"><SegmentedControl label="Codex view" value={prefs.view} options={[{ value: 'list', label: 'List', icon: <List /> }, { value: 'cards', label: 'Cards', icon: <LayoutGrid /> }]} onChange={view => update({ view })} /><Select className="codex-archive-mode" aria-label="Codex archive mode" value={prefs.archived ? 'archived' : 'active'} onChange={e => update({ archived: e.target.value === 'archived' })}><option value="active">Unarchived</option><option value="archived">Archived</option></Select></div>
    <Input className="codex-dashboard-search" type="search" aria-label="Search Codex" value={prefs.query} onChange={e => update({ query: e.target.value })} placeholder="Search title, type, or prose" leadingIcon={<Search />} />
    <Disclosure className="codex-dashboard-filters" title="Filters and sort"><div className="codex-dashboard-filter-grid">
      <Select label="Type" value={prefs.typeId} onChange={e => update({ typeId: e.target.value })}><option value="">All types</option>{types.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}{prefs.typeId && !types.some(type => type.id === prefs.typeId) && <option value={prefs.typeId}>Unavailable type</option>}</Select>
      <Select label="Scope" value={prefs.scope === 'inherited' ? 'world' : prefs.scope === 'override' ? 'book' : prefs.scope} onChange={e => update({ scope: e.target.value as CodexDashboardPreferences['scope'] })}><option value="all">All scopes</option><option value="book">Book-only</option><option value="world">World</option></Select>
      <Select label="Status" value={prefs.status} disabled={prefs.archived} onChange={e => update({ status: e.target.value as CodexDashboardPreferences['status'] })}><option value="all">Active and draft</option><option value="active">Active</option><option value="draft">Draft</option></Select>
      <Select label="Summary" value={prefs.summary} onChange={e => update({ summary: e.target.value as CodexDashboardPreferences['summary'] })}>{['all','missing','current','outdated'].map(id => <option key={id} value={id}>{id === 'all' ? 'Any summary state' : id}</option>)}</Select>
      <Select label="Triggers" value={prefs.triggers} onChange={e => update({ triggers: e.target.value as CodexDashboardPreferences['triggers'] })}><option value="all">Any</option><option value="yes">With triggers</option><option value="no">Without triggers</option></Select>
      <Select label="Sort" aria-label="Codex sort" value={prefs.sort} onChange={e => update({ sort: e.target.value as CodexDashboardPreferences['sort'] })}><option value="title">Title A–Z</option><option value="edited">Recently edited</option><option value="type">Type, then title</option></Select>
    </div><Button size="small" variant="ghost" onClick={() => update({ ...defaultCodexDashboard, view: prefs.view })}>Clear filters</Button></Disclosure>
    <p className="codex-results-count" role="status">{filtered.length} entries · Page {currentPage + 1} of {pages}</p>
    <div className={`codex-dashboard-results ${prefs.view}`}>
      {visible.map(entry => {
        const isWorld = Boolean(entry.worldId), scope = isWorld ? 'World' : 'Book-only'
        const status = entry.archivedAt ? 'Archived' : entry.codexStatus === 'draft' ? 'Draft' : 'Active'
        const globalLabel = isWorld ? ' in World' : ''
        const conflicts = isWorld ? [] : conflictingCodexTriggers(entry, worldEntries)
        const warning = conflicts.length > 0 && <span className="codex-trigger-conflict"> · Trigger conflict: {conflicts.map(conflict => `“${conflict.trigger}” with World entry “${conflict.title}”`).join('; ')}. Active Book-only entries take automatic priority.</span>
        const unplaced = world ? (entry.checkpoints ?? []).filter(point => !checkpointPlaced(point, world)).length : 0
        const broken = dependencies.filter(edge => edge.sourceId === entry.id && !entryIds.has(edge.targetId)).length
        const actions: CodexAction[] = []
        const addAction = (label: string, icon: ReactNode, onSelect: () => void, disabled = false) => actions.push({ label, icon, onSelect, disabled: Boolean(busy) || disabled })
        if (!prefs.archived) {
          addAction(`Rename${globalLabel}`, <Pencil />, () => onRename(entry))
          addAction(`Autotitle${globalLabel}`, <WandSparkles />, () => onAutotitle(entry))
          addAction(`${entry.codexStatus === 'draft' ? 'Activate' : 'Set draft'}${globalLabel}`, <Pencil />, () => { void run(entry.id, () => setCodexEntryStatus(entry.id, entry.codexStatus === 'draft' ? 'active' : 'draft')) })
        }
        const check = transferCheck?.id === entry.id && transferCheck.data === currentData ? transferCheck : undefined
        const checkedConflicts = check?.conflicts
        const destination = isWorld ? 'Book' : 'World'
        addAction(isWorld ? 'Copy to Book' : 'Link to World', isWorld ? <Copy /> : <Link />, () => {
          void run(entry.id, () => isWorld ? copyWorldEntryToBook(bookId, entry.id) : moveEntryToWorld(bookId, entry.id))
        }, !currentData?.book.worldId || !checkedConflicts || checkedConflicts.length > 0)
        addAction(`View trigger conflicts with ${destination}`, <Search />, () => {
          setConflictDialog({ title: `Trigger conflicts with ${destination} — ${entry.title}`, conflicts: checkedConflicts! })
        }, !currentData?.book.worldId || !checkedConflicts)
        if (isWorld) addAction('Hide in this Book', <EyeOff />, () => { void run(entry.id, () => setWorldEntryHidden(bookId, entry.id, true)) }, !currentData)
        addAction(`${prefs.archived ? 'Restore' : 'Archive'}${globalLabel}`, prefs.archived ? <ArchiveRestore /> : <Archive />, () => prefs.archived ? onRestore(entry) : onArchive(entry))
        addAction(`Delete${globalLabel}`, <Trash2 />, () => onDelete(entry))
        const preview = proseText(entry.content).replace(/\s+/g, ' ').trim().slice(0, 240) || 'No body yet'
        const metadata = [
          scope, status,
          countLabel(entry.autoIncludeTriggers?.length ?? 0, 'trigger'),
          countLabel(dependencies.filter(edge => edge.sourceId === entry.id).length, 'relationship'),
          countLabel(entry.checkpoints?.length ?? 0, 'checkpoint'),
          ...((unplaced || broken) ? [countLabel(unplaced + broken, 'unavailable reference')] : []),
        ].join(' · ')
        const menu = <CodexActionsMenu title={entry.title} open={actionsId === entry.id} onToggle={() => setActionsId(current => current === entry.id ? null : entry.id)} onClose={closeActions} actions={actions} />
        if (prefs.view === 'list') return <ResourceListRow key={entry.id} className="codex-dashboard-entry" selected={activeId === entry.id} icon={<BookOpen />} title={entry.title} meta={<>{entry.category} · {scope} · {status}{warning}</>} onOpen={() => onOpen(entry.id)} actions={menu} />
        return <article key={entry.id} className={`codex-dashboard-entry ${activeId === entry.id ? 'selected' : ''}`}>
          <button className="codex-dashboard-open" type="button" aria-current={activeId === entry.id ? 'true' : undefined} onClick={() => onOpen(entry.id)}><span><small>{entry.category} · {scope} · {status}</small><strong>{entry.title}</strong><span className="codex-dashboard-preview">{preview}</span></span></button>
          <div className="codex-dashboard-entry-actions">{menu}</div>
          <footer>{metadata}{warning}</footer>
        </article>
      })}
    </div>
    {!visible.length && <p>No matching entries. Try clearing filters.</p>}
    {pages > 1 && <nav className="codex-pagination" aria-label="Codex pages"><Button size="small" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous page</Button><span>{currentPage + 1} / {pages}</span><Button size="small" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Next page</Button></nav>}
    {hiddenEntries.length > 0 && <Disclosure title={`Hidden World entries (${hiddenEntries.length})`} description="Hidden only in this Book; restore to browse or edit.">
      {hiddenEntries.map(entry => <div key={entry.id}><span>{entry.title} · World</span><Button size="small" variant="ghost" disabled={Boolean(busy)} onClick={() => { void run(entry.id, () => setWorldEntryHidden(bookId, entry.id, false)) }}>Restore {entry.title} in this Book</Button></div>)}
    </Disclosure>}
    {actionsId && currentData?.book.worldId && (!transferCheck || transferCheck.id !== actionsId || transferCheck.data !== currentData) && <p role="status">Checking transfer trigger conflicts…</p>}
    {transferCheck && transferCheck.id === actionsId && transferCheck.data === currentData && transferCheck.error && <p role="alert">Could not check trigger conflicts: {transferCheck.error}</p>}
    {busy && <p role="status">Working…</p>}{(error || loadError) && <p role="alert">{error || loadError}</p>}{saveError && <p role="status">View preferences could not be saved on this device.</p>}
    {conflictDialog && <TriggerConflictsDialog title={conflictDialog.title} conflicts={conflictDialog.conflicts} onClose={() => setConflictDialog(undefined)} />}
  </section>
}

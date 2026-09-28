import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, ChevronRight, LayoutGrid, List, Search } from 'lucide-react'
import CodexActionsMenu, { type CodexAction } from './CodexActionsMenu'
import { CodexThumbnail } from './CodexIllustration'
import { useLoreTypes } from './LoreTypesControls'
import { SeriesSourceEditor } from './SeriesCodexControls'
import { codexScopeLabel } from './series-codex'
import { setSeriesEntryHidden } from './series-codex-service'
import { regenerateEntitySummary } from '../writing/summary-generation'
import { readTimelineWorld } from './codex-timeline-service'
import { checkpointPlaced, type TimelineWorld } from './codex-timeline'
import { CODEX_PAGE_SIZE, dashboardPreferences, defaultCodexDashboard, queryCodexDashboard, type CodexDashboardPreferences } from './codex-dashboard'
import { proseText } from '../editor/document-projection'
import type { CodexDependencyEdge, CodexEntryEntity } from '../../data/persistence'
import type { SummaryState } from '../writing/summary-service'
import Button from '../../shared/ui/Button'
import Input from '../../shared/ui/Input'
import SegmentedControl from '../../shared/ui/SegmentedControl'
import Select from '../../shared/ui/Select'
import './codex-ui-kit.css'

function Thumbnail({ entry }: { entry: CodexEntryEntity }) {
  const ref = useRef<HTMLSpanElement>(null), [visible, setVisible] = useState(false)
  useEffect(() => { if (!ref.current || !entry.primaryImageId) return; if (typeof IntersectionObserver === 'undefined') { setVisible(true); return } const observer = new IntersectionObserver(items => { if (items.some(item => item.isIntersecting)) { setVisible(true); observer.disconnect() } }, { rootMargin: '100px' }); observer.observe(ref.current); return () => observer.disconnect() }, [entry.id, entry.primaryImageId])
  return entry.primaryImageId ? <span ref={ref} className="codex-dashboard-thumbnail">{visible && <CodexThumbnail entryId={entry.id} title={entry.title} />}</span> : null
}
export default function CodexDashboard({ bookId, entries, activeId, summaryStates, dependencies = [], onCreate, onOpen, onOpenSummary, onAutotitle, onRename, onArchive, onRestore, onDelete, onBeforeChange, onRefresh }: {
  bookId: string; entries: CodexEntryEntity[]; activeId: string | null; summaryStates: Record<string, SummaryState>; dependencies?: CodexDependencyEdge[]
  onCreate: () => void; onOpen: (id: string) => void; onOpenSummary: (entry: CodexEntryEntity) => void; onAutotitle: (entry: CodexEntryEntity) => void; onRename: (entry: CodexEntryEntity) => void; onArchive: (entry: CodexEntryEntity) => void; onRestore: (entry: CodexEntryEntity) => void; onDelete: (entry: CodexEntryEntity) => void; onBeforeChange: () => Promise<void>; onRefresh: () => Promise<void>
}) {
  const key = `arc-codex-dashboard-${bookId}`
  const [prefs, setPrefs] = useState(() => { try { return dashboardPreferences(JSON.parse(localStorage.getItem(key) ?? 'null')) } catch { return { ...defaultCodexDashboard } } })
  const [page, setPage] = useState(0), [error, setError] = useState(''), [saveError, setSaveError] = useState(false), [busy, setBusy] = useState(''), [sourceId, setSourceId] = useState(''), [world, setWorld] = useState<TimelineWorld>()
  const [actionsId, setActionsId] = useState<string | null>(null)
  const closeActions = useCallback(() => setActionsId(null), [])
  const controller = useRef<AbortController | null>(null), { types } = useLoreTypes(bookId)
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(prefs)); setSaveError(false) } catch { setSaveError(true) } }, [key, prefs])
  useEffect(() => { let current = true; if (entries.some(entry => entry.checkpoints?.length)) void readTimelineWorld(bookId).then(world => { if (current) setWorld(world) }).catch(() => {}); return () => { current = false } }, [bookId, entries])
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(closeActions, [bookId, page, prefs, closeActions])
  const update = (patch: Partial<CodexDashboardPreferences>) => { setPrefs(value => ({ ...value, ...patch })); if (Object.keys(patch).some(key => key !== 'view')) setPage(0) }
  const filtered = useMemo(() => queryCodexDashboard(entries, prefs, summaryStates), [entries, prefs, summaryStates])
  const pages = Math.max(1, Math.ceil(filtered.length / CODEX_PAGE_SIZE)), currentPage = Math.min(page, pages - 1), visible = filtered.slice(currentPage * CODEX_PAGE_SIZE, (currentPage + 1) * CODEX_PAGE_SIZE)
  const entryIds = useMemo(() => new Set(entries.map(entry => entry.id)), [entries])
  const run = async (id: string, action: () => Promise<void>) => { if (busy) return; setBusy(id); setError(''); try { await onBeforeChange(); await action(); await onRefresh() } catch (reason) { setError((reason as Error).message) } finally { controller.current = null; setBusy('') } }
  return <section className="codex-dashboard" aria-label="Codex browser">
    <div className="panel-title"><div><small>Book knowledge</small><h2>{prefs.archived ? 'Codex archive' : 'Codex'}</h2></div>{!prefs.archived && <Button size="small" leadingIcon={<Plus />} onClick={onCreate}>New</Button>}</div>
    <div className="codex-view-controls"><SegmentedControl label="Codex view" value={prefs.view} options={[{ value: 'list', label: 'List', icon: <List /> }, { value: 'cards', label: 'Cards', icon: <LayoutGrid /> }]} onChange={view => update({ view })} /><Select className="codex-archive-mode" aria-label="Codex archive mode" value={prefs.archived ? 'archived' : 'active'} onChange={e => update({ archived: e.target.value === 'archived' })}><option value="active">Active</option><option value="archived">Archived</option></Select></div>
    <Input className="codex-dashboard-search" type="search" aria-label="Search Codex" value={prefs.query} onChange={e => update({ query: e.target.value })} placeholder="Search title, type, or prose" leadingIcon={<Search />} />
    <details className="codex-dashboard-filters"><summary>Filters and sort</summary><div><Select label="Type" value={prefs.typeId} onChange={e => update({ typeId: e.target.value })}><option value="">All types</option>{types.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}{prefs.typeId && !types.some(type => type.id === prefs.typeId) && <option value={prefs.typeId}>Unavailable type</option>}</Select><Select label="Scope" value={prefs.scope} onChange={e => update({ scope: e.target.value as CodexDashboardPreferences['scope'] })}>{[['all','All scopes'],['book','Book-only'],['inherited','Inherited'],['override','Book override']].map(([id,label]) => <option key={id} value={id}>{label}</option>)}</Select><Select label="Summary" value={prefs.summary} onChange={e => update({ summary: e.target.value as CodexDashboardPreferences['summary'] })}>{['all','missing','current','outdated'].map(id => <option key={id} value={id}>{id === 'all' ? 'Any summary state' : id}</option>)}</Select><Select label="Triggers" value={prefs.triggers} onChange={e => update({ triggers: e.target.value as CodexDashboardPreferences['triggers'] })}><option value="all">Any</option><option value="yes">With triggers</option><option value="no">Without triggers</option></Select><Select label="Sort" aria-label="Codex sort" value={prefs.sort} onChange={e => update({ sort: e.target.value as CodexDashboardPreferences['sort'] })}><option value="title">Title A–Z</option><option value="edited">Recently edited</option><option value="type">Type, then title</option></Select></div><Button size="small" variant="ghost" onClick={() => update({ ...defaultCodexDashboard, view: prefs.view })}>Clear filters</Button></details>
    <p className="codex-results-count" role="status">{filtered.length} entries · Page {currentPage + 1} of {pages}</p>
    <div className={`codex-dashboard-results ${prefs.view}`}>
      {visible.map(entry => {
        const summary = summaryStates[entry.id] ?? 'missing', inherited = entry.codexScope === 'inherited', shared = Boolean(entry.seriesSourceId)
        const unplaced = world ? (entry.checkpoints ?? []).filter(point => !checkpointPlaced(point, world)).length : 0
        const broken = dependencies.filter(edge => edge.sourceId === entry.id && !entryIds.has(edge.targetId)).length
        const actions: CodexAction[] = []
        const addAction = (label: string, onSelect: () => void) => actions.push({ label, onSelect, disabled: Boolean(busy) })
        if (!prefs.archived) {
          addAction(inherited ? 'Rename for this book' : 'Rename', () => onRename(entry))
          addAction(`Autotitle${inherited ? ' for this book' : ''}`, () => onAutotitle(entry))
          addAction(`${summary === 'missing' ? 'Summarize' : 'Re-summarize'} baseline`, () => { void run(entry.id, async () => { controller.current = new AbortController(); await regenerateEntitySummary(bookId, entry.id, controller.current.signal) }) })
        }
        if (shared) {
          addAction('Edit series source', () => { void run(entry.id, async () => setSourceId(entry.seriesSourceId!)) })
          addAction('Hide in this book', () => { void run(entry.id, () => setSeriesEntryHidden(bookId, entry.id, true)) })
        }
        if (!inherited) {
          addAction(`${prefs.archived ? 'Restore' : 'Archive'}${shared ? ' for this book' : ''}`, () => prefs.archived ? onRestore(entry) : onArchive(entry))
          if (!shared) addAction('Delete', () => onDelete(entry))
        }
        return <article key={entry.id} className={`codex-dashboard-entry ${activeId === entry.id ? 'selected' : ''}`}>
          <button className="codex-dashboard-open" type="button" aria-current={activeId === entry.id ? 'true' : undefined} onClick={() => onOpen(entry.id)}><Thumbnail entry={entry} /><span><small>{entry.category}</small><strong>{entry.title}</strong><span className="codex-dashboard-preview">{proseText(entry.content).replace(/\s+/g, ' ').trim().slice(0, 240) || 'No body yet'}</span></span><ChevronRight aria-hidden="true" /></button>
          <div className="codex-row-indicators"><span>{codexScopeLabel(entry)}</span><span>{summary === 'current' ? 'Summary current' : summary === 'outdated' ? 'Summary stale' : 'No summary'}</span>{Boolean(unplaced || broken) && <strong>{unplaced + broken} unavailable references</strong>}</div>
          <div className="codex-row-bottom"><details><summary>Details</summary><p>{codexScopeLabel(entry)} · {summary} summary</p><p>{entry.autoIncludeTriggers?.length ?? 0} triggers · {dependencies.filter(edge => edge.sourceId === entry.id).length} relationships · {entry.checkpoints?.length ?? 0} checkpoints</p>{unplaced > 0 && <p className="codex-reference-error">{unplaced} unplaced checkpoints. Open the timeline to reassign anchors.</p>}{broken > 0 && <p className="codex-reference-error">{broken} unavailable relationship targets.</p>}<Button size="small" variant="ghost" onClick={() => onOpenSummary(entry)}>Open summary</Button></details>
          <CodexActionsMenu title={entry.title} open={actionsId === entry.id} onToggle={() => setActionsId(current => current === entry.id ? null : entry.id)} onClose={closeActions} actions={actions} /></div>
        </article>
      })}
    </div>
    {!visible.length && <p>No matching entries. Try clearing filters.</p>}
    {pages > 1 && <nav className="codex-pagination" aria-label="Codex pages"><Button size="small" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous page</Button><span>{currentPage + 1} / {pages}</span><Button size="small" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Next page</Button></nav>}
    {busy && <p role="status">Working… {controller.current && <Button size="small" variant="ghost" onClick={() => controller.current?.abort()}>Stop summary</Button>}</p>}{error && <p role="alert">{error}</p>}{saveError && <p role="status">View preferences could not be saved on this device.</p>}
    {sourceId && <SeriesSourceEditor bookId={bookId} sourceId={sourceId} onClose={() => { setSourceId(''); void onRefresh() }} />}
  </section>
}

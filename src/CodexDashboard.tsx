import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, MoreHorizontal, ChevronRight } from 'lucide-react'
import { CodexThumbnail } from './CodexIllustration'
import { useLoreTypes } from './LoreTypesControls'
import { SeriesSourceEditor } from './SeriesCodexControls'
import { codexScopeLabel } from './series-codex'
import { setSeriesEntryHidden } from './series-codex-service'
import { regenerateEntitySummary } from './summary-generation'
import { readTimelineWorld } from './codex-timeline-service'
import { checkpointPlaced, type TimelineWorld } from './codex-timeline'
import { CODEX_PAGE_SIZE, dashboardPreferences, defaultCodexDashboard, queryCodexDashboard, type CodexDashboardPreferences } from './codex-dashboard'
import { proseText } from './document-projection'
import type { CodexDependencyEdge, CodexEntryEntity } from './persistence'
import type { SummaryState } from './summary-service'

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
  const controller = useRef<AbortController | null>(null), { types } = useLoreTypes(bookId)
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(prefs)); setSaveError(false) } catch { setSaveError(true) } }, [key, prefs])
  useEffect(() => { let current = true; if (entries.some(entry => entry.checkpoints?.length)) void readTimelineWorld(bookId).then(world => { if (current) setWorld(world) }).catch(() => {}); return () => { current = false } }, [bookId, entries])
  useEffect(() => () => controller.current?.abort(), [])
  const update = (patch: Partial<CodexDashboardPreferences>) => { setPrefs(value => ({ ...value, ...patch })); if (Object.keys(patch).some(key => key !== 'view')) setPage(0) }
  const filtered = useMemo(() => queryCodexDashboard(entries, prefs, summaryStates), [entries, prefs, summaryStates])
  const pages = Math.max(1, Math.ceil(filtered.length / CODEX_PAGE_SIZE)), currentPage = Math.min(page, pages - 1), visible = filtered.slice(currentPage * CODEX_PAGE_SIZE, (currentPage + 1) * CODEX_PAGE_SIZE)
  const entryIds = useMemo(() => new Set(entries.map(entry => entry.id)), [entries])
  const run = async (id: string, action: () => Promise<void>) => { if (busy) return; setBusy(id); setError(''); try { await onBeforeChange(); await action(); await onRefresh() } catch (reason) { setError((reason as Error).message) } finally { controller.current = null; setBusy('') } }
  return <section className="codex-dashboard" aria-label="Codex browser">
    <div className="panel-title"><div><small>Book knowledge</small><h2>{prefs.archived ? 'Codex archive' : 'Codex'}</h2></div>{!prefs.archived && <button type="button" onClick={onCreate}><Plus aria-hidden="true" /> New</button>}</div>
    <div className="codex-view-controls"><div role="group" aria-label="Codex view"><button type="button" aria-pressed={prefs.view === 'list'} onClick={() => update({ view: 'list' })}>List</button><button type="button" aria-pressed={prefs.view === 'cards'} onClick={() => update({ view: 'cards' })}>Cards</button></div><select aria-label="Codex archive mode" value={prefs.archived ? 'archived' : 'active'} onChange={e => update({ archived: e.target.value === 'archived' })}><option value="active">Active</option><option value="archived">Archived</option></select></div>
    <input className="panel-search" type="search" aria-label="Search Codex" value={prefs.query} onChange={e => update({ query: e.target.value })} placeholder="Search title, type, or prose" />
    <details className="codex-dashboard-filters"><summary>Filters and sort</summary><div><label>Type<select value={prefs.typeId} onChange={e => update({ typeId: e.target.value })}><option value="">All types</option>{types.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}{prefs.typeId && !types.some(type => type.id === prefs.typeId) && <option value={prefs.typeId}>Unavailable type</option>}</select></label><label>Scope<select value={prefs.scope} onChange={e => update({ scope: e.target.value as CodexDashboardPreferences['scope'] })}>{[['all','All scopes'],['book','Book-only'],['inherited','Inherited'],['override','Book override']].map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>Summary<select value={prefs.summary} onChange={e => update({ summary: e.target.value as CodexDashboardPreferences['summary'] })}>{['all','missing','current','outdated'].map(id => <option key={id} value={id}>{id === 'all' ? 'Any summary state' : id}</option>)}</select></label><label>Triggers<select value={prefs.triggers} onChange={e => update({ triggers: e.target.value as CodexDashboardPreferences['triggers'] })}><option value="all">Any</option><option value="yes">With triggers</option><option value="no">Without triggers</option></select></label><label>Sort<select aria-label="Codex sort" value={prefs.sort} onChange={e => update({ sort: e.target.value as CodexDashboardPreferences['sort'] })}><option value="title">Title A–Z</option><option value="edited">Recently edited</option><option value="type">Type, then title</option></select></label></div><button type="button" onClick={() => update({ ...defaultCodexDashboard, view: prefs.view })}>Clear filters</button></details>
    <p className="codex-results-count" role="status">{filtered.length} entries · Page {currentPage + 1} of {pages}</p>
    <div className={`codex-dashboard-results ${prefs.view}`}>
      {visible.map(entry => {
        const summary = summaryStates[entry.id] ?? 'missing', inherited = entry.codexScope === 'inherited', shared = Boolean(entry.seriesSourceId)
        const unplaced = world ? (entry.checkpoints ?? []).filter(point => !checkpointPlaced(point, world)).length : 0
        const broken = dependencies.filter(edge => edge.sourceId === entry.id && !entryIds.has(edge.targetId)).length
        return <article key={entry.id} className={`codex-dashboard-entry ${activeId === entry.id ? 'selected' : ''}`}>
          <button className="codex-dashboard-open" type="button" aria-current={activeId === entry.id ? 'true' : undefined} onClick={() => onOpen(entry.id)}><Thumbnail entry={entry} /><span><small>{entry.category}</small><strong>{entry.title}</strong><span className="codex-dashboard-preview">{proseText(entry.content).replace(/\s+/g, ' ').trim().slice(0, 240) || 'No body yet'}</span></span><ChevronRight aria-hidden="true" /></button>
          <div className="codex-row-indicators"><span>{codexScopeLabel(entry)}</span><span>{summary === 'current' ? 'Summary current' : summary === 'outdated' ? 'Summary stale' : 'No summary'}</span>{Boolean(unplaced || broken) && <strong>{unplaced + broken} unavailable references</strong>}</div>
          <div className="codex-row-bottom"><details><summary>Details</summary><p>{codexScopeLabel(entry)} · {summary} summary</p><p>{entry.autoIncludeTriggers?.length ?? 0} triggers · {dependencies.filter(edge => edge.sourceId === entry.id).length} relationships · {entry.checkpoints?.length ?? 0} checkpoints</p>{unplaced > 0 && <p className="codex-reference-error">{unplaced} unplaced checkpoints. Open the timeline to reassign anchors.</p>}{broken > 0 && <p className="codex-reference-error">{broken} unavailable relationship targets.</p>}<button type="button" onClick={() => onOpenSummary(entry)}>Open summary</button></details>
          <details className="codex-row-menu"><summary aria-label={`Actions for ${entry.title}`}><MoreHorizontal aria-hidden="true" /><span>Actions</span></summary><div>
            {!prefs.archived && <><button type="button" disabled={Boolean(busy)} onClick={() => onRename(entry)}>{inherited ? 'Rename for this book' : 'Rename'}</button><button type="button" disabled={Boolean(busy)} onClick={() => onAutotitle(entry)}>Autotitle{inherited ? ' for this book' : ''}</button><button type="button" disabled={Boolean(busy)} onClick={() => { void run(entry.id, async () => { controller.current = new AbortController(); await regenerateEntitySummary(bookId, entry.id, controller.current.signal) }) }}>{summary === 'missing' ? 'Summarize' : 'Re-summarize'} baseline</button></>}
            {shared && <><button type="button" disabled={Boolean(busy)} onClick={() => { void run(entry.id, async () => setSourceId(entry.seriesSourceId!)) }}>Edit series source</button><button type="button" disabled={Boolean(busy)} onClick={() => { void run(entry.id, () => setSeriesEntryHidden(bookId, entry.id, true)) }}>Hide in this book</button></>}
            {!inherited && <><button type="button" disabled={Boolean(busy)} onClick={() => prefs.archived ? onRestore(entry) : onArchive(entry)}>{prefs.archived ? 'Restore' : 'Archive'}{shared ? ' for this book' : ''}</button>{!shared && <button type="button" disabled={Boolean(busy)} onClick={() => onDelete(entry)}>Delete</button>}</>}
          </div></details></div>
        </article>
      })}
    </div>
    {!visible.length && <p>No matching entries. Try clearing filters.</p>}
    {pages > 1 && <nav className="codex-pagination" aria-label="Codex pages"><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous page</button><span>{currentPage + 1} / {pages}</span><button type="button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Next page</button></nav>}
    {busy && <p role="status">Working… {controller.current && <button type="button" onClick={() => controller.current?.abort()}>Stop summary</button>}</p>}{error && <p role="alert">{error}</p>}{saveError && <p role="status">View preferences could not be saved on this device.</p>}
    {sourceId && <SeriesSourceEditor bookId={bookId} sourceId={sourceId} onClose={() => { setSourceId(''); void onRefresh() }} />}
  </section>
}

import { useState } from 'react'
import { isCodexEntryArchived, type ArcEntity, type GenerationContextProfile } from './persistence'
import type { ContextDiagnostics, PreparedContextValues } from './context-service'
import type { DynamicContextSource, NormalizedAssembledRequest } from './prompt-composition'
import { orderedContextScenes, structuralSelectionIds } from './context-source-selection'

type SelectionKey = 'structuralIds' | 'noteIds' | 'codexEntryIds'
export function ContextSourcePicker({ sources, currentDocumentId, anchorId, profile, onToggle, onClear }: {
  sources: ArcEntity[]; currentDocumentId?: string; anchorId?: string; profile: GenerationContextProfile
  onToggle: (key: SelectionKey, id: string) => void; onClear: () => void
}) {
  const [query, setQuery] = useState('')
  const [selectedOnly, setSelectedOnly] = useState(false)
  const selected = [...profile.structuralIds, ...profile.noteIds, ...profile.codexEntryIds]
  const effective = structuralSelectionIds(sources, profile.structuralIds)
  const sceneOrder = orderedContextScenes(sources).map(item => item.id)
  const anchorIndex = anchorId ? sceneOrder.indexOf(anchorId) : -1
  const laterSelected = anchorIndex >= 0 && sceneOrder.slice(anchorIndex + 1).some(id => effective.has(id))
  const available = sources.filter(item => ['act', 'chapter', 'scene', 'note', 'codexEntry'].includes(item.type) && item.id !== currentDocumentId && !(item.type === 'codexEntry' && isCodexEntryArchived(item)))
  const normalized = query.trim().toLowerCase()
  const matches = (item: ArcEntity) => (!normalized || `${item.title} ${item.type} ${item.category ?? ''}`.toLowerCase().includes(normalized)) && (!selectedOnly || selected.includes(item.id) || effective.has(item.id))
  const children = (id: string) => available.filter(item => item.parentId === id).sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
  const hasMatch = (item: ArcEntity, seen = new Set<string>()): boolean => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return matches(item) || children(item.id).some(child => hasMatch(child, seen))
  }
  const row = (item: ArcEntity) => {
    const key: SelectionKey = item.type === 'note' ? 'noteIds' : item.type === 'codexEntry' ? 'codexEntryIds' : 'structuralIds'
    const inherited = effective.has(item.id) && !profile.structuralIds.includes(item.id)
    const later = anchorIndex >= 0 && sceneOrder.indexOf(item.id) > anchorIndex
    return <label className="context-selection-row"><input type="checkbox" checked={profile[key].includes(item.id) || inherited} disabled={inherited} onChange={() => onToggle(key, item.id)} /><span><strong>{item.title || 'Untitled'}</strong><small>{item.type === 'act' || item.type === 'chapter' ? 'Includes descendant scenes in full; automatic sources are deduplicated' : item.type === 'codexEntry' ? 'Uses this entry’s full-text / summary preference' : 'Full text'}{inherited ? ' · Selected through a parent; deselect the parent to change' : ''}{later ? ' · Later than reference scene' : ''}</small></span></label>
  }
  const branch = (item: ArcEntity, ancestors: string[] = []): React.ReactNode => {
    if (ancestors.includes(item.id) || !hasMatch(item)) return null
    const descendants = children(item.id)
    if (item.type === 'scene') return <div key={item.id}>{row(item)}</div>
    return <details key={`${item.id}-${Boolean(normalized || selectedOnly)}`} className="context-tree-branch" open={normalized || selectedOnly ? true : undefined}><summary>{item.title || 'Untitled'} <small>{item.type} · {descendants.length} children</small></summary>{row(item)}<div className="context-tree-children">{descendants.map(child => branch(child, [...ancestors, item.id]))}</div></details>
  }
  const structuralIds = new Set(available.filter(item => ['act', 'chapter', 'scene'].includes(item.type)).map(item => item.id))
  const roots = available.filter(item => structuralIds.has(item.id) && !structuralIds.has(item.parentId ?? '')).sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
  return <div className="context-picker">
    <div className="context-picker-toolbar"><label className="context-search-label"><span>Find sources</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search titles, types, or categories" /></label><label className="context-selected-filter"><input type="checkbox" checked={selectedOnly} onChange={event => setSelectedOnly(event.target.checked)} /><span>Selected only</span></label><button type="button" disabled={!selected.length} onClick={onClear}>Clear source selections</button></div>
    <p className="context-help">{selected.length} explicit selections · {sceneOrder.filter(id => effective.has(id) && id !== currentDocumentId).length} scenes selected directly or through a parent. Clearing selections keeps automatic context and the summary range.</p>
    {laterSelected && <p className="context-caution" role="status">Selected sources include scenes later than “{sources.find(item => item.id === anchorId)?.title}”. These may reveal later story events.</p>}
    <div className="context-source-tree"><h3>Manuscript</h3>{roots.map(item => branch(item))}{(['note', 'codexEntry'] as const).map(type => <section key={type}><h3>{type === 'note' ? 'Notes' : 'Codex'}</h3>{available.filter(item => item.type === type && matches(item)).map(item => <div key={item.id}>{row(item)}</div>)}</section>)}{!available.some(matches) && <p>No matching sources.</p>}</div>
  </div>
}

export function ContextBudget({ diagnostics, model, pending, error }: { diagnostics: ContextDiagnostics | null; model?: string; pending: boolean; error?: string }) {
  return <section className={`context-budget-summary ${error || diagnostics && (!diagnostics.fits || !diagnostics.limitValid) ? 'error' : ''}`} role="status" aria-live="polite" aria-busy={pending}>
    <strong>{pending ? 'Updating preview…' : error ? 'Preview needs attention' : !model ? 'Choose a model to estimate the budget' : !diagnostics ? 'Budget unavailable' : !diagnostics.limitValid ? 'Invalid context limit' : diagnostics.fits ? diagnostics.warning ? 'Near the context limit' : 'Context fits the estimated budget' : 'Over the context limit · Generation blocked'}</strong>
    <span>{model || 'No model selected'}</span>{error && <p>{error}</p>}
    {!pending && diagnostics && <><progress aria-label="Estimated context budget used" max={100} value={Math.min(100, Math.round(diagnostics.usageRatio * 100))} /><span>{diagnostics.requestTokens.toLocaleString()} estimated input tokens / {diagnostics.usableInputTokens.toLocaleString()} usable · {Math.round(diagnostics.usageRatio * 100)}%</span><small>{diagnostics.responseReserveTokens.toLocaleString()} tokens reserved for the response. {diagnostics.modelContextKnown ? 'Catalog model limit.' : 'Model limit is estimated.'} Preview excludes any new instruction you enter after opening settings.</small>{!diagnostics.fits && <small>Remove optional sources or use summaries. Context is never silently trimmed.</small>}{diagnostics.limitError && <small>{diagnostics.limitError}</small>}</>}
  </section>
}

export function ContextSourceInventory({ preview, request, sources, pending }: { preview: PreparedContextValues | null; request: NormalizedAssembledRequest | null; sources: ArcEntity[]; pending: boolean }) {
  const sentSources = request?.parts.filter(part => !part.omitted).flatMap(part => part.dynamicVariables?.flatMap(variable => variable.sources) ?? []) ?? []
  const sentIds = new Set(sentSources.map(item => item.sourceId))
  const automatic: DynamicContextSource[] = [
    ...(preview?.currentSceneId ? [{ sourceId: preview.currentSceneId, title: preview.currentSceneTitle, content: preview.currentSceneText, representation: 'Full text', reason: 'Reference scene; available through scene variables' }] : []),
    ...(preview?.previousSceneText ? [{ sourceId: preview.previousSceneId, title: preview.previousSceneTitle, content: preview.previousSceneText, representation: 'Full text', reason: 'Previous scene because the reference scene is empty' }] : []),
    ...(preview?.storySoFarSources ?? []), ...(preview?.automaticSources ?? []),
    ...sentSources.filter(item => item.representation === 'Authoritative target'),
  ]
  const renderRows = (items: DynamicContextSource[]) => [...new Map(items.map(item => [item.sourceId, item])).values()].map(item => {
    const entity = sources.find(source => source.id === item.sourceId)
    const representation = entity?.type === 'summary' ? 'Summary' : sentSources.find(source => source.sourceId === item.sourceId)?.representation || preview?.codexRepresentations.find(entry => entry.entryId === item.sourceId)?.representation || item.representation || 'Full text'
    return <article className="context-source-row" key={item.sourceId}><strong>{entity?.title || item.title || 'Untitled'}</strong><span>{representation === 'Full' || representation === 'Selected' ? (entity?.type === 'codexEntry' ? 'Full entry' : 'Full text') : representation} · {sentIds.has(item.sourceId) ? 'Included in request' : item.content.trim() ? 'Available · not used by this prompt' : 'Empty · not included'}</span><small>{item.reason}</small>{preview?.codexRepresentations.find(entry => entry.entryId === item.sourceId)?.fallbackReason && <small>{preview.codexRepresentations.find(entry => entry.entryId === item.sourceId)?.fallbackReason} · Full entry used</small>}</article>
  })
  return <section className="settings-card context-inventory" aria-busy={pending}><h2>Included sources</h2><p className="context-help">Selections make material available to prompt variables. Only sources referenced by the rendered prompt are sent. Book metadata and the current target are configured by the prompt; inspect the request for their exact text.</p>{pending ? <p role="status">Updating sources…</p> : preview ? <><h3>Automatic sources</h3>{renderRows(automatic)}{!automatic.length && <p>No automatic sources available.</p>}<h3>Additional sources</h3>{renderRows(preview.additionalSources ?? [])}{!preview.additionalSources?.length && <p>No additional sources available.</p>}{request?.dynamicSourceDedupe.map(item => <p className="context-help" key={item.sourceId}>{item.omittedAdditional.title || item.sourceId} · Already included automatically; additional copy omitted.</p>)}{request?.dynamicSourceExclusions.map((item, index) => <p className="context-help" key={`${item.sourceId}-${index}`}>{item.omitted.title || item.sourceId} · Current target; excluded from additional context.</p>)}</> : <p>Sources are unavailable until the preview can be prepared.</p>}</section>
}

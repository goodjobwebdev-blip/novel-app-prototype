from pathlib import Path


def replace(path: str, old: str, new: str):
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f"Missing expected block in {path}: {old[:160]!r}")
    file.write_text(text.replace(old, new, 1))


# Persistence: Codex summaries reuse the existing SummaryEntity and keep source freshness
# independent from archive/context-policy state.
replace(
    'src/persistence.ts',
    "export type StructuralEntityType = 'act' | 'chapter' | 'scene'",
    "export type StructuralEntityType = 'act' | 'chapter' | 'scene'\nexport type SummarySourceType = StructuralEntityType | 'codexEntry'",
)
replace(
    'src/persistence.ts',
    "export type CodexEntryEntity = ArcEntity & { type: 'codexEntry'; bookId: string; parentId: string; title: string; category: string; content: string; archivedAt?: number }",
    "export type CodexEntryEntity = ArcEntity & { type: 'codexEntry'; bookId: string; parentId: string; title: string; category: string; content: string; archivedAt?: number; preferSummaryForContext?: boolean; sourceRevision?: number }",
)
replace(
    'src/persistence.ts',
    "  sourceType: StructuralEntityType",
    "  sourceType: SummarySourceType",
)
replace(
    'src/persistence.ts',
    """  const entry: CodexEntryEntity = { id: makeId('codex'), type: 'codexEntry', bookId, parentId: bookId, title, category, content: '', createdAt: now, updatedAt: now }""",
    """  const entry: CodexEntryEntity = { id: makeId('codex'), type: 'codexEntry', bookId, parentId: bookId, title, category, content: '', preferSummaryForContext: false, sourceRevision: now, createdAt: now, updatedAt: now }""",
)
replace(
    'src/persistence.ts',
    "export async function getOrCreateSummary(source: StructuralEntity): Promise<SummaryEntity> {",
    "export async function getOrCreateSummary(source: StructuralEntity | CodexEntryEntity): Promise<SummaryEntity> {",
)
replace(
    'src/persistence.ts',
    """export async function updateCodexCategory(id: string, category: string): Promise<CodexEntryEntity> {
  const db = await database()
  const current = await db.table('entities').get(id) as CodexEntryEntity | undefined
  if (!current || current.type !== 'codexEntry') throw new Error(`Cannot update missing Codex entry ${id}`)
  const updated: CodexEntryEntity = { ...current, category: category.trim() || 'Other', updatedAt: Date.now() }
  await db.transaction('rw', db.table('entities'), async () => {
    await db.table('entities').put(updated)
    await touchAncestors(db, current.bookId, updated.updatedAt)
  })
  return updated
}""",
    """export async function updateCodexCategory(id: string, category: string): Promise<CodexEntryEntity> {
  const db = await database()
  const current = await db.table('entities').get(id) as CodexEntryEntity | undefined
  if (!current || current.type !== 'codexEntry') throw new Error(`Cannot update missing Codex entry ${id}`)
  const now = Date.now()
  const updated: CodexEntryEntity = { ...current, category: category.trim() || 'Other', sourceRevision: now, updatedAt: now }
  await db.transaction('rw', db.table('entities'), async () => {
    await db.table('entities').put(updated)
    await touchAncestors(db, current.bookId, now)
  })
  return updated
}

export async function updateCodexSummaryPreference(id: string, preferSummaryForContext: boolean): Promise<CodexEntryEntity> {
  const db = await database()
  const current = await db.table('entities').get(id) as CodexEntryEntity | undefined
  if (!current || current.type !== 'codexEntry') throw new Error(`Cannot update missing Codex entry ${id}`)
  const updated: CodexEntryEntity = { ...current, preferSummaryForContext }
  await db.transaction('rw', db.table('entities'), async () => {
    await db.table('entities').put(updated)
    await touchAncestors(db, current.bookId, Date.now())
  })
  return updated
}""",
)
replace(
    'src/persistence.ts',
    """  const updated = { ...entity, title: title.trim() || entity.title || 'Untitled', updatedAt: Date.now() }""",
    """  const now = Date.now()
  const updated = { ...entity, title: title.trim() || entity.title || 'Untitled', updatedAt: now, ...(entity.type === 'codexEntry' ? { sourceRevision: now } : {}) }""",
)
replace(
    'src/persistence.ts',
    """  const now = Date.now()
  const updated = { ...current, content, updatedAt: now }""",
    """  const now = Date.now()
  const updated = { ...current, content, updatedAt: now, ...(current.type === 'codexEntry' ? { sourceRevision: now } : {}) }""",
)

# Summary service: one coherent service for structural and Codex sources.
Path('src/summary-service.ts').write_text(r'''import {
  getEntity,
  listEntitiesByBook,
  type ArcEntity,
  type CodexEntryEntity,
  type StructuralEntity,
  type StructuralEntityType,
  type SummaryEntity,
  type SummarySourceType,
} from './persistence'
import { bookTemplateValues, renderPromptTemplate, type BookPromptValues } from './prompt-template'

export type SummaryState = 'missing' | 'current' | 'outdated'
export type SummarySourceEntity = StructuralEntity | CodexEntryEntity

export type SummarySource = {
  source: SummarySourceEntity
  content: string
  sourceRevision: number
}

export type CodexContextRepresentation = {
  entryId: string
  title: string
  representation: 'Full entry' | 'Summary'
  fallbackReason?: 'summary missing' | 'summary outdated'
  content: string
}

function isStructural(entity: ArcEntity): entity is StructuralEntity {
  return entity.type === 'scene' || entity.type === 'chapter' || entity.type === 'act'
}

function isSummarySource(entity: ArcEntity): entity is SummarySourceEntity {
  return isStructural(entity) || entity.type === 'codexEntry'
}

function isSummary(entity: ArcEntity): entity is SummaryEntity {
  return entity.type === 'summary'
}

function sortedChildren(entities: ArcEntity[], parentId: string, type: StructuralEntityType) {
  return entities
    .filter((entity): entity is StructuralEntity => entity.parentId === parentId && entity.type === type)
    .sort((left, right) => left.order - right.order)
}

function summariesBySource(entities: ArcEntity[]) {
  return new Map(entities.filter(isSummary).map((summary) => [summary.sourceEntityId, summary]))
}

function sourceRevision(source: SummarySourceEntity, entities: ArcEntity[], summaries: Map<string, SummaryEntity>): number {
  if (source.type === 'codexEntry') return typeof source.sourceRevision === 'number' ? source.sourceRevision : source.updatedAt
  if (source.type === 'scene') return source.updatedAt

  const chapters = source.type === 'act' ? sortedChildren(entities, source.id, 'chapter') : [source]
  const relevant: number[] = [source.updatedAt]
  for (const chapter of chapters) {
    relevant.push(chapter.updatedAt)
    const chapterSummary = summaries.get(chapter.id)
    if (source.type === 'act' && chapterSummary?.content.trim()) relevant.push(chapterSummary.updatedAt)
    for (const scene of sortedChildren(entities, chapter.id, 'scene')) {
      relevant.push(scene.updatedAt)
      const sceneSummary = summaries.get(scene.id)
      if (sceneSummary?.content.trim()) relevant.push(sceneSummary.updatedAt)
    }
  }
  return Math.max(...relevant)
}

function stateFor(source: SummarySourceEntity, summary: SummaryEntity | undefined, entities: ArcEntity[], summaries: Map<string, SummaryEntity>): SummaryState {
  if (!summary?.content.trim()) return 'missing'
  return (summary.summarizedSourceRevision ?? 0) >= sourceRevision(source, entities, summaries) ? 'current' : 'outdated'
}

export function summaryStateForSource(source: SummarySourceEntity, entities: ArcEntity[]): SummaryState {
  const summaries = summariesBySource(entities)
  return stateFor(source, summaries.get(source.id), entities, summaries)
}

export async function getSummaryStateMap(bookId: string): Promise<Record<string, SummaryState>> {
  const entities = await listEntitiesByBook(bookId)
  const summaries = summariesBySource(entities)
  return Object.fromEntries(
    entities
      .filter(isSummarySource)
      .map((source) => [source.id, stateFor(source, summaries.get(source.id), entities, summaries)]),
  )
}

function sceneSource(scene: StructuralEntity, summary: SummaryEntity | undefined, state: SummaryState) {
  const content = state === 'current' && summary?.content.trim() ? summary.content.trim() : String(scene.content ?? '').trim()
  return `## Scene: ${scene.title}\n\n${content || '_No content_'}`
}

function chapterSource(chapter: StructuralEntity, entities: ArcEntity[], summaries: Map<string, SummaryEntity>) {
  const scenes = sortedChildren(entities, chapter.id, 'scene')
  return [
    `# Chapter: ${chapter.title}`,
    ...scenes.map((scene) => sceneSource(scene, summaries.get(scene.id), stateFor(scene, summaries.get(scene.id), entities, summaries))),
  ].join('\n\n')
}

export async function buildSummarySource(sourceId: string): Promise<SummarySource> {
  const source = await getEntity<ArcEntity>(sourceId)
  if (!source || !isSummarySource(source)) throw new Error('The summary source is no longer available.')
  const entities = await listEntitiesByBook(source.bookId)
  const summaries = summariesBySource(entities)
  let content: string

  if (source.type === 'codexEntry') {
    content = `# Codex entry: ${source.title}\n\nCategory: ${source.category}\n\n${String(source.content ?? '').trim() || '_No content_'}`
  } else if (source.type === 'scene') {
    content = `# Scene: ${source.title}\n\n${String(source.content ?? '').trim() || '_No content_'}`
  } else if (source.type === 'chapter') {
    content = chapterSource(source, entities, summaries)
  } else {
    const chapters = sortedChildren(entities, source.id, 'chapter')
    content = [
      `# Act: ${source.title}`,
      ...chapters.map((chapter) => {
        const summary = summaries.get(chapter.id)
        return stateFor(chapter, summary, entities, summaries) === 'current' && summary?.content.trim()
          ? `## Chapter: ${chapter.title}\n\n${summary.content.trim()}`
          : chapterSource(chapter, entities, summaries)
      }),
    ].join('\n\n')
  }

  return { source, content, sourceRevision: sourceRevision(source, entities, summaries) }
}

export function codexContextRepresentation(entry: CodexEntryEntity, entities: ArcEntity[]): CodexContextRepresentation {
  const summaries = summariesBySource(entities)
  const summary = summaries.get(entry.id)
  const state = stateFor(entry, summary, entities, summaries)
  if (entry.preferSummaryForContext === true && state === 'current' && summary?.content.trim()) {
    return { entryId: entry.id, title: entry.title, representation: 'Summary', content: summary.content.trim() }
  }
  const fallbackReason = entry.preferSummaryForContext === true
    ? state === 'missing' ? 'summary missing' : state === 'outdated' ? 'summary outdated' : undefined
    : undefined
  return {
    entryId: entry.id,
    title: entry.title,
    representation: 'Full entry',
    ...(fallbackReason ? { fallbackReason } : {}),
    content: String(entry.content ?? '').trim() || '_No description provided._',
  }
}

export function renderSummaryPrompt(template: string, targetType: SummarySourceType, previousSummary: string, book: BookPromptValues) {
  const values: Record<string, string> = {
    ...bookTemplateValues(book),
    'target.type': targetType,
    'target.previous_summary': previousSummary,
  }
  return renderPromptTemplate(template, values)
}
''')

# Shared context assembly honors explicit per-entry representation and exposes diagnostics.
replace(
    'src/context-service.ts',
    "import { isCodexEntryArchived, listEntitiesByBook, type ArcEntity, type GenerationContextProfile, type GenerationContextType, type StructuralEntity, type SummaryEntity } from './persistence'",
    "import { isCodexEntryArchived, listEntitiesByBook, type ArcEntity, type CodexEntryEntity, type GenerationContextProfile, type GenerationContextType, type StructuralEntity, type SummaryEntity } from './persistence'\nimport { codexContextRepresentation, type CodexContextRepresentation } from './summary-service'",
)
replace(
    'src/context-service.ts',
    """  additionalContext: string
}""",
    """  additionalContext: string
  codexRepresentations: CodexContextRepresentation[]
}""",
)
replace(
    'src/context-service.ts',
    """  const codex: AdditionalContextSection[] = entities.filter((item) => item.type === 'codexEntry' && !isCodexEntryArchived(item) && item.id !== options.currentDocumentId && options.profile.codexEntryIds.includes(item.id))
    .map((item) => ({
      text: section(`Codex — ${String(item.category ?? 'Other')}: ${item.title ?? 'Untitled'}`, String(item.content ?? '').trim() || '_No description provided._'),
      id: item.id,
      updatedAt: item.updatedAt,
      stabilityRank: 1,
      typeRank: 0,
      outlineIndex: Number.MAX_SAFE_INTEGER,
    }))""",
    """  const selectedCodex = entities.filter((item): item is CodexEntryEntity => item.type === 'codexEntry' && !isCodexEntryArchived(item) && item.id !== options.currentDocumentId && options.profile.codexEntryIds.includes(item.id))
  const codexRepresentations = selectedCodex.map((item) => codexContextRepresentation(item, entities))
  const codex: AdditionalContextSection[] = selectedCodex.map((item) => {
    const representation = codexRepresentations.find((candidate) => candidate.entryId === item.id)!
    return {
      text: section(`Codex — ${String(item.category ?? 'Other')}: ${item.title ?? 'Untitled'}`, representation.content),
      id: item.id,
      updatedAt: item.updatedAt,
      stabilityRank: 1,
      typeRank: 0,
      outlineIndex: Number.MAX_SAFE_INTEGER,
    }
  })""",
)
replace(
    'src/context-service.ts',
    """    additionalContext: [...fullSections, ...summarySections, ...notes, ...codex].sort(additionalContextOrder).map((item) => item.text).join('\n\n'),
  }""",
    """    additionalContext: [...fullSections, ...summarySections, ...notes, ...codex].sort(additionalContextOrder).map((item) => item.text).join('\n\n'),
    codexRepresentations,
  }""",
)

# Context Management request preview explains the exact Codex representation/fallback.
replace(
    'src/App.tsx',
    "import './codex-archive.css'",
    "import './codex-archive.css'\nimport './codex-summary.css'",
)
replace(
    'src/App.tsx',
    """        {diagnostics && <div className={`context-budget ${!diagnostics.limitValid || !diagnostics.fits ? 'over' : diagnostics.warning ? 'warning' : ''}`}><strong>{diagnostics.limitValid ? `${diagnostics.requestTokens.toLocaleString()} estimated input tokens · ${Math.round(diagnostics.usageRatio * 100)}% of usable budget` : 'Invalid effective context cap'}</strong><span>Effective limit: {diagnostics.effectiveContextTokens.toLocaleString()} · Response reserve: {diagnostics.responseReserveTokens.toLocaleString()} · {diagnostics.modelContextKnown ? `Model hard window: ${diagnostics.modelContextTokens.toLocaleString()}` : `Model window estimate: ${diagnostics.modelContextTokens.toLocaleString()}`}</span>{diagnostics.wasClamped && <small>Your configured cap is above the model hard maximum, so Arc uses the model maximum.</small>}{diagnostics.limitError && <small>{diagnostics.limitError}</small>}{diagnostics.warning && diagnostics.fits && <small>Near the limit. Consider summaries, deselecting full-text context, or raising the cap.</small>}{!diagnostics.fits && diagnostics.limitValid && <small>Over the usable budget. Generation will be refused; Arc will not trim or replace context automatically.</small>}</div>}
        <div className=\"context-preview-rendered\">""",
    """        {diagnostics && <div className={`context-budget ${!diagnostics.limitValid || !diagnostics.fits ? 'over' : diagnostics.warning ? 'warning' : ''}`}><strong>{diagnostics.limitValid ? `${diagnostics.requestTokens.toLocaleString()} estimated input tokens · ${Math.round(diagnostics.usageRatio * 100)}% of usable budget` : 'Invalid effective context cap'}</strong><span>Effective limit: {diagnostics.effectiveContextTokens.toLocaleString()} · Response reserve: {diagnostics.responseReserveTokens.toLocaleString()} · {diagnostics.modelContextKnown ? `Model hard window: ${diagnostics.modelContextTokens.toLocaleString()}` : `Model window estimate: ${diagnostics.modelContextTokens.toLocaleString()}`}</span>{diagnostics.wasClamped && <small>Your configured cap is above the model hard maximum, so Arc uses the model maximum.</small>}{diagnostics.limitError && <small>{diagnostics.limitError}</small>}{diagnostics.warning && diagnostics.fits && <small>Near the limit. Consider summaries, deselecting full-text context, or raising the cap.</small>}{!diagnostics.fits && diagnostics.limitValid && <small>Over the usable budget. Generation will be refused; Arc will not trim or replace context automatically.</small>}</div>}
        {preview.codexRepresentations.length > 0 && <div className=\"codex-context-representations\"><strong>Codex context representation</strong>{preview.codexRepresentations.map((item) => <span key={item.entryId}><b>{item.title}</b><em>{item.representation}{item.fallbackReason ? ` · ${item.fallbackReason}` : ''}</em></span>)}</div>}
        <div className=\"context-preview-rendered\">""",
)

# Workspace: Codex summary access, context policy toggle, breadcrumb and shared summary flow.
replace(
    'src/Workspace.tsx',
    "  updateCodexCategory,",
    "  updateCodexCategory,\n  updateCodexSummaryPreference,",
)
replace(
    'src/Workspace.tsx',
    "import './codex-archive.css'",
    "import './codex-archive.css'\nimport './codex-summary.css'",
)
replace(
    'src/Workspace.tsx',
    "async function openSummary(source: StructuralEntity) {",
    "async function openSummary(source: StructuralEntity | CodexEntryEntity) {",
)
replace(
    'src/Workspace.tsx',
    """  async function changeCodexCategory(category: string) {
    if (activeDocument?.type !== 'codexEntry' || !currentBook || isCodexEntryArchived(activeDocument)) return
    const updated = await updateCodexCategory(activeDocument.id, category)
    setActiveDocument(updated)
    await reloadBookContent(currentBook.id)
  }

  async function archiveCodex""",
    """  async function changeCodexCategory(category: string) {
    if (activeDocument?.type !== 'codexEntry' || !currentBook || isCodexEntryArchived(activeDocument)) return
    const updated = await updateCodexCategory(activeDocument.id, category)
    setActiveDocument(updated)
    await reloadBookContent(currentBook.id)
  }

  async function changeCodexSummaryPreference(prefer: boolean) {
    if (activeDocument?.type !== 'codexEntry' || !currentBook || isCodexEntryArchived(activeDocument)) return
    const updated = await updateCodexSummaryPreference(activeDocument.id, prefer)
    setActiveDocument(updated)
    setCodexEntries((items) => items.map((item) => item.id === updated.id ? updated : item))
  }

  async function archiveCodex""",
)
replace(
    'src/Workspace.tsx',
    """    const source = await buildSummarySource(summary.sourceEntityId)
    const controller = new AbortController()""",
    """    const source = await buildSummarySource(summary.sourceEntityId)
    if (source.source.type === 'codexEntry' && isCodexEntryArchived(source.source)) {
      showToast('Restore this Codex entry before updating its summary.')
      return
    }
    const controller = new AbortController()""",
)
replace(
    'src/Workspace.tsx',
    """  const summarySource = activeDocument?.type === 'summary'
    ? outlineEntities.find((entity) => entity.id === activeDocument.sourceEntityId)
    : undefined
  const documentPath = activeDocument?.type === 'note'
    ? `Notes / ${activeDocument.title}`
    : activeDocument?.type === 'codexEntry'
      ? `Codex / ${activeDocument.category} / ${activeDocument.title}`
      : activeDocument?.type === 'summary'
        ? `Outline / ${summarySource?.title ?? 'Missing source'} / Summary`
        : ['Outline', activeAct?.title, activeChapter?.title, activeDocument?.title].filter(Boolean).join(' / ')
  const activeCodexArchived = activeDocument?.type === 'codexEntry' && isCodexEntryArchived(activeDocument)""",
    """  const summarySource = activeDocument?.type === 'summary'
    ? [...outlineEntities, ...codexEntries].find((entity) => entity.id === activeDocument.sourceEntityId)
    : undefined
  const summaryCodexSource = summarySource?.type === 'codexEntry' ? summarySource : undefined
  const documentPath = activeDocument?.type === 'note'
    ? `Notes / ${activeDocument.title}`
    : activeDocument?.type === 'codexEntry'
      ? `Codex / ${activeDocument.category} / ${activeDocument.title}`
      : activeDocument?.type === 'summary'
        ? summaryCodexSource ? `Codex / ${summaryCodexSource.title} / Summary` : `Outline / ${summarySource?.title ?? 'Missing source'} / Summary`
        : ['Outline', activeAct?.title, activeChapter?.title, activeDocument?.title].filter(Boolean).join(' / ')
  const activeCodexArchived = activeDocument?.type === 'codexEntry' && isCodexEntryArchived(activeDocument)
  const activeSummarySourceArchived = Boolean(summaryCodexSource && isCodexEntryArchived(summaryCodexSource))""",
)
replace(
    'src/Workspace.tsx',
    """  const openSummaryState = summarySource ? summaryStates[summarySource.id] ?? 'missing' : 'missing'
  const contextType:""",
    """  const openSummaryState = summarySource ? summaryStates[summarySource.id] ?? 'missing' : 'missing'
  const summaryContextIndicator = summaryCodexSource
    ? isCodexEntryArchived(summaryCodexSource)
      ? 'AI context · Archived'
      : summaryCodexSource.preferSummaryForContext
        ? openSummaryState === 'current' ? 'AI context · Summary preferred' : `AI context · Full entry · summary ${openSummaryState === 'missing' ? 'missing' : 'outdated'}`
        : 'AI context · Full entry'
    : ''
  const contextType:""",
)
replace(
    'src/Workspace.tsx',
    """        {(activeDocument?.type === 'note' || activeDocument?.type === 'codexEntry') && <div className={`document-titlebar ${activeCodexArchived ? 'archived' : ''}`}><div><small>{activeDocument.type === 'note' ? 'Note' : activeCodexArchived ? `Archived · ${activeDocument.category}` : activeDocument.category}</small><h1>{activeDocument.title}</h1></div>{activeDocument.type === 'codexEntry' && activeCodexArchived ? <button type=\"button\" onClick={() => { void restoreCodex(activeDocument) }}><ArchiveRestore aria-hidden=\"true\" /> Restore</button> : <button type=\"button\" onClick={() => { void renameContentEntity(activeDocument) }}><Pencil aria-hidden=\"true\" /> Rename</button>}</div>}
        {activeDocument?.type === 'codexEntry' && <div className={`document-metadata ${activeCodexArchived ? 'archived' : ''}`}><label><span>Category</span><select disabled={activeCodexArchived} value={activeDocument.category} onChange={(event) => { void changeCodexCategory(event.target.value) }}><option>Character</option><option>Place</option><option>Object</option><option>Event</option><option>Group</option><option>Other</option></select></label>{activeCodexArchived && <p className=\"archived-document-note\"><Archive aria-hidden=\"true\" /><span><strong>Archived lore</strong><small>Readable here, but excluded from AI context, Chat discovery, and normal Codex search until restored.</small></span></p>}</div>}
        {activeDocument ? <MarkdownEditor key={`${activeDocument.id}-${editorRevision}`} ref={editorRef} value={storyMarkdown} onChange={handleStoryChange} ariaLabel={`${activeDocument.title} Markdown editor`} readOnly={activeCodexArchived} /> :""",
    """        {(activeDocument?.type === 'note' || activeDocument?.type === 'codexEntry') && <div className={`document-titlebar ${activeCodexArchived ? 'archived' : ''}`}><div><small>{activeDocument.type === 'note' ? 'Note' : activeCodexArchived ? `Archived · ${activeDocument.category}` : activeDocument.category}</small><h1>{activeDocument.title}</h1></div><div className=\"document-title-actions\">{activeDocument.type === 'codexEntry' && <SummaryIcon state={summaryStates[activeDocument.id] ?? 'missing'} kind=\"codex\" onOpen={() => { void openSummary(activeDocument) }} />}{activeDocument.type === 'codexEntry' && activeCodexArchived ? <button type=\"button\" onClick={() => { void restoreCodex(activeDocument) }}><ArchiveRestore aria-hidden=\"true\" /> Restore</button> : <button type=\"button\" onClick={() => { void renameContentEntity(activeDocument) }}><Pencil aria-hidden=\"true\" /> Rename</button>}</div></div>}
        {activeDocument?.type === 'codexEntry' && <div className={`document-metadata ${activeCodexArchived ? 'archived' : ''}`}><label><span>Category</span><select disabled={activeCodexArchived} value={activeDocument.category} onChange={(event) => { void changeCodexCategory(event.target.value) }}><option>Character</option><option>Place</option><option>Object</option><option>Event</option><option>Group</option><option>Other</option></select></label>{!activeCodexArchived && <label className=\"codex-summary-preference\"><input type=\"checkbox\" checked={activeDocument.preferSummaryForContext === true} onChange={(event) => { void changeCodexSummaryPreference(event.target.checked) }} /><span><strong>Prefer summary for AI context</strong><small>{codexSummaryPolicyText(activeDocument, summaryStates[activeDocument.id] ?? 'missing')}</small></span></label>}{activeCodexArchived && <p className=\"archived-document-note\"><Archive aria-hidden=\"true\" /><span><strong>Archived lore</strong><small>Readable here, but excluded from AI context, Chat discovery, and normal Codex search until restored.</small></span></p>}</div>}
        {activeDocument?.type === 'summary' && summaryContextIndicator && <div className=\"summary-context-indicator\">{summaryContextIndicator}</div>}
        {activeDocument ? <MarkdownEditor key={`${activeDocument.id}-${editorRevision}`} ref={editorRef} value={storyMarkdown} onChange={handleStoryChange} ariaLabel={`${activeDocument.title} Markdown editor`} readOnly={activeCodexArchived || activeSummarySourceArchived} /> :""",
)
replace(
    'src/Workspace.tsx',
    """      {screen === 'editor' && activeDocument?.type === 'summary' && <div className=\"summary-generate-wrap\"><button className=\"summary-generate\" type=\"button\" onClick={generationActive ? stopGeneration : generate}>{generationActive ? <Square aria-hidden=\"true\" fill=\"currentColor\" /> : <RefreshCw aria-hidden=\"true\" />} {generationActive ? 'Stop' : openSummaryState === 'missing' ? 'Summarize' : 'Re-summarize'}</button></div>}""",
    """      {screen === 'editor' && activeDocument?.type === 'summary' && !activeSummarySourceArchived && <div className=\"summary-generate-wrap\"><button className=\"summary-generate\" type=\"button\" onClick={generationActive ? stopGeneration : generate}>{generationActive ? <Square aria-hidden=\"true\" fill=\"currentColor\" /> : <RefreshCw aria-hidden=\"true\" />} {generationActive ? 'Stop' : openSummaryState === 'missing' ? 'Summarize' : 'Re-summarize'}</button></div>}""",
)
replace(
    'src/Workspace.tsx',
    """rightTab === 'codex' ? <Codex entries={codexEntries} activeId={activeDocument?.type === 'codexEntry' ? activeDocument.id : null} onCreate={() => { void addCodexEntry() }} onOpen={(id) => { void loadDocument(id) }} onRename={(entity) => { void renameContentEntity(entity) }} onArchive={(entity) => { void archiveCodex(entity) }} onRestore={(entity) => { void restoreCodex(entity) }} onDelete={(entity) => { void removeContentEntity(entity) }} />""",
    """rightTab === 'codex' ? <Codex entries={codexEntries} activeId={activeDocument?.type === 'codexEntry' ? activeDocument.id : null} summaryStates={summaryStates} onCreate={() => { void addCodexEntry() }} onOpen={(id) => { void loadDocument(id) }} onOpenSummary={(entity) => { void openSummary(entity) }} onRename={(entity) => { void renameContentEntity(entity) }} onArchive={(entity) => { void archiveCodex(entity) }} onRestore={(entity) => { void restoreCodex(entity) }} onDelete={(entity) => { void removeContentEntity(entity) }} />""",
)
replace(
    'src/Workspace.tsx',
    """function SummaryIcon({ state, onOpen }: { state: SummaryState; onOpen: () => void }) { const Icon = state === 'current' ? FileText : state === 'outdated' ? RefreshCw : FileQuestion; return <button className={`summary-status ${state}`} type=\"button\" onClick={onOpen} aria-label={`Open ${state} summary`} title={`${state[0].toUpperCase()}${state.slice(1)} summary`}><Icon aria-hidden=\"true\" /></button> }""",
    """function SummaryIcon({ state, onOpen, kind = 'outline' }: { state: SummaryState; onOpen: () => void; kind?: 'outline' | 'codex' }) { const Icon = state === 'current' ? FileText : state === 'outdated' ? RefreshCw : FileQuestion; const title = kind === 'codex' ? state === 'missing' ? 'No summary — full entry is used for AI context.' : state === 'current' ? 'Current summary.' : 'Summary outdated — full entry will be used.' : `${state[0].toUpperCase()}${state.slice(1)} summary`; return <button className={`summary-status ${state} ${kind === 'codex' ? 'codex-summary-status' : ''}`} type=\"button\" onClick={onOpen} aria-label={`Open ${state} summary`} title={title}><Icon aria-hidden=\"true\" /></button> }
function codexSummaryPolicyText(entry: CodexEntryEntity, state: SummaryState) { if (!entry.preferSummaryForContext) return 'Full entry is used for AI context.'; if (state === 'current') return 'Current summary is used for AI context.'; if (state === 'missing') return 'No summary yet — full entry is used.'; return 'Summary is outdated — full entry is used until updated.' }""",
)

# Replace Codex component signature/body hooks for summary status icon.
replace(
    'src/Workspace.tsx',
    """function Codex({ entries, activeId, onCreate, onOpen, onRename, onArchive, onRestore, onDelete }: {
  entries: CodexEntryEntity[]
  activeId: string | null
  onCreate: () => void
  onOpen: (id: string) => void
  onRename: (entity: CodexEntryEntity) => void""",
    """function Codex({ entries, activeId, summaryStates, onCreate, onOpen, onOpenSummary, onRename, onArchive, onRestore, onDelete }: {
  entries: CodexEntryEntity[]
  activeId: string | null
  summaryStates: Record<string, SummaryState>
  onCreate: () => void
  onOpen: (id: string) => void
  onOpenSummary: (entity: CodexEntryEntity) => void
  onRename: (entity: CodexEntryEntity) => void""",
)
replace(
    'src/Workspace.tsx',
    """{visible.length ? visible.map((entry) => <article className={`content-row codex-content-row ${showArchived ? 'archived' : ''} ${activeId === entry.id ? 'selected' : ''}`} key={entry.id}><button className=\"content-open\" type=\"button\" onClick={() => onOpen(entry.id)}><i>{entry.title.slice(0, 1).toUpperCase()}</i><span><small>{showArchived ? `Archived · ${entry.category}` : entry.category}</small><strong>{entry.title}</strong></span><ChevronRight aria-hidden=\"true\" /></button><div className=\"content-actions\">""",
    """{visible.length ? visible.map((entry) => <article className={`content-row codex-content-row ${showArchived ? 'archived' : ''} ${activeId === entry.id ? 'selected' : ''}`} key={entry.id}><button className=\"content-open\" type=\"button\" onClick={() => onOpen(entry.id)}><i>{entry.title.slice(0, 1).toUpperCase()}</i><span><small>{showArchived ? `Archived · ${entry.category}` : entry.category}</small><strong>{entry.title}</strong></span><ChevronRight aria-hidden=\"true\" /></button><SummaryIcon state={summaryStates[entry.id] ?? 'missing'} kind=\"codex\" onOpen={() => onOpenSummary(entry)} /><div className=\"content-actions\">""",
)

# CSS keeps missing Codex summaries neutral and exposes policy/preview status.
Path('src/codex-summary.css').write_text(r'''.codex-summary-status.missing { opacity: .55; }
.codex-summary-status.outdated { opacity: .78; }
.document-title-actions { display: flex; align-items: center; gap: 6px; }
.codex-summary-preference { display: flex !important; align-items: flex-start; gap: 9px; margin-top: 10px; }
.codex-summary-preference input { margin-top: 3px; }
.codex-summary-preference span { display: grid; gap: 2px; }
.codex-summary-preference small { opacity: .68; line-height: 1.4; }
.summary-context-indicator { width: fit-content; margin: 0 auto 10px; padding: 5px 9px; border: 1px solid rgba(255,255,255,.1); border-radius: 999px; font-size: .72rem; opacity: .72; }
.codex-context-representations { display: grid; gap: 6px; margin-bottom: 12px; padding: 10px 12px; border: 1px solid rgba(255,255,255,.09); border-radius: 10px; }
.codex-context-representations > strong { font-size: .78rem; }
.codex-context-representations > span { display: flex; justify-content: space-between; gap: 12px; font-size: .76rem; }
.codex-context-representations em { font-style: normal; opacity: .68; }
@media (max-width: 640px) { .codex-context-representations > span { align-items: flex-start; flex-direction: column; gap: 2px; } }
''')

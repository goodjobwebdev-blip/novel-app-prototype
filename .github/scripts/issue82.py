from pathlib import Path


def replace(path: str, old: str, new: str):
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f"Missing expected block in {path}: {old[:140]!r}")
    file.write_text(text.replace(old, new, 1))


# Persistence: archive is an explicit reversible state on Codex entries.
replace(
    'src/persistence.ts',
    "export type CodexEntryEntity = ArcEntity & { type: 'codexEntry'; bookId: string; parentId: string; title: string; category: string; content: string }",
    "export type CodexEntryEntity = ArcEntity & { type: 'codexEntry'; bookId: string; parentId: string; title: string; category: string; content: string; archivedAt?: number }",
)
replace(
    'src/persistence.ts',
    "export async function updateCodexCategory(id: string, category: string): Promise<CodexEntryEntity> {",
    """export function isCodexEntryArchived(entity: ArcEntity | CodexEntryEntity | undefined): boolean {
  return entity?.type === 'codexEntry' && typeof entity.archivedAt === 'number' && entity.archivedAt > 0
}

export async function archiveCodexEntry(id: string): Promise<CodexEntryEntity> {
  const db = await database()
  const current = await db.table('entities').get(id) as CodexEntryEntity | undefined
  if (!current || current.type !== 'codexEntry') throw new Error(`Cannot archive missing Codex entry ${id}`)
  if (isCodexEntryArchived(current)) return current
  const now = Date.now()
  const updated: CodexEntryEntity = { ...current, archivedAt: now, updatedAt: now }
  await db.transaction('rw', db.table('entities'), async () => {
    await db.table('entities').put(updated)
    await touchAncestors(db, current.bookId, now)
  })
  return updated
}

export async function restoreCodexEntry(id: string): Promise<CodexEntryEntity> {
  const db = await database()
  const current = await db.table('entities').get(id) as CodexEntryEntity | undefined
  if (!current || current.type !== 'codexEntry') throw new Error(`Cannot restore missing Codex entry ${id}`)
  if (!isCodexEntryArchived(current)) return current
  const now = Date.now()
  const { archivedAt: _archivedAt, ...active } = current
  const updated: CodexEntryEntity = { ...active, updatedAt: now }
  await db.transaction('rw', db.table('entities'), async () => {
    await db.table('entities').put(updated)
    await touchAncestors(db, current.bookId, now)
  })
  return updated
}

export async function updateCodexCategory(id: string, category: string): Promise<CodexEntryEntity> {""",
)

# Context assembly must skip stale archived IDs without mutating the saved profile.
replace(
    'src/context-service.ts',
    "import { listEntitiesByBook, type ArcEntity, type GenerationContextProfile, type GenerationContextType, type StructuralEntity, type SummaryEntity } from './persistence'",
    "import { isCodexEntryArchived, listEntitiesByBook, type ArcEntity, type GenerationContextProfile, type GenerationContextType, type StructuralEntity, type SummaryEntity } from './persistence'",
)
replace(
    'src/context-service.ts',
    "const codex: AdditionalContextSection[] = entities.filter((item) => item.type === 'codexEntry' && item.id !== options.currentDocumentId && options.profile.codexEntryIds.includes(item.id))",
    "const codex: AdditionalContextSection[] = entities.filter((item) => item.type === 'codexEntry' && !isCodexEntryArchived(item) && item.id !== options.currentDocumentId && options.profile.codexEntryIds.includes(item.id))",
)

# Context Management hides archived lore from normal selection but explains stale saved selections.
replace(
    'src/App.tsx',
    "  getBookContextSettings,\n  getBookAiSettings,",
    "  getBookContextSettings,\n  getBookAiSettings,\n  isCodexEntryArchived,",
)
replace(
    'src/App.tsx',
    "import './context-limit-settings.css'",
    "import './context-limit-settings.css'\nimport './codex-archive.css'",
)
replace(
    'src/App.tsx',
    """  const normalized = query.trim().toLowerCase()
  const visible = sources.filter((item) => ['act', 'chapter', 'scene', 'note', 'codexEntry'].includes(item.type) && (type === 'chat' || item.id !== currentDocumentId) && (!normalized || `${item.title ?? ''} ${item.type} ${item.category ?? ''}`.toLowerCase().includes(normalized)))
  const groups = [""",
    """  const normalized = query.trim().toLowerCase()
  const archivedSelectedCodex = sources.filter((item) => item.type === 'codexEntry' && isCodexEntryArchived(item) && profile.codexEntryIds.includes(item.id))
  const archivedSelectedIds = new Set(archivedSelectedCodex.map((item) => item.id))
  const visible = sources.filter((item) => ['act', 'chapter', 'scene', 'note', 'codexEntry'].includes(item.type) && !(item.type === 'codexEntry' && isCodexEntryArchived(item)) && (type === 'chat' || item.id !== currentDocumentId) && (!normalized || `${item.title ?? ''} ${item.type} ${item.category ?? ''}`.toLowerCase().includes(normalized)))
  const groups = [""",
)
replace(
    'src/App.tsx',
    """    <section className=\"settings-card context-defaults-card\"><div className=\"card-heading\"><div><span>01</span><h2>Automatic context</h2></div></div>""",
    """    <section className=\"settings-card context-defaults-card\"><div className=\"card-heading\"><div><span>01</span><h2>Automatic context</h2></div></div>
      {archivedSelectedCodex.length > 0 && <div className=\"context-inactive-source\"><div><strong>{archivedSelectedCodex.length} archived Codex {archivedSelectedCodex.length === 1 ? 'selection is' : 'selections are'} inactive</strong><small>{archivedSelectedCodex.map((item) => item.title ?? 'Untitled').join(', ')}. Archived lore is skipped from requests.</small></div><button type=\"button\" onClick={() => updateProfile({ ...profile, codexEntryIds: profile.codexEntryIds.filter((id) => !archivedSelectedIds.has(id)) })}>Remove inactive</button></div>}""",
)

# Chat search/read/edit/mutation tools must treat archived Codex as nonexistent.
replace(
    'src/chat-tools.ts',
    "  getEntity,\n  listEntitiesByBook,",
    "  getEntity,\n  isCodexEntryArchived,\n  listEntitiesByBook,",
)
replace(
    'src/chat-tools.ts',
    """  if (!entity || entity.bookId !== bookId || !editableTypeSet.has(entity.type)) {
    throw new Error('That editable document was not found in the current book.')
  }""",
    """  if (!entity || entity.bookId !== bookId || !editableTypeSet.has(entity.type) || isCodexEntryArchived(entity)) {
    throw new Error('That editable document was not found in the current book.')
  }""",
)
replace(
    'src/chat-tools.ts',
    ".filter((entity) => editableTypeSet.has(entity.type) && (!requestedTypes?.size || requestedTypes.has(entity.type)))",
    ".filter((entity) => editableTypeSet.has(entity.type) && !isCodexEntryArchived(entity) && (!requestedTypes?.size || requestedTypes.has(entity.type)))",
)
replace(
    'src/chat-tools.ts',
    """      const existing = (await listEntitiesByBook(bookId, 'codexEntry'))
        .filter((entity) => normalizedTitle(String(entity.title ?? '')) === normalizedTitle(title))""",
    """      const existing = (await listEntitiesByBook(bookId, 'codexEntry'))
        .filter((entity) => !isCodexEntryArchived(entity) && normalizedTitle(String(entity.title ?? '')) === normalizedTitle(title))""",
)

replace(
    'src/chat-entity-tools.ts',
    "  getEntity,\n  listEntitiesByBook,",
    "  getEntity,\n  isCodexEntryArchived,\n  listEntitiesByBook,",
)
replace(
    'src/chat-entity-tools.ts',
    """  if (!entity || entity.bookId !== bookId || !manageableTypeSet.has(entity.type)) {
    throw new Error('That Note or Codex entry was not found in the current book.')
  }""",
    """  if (!entity || entity.bookId !== bookId || !manageableTypeSet.has(entity.type) || isCodexEntryArchived(entity)) {
    throw new Error('That Note or Codex entry was not found in the current book.')
  }""",
)
replace(
    'src/chat-entity-tools.ts',
    """async function duplicateTitle(bookId: string, type: 'note' | 'codexEntry', title: string, exceptId?: string) {
  return (await listEntitiesByBook(bookId, type))
    .find((entity) => entity.id !== exceptId && normalizedTitle(entity.title) === normalizedTitle(title))
}""",
    """async function duplicateTitle(bookId: string, type: 'note' | 'codexEntry', title: string, exceptId?: string) {
  return (await listEntitiesByBook(bookId, type))
    .find((entity) => entity.id !== exceptId && !isCodexEntryArchived(entity) && normalizedTitle(entity.title) === normalizedTitle(title))
}""",
)

# Markdown editor gains a real read-only mode for archived entries.
replace(
    'src/MarkdownEditor.tsx',
    """  ariaLabel?: string
  className?: string
}""",
    """  ariaLabel?: string
  className?: string
  readOnly?: boolean
}""",
)
replace(
    'src/MarkdownEditor.tsx',
    """  { value, onChange, ariaLabel = 'Markdown editor', className = '' },
  ref,""",
    """  { value, onChange, ariaLabel = 'Markdown editor', className = '', readOnly = false },
  ref,""",
)
replace(
    'src/MarkdownEditor.tsx',
    """        markdown(),
        history(),""",
    """        markdown(),
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        history(),""",
)
replace(
    'src/MarkdownEditor.tsx',
    "  }, [ariaLabel])",
    "  }, [ariaLabel, readOnly])",
)
replace(
    'src/MarkdownEditor.tsx',
    "  return <div ref={hostRef} className={`markdown-editor ${className}`.trim()} />",
    "  return <div ref={hostRef} className={`markdown-editor ${readOnly ? 'read-only' : ''} ${className}`.trim()} />",
)

# Workspace archive/restore UI and behavior.
replace(
    'src/Workspace.tsx',
    "  ArrowUp,\n  Bot,",
    "  ArrowUp,\n  Archive,\n  ArchiveRestore,\n  Bot,",
)
replace(
    'src/Workspace.tsx',
    "  PROTOTYPE_SCENE_ID,\n  createBook,",
    "  PROTOTYPE_SCENE_ID,\n  archiveCodexEntry,\n  createBook,",
)
replace(
    'src/Workspace.tsx',
    "  getGenerationContextProfile,\n  getOrCreateSummary,",
    "  getGenerationContextProfile,\n  getOrCreateSummary,\n  isCodexEntryArchived,",
)
replace(
    'src/Workspace.tsx',
    "  renameSeries as renameSeriesEntity,\n  saveDocumentContent,",
    "  renameSeries as renameSeriesEntity,\n  restoreCodexEntry,\n  saveDocumentContent,",
)
replace(
    'src/Workspace.tsx',
    "import './generation-controls.css'",
    "import './generation-controls.css'\nimport './codex-archive.css'",
)
replace(
    'src/Workspace.tsx',
    """  async function changeCodexCategory(category: string) {
    if (activeDocument?.type !== 'codexEntry' || !currentBook) return
    const updated = await updateCodexCategory(activeDocument.id, category)
    setActiveDocument(updated)
    await reloadBookContent(currentBook.id)
  }

  function openSettings(from: Screen) {""",
    """  async function changeCodexCategory(category: string) {
    if (activeDocument?.type !== 'codexEntry' || !currentBook || isCodexEntryArchived(activeDocument)) return
    const updated = await updateCodexCategory(activeDocument.id, category)
    setActiveDocument(updated)
    await reloadBookContent(currentBook.id)
  }

  async function archiveCodex(entity: CodexEntryEntity) {
    if (!currentBook || isCodexEntryArchived(entity)) return
    try {
      if (activeDocumentIdRef.current === entity.id && changedSinceSnapshotRef.current) await flushDocument('navigation', true)
      const updated = await archiveCodexEntry(entity.id)
      if (activeDocumentIdRef.current === entity.id) {
        setActiveDocument(updated)
        storyRef.current = updated.content
        setStoryMarkdown(updated.content)
        changedSinceSnapshotRef.current = false
        setEditorRevision((revision) => revision + 1)
      }
      await reloadBookContent(currentBook.id)
      showToast(`Archived “${entity.title}”.`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not archive the Codex entry.')
    }
  }

  async function restoreCodex(entity: CodexEntryEntity) {
    if (!currentBook || !isCodexEntryArchived(entity)) return
    try {
      const updated = await restoreCodexEntry(entity.id)
      if (activeDocumentIdRef.current === entity.id) {
        setActiveDocument(updated)
        storyRef.current = updated.content
        setStoryMarkdown(updated.content)
        changedSinceSnapshotRef.current = false
        setEditorRevision((revision) => revision + 1)
      }
      await reloadBookContent(currentBook.id)
      showToast(`Restored “${entity.title}”.`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not restore the Codex entry.')
    }
  }

  function openSettings(from: Screen) {""",
)
replace(
    'src/Workspace.tsx',
    """    const isCodex = activeDocument.type === 'codexEntry'

    let settings: AiSettings""",
    """    const isCodex = activeDocument.type === 'codexEntry'
    if (isCodex && isCodexEntryArchived(activeDocument)) {
      showToast('Restore this archived Codex entry before generating or revising it.')
      return
    }

    let settings: AiSettings""",
)
replace(
    'src/Workspace.tsx',
    """  const pageLabel = activeDocument?.type === 'note'
    ? 'N'""",
    """  const activeCodexArchived = activeDocument?.type === 'codexEntry' && isCodexEntryArchived(activeDocument)
  const pageLabel = activeDocument?.type === 'note'
    ? 'N'""",
)
replace(
    'src/Workspace.tsx',
    """        {(activeDocument?.type === 'note' || activeDocument?.type === 'codexEntry') && <div className=\"document-titlebar\"><div><small>{activeDocument.type === 'note' ? 'Note' : activeDocument.category}</small><h1>{activeDocument.title}</h1></div><button type=\"button\" onClick={() => { void renameContentEntity(activeDocument) }}><Pencil aria-hidden=\"true\" /> Rename</button></div>}
        {activeDocument?.type === 'codexEntry' && <div className=\"document-metadata\"><label><span>Category</span><select value={activeDocument.category} onChange={(event) => { void changeCodexCategory(event.target.value) }}><option>Character</option><option>Place</option><option>Object</option><option>Event</option><option>Group</option><option>Other</option></select></label></div>}
        {activeDocument ? <MarkdownEditor key={`${activeDocument.id}-${editorRevision}`} ref={editorRef} value={storyMarkdown} onChange={handleStoryChange} ariaLabel={`${activeDocument.title} Markdown editor`} /> :""",
    """        {(activeDocument?.type === 'note' || activeDocument?.type === 'codexEntry') && <div className={`document-titlebar ${activeCodexArchived ? 'archived' : ''}`}><div><small>{activeDocument.type === 'note' ? 'Note' : activeCodexArchived ? `Archived · ${activeDocument.category}` : activeDocument.category}</small><h1>{activeDocument.title}</h1></div>{activeDocument.type === 'codexEntry' && activeCodexArchived ? <button type=\"button\" onClick={() => { void restoreCodex(activeDocument) }}><ArchiveRestore aria-hidden=\"true\" /> Restore</button> : <button type=\"button\" onClick={() => { void renameContentEntity(activeDocument) }}><Pencil aria-hidden=\"true\" /> Rename</button>}</div>}
        {activeDocument?.type === 'codexEntry' && <div className={`document-metadata ${activeCodexArchived ? 'archived' : ''}`}><label><span>Category</span><select disabled={activeCodexArchived} value={activeDocument.category} onChange={(event) => { void changeCodexCategory(event.target.value) }}><option>Character</option><option>Place</option><option>Object</option><option>Event</option><option>Group</option><option>Other</option></select></label>{activeCodexArchived && <p className=\"archived-document-note\"><Archive aria-hidden=\"true\" /><span><strong>Archived lore</strong><small>Readable here, but excluded from AI context, Chat discovery, and normal Codex search until restored.</small></span></p>}</div>}
        {activeDocument ? <MarkdownEditor key={`${activeDocument.id}-${editorRevision}`} ref={editorRef} value={storyMarkdown} onChange={handleStoryChange} ariaLabel={`${activeDocument.title} Markdown editor`} readOnly={activeCodexArchived} /> :""",
)
replace(
    'src/Workspace.tsx',
    """      {screen === 'editor' && (activeDocument?.type === 'scene' || activeDocument?.type === 'codexEntry') && !arcOpen && <div className=\"editor-bottom\">""",
    """      {screen === 'editor' && (activeDocument?.type === 'scene' || (activeDocument?.type === 'codexEntry' && !activeCodexArchived)) && !arcOpen && <div className=\"editor-bottom\">""",
)
replace(
    'src/Workspace.tsx',
    """      {screen === 'editor' && (activeDocument?.type === 'scene' || activeDocument?.type === 'codexEntry') && arcOpen && <section className=\"arc-drawer\">""",
    """      {screen === 'editor' && (activeDocument?.type === 'scene' || (activeDocument?.type === 'codexEntry' && !activeCodexArchived)) && arcOpen && <section className=\"arc-drawer\">""",
)
replace(
    'src/Workspace.tsx',
    """rightTab === 'codex' ? <Codex entries={codexEntries} activeId={activeDocument?.type === 'codexEntry' ? activeDocument.id : null} onCreate={() => { void addCodexEntry() }} onOpen={(id) => { void loadDocument(id) }} onRename={(entity) => { void renameContentEntity(entity) }} onDelete={(entity) => { void removeContentEntity(entity) }} />""",
    """rightTab === 'codex' ? <Codex entries={codexEntries} activeId={activeDocument?.type === 'codexEntry' ? activeDocument.id : null} onCreate={() => { void addCodexEntry() }} onOpen={(id) => { void loadDocument(id) }} onRename={(entity) => { void renameContentEntity(entity) }} onArchive={(entity) => { void archiveCodex(entity) }} onRestore={(entity) => { void restoreCodex(entity) }} onDelete={(entity) => { void removeContentEntity(entity) }} />""",
)

workspace = Path('src/Workspace.tsx')
text = workspace.read_text()
start = text.index('function Codex({ entries, activeId, onCreate, onOpen, onRename, onDelete }')
end = text.index('function ChatList(', start)
new_codex = r'''function Codex({ entries, activeId, onCreate, onOpen, onRename, onArchive, onRestore, onDelete }: {
  entries: CodexEntryEntity[]
  activeId: string | null
  onCreate: () => void
  onOpen: (id: string) => void
  onRename: (entity: CodexEntryEntity) => void
  onArchive: (entity: CodexEntryEntity) => void
  onRestore: (entity: CodexEntryEntity) => void
  onDelete: (entity: CodexEntryEntity) => void
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [showArchived, setShowArchived] = useState(false)
  const scopedEntries = entries.filter((entry) => isCodexEntryArchived(entry) === showArchived)
  const categories = ['All', ...new Set(scopedEntries.map((entry) => entry.category))]
  const activeCategory = categories.includes(category) ? category : 'All'
  const normalizedQuery = query.trim().toLowerCase()
  const visible = scopedEntries.filter((entry) => (activeCategory === 'All' || entry.category === activeCategory) && (!normalizedQuery || `${entry.title} ${entry.content}`.toLowerCase().includes(normalizedQuery)))
  const archivedCount = entries.filter(isCodexEntryArchived).length
  return <section>
    <div className="panel-title"><div><small>{showArchived ? 'Inactive knowledge' : 'Book knowledge'}</small><h2>{showArchived ? 'Codex archive' : 'Codex'}</h2></div><div className="codex-panel-actions"><button className={showArchived ? 'active' : ''} type="button" onClick={() => { setShowArchived((value) => !value); setCategory('All') }} aria-pressed={showArchived}><Archive aria-hidden="true" /> {showArchived ? 'Active' : `Archive${archivedCount ? ` ${archivedCount}` : ''}`}</button>{!showArchived && <button type="button" onClick={onCreate}><Plus aria-hidden="true" /> New</button>}</div></div>
    <input className="panel-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={showArchived ? 'Search archived Codex' : 'Search the Codex'}/>
    <div className="chips category-filter">{categories.map((item) => <button className={activeCategory === item ? 'active' : ''} type="button" onClick={() => setCategory(item)} key={item}>{item}</button>)}</div>
    {visible.length ? visible.map((entry) => <article className={`content-row codex-content-row ${showArchived ? 'archived' : ''} ${activeId === entry.id ? 'selected' : ''}`} key={entry.id}><button className="content-open" type="button" onClick={() => onOpen(entry.id)}><i>{entry.title.slice(0, 1).toUpperCase()}</i><span><small>{showArchived ? `Archived · ${entry.category}` : entry.category}</small><strong>{entry.title}</strong></span><ChevronRight aria-hidden="true" /></button><div className="content-actions">{showArchived ? <button type="button" onClick={() => onRestore(entry)} aria-label={`Restore ${entry.title}`} title="Restore"><ArchiveRestore aria-hidden="true" /></button> : <><button type="button" onClick={() => onRename(entry)} aria-label={`Rename ${entry.title}`} title="Rename"><Pencil aria-hidden="true" /></button><button type="button" onClick={() => onArchive(entry)} aria-label={`Archive ${entry.title}`} title="Archive"><Archive aria-hidden="true" /></button></>}<button type="button" onClick={() => onDelete(entry)} aria-label={`Delete ${entry.title}`} title="Delete permanently"><Trash2 aria-hidden="true" /></button></div></article>) : <p className="content-empty">{showArchived ? (query || activeCategory !== 'All' ? 'No matching archived entries.' : 'No archived Codex entries.') : (query || activeCategory !== 'All' ? 'No matching entries.' : 'No Codex entries yet.')}</p>}
  </section>
}
'''
workspace.write_text(text[:start] + new_codex + text[end:])

# Small shared archive styles.
Path('src/codex-archive.css').write_text(r'''.codex-panel-actions { display: flex; align-items: center; gap: 6px; }
.codex-panel-actions button { display: inline-flex; align-items: center; gap: 5px; }
.codex-panel-actions button.active { opacity: .86; }
.codex-content-row.archived { opacity: .68; }
.codex-content-row.archived.selected { opacity: .82; }
.document-titlebar.archived { opacity: .82; }
.document-metadata.archived select { opacity: .62; cursor: not-allowed; }
.archived-document-note { display: flex; align-items: flex-start; gap: 8px; margin: 10px 0 0; padding: 10px 12px; border: 1px dashed rgba(255,255,255,.16); border-radius: 10px; }
.archived-document-note svg { width: 16px; height: 16px; margin-top: 2px; flex: 0 0 auto; }
.archived-document-note span { display: grid; gap: 2px; }
.archived-document-note small { opacity: .68; line-height: 1.4; }
.markdown-editor.read-only { opacity: .88; }
.context-inactive-source { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; padding: 10px 12px; border: 1px dashed rgba(255,255,255,.16); border-radius: 10px; }
.context-inactive-source > div { display: grid; gap: 3px; }
.context-inactive-source small { opacity: .68; line-height: 1.4; }
.context-inactive-source button { flex: 0 0 auto; }
@media (max-width: 640px) { .codex-panel-actions { gap: 4px; } .context-inactive-source { align-items: stretch; flex-direction: column; } .context-inactive-source button { align-self: flex-start; } }
''')

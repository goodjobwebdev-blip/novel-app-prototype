from pathlib import Path
import re


def replace(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'Missing block in {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1))


def regex(path: str, pattern: str, replacement: str, count=1):
    p = Path(path)
    text = p.read_text()
    next_text, n = re.subn(pattern, replacement, text, count=count, flags=re.S)
    if n != count:
        raise SystemExit(f'Expected {count} regex matches in {path}, got {n}: {pattern[:100]!r}')
    p.write_text(next_text)


# Fix the newly-added service import after writing it through the connector.
replace(
    'src/autotitle-service.ts',
    "import {\n  getEntity,\n  listEntitiesByBook,\n  type AiSettings as _UnusedAiSettings,\n} from './persistence'\nimport type { AiSettings } from './ai-settings'\nimport {\n  type ArcEntity,",
    "import type { AiSettings } from './ai-settings'\nimport {\n  getEntity,\n  listEntitiesByBook,\n  type ArcEntity,",
)

# Remove obsolete user-editable title prompt from active settings while accepting old stored shapes.
replace('src/ai-settings.ts', "  titles: string\n", '')
replace(
    'src/ai-settings.ts',
    "const previousDefaultAiPrompts: Array<Partial<AiPrompts>> = [{",
    "const previousDefaultAiPrompts: Array<Partial<AiPrompts> & { titles?: string }> = [{",
)
regex(
    'src/ai-settings.ts',
    r"\n  titles: `Generate concise names or titles for \{\{target\.type\}\}\.\n\n\{% if book\.genre %\}\nGenre: \{\{book\.genre\}\}\n\{% endif %\}\nTone: \{\{book\.style\}\}\nLanguage: \{\{book\.language\}\}\nReturn \{\{count\}\} distinct options without commentary\.`,",
    '',
)
replace(
    'src/ai-settings.ts',
    "  const prompts = { ...defaultAiPrompts, ...value?.prompts }\n",
    "  const storedPrompts = value?.prompts as (Partial<AiPrompts> & { titles?: string }) | undefined\n  const prompts: AiPrompts = {\n    story: storedPrompts?.story ?? defaultAiPrompts.story,\n    summarize: storedPrompts?.summarize ?? defaultAiPrompts.summarize,\n    lore: storedPrompts?.lore ?? defaultAiPrompts.lore,\n    assistant: storedPrompts?.assistant ?? defaultAiPrompts.assistant,\n  }\n",
)

replace("src/prompt-template.ts", "export type PromptScope = 'story' | 'summarize' | 'titles' | 'lore' | 'assistant'", "export type PromptScope = 'story' | 'summarize' | 'lore' | 'assistant'")
replace("src/prompt-template.ts", "const everyPrompt: PromptScope[] = ['story', 'summarize', 'titles', 'lore', 'assistant']", "const everyPrompt: PromptScope[] = ['story', 'summarize', 'lore', 'assistant']")
replace("src/prompt-template.ts", "  { name: 'target.type', description: 'The requested summary, title, or name target', scopes: ['summarize', 'titles'] },", "  { name: 'target.type', description: 'The requested summary target', scopes: ['summarize'] },")
replace("src/prompt-template.ts", "  { name: 'count', description: 'Requested number of title or name options', scopes: ['titles'] },\n", '')
replace("src/App.tsx", "['summarize', 'Summarize'], ['titles', 'Titles & names'], ['lore', 'Lore entries']", "['summarize', 'Summarize'], ['lore', 'Lore entries']")
replace("src/App.tsx", "Main writes; Support handles summaries and names.", "Main writes; Support handles summaries and autotitles.")

# Keep Summary display titles derived from source renames.
replace(
    'src/persistence.ts',
    """    await db.table('entities').put(updated)
    if (['act', 'chapter', 'scene'].includes(entity.type)) await touchAncestors(db, entity.parentId, updated.updatedAt)
    else if (entity.bookId) await touchAncestors(db, entity.bookId, updated.updatedAt)
""",
    """    await db.table('entities').put(updated)
    if (['act', 'chapter', 'scene', 'codexEntry'].includes(entity.type)) {
      const summary = await db.table('entities').get(summaryId(entity.id)) as SummaryEntity | undefined
      if (summary?.type === 'summary') await db.table('entities').put({ ...summary, title: `${updated.title} summary`, updatedAt: now })
    }
    if (['act', 'chapter', 'scene'].includes(entity.type)) await touchAncestors(db, entity.parentId, updated.updatedAt)
    else if (entity.bookId) await touchAncestors(db, entity.bookId, updated.updatedAt)
""",
)

# Chat: Book rename is another approval-based entity action.
replace("src/chat-service.ts", "  entityType: 'note' | 'codexEntry'", "  entityType: 'book' | 'note' | 'codexEntry'")
replace(
    'src/chat-entity-tools.ts',
    "  'propose_entity_rename',\n",
    "  'propose_entity_rename',\n  'propose_book_rename',\n",
)
replace(
    'src/chat-entity-tools.ts',
    """  {
    type: 'function',
    function: {
      name: 'propose_entity_delete',""",
    """  {
    type: 'function',
    function: {
      name: 'propose_book_rename',
      description: 'Propose renaming the current Book. This does not rename the Book until the user explicitly approves the proposal in Chat.',
      parameters: {
        type: 'object',
        properties: {
          new_title: { type: 'string' },
          summary: { type: 'string' },
        },
        required: ['new_title'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_entity_delete',""",
)
replace(
    'src/chat-entity-tools.ts',
    """    if (call.function.name === 'propose_entity_rename') {""",
    """    if (call.function.name === 'propose_book_rename') {
      const entity = await getEntity<ArcEntity>(bookId)
      if (!entity || entity.type !== 'book') return { content: result({ ok: false, error: 'The current Book was not found.' }) }
      const newTitle = cleanTitle(args.new_title)
      if (!newTitle) return { content: result({ ok: false, error: 'The new Book title cannot be empty.' }) }
      const proposal: ChatEntityActionProposal = {
        id: makeProposalId(),
        action: 'rename',
        entityId: entity.id,
        entityType: 'book',
        entityTitle: entityTitle(entity),
        newTitle,
        expectedUpdatedAt: entity.updatedAt,
        summary: cleanTitle(args.summary),
        status: 'proposed',
        createdAt: Date.now(),
      }
      return { content: result({ ok: true, proposalId: proposal.id, message: 'Book rename proposal created. The user must approve it before the title changes.' }), entityAction: proposal }
    }

    if (call.function.name === 'propose_entity_rename') {""",
)
replace(
    'src/chat-entity-tools.ts',
    """  const entity = await manageableEntity(message.bookId, proposal.entityId ?? '')
  if (proposal.expectedUpdatedAt !== undefined && entity.updatedAt !== proposal.expectedUpdatedAt) {""",
    """  const entity = proposal.entityType === 'book'
    ? await getEntity<ArcEntity>(proposal.entityId ?? '')
    : await manageableEntity(message.bookId, proposal.entityId ?? '')
  if (!entity || (proposal.entityType === 'book' ? entity.type !== 'book' || entity.id !== message.bookId : false)) {
    await setActionStatus(message, proposal.id, { status: 'stale' })
    throw new Error('The proposed item is no longer available in this book.')
  }
  if (proposal.expectedUpdatedAt !== undefined && entity.updatedAt !== proposal.expectedUpdatedAt) {""",
)
replace(
    'src/chat-request.ts',
    "You can inspect and propose edits to Scenes, Notes, and Codex entries in this book. You can propose creating Notes and Codex entries, renaming or deleting Notes/Codex entries, and changing a Codex category.",
    "You can inspect and propose edits to Scenes, Notes, and Codex entries in this book. You can propose renaming the current Book, creating Notes and Codex entries, renaming or deleting Notes/Codex entries, and changing a Codex category.",
)
replace(
    'src/ChatFeature.tsx',
    "const typeLabel = proposal.entityType === 'codexEntry' ? 'Codex' : 'Note'",
    "const typeLabel = proposal.entityType === 'book' ? 'Book' : proposal.entityType === 'codexEntry' ? 'Codex' : 'Note'",
)
replace('src/ChatFeature.tsx', "[Note/Codex proposals:", "[Entity proposals:")
replace('src/App.tsx', "[Note/Codex proposals:", "[Entity proposals:")
replace('src/ChatFeature.tsx', "Could not apply the Note/Codex proposal.", "Could not apply the entity proposal.")
replace('src/ChatFeature.tsx', "Could not reject the Note/Codex proposal.", "Could not reject the entity proposal.")

# Workspace wiring.
replace(
    'src/Workspace.tsx',
    "import { buildSummarySource, getSummaryStateMap, renderSummaryPrompt, type SummaryState } from './summary-service'\n",
    "import { buildSummarySource, getSummaryStateMap, renderSummaryPrompt, type SummaryState } from './summary-service'\nimport { generateAutotitleSuggestion, prepareAutotitleRequest, type AutotitleEntity, type AutotitleRequest, type AutotitleTargetType } from './autotitle-service'\n",
)
replace('src/Workspace.tsx', "import './codex-summary.css'\n", "import './codex-summary.css'\nimport './autotitle.css'\n")
replace(
    'src/Workspace.tsx',
    "type ToastMessage = { id: number; message: string }\n",
    "type ToastMessage = { id: number; message: string }\ntype AutotitleUiState = { targetId: string; targetType: AutotitleTargetType; targetTitle: string; status: 'loading' | 'ready' | 'error'; suggestion?: string; error?: string; request?: AutotitleRequest }\n",
)
replace(
    'src/Workspace.tsx',
    "  const [toast, setToast] = useState<ToastMessage | null>(null)\n",
    "  const [toast, setToast] = useState<ToastMessage | null>(null)\n  const [autotitle, setAutotitle] = useState<AutotitleUiState | null>(null)\n",
)
replace(
    'src/Workspace.tsx',
    "  const generationAbortRef = useRef<AbortController | null>(null)\n",
    "  const generationAbortRef = useRef<AbortController | null>(null)\n  const autotitleAbortRef = useRef<AbortController | null>(null)\n",
)
replace(
    'src/Workspace.tsx',
    """  useEffect(() => () => {
    generationAbortRef.current?.abort()
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
  }, [])""",
    """  useEffect(() => () => {
    generationAbortRef.current?.abort()
    autotitleAbortRef.current?.abort()
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
  }, [])""",
)
replace(
    'src/Workspace.tsx',
    """        const structural = await reloadBookContent(detail.bookId!)
        if (activeDocumentIdRef.current && detail.deletedIds?.includes(activeDocumentIdRef.current)) {""",
    """        const structural = await reloadBookContent(detail.bookId!)
        if (detail.entityId === currentBook?.id) {
          const refreshedBook = await getEntity<BookEntity>(detail.bookId!)
          if (refreshedBook?.type === 'book') {
            setCurrentBook(refreshedBook)
            setBookList((books) => books.map((book) => book.id === refreshedBook.id ? refreshedBook : book))
          }
        }
        if (activeDocumentIdRef.current && detail.deletedIds?.includes(activeDocumentIdRef.current)) {""",
)

# Autotitle state machine goes beside toast helper.
replace(
    'src/Workspace.tsx',
    """  function showToast(message: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast({ id: Date.now(), message })
    toastTimerRef.current = setTimeout(() => setToast(null), 5200)
  }

  function startGenerationActivity""",
    """  function showToast(message: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast({ id: Date.now(), message })
    toastTimerRef.current = setTimeout(() => setToast(null), 5200)
  }

  async function startAutotitle(entity: AutotitleEntity) {
    if (!currentBook) return
    if (autotitleAbortRef.current) {
      showToast('Finish or cancel the current autotitle request first.')
      return
    }
    if (entity.type !== 'book' && entity.bookId !== currentBook.id) return
    try {
      if (activeDocumentIdRef.current === entity.id && changedSinceSnapshotRef.current) await flushDocument('navigation', true)
      const defaults = loadAiSettings()
      const settings = await getBookAiSettings(currentBook.id, defaults.favorites)
      const controller = new AbortController()
      autotitleAbortRef.current = controller
      setAutotitle({ targetId: entity.id, targetType: entity.type as AutotitleTargetType, targetTitle: entity.title, status: 'loading' })
      const request = await prepareAutotitleRequest(currentBook.id, entity.id, settings)
      setAutotitle((current) => current?.targetId === entity.id ? { ...current, request, targetTitle: request.targetTitle } : current)
      const suggestion = await generateAutotitleSuggestion(settings, request, controller.signal)
      setAutotitle((current) => current?.targetId === entity.id ? { ...current, request, suggestion, status: 'ready', error: undefined } : current)
    } catch (error) {
      const aborted = autotitleAbortRef.current?.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')
      setAutotitle((current) => current?.targetId === entity.id ? { ...current, status: 'error', error: aborted ? 'Autotitle stopped.' : error instanceof Error ? error.message : 'Autotitle failed.' } : current)
    } finally {
      autotitleAbortRef.current = null
    }
  }

  async function regenerateAutotitle() {
    const targetId = autotitle?.targetId
    if (!targetId || autotitleAbortRef.current) return
    const entity = await getEntity<ArcEntity>(targetId)
    if (!entity || !['book', 'act', 'chapter', 'scene', 'note', 'codexEntry'].includes(entity.type)) {
      setAutotitle((current) => current ? { ...current, status: 'error', error: 'This item no longer exists.' } : current)
      return
    }
    await startAutotitle(entity as AutotitleEntity)
  }

  function stopAutotitle() {
    autotitleAbortRef.current?.abort()
  }

  async function acceptAutotitle() {
    if (!autotitle?.request || !autotitle.suggestion) return
    try {
      const current = await getEntity<ArcEntity>(autotitle.request.targetId)
      if (!current || current.updatedAt !== autotitle.request.expectedUpdatedAt || current.title !== autotitle.request.targetTitle) {
        throw new Error('This item changed after the suggestion was generated. Regenerate before applying a title.')
      }
      const renamed = await renameEntity(current.id, autotitle.suggestion)
      if (renamed.type === 'book') {
        const book = renamed as BookEntity
        setCurrentBook((value) => value?.id === book.id ? book : value)
        setBookList((books) => books.map((item) => item.id === book.id ? book : item))
      } else if (currentBook) {
        await reloadBookContent(currentBook.id)
        if (activeDocumentIdRef.current === renamed.id) {
          const refreshed = await getEntity<EditableEntity>(renamed.id)
          if (refreshed) setActiveDocument(refreshed)
        }
      }
      showToast(`Renamed “${autotitle.request.targetTitle}” to “${autotitle.suggestion}”.`)
      setAutotitle(null)
    } catch (error) {
      setAutotitle((state) => state ? { ...state, status: 'error', error: error instanceof Error ? error.message : 'Could not apply the title.' } : state)
    }
  }

  function startGenerationActivity""",
)

# Suggestion panel near existing modal/toast area.
replace(
    'src/Workspace.tsx',
    """      {generationDetailsOpen && generationDetails && <GenerationDetailsDialog details={generationDetails} elapsedSeconds={generationElapsedSeconds} onClose={() => setGenerationDetailsOpen(false)} />}

      {screen === 'editor' ?""",
    """      {generationDetailsOpen && generationDetails && <GenerationDetailsDialog details={generationDetails} elapsedSeconds={generationElapsedSeconds} onClose={() => setGenerationDetailsOpen(false)} />}
      {autotitle && <AutotitlePanel state={autotitle} onAccept={() => { void acceptAutotitle() }} onRegenerate={() => { void regenerateAutotitle() }} onStop={stopAutotitle} onCancel={() => { autotitleAbortRef.current?.abort(); setAutotitle(null) }} />}

      {screen === 'editor' ?""",
)

# Opened Note/Codex header action.
regex(
    'src/Workspace.tsx',
    r"\{\(activeDocument\?\.type === 'note' \|\| activeDocument\?\.type === 'codexEntry'\) && <div className=\{`document-titlebar \$\{activeCodexArchived \? 'archived' : ''\}`\}><div><small>\{activeDocument\.type === 'note' \? 'Note' : activeCodexArchived \? `Archived · \$\{activeDocument\.category\}` : activeDocument\.category\}</small><h1>\{activeDocument\.title\}</h1></div><div className=\"document-title-actions\">",
    "{(activeDocument?.type === 'note' || activeDocument?.type === 'codexEntry') && <div className={`document-titlebar ${activeCodexArchived ? 'archived' : ''}`}><div><small>{activeDocument.type === 'note' ? 'Note' : activeCodexArchived ? `Archived · ${activeDocument.category}` : activeDocument.category}</small><h1>{activeDocument.title}</h1></div><div className=\"document-title-actions\"><button className=\"autotitle-trigger\" type=\"button\" onClick={() => { void startAutotitle(activeDocument) }} aria-label={`Autotitle ${activeDocument.title}`} title=\"Autotitle\"><WandSparkles aria-hidden=\"true\" /></button>",
)

# Home Book title action.
replace(
    'src/Workspace.tsx',
    """<div className="library-book-actions"><button type="button" onClick={() => { void editBookTitle(book) }} aria-label={`Rename ${book.title}`}><Pencil aria-hidden="true" /></button>""",
    """<div className="library-book-actions"><button className="autotitle-trigger" type="button" onClick={() => { void startAutotitle(book) }} aria-label={`Autotitle ${book.title}`} title="Autotitle"><WandSparkles aria-hidden="true" /></button><button type="button" onClick={() => { void editBookTitle(book) }} aria-label={`Rename ${book.title}`}><Pencil aria-hidden="true" /></button>""",
)

# Pass autotitle callbacks into lists.
replace(
    'src/Workspace.tsx',
    """onOpenSummary={(entity) => { void openSummary(entity) }} onCreate={(type, parentId) => { void addOutlineEntity(type, parentId) }} onRename={(entity) => { void editOutlineTitle(entity) }}""",
    """onOpenSummary={(entity) => { void openSummary(entity) }} onCreate={(type, parentId) => { void addOutlineEntity(type, parentId) }} onAutotitle={(entity) => { void startAutotitle(entity) }} onRename={(entity) => { void editOutlineTitle(entity) }}""",
)
replace(
    'src/Workspace.tsx',
    """<Notes notes={notes} activeId={activeDocument?.type === 'note' ? activeDocument.id : null} onCreate={() => { void addNote() }} onOpen={(id) => { void loadDocument(id) }} onRename={(entity) => { void renameContentEntity(entity) }}""",
    """<Notes notes={notes} activeId={activeDocument?.type === 'note' ? activeDocument.id : null} onCreate={() => { void addNote() }} onOpen={(id) => { void loadDocument(id) }} onAutotitle={(entity) => { void startAutotitle(entity) }} onRename={(entity) => { void renameContentEntity(entity) }}""",
)
replace(
    'src/Workspace.tsx',
    """onOpenSummary={(entity) => { void openSummary(entity) }} onRename={(entity) => { void renameContentEntity(entity) }} onArchive""",
    """onOpenSummary={(entity) => { void openSummary(entity) }} onAutotitle={(entity) => { void startAutotitle(entity) }} onRename={(entity) => { void renameContentEntity(entity) }} onArchive""",
)

# Outline prop plumbing and button before Rename.
replace('src/Workspace.tsx', "  onRename: (entity: StructuralEntity) => void\n", "  onAutotitle: (entity: StructuralEntity) => void\n  onRename: (entity: StructuralEntity) => void\n",  )
replace('src/Workspace.tsx', "function Outline({ book, entities, activeSceneId, summaryStates, expandedIds, onToggle, onOpenScene, onOpenSummary, onCreate, onRename, onMove, onDelete }: OutlineProps)", "function Outline({ book, entities, activeSceneId, summaryStates, expandedIds, onToggle, onOpenScene, onOpenSummary, onCreate, onAutotitle, onRename, onMove, onDelete }: OutlineProps)")
# Every OutlineRow invocation already carries named props; insert after onCreate.
Path('src/Workspace.tsx').write_text(Path('src/Workspace.tsx').read_text().replace('onCreate={onCreate} onRename={onRename}', 'onCreate={onCreate} onAutotitle={onAutotitle} onRename={onRename}'))
replace(
    'src/Workspace.tsx',
    """  onCreate: (type: StructuralEntityType, parentId: string) => void
  onRename: (entity: StructuralEntity) => void
  onMove:""",
    """  onCreate: (type: StructuralEntityType, parentId: string) => void
  onAutotitle: (entity: StructuralEntity) => void
  onRename: (entity: StructuralEntity) => void
  onMove:""",
)
replace(
    'src/Workspace.tsx',
    """      {entity.type === 'chapter' && <button type="button" onClick={() => onCreate('scene', entity.id)} aria-label={`Add scene to ${entity.title}`} title="Add scene"><Plus aria-hidden="true" /></button>}
      <button type="button" onClick={() => onRename(entity)} aria-label={`Rename ${entity.title}`} title="Rename"><Pencil aria-hidden="true" /></button>""",
    """      {entity.type === 'chapter' && <button type="button" onClick={() => onCreate('scene', entity.id)} aria-label={`Add scene to ${entity.title}`} title="Add scene"><Plus aria-hidden="true" /></button>}
      <button className="autotitle-trigger" type="button" onClick={() => onAutotitle(entity)} aria-label={`Autotitle ${entity.title}`} title="Autotitle"><WandSparkles aria-hidden="true" /></button>
      <button type="button" onClick={() => onRename(entity)} aria-label={`Rename ${entity.title}`} title="Rename"><Pencil aria-hidden="true" /></button>""",
)

# Notes prop + action.
replace("function Notes({ notes, activeId, onCreate, onOpen, onRename, onDelete }: {", "function Notes({ notes, activeId, onCreate, onOpen, onAutotitle, onRename, onDelete }: {")
replace("  onOpen: (id: string) => void\n  onRename: (entity: NoteEntity) => void", "  onOpen: (id: string) => void\n  onAutotitle: (entity: NoteEntity) => void\n  onRename: (entity: NoteEntity) => void")
replace(
    'src/Workspace.tsx',
    """<div className="content-actions"><button type="button" onClick={() => onRename(note)} aria-label={`Rename ${note.title}`}><Pencil aria-hidden="true" /></button>""",
    """<div className="content-actions"><button className="autotitle-trigger" type="button" onClick={() => onAutotitle(note)} aria-label={`Autotitle ${note.title}`} title="Autotitle"><WandSparkles aria-hidden="true" /></button><button type="button" onClick={() => onRename(note)} aria-label={`Rename ${note.title}`}><Pencil aria-hidden="true" /></button>""",
)

# Codex prop + action in active rows only (archived entries are deliberately not autotitled).
replace("function Codex({ entries, activeId, summaryStates, onCreate, onOpen, onOpenSummary, onRename, onArchive, onRestore, onDelete }: {", "function Codex({ entries, activeId, summaryStates, onCreate, onOpen, onOpenSummary, onAutotitle, onRename, onArchive, onRestore, onDelete }: {")
replace("  onOpenSummary: (entity: CodexEntryEntity) => void\n  onRename: (entity: CodexEntryEntity) => void", "  onOpenSummary: (entity: CodexEntryEntity) => void\n  onAutotitle: (entity: CodexEntryEntity) => void\n  onRename: (entity: CodexEntryEntity) => void")
replace(
    'src/Workspace.tsx',
    """{showArchived ? <button type="button" onClick={() => onRestore(entry)} aria-label={`Restore ${entry.title}`} title="Restore"><ArchiveRestore aria-hidden="true" /></button> : <><button type="button" onClick={() => onRename(entry)} aria-label={`Rename ${entry.title}`} title="Rename">""",
    """{showArchived ? <button type="button" onClick={() => onRestore(entry)} aria-label={`Restore ${entry.title}`} title="Restore"><ArchiveRestore aria-hidden="true" /></button> : <><button className="autotitle-trigger" type="button" onClick={() => onAutotitle(entry)} aria-label={`Autotitle ${entry.title}`} title="Autotitle"><WandSparkles aria-hidden="true" /></button><button type="button" onClick={() => onRename(entry)} aria-label={`Rename ${entry.title}`} title="Rename">""",
)

# Central compact suggestion UI.
insert_before = "function GenerationDetailsDialog({ details, elapsedSeconds, onClose }: {"
p = Path('src/Workspace.tsx')
text = p.read_text()
if insert_before not in text:
    raise SystemExit('Missing GenerationDetailsDialog marker')
panel = r'''function AutotitlePanel({ state, onAccept, onRegenerate, onStop, onCancel }: { state: AutotitleUiState; onAccept: () => void; onRegenerate: () => void; onStop: () => void; onCancel: () => void }) {
  const label = state.targetType === 'codexEntry' ? 'Codex entry' : state.targetType[0].toUpperCase() + state.targetType.slice(1)
  const diagnostics = state.request?.diagnostics
  return <section className="autotitle-panel" role="dialog" aria-label={`Autotitle ${state.targetTitle}`}>
    <header><div><small>Autotitle · {label}</small><strong>{state.targetTitle}</strong></div><button type="button" onClick={onCancel} aria-label="Cancel autotitle"><X aria-hidden="true" /></button></header>
    {state.status === 'loading' ? <div className="autotitle-suggestion">Generating one suggestion…</div> : state.suggestion ? <div className="autotitle-suggestion">{state.suggestion}</div> : null}
    {state.error && <p className="autotitle-error" role="alert">{state.error}</p>}
    {state.request && <><div className="autotitle-meta">Model: {state.request.model}{diagnostics ? ` · ~${diagnostics.requestTokens.toLocaleString()} input tokens · ${Math.round(diagnostics.usageRatio * 100)}% of usable context` : ''}</div><details className="autotitle-request"><summary>View app-managed request</summary><pre>{`SYSTEM:\n${state.request.systemPrompt}\n\nUSER:\n${state.request.userMessage}`}</pre></details></>}
    <div className="autotitle-actions">{state.status === 'loading' ? <button type="button" onClick={onStop}><Square aria-hidden="true" /> Stop</button> : <><button type="button" onClick={onCancel}>Cancel</button><button type="button" onClick={onRegenerate}><RefreshCw aria-hidden="true" /> Regenerate</button>{state.suggestion && <button className="primary" type="button" onClick={onAccept}><Check aria-hidden="true" /> Accept</button>}</>}</div>
  </section>
}

'''
p.write_text(text.replace(insert_before, panel + insert_before, 1))

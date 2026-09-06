from pathlib import Path
import re

p = Path('src/Workspace.tsx')
text = p.read_text()


def replace_once(old: str, new: str, label: str):
    global text
    if old not in text:
        raise SystemExit(f'{label} not found')
    text = text.replace(old, new, 1)

replace_once(
    "import { applyIfStillCurrent } from './async-state-guard'\n",
    "import { applyIfStillCurrent } from './async-state-guard'\nimport { LatestAsyncIntent, bookScopeMatches, documentBelongsToBook } from './book-scope-guard'\n",
    'book scope import',
)

replace_once(
    "  const currentBookIdRef = useRef<string | null>(currentBook?.id ?? null)\n  const screenRef = useRef<Screen>(screen)\n",
    "  const currentBookIdRef = useRef<string | null>(currentBook?.id ?? null)\n  const bookOpenIntentRef = useRef(new LatestAsyncIntent())\n  const documentLoadIntentRef = useRef(new LatestAsyncIntent())\n  const bookRefreshIntentRef = useRef(new LatestAsyncIntent())\n  const screenRef = useRef<Screen>(screen)\n",
    'scope refs',
)

# Make event refreshes post-await book-safe.
pattern = re.compile(r"  useEffect\(\(\) => \{\n    const handleEntityChanged = \(event: Event\) => \{[\s\S]*?\n  \}, \[currentBook\?\.id\]\)\n", re.M)
replacement = r'''  useEffect(() => {
    const handleEntityChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ bookId?: string; entityId?: string; deletedIds?: string[] }>).detail
      const expectedBookId = detail?.bookId
      if (!expectedBookId || !detail?.entityId || !bookScopeMatches(expectedBookId, currentBookIdRef.current)) return
      void (async () => {
        const structural = await reloadBookContent(expectedBookId)
        if (!structural || !bookScopeMatches(expectedBookId, currentBookIdRef.current)) return

        if (detail.entityId === expectedBookId) {
          const refreshedBook = await getEntity<BookEntity>(expectedBookId)
          if (!bookScopeMatches(expectedBookId, currentBookIdRef.current)) return
          if (refreshedBook?.type === 'book') {
            setCurrentBook(refreshedBook)
            setBookList((books) => books.map((book) => book.id === refreshedBook.id ? refreshedBook : book))
          }
        }

        if (!bookScopeMatches(expectedBookId, currentBookIdRef.current)) return
        if (activeDocumentIdRef.current && detail.deletedIds?.includes(activeDocumentIdRef.current)) {
          const fallback = structural.find((entity) => entity.type === 'scene')
          if (fallback) {
            await loadDocument(fallback.id, false)
          } else if (bookScopeMatches(expectedBookId, currentBookIdRef.current)) {
            activeDocumentIdRef.current = null
            activeSceneIdRef.current = null
            setActiveSceneId(null)
            setActiveDocument(null)
            storyRef.current = ''
            changedSinceSnapshotRef.current = false
            setStoryMarkdown('')
            setEditorRevision((revision) => revision + 1)
            setSaveState('saved')
          }
          return
        }
        if (activeDocumentIdRef.current !== detail.entityId) return
        const refreshed = await getEntity<EditableEntity>(detail.entityId)
        if (!bookScopeMatches(expectedBookId, currentBookIdRef.current)) return
        if (!refreshed || !['scene', 'note', 'codexEntry', 'summary'].includes(refreshed.type) || !documentBelongsToBook(refreshed.bookId, expectedBookId)) return
        setActiveDocument(refreshed)
        const content = String(refreshed.content ?? '')
        storyRef.current = content
        changedSinceSnapshotRef.current = false
        setStoryMarkdown(content)
        setEditorRevision((revision) => revision + 1)
        setSaveState('saved')
      })().catch(() => {
        if (bookScopeMatches(expectedBookId, currentBookIdRef.current)) showToast('The edited document was saved, but the workspace could not refresh it.')
      })
    }
    window.addEventListener('arc-entity-changed', handleEntityChanged)
    return () => window.removeEventListener('arc-entity-changed', handleEntityChanged)
  }, [currentBook?.id])
'''
text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit(f'entity event replacement count={count}')

# Initial hydration is itself a latest book-open intent and commits only after every read settles.
replace_once(
    "  useEffect(() => {\n    let cancelled = false\n    ;(async () => {\n",
    "  useEffect(() => {\n    let cancelled = false\n    const initialBookIntent = bookOpenIntentRef.current.begin()\n    ;(async () => {\n",
    'initial intent start',
)

old_init = """        const entities = book ? await listEntitiesByBook(book.id) : []
        const structural = entities.filter((entity): entity is StructuralEntity => ['act', 'chapter', 'scene'].includes(entity.type))
        const scene = entities.find((entity) => entity.id === PROTOTYPE_SCENE_ID && entity.type === 'scene')
          ?? entities.find((entity) => entity.type === 'scene')
        if (cancelled) return
        setBookList(books)
        setSeriesList(availableSeries)
        setCurrentBook(book ?? null)
        setOutlineEntities(structural)
        setNotes(entities.filter((entity): entity is NoteEntity => entity.type === 'note'))
        setCodexEntries(entities.filter((entity): entity is CodexEntryEntity => entity.type === 'codexEntry'))
        setSummaryStates(book ? await getSummaryStateMap(book.id) : {})
        if (book && scene) await rememberLastOpenedScene(book.id, scene.id)
        activeDocumentIdRef.current = scene?.id ?? null
"""
new_init = """        const entities = book ? await listEntitiesByBook(book.id) : []
        const structural = entities.filter((entity): entity is StructuralEntity => ['act', 'chapter', 'scene'].includes(entity.type))
        const scene = entities.find((entity) => entity.id === PROTOTYPE_SCENE_ID && entity.type === 'scene')
          ?? entities.find((entity) => entity.type === 'scene')
        const initialSummaryStates = book ? await getSummaryStateMap(book.id) : {}
        if (book && scene) await rememberLastOpenedScene(book.id, scene.id)
        if (cancelled || !bookOpenIntentRef.current.isCurrent(initialBookIntent)) return
        currentBookIdRef.current = book?.id ?? null
        documentLoadIntentRef.current.invalidate()
        bookRefreshIntentRef.current.invalidate()
        setBookList(books)
        setSeriesList(availableSeries)
        setCurrentBook(book ?? null)
        setOutlineEntities(structural)
        setNotes(entities.filter((entity): entity is NoteEntity => entity.type === 'note'))
        setCodexEntries(entities.filter((entity): entity is CodexEntryEntity => entity.type === 'codexEntry'))
        setSummaryStates(initialSummaryStates)
        activeDocumentIdRef.current = scene?.id ?? null
"""
replace_once(old_init, new_init, 'initial hydration commit')

# Replace shared book content refresh + document load + book open as one scope-safe block.
pattern = re.compile(r"  async function reloadBookContent\(bookId: string\) \{[\s\S]*?\n  async function deleteWithSaveBarrier", re.M)
new_navigation = r'''  type LoadedBookContent = {
    structural: StructuralEntity[]
    notes: NoteEntity[]
    codexEntries: CodexEntryEntity[]
    summaryStates: Record<string, SummaryState>
  }

  async function readBookContent(bookId: string): Promise<LoadedBookContent> {
    const entities = await listEntitiesByBook(bookId)
    const summaryStateSnapshot = await getSummaryStateMap(bookId)
    return {
      structural: entities.filter((entity): entity is StructuralEntity => ['act', 'chapter', 'scene'].includes(entity.type)),
      notes: entities.filter((entity): entity is NoteEntity => entity.type === 'note').sort((a, b) => b.updatedAt - a.updatedAt),
      codexEntries: entities.filter((entity): entity is CodexEntryEntity => entity.type === 'codexEntry').sort((a, b) => a.title.localeCompare(b.title)),
      summaryStates: summaryStateSnapshot,
    }
  }

  function applyBookContent(content: LoadedBookContent) {
    setOutlineEntities(content.structural)
    setNotes(content.notes)
    setCodexEntries(content.codexEntries)
    setSummaryStates(content.summaryStates)
  }

  async function reloadBookContent(bookId: string) {
    const intent = bookRefreshIntentRef.current.begin()
    const content = await readBookContent(bookId)
    if (!bookRefreshIntentRef.current.isCurrent(intent) || !bookScopeMatches(bookId, currentBookIdRef.current)) return null
    applyBookContent(content)
    return content.structural
  }

  async function loadDocument(documentId: string, closePanel = true) {
    const expectedBookId = currentBookIdRef.current
    if (!expectedBookId) {
      showToast('Open a book before opening a document.')
      return
    }
    if (documentId === activeDocumentIdRef.current && documentBelongsToBook(activeDocument?.bookId, expectedBookId)) {
      setScreen('editor')
      if (closePanel) setRightOpen(false)
      return
    }
    if (!canUnmountEditor(Boolean(generationAbortRef.current))) {
      showToast('Stop generation before switching documents.')
      return
    }

    const intent = documentLoadIntentRef.current.begin()
    if (!await saveRequiredBeforeNavigation(changedSinceSnapshotRef.current, () => flushDocument('navigation', true))) {
      if (documentLoadIntentRef.current.isCurrent(intent) && bookScopeMatches(expectedBookId, currentBookIdRef.current)) {
        showToast('Could not save the current document. Fix the save problem before switching documents.')
      }
      return
    }
    if (!documentLoadIntentRef.current.isCurrent(intent) || !bookScopeMatches(expectedBookId, currentBookIdRef.current)) return

    const document = await getEntity<ArcEntity>(documentId)
    if (!documentLoadIntentRef.current.isCurrent(intent) || !bookScopeMatches(expectedBookId, currentBookIdRef.current)) return
    if (!document || !['scene', 'note', 'codexEntry', 'summary'].includes(document.type)) {
      showToast('That document is no longer available.')
      return
    }
    const editableDocument = document as EditableEntity
    if (!documentBelongsToBook(editableDocument.bookId, expectedBookId)) {
      showToast('That document belongs to another book and cannot be opened here.')
      return
    }

    if (editableDocument.type === 'scene') {
      await rememberLastOpenedScene(expectedBookId, editableDocument.id)
      if (!documentLoadIntentRef.current.isCurrent(intent) || !bookScopeMatches(expectedBookId, currentBookIdRef.current)) return
    }

    activeDocumentIdRef.current = editableDocument.id
    setActiveDocument(editableDocument)
    if (editableDocument.type === 'scene') {
      activeSceneIdRef.current = editableDocument.id
      setActiveSceneId(editableDocument.id)
      scenePovRef.current = typeof editableDocument.pov === 'string' ? editableDocument.pov : ''
    }
    const content = typeof editableDocument.content === 'string' ? editableDocument.content : ''
    storyRef.current = content
    changedSinceSnapshotRef.current = false
    latestGenerationRequestRef.current = null
    setStoryMarkdown(content)
    setSaveState('saved')
    setScreen('editor')
    if (closePanel) setRightOpen(false)
  }

  async function loadScene(sceneId: string, closePanel = true) {
    await loadDocument(sceneId, closePanel)
  }

  async function openBook(bookId: string, preferredSceneId?: string) {
    if (!canUnmountEditor(Boolean(generationAbortRef.current))) {
      showToast('Stop generation before switching books.')
      return
    }

    const intent = bookOpenIntentRef.current.begin()
    documentLoadIntentRef.current.invalidate()
    bookRefreshIntentRef.current.invalidate()

    if (!await saveRequiredBeforeNavigation(Boolean(activeDocumentIdRef.current && changedSinceSnapshotRef.current), () => flushDocument('navigation', true))) {
      if (bookOpenIntentRef.current.isCurrent(intent)) showToast('Could not save the current document. Fix the save problem before switching books.')
      return
    }
    if (!bookOpenIntentRef.current.isCurrent(intent)) return

    const [book, content] = await Promise.all([
      getEntity<BookEntity>(bookId),
      readBookContent(bookId),
    ])
    if (!bookOpenIntentRef.current.isCurrent(intent)) return
    if (!book || book.type !== 'book') {
      showToast('That book is no longer available.')
      return
    }

    const scene = content.structural.find((entity) => entity.id === preferredSceneId && entity.type === 'scene')
      ?? content.structural.find((entity) => entity.type === 'scene')
    if (scene) {
      await rememberLastOpenedScene(book.id, scene.id)
      if (!bookOpenIntentRef.current.isCurrent(intent)) return
    }

    currentBookIdRef.current = book.id
    setCurrentBook(book)
    applyBookContent(content)
    setExpandedIds(new Set(content.structural.filter((entity) => entity.type !== 'scene').map((entity) => entity.id)))
    activeDocumentIdRef.current = scene?.id ?? null
    setActiveDocument(scene ?? null)
    activeSceneIdRef.current = scene?.id ?? null
    setActiveSceneId(scene?.id ?? null)
    scenePovRef.current = scene && typeof scene.pov === 'string' ? scene.pov : ''
    const sceneContent = scene && typeof scene.content === 'string' ? scene.content : ''
    storyRef.current = sceneContent
    setStoryMarkdown(sceneContent)
    changedSinceSnapshotRef.current = false
    latestGenerationRequestRef.current = null
    setSaveState('saved')
    setScreen('editor')
    setRightOpen(false)
  }

  async function deleteWithSaveBarrier'''
text, count = pattern.subn(new_navigation, text, count=1)
if count != 1:
    raise SystemExit(f'navigation block replacement count={count}')

# Any consumer that needs the returned structural list must stop on a stale reload.
replace_once(
    "    const entities = await reloadBookContent(currentBook.id)\n    if (activeDocumentIdRef.current && removedIds.includes(activeDocumentIdRef.current)) {\n",
    "    const entities = await reloadBookContent(currentBook.id)\n    if (!entities) return\n    if (activeDocumentIdRef.current && removedIds.includes(activeDocumentIdRef.current)) {\n",
    'remove outline stale reload',
)

# Do not proceed from old-book create flows when their refresh lost ownership.
replace_once(
    "      await reloadBookContent(currentBook.id)\n      if (entity.type === 'scene') await loadScene(entity.id)\n",
    "      const refreshed = await reloadBookContent(currentBook.id)\n      if (!refreshed) return\n      if (entity.type === 'scene') await loadScene(entity.id)\n",
    'add outline stale reload',
)
replace_once(
    "      const note = await createNote(currentBook.id)\n      await reloadBookContent(currentBook.id)\n      await loadDocument(note.id)\n",
    "      const sourceBookId = currentBook.id\n      const note = await createNote(sourceBookId)\n      if (!await reloadBookContent(sourceBookId)) return\n      await loadDocument(note.id)\n",
    'add note stale reload',
)
replace_once(
    "      const entry = await createCodexEntry(currentBook.id)\n      await reloadBookContent(currentBook.id)\n      await loadDocument(entry.id)\n",
    "      const sourceBookId = currentBook.id\n      const entry = await createCodexEntry(sourceBookId)\n      if (!await reloadBookContent(sourceBookId)) return\n      await loadDocument(entry.id)\n",
    'add codex stale reload',
)

# Summary refresh after opening is also book-scoped.
old_summary = """  async function openSummary(source: StructuralEntity | CodexEntryEntity) {
    try {
      const summary = await getOrCreateSummary(source)
      await loadDocument(summary.id)
      if (currentBook) setSummaryStates(await getSummaryStateMap(currentBook.id))
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not open the summary.')
    }
  }
"""
new_summary = """  async function openSummary(source: StructuralEntity | CodexEntryEntity) {
    const sourceBookId = source.bookId
    try {
      const summary = await getOrCreateSummary(source)
      if (!bookScopeMatches(sourceBookId, currentBookIdRef.current)) return
      await loadDocument(summary.id)
      if (!bookScopeMatches(sourceBookId, currentBookIdRef.current)) return
      const states = await getSummaryStateMap(sourceBookId)
      if (bookScopeMatches(sourceBookId, currentBookIdRef.current)) setSummaryStates(states)
    } catch (error) {
      if (bookScopeMatches(sourceBookId, currentBookIdRef.current)) showToast(error instanceof Error ? error.message : 'Could not open the summary.')
    }
  }
"""
replace_once(old_summary, new_summary, 'open summary book scope')

# Invalidate every outstanding book/document/refresh intent when the active Book is removed.
replace_once(
    "    if (currentBook?.id === book.id) {\n      setCurrentBook(null)\n",
    "    if (currentBook?.id === book.id) {\n      bookOpenIntentRef.current.invalidate()\n      documentLoadIntentRef.current.invalidate()\n      bookRefreshIntentRef.current.invalidate()\n      currentBookIdRef.current = null\n      setCurrentBook(null)\n",
    'remove current book invalidate',
)
replace_once(
    "    setBookList(books)\n    setCurrentBook(null)\n    setOutlineEntities([])\n",
    "    setBookList(books)\n    bookOpenIntentRef.current.invalidate()\n    documentLoadIntentRef.current.invalidate()\n    bookRefreshIntentRef.current.invalidate()\n    currentBookIdRef.current = null\n    setCurrentBook(null)\n    setOutlineEntities([])\n",
    'settings remove book invalidate',
)

p.write_text(text)

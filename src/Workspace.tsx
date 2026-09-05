import { useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bot,
  BookOpenText,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Feather,
  FileQuestion,
  FileText,
  GitFork,
  MessageCircle,
  Mic,
  NotebookPen,
  PanelBottomOpen,
  Pencil,
  Play,
  Plus,
  Redo2,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Square,
  Trash2,
  Undo2,
  Volume2,
  WandSparkles,
  X,
} from 'lucide-react'
import AiSettingsScreen from './App'
import { generationWordDelayMs, loadAiSettings, type AiSettings } from './ai-settings'
import { createBufferedWordRenderer } from './buffered-word-renderer'
import ExpandableTextInput from './ExpandableTextInput'
import MarkdownEditor, { type MarkdownEditorHandle } from './MarkdownEditor'
import { fetchNanoGPTModelContextLength, renderLorePrompt, renderStoryPrompt, streamNanoGPTCompletion } from './nanogpt'
import type { BookPromptValues } from './prompt-template'
import { buildContextValues, generationContextDiagnostics } from './context-service'
import {
  PROTOTYPE_BOOK_ID,
  PROTOTYPE_SCENE_ID,
  createBook,
  createCodexEntry,
  createNote,
  createSeries as createSeriesEntity,
  createSnapshot,
  createStructuralEntity,
  deleteEntityTree,
  ensureBookAiSettings,
  ensurePrototypeSeed,
  ensureSeriesLibrary,
  getEntity,
  getBookAiSettings,
  getBookContextSettings,
  getGenerationContextProfile,
  getOrCreateSummary,
  listBooks,
  listEntitiesByBook,
  listSeries,
  moveStructuralEntity,
  renameEntity,
  renameSeries as renameSeriesEntity,
  saveDocumentContent,
  saveBookAiSettings,
  rememberLastOpenedScene,
  saveSummaryContent,
  updateBookMetadata,
  updateCodexCategory,
  type ArcEntity,
  type BookEntity,
  type BookMetadata,
  type CodexEntryEntity,
  type EditableEntity,
  type GenerationContextType,
  type NoteEntity,
  type SnapshotReason,
  type SeriesEntity,
  type StructuralEntity,
  type StructuralEntityType,
  type SummaryEntity,
} from './persistence'
import { buildSummarySource, getSummaryStateMap, renderSummaryPrompt, type SummaryState } from './summary-service'
import { ChatSidebar, ChatView } from './ChatFeature'
import './generation-controls.css'

type Screen = 'home' | 'editor' | 'chat' | 'settings'
type RightTab = 'book' | 'outline' | 'notes' | 'codex' | 'chat'
type ChatPanel = 'list' | 'settings'
type SaveState = 'loading' | 'saving' | 'saved' | 'error'
type GenerationPhase = 'sending' | 'thinking' | 'writing' | 'stopping'
type ToastMessage = { id: number; message: string }
type GenerationRequestSnapshot = {
  baseUrl: string
  model: string
  systemPrompt: string
  contextMessage: string
  userMessage: string
}

const chats = [
  ['Mara’s motivation', 'Her fear of becoming like her father…', 'Now'],
  ['Chapter 7 continuity', 'The compass first appeared in Scene 1…', 'Yesterday'],
  ['Ideas for Act II', 'Three possible costs for crossing…', 'Aug 31'],
]

const initialStoryMarkdown = `# The City Beneath the Tide

_Chapter Seven · The Cartographer's Door_

Mara found the door at low tide, where the old maps insisted there was only sea.

It stood alone in the blue hour—cedar darkened by salt, a brass handle warm beneath her palm. Behind it, something knocked **three times**.

She opened her notebook and wrote the rule exactly as her father had taught her:

> Never answer a door that remembers your name.

Then the voice on the other side whispered, _Mara Vale_, and every compass in her satchel turned toward it.`

export default function Workspace() {
  const [screen, setScreen] = useState<Screen>('home')
  const [returnScreen, setReturnScreen] = useState<Screen>('home')
  const [rightOpen, setRightOpen] = useState(false)
  const [rightTab, setRightTab] = useState<RightTab>('outline')
  const [chatPanel, setChatPanel] = useState<ChatPanel>('list')
  const [activeChatId, setActiveChatId] = useState('')
  const [arcOpen, setArcOpen] = useState(false)
  const [storyMarkdown, setStoryMarkdown] = useState(initialStoryMarkdown)
  const [arcPrompt, setArcPrompt] = useState('')
  const [lorePrompt, setLorePrompt] = useState('')
  const [chatEdit, setChatEdit] = useState(false)
  const [aiReady, setAiReady] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('loading')
  const [generationActive, setGenerationActive] = useState(false)
  const [generationPhase, setGenerationPhase] = useState<GenerationPhase | null>(null)
  const [generationElapsedSeconds, setGenerationElapsedSeconds] = useState(0)
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [bookList, setBookList] = useState<BookEntity[]>([])
  const [seriesList, setSeriesList] = useState<SeriesEntity[]>([])
  const [currentBook, setCurrentBook] = useState<BookEntity | null>(null)
  const [outlineEntities, setOutlineEntities] = useState<StructuralEntity[]>([])
  const [notes, setNotes] = useState<NoteEntity[]>([])
  const [codexEntries, setCodexEntries] = useState<CodexEntryEntity[]>([])
  const [summaryStates, setSummaryStates] = useState<Record<string, SummaryState>>({})
  const [activeDocument, setActiveDocument] = useState<EditableEntity | null>(null)
  const [editorRevision, setEditorRevision] = useState(0)
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const editorRef = useRef<MarkdownEditorHandle | null>(null)
  const promptRef = useRef<HTMLTextAreaElement | null>(null)
  const storyRef = useRef(initialStoryMarkdown)
  const activeDocumentIdRef = useRef<string | null>(null)
  const activeSceneIdRef = useRef<string | null>(null)
  const scenePovRef = useRef('')
  const storageReadyRef = useRef(false)
  const changedSinceSnapshotRef = useRef(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const generationAbortRef = useRef<AbortController | null>(null)
  const generationStartedAtRef = useRef(0)
  const latestGenerationRequestRef = useRef<GenerationRequestSnapshot | null>(null)

  useEffect(() => {
    setArcPrompt('')
    setLorePrompt('')
  }, [activeDocument?.id])

  useEffect(() => {
    const settings = loadAiSettings()
    setAiReady(settings.provider === 'nanogpt' && Boolean(settings.apiKey.trim() && settings.mainModel.trim()))
  }, [])

  useEffect(() => () => {
    generationAbortRef.current?.abort()
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
  }, [])

  useEffect(() => {
    const handleEntityChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ bookId?: string; entityId?: string }>).detail
      if (!detail?.bookId || !detail.entityId || detail.bookId !== currentBook?.id) return
      void (async () => {
        await reloadBookContent(detail.bookId!)
        if (activeDocumentIdRef.current !== detail.entityId) return
        const refreshed = await getEntity<EditableEntity>(detail.entityId!)
        if (!refreshed || !['scene', 'note', 'codexEntry', 'summary'].includes(refreshed.type)) return
        setActiveDocument(refreshed)
        const content = String(refreshed.content ?? '')
        storyRef.current = content
        changedSinceSnapshotRef.current = false
        setStoryMarkdown(content)
        setEditorRevision((revision) => revision + 1)
        setSaveState('saved')
      })().catch(() => showToast('The edited document was saved, but the workspace could not refresh it.'))
    }
    window.addEventListener('arc-entity-changed', handleEntityChanged)
    return () => window.removeEventListener('arc-entity-changed', handleEntityChanged)
  }, [currentBook?.id])

  useEffect(() => {
    if (!generationActive) return
    const updateElapsed = () => {
      setGenerationElapsedSeconds(Math.max(0, Math.floor((Date.now() - generationStartedAtRef.current) / 1000)))
    }
    updateElapsed()
    const interval = window.setInterval(updateElapsed, 250)
    return () => window.clearInterval(interval)
  }, [generationActive])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await ensurePrototypeSeed(initialStoryMarkdown)
        const availableSeries = await ensureSeriesLibrary()
        const books = await listBooks()
        const defaults = loadAiSettings()
        await Promise.all(books.map((existingBook) => ensureBookAiSettings(existingBook.id, defaults)))
        const book = books.find((candidate) => candidate.id === PROTOTYPE_BOOK_ID) ?? books[0]
        const entities = book ? await listEntitiesByBook(book.id) : []
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
        activeSceneIdRef.current = scene?.id ?? null
        setActiveSceneId(scene?.id ?? null)
        setActiveDocument((scene as StructuralEntity | undefined) ?? null)
        scenePovRef.current = typeof scene?.pov === 'string' ? scene.pov : ''
        const content = typeof scene?.content === 'string' ? scene.content : ''
        storyRef.current = content
        setStoryMarkdown(content)
        setExpandedIds(new Set(structural.filter((entity) => entity.type !== 'scene').map((entity) => entity.id)))
        storageReadyRef.current = true
        setSaveState('saved')
      } catch (error) {
        console.error('Failed to initialize local persistence', error)
        if (!cancelled) setSaveState('error')
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function flushDocument(reason: SnapshotReason = 'autosave', snapshot = false) {
    const documentId = activeDocumentIdRef.current
    if (!storageReadyRef.current || !documentId) return
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    setSaveState('saving')
    try {
      const current = await getEntity<EditableEntity>(documentId)
      if (!current) throw new Error(`Cannot save missing document ${documentId}`)
      const savedDocument = current.type === 'summary'
        ? await saveSummaryContent(current.id, storyRef.current, (await buildSummarySource(current.sourceEntityId)).sourceRevision)
        : await saveDocumentContent(documentId, storyRef.current) as EditableEntity
      if (snapshot && changedSinceSnapshotRef.current) {
        await createSnapshot(documentId, reason, storyRef.current)
        changedSinceSnapshotRef.current = false
      }
      const editedAt = Date.now()
      setActiveDocument(savedDocument)
      if (savedDocument.type === 'note') setNotes((items) => items.map((item) => item.id === savedDocument.id ? savedDocument : item))
      if (savedDocument.type === 'codexEntry') setCodexEntries((items) => items.map((item) => item.id === savedDocument.id ? savedDocument : item))
      setCurrentBook((book) => book && book.id === savedDocument.bookId ? { ...book, updatedAt: editedAt } : book)
      setBookList((books) => books.map((book) => book.id === savedDocument.bookId ? { ...book, updatedAt: editedAt } : book))
      if (savedDocument.bookId) setSummaryStates(await getSummaryStateMap(savedDocument.bookId))
      setSaveState('saved')
    } catch (error) {
      console.error('Failed to persist document', error)
      setSaveState('error')
    }
  }

  useEffect(() => {
    if (!storageReadyRef.current || !changedSinceSnapshotRef.current) return
    saveTimerRef.current = setTimeout(() => { void flushDocument('autosave', false) }, 750)
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [storyMarkdown])

  useEffect(() => {
    const snapshotInterval = window.setInterval(() => {
      if (changedSinceSnapshotRef.current) void flushDocument('autosave', true)
    }, 3 * 60 * 1000)

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden' && changedSinceSnapshotRef.current) void flushDocument('lifecycle', true)
    }
    const handlePageHide = () => {
      if (changedSinceSnapshotRef.current) void flushDocument('lifecycle', true)
    }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('pagehide', handlePageHide)
    return () => {
      window.clearInterval(snapshotInterval)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('pagehide', handlePageHide)
    }
  }, [])

  function handleStoryChange(value: string) {
    storyRef.current = value
    if (generationAbortRef.current && activeDocument?.type === 'codexEntry') {
      setStoryMarkdown(value)
      return
    }
    changedSinceSnapshotRef.current = true
    setStoryMarkdown(value)
    if (storageReadyRef.current) setSaveState('saving')
  }

  async function reloadBookContent(bookId: string) {
    const entities = await listEntitiesByBook(bookId)
    const structural = entities.filter((entity): entity is StructuralEntity => ['act', 'chapter', 'scene'].includes(entity.type))
    setOutlineEntities(structural)
    setNotes(entities.filter((entity): entity is NoteEntity => entity.type === 'note').sort((a, b) => b.updatedAt - a.updatedAt))
    setCodexEntries(entities.filter((entity): entity is CodexEntryEntity => entity.type === 'codexEntry').sort((a, b) => a.title.localeCompare(b.title)))
    setSummaryStates(await getSummaryStateMap(bookId))
    return structural
  }

  async function loadDocument(documentId: string, closePanel = true) {
    if (documentId === activeDocumentIdRef.current) {
      setScreen('editor')
      if (closePanel) setRightOpen(false)
      return
    }
    if (generationAbortRef.current) {
      showToast('Stop generation before switching documents.')
      return
    }
    if (changedSinceSnapshotRef.current) await flushDocument('navigation', true)
    const document = await getEntity<ArcEntity>(documentId)
    if (!document || !['scene', 'note', 'codexEntry', 'summary'].includes(document.type)) {
      showToast('That document is no longer available.')
      return
    }
    const editableDocument = document as EditableEntity
    activeDocumentIdRef.current = editableDocument.id
    setActiveDocument(editableDocument)
    if (editableDocument.type === 'scene') {
      activeSceneIdRef.current = editableDocument.id
      setActiveSceneId(editableDocument.id)
      scenePovRef.current = typeof editableDocument.pov === 'string' ? editableDocument.pov : ''
      await rememberLastOpenedScene(editableDocument.bookId, editableDocument.id)
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
    if (activeDocumentIdRef.current && changedSinceSnapshotRef.current) await flushDocument('navigation', true)
    const book = await getEntity<BookEntity>(bookId)
    if (!book || book.type !== 'book') {
      showToast('That book is no longer available.')
      return
    }
    const entities = await reloadBookContent(bookId)
    const scene = entities.find((entity) => entity.id === preferredSceneId && entity.type === 'scene')
      ?? entities.find((entity) => entity.type === 'scene')
    setCurrentBook(book)
    setExpandedIds(new Set(entities.filter((entity) => entity.type !== 'scene').map((entity) => entity.id)))
    activeDocumentIdRef.current = null
    setActiveDocument(null)
    activeSceneIdRef.current = null
    setActiveSceneId(null)
    storyRef.current = ''
    setStoryMarkdown('')
    changedSinceSnapshotRef.current = false
    if (scene) await loadScene(scene.id, false)
    else setScreen('editor')
  }

  async function makeBook() {
    try {
      const created = await createBook(loadAiSettings())
      setBookList(await listBooks())
      await openBook(created.book.id, created.scene.id)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not create the book.')
    }
  }

  async function editBookTitle(book: BookEntity) {
    const title = window.prompt('Book title', book.title)
    if (title === null || !title.trim()) return
    const updated = await renameEntity(book.id, title) as BookEntity
    setBookList(await listBooks())
    if (currentBook?.id === book.id) {
      setCurrentBook(updated)
    }
  }

  async function removeBook(book: BookEntity) {
    if (!window.confirm(`Delete “${book.title}” and all of its chapters and scenes? This cannot be undone.`)) return
    await deleteEntityTree(book.id)
    const books = await listBooks()
    setBookList(books)
    if (currentBook?.id === book.id) {
      setCurrentBook(null)
      setOutlineEntities([])
      setNotes([])
      setCodexEntries([])
      setSummaryStates({})
      activeDocumentIdRef.current = null
      setActiveDocument(null)
      activeSceneIdRef.current = null
      setActiveSceneId(null)
    }
  }

  async function saveBookMetadata(metadata: BookMetadata) {
    if (!currentBook) return
    const updated = await updateBookMetadata(currentBook.id, metadata)
    setCurrentBook(updated)
    setBookList((books) => books.map((book) => book.id === updated.id ? updated : book))
  }

  async function addSeries(title: string) {
    const created = await createSeriesEntity(title)
    setSeriesList(await listSeries())
    return created
  }

  async function renameSeries(id: string, title: string) {
    const updated = await renameSeriesEntity(id, title)
    setSeriesList(await listSeries())
    return updated
  }

  async function removeCurrentBookFromSettings() {
    if (!currentBook) return
    await deleteEntityTree(currentBook.id)
    const books = await listBooks()
    setBookList(books)
    setCurrentBook(null)
    setOutlineEntities([])
    activeSceneIdRef.current = null
    setActiveSceneId(null)
    setRightOpen(false)
    setScreen('home')
  }

  async function addOutlineEntity(type: StructuralEntityType, parentId: string) {
    if (!currentBook) return
    try {
      const entity = await createStructuralEntity(type, currentBook.id, parentId)
      setExpandedIds((current) => new Set(current).add(parentId))
      await reloadBookContent(currentBook.id)
      if (entity.type === 'scene') await loadScene(entity.id)
    } catch (error) {
      showToast(error instanceof Error ? error.message : `Could not create ${type}.`)
    }
  }

  async function editOutlineTitle(entity: StructuralEntity) {
    const title = window.prompt(`${entity.type[0].toUpperCase()}${entity.type.slice(1)} title`, entity.title)
    if (title === null || !title.trim() || !currentBook) return
    await renameEntity(entity.id, title)
    await reloadBookContent(currentBook.id)
  }

  async function moveOutlineEntity(entity: StructuralEntity, direction: -1 | 1) {
    if (!currentBook) return
    await moveStructuralEntity(entity.id, direction)
    await reloadBookContent(currentBook.id)
  }

  async function removeOutlineEntity(entity: StructuralEntity) {
    if (!currentBook) return
    const nested = outlineEntities.some((candidate) => candidate.parentId === entity.id)
    const warning = nested ? ' All nested content will also be deleted.' : ''
    if (!window.confirm(`Delete “${entity.title}”?${warning} This cannot be undone.`)) return
    const removedIds = await deleteEntityTree(entity.id)
    const entities = await reloadBookContent(currentBook.id)
    if (activeDocumentIdRef.current && removedIds.includes(activeDocumentIdRef.current)) {
      const nextScene = entities.find((candidate) => candidate.type === 'scene')
      activeDocumentIdRef.current = null
      setActiveDocument(null)
      activeSceneIdRef.current = null
      setActiveSceneId(null)
      storyRef.current = ''
      changedSinceSnapshotRef.current = false
      setStoryMarkdown('')
      latestGenerationRequestRef.current = null
      if (nextScene) await loadScene(nextScene.id, false)
    }
  }

  async function openSummary(source: StructuralEntity) {
    try {
      const summary = await getOrCreateSummary(source)
      await loadDocument(summary.id)
      if (currentBook) setSummaryStates(await getSummaryStateMap(currentBook.id))
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not open the summary.')
    }
  }

  async function addNote() {
    if (!currentBook) return
    try {
      const note = await createNote(currentBook.id)
      await reloadBookContent(currentBook.id)
      await loadDocument(note.id)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not create the note.')
    }
  }

  async function addCodexEntry() {
    if (!currentBook) return
    try {
      const entry = await createCodexEntry(currentBook.id)
      await reloadBookContent(currentBook.id)
      await loadDocument(entry.id)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not create the Codex entry.')
    }
  }

  async function renameContentEntity(entity: NoteEntity | CodexEntryEntity) {
    const label = entity.type === 'note' ? 'Note title' : 'Codex entry name'
    const title = window.prompt(label, entity.title)
    if (title === null || !title.trim() || !currentBook) return
    const updated = await renameEntity(entity.id, title) as NoteEntity | CodexEntryEntity
    if (activeDocumentIdRef.current === updated.id) setActiveDocument(updated)
    await reloadBookContent(currentBook.id)
  }

  async function removeContentEntity(entity: NoteEntity | CodexEntryEntity) {
    if (!currentBook || !window.confirm(`Delete “${entity.title}”? This cannot be undone.`)) return
    await deleteEntityTree(entity.id)
    await reloadBookContent(currentBook.id)
    if (activeDocumentIdRef.current === entity.id) {
      activeDocumentIdRef.current = null
      setActiveDocument(null)
      storyRef.current = ''
      setStoryMarkdown('')
      changedSinceSnapshotRef.current = false
      if (activeSceneIdRef.current) await loadScene(activeSceneIdRef.current, false)
    }
  }

  async function changeCodexCategory(category: string) {
    if (activeDocument?.type !== 'codexEntry' || !currentBook) return
    const updated = await updateCodexCategory(activeDocument.id, category)
    setActiveDocument(updated)
    await reloadBookContent(currentBook.id)
  }

  function openSettings(from: Screen) {
    if (from === 'editor' && changedSinceSnapshotRef.current) void flushDocument('navigation', true)
    setReturnScreen(from)
    setScreen('settings')
    setRightOpen(false)
  }

  function openChat(chatId: string) {
    if (screen === 'editor' && changedSinceSnapshotRef.current) void flushDocument('navigation', true)
    setActiveChatId(chatId)
    setChatPanel('list')
    setScreen('chat')
    setRightOpen(false)
  }

  function showToast(message: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast({ id: Date.now(), message })
    toastTimerRef.current = setTimeout(() => setToast(null), 5200)
  }

  function startGenerationActivity() {
    generationStartedAtRef.current = Date.now()
    setGenerationElapsedSeconds(0)
    setGenerationPhase('sending')
    setGenerationActive(true)
  }

  function finishGenerationActivity() {
    setGenerationActive(false)
    setGenerationPhase(null)
    setGenerationElapsedSeconds(0)
  }

  async function runGeneration(mode: 'generate' | 'regenerate') {
    if (generationAbortRef.current) return

    if (!currentBook) {
      showToast('Open a book before generating.')
      return
    }
    if (activeDocument?.type !== 'scene' && activeDocument?.type !== 'codexEntry') {
      showToast('Generation is available while editing a Scene or Codex entry.')
      return
    }
    const isCodex = activeDocument.type === 'codexEntry'

    let settings: AiSettings
    try {
      const defaults = loadAiSettings()
      settings = await getBookAiSettings(currentBook.id, defaults.favorites)
    } catch {
      showToast('This book’s AI settings could not be loaded. Open Book settings and try again.')
      return
    }
    if (settings.provider !== 'nanogpt') {
      showToast('Text generation currently supports NanoGPT only. Choose it in Book settings.')
      return
    }
    if (!settings.apiKey.trim()) {
      showToast('Add your NanoGPT API key in Book settings before generating.')
      return
    }
    const selectedModel = isCodex ? settings.codexModel.trim() || settings.mainModel.trim() : settings.mainModel.trim()
    if (!selectedModel) {
      showToast('Choose a Main model in Book settings before generating.')
      return
    }

    const previousRequest = latestGenerationRequestRef.current
    if (mode === 'regenerate' && !previousRequest) {
      showToast('Generate a passage before using Regenerate.')
      return
    }

    const editor = editorRef.current
    const context = editor?.beginGeneration(mode, isCodex ? 'replace' : 'append')
    if (!editor || !context) {
      showToast(mode === 'regenerate'
        ? 'Regenerate is available only while the latest generated passage is unchanged.'
        : 'The editor is not ready for generation yet.')
      return
    }

    let requestSnapshot: GenerationRequestSnapshot
    if (mode === 'regenerate' && previousRequest) {
      requestSnapshot = previousRequest
    } else {
      try {
        const contextSettings = await getBookContextSettings(currentBook.id)
        const contextType: GenerationContextType = isCodex ? 'codex' : 'scene'
        const profile = await getGenerationContextProfile(currentBook.id, contextType)
        const currentSceneId = isCodex ? contextSettings.lastOpenedSceneId || undefined : activeDocument.id
        const prepared = await buildContextValues({
          bookId: currentBook.id,
          type: contextType,
          currentSceneId,
          currentSceneText: isCodex ? undefined : context.sceneText,
          currentDocumentId: activeDocument.id,
          profile,
        })
        const modelContextLength = (isCodex ? settings.codexModelContextLength || settings.mainModelContextLength : settings.mainModelContextLength)
          ?? await fetchNanoGPTModelContextLength(settings.apiKey.trim(), settings.baseUrl, selectedModel).catch(() => undefined)
        if (modelContextLength) {
          settings = await saveBookAiSettings(currentBook.id, isCodex && settings.codexModel.trim()
            ? { ...settings, codexModelContextLength: modelContextLength }
            : { ...settings, mainModelContextLength: modelContextLength })
        }
        const instruction = isCodex ? lorePrompt : arcPrompt
        const systemPrompt = isCodex
          ? renderLorePrompt(settings.prompts.lore, { book: toBookPromptValues(currentBook, seriesList), entryTitle: activeDocument.title, entryCategory: activeDocument.category, entryContent: context.sceneText, sceneText: prepared.lastSceneText, additionalContext: prepared.additionalContext })
          : renderStoryPrompt(settings.prompts.story, { book: toBookPromptValues(currentBook, seriesList), sceneText: context.sceneText, scenePov: scenePovRef.current || undefined, previousSceneText: prepared.previousSceneText, summaryContext: prepared.summaryContext, additionalContext: prepared.additionalContext })
        const userMessage = `# Instruction\n\n${instruction.trim() || (isCodex ? 'Create a complete Codex entry.' : 'Continue the story.')}`
        const selectedContextIsTemplated = /{{\s*additional_context\s*}}/.test(isCodex ? settings.prompts.lore : settings.prompts.story)
        const contextMessage = !selectedContextIsTemplated && prepared.additionalContext.trim()
          ? `# Additional context\n\n${prepared.additionalContext}`
          : ''
        const diagnostics = generationContextDiagnostics(selectedModel, modelContextLength, systemPrompt, `${contextMessage}\n\n${userMessage}`)
        if (!diagnostics.fits) {
          editor.finishGeneration('error')
          showToast(`Context is too large: ~${diagnostics.requestTokens.toLocaleString()} tokens plus response space for a ${diagnostics.modelContextTokens.toLocaleString()}-token model. Reduce context or choose a larger model.`)
          return
        }
        requestSnapshot = {
          baseUrl: settings.baseUrl,
          model: selectedModel,
          systemPrompt,
          contextMessage,
          userMessage,
        }
      } catch (error) {
        editor.finishGeneration('error')
        showToast(error instanceof Error ? error.message : 'Context could not be prepared.')
        return
      }
    }

    const controller = new AbortController()
    generationAbortRef.current = controller
    startGenerationActivity()
    let status: 'complete' | 'cancelled' | 'error' = 'complete'
    const renderer = createBufferedWordRenderer({
      delayMs: generationWordDelayMs(settings),
      signal: controller.signal,
      onInsert: (text) => {
        if (!editor.appendGenerationChunk(text)) throw new Error('The editor could not insert generated text.')
      },
      onError: () => controller.abort(),
    })

    try {
      await streamNanoGPTCompletion({
        apiKey: settings.apiKey.trim(),
        baseUrl: requestSnapshot.baseUrl,
        model: requestSnapshot.model,
        systemPrompt: requestSnapshot.systemPrompt,
        contextMessage: requestSnapshot.contextMessage,
        userMessage: requestSnapshot.userMessage,
      }, (chunk) => {
        if (!controller.signal.aborted) setGenerationPhase('writing')
        renderer.push(chunk)
      }, controller.signal, {
        onResponse: () => {
          if (!controller.signal.aborted) setGenerationPhase('thinking')
        },
      })
      await renderer.finish()
      if (controller.signal.aborted) status = 'cancelled'
    } catch (error) {
      await renderer.flush().catch(() => undefined)
      const renderingError = renderer.error()
      if (renderingError) {
        status = 'error'
        showToast(renderingError instanceof Error ? renderingError.message : 'Generation stopped unexpectedly.')
      } else if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        status = 'cancelled'
      } else {
        status = 'error'
        showToast(error instanceof Error ? error.message : 'Generation stopped unexpectedly.')
      }
    } finally {
      const result = editor.finishGeneration(status)
      generationAbortRef.current = null
      finishGenerationActivity()
      if (result?.status === 'complete') {
        latestGenerationRequestRef.current = requestSnapshot
        if (isCodex) changedSinceSnapshotRef.current = true
        await flushDocument('generation', true)
      }
    }
  }

  async function runSummaryGeneration() {
    if (generationAbortRef.current || !currentBook || activeDocument?.type !== 'summary') return
    if (changedSinceSnapshotRef.current) await flushDocument('manual', true)

    const summary = await getEntity<SummaryEntity>(activeDocument.id)
    if (!summary || summary.type !== 'summary') {
      showToast('This summary is no longer available.')
      return
    }

    let settings: AiSettings
    try {
      const defaults = loadAiSettings()
      settings = await getBookAiSettings(currentBook.id, defaults.favorites)
    } catch {
      showToast('This book’s AI settings could not be loaded.')
      return
    }
    if (settings.provider !== 'nanogpt' || !settings.apiKey.trim() || !settings.supportModel.trim()) {
      showToast('Choose NanoGPT and a Support model in Book settings before summarizing.')
      return
    }

    const source = await buildSummarySource(summary.sourceEntityId)
    const controller = new AbortController()
    generationAbortRef.current = controller
    startGenerationActivity()
    let generated = ''
    try {
      await streamNanoGPTCompletion({
        apiKey: settings.apiKey.trim(),
        baseUrl: settings.baseUrl,
        model: settings.supportModel,
        systemPrompt: renderSummaryPrompt(settings.prompts.summarize, summary.sourceType, summary.content, toBookPromptValues(currentBook, seriesList)),
        userMessage: `${summary.content.trim() ? `# Existing summary\n\n${summary.content.trim()}\n\n` : ''}# Source material\n\n${source.content}\n\nReturn only the updated summary as Markdown.`,
      }, (chunk) => {
        if (!controller.signal.aborted) setGenerationPhase('writing')
        generated += chunk
      }, controller.signal, {
        onResponse: () => {
          if (!controller.signal.aborted) setGenerationPhase('thinking')
        },
      })
      await createSnapshot(summary.id, 'generation', summary.content)
      const saved = await saveSummaryContent(summary.id, generated, source.sourceRevision)
      activeDocumentIdRef.current = saved.id
      setActiveDocument(saved)
      storyRef.current = saved.content
      setStoryMarkdown(saved.content)
      changedSinceSnapshotRef.current = false
      setEditorRevision((revision) => revision + 1)
      setSummaryStates(await getSummaryStateMap(currentBook.id))
      setSaveState('saved')
    } catch (error) {
      if (!controller.signal.aborted && !(error instanceof DOMException && error.name === 'AbortError')) {
        showToast(error instanceof Error ? error.message : 'Summary generation stopped unexpectedly.')
      }
    } finally {
      generationAbortRef.current = null
      finishGenerationActivity()
    }
  }

  function generate() {
    if (activeDocument?.type === 'summary') void runSummaryGeneration()
    else void runGeneration('generate')
  }

  function regenerate() {
    if (activeDocument?.type === 'summary') void runSummaryGeneration()
    else void runGeneration('regenerate')
  }

  function stopGeneration() {
    if (!generationAbortRef.current) return
    setGenerationPhase('stopping')
    generationAbortRef.current.abort()
  }

  function insertEditorSpeech() {
    editorRef.current?.insertSpeech()
  }

  function insertPromptSpeech() {
    const input = promptRef.current
    const prompt = activeDocument?.type === 'codexEntry' ? lorePrompt : arcPrompt
    const setPrompt = activeDocument?.type === 'codexEntry' ? setLorePrompt : setArcPrompt
    const start = input?.selectionStart ?? prompt.length
    const end = input?.selectionEnd ?? start
    const insert = 'speech placeholder'
    const next = `${prompt.slice(0, start)}${insert}${prompt.slice(end)}`
    setPrompt(next)
    requestAnimationFrame(() => {
      const target = promptRef.current
      if (!target) return
      const cursor = start + insert.length
      target.focus()
      target.setSelectionRange(cursor, cursor)
    })
  }

  const activeScene = activeDocument?.type === 'scene'
    ? activeDocument
    : outlineEntities.find((entity) => entity.id === activeSceneId && entity.type === 'scene')
  const activeChapter = activeScene ? outlineEntities.find((entity) => entity.id === activeScene.parentId && entity.type === 'chapter') : undefined
  const activeAct = activeChapter ? outlineEntities.find((entity) => entity.id === activeChapter.parentId && entity.type === 'act') : undefined
  const summarySource = activeDocument?.type === 'summary'
    ? outlineEntities.find((entity) => entity.id === activeDocument.sourceEntityId)
    : undefined
  const documentPath = activeDocument?.type === 'note'
    ? `Notes / ${activeDocument.title}`
    : activeDocument?.type === 'codexEntry'
      ? `Codex / ${activeDocument.category} / ${activeDocument.title}`
      : activeDocument?.type === 'summary'
        ? `Outline / ${summarySource?.title ?? 'Missing source'} / Summary`
        : ['Outline', activeAct?.title, activeChapter?.title, activeDocument?.title].filter(Boolean).join(' / ')
  const pageLabel = activeDocument?.type === 'note'
    ? 'N'
    : activeDocument?.type === 'codexEntry'
      ? 'C'
      : activeDocument?.type === 'summary'
        ? 'Σ'
        : String((activeChapter?.order ?? 0) + 1).padStart(2, '0')
  const openSummaryState = summarySource ? summaryStates[summarySource.id] ?? 'missing' : 'missing'
  const contextType: GenerationContextType = screen === 'chat' || (screen === 'settings' && returnScreen === 'chat') ? 'chat' : activeDocument?.type === 'codexEntry' ? 'codex' : activeDocument?.type === 'note' ? 'note' : 'scene'

  if (screen === 'settings') return <AiSettingsScreen
    book={returnScreen === 'home' || !currentBook ? undefined : { id: currentBook.id, title: currentBook.title, contextType, currentDocumentId: activeDocument?.id, currentDocumentText: storyMarkdown, promptValues: toBookPromptValues(currentBook, seriesList), chatId: contextType === 'chat' ? activeChatId || undefined : undefined }}
    onHome={() => setScreen('home')}
    onBack={() => setScreen(returnScreen)}
    onSaved={(settings) => {
      if (returnScreen === 'home') setAiReady(settings.provider === 'nanogpt' && Boolean(settings.apiKey.trim() && settings.mainModel.trim()))
    }}
  />

  if (screen === 'home') return (
    <main className="library-screen">
      <header className="library-top"><div className="arc-brand"><Feather aria-hidden="true" /> ARC</div><button type="button" onClick={() => openSettings('home')} aria-label="Open default settings"><Settings2 aria-hidden="true" /></button></header>
      <section className="library-content">
        <div className="library-title"><div><small>Your library</small><h1>Books</h1></div><button type="button" disabled={saveState === 'loading'} onClick={() => { void makeBook() }}><Plus aria-hidden="true" /><span>New book</span></button></div>
        {!aiReady && <div className="setup-warning"><Bot aria-hidden="true" /><div><strong>Text AI is not set up</strong><p>Choose a provider and models before using generation or chat.</p></div><button type="button" onClick={() => openSettings('home')}>Set up AI <ChevronRight aria-hidden="true" /></button></div>}
        <div className="library-grid">{bookList.map((book, index) => <article className="library-book-card" key={book.id}>
          <button type="button" className="library-book" onClick={() => { void openBook(book.id) }}><i className={`mock-cover ${['tide', 'orchard', 'fires'][index % 3]}`}>{book.title.slice(0,1)}</i><span><small>{formatSeries(book, seriesList)}</small><strong>{book.title}</strong><em>{formatEdited(book.updatedAt)}</em></span></button>
          <div className="library-book-actions"><button type="button" onClick={() => { void editBookTitle(book) }} aria-label={`Rename ${book.title}`}><Pencil aria-hidden="true" /></button><button type="button" onClick={() => { void removeBook(book) }} aria-label={`Delete ${book.title}`}><Trash2 aria-hidden="true" /></button></div>
        </article>)}</div>
      </section>
    </main>
  )

  return (
    <main className={`workspace-screen ${screen === 'chat' ? 'chat-active' : ''}`}>
      <header className="floating-controls">
        <button type="button" onClick={() => openSettings(screen)} aria-label="Open current book settings"><ChevronsRight aria-hidden="true" /></button>
        <span className={`save-state ${saveState}`} title={saveState === 'error' ? 'Local save failed; your current editor text remains in memory.' : undefined}><i /> {saveState === 'loading' ? 'Loading' : saveState === 'saving' ? 'Saving' : saveState === 'error' ? 'Save failed' : 'Saved'}</span>
        <button type="button" onClick={() => setRightOpen(true)} aria-label="Open book workspace"><ChevronsLeft aria-hidden="true" /></button>
      </header>

      {toast && <div className="app-toast" role="alert" key={toast.id}><span>{toast.message}</span><button type="button" onClick={() => setToast(null)} aria-label="Dismiss notification"><X aria-hidden="true" /></button></div>}

      {screen === 'editor' ? <article className="story-editor">
        <small className="page-number">{pageLabel}</small><p className="document-path">{documentPath || 'No document selected'}</p>
        {(activeDocument?.type === 'note' || activeDocument?.type === 'codexEntry') && <div className="document-titlebar"><div><small>{activeDocument.type === 'note' ? 'Note' : activeDocument.category}</small><h1>{activeDocument.title}</h1></div><button type="button" onClick={() => { void renameContentEntity(activeDocument) }}><Pencil aria-hidden="true" /> Rename</button></div>}
        {activeDocument?.type === 'codexEntry' && <div className="document-metadata"><label><span>Category</span><select value={activeDocument.category} onChange={(event) => { void changeCodexCategory(event.target.value) }}><option>Character</option><option>Place</option><option>Object</option><option>Event</option><option>Group</option><option>Other</option></select></label></div>}
        {activeDocument ? <MarkdownEditor key={`${activeDocument.id}-${editorRevision}`} ref={editorRef} value={storyMarkdown} onChange={handleStoryChange} ariaLabel={`${activeDocument.title} Markdown editor`} /> : <div className="empty-editor"><FileText aria-hidden="true" /><strong>No document selected</strong><p>Choose a Scene, Note, Codex entry, or Summary from the book workspace.</p><button type="button" onClick={() => setRightOpen(true)}>Open Book Workspace</button></div>}
      </article> : currentBook ? <ChatView bookId={currentBook.id} chatId={activeChatId} bookPromptValues={toBookPromptValues(currentBook, seriesList)} currentSceneId={activeSceneId} onChatChange={openChat} onToast={showToast} /> : <section className="conversation chat-empty"><MessageCircle aria-hidden="true" /><p>Open a book before starting a chat.</p></section>}

      {screen === 'editor' && (activeDocument?.type === 'scene' || activeDocument?.type === 'codexEntry') && !arcOpen && <div className="editor-bottom"><button type="button" onClick={() => setArcOpen(true)} aria-label="Open generation input"><PanelBottomOpen aria-hidden="true" /></button><GenerateControl isGenerating={generationActive} phase={generationPhase} elapsedSeconds={generationElapsedSeconds} onGenerate={generate} onStop={stopGeneration} onMicro={insertEditorSpeech} onMicro2={insertPromptSpeech} onUndo={() => editorRef.current?.undo()} onRedo={() => editorRef.current?.redo()} onRegenerate={regenerate} /></div>}
      {screen === 'editor' && activeDocument?.type === 'summary' && <div className="summary-generate-wrap"><button className="summary-generate" type="button" onClick={generationActive ? stopGeneration : generate}>{generationActive ? <Square aria-hidden="true" fill="currentColor" /> : <RefreshCw aria-hidden="true" />} {generationActive ? 'Stop' : openSummaryState === 'missing' ? 'Summarize' : 'Re-summarize'}</button></div>}
      {screen === 'editor' && (activeDocument?.type === 'scene' || activeDocument?.type === 'codexEntry') && arcOpen && <section className="arc-drawer"><div><small>{activeDocument.type === 'codexEntry' ? 'LORE' : 'ARC'}</small>{generationActive && generationPhase ? <GenerationActivityStrip phase={generationPhase} elapsedSeconds={generationElapsedSeconds} placement="drawer" /> : <span>{activeDocument.type === 'codexEntry' ? 'Create or revise this entry' : 'Guide the next passage'}</span>}<button type="button" onClick={() => setArcOpen(false)} aria-label="Close generation input"><X aria-hidden="true" /></button></div><div className="arc-compose"><div className="arc-prompt-field"><ExpandableTextInput ref={promptRef} value={activeDocument.type === 'codexEntry' ? lorePrompt : arcPrompt} onChange={activeDocument.type === 'codexEntry' ? setLorePrompt : setArcPrompt} aria-label="generation prompt" dialogTitle="Edit generation prompt" /><span aria-live="polite">{(activeDocument.type === 'codexEntry' ? lorePrompt : arcPrompt).length} characters</span></div><button className={`play ${generationActive ? 'generating' : ''}`} type="button" onClick={generationActive ? stopGeneration : generate} aria-label={generationActive ? 'Stop generation' : 'Generate'}>{generationActive ? <Square aria-hidden="true" fill="currentColor" /> : <Play aria-hidden="true" fill="currentColor" />}</button></div></section>}

      {rightOpen && <aside className="book-panel">
        <header><div><small>{formatSeries(currentBook, seriesList)}</small><strong>{currentBook?.title ?? 'Untitled Book'}</strong></div><button type="button" onClick={() => setRightOpen(false)} aria-label="Close book workspace"><X aria-hidden="true" /></button></header>
        <nav>{([['book', Settings2], ['outline', BookOpenText], ['notes', NotebookPen], ['codex', WandSparkles], ['chat', MessageCircle]] as const).map(([tab, Icon]) => <button type="button" className={rightTab === tab ? 'active' : ''} onClick={() => { setRightTab(tab); if (tab === 'chat') setChatPanel(screen === 'chat' ? 'settings' : 'list') }} key={tab}><Icon aria-hidden="true" /><span>{tab}</span></button>)}</nav>
        <div className="panel-content">{rightTab === 'book' ? <BookSettings book={currentBook} books={bookList} series={seriesList} onSave={saveBookMetadata} onCreateSeries={addSeries} onRenameSeries={renameSeries} onDelete={removeCurrentBookFromSettings} /> : rightTab === 'outline' ? <Outline book={currentBook} entities={outlineEntities} activeSceneId={activeSceneId} summaryStates={summaryStates} expandedIds={expandedIds} onToggle={(id) => setExpandedIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })} onOpenScene={(id) => { void loadScene(id) }} onOpenSummary={(entity) => { void openSummary(entity) }} onCreate={(type, parentId) => { void addOutlineEntity(type, parentId) }} onRename={(entity) => { void editOutlineTitle(entity) }} onMove={(entity, direction) => { void moveOutlineEntity(entity, direction) }} onDelete={(entity) => { void removeOutlineEntity(entity) }} /> : rightTab === 'notes' ? <Notes notes={notes} activeId={activeDocument?.type === 'note' ? activeDocument.id : null} onCreate={() => { void addNote() }} onOpen={(id) => { void loadDocument(id) }} onRename={(entity) => { void renameContentEntity(entity) }} onDelete={(entity) => { void removeContentEntity(entity) }} /> : rightTab === 'codex' ? <Codex entries={codexEntries} activeId={activeDocument?.type === 'codexEntry' ? activeDocument.id : null} onCreate={() => { void addCodexEntry() }} onOpen={(id) => { void loadDocument(id) }} onRename={(entity) => { void renameContentEntity(entity) }} onDelete={(entity) => { void removeContentEntity(entity) }} /> : <ChatSidebar bookId={currentBook?.id ?? ''} activeChatId={screen === 'chat' ? activeChatId : ''} onOpen={openChat} />}</div>
      </aside>}
    </main>
  )
}

function formatGenerationTime(seconds: number) {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

function generationPhaseLabel(phase: GenerationPhase) {
  if (phase === 'sending') return 'Sending'
  if (phase === 'thinking') return 'Thinking'
  if (phase === 'stopping') return 'Stopping'
  return 'Writing'
}

function GenerationActivityStrip({ phase, elapsedSeconds, placement }: {
  phase: GenerationPhase
  elapsedSeconds: number
  placement: 'drawer' | 'floating'
}) {
  const label = generationPhaseLabel(phase)
  return <span className={`generation-activity-strip ${placement} ${phase}`} aria-label={`${label}, ${formatGenerationTime(elapsedSeconds)} elapsed`}>
    <i aria-hidden="true" />
    <span className="generation-phase" role="status" aria-live="polite">{label}</span>
    <span className="generation-separator" aria-hidden="true">·</span>
    <span className="generation-time" aria-hidden="true">{formatGenerationTime(elapsedSeconds)}</span>
  </span>
}

function GenerateControl({ isGenerating, phase, elapsedSeconds, onGenerate, onStop, onMicro, onMicro2, onUndo, onRedo, onRegenerate }: {
  isGenerating: boolean
  phase: GenerationPhase | null
  elapsedSeconds: number
  onGenerate: () => void
  onStop: () => void
  onMicro: () => void
  onMicro2: () => void
  onUndo: () => void
  onRedo: () => void
  onRegenerate: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const longPressRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function cancelTimer() {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }

  if (isGenerating && phase) return <div className="floating-generation-status">
    <GenerationActivityStrip phase={phase} elapsedSeconds={elapsedSeconds} placement="floating" />
    <button className="play generate-trigger generating" type="button" onClick={onStop} aria-label="Stop generation" title="Stop generation"><Square aria-hidden="true" fill="currentColor" /></button>
  </div>

  if (expanded) return <div className="generate-actions" role="toolbar" aria-label="Generate actions">
    <button type="button" onClick={onMicro} aria-label="Insert speech placeholder into editor" title="Micro"><Mic aria-hidden="true" /></button>
    <button type="button" onClick={onMicro2} aria-label="Insert speech placeholder into generation input" title="Micro 2"><Mic aria-hidden="true" /></button>
    <button type="button" onClick={onUndo} aria-label="Undo editor change" title="Back / Undo"><Undo2 aria-hidden="true" /></button>
    <button type="button" onClick={onRedo} aria-label="Redo editor change" title="Forward / Redo"><Redo2 aria-hidden="true" /></button>
    <button type="button" onClick={onRegenerate} aria-label="Regenerate latest result" title="Regenerate"><RefreshCw aria-hidden="true" /></button>
    <button type="button" onClick={() => setExpanded(false)} aria-label="Collapse generate actions" title="Collapse"><X aria-hidden="true" /></button>
  </div>

  return <button
    className="play generate-trigger"
    type="button"
    aria-label="Generate. Press and hold for more actions."
    onContextMenu={(event) => event.preventDefault()}
    onPointerDown={() => {
      longPressRef.current = false
      cancelTimer()
      timerRef.current = setTimeout(() => {
        longPressRef.current = true
        setExpanded(true)
      }, 450)
    }}
    onPointerUp={cancelTimer}
    onPointerCancel={cancelTimer}
    onPointerLeave={cancelTimer}
    onClick={() => {
      if (longPressRef.current) {
        longPressRef.current = false
        return
      }
      onGenerate()
    }}
  ><Play aria-hidden="true" fill="currentColor" /></button>
}

function MessageActions({ user = false }: { user?: boolean }) { return <div className="message-tools"><button type="button"><Pencil aria-hidden="true" /> Edit</button>{!user && <><button type="button"><GitFork aria-hidden="true" /> Fork</button><button type="button"><Volume2 aria-hidden="true" /> Read aloud</button><button type="button"><RefreshCw aria-hidden="true" /> Regenerate</button></>}<button type="button"><Trash2 aria-hidden="true" /> Delete</button></div> }
function SummaryIcon({ state, onOpen }: { state: SummaryState; onOpen: () => void }) { const Icon = state === 'current' ? FileText : state === 'outdated' ? RefreshCw : FileQuestion; return <button className={`summary-status ${state}`} type="button" onClick={onOpen} aria-label={`Open ${state} summary`} title={`${state[0].toUpperCase()}${state.slice(1)} summary`}><Icon aria-hidden="true" /></button> }
function formatEdited(updatedAt: number) {
  const minutes = Math.max(0, Math.round((Date.now() - updatedAt) / 60_000))
  if (minutes < 1) return 'Edited just now'
  if (minutes < 60) return `Edited ${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `Edited ${hours} hour${hours === 1 ? '' : 's'} ago`
  return `Edited ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(updatedAt)}`
}

function seriesForBook(book: BookEntity | null, series: SeriesEntity[]) {
  if (!book?.seriesId) return undefined
  return series.find((candidate) => candidate.id === book.seriesId)
}

function formatSeries(book: BookEntity | null, series: SeriesEntity[]) {
  if (!book) return 'Standalone'
  const selected = seriesForBook(book, series)
  if (!selected) return 'Standalone'
  return book.seriesOrder ? `${selected.title} · Book ${book.seriesOrder}` : selected.title
}

function bookMetadata(book: BookEntity): BookMetadata {
  const prototype = book.id === PROTOTYPE_BOOK_ID
  return {
    title: book.title,
    seriesId: typeof book.seriesId === 'string' ? book.seriesId : '',
    seriesOrder: typeof book.seriesOrder === 'string' ? book.seriesOrder : '',
    overview: typeof book.overview === 'string' && book.overview ? book.overview : prototype ? 'A cartographer discovers that the drowned parts of her city still exist behind doors that remember them.' : '',
    genre: typeof book.genre === 'string' && book.genre ? book.genre : prototype ? 'Fantasy' : '',
    writingStyle: typeof book.writingStyle === 'string' && book.writingStyle ? book.writingStyle : prototype ? 'Lyrical tension' : '',
    pointOfView: typeof book.pointOfView === 'string' && book.pointOfView ? book.pointOfView : prototype ? 'Third person limited' : '',
    tense: typeof book.tense === 'string' && book.tense ? book.tense : 'Past',
    language: typeof book.language === 'string' && book.language ? book.language : 'English',
  }
}

function toBookPromptValues(book: BookEntity, series: SeriesEntity[]): BookPromptValues {
  const metadata = bookMetadata(book)
  const seriesTitle = series.find((candidate) => candidate.id === metadata.seriesId)?.title ?? ''
  return {
    title: metadata.title,
    series: seriesTitle,
    seriesOrder: seriesTitle ? metadata.seriesOrder : '',
    overview: metadata.overview,
    genre: metadata.genre,
    style: metadata.writingStyle,
    pov: metadata.pointOfView,
    tense: metadata.tense,
    language: metadata.language,
  }
}

function BookSettings({ book, books, series, onSave, onCreateSeries, onRenameSeries, onDelete }: {
  book: BookEntity | null
  books: BookEntity[]
  series: SeriesEntity[]
  onSave: (metadata: BookMetadata) => Promise<void>
  onCreateSeries: (title: string) => Promise<SeriesEntity>
  onRenameSeries: (id: string, title: string) => Promise<SeriesEntity>
  onDelete: () => Promise<void>
}) {
  const [draft, setDraft] = useState<BookMetadata | null>(book ? bookMetadata(book) : null)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [seriesPickerMode, setSeriesPickerMode] = useState<'choose' | 'rename' | null>(null)
  const [seriesQuery, setSeriesQuery] = useState('')
  const [seriesError, setSeriesError] = useState('')
  const [seriesWorking, setSeriesWorking] = useState(false)
  const savedRef = useRef(book ? JSON.stringify(bookMetadata(book)) : '')
  const latestDraftRef = useRef(draft)
  const saveHandlerRef = useRef(onSave)
  const saveSequenceRef = useRef(0)
  const seriesPickerRef = useRef<HTMLElement | null>(null)
  const seriesTriggerRef = useRef<HTMLButtonElement | null>(null)
  latestDraftRef.current = draft
  saveHandlerRef.current = onSave

  useEffect(() => {
    const next = book ? bookMetadata(book) : null
    setDraft(next)
    savedRef.current = next ? JSON.stringify(next) : ''
    setSaveStatus('saved')
    setDeleteConfirm(false)
    setSeriesPickerMode(null)
    setSeriesQuery('')
    setSeriesError('')
  }, [book?.id])

  useEffect(() => {
    if (!seriesPickerMode) return
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node
      if (!seriesPickerRef.current?.contains(target) && !seriesTriggerRef.current?.contains(target)) setSeriesPickerMode(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSeriesPickerMode(null)
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [seriesPickerMode])

  useEffect(() => {
    if (!draft || JSON.stringify(draft) === savedRef.current) return
    setSaveStatus('saving')
    const sequence = ++saveSequenceRef.current
    const timer = window.setTimeout(async () => {
      try {
        await onSave(draft)
        savedRef.current = JSON.stringify(draft)
        if (sequence === saveSequenceRef.current) setSaveStatus('saved')
      } catch (error) {
        console.error('Failed to save book metadata', error)
        if (sequence === saveSequenceRef.current) setSaveStatus('error')
      }
    }, 650)
    return () => window.clearTimeout(timer)
  }, [draft, onSave])

  useEffect(() => {
    if (!deleteConfirm) return
    const timer = window.setTimeout(() => setDeleteConfirm(false), 6000)
    return () => window.clearTimeout(timer)
  }, [deleteConfirm])

  useEffect(() => () => {
    const latest = latestDraftRef.current
    if (latest && JSON.stringify(latest) !== savedRef.current) void saveHandlerRef.current(latest)
  }, [])

  if (!book || !draft) return <section className="outline-empty"><Settings2 aria-hidden="true" /><p>Open a book to edit its details.</p></section>

  const update = <K extends keyof BookMetadata,>(key: K, value: BookMetadata[K]) => setDraft((current) => current ? { ...current, [key]: value } : current)
  const selectedSeries = series.find((candidate) => candidate.id === draft.seriesId)
  const normalizedQuery = seriesQuery.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
  const matchingSeries = series.filter((candidate) => candidate.title.toLocaleLowerCase().includes(normalizedQuery))
  const exactMatch = series.some((candidate) => candidate.title.trim().toLocaleLowerCase() === normalizedQuery)
  const seriesUsage = (seriesId: string) => books.filter((candidate) => candidate.seriesId === seriesId).length

  const chooseSeries = (seriesId: string) => {
    setDraft((current) => current ? { ...current, seriesId, seriesOrder: current.seriesId === seriesId ? current.seriesOrder : '' } : current)
    setSeriesPickerMode(null)
    setSeriesQuery('')
    setSeriesError('')
  }

  const createAndChooseSeries = async () => {
    if (!seriesQuery.trim() || seriesWorking) return
    setSeriesWorking(true)
    setSeriesError('')
    try {
      const created = await onCreateSeries(seriesQuery)
      chooseSeries(created.id)
    } catch (error) {
      setSeriesError(error instanceof Error ? error.message : 'Could not create the series.')
    } finally {
      setSeriesWorking(false)
    }
  }

  const saveSeriesRename = async () => {
    if (!selectedSeries || !seriesQuery.trim() || seriesWorking) return
    setSeriesWorking(true)
    setSeriesError('')
    try {
      await onRenameSeries(selectedSeries.id, seriesQuery)
      setSeriesPickerMode(null)
      setSeriesQuery('')
    } catch (error) {
      setSeriesError(error instanceof Error ? error.message : 'Could not rename the series.')
    } finally {
      setSeriesWorking(false)
    }
  }

  return <section className="book-settings">
    <div className="panel-title book-settings-title"><div><small>Current book</small><h2>Identity & voice</h2></div><span className={`book-save-status ${saveStatus}`} aria-live="polite"><i />{saveStatus === 'saving' ? 'Saving' : saveStatus === 'error' ? 'Save failed' : 'Saved'}</span></div>
    <section className="book-settings-group" aria-labelledby="book-identity-title">
      <div className="book-settings-group-title"><span>01</span><h3 id="book-identity-title">Identity</h3></div>
      <label className="book-field"><span>Book title</span><input value={draft.title} onChange={(event) => update('title', event.target.value)} onBlur={() => { if (!draft.title.trim()) update('title', book.title) }} placeholder="Untitled Book" /></label>
      <div className="book-field series-control">
        <span>Series</span>
        <button ref={seriesTriggerRef} className="series-trigger" type="button" aria-haspopup="listbox" aria-expanded={seriesPickerMode !== null} onClick={() => { setSeriesQuery(''); setSeriesError(''); setSeriesPickerMode('choose') }}><span><strong>{selectedSeries?.title ?? 'Standalone'}</strong><small>{selectedSeries ? `${seriesUsage(selectedSeries.id)} book${seriesUsage(selectedSeries.id) === 1 ? '' : 's'}` : 'Not part of a series'}</small></span><ChevronDown aria-hidden="true" /></button>
        {selectedSeries && <button className="series-rename-trigger" type="button" onClick={() => { setSeriesQuery(selectedSeries.title); setSeriesError(''); setSeriesPickerMode('rename') }}><Pencil aria-hidden="true" /> Rename series <small>Changes all {seriesUsage(selectedSeries.id)} linked book{seriesUsage(selectedSeries.id) === 1 ? '' : 's'}</small></button>}
        {seriesPickerMode && <section ref={seriesPickerRef} className={`series-picker ${seriesPickerMode}`} aria-label={seriesPickerMode === 'choose' ? 'Choose series' : 'Rename series'}>
          <header><button type="button" onClick={() => seriesPickerMode === 'rename' ? setSeriesPickerMode('choose') : setSeriesPickerMode(null)} aria-label={seriesPickerMode === 'rename' ? 'Back to series list' : 'Back to book settings'}><ArrowLeft aria-hidden="true" /></button><div><small>Book identity</small><h3>{seriesPickerMode === 'choose' ? 'Choose series' : 'Rename series'}</h3></div></header>
          {seriesPickerMode === 'choose' ? <>
            <label className="series-search"><Search aria-hidden="true" /><input autoFocus type="search" value={seriesQuery} onChange={(event) => { setSeriesQuery(event.target.value); setSeriesError('') }} placeholder="Search or create a series…" aria-label="Search or create a series" /></label>
            <div className="series-options" role="listbox" aria-label="Available series">
              <button className={!draft.seriesId ? 'selected' : ''} type="button" role="option" aria-selected={!draft.seriesId} onClick={() => chooseSeries('')}><BookOpenText aria-hidden="true" /><span><strong>Standalone</strong><small>Not part of a series</small></span>{!draft.seriesId && <Check aria-hidden="true" />}</button>
              {matchingSeries.map((candidate) => { const count = seriesUsage(candidate.id); return <button className={draft.seriesId === candidate.id ? 'selected' : ''} type="button" role="option" aria-selected={draft.seriesId === candidate.id} onClick={() => chooseSeries(candidate.id)} key={candidate.id}><BookOpenText aria-hidden="true" /><span><strong>{candidate.title}</strong><small>{count} book{count === 1 ? '' : 's'}</small></span>{draft.seriesId === candidate.id && <Check aria-hidden="true" />}</button> })}
              {!matchingSeries.length && !seriesQuery.trim() && <p>No series yet. Type a name to create one.</p>}
            </div>
            {seriesQuery.trim() && !exactMatch && <button className="series-create" type="button" onClick={() => { void createAndChooseSeries() }} disabled={seriesWorking}><Plus aria-hidden="true" /><span><small>Create new series</small><strong>“{seriesQuery.trim()}”</strong></span></button>}
          </> : selectedSeries && <form className="series-rename-form" onSubmit={(event) => { event.preventDefault(); void saveSeriesRename() }}><label><span>Series name</span><input autoFocus value={seriesQuery} onChange={(event) => { setSeriesQuery(event.target.value); setSeriesError('') }} /></label><p>This changes the name for all <strong>{seriesUsage(selectedSeries.id)}</strong> linked book{seriesUsage(selectedSeries.id) === 1 ? '' : 's'}.</p><div><button type="button" onClick={() => setSeriesPickerMode('choose')}>Cancel</button><button className="primary" type="submit" disabled={seriesWorking || !seriesQuery.trim() || seriesQuery.trim() === selectedSeries.title}>{seriesWorking ? 'Renaming…' : 'Rename'}</button></div></form>}
          {seriesError && <p className="series-error" role="alert">{seriesError}</p>}
        </section>}
      </div>
      {draft.seriesId && <label className="book-field compact"><span>Book index in series</span><input value={draft.seriesOrder} onChange={(event) => update('seriesOrder', event.target.value)} placeholder="1" /></label>}
    </section>
    <section className="book-settings-group" aria-labelledby="story-profile-title">
      <div className="book-settings-group-title"><span>02</span><h3 id="story-profile-title">Story profile</h3></div>
      <label className="book-field"><span>Book overview</span><textarea rows={5} value={draft.overview} onChange={(event) => update('overview', event.target.value)} placeholder="What is this book about?" /></label>
      <label className="book-field"><span>Genre</span><input value={draft.genre} onChange={(event) => update('genre', event.target.value)} placeholder="Fantasy, mystery, romance…" /></label>
      <label className="book-field"><span>Writing style</span><input value={draft.writingStyle} onChange={(event) => update('writingStyle', event.target.value)} placeholder="Lyrical tension, clean and cinematic…" /></label>
      <label className="book-field"><span>Point of view</span><input value={draft.pointOfView} onChange={(event) => update('pointOfView', event.target.value)} placeholder="Third person limited" /></label>
      <div className="book-field-pair"><label className="book-field"><span>Tense</span><input value={draft.tense} onChange={(event) => update('tense', event.target.value)} placeholder="Past" /></label><label className="book-field"><span>Primary language</span><input value={draft.language} onChange={(event) => update('language', event.target.value)} placeholder="English" /></label></div>
    </section>
    <section className="book-danger" aria-labelledby="book-danger-title">
      <div><span>Danger zone</span><h3 id="book-danger-title">Delete this book</h3><p>Removes the manuscript and all local book data from this device.</p></div>
      <div className="book-danger-actions"><button className={deleteConfirm ? 'confirming' : ''} type="button" onClick={() => { if (!deleteConfirm) setDeleteConfirm(true); else { savedRef.current = JSON.stringify(draft); void onDelete() } }}><Trash2 aria-hidden="true" />{deleteConfirm ? 'Confirm delete' : 'Delete book'}</button>{deleteConfirm && <button className="cancel" type="button" onClick={() => setDeleteConfirm(false)}>Cancel</button>}</div>
    </section>
  </section>
}

type OutlineProps = {
  book: BookEntity | null
  entities: StructuralEntity[]
  activeSceneId: string | null
  summaryStates: Record<string, SummaryState>
  expandedIds: Set<string>
  onToggle: (id: string) => void
  onOpenScene: (id: string) => void
  onOpenSummary: (entity: StructuralEntity) => void
  onCreate: (type: StructuralEntityType, parentId: string) => void
  onRename: (entity: StructuralEntity) => void
  onMove: (entity: StructuralEntity, direction: -1 | 1) => void
  onDelete: (entity: StructuralEntity) => void
}

function Outline({ book, entities, activeSceneId, summaryStates, expandedIds, onToggle, onOpenScene, onOpenSummary, onCreate, onRename, onMove, onDelete }: OutlineProps) {
  if (!book) return <section className="outline-empty"><BookOpenText aria-hidden="true" /><p>Create or open a book to see its outline.</p></section>
  const children = (parentId: string, type: StructuralEntityType) => entities
    .filter((entity) => entity.parentId === parentId && entity.type === type)
    .sort((a, b) => a.order - b.order)
  const acts = children(book.id, 'act')
  const directChapters = children(book.id, 'chapter')

  const renderChapter = (chapter: StructuralEntity, index: number, count: number) => {
    const scenes = children(chapter.id, 'scene')
    const open = expandedIds.has(chapter.id)
    return <div className="outline-branch" key={chapter.id}>
      <OutlineRow entity={chapter} label={`Chapter ${index + 1}`} summaryState={summaryStates[chapter.id] ?? 'missing'} expanded={open} expandable onToggle={onToggle} onOpenScene={onOpenScene} onOpenSummary={onOpenSummary} onCreate={onCreate} onRename={onRename} onMove={onMove} onDelete={onDelete} first={index === 0} last={index === count - 1} />
      {open && <div className="tree-children">{scenes.length ? scenes.map((scene, sceneIndex) => <OutlineRow key={scene.id} entity={scene} label={`Scene ${sceneIndex + 1}`} summaryState={summaryStates[scene.id] ?? 'missing'} selected={activeSceneId === scene.id} onToggle={onToggle} onOpenScene={onOpenScene} onOpenSummary={onOpenSummary} onCreate={onCreate} onRename={onRename} onMove={onMove} onDelete={onDelete} first={sceneIndex === 0} last={sceneIndex === scenes.length - 1} />) : <p className="tree-empty">No scenes yet</p>}</div>}
    </div>
  }

  return <section className="outline">
    <div className="panel-title"><div><small>Manuscript</small><h2>Outline</h2></div></div>
    <div className="outline-create"><button type="button" onClick={() => onCreate('act', book.id)}><Plus aria-hidden="true" /> Act</button><button type="button" onClick={() => onCreate('chapter', book.id)}><Plus aria-hidden="true" /> Chapter</button></div>
    <div className="tree">
      {acts.map((act, actIndex) => {
        const chapters = children(act.id, 'chapter')
        const open = expandedIds.has(act.id)
        return <div className="outline-branch" key={act.id}>
          <OutlineRow entity={act} label={`Act ${actIndex + 1}`} summaryState={summaryStates[act.id] ?? 'missing'} expanded={open} expandable onToggle={onToggle} onOpenScene={onOpenScene} onOpenSummary={onOpenSummary} onCreate={onCreate} onRename={onRename} onMove={onMove} onDelete={onDelete} first={actIndex === 0} last={actIndex === acts.length - 1} />
          {open && <div className="tree-children">{chapters.length ? chapters.map((chapter, chapterIndex) => renderChapter(chapter, chapterIndex, chapters.length)) : <p className="tree-empty">No chapters yet</p>}</div>}
        </div>
      })}
      {directChapters.length > 0 && <div className="direct-chapters">{acts.length > 0 && <small className="tree-group-label">Chapters without an act</small>}{directChapters.map((chapter, chapterIndex) => renderChapter(chapter, chapterIndex, directChapters.length))}</div>}
      {!acts.length && !directChapters.length && <div className="outline-empty"><BookOpenText aria-hidden="true" /><p>Add a chapter to start this manuscript.</p></div>}
    </div>
  </section>
}

function OutlineRow({ entity, label, summaryState, selected = false, expandable = false, expanded = false, first, last, onToggle, onOpenScene, onOpenSummary, onCreate, onRename, onMove, onDelete }: {
  entity: StructuralEntity
  label: string
  summaryState: SummaryState
  selected?: boolean
  expandable?: boolean
  expanded?: boolean
  first: boolean
  last: boolean
  onToggle: (id: string) => void
  onOpenScene: (id: string) => void
  onOpenSummary: (entity: StructuralEntity) => void
  onCreate: (type: StructuralEntityType, parentId: string) => void
  onRename: (entity: StructuralEntity) => void
  onMove: (entity: StructuralEntity, direction: -1 | 1) => void
  onDelete: (entity: StructuralEntity) => void
}) {
  return <div className={`outline-row ${selected ? 'selected' : ''}`}>
    {expandable ? <button className="tree-toggle" type="button" onClick={() => onToggle(entity.id)} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${entity.title}`}>{expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}</button> : <span className="tree-spacer" />}
    <button className="tree-label" type="button" onClick={() => entity.type === 'scene' ? onOpenScene(entity.id) : onToggle(entity.id)}><small>{label}</small><span>{entity.title}</span></button>
    <SummaryIcon state={summaryState} onOpen={() => onOpenSummary(entity)} />
    <div className="outline-actions">
      {entity.type === 'act' && <button type="button" onClick={() => onCreate('chapter', entity.id)} aria-label={`Add chapter to ${entity.title}`} title="Add chapter"><Plus aria-hidden="true" /></button>}
      {entity.type === 'chapter' && <button type="button" onClick={() => onCreate('scene', entity.id)} aria-label={`Add scene to ${entity.title}`} title="Add scene"><Plus aria-hidden="true" /></button>}
      <button type="button" onClick={() => onRename(entity)} aria-label={`Rename ${entity.title}`} title="Rename"><Pencil aria-hidden="true" /></button>
      <button type="button" onClick={() => onMove(entity, -1)} disabled={first} aria-label={`Move ${entity.title} up`} title="Move up"><ArrowUp aria-hidden="true" /></button>
      <button type="button" onClick={() => onMove(entity, 1)} disabled={last} aria-label={`Move ${entity.title} down`} title="Move down"><ArrowDown aria-hidden="true" /></button>
      <button type="button" className="delete" onClick={() => onDelete(entity)} aria-label={`Delete ${entity.title}`} title="Delete"><Trash2 aria-hidden="true" /></button>
    </div>
  </div>
}
function Notes({ notes, activeId, onCreate, onOpen, onRename, onDelete }: {
  notes: NoteEntity[]
  activeId: string | null
  onCreate: () => void
  onOpen: (id: string) => void
  onRename: (entity: NoteEntity) => void
  onDelete: (entity: NoteEntity) => void
}) {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const visible = notes.filter((note) => !normalizedQuery || `${note.title} ${note.content}`.toLowerCase().includes(normalizedQuery))
  return <section><div className="panel-title"><div><small>Reference</small><h2>Notes</h2></div><button type="button" onClick={onCreate} aria-label="Add note"><Plus aria-hidden="true" /> New</button></div><input className="panel-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes"/>{visible.length ? visible.map((note) => <article className={`content-row ${activeId === note.id ? 'selected' : ''}`} key={note.id}><button className="content-open" type="button" onClick={() => onOpen(note.id)}><NotebookPen aria-hidden="true" /><span><strong>{note.title}</strong><small>{formatEdited(note.updatedAt)}</small></span><ChevronRight aria-hidden="true" /></button><div className="content-actions"><button type="button" onClick={() => onRename(note)} aria-label={`Rename ${note.title}`}><Pencil aria-hidden="true" /></button><button type="button" onClick={() => onDelete(note)} aria-label={`Delete ${note.title}`}><Trash2 aria-hidden="true" /></button></div></article>) : <p className="content-empty">{query ? 'No matching notes.' : 'No notes yet.'}</p>}</section>
}

function Codex({ entries, activeId, onCreate, onOpen, onRename, onDelete }: {
  entries: CodexEntryEntity[]
  activeId: string | null
  onCreate: () => void
  onOpen: (id: string) => void
  onRename: (entity: CodexEntryEntity) => void
  onDelete: (entity: CodexEntryEntity) => void
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const categories = ['All', ...new Set(entries.map((entry) => entry.category))]
  const normalizedQuery = query.trim().toLowerCase()
  const visible = entries.filter((entry) => (category === 'All' || entry.category === category) && (!normalizedQuery || `${entry.title} ${entry.content}`.toLowerCase().includes(normalizedQuery)))
  return <section><div className="panel-title"><div><small>Book knowledge</small><h2>Codex</h2></div><button type="button" onClick={onCreate}><Plus aria-hidden="true" /> New</button></div><input className="panel-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the Codex"/><div className="chips category-filter">{categories.map((item) => <button className={category === item ? 'active' : ''} type="button" onClick={() => setCategory(item)} key={item}>{item}</button>)}</div>{visible.length ? visible.map((entry) => <article className={`content-row codex-content-row ${activeId === entry.id ? 'selected' : ''}`} key={entry.id}><button className="content-open" type="button" onClick={() => onOpen(entry.id)}><i>{entry.title.slice(0, 1).toUpperCase()}</i><span><small>{entry.category}</small><strong>{entry.title}</strong></span><ChevronRight aria-hidden="true" /></button><div className="content-actions"><button type="button" onClick={() => onRename(entry)} aria-label={`Rename ${entry.title}`}><Pencil aria-hidden="true" /></button><button type="button" onClick={() => onDelete(entry)} aria-label={`Delete ${entry.title}`}><Trash2 aria-hidden="true" /></button></div></article>) : <p className="content-empty">{query || category !== 'All' ? 'No matching entries.' : 'No Codex entries yet.'}</p>}</section>
}
function ChatList({onOpen,activeChat,onSettings}:{onOpen:(title:string)=>void;activeChat:string;onSettings:()=>void}) { return <section><div className="panel-title"><div><small>Conversations</small><h2>Chats</h2></div><button type="button" aria-label="Start new chat"><Plus aria-hidden="true" /></button></div>{activeChat && <button className="current-chat" onClick={onSettings}><Settings2 aria-hidden="true" /><span><small>Current chat</small>{activeChat} settings</span><ChevronRight aria-hidden="true" /></button>}<input className="panel-search" placeholder="Search chats"/>{chats.map(([title,preview,time]) => <button className="chat-row" key={title} onClick={() => onOpen(title)}><i><MessageCircle aria-hidden="true" /></i><span><strong>{title}</strong><small>{preview}</small></span><em>{time}</em></button>)}</section> }
function ChatSettings({title,onBack}:{title:string;onBack:()=>void}) { return <section><button className="back-list" onClick={onBack}><ArrowLeft aria-hidden="true" /> All chats</button><div className="panel-title"><div><small>Current chat</small><h2>{title}</h2></div></div><label className="panel-field"><span>System prompt</span><textarea defaultValue="You are a thoughtful story collaborator. Use only selected book context."/></label><label className="panel-field"><span>Model</span><select><option>Claude 3.7 Sonnet</option><option>GPT-4.1</option></select></label><label className="thinking"><span>Thinking<small>Allow longer internal reasoning</small></span><input type="checkbox" defaultChecked/></label><label className="panel-field"><span>Context</span><div className="chips"><button>Chapter 7 <X aria-hidden="true" /></button><button>Codex <X aria-hidden="true" /></button><button><Plus aria-hidden="true" /> Add</button></div></label></section> }

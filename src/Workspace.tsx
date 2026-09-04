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
import { loadAiSettings, type AiSettings } from './ai-settings'
import ExpandableTextInput from './ExpandableTextInput'
import MarkdownEditor, { type MarkdownEditorHandle } from './MarkdownEditor'
import { renderStoryPrompt, streamNanoGPTCompletion } from './nanogpt'
import {
  PROTOTYPE_BOOK_ID,
  PROTOTYPE_SCENE_ID,
  createBook,
  createSnapshot,
  createStructuralEntity,
  deleteEntityTree,
  ensureBookAiSettings,
  ensurePrototypeSeed,
  getEntity,
  getBookAiSettings,
  listBooks,
  listEntitiesByBook,
  moveStructuralEntity,
  renameEntity,
  saveDocumentContent,
  updateBookMetadata,
  type BookEntity,
  type BookMetadata,
  type SnapshotReason,
  type StructuralEntity,
  type StructuralEntityType,
} from './persistence'
import './generation-controls.css'

type Screen = 'home' | 'editor' | 'chat' | 'settings'
type RightTab = 'book' | 'outline' | 'notes' | 'codex' | 'chat'
type ChatPanel = 'list' | 'settings'
type SaveState = 'loading' | 'saving' | 'saved' | 'error'
type ToastMessage = { id: number; message: string }
type GenerationRequestSnapshot = {
  baseUrl: string
  model: string
  systemPrompt: string
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
  const [activeChat, setActiveChat] = useState('Mara’s motivation')
  const [arcOpen, setArcOpen] = useState(false)
  const [storyMarkdown, setStoryMarkdown] = useState(initialStoryMarkdown)
  const [arcPrompt, setArcPrompt] = useState('Let Mara step through. Keep the reveal quiet and unsettling.')
  const [chatEdit, setChatEdit] = useState(false)
  const [aiReady, setAiReady] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('loading')
  const [generationActive, setGenerationActive] = useState(false)
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [bookList, setBookList] = useState<BookEntity[]>([])
  const [currentBook, setCurrentBook] = useState<BookEntity | null>(null)
  const [outlineEntities, setOutlineEntities] = useState<StructuralEntity[]>([])
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const editorRef = useRef<MarkdownEditorHandle | null>(null)
  const promptRef = useRef<HTMLTextAreaElement | null>(null)
  const storyRef = useRef(initialStoryMarkdown)
  const activeSceneIdRef = useRef<string | null>(null)
  const bookTitleRef = useRef('The City Beneath the Tide')
  const scenePovRef = useRef('')
  const storageReadyRef = useRef(false)
  const changedSinceSnapshotRef = useRef(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const generationAbortRef = useRef<AbortController | null>(null)
  const latestGenerationRequestRef = useRef<GenerationRequestSnapshot | null>(null)

  useEffect(() => {
    const settings = loadAiSettings()
    setAiReady(settings.provider === 'nanogpt' && Boolean(settings.apiKey.trim() && settings.mainModel.trim()))
  }, [])

  useEffect(() => () => {
    generationAbortRef.current?.abort()
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await ensurePrototypeSeed(initialStoryMarkdown)
        const books = await listBooks()
        const defaults = loadAiSettings()
        await Promise.all(books.map((existingBook) => ensureBookAiSettings(existingBook.id, defaults)))
        const book = books.find((candidate) => candidate.id === PROTOTYPE_BOOK_ID) ?? books[0]
        const entities = book ? await listEntitiesByBook(book.id) as StructuralEntity[] : []
        const scene = entities.find((entity) => entity.id === PROTOTYPE_SCENE_ID && entity.type === 'scene')
          ?? entities.find((entity) => entity.type === 'scene')
        if (cancelled) return
        setBookList(books)
        setCurrentBook(book ?? null)
        setOutlineEntities(entities.filter((entity) => ['act', 'chapter', 'scene'].includes(entity.type)))
        bookTitleRef.current = book?.title ?? bookTitleRef.current
        activeSceneIdRef.current = scene?.id ?? null
        setActiveSceneId(scene?.id ?? null)
        scenePovRef.current = typeof scene?.pov === 'string' ? scene.pov : ''
        const content = typeof scene?.content === 'string' ? scene.content : ''
        storyRef.current = content
        setStoryMarkdown(content)
        setExpandedIds(new Set(entities.filter((entity) => entity.type !== 'scene').map((entity) => entity.id)))
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
    const sceneId = activeSceneIdRef.current
    if (!storageReadyRef.current || !sceneId) return
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    setSaveState('saving')
    try {
      const savedScene = await saveDocumentContent(sceneId, storyRef.current)
      if (snapshot && changedSinceSnapshotRef.current) {
        await createSnapshot(sceneId, reason, storyRef.current)
        changedSinceSnapshotRef.current = false
      }
      const editedAt = Date.now()
      setCurrentBook((book) => book && book.id === savedScene.bookId ? { ...book, updatedAt: editedAt } : book)
      setBookList((books) => books.map((book) => book.id === savedScene.bookId ? { ...book, updatedAt: editedAt } : book))
      setSaveState('saved')
    } catch (error) {
      console.error('Failed to persist document', error)
      setSaveState('error')
    }
  }

  useEffect(() => {
    if (!storageReadyRef.current) return
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
      else void flushDocument('lifecycle', false)
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
    changedSinceSnapshotRef.current = true
    setStoryMarkdown(value)
    if (storageReadyRef.current) setSaveState('saving')
  }

  async function reloadStructure(bookId: string) {
    const entities = await listEntitiesByBook(bookId)
    const structural = entities.filter((entity): entity is StructuralEntity => ['act', 'chapter', 'scene'].includes(entity.type))
    setOutlineEntities(structural)
    return structural
  }

  async function loadScene(sceneId: string, closePanel = true) {
    if (sceneId === activeSceneIdRef.current) {
      if (closePanel) setRightOpen(false)
      return
    }
    if (generationAbortRef.current) {
      showToast('Stop generation before switching scenes.')
      return
    }
    await flushDocument('navigation', changedSinceSnapshotRef.current)
    const scene = await getEntity<StructuralEntity>(sceneId)
    if (!scene || scene.type !== 'scene') {
      showToast('That scene is no longer available.')
      return
    }
    activeSceneIdRef.current = scene.id
    setActiveSceneId(scene.id)
    scenePovRef.current = typeof scene.pov === 'string' ? scene.pov : ''
    const content = typeof scene.content === 'string' ? scene.content : ''
    storyRef.current = content
    changedSinceSnapshotRef.current = false
    latestGenerationRequestRef.current = null
    setStoryMarkdown(content)
    setSaveState('saved')
    setScreen('editor')
    if (closePanel) setRightOpen(false)
  }

  async function openBook(bookId: string, preferredSceneId?: string) {
    if (activeSceneIdRef.current && changedSinceSnapshotRef.current) await flushDocument('navigation', true)
    const book = await getEntity<BookEntity>(bookId)
    if (!book || book.type !== 'book') {
      showToast('That book is no longer available.')
      return
    }
    const entities = await reloadStructure(bookId)
    const scene = entities.find((entity) => entity.id === preferredSceneId && entity.type === 'scene')
      ?? entities.find((entity) => entity.type === 'scene')
    setCurrentBook(book)
    bookTitleRef.current = book.title
    setExpandedIds(new Set(entities.filter((entity) => entity.type !== 'scene').map((entity) => entity.id)))
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
      bookTitleRef.current = updated.title
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
      activeSceneIdRef.current = null
      setActiveSceneId(null)
    }
  }

  async function saveBookMetadata(metadata: BookMetadata) {
    if (!currentBook) return
    const updated = await updateBookMetadata(currentBook.id, metadata)
    setCurrentBook(updated)
    setBookList((books) => books.map((book) => book.id === updated.id ? updated : book))
    bookTitleRef.current = updated.title
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
      await reloadStructure(currentBook.id)
      if (entity.type === 'scene') await loadScene(entity.id)
    } catch (error) {
      showToast(error instanceof Error ? error.message : `Could not create ${type}.`)
    }
  }

  async function editOutlineTitle(entity: StructuralEntity) {
    const title = window.prompt(`${entity.type[0].toUpperCase()}${entity.type.slice(1)} title`, entity.title)
    if (title === null || !title.trim() || !currentBook) return
    await renameEntity(entity.id, title)
    await reloadStructure(currentBook.id)
  }

  async function moveOutlineEntity(entity: StructuralEntity, direction: -1 | 1) {
    if (!currentBook) return
    await moveStructuralEntity(entity.id, direction)
    await reloadStructure(currentBook.id)
  }

  async function removeOutlineEntity(entity: StructuralEntity) {
    if (!currentBook) return
    const nested = outlineEntities.some((candidate) => candidate.parentId === entity.id)
    const warning = nested ? ' All nested content will also be deleted.' : ''
    if (!window.confirm(`Delete “${entity.title}”?${warning} This cannot be undone.`)) return
    const removedIds = await deleteEntityTree(entity.id)
    const entities = await reloadStructure(currentBook.id)
    if (activeSceneIdRef.current && removedIds.includes(activeSceneIdRef.current)) {
      const nextScene = entities.find((candidate) => candidate.type === 'scene')
      activeSceneIdRef.current = null
      setActiveSceneId(null)
      storyRef.current = ''
      changedSinceSnapshotRef.current = false
      setStoryMarkdown('')
      latestGenerationRequestRef.current = null
      if (nextScene) await loadScene(nextScene.id, false)
    }
  }

  function openSettings(from: Screen) {
    if (from === 'editor' && changedSinceSnapshotRef.current) void flushDocument('navigation', true)
    setReturnScreen(from)
    setScreen('settings')
    setRightOpen(false)
  }

  function openChat(title: string) {
    if (screen === 'editor' && changedSinceSnapshotRef.current) void flushDocument('navigation', true)
    setActiveChat(title)
    setChatPanel('settings')
    setScreen('chat')
    setRightOpen(false)
  }

  function showToast(message: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast({ id: Date.now(), message })
    toastTimerRef.current = setTimeout(() => setToast(null), 5200)
  }

  async function runGeneration(mode: 'generate' | 'regenerate') {
    if (generationAbortRef.current) return

    if (!currentBook) {
      showToast('Open a book before generating.')
      return
    }

    let settings: AiSettings
    try {
      const defaults = loadAiSettings()
      settings = await getBookAiSettings(currentBook.id, defaults.favorites)
    } catch {
      showToast('This book’s AI settings could not be loaded. Open Book settings and try again.')
      return
    }
    if (settings.provider !== 'nanogpt') {
      showToast('Story generation currently supports NanoGPT only. Choose it in Book settings.')
      return
    }
    if (!settings.apiKey.trim()) {
      showToast('Add your NanoGPT API key in Book settings before generating.')
      return
    }
    if (!settings.mainModel.trim()) {
      showToast('Choose a Main model in Book settings before generating.')
      return
    }

    const previousRequest = latestGenerationRequestRef.current
    if (mode === 'regenerate' && !previousRequest) {
      showToast('Generate a passage before using Regenerate.')
      return
    }

    const editor = editorRef.current
    const context = editor?.beginGeneration(mode)
    if (!editor || !context) {
      showToast(mode === 'regenerate'
        ? 'Regenerate is available only while the latest generated passage is unchanged.'
        : 'The editor is not ready for generation yet.')
      return
    }

    const requestSnapshot = mode === 'regenerate' && previousRequest
      ? previousRequest
      : {
          baseUrl: settings.baseUrl,
          model: settings.mainModel,
          systemPrompt: renderStoryPrompt(settings.prompts.story, {
            bookTitle: bookTitleRef.current,
            sceneText: context.sceneText,
            scenePov: scenePovRef.current || undefined,
          }),
          userMessage: arcPrompt,
        }

    const controller = new AbortController()
    generationAbortRef.current = controller
    setGenerationActive(true)
    let status: 'complete' | 'cancelled' | 'error' = 'complete'

    try {
      await streamNanoGPTCompletion({
        apiKey: settings.apiKey.trim(),
        baseUrl: requestSnapshot.baseUrl,
        model: requestSnapshot.model,
        systemPrompt: requestSnapshot.systemPrompt,
        userMessage: requestSnapshot.userMessage,
      }, (chunk) => {
        if (!editor.appendGenerationChunk(chunk)) throw new Error('The editor could not insert generated text.')
      }, controller.signal)
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        status = 'cancelled'
      } else {
        status = 'error'
        showToast(error instanceof Error ? error.message : 'Generation stopped unexpectedly.')
      }
    } finally {
      const result = editor.finishGeneration(status)
      generationAbortRef.current = null
      setGenerationActive(false)
      if (result) {
        latestGenerationRequestRef.current = requestSnapshot
        await flushDocument('generation', true)
      }
    }
  }

  function generate() { void runGeneration('generate') }

  function regenerate() { void runGeneration('regenerate') }

  function stopGeneration() { generationAbortRef.current?.abort() }

  function insertEditorSpeech() {
    editorRef.current?.insertSpeech()
  }

  function insertPromptSpeech() {
    const input = promptRef.current
    const start = input?.selectionStart ?? arcPrompt.length
    const end = input?.selectionEnd ?? start
    const insert = 'speech placeholder'
    const next = `${arcPrompt.slice(0, start)}${insert}${arcPrompt.slice(end)}`
    setArcPrompt(next)
    requestAnimationFrame(() => {
      const target = promptRef.current
      if (!target) return
      const cursor = start + insert.length
      target.focus()
      target.setSelectionRange(cursor, cursor)
    })
  }

  const activeScene = outlineEntities.find((entity) => entity.id === activeSceneId && entity.type === 'scene')
  const activeChapter = activeScene ? outlineEntities.find((entity) => entity.id === activeScene.parentId && entity.type === 'chapter') : undefined
  const activeAct = activeChapter ? outlineEntities.find((entity) => entity.id === activeChapter.parentId && entity.type === 'act') : undefined
  const documentPath = ['Outline', activeAct?.title, activeChapter?.title, activeScene?.title].filter(Boolean).join(' / ')
  const chapterNumber = String((activeChapter?.order ?? 0) + 1).padStart(2, '0')

  if (screen === 'settings') return <AiSettingsScreen
    book={returnScreen === 'home' || !currentBook ? undefined : { id: currentBook.id, title: currentBook.title }}
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
          <button type="button" className="library-book" onClick={() => { void openBook(book.id) }}><i className={`mock-cover ${['tide', 'orchard', 'fires'][index % 3]}`}>{book.title.slice(0,1)}</i><span><small>{formatSeries(book)}</small><strong>{book.title}</strong><em>{formatEdited(book.updatedAt)}</em></span></button>
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
        <small className="page-number">{chapterNumber}</small><p className="document-path">{documentPath || 'Outline / No scene selected'}</p>
        {activeScene ? <MarkdownEditor key={activeScene.id} ref={editorRef} value={storyMarkdown} onChange={handleStoryChange} ariaLabel={`${activeScene.title} Markdown editor`} /> : <div className="empty-editor"><FileText aria-hidden="true" /><strong>No scene selected</strong><p>Create a chapter and scene from the Outline to begin writing.</p><button type="button" onClick={() => setRightOpen(true)}>Open Outline</button></div>}
      </article> : <section className="conversation">
        <header><small>Book chat</small><h1>{activeChat}</h1><p>Context: Chapter 7 · Codex</p></header>
        <div className="messages">
          <article className="message user"><div className="bubble">Why does Mara open the door even though she knows her father’s warning?</div><MessageActions user /></article>
          <article className="message bot"><i className="bot-thumb"><Feather aria-hidden="true" /></i><div><div className="bubble"><p>Mara opens it because the warning has become evidence. Her father taught her the rule but never explained how he knew it, so hearing her own name confirms that the door is tied to the life he concealed.</p><p>Every compass also turns toward the threshold. For a cartographer, that transforms fear into a navigational fact.</p></div><MessageActions /></div></article>
          <article className="message user">{chatEdit ? <div className="inline-edit"><textarea defaultValue="Does that choice contradict her promise to Elias in Chapter Four?"/><div><button type="button" onClick={() => setChatEdit(false)}>Cancel</button><button type="button" onClick={() => setChatEdit(false)}>Save</button><button type="button" onClick={() => setChatEdit(false)}>Save & regenerate</button></div></div> : <><div className="bubble">Does that choice contradict her promise to Elias in Chapter Four?</div><div className="message-tools"><button type="button" onClick={() => setChatEdit(true)}><Pencil aria-hidden="true" /> Edit</button><button type="button"><Trash2 aria-hidden="true" /> Delete</button></div></>}</article>
          <article className="message bot no-thumb"><div><div className="bubble">Not necessarily. She promised Elias she would not cross alone. Opening the door tests the boundary of that promise without yet breaking it.</div><MessageActions /></div></article>
        </div>
      </section>}

      {screen === 'editor' && <div className="editor-bottom"><button type="button" onClick={() => setArcOpen(true)} aria-label="Open generation input"><PanelBottomOpen aria-hidden="true" /></button><GenerateControl isGenerating={generationActive} onGenerate={generate} onStop={stopGeneration} onMicro={insertEditorSpeech} onMicro2={insertPromptSpeech} onUndo={() => editorRef.current?.undo()} onRedo={() => editorRef.current?.redo()} onRegenerate={regenerate} /></div>}
      {screen === 'editor' && arcOpen && <section className="arc-drawer"><div><small>ARC</small><span>Guide the next passage</span><button type="button" onClick={() => setArcOpen(false)} aria-label="Close Arc"><X aria-hidden="true" /></button></div><div className="arc-compose"><div className="arc-prompt-field"><ExpandableTextInput ref={promptRef} value={arcPrompt} onChange={setArcPrompt} aria-label="generation prompt" dialogTitle="Edit generation prompt" /><span aria-live="polite">{arcPrompt.length} characters</span></div><button className={`play ${generationActive ? 'generating' : ''}`} type="button" onClick={generationActive ? stopGeneration : generate} aria-label={generationActive ? 'Stop generation' : 'Generate'}>{generationActive ? <Square aria-hidden="true" fill="currentColor" /> : <Play aria-hidden="true" fill="currentColor" />}</button></div></section>}
      {screen === 'chat' && <section className="chat-composer"><small>Chapter 7 + Codex <ChevronDown aria-hidden="true" /></small><div><button type="button" aria-label="Dictate message"><Mic aria-hidden="true" /></button><textarea defaultValue="Compare Mara’s choice with what she promised Elias."/><button className="send" type="button" aria-label="Send message"><Send aria-hidden="true" fill="currentColor" /></button></div></section>}

      {rightOpen && <aside className="book-panel">
        <header><div><small>{formatSeries(currentBook)}</small><strong>{currentBook?.title ?? 'Untitled Book'}</strong></div><button type="button" onClick={() => setRightOpen(false)} aria-label="Close book workspace"><X aria-hidden="true" /></button></header>
        <nav>{([['book', Settings2], ['outline', BookOpenText], ['notes', NotebookPen], ['codex', WandSparkles], ['chat', MessageCircle]] as const).map(([tab, Icon]) => <button type="button" className={rightTab === tab ? 'active' : ''} onClick={() => { setRightTab(tab); if (tab === 'chat') setChatPanel(screen === 'chat' ? 'settings' : 'list') }} key={tab}><Icon aria-hidden="true" /><span>{tab}</span></button>)}</nav>
        <div className="panel-content">{rightTab === 'book' ? <BookSettings book={currentBook} seriesOptions={bookList.map((book) => bookMetadata(book).series).filter(Boolean)} onSave={saveBookMetadata} onDelete={removeCurrentBookFromSettings} /> : rightTab === 'outline' ? <Outline book={currentBook} entities={outlineEntities} activeSceneId={activeSceneId} expandedIds={expandedIds} onToggle={(id) => setExpandedIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })} onOpenScene={(id) => { void loadScene(id) }} onCreate={(type, parentId) => { void addOutlineEntity(type, parentId) }} onRename={(entity) => { void editOutlineTitle(entity) }} onMove={(entity, direction) => { void moveOutlineEntity(entity, direction) }} onDelete={(entity) => { void removeOutlineEntity(entity) }} /> : rightTab === 'notes' ? <Notes /> : rightTab === 'codex' ? <Codex /> : chatPanel === 'list' ? <ChatList onOpen={openChat} activeChat={screen === 'chat' ? activeChat : ''} onSettings={() => setChatPanel('settings')} /> : <ChatSettings title={activeChat} onBack={() => setChatPanel('list')} />}</div>
      </aside>}
    </main>
  )
}

function GenerateControl({ isGenerating, onGenerate, onStop, onMicro, onMicro2, onUndo, onRedo, onRegenerate }: {
  isGenerating: boolean
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

  if (isGenerating) return <button className="play generate-trigger generating" type="button" onClick={onStop} aria-label="Stop generation" title="Stop generation"><Square aria-hidden="true" fill="currentColor" /></button>

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
function SummaryIcon({ state }: { state: 'complete' | 'outdated' | 'missing' }) { const Icon = state === 'complete' ? FileText : state === 'outdated' ? RefreshCw : FileQuestion; return <button className={`summary-status ${state}`} type="button" aria-label={`${state} summary`} title={`${state[0].toUpperCase()}${state.slice(1)} summary`}><Icon aria-hidden="true" /></button> }
function formatEdited(updatedAt: number) {
  const minutes = Math.max(0, Math.round((Date.now() - updatedAt) / 60_000))
  if (minutes < 1) return 'Edited just now'
  if (minutes < 60) return `Edited ${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `Edited ${hours} hour${hours === 1 ? '' : 's'} ago`
  return `Edited ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(updatedAt)}`
}

function formatSeries(book: BookEntity | null) {
  if (!book || !book.series || book.series === 'Standalone') return 'Standalone'
  if (!book.seriesOrder || book.series.includes('· Book')) return book.series
  return `${book.series} · Book ${book.seriesOrder}`
}

function bookMetadata(book: BookEntity): BookMetadata {
  const rawSeries = typeof book.series === 'string' && book.series ? book.series : 'Standalone'
  const legacySeries = rawSeries.match(/^(.*?)\s*·\s*Book\s+(.+)$/i)
  const prototype = book.id === PROTOTYPE_BOOK_ID
  return {
    title: book.title,
    series: legacySeries?.[1]?.trim() || rawSeries,
    seriesOrder: typeof book.seriesOrder === 'string' && book.seriesOrder ? book.seriesOrder : legacySeries?.[2]?.trim() || '',
    overview: typeof book.overview === 'string' && book.overview ? book.overview : prototype ? 'A cartographer discovers that the drowned parts of her city still exist behind doors that remember them.' : '',
    genre: typeof book.genre === 'string' && book.genre ? book.genre : prototype ? 'Fantasy' : '',
    writingStyle: typeof book.writingStyle === 'string' && book.writingStyle ? book.writingStyle : prototype ? 'Lyrical tension' : '',
    pointOfView: typeof book.pointOfView === 'string' && book.pointOfView ? book.pointOfView : prototype ? 'Third person limited' : '',
    tense: typeof book.tense === 'string' && book.tense ? book.tense : 'Past',
    language: typeof book.language === 'string' && book.language ? book.language : 'English',
  }
}

function BookSettings({ book, seriesOptions, onSave, onDelete }: {
  book: BookEntity | null
  seriesOptions: string[]
  onSave: (metadata: BookMetadata) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [draft, setDraft] = useState<BookMetadata | null>(book ? bookMetadata(book) : null)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const [addingSeries, setAddingSeries] = useState(false)
  const [newSeries, setNewSeries] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const savedRef = useRef(book ? JSON.stringify(bookMetadata(book)) : '')
  const latestDraftRef = useRef(draft)
  const saveHandlerRef = useRef(onSave)
  const saveSequenceRef = useRef(0)
  latestDraftRef.current = draft
  saveHandlerRef.current = onSave

  useEffect(() => {
    const next = book ? bookMetadata(book) : null
    setDraft(next)
    savedRef.current = next ? JSON.stringify(next) : ''
    setSaveStatus('saved')
    setAddingSeries(false)
    setDeleteConfirm(false)
  }, [book?.id])

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

  const options = [...new Set(['Standalone', draft.series, ...seriesOptions])].filter(Boolean)
  const update = <K extends keyof BookMetadata,>(key: K, value: BookMetadata[K]) => setDraft((current) => current ? { ...current, [key]: value } : current)
  const acceptSeries = () => {
    const value = newSeries.trim()
    if (!value) return
    update('series', value)
    setNewSeries('')
    setAddingSeries(false)
  }

  return <section className="book-settings">
    <div className="panel-title book-settings-title"><div><small>Current book</small><h2>Identity & voice</h2></div><span className={`book-save-status ${saveStatus}`} aria-live="polite"><i />{saveStatus === 'saving' ? 'Saving' : saveStatus === 'error' ? 'Save failed' : 'Saved'}</span></div>
    <section className="book-settings-group" aria-labelledby="book-identity-title">
      <div className="book-settings-group-title"><span>01</span><h3 id="book-identity-title">Identity</h3></div>
      <label className="book-field"><span>Book title</span><input value={draft.title} onChange={(event) => update('title', event.target.value)} onBlur={() => { if (!draft.title.trim()) update('title', book.title) }} placeholder="Untitled Book" /></label>
      <div className="book-field"><span>Series</span><div className="series-control"><select value={draft.series} onChange={(event) => update('series', event.target.value)}>{options.map((series) => <option key={series}>{series}</option>)}</select><button type="button" onClick={() => setAddingSeries((value) => !value)} aria-label={addingSeries ? 'Cancel adding series' : 'Add series'}>{addingSeries ? <X aria-hidden="true" /> : <Plus aria-hidden="true" />}</button></div></div>
      {addingSeries && <div className="new-series"><input autoFocus value={newSeries} onChange={(event) => setNewSeries(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') acceptSeries() }} placeholder="New series title" /><button type="button" disabled={!newSeries.trim()} onClick={acceptSeries}><Check aria-hidden="true" /> Accept</button></div>}
      {draft.series !== 'Standalone' && <label className="book-field compact"><span>Book number in series</span><input inputMode="numeric" value={draft.seriesOrder} onChange={(event) => update('seriesOrder', event.target.value)} placeholder="1" /></label>}
    </section>
    <section className="book-settings-group" aria-labelledby="story-profile-title">
      <div className="book-settings-group-title"><span>02</span><h3 id="story-profile-title">Story profile</h3></div>
      <label className="book-field"><span>Book overview</span><textarea rows={5} value={draft.overview} onChange={(event) => update('overview', event.target.value)} placeholder="What is this book about?" /></label>
      <label className="book-field"><span>Genre</span><input value={draft.genre} onChange={(event) => update('genre', event.target.value)} placeholder="Fantasy, mystery, romance…" /></label>
      <label className="book-field"><span>Writing style</span><select value={draft.writingStyle} onChange={(event) => update('writingStyle', event.target.value)}><option value="">Choose a style</option><option>Lyrical tension</option><option>Clean & cinematic</option><option>Close interior</option><option>Custom</option></select></label>
      <label className="book-field"><span>Point of view</span><select value={draft.pointOfView} onChange={(event) => update('pointOfView', event.target.value)}><option value="">Choose a point of view</option><option>First person</option><option>Second person</option><option>Third person limited</option><option>Third person omniscient</option><option>Multiple viewpoints</option></select></label>
      <div className="book-field-pair"><label className="book-field"><span>Tense</span><select value={draft.tense} onChange={(event) => update('tense', event.target.value)}><option>Past</option><option>Present</option><option>Mixed</option></select></label><label className="book-field"><span>Primary language</span><select value={draft.language} onChange={(event) => update('language', event.target.value)}><option>English</option><option>Spanish</option><option>French</option><option>German</option><option>Ukrainian</option><option>Other</option></select></label></div>
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
  expandedIds: Set<string>
  onToggle: (id: string) => void
  onOpenScene: (id: string) => void
  onCreate: (type: StructuralEntityType, parentId: string) => void
  onRename: (entity: StructuralEntity) => void
  onMove: (entity: StructuralEntity, direction: -1 | 1) => void
  onDelete: (entity: StructuralEntity) => void
}

function Outline({ book, entities, activeSceneId, expandedIds, onToggle, onOpenScene, onCreate, onRename, onMove, onDelete }: OutlineProps) {
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
      <OutlineRow entity={chapter} label={`Chapter ${index + 1}`} expanded={open} expandable onToggle={onToggle} onOpenScene={onOpenScene} onCreate={onCreate} onRename={onRename} onMove={onMove} onDelete={onDelete} first={index === 0} last={index === count - 1} />
      {open && <div className="tree-children">{scenes.length ? scenes.map((scene, sceneIndex) => <OutlineRow key={scene.id} entity={scene} label={`Scene ${sceneIndex + 1}`} selected={activeSceneId === scene.id} onToggle={onToggle} onOpenScene={onOpenScene} onCreate={onCreate} onRename={onRename} onMove={onMove} onDelete={onDelete} first={sceneIndex === 0} last={sceneIndex === scenes.length - 1} />) : <p className="tree-empty">No scenes yet</p>}</div>}
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
          <OutlineRow entity={act} label={`Act ${actIndex + 1}`} expanded={open} expandable onToggle={onToggle} onOpenScene={onOpenScene} onCreate={onCreate} onRename={onRename} onMove={onMove} onDelete={onDelete} first={actIndex === 0} last={actIndex === acts.length - 1} />
          {open && <div className="tree-children">{chapters.length ? chapters.map((chapter, chapterIndex) => renderChapter(chapter, chapterIndex, chapters.length)) : <p className="tree-empty">No chapters yet</p>}</div>}
        </div>
      })}
      {directChapters.length > 0 && <div className="direct-chapters">{acts.length > 0 && <small className="tree-group-label">Chapters without an act</small>}{directChapters.map((chapter, chapterIndex) => renderChapter(chapter, chapterIndex, directChapters.length))}</div>}
      {!acts.length && !directChapters.length && <div className="outline-empty"><BookOpenText aria-hidden="true" /><p>Add a chapter to start this manuscript.</p></div>}
    </div>
  </section>
}

function OutlineRow({ entity, label, selected = false, expandable = false, expanded = false, first, last, onToggle, onOpenScene, onCreate, onRename, onMove, onDelete }: {
  entity: StructuralEntity
  label: string
  selected?: boolean
  expandable?: boolean
  expanded?: boolean
  first: boolean
  last: boolean
  onToggle: (id: string) => void
  onOpenScene: (id: string) => void
  onCreate: (type: StructuralEntityType, parentId: string) => void
  onRename: (entity: StructuralEntity) => void
  onMove: (entity: StructuralEntity, direction: -1 | 1) => void
  onDelete: (entity: StructuralEntity) => void
}) {
  return <div className={`outline-row ${selected ? 'selected' : ''}`}>
    {expandable ? <button className="tree-toggle" type="button" onClick={() => onToggle(entity.id)} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${entity.title}`}>{expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}</button> : <span className="tree-spacer" />}
    <button className="tree-label" type="button" onClick={() => entity.type === 'scene' ? onOpenScene(entity.id) : onToggle(entity.id)}><small>{label}</small><span>{entity.title}</span></button>
    <SummaryIcon state="missing" />
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
function Notes() { return <section><div className="panel-title"><div><small>Reference</small><h2>Notes</h2></div><button type="button" aria-label="Add note"><Plus aria-hidden="true" /></button></div><input className="panel-search" placeholder="Search notes"/>{['Rules of the remembered doors','Questions for Act II','Images of the drowned city','Father’s timeline'].map((note) => <button className="list-row" key={note}><NotebookPen aria-hidden="true" /><span>{note}<small>Edited recently</small></span><ChevronRight aria-hidden="true" /></button>)}</section> }
function Codex() { return <section><div className="panel-title"><div><small>Book knowledge</small><h2>Codex</h2></div><button type="button"><Plus aria-hidden="true" /> New</button></div><input className="panel-search" placeholder="Search the Codex"/><div className="chips"><button>All</button><button>Characters</button><button>Places</button></div>{[['M','Mara Vale','Character'],['D','The Drowned Quarter','Place'],['B','Brass Compass','Object']].map(([letter,title,type]) => <button className="codex-row" key={title}><i>{letter}</i><span><small>{type}</small>{title}</span><ChevronRight aria-hidden="true" /></button>)}</section> }
function ChatList({onOpen,activeChat,onSettings}:{onOpen:(title:string)=>void;activeChat:string;onSettings:()=>void}) { return <section><div className="panel-title"><div><small>Conversations</small><h2>Chats</h2></div><button type="button" aria-label="Start new chat"><Plus aria-hidden="true" /></button></div>{activeChat && <button className="current-chat" onClick={onSettings}><Settings2 aria-hidden="true" /><span><small>Current chat</small>{activeChat} settings</span><ChevronRight aria-hidden="true" /></button>}<input className="panel-search" placeholder="Search chats"/>{chats.map(([title,preview,time]) => <button className="chat-row" key={title} onClick={() => onOpen(title)}><i><MessageCircle aria-hidden="true" /></i><span><strong>{title}</strong><small>{preview}</small></span><em>{time}</em></button>)}</section> }
function ChatSettings({title,onBack}:{title:string;onBack:()=>void}) { return <section><button className="back-list" onClick={onBack}><ArrowLeft aria-hidden="true" /> All chats</button><div className="panel-title"><div><small>Current chat</small><h2>{title}</h2></div></div><label className="panel-field"><span>System prompt</span><textarea defaultValue="You are a thoughtful story collaborator. Use only selected book context."/></label><label className="panel-field"><span>Model</span><select><option>Claude 3.7 Sonnet</option><option>GPT-4.1</option></select></label><label className="thinking"><span>Thinking<small>Allow longer internal reasoning</small></span><input type="checkbox" defaultChecked/></label><label className="panel-field"><span>Context</span><div className="chips"><button>Chapter 7 <X aria-hidden="true" /></button><button>Codex <X aria-hidden="true" /></button><button><Plus aria-hidden="true" /> Add</button></div></label></section> }

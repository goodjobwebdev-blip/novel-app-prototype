import AuthorGoalsTasks from './AuthorGoalsTasks'
import { CharacterChatSetup, RoleplayParticipant } from './CharacterChatControls'
import CodexDashboard from './CodexDashboard'
import { resolveEntryAt } from './codex-timeline-service'
import CodexTimeline from './CodexTimeline'
import { ImagePlus } from 'lucide-react'
import CodexTemplates from './CodexTemplates'
import { LoreTypeSelect, LoreTypesManager } from './LoreTypesControls'
import { CodexScopeControls, SeriesCodexManager } from './SeriesCodexControls'
import { codexScopeLabel } from './series-codex'
import NoteRoleControls from './NoteRoleControls'
import { useMediaWorkspaceDraft } from './useMediaWorkspaceDraft'
import SynonymsDialog from './SynonymsDialog'
import SelectionTools from './SelectionTools'
import QuickRewriteDialog from './QuickRewriteDialog'
import type { QuickTool, QuickToolCapture } from './quick-tools'
import type { EditorSelectionInfo } from './MarkdownEditor'
import { loadUiSettings, UI_SETTINGS_EVENT } from './ui-settings'
import { sceneBeats, prepareAutomaticBeat, beatPassage, bindBeatPassage, passageMarkers, passageMarker } from './scene-beats'
import { generateSceneBeat } from './scene-beat-generation'
import ProseRewriteDialog from './ProseRewriteDialog'
import type { EditorSelectionSnapshot } from './MarkdownEditor'
import type { LocatedBlock } from './document-projection.ts'
import { proseText } from './document-projection.ts'
import EditorBlocks, { type BlockEditRequest } from './EditorBlocks'
import SceneWritingSettings from './SceneWritingSettings'
import { sceneWritingValues } from './scene-writing'
import { applyChatManagementChange } from './persistence'
import Composer from './Composer'
import { startImageQueue } from './image-queue'
import ImageWorkspace from './ImageWorkspace'
import { useImageQuery } from './image-hooks'
import { listImageJobs } from './image-store'
import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { createPortal } from 'react-dom'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Archive,
  ArchiveRestore,
  Bot,
  BookOpenText,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CornerUpLeft,
  Feather,
  FileQuestion,
  FileText,
  GitFork,
  MessageCircle,
  Image as ImageIcon,
  Mic,
  NotebookPen,
  PanelBottomOpen,
  Pause,
  Pencil,
  Play,
  Plus,
  Redo2,
  RefreshCw,
  RotateCcw,
  RotateCw,
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
import CodexIllustration, { CodexThumbnail } from './CodexIllustration'
import BookStorage, { BookBackupImport } from './BookStorage'
import { useBookLibrary } from './useBookLibrary'
import { generationWordDelayMs, loadAiSettings, textAiIsConfigured, type AiSettings } from './ai-settings'
import { createBufferedWordRenderer } from './buffered-word-renderer'
import { applyIfStillCurrent } from './async-state-guard'
import { LatestAsyncIntent, bookScopeMatches, documentBelongsToBook } from './book-scope-guard'
import { KeyedAsyncQueue } from './keyed-async-queue'
import { runDeletionSaveBarrier } from './deletion-save-barrier'
import { navigateAfterRequiredSave, saveRequiredBeforeNavigation } from './navigation-save-guard'
import { canUnmountEditor } from './editor-unmount-guard'
import { summaryGenerationOwnsUi, type SummaryGenerationOwner } from './summary-generation-owner'
import ExpandableTextInput, { type ExpandableTextInputDictationTarget } from './ExpandableTextInput'
import GenerationActions from './GenerationActions'
import MarkdownEditor, { type CodexMentionClick, type GenerationContext, type MarkdownEditorHandle } from './MarkdownEditor'
import type { NanoGPTStreamMetadata } from './nanogpt'
import { fetchTextProviderModelContextLength, streamTextProviderCompletion, textProviderRequestText } from './text-provider'
import { assertPromptTemplateValid, type BookPromptValues } from './prompt-template'
import { assembleStoryGenerationRequest, STORY_CONTINUE_FALLBACK } from './story-request'
import { assembleCodexGenerationRequest, CODEX_CONTINUE_FALLBACK } from './codex-request'
import { replaceGenerationInstruction } from './regeneration-instruction'
import { prepareSummaryGeneration } from './summary-generation'
import type { NormalizedProviderMessage } from './prompt-composition'
import { buildContextValues, generationContextDiagnostics } from './context-service'
import {
  PROTOTYPE_BOOK_ID,
  archiveCodexEntry,
  createBook,
  createCodexEntry,
  createCodexDependency,
  createNote,
  createSeries as createSeriesEntity,
  createSnapshot,
  createStructuralEntity,
  collectEntityTreeIds,
  deleteEntityTree,
  ensureBookAiSettings,
  getEntity,
  getBookAiSettings,
  getBookContextSettings,
  getGenerationContextProfile,
  getOrCreateSummary,
  isCodexEntryArchived,
  listBooks,
  listCodexDependencies,
  listEntitiesByBook,
  listSeries,
  moveStructuralEntity,
  renameEntity,
  renameSeries as renameSeriesEntity,
  restoreCodexEntry,
  removeCodexDependency,
  saveDocumentContent,
  saveBookAiSettings,
  rememberLastOpenedScene,
  saveSummaryContent,
  updateBookMetadata,
  updateCodexCategory,
  updateCodexDependency,
  updateCodexAutoIncludeTriggers,
  updateCodexSummaryPreference,
  type ArcEntity,
  type BookEntity,
  type BookMetadata,
  type CodexDependencyEdge,
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
import { buildSummarySource, getSummaryStateMap, summaryStateForSource, type SummaryState } from './summary-service'
import { buildCodexMentionIndex, type CodexMentionEntry, type CodexMentionTerm } from './codex-trigger-service'
import { generateAutotitleSuggestion, prepareAutotitleRequest, type AutotitleEntity, type AutotitleRequest, type AutotitleTargetType } from './autotitle-service'
import { dismissTtsState, prepareSpeechPlayback, getTtsState, pauseTtsSession, replayTtsSession, resumeTtsSession, seekTtsBy, seekTtsTo, startTtsSession, stopTtsSession, subscribeTtsState, type TtsState } from './tts-service'
import { cancelSttSession, dismissSttState, getSttState, normalizeTranscriptForInsertion, startSttSession, stopSttSession, subscribeSttState, type SttState } from './stt-service'
import { ChatSidebar, ChatView } from './ChatFeature'
import './generation-controls.css'
import './codex-archive.css'
import './codex-summary.css'
import './autotitle.css'
import './tts.css'
import './codex-triggers.css'
import './codex-mentions.css'
import './codex-dependencies.css'

type Screen = 'home' | 'editor' | 'chat' | 'images' | 'settings'
type ContentScreen = Exclude<Screen, 'images' | 'settings'>
type RightTab = 'book' | 'outline' | 'notes' | 'codex' | 'chat'
type ChatPanel = 'list' | 'settings'
type SaveState = 'loading' | 'saving' | 'saved' | 'error'
type GenerationPhase = 'sending' | 'thinking' | 'writing' | 'stopping'
type ToastMessage = { id: number; message: string }
type AutotitleUiState = { targetId: string; targetType: AutotitleTargetType; targetTitle: string; status: 'loading' | 'ready' | 'error'; suggestion?: string; error?: string; request?: AutotitleRequest }
type LoreMentionPreview = { entryId: string; title: string; category: string; content: string; source: 'summary' | 'excerpt' }
type LoreMentionPopupState = { id: number; term: CodexMentionTerm; anchor: CodexMentionClick['rect']; selectedId?: string; loading?: boolean; preview?: LoreMentionPreview; error?: string }
type ActiveSummaryGenerationOwner = SummaryGenerationOwner & { controller: AbortController }
type GenerationRequestSnapshot = {
  provider: AiSettings['provider']
  baseUrl: string
  model: string
  systemPrompt: string
  contextMessage: string
  userMessage: string
  messages?: NormalizedProviderMessage[]
  estimatedRequestTokens?: number
  modelContextTokens?: number
  effectiveContextLimit?: string
}
type GenerationDetails = NanoGPTStreamMetadata & {
  task: 'Story' | 'Codex' | 'Summary'
  action: 'Generate' | 'Regenerate' | 'Summarize' | 'Re-summarize'
  targetTitle: string
  requestedModel: string
  provider: 'NanoGPT' | 'Fake (testing)'
  startedAt: number
  finishedAt?: number
  status: GenerationPhase | 'complete' | 'cancelled' | 'error'
  thoughts: string
  estimatedRequestTokens?: number
  modelContextTokens?: number
}

const chats = [
  ['Mara’s motivation', 'Her fear of becoming like her father…', 'Now'],
  ['Chapter 7 continuity', 'The compass first appeared in Scene 1…', 'Yesterday'],
  ['Ideas for Act II', 'Three possible costs for crossing…', 'Aug 31'],
]

function ImageActivityBadge({ active, review, attention }: { active: number; review: number; attention: number }) {
  if (attention) return <span className="image-activity-badge attention" aria-label={`${attention} image ${attention === 1 ? 'generation needs' : 'generations need'} attention`}>!</span>
  if (review) return <span className="image-activity-badge review" aria-label={`${review} generated ${review === 1 ? 'image needs' : 'images need'} review`}>{review > 9 ? '9+' : review}</span>
  if (active) return <span className="image-activity-badge active" aria-label={`${active} image ${active === 1 ? 'generation is' : 'generations are'} active`}>{active > 9 ? '9+' : active}</span>
  return null
}

const initialStoryMarkdown = `# The City Beneath the Tide

_Chapter Seven · The Cartographer's Door_

Mara found the door at low tide, where the old maps insisted there was only sea.

It stood alone in the blue hour—cedar darkened by salt, a brass handle warm beneath her palm. Behind it, something knocked **three times**.

She opened her notebook and wrote the rule exactly as her father had taught her:

> Never answer a door that remembers your name.

Then the voice on the other side whispered, _Mara Vale_, and every compass in her satchel turned toward it.`

export default function Workspace() {
  const [screen, setScreen] = useState<Screen>('home')
  const [settingsInitialTab, setSettingsInitialTab] = useState<'ai' | 'images'>('ai')
  useEffect(() => startImageQueue(), [])
  const [returnScreen, setReturnScreen] = useState<Screen>('home')
  const [imageReturnScreen, setImageReturnScreen] = useState<ContentScreen>('home')
  const [imageWorkspaceState, setImageWorkspaceState, imageDraftError] = useMediaWorkspaceDraft()
  const [rightOpen, setRightOpen] = useState(false)
  const [rightTab, setRightTab] = useState<RightTab>('outline')
  const [chatPanel, setChatPanel] = useState<ChatPanel>('list')
  const [activeChatId, setActiveChatId] = useState('')
  const [storyMarkdown, setStoryMarkdown] = useState(initialStoryMarkdown)
  const [arcPrompt, setArcPrompt] = useState('')
  const [drawerCollapsed, setDrawerCollapsed] = useState(false)
  const [lorePrompt, setLorePrompt] = useState('')
  const [codexTriggerDraft, setCodexTriggerDraft] = useState('')
  const [chatEdit, setChatEdit] = useState(false)
  const [aiReady, setAiReady] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('loading')
  const [generationActive, setGenerationActive] = useState(false)
  const [generationPhase, setGenerationPhase] = useState<GenerationPhase | null>(null)
  const [generationElapsedSeconds, setGenerationElapsedSeconds] = useState(0)
  const [generationDetails, setGenerationDetails] = useState<GenerationDetails | null>(null)
  const [generationDetailsOpen, setGenerationDetailsOpen] = useState(false)
  const [blockEditRequest, setBlockEditRequest] = useState<BlockEditRequest | null>(null)
  const [selectedProse, setSelectedProse] = useState<{ documentId: string; selection: EditorSelectionInfo } | null>(null)
  const [quickTool, setQuickTool] = useState<{ tool: QuickTool; capture: QuickToolCapture } | null>(null)
  const [showBeats, setShowBeats] = useState(() => loadUiSettings().sceneBeats !== false)
  const [characterSetupEntry, setCharacterSetupEntry] = useState<string | null>(null)
  const [timelineView, setTimelineView] = useState<{ entryId: string; nonBaseline: boolean }>()
  const [imageInsertRequest, setImageInsertRequest] = useState<string | null>(null)
  const [beatRewrite, setBeatRewrite] = useState<{ documentId: string; snapshot: EditorSelectionSnapshot; instruction: string } | null>(null)
  useEffect(() => { const sync = () => setShowBeats(loadUiSettings().sceneBeats !== false); window.addEventListener(UI_SETTINGS_EVENT, sync); window.addEventListener('storage', sync); return () => { window.removeEventListener(UI_SETTINGS_EVENT, sync); window.removeEventListener('storage', sync) } }, [])
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [lastGeneratedPassage, setLastGeneratedPassage] = useState('')
  const [sttState, setSttState] = useState<SttState>(() => getSttState())
  const [ttsState, setTtsState] = useState<TtsState>(() => getTtsState())
  const [editorHistory, setEditorHistory] = useState({ canUndo: false, canRedo: false })
  const [autotitle, setAutotitle] = useState<AutotitleUiState | null>(null)
  const [loreMention, setLoreMention] = useState<LoreMentionPopupState | null>(null)
  const { books: bookList, setBooks: setBookList, series: seriesList, setSeries: setSeriesList, state: libraryState, error: libraryError, slow: librarySlow, retry: retryLibrary } = useBookLibrary(initialStoryMarkdown)
  const { data: imageJobs } = useImageQuery(listImageJobs, [], [])
  const visibleImageJobs = imageJobs.filter((job) => !job.hiddenInQueue)
  const activeImageJobs = visibleImageJobs.filter((job) => job.status === 'queued' || job.status === 'running').length
  const reviewImageJobs = visibleImageJobs.filter((job) => job.status === 'completed' && Boolean(job.assetId) && !job.decision).length
  const attentionImageJobs = visibleImageJobs.filter((job) => ['failed', 'interrupted'].includes(job.status)).length
  const [creatingBook, setCreatingBook] = useState(false)
  const [currentBook, setCurrentBook] = useState<BookEntity | null>(null)
  const [outlineEntities, setOutlineEntities] = useState<StructuralEntity[]>([])
  const [notes, setNotes] = useState<NoteEntity[]>([])
  const [codexEntries, setCodexEntries] = useState<CodexEntryEntity[]>([])
  const [codexDependencies, setCodexDependencies] = useState<CodexDependencyEdge[]>([])
  const [summaryStates, setSummaryStates] = useState<Record<string, SummaryState>>({})
  const [activeDocument, setActiveDocument] = useState<EditableEntity | null>(null)
  useEffect(() => { setGenerationDetails(null); setGenerationDetailsOpen(false); setQuickTool(null); setSelectedProse(null); setBeatRewrite(null) }, [activeDocument?.id, currentBook?.id])
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
  const documentSaveQueueRef = useRef(new KeyedAsyncQueue())
  const bookMetadataSaveQueueRef = useRef(new KeyedAsyncQueue())
  const deletingEntityIdsRef = useRef(new Set<string>())
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const generationAbortRef = useRef<AbortController | null>(null)
  const autotitleAbortRef = useRef<AbortController | null>(null)
  const generationStartedAtRef = useRef(0)
  const latestGenerationRequestRef = useRef<GenerationRequestSnapshot | null>(null)
  const settingsGenerationContextRef = useRef<GenerationContext | null>(null)
  const summaryGenerationSequenceRef = useRef(0)
  const summaryGenerationOwnerRef = useRef<ActiveSummaryGenerationOwner | null>(null)
  const currentBookIdRef = useRef<string | null>(currentBook?.id ?? null)
  const bookOpenIntentRef = useRef(new LatestAsyncIntent())
  const documentLoadIntentRef = useRef(new LatestAsyncIntent())
  const bookRefreshIntentRef = useRef(new LatestAsyncIntent())
  const screenRef = useRef<Screen>(screen)
  currentBookIdRef.current = currentBook?.id ?? null
  screenRef.current = screen
  const codexMentionIndex = useMemo(() => buildCodexMentionIndex(codexEntries), [codexEntries])

  useEffect(() => {
    setArcPrompt('')
    setLorePrompt('')
    setLastGeneratedPassage('')
    setEditorHistory({ canUndo: false, canRedo: false })
    setCodexTriggerDraft(activeDocument?.type === 'codexEntry' ? (activeDocument.autoIncludeTriggers ?? []).join('\n') : '')
    setLoreMention(null)
  }, [activeDocument?.id])

  useEffect(() => {
    const settings = loadAiSettings()
    setAiReady(textAiIsConfigured(settings))
  }, [])

  useEffect(() => subscribeSttState(setSttState), [])
  useEffect(() => subscribeTtsState(setTtsState), [])

  useEffect(() => () => {
    generationAbortRef.current?.abort()
    autotitleAbortRef.current?.abort()
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
  }, [])

  useEffect(() => {
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
    storageReadyRef.current = libraryState === 'ready'
    if (libraryState === 'ready') setSaveState('saved')
  }, [libraryState])

  async function flushDocument(reason: SnapshotReason = 'autosave', snapshot = false): Promise<boolean> {
    const documentId = activeDocumentIdRef.current
    if (!storageReadyRef.current || !documentId || deletingEntityIdsRef.current.has(documentId)) return false
    if (activeDocument?.id === documentId && activeDocument.codexScope === 'inherited' && !changedSinceSnapshotRef.current) return true
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    if (activeDocumentIdRef.current === documentId) setSaveState('saving')

    while (true) {
      if (deletingEntityIdsRef.current.has(documentId)) return false
      const contentSnapshot = storyRef.current
      const snapshotRequested = snapshot && changedSinceSnapshotRef.current
      let savedDocument: EditableEntity
      try {
        savedDocument = await documentSaveQueueRef.current.run(documentId, async () => {
          const current = await getEntity<EditableEntity>(documentId)
          if (!current) throw new Error(`Cannot save missing document ${documentId}`)
          return current.type === 'summary'
            ? await saveSummaryContent(current.id, contentSnapshot, (await buildSummarySource(current.sourceEntityId)).sourceRevision)
            : await saveDocumentContent(documentId, contentSnapshot) as EditableEntity
        })
      } catch (error) {
        console.error('Failed to persist document', error)
        if (activeDocumentIdRef.current === documentId) setSaveState('error')
        return false
      }

      const editedAt = Date.now()
      if (savedDocument.type === 'note') setNotes((items) => items.map((item) => item.id === savedDocument.id ? savedDocument : item))
      if (savedDocument.type === 'codexEntry') setCodexEntries((items) => items.map((item) => item.id === savedDocument.id ? savedDocument : item))
      setCurrentBook((book) => book && book.id === savedDocument.bookId ? { ...book, updatedAt: editedAt } : book)
      setBookList((books) => books.map((book) => book.id === savedDocument.bookId ? { ...book, updatedAt: editedAt } : book))

      if (activeDocumentIdRef.current !== documentId) return true
      if (storyRef.current !== contentSnapshot) {
        // A newer edit arrived while this immutable snapshot was saving. Autosave may
        // leave it for the newly scheduled debounce; navigation/snapshot saves must
        // continue until the exact current editor value is durable.
        if (!snapshot) return true
        setSaveState('saving')
        continue
      }

      let nextSummaryStates: Record<string, SummaryState> | null = null
      try {
        if (savedDocument.bookId) nextSummaryStates = await getSummaryStateMap(savedDocument.bookId)
        if (snapshotRequested) {
          await documentSaveQueueRef.current.run(documentId, async () => {
            await createSnapshot(documentId, reason, contentSnapshot)
          })
        }
      } catch (error) {
        console.error('Failed to finalize document save', error)
        if (activeDocumentIdRef.current === documentId) setSaveState('error')
        return false
      }

      if (activeDocumentIdRef.current !== documentId) return true
      if (storyRef.current !== contentSnapshot) {
        if (!snapshot) return true
        setSaveState('saving')
        continue
      }

      if (snapshotRequested) changedSinceSnapshotRef.current = false
      setActiveDocument(savedDocument)
      if (nextSummaryStates) setSummaryStates(nextSummaryStates)
      setSaveState('saved')
      return true
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
    if (activeDocument?.type === 'scene') {
      setOutlineEntities((items) => items.map((item) => item.id === activeDocument.id ? { ...item, content: value } : item))
    }
    if (generationAbortRef.current && activeDocument?.type === 'codexEntry') {
      setStoryMarkdown(value)
      return
    }
    changedSinceSnapshotRef.current = true
    setStoryMarkdown(value)
    if (storageReadyRef.current) setSaveState('saving')
  }

  type LoadedBookContent = {
    structural: StructuralEntity[]
    notes: NoteEntity[]
    codexEntries: CodexEntryEntity[]
    codexDependencies: CodexDependencyEdge[]
    summaryStates: Record<string, SummaryState>
  }

  async function readBookContent(bookId: string): Promise<LoadedBookContent> {
    const [entities, codexDependencySnapshot, summaryStateSnapshot] = await Promise.all([
      listEntitiesByBook(bookId),
      listCodexDependencies(bookId),
      getSummaryStateMap(bookId),
    ])
    return {
      structural: entities.filter((entity): entity is StructuralEntity => ['act', 'chapter', 'scene'].includes(entity.type)),
      notes: entities.filter((entity): entity is NoteEntity => entity.type === 'note').sort((a, b) => b.updatedAt - a.updatedAt),
      codexEntries: entities.filter((entity): entity is CodexEntryEntity => entity.type === 'codexEntry').sort((a, b) => a.title.localeCompare(b.title)),
      codexDependencies: codexDependencySnapshot,
      summaryStates: summaryStateSnapshot,
    }
  }

  function applyBookContent(content: LoadedBookContent) {
    setOutlineEntities(content.structural)
    setNotes(content.notes)
    setCodexEntries(content.codexEntries)
    setCodexDependencies(content.codexDependencies)
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

    await ensureBookAiSettings(bookId, loadAiSettings())
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

  async function importedBook(bookId: string) {
    setBookList(await listBooks())
    setSeriesList(await listSeries())
    await openBook(bookId)
  }

  async function prepareBookExport() {
    if (generationActive) throw new Error('Stop generation before exporting a backup.')
    if (activeDocumentIdRef.current && !await flushDocument('manual', true)) throw new Error('The current document could not be saved. Retry before exporting.')
  }

  async function deleteWithSaveBarrier(rootId: string) {
    const ids = await collectEntityTreeIds(rootId)
    if (activeDocumentIdRef.current && ids.includes(activeDocumentIdRef.current) && saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    return runDeletionSaveBarrier(
      ids,
      deletingEntityIdsRef.current,
      (id) => documentSaveQueueRef.current.whenIdle(id),
      () => deleteEntityTree(rootId),
    )
  }

  async function makeBook() {
    if (creatingBook || libraryState !== 'ready') return
    setCreatingBook(true)
    try {
      const created = await createBook(loadAiSettings())
      setBookList(await listBooks())
      await openBook(created.book.id, created.scene.id)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not create the book.')
    } finally {
      setCreatingBook(false)
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
    await deleteWithSaveBarrier(book.id)
    const books = await listBooks()
    setBookList(books)
    if (currentBook?.id === book.id) {
      bookOpenIntentRef.current.invalidate()
      documentLoadIntentRef.current.invalidate()
      bookRefreshIntentRef.current.invalidate()
      currentBookIdRef.current = null
      setCurrentBook(null)
      setOutlineEntities([])
      setNotes([])
      setCodexEntries([])
      setCodexDependencies([])
      setSummaryStates({})
      activeDocumentIdRef.current = null
      setActiveDocument(null)
      activeSceneIdRef.current = null
      setActiveSceneId(null)
    }
  }

  useEffect(() => {
    let active = true
    const refresh = () => {
      const bookId = currentBookIdRef.current, documentId = activeDocumentIdRef.current
      if (!bookId || generationActive) return
      void (async () => {
        await reloadBookContent(bookId)
        if (!active || currentBookIdRef.current !== bookId || activeDocumentIdRef.current !== documentId || changedSinceSnapshotRef.current) return
        if (documentId && activeDocument?.codexScope === 'inherited') {
          const entry = await getEntity<CodexEntryEntity>(documentId)
          if (!active || currentBookIdRef.current !== bookId || activeDocumentIdRef.current !== documentId) return
          if (entry && !entry.hiddenInBook) { setActiveDocument(entry); setStoryMarkdown(entry.content); storyRef.current = entry.content; setEditorRevision(value => value + 1) }
          else { setActiveDocument(null); activeDocumentIdRef.current = null; setStoryMarkdown(''); storyRef.current = '' }
        }
      })().catch(() => showToast('Shared lore could not be refreshed.'))
    }
    window.addEventListener('arc-series-codex-changed', refresh); window.addEventListener('focus', refresh)
    return () => { active = false; window.removeEventListener('arc-series-codex-changed', refresh); window.removeEventListener('focus', refresh) }
  }, [currentBook?.id, activeDocument?.id, activeDocument?.codexScope, generationActive])

  useEffect(() => {
    let active = true
    const refreshType = () => {
      const id = activeDocumentIdRef.current, bookId = currentBookIdRef.current
      if (!id || !bookId) return
      void getEntity<EditableEntity>(id).then(entry => {
        if (!active || !entry || entry.bookId !== currentBookIdRef.current || activeDocumentIdRef.current !== id) return
        if (entry.type === 'codexEntry') setActiveDocument(current => current?.id === id ? { ...current, typeId: entry.typeId, category: entry.category, updatedAt: entry.updatedAt, sourceRevision: entry.sourceRevision } : current)
        if (entry.type === 'note') setActiveDocument(current => current?.id === id ? { ...current, compatibleLoreTypeIds: entry.compatibleLoreTypeIds, useAsCodexTemplate: entry.useAsCodexTemplate, useAsChatSkill: entry.useAsChatSkill } : current)
      }).catch(() => showToast('The lore type label could not be refreshed.'))
    }
    window.addEventListener('arc-lore-types-changed', refreshType)
    return () => { active = false; window.removeEventListener('arc-lore-types-changed', refreshType) }
  }, [currentBook?.id, activeDocument?.id])

  async function beforeSeriesCodexChange() {
    if (generationActive) throw new Error('Stop generation before changing shared lore.')
    if (changedSinceSnapshotRef.current && !await flushDocument('navigation', true)) throw new Error('Save the current document before changing shared lore.')
  }

  async function refreshSeriesCodexWorkspace() {
    const bookId = currentBookIdRef.current
    if (!bookId) return
    await reloadBookContent(bookId)
    if (activeDocumentIdRef.current) {
      const refreshed = await getEntity<EditableEntity>(activeDocumentIdRef.current)
      if (refreshed?.type === 'codexEntry' && refreshed.bookId === bookId && !refreshed.hiddenInBook) await loadDocument(refreshed.id, false)
      else if (activeDocument?.type === 'codexEntry') { setActiveDocument(null); activeDocumentIdRef.current = null; setStoryMarkdown(''); storyRef.current = '' }
    }
  }

  async function saveBookMetadata(metadata: BookMetadata, seriesLorePolicy: 'keep' | 'remove' = 'keep') {
    const sourceBookId = currentBookIdRef.current
    if (!sourceBookId) return
    const updated = await bookMetadataSaveQueueRef.current.run(sourceBookId, () => updateBookMetadata(sourceBookId, metadata, seriesLorePolicy))
    setBookList((books) => books.map((book) => book.id === updated.id ? updated : book))
    if (bookScopeMatches(sourceBookId, currentBookIdRef.current)) { setCurrentBook(updated); await reloadBookContent(sourceBookId) }
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
    await deleteWithSaveBarrier(currentBook.id)
    const books = await listBooks()
    setBookList(books)
    bookOpenIntentRef.current.invalidate()
    documentLoadIntentRef.current.invalidate()
    bookRefreshIntentRef.current.invalidate()
    currentBookIdRef.current = null
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
      const refreshed = await reloadBookContent(currentBook.id)
      if (!refreshed) return
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
    const removedIds = await deleteWithSaveBarrier(entity.id)
    const entities = await reloadBookContent(currentBook.id)
    if (!entities) return
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

  async function openSummary(source: StructuralEntity | CodexEntryEntity) {
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

  async function addNote() {
    if (!currentBook) return
    try {
      const sourceBookId = currentBook.id
      const note = await createNote(sourceBookId)
      if (!await reloadBookContent(sourceBookId)) return
      await loadDocument(note.id)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not create the note.')
    }
  }

  async function addCodexEntry() {
    if (!currentBook) return
    try {
      const sourceBookId = currentBook.id
      const entry = await createCodexEntry(sourceBookId)
      if (!await reloadBookContent(sourceBookId)) return
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
    const removedIds = await deleteWithSaveBarrier(entity.id)
    await reloadBookContent(currentBook.id)
    if (activeDocumentIdRef.current && removedIds.includes(activeDocumentIdRef.current)) {
      activeDocumentIdRef.current = null
      setActiveDocument(null)
      storyRef.current = ''
      setStoryMarkdown('')
      changedSinceSnapshotRef.current = false
      if (activeSceneIdRef.current) await loadScene(activeSceneIdRef.current, false)
    }
  }

  async function changeCodexCategory(category: string) {
    if (activeDocument?.type !== 'codexEntry' || !currentBook || isCodexEntryArchived(activeDocument)) return
    const sourceId = activeDocument.id
    const updated = await updateCodexCategory(sourceId, category)
    setCodexEntries((items) => items.map((item) => item.id === updated.id ? updated : item))
    applyIfStillCurrent(sourceId, () => activeDocumentIdRef.current, () => setActiveDocument(updated))
  }

  async function saveCodexTriggers() {
    if (activeDocument?.type !== 'codexEntry' || isCodexEntryArchived(activeDocument)) return
    const sourceId = activeDocument.id
    const triggerSnapshot = codexTriggerDraft.split(/\r?\n/)
    try {
      const updated = await updateCodexAutoIncludeTriggers(sourceId, triggerSnapshot)
      setCodexEntries((entries) => entries.map((entry) => entry.id === updated.id ? updated : entry))
      applyIfStillCurrent(sourceId, () => activeDocumentIdRef.current, () => {
        setActiveDocument(updated)
        setCodexTriggerDraft((updated.autoIncludeTriggers ?? []).join('\n'))
      })
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not save Codex triggers.')
    }
  }

  async function changeCodexSummaryPreference(prefer: boolean) {
    if (activeDocument?.type !== 'codexEntry' || !currentBook || isCodexEntryArchived(activeDocument)) return
    const sourceId = activeDocument.id
    const updated = await updateCodexSummaryPreference(sourceId, prefer)
    setCodexEntries((items) => items.map((item) => item.id === updated.id ? updated : item))
    applyIfStillCurrent(sourceId, () => activeDocumentIdRef.current, () => setActiveDocument(updated))
  }

  async function addCodexDependency(sourceId: string, targetId: string) {
    if (!currentBook || sourceId !== activeDocumentIdRef.current) return
    try {
      const edge = await createCodexDependency(currentBook.id, sourceId, targetId)
      setCodexDependencies((items) => [...items, edge].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)))
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not add the dependency.')
    }
  }

  async function changeCodexDependency(edgeId: string, patch: { relationLabel?: string; includeWithSource?: boolean }) {
    try {
      const updated = await updateCodexDependency(edgeId, patch)
      setCodexDependencies((items) => items.map((edge) => edge.id === updated.id ? updated : edge))
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not update the dependency.')
    }
  }

  async function deleteCodexDependency(edgeId: string) {
    try {
      await removeCodexDependency(edgeId)
      setCodexDependencies((items) => items.filter((edge) => edge.id !== edgeId))
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not remove the dependency.')
    }
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

  async function openImages(from: ContentScreen) {
    if (from === 'editor' && !canUnmountEditor(Boolean(generationAbortRef.current))) {
      showToast('Stop generation before opening Images.')
      return
    }
    const opened = await navigateAfterRequiredSave(
      from === 'editor' && changedSinceSnapshotRef.current,
      () => flushDocument('navigation', true),
      () => {
        setImageReturnScreen(from)
        setScreen('images')
        setRightOpen(false)
      },
    )
    if (!opened) showToast('Could not save the current document. Images was not opened because its book context could be stale.')
  }

  function openSettings(from: Screen, tab: 'ai' | 'images' = 'ai') {
    if (from === 'editor' && !canUnmountEditor(Boolean(generationAbortRef.current))) {
      showToast('Stop generation before opening Settings.')
      return
    }
    settingsGenerationContextRef.current = from === 'editor' && (activeDocument?.type === 'scene' || activeDocument?.type === 'codexEntry')
      ? editorRef.current?.captureGenerationContext() ?? { sceneText: storyRef.current, insertionPosition: storyRef.current.length }
      : null
    if (from === 'editor' && changedSinceSnapshotRef.current) void flushDocument('navigation', true)
    setSettingsInitialTab(tab)
    setReturnScreen(from)
    setScreen('settings')
    setRightOpen(false)
  }

  async function openChat(chatId: string) {
    if (screen === 'editor' && !canUnmountEditor(Boolean(generationAbortRef.current))) {
      showToast('Stop generation before opening Chat.')
      return
    }
    const opened = await navigateAfterRequiredSave(
      screen === 'editor' && changedSinceSnapshotRef.current,
      () => flushDocument('navigation', true),
      () => {
        setActiveChatId(chatId)
        setChatPanel('list')
        setScreen('chat')
        setRightOpen(false)
      },
    )
    if (!opened) showToast('Could not save the current document. Chat was not opened because its context could be stale.')
  }

  function showToast(message: string) {
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

  function compactLoreExcerpt(markdown: string, title: string, limit = 700) {
    const text = markdown.trim()
    if (text.length <= limit) return text || '_No description provided._'
    const cut = text.slice(0, limit)
    const boundary = Math.max(cut.lastIndexOf('\n\n'), cut.lastIndexOf(' '))
    return `${cut.slice(0, boundary > limit * .55 ? boundary : limit).trim()}…`
  }

  async function loadLoreMentionPreview(popupId: number, selected: CodexMentionEntry) {
    const entry = codexEntries.find((candidate) => candidate.id === selected.id)
    if (!entry || isCodexEntryArchived(entry) || !currentBook) {
      setLoreMention((current) => current?.id === popupId ? { ...current, loading: false, error: 'This Codex entry is no longer available.' } : current)
      return
    }
    setLoreMention((current) => current?.id === popupId ? { ...current, selectedId: entry.id, loading: true, preview: undefined, error: undefined } : current)
    try {
      const entities = await listEntitiesByBook(currentBook.id)
      const summary = entities.find((entity): entity is SummaryEntity => entity.type === 'summary' && entity.sourceEntityId === entry.id)
      const state = activeSceneId ? await resolveEntryAt(entry.id, { bookId: currentBook.id, sceneId: activeSceneId }) : undefined
      const currentSummary = state ? state.summary ?? '' : summaryStateForSource(entry, entities) === 'current' && summary?.content.trim() ? summary.content.trim() : ''
      const preview: LoreMentionPreview = {
        entryId: entry.id,
        title: entry.title,
        category: entry.category,
        content: compactLoreExcerpt(currentSummary || state?.content || proseText(entry.content), entry.title),
        source: currentSummary ? 'summary' : 'excerpt',
      }
      setLoreMention((current) => current?.id === popupId ? { ...current, selectedId: entry.id, loading: false, preview } : current)
    } catch {
      setLoreMention((current) => current?.id === popupId ? { ...current, loading: false, error: 'Lore preview could not be loaded.' } : current)
    }
  }

  function openLoreMention(mention: CodexMentionClick) {
    const popup: LoreMentionPopupState = { id: Date.now(), term: mention.term, anchor: mention.rect }
    setLoreMention(popup)
    if (mention.term.entries.length === 1) void loadLoreMentionPreview(popup.id, mention.term.entries[0])
  }

  async function openLoreMentionEntry(entryId: string) {
    setLoreMention(null)
    await loadDocument(entryId)
  }

  async function speechSettings() {
    if (!currentBook) throw new Error('Open a book before reading aloud.')
    const defaults = loadAiSettings()
    return (await getBookAiSettings(currentBook.id, defaults.favorites)).speech
  }

  async function readText(text: string, label: string, entityId: string) {
    try {
      const speech = await speechSettings()
      await startTtsSession(speech, text, label, { bookId: currentBook!.id, entityId })
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not start text to speech.')
    }
  }

  async function readCurrentDocument() {
    if (!activeDocument) return
    if (activeDocument.type === 'scene') {
      if (!lastGeneratedPassage.trim()) { showToast('There is no identifiable latest generated passage to read in this Scene.'); return }
      await readText(lastGeneratedPassage, `Scene · ${activeDocument.title}`, activeDocument.id)
      return
    }
    if (activeDocument.type === 'codexEntry') await readText(storyMarkdown, `Codex · ${activeDocument.title}`, activeDocument.id)
  }

  async function readNote(note: NoteEntity) {
    const text = activeDocument?.id === note.id ? storyMarkdown : note.content
    await readText(text, `Note · ${note.title}`, note.id)
  }

  async function readOutline(entity: StructuralEntity) {
    if (!currentBook || !['scene', 'chapter'].includes(entity.type)) return
    try {
      const speech = await speechSettings()
      let text = ''
      if (entity.type === 'scene') text = activeDocument?.id === entity.id ? storyMarkdown : String(entity.content ?? '')
      else text = outlineEntities
        .filter((item) => item.type === 'scene' && item.parentId === entity.id)
        .sort((a, b) => a.order - b.order)
        .map((scene) => activeDocument?.id === scene.id ? storyMarkdown : String(scene.content ?? ''))
        .filter((content) => content.trim())
        .join('\n\n')
      if (!text.trim()) { showToast(`“${entity.title}” has no readable prose.`); return }
      const owner = { bookId: currentBook.id, entityId: entity.id, entityIds: entity.type === 'chapter' ? outlineEntities.filter(item => item.type === 'scene' && item.parentId === entity.id).map(item => item.id) : undefined }
      const plan = await prepareSpeechPlayback(speech, text, owner)
      if (plan.missingChunks) {
        const price = plan.modelInfo?.price ? `Provider rate for missing audio: ${plan.modelInfo.price}` : 'Price for missing audio: unknown'
        const confirmed = window.confirm(`Read ${entity.type === 'scene' ? 'Scene' : 'Chapter'} “${entity.title}” aloud?\n\n${plan.cachedChunks} cached parts · ${plan.missingChunks} new paid request${plan.missingChunks === 1 ? '' : 's'} (${plan.missingCharacters.toLocaleString()} characters to generate)\nModel: ${speech.model}\n${price}`)
        if (!confirmed) return
      }
      await startTtsSession(speech, text, `${entity.type === 'scene' ? 'Scene' : 'Chapter'} · ${entity.title}`, owner, plan)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not start text to speech.')
    }
  }

  function startGenerationActivity(details: Omit<GenerationDetails, 'startedAt' | 'status' | 'thoughts'>) {
    const startedAt = Date.now()
    generationStartedAtRef.current = startedAt
    setGenerationElapsedSeconds(0)
    setGenerationPhase('sending')
    setGenerationDetails({ ...details, startedAt, status: 'sending', thoughts: '' })
    setGenerationDetailsOpen(false)
    setGenerationActive(true)
  }

  function setGenerationActivityPhase(phase: GenerationPhase) {
    setGenerationPhase(phase)
    setGenerationDetails((current) => current ? { ...current, status: phase } : current)
  }

  function appendGenerationThoughts(text: string) {
    setGenerationDetails((current) => current ? { ...current, thoughts: current.thoughts + text } : current)
  }

  function updateGenerationMetadata(metadata: NanoGPTStreamMetadata) {
    setGenerationDetails((current) => current ? {
      ...current,
      ...Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined)),
    } : current)
  }

  function finishGenerationActivity(status: 'complete' | 'cancelled' | 'error') {
    const finishedAt = Date.now()
    setGenerationActive(false)
    setGenerationPhase(null)
    setGenerationElapsedSeconds(Math.max(0, Math.floor((finishedAt - generationStartedAtRef.current) / 1000)))
    setGenerationDetails((current) => current ? { ...current, status, finishedAt } : current)
  }

  function actOnBeat(item: LocatedBlock, action: 'generate' | 'rebind') {
    const editor = editorRef.current
    const selected = editor?.captureSelection()
    if (!editor || !selected || activeDocument?.type !== 'scene' || generationActive) return
    try {
      if (!item.block.text?.trim()) throw new Error('Write a scene beat before generating prose.')
      if (action === 'rebind') {
        const next = bindBeatPassage(selected.document, item.block.id, selected.from, selected.to)
        if (!editor.replaceRange({ ...selected, from: 0, to: selected.document.length, text: selected.document }, next, true)) throw new Error('The scene changed. Select the intended passage again.')
        showToast('The selected prose is now linked to this beat.'); return
      }
      let passage = beatPassage(selected.document, item.block.id)
      if (!passage && !passageMarkers(selected.document).some((marker) => marker.beatId === item.block.id)) {
        const insertion = `\n${passageMarker(item.block.id, 'start')}\n\n${passageMarker(item.block.id, 'end')}\n`
        const at = editor.captureSelection(item.to, item.to)!
        if (!editor.replaceRange(at, insertion, true)) throw new Error('The scene changed. Reopen the beat.')
        passage = beatPassage(editor.captureSelection()!.document, item.block.id)
      }
      if (!passage) throw new Error('This beat’s passage cannot be identified safely. Select its prose and use Bind selected prose.')
      const snapshot = editor.captureSelection(passage.from, passage.to)!
      setBeatRewrite({ documentId: activeDocument.id, snapshot, instruction: item.block.text || '' })
    } catch (e) { showToast(e instanceof Error ? e.message : 'Could not open this beat.') }
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
    if (isCodex && isCodexEntryArchived(activeDocument)) {
      showToast('Restore this archived Codex entry before generating or revising it.')
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
    if (activeDocumentIdRef.current !== activeDocument.id || currentBookIdRef.current !== currentBook.id) return
    if (settings.provider !== 'nanogpt' && settings.provider !== 'fake') {
      showToast('Text generation currently supports NanoGPT or Fake (testing) only. Choose one in Book settings.')
      return
    }
    if (settings.provider === 'nanogpt' && !settings.apiKey.trim()) {
      showToast('Add your NanoGPT API key in Book settings before generating.')
      return
    }
    const selectedModel = isCodex ? settings.codexModel.trim() || settings.mainModel.trim() : settings.mainModel.trim()
    if (!selectedModel) {
      showToast('Choose a Main model in Book settings before generating.')
      return
    }
    try {
      const compositionScope = isCodex ? 'lore' : 'story'
      const composition = settings.promptCompositions[compositionScope]
      assertPromptTemplateValid(composition.systemPrompt, compositionScope)
      composition.predefinedMessages.filter((message) => message.enabled).forEach((message) => assertPromptTemplateValid(message.template, compositionScope))
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Fix the invalid prompt in Book AI settings before generating.')
      return
    }

    const previousRequest = latestGenerationRequestRef.current
    if (mode === 'regenerate' && !previousRequest) {
      showToast('Generate a passage before using Regenerate.')
      return
    }

    const editor = editorRef.current
    if (!isCodex && mode === 'generate' && loadUiSettings().saveArcAsBeat !== false && arcPrompt.trim() && editor) {
      const snapshot = editor.captureSelection()
      if (!snapshot) return
      try {
        const prepared = prepareAutomaticBeat(snapshot.document, snapshot.from, arcPrompt, `beat-${crypto.randomUUID()}`)
        if (prepared) {
          if (prepared.source !== snapshot.document && !editor.replaceRange({ ...snapshot, from: 0, to: snapshot.document.length, text: snapshot.document }, prepared.source, true)) throw new Error('The scene changed before the beat could be saved.')
          editor.placeCursor(prepared.position)
        }
      } catch (e) { showToast(e instanceof Error ? e.message : 'Could not save this beat.'); return }
    }
    const context = editor?.beginGeneration(mode, 'append')
    if (!editor || !context) {
      showToast(mode === 'regenerate'
        ? 'Regenerate is available only while the latest generated passage is unchanged.'
        : 'The editor is not ready for generation yet.')
      return
    }

    let requestSnapshot: GenerationRequestSnapshot
    if (mode === 'regenerate' && previousRequest) {
      try {
        requestSnapshot = {
          ...previousRequest,
          messages: replaceGenerationInstruction(
            previousRequest.messages,
            isCodex ? lorePrompt : arcPrompt,
            isCodex ? CODEX_CONTINUE_FALLBACK : STORY_CONTINUE_FALLBACK,
          ),
        }
        // Only the current instruction changes; retain the saved model and context cap.
        const diagnostics = generationContextDiagnostics(
          requestSnapshot.model,
          requestSnapshot.modelContextTokens,
          requestSnapshot.effectiveContextLimit,
          textProviderRequestText(requestSnapshot),
        )
        if (!diagnostics.fits) {
          throw new Error(`The revised instruction makes this request too large: ~${diagnostics.requestTokens.toLocaleString()} input tokens for a ${diagnostics.usableInputTokens.toLocaleString()}-token usable budget. Shorten the instruction or start a new generation with different context settings.`)
        }
        requestSnapshot.estimatedRequestTokens = diagnostics.requestTokens
      } catch (error) {
        editor.finishGeneration('error')
        showToast(error instanceof Error ? error.message : 'The regeneration instruction could not be prepared.')
        return
      }
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
          ?? await fetchTextProviderModelContextLength({ provider: settings.provider, apiKey: settings.apiKey.trim(), baseUrl: settings.baseUrl, model: selectedModel }).catch(() => undefined)
        if (modelContextLength) {
          settings = await saveBookAiSettings(currentBook.id, isCodex && settings.codexModel.trim()
            ? { ...settings, codexModelContextLength: modelContextLength }
            : { ...settings, mainModelContextLength: modelContextLength })
        }
        const instruction = isCodex ? lorePrompt : arcPrompt
        const responseLength = isCodex ? settings.responseLengths.codex : settings.responseLengths.story
        const promptBook = { ...toBookPromptValues(currentBook, seriesList), responseLength }
        const normalizedRequest = isCodex
          ? assembleCodexGenerationRequest({
              composition: settings.promptCompositions.lore,
              book: promptBook,
              responseLength,
              entry: { id: activeDocument.id, title: activeDocument.title, category: activeDocument.category, typeId: activeDocument.typeId, content: context.sceneText },
              insertionPosition: context.insertionPosition,
              context: prepared,
              instruction,
            })
          : assembleStoryGenerationRequest({
              composition: settings.promptCompositions.story,
              book: promptBook,
              responseLength,
              sceneText: context.sceneText,
              insertionPosition: context.insertionPosition,
              sceneOverrides: sceneWritingValues(activeDocument),
              context: prepared,
              instruction,
            })
        const systemPrompt = ''
        const contextMessage = ''
        const userMessage = ''
        const effectiveLimit = isCodex && settings.codexModel.trim() ? settings.codexEffectiveContextLimit : settings.mainEffectiveContextLimit
        const messages = normalizedRequest.providerMessages
        const normalizedRequestText = textProviderRequestText({ systemPrompt, contextMessage, userMessage, messages })
        const diagnostics = generationContextDiagnostics(selectedModel, modelContextLength, effectiveLimit, normalizedRequestText)
        if (!diagnostics.limitValid) {
          editor.finishGeneration('error')
          showToast(diagnostics.limitError ?? 'The effective context cap is invalid. Check Book AI settings.')
          return
        }
        if (!diagnostics.fits) {
          editor.finishGeneration('error')
          const dependencyTitles = prepared.automaticCodex.filter((item) => item.source === 'dependency').map((item) => item.title)
          showToast(`Context is too large: ~${diagnostics.requestTokens.toLocaleString()} input tokens for a ${diagnostics.usableInputTokens.toLocaleString()}-token usable budget (${diagnostics.effectiveContextTokens.toLocaleString()} effective limit, ${diagnostics.responseReserveTokens.toLocaleString()} reserved for the response). Deselect context, summarize older material, raise the cap, or choose a larger model.${dependencyTitles.length ? ` Dependency cascade includes: ${dependencyTitles.join(', ')}.` : ''}`)
          return
        }
        if (diagnostics.warning) {
          const dependencyTitles = prepared.automaticCodex.filter((item) => item.source === 'dependency').map((item) => item.title)
          showToast(`Context is near the configured limit (${Math.round(diagnostics.usageRatio * 100)}%). Consider summarizing older material, deselecting full-text context, or raising the cap before adding more context.${dependencyTitles.length ? ` Dependency cascade includes: ${dependencyTitles.join(', ')}.` : ''}`)
        }
        requestSnapshot = {
          provider: settings.provider,
          baseUrl: settings.baseUrl,
          model: selectedModel,
          systemPrompt,
          contextMessage,
          userMessage,
          ...(messages ? { messages } : {}),
          estimatedRequestTokens: diagnostics.requestTokens,
          modelContextTokens: diagnostics.modelContextTokens,
          effectiveContextLimit: effectiveLimit,
        }
      } catch (error) {
        editor.finishGeneration('error')
        showToast(error instanceof Error ? error.message : 'Context could not be prepared.')
        return
      }
    }

    if (activeDocumentIdRef.current !== activeDocument.id || currentBookIdRef.current !== currentBook.id) { editor.finishGeneration('cancelled'); return }
    const controller = new AbortController()
    generationAbortRef.current = controller
    startGenerationActivity({
      task: isCodex ? 'Codex' : 'Story',
      action: mode === 'regenerate' ? 'Regenerate' : 'Generate',
      targetTitle: activeDocument.title,
      requestedModel: requestSnapshot.model,
      provider: requestSnapshot.provider === 'fake' ? 'Fake (testing)' : 'NanoGPT',
      estimatedRequestTokens: requestSnapshot.estimatedRequestTokens,
      modelContextTokens: requestSnapshot.modelContextTokens,
    })
    const runDocumentId = activeDocument.id
    const ownsRun = () => generationAbortRef.current === controller && activeDocumentIdRef.current === runDocumentId
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
      await streamTextProviderCompletion({
        provider: requestSnapshot.provider,
        task: isCodex ? 'codex' : 'story',
        apiKey: settings.apiKey.trim(),
        baseUrl: requestSnapshot.baseUrl,
        model: requestSnapshot.model,
        systemPrompt: requestSnapshot.systemPrompt,
        contextMessage: requestSnapshot.contextMessage,
        userMessage: requestSnapshot.userMessage,
        messages: requestSnapshot.messages,
      }, (chunk) => {
        if (!controller.signal.aborted) setGenerationActivityPhase('writing')
        renderer.push(chunk)
      }, controller.signal, {
        onResponse: () => {
          if (!controller.signal.aborted) setGenerationActivityPhase('thinking')
        },
        onThoughts: (text) => { if (ownsRun()) appendGenerationThoughts(text) },
        onMetadata: (metadata) => { if (ownsRun()) updateGenerationMetadata(metadata) },
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
      finishGenerationActivity(status)
      if (result?.status === 'complete') {
        latestGenerationRequestRef.current = requestSnapshot
        if (!isCodex) setLastGeneratedPassage(result.generatedText)
        if (isCodex) changedSinceSnapshotRef.current = true
        await flushDocument('generation', true)
        if (settings.speech.readAloudAfterGeneration) {
          const textToRead = isCodex ? result.resultDocument : result.generatedText
          void startTtsSession(settings.speech, textToRead, `${isCodex ? 'Codex' : 'Story'} · ${activeDocument.title}`, { bookId: currentBook.id, entityId: activeDocument.id }).catch((error) => showToast(error instanceof Error ? error.message : 'Automatic read aloud failed.'))
        }
      }
    }
  }

  async function runSummaryGeneration() {
    if (generationAbortRef.current || summaryGenerationOwnerRef.current || !currentBook || activeDocument?.type !== 'summary') return

    const book = currentBook
    const startingSummary = activeDocument
    const controller = new AbortController()
    const owner: ActiveSummaryGenerationOwner = {
      requestId: ++summaryGenerationSequenceRef.current,
      bookId: book.id,
      summaryId: startingSummary.id,
      controller,
    }

    // Reserve generation/navigation ownership synchronously, before any save/settings/source await.
    summaryGenerationOwnerRef.current = owner
    generationAbortRef.current = controller
    generationStartedAtRef.current = Date.now()
    setGenerationElapsedSeconds(0)
    setGenerationPhase('sending')
    setGenerationDetails(null)
    setGenerationDetailsOpen(false)
    setGenerationActive(true)

    let status: 'complete' | 'cancelled' | 'error' = 'complete'
    const cancelledDuringPreflight = () => {
      if (!controller.signal.aborted) return false
      status = 'cancelled'
      return true
    }

    try {
      if (changedSinceSnapshotRef.current) {
        await flushDocument('manual', true)
        if (cancelledDuringPreflight()) return
      }

      const summary = await getEntity<SummaryEntity>(owner.summaryId)
      if (cancelledDuringPreflight()) return
      if (!summary || summary.type !== 'summary') {
        status = 'error'
        showToast('This summary is no longer available.')
        return
      }

      const { settings, source, action, messages, diagnostics } = await prepareSummaryGeneration(book, summary, controller.signal, toBookPromptValues(book, seriesList))
      if (cancelledDuringPreflight()) return
      if (diagnostics.warning) showToast(`Summary context is near the model limit (${Math.round(diagnostics.usageRatio * 100)}%).`)

      setGenerationDetails({
        task: 'Summary',
        action: action === 'resummarize' ? 'Re-summarize' : 'Summarize',
        targetTitle: source.source.title,
        requestedModel: settings.supportModel,
        provider: settings.provider === 'fake' ? 'Fake (testing)' : 'NanoGPT',
        estimatedRequestTokens: diagnostics.requestTokens,
        modelContextTokens: diagnostics.modelContextTokens,
        startedAt: generationStartedAtRef.current,
        status: 'sending',
        thoughts: '',
      })

      let generated = ''
      await streamTextProviderCompletion({
        provider: settings.provider,
        task: 'summary',
        apiKey: settings.apiKey.trim(),
        baseUrl: settings.baseUrl,
        model: settings.supportModel,
        systemPrompt: '',
        userMessage: '',
        messages,
      }, (chunk) => {
        if (!controller.signal.aborted) setGenerationActivityPhase('writing')
        generated += chunk
      }, controller.signal, {
        onResponse: () => {
          if (!controller.signal.aborted) setGenerationActivityPhase('thinking')
        },
        onThoughts: appendGenerationThoughts,
        onMetadata: updateGenerationMetadata,
      })
      if (controller.signal.aborted) {
        status = 'cancelled'
        return
      }

      await createSnapshot(summary.id, 'generation', summary.content)
      if (controller.signal.aborted) {
        status = 'cancelled'
        return
      }
      const saved = await saveSummaryContent(summary.id, generated, source.sourceRevision, summary)
      const nextSummaryStates = await getSummaryStateMap(owner.bookId)

      // Persistence is safely scoped to the captured Summary. Active UI is mutated only
      // if the exact request still owns the same Book/Summary/editor screen.
      if (summaryGenerationOwnsUi(owner, summaryGenerationOwnerRef.current, {
        bookId: currentBookIdRef.current,
        documentId: activeDocumentIdRef.current,
        screen: screenRef.current,
      })) {
        activeDocumentIdRef.current = saved.id
        setActiveDocument(saved)
        storyRef.current = saved.content
        setStoryMarkdown(saved.content)
        changedSinceSnapshotRef.current = false
        setEditorRevision((revision) => revision + 1)
        setSummaryStates(nextSummaryStates)
        setSaveState('saved')
      }
    } catch (error) {
      status = controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError') ? 'cancelled' : 'error'
      if (status === 'error') showToast(error instanceof Error ? error.message : 'Summary generation stopped unexpectedly.')
    } finally {
      if (summaryGenerationOwnerRef.current?.requestId === owner.requestId) summaryGenerationOwnerRef.current = null
      if (generationAbortRef.current === controller) generationAbortRef.current = null
      finishGenerationActivity(status)
    }
  }

  function generate() {
    if (activeDocument?.type === 'summary') void runSummaryGeneration()
    else void runGeneration('generate')
  }

  function regenerate() {
    if (activeDocument?.type === 'scene' && showBeats) {
      const selected = editorRef.current?.captureSelection()
      const beat = selected && sceneBeats(selected.document).find((item) => { const passage = beatPassage(selected.document, item.block.id); return passage && selected.from >= passage.from && selected.from <= passage.to })
      if (beat) { actOnBeat(beat, 'generate'); return }
    }
    if (activeDocument?.type === 'summary') void runSummaryGeneration()
    else void runGeneration('regenerate')
  }

  function stopGeneration() {
    if (!generationAbortRef.current) return
    setGenerationActivityPhase('stopping')
    generationAbortRef.current.abort()
  }

  async function currentSpeechSettings() {
    const defaults = loadAiSettings()
    return currentBook ? (await getBookAiSettings(currentBook.id, defaults.favorites)).speech : defaults.speech
  }

  async function dictateEditor() {
    const documentId = activeDocumentIdRef.current
    const editor = editorRef.current
    if (!currentBook || !documentId || !editor || activeDocument?.type === 'summary' || activeCodexArchived) return
    const sessionId = editor.beginDictation()
    if (!sessionId) { showToast('The editor is busy and cannot start dictation right now.'); return }
    try {
      const speech = await currentSpeechSettings()
      await startSttSession(speech, {
        kind: 'editor',
        label: 'Dictate to editor',
        isValid: () => activeDocumentIdRef.current === documentId && Boolean(editorRef.current),
        onProvisional: (transcript) => { if (!editorRef.current?.updateDictation(sessionId, transcript)) throw new Error('The original editor dictation target is no longer available.') },
        onFinal: (transcript) => { if (!editorRef.current?.finishDictation(sessionId, transcript)) throw new Error('The original editor dictation target is no longer available.') },
        onCancel: () => { editorRef.current?.cancelDictation(sessionId) },
      })
    } catch (error) {
      editor.cancelDictation(sessionId)
      showToast(error instanceof Error ? error.message : 'Could not start dictation.')
    }
  }

  async function dictateInstruction(target?: ExpandableTextInputDictationTarget) {
    const input = target?.element ?? promptRef.current
    const documentId = activeDocumentIdRef.current
    if (!documentId || !activeDocument || activeDocument.type === 'summary' || generationActive) return false
    if (!target) promptRef.current?.focus()
    const isLore = activeDocument.type === 'codexEntry'
    const base = target?.value ?? (isLore ? lorePrompt : arcPrompt)
    const setPrompt = isLore ? setLorePrompt : setArcPrompt
    const start = target?.selectionStart ?? input?.selectionStart ?? base.length
    const end = target?.selectionEnd ?? input?.selectionEnd ?? start
    const targetIsValid = () => activeDocumentIdRef.current === documentId && (target ? target.isValid() : Boolean(promptRef.current))
    const setTargetValue = (nextValue: string) => {
      if (!targetIsValid()) return false
      if (target) return target.setValue(nextValue)
      setPrompt(nextValue)
      return true
    }
    const render = (transcript: string) => {
      const insertion = normalizeTranscriptForInsertion(transcript, base.slice(0, start), base.slice(end))
      return { value: `${base.slice(0, start)}${insertion}${base.slice(end)}`, cursor: start + insertion.length }
    }
    try {
      const speech = await currentSpeechSettings()
      if (!targetIsValid()) return false
      await startSttSession(speech, {
        kind: 'instruction',
        presentation: target ? 'expanded' : undefined,
        label: 'Dictate instruction',
        isValid: targetIsValid,
        onProvisional: (transcript) => {
          if (!setTargetValue(render(transcript).value)) throw new Error('The original instruction input is no longer available.')
        },
        onFinal: (transcript) => {
          const next = render(transcript)
          if (!setTargetValue(next.value)) throw new Error('The original instruction input is no longer available.')
          if (target) target.focus(next.cursor)
          else requestAnimationFrame(() => { promptRef.current?.focus(); promptRef.current?.setSelectionRange(next.cursor, next.cursor) })
        },
        onCancel: () => { setTargetValue(base) },
      })
      return true
    } catch (error) {
      setTargetValue(base)
      const message = error instanceof Error ? error.message : 'Could not start instruction dictation.'
      if (target) target.reportError(message)
      else showToast(message)
      return false
    }
  }

  const activeScene = activeDocument?.type === 'scene'
    ? activeDocument
    : outlineEntities.find((entity) => entity.id === activeSceneId && entity.type === 'scene')
  const activeChapter = activeScene ? outlineEntities.find((entity) => entity.id === activeScene.parentId && entity.type === 'chapter') : undefined
  const activeAct = activeChapter ? outlineEntities.find((entity) => entity.id === activeChapter.parentId && entity.type === 'act') : undefined
  const summarySource = activeDocument?.type === 'summary'
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
  const activeSummarySourceArchived = Boolean(summaryCodexSource && isCodexEntryArchived(summaryCodexSource))
  const pageLabel = activeDocument?.type === 'note'
    ? 'N'
    : activeDocument?.type === 'codexEntry'
      ? 'C'
      : activeDocument?.type === 'summary'
        ? 'Σ'
        : String((activeChapter?.order ?? 0) + 1).padStart(2, '0')
  const openSummaryState = summarySource ? summaryStates[summarySource.id] ?? 'missing' : 'missing'
  const summaryContextIndicator = summaryCodexSource
    ? isCodexEntryArchived(summaryCodexSource)
      ? 'AI context · Archived'
      : summaryCodexSource.preferSummaryForContext
        ? openSummaryState === 'current' ? 'AI context · Summary preferred' : `AI context · Full entry · summary ${openSummaryState === 'missing' ? 'missing' : 'outdated'}`
        : 'AI context · Full entry'
    : ''
  const contextType: GenerationContextType = screen === 'chat' || (screen === 'images' && imageReturnScreen === 'chat') || (screen === 'settings' && (returnScreen === 'chat' || (returnScreen === 'images' && imageReturnScreen === 'chat'))) ? 'chat' : activeDocument?.type === 'codexEntry' ? 'codex' : activeDocument?.type === 'note' ? 'note' : 'scene'
  const autotitleOverlay = autotitle && <AutotitlePanel state={autotitle} onAccept={() => { void acceptAutotitle() }} onRegenerate={() => { void regenerateAutotitle() }} onStop={stopAutotitle} onCancel={() => { autotitleAbortRef.current?.abort(); setAutotitle(null) }} />

  if (screen === 'settings') return <AiSettingsScreen initialTab={settingsInitialTab}
    book={returnScreen === 'home' || (returnScreen === 'images' && imageReturnScreen === 'home') || !currentBook ? undefined : { id: currentBook.id, title: currentBook.title, contextType, currentDocumentId: activeDocument?.id, currentDocumentText: settingsGenerationContextRef.current?.sceneText ?? storyMarkdown, insertionPosition: settingsGenerationContextRef.current?.insertionPosition, promptValues: toBookPromptValues(currentBook, seriesList), chatId: contextType === 'chat' ? activeChatId || undefined : undefined, ...(activeDocument?.type === 'summary' ? { currentSummary: { id: activeDocument.id, sourceEntityId: activeDocument.sourceEntityId, sourceType: activeDocument.sourceType, content: activeDocument.content } } : {}) }}
    onHome={() => setScreen('home')}
    onBack={() => setScreen(returnScreen)}
    onSaved={(settings) => {
      if (returnScreen === 'home' || (returnScreen === 'images' && imageReturnScreen === 'home')) setAiReady(textAiIsConfigured(settings))
    }}
  />

  if (screen === 'images') {
    const imageBook = imageReturnScreen === 'home' ? undefined : currentBook ?? undefined
    return <ImageWorkspace
      bookId={imageBook?.id}
      bookTitle={imageBook?.title}
      storageError={imageDraftError}
      state={imageWorkspaceState}
      onStateChange={setImageWorkspaceState}
      onBack={() => setScreen(imageReturnScreen)}
      onSettings={() => openSettings('images', 'images')}
    />
  }

  if (screen === 'home') return (
    <main className="library-screen">
      {autotitleOverlay}
      {toast && <div className="app-toast" role="alert" key={toast.id}><span>{toast.message}</span><button type="button" onClick={() => setToast(null)} aria-label="Dismiss notification"><X aria-hidden="true" /></button></div>}
      <header className="library-top"><div className="arc-brand"><Feather aria-hidden="true" /> ARC</div><button className="image-destination-button" type="button" onClick={() => { void openImages('home') }} aria-label="Open images and gallery"><ImageIcon aria-hidden="true" /><ImageActivityBadge active={activeImageJobs} review={reviewImageJobs} attention={attentionImageJobs} /></button><button type="button" onClick={() => openSettings('home')} aria-label="Open default settings"><Settings2 aria-hidden="true" /></button></header>
      <section className="library-content">
        <div className="library-title"><div><small>Your library</small><h1>Books</h1></div><button type="button" aria-label="New book" disabled={libraryState !== 'ready' || creatingBook} onClick={() => { void makeBook() }}><Plus aria-hidden="true" /><span>{creatingBook ? 'Creating…' : 'New book'}</span></button></div>
        {!aiReady && <div className="setup-warning"><Bot aria-hidden="true" /><div><strong>Text AI is not set up</strong><p>Choose a provider and models before using generation or chat.</p></div><button type="button" onClick={() => openSettings('home')}>Set up AI <ChevronRight aria-hidden="true" /></button></div>}
        {libraryState === 'loading' && <div className="library-storage-status" role="status"><p>Loading your books…</p>{librarySlow && <><p>Storage is taking longer to open. Close other tabs or windows of this app so a pending update can finish. Keep this tab open and do not clear browser data.</p><button type="button" onClick={() => window.location.reload()}>Reload app</button></>}</div>}
        {libraryError && <div className="library-storage-status" role="alert"><strong>{libraryState === 'error' ? 'Your library could not be loaded' : 'Your books loaded, but series information could not be updated'}</strong><p>{libraryError}</p><p>Keep your browser data. This error does not mean your books were deleted.</p><button type="button" onClick={retryLibrary}>Retry loading books</button><button type="button" onClick={() => window.location.reload()}>Reload app</button></div>}
        {libraryState === 'ready' && !bookList.length && <p>Your library is empty. Create a new book or import a backup.</p>}
        <BookBackupImport onImported={importedBook} />
        <div className="library-grid">{bookList.map((book, index) => <article className="library-book-card" key={book.id}>
          <button type="button" className="library-book" onClick={() => { void openBook(book.id).catch((error) => showToast(error instanceof Error ? error.message : 'Could not open the book.')) }}><i className={`mock-cover ${['tide', 'orchard', 'fires'][index % 3]}`}>{book.title.slice(0,1)}</i><span><small>{formatSeries(book, seriesList)}</small><strong>{book.title}</strong><em>{formatEdited(book.updatedAt)}</em></span></button>
          <div className="library-book-actions"><button className="autotitle-trigger" type="button" onClick={() => { void startAutotitle(book) }} aria-label={`Autotitle ${book.title}`} title="Autotitle"><WandSparkles aria-hidden="true" /></button><button type="button" onClick={() => { void editBookTitle(book) }} aria-label={`Rename ${book.title}`}><Pencil aria-hidden="true" /></button><button type="button" onClick={() => { void removeBook(book) }} aria-label={`Delete ${book.title}`}><Trash2 aria-hidden="true" /></button></div>
        </article>)}</div>
      </section>
    </main>
  )

  return (
    <main className={`workspace-screen ${screen === 'chat' ? 'chat-active' : ''}`}>
      <header className="floating-controls">
        <div className="floating-control-group"><button type="button" onClick={() => openSettings(screen)} aria-label="Open current book settings"><ChevronsRight aria-hidden="true" /></button><button className="image-destination-button" type="button" onClick={() => { void openImages(screen) }} aria-label="Open images and gallery"><ImageIcon aria-hidden="true" /><ImageActivityBadge active={activeImageJobs} review={reviewImageJobs} attention={attentionImageJobs} /></button></div>
        <span className={`save-state ${saveState}`} title={saveState === 'error' ? 'Local save failed; your current editor text remains in memory.' : undefined}><i /> {saveState === 'loading' ? 'Loading' : saveState === 'saving' ? 'Saving' : saveState === 'error' ? 'Save failed' : 'Saved'}</span>
        <button type="button" onClick={() => setRightOpen(true)} aria-label="Open book workspace"><ChevronsLeft aria-hidden="true" /></button>
      </header>

      {toast && <div className="app-toast" role="alert" key={toast.id}><span>{toast.message}</span><button type="button" onClick={() => setToast(null)} aria-label="Dismiss notification"><X aria-hidden="true" /></button></div>}
      <TtsStatusBar />
      <SttStatusBar />

      {generationDetailsOpen && generationDetails && <GenerationDetailsDialog details={generationDetails} elapsedSeconds={generationElapsedSeconds} onClose={() => setGenerationDetailsOpen(false)} />}
      {loreMention && <LoreMentionPopover state={loreMention} onClose={() => setLoreMention(null)} onSelect={(entry) => { void loadLoreMentionPreview(loreMention.id, entry) }} onOpen={(entryId) => { void openLoreMentionEntry(entryId) }} />}
      {autotitleOverlay}
      {screen === 'editor' && currentBook && activeDocument && ['scene', 'note', 'codexEntry'].includes(activeDocument.type) && !activeCodexArchived && !generationActive && !quickTool && !beatRewrite && selectedProse?.documentId === activeDocument.id && <SelectionTools selection={selectedProse.selection} open={(tool) => setQuickTool({ tool, capture: { bookId: currentBook.id, book: toBookPromptValues(currentBook, seriesList), document: { ...activeDocument }, snapshot: selectedProse.selection.snapshot } })} />}
      {quickTool?.tool.kind === 'synonyms' && activeDocument?.id === quickTool.capture.document.id && currentBook?.id === quickTool.capture.bookId && <SynonymsDialog key={`${quickTool.capture.document.id}-${quickTool.capture.snapshot.revision}`} capture={quickTool.capture} apply={(text) => Boolean(editorRef.current?.replaceRange(quickTool.capture.snapshot, text))} close={() => setQuickTool(null)} />}
      {quickTool?.tool.kind === 'rewrite' && activeDocument?.id === quickTool.capture.document.id && currentBook?.id === quickTool.capture.bookId && <QuickRewriteDialog key={`${quickTool.tool.id}-${quickTool.capture.snapshot.revision}`} tool={quickTool.tool} capture={quickTool.capture} apply={(text) => Boolean(editorRef.current?.replaceRange(quickTool.capture.snapshot, text))} close={() => setQuickTool(null)} />}
      {beatRewrite && currentBook && activeDocument?.type === 'scene' && beatRewrite.documentId === activeDocument.id && <ProseRewriteDialog key={`${activeDocument.id}-${beatRewrite.snapshot.revision}`} title="Regenerate scene beat" original={beatRewrite.snapshot.text} instruction={beatRewrite.instruction} instructionReadOnly autoStart generate={(instruction, chunk, signal, onRequest) => generateSceneBeat({ bookId: currentBook.id, book: toBookPromptValues(currentBook, seriesList), scene: activeDocument, source: beatRewrite.snapshot.document, from: beatRewrite.snapshot.from, to: beatRewrite.snapshot.to, instruction }, chunk, signal, onRequest)} apply={(text) => Boolean(editorRef.current?.replaceRange(beatRewrite.snapshot, `\n\n${text.trim()}\n\n`))} close={() => setBeatRewrite(null)} />}

      {screen === 'editor' ? <article className="story-editor">
        <small className="page-number">{pageLabel}</small><p className="document-path">{documentPath || 'No document selected'}</p>
        {activeDocument?.type === 'scene' && currentBook && <><h1 className="scene-title">{activeDocument.title}</h1><SceneWritingSettings key={activeDocument.id} scene={activeDocument} book={toBookPromptValues(currentBook, seriesList)} disabled={generationActive} onSave={async (patch, before) => {
          const id = activeDocument.id
          await applyChatManagementChange(currentBook.id, id, { kind: 'scene_metadata', patch, before })
          if (activeDocumentIdRef.current === id) setActiveDocument((current) => current?.id === id ? { ...current, ...patch } : current)
        }} /></>}
        {(activeDocument?.type === 'note' || activeDocument?.type === 'codexEntry') && <div className={`document-titlebar ${activeCodexArchived ? 'archived' : ''}`}>{activeDocument.type === 'codexEntry' ? <CodexIllustration key={activeDocument.id} entry={activeDocument} readOnly={activeCodexArchived || activeDocument.codexScope === 'inherited'}><small>{activeCodexArchived ? `Archived · ${activeDocument.category}` : activeDocument.category}</small><h1>{activeDocument.title}</h1></CodexIllustration> : <div><small>Note</small><h1>{activeDocument.title}</h1></div>}<div className="document-title-actions">{(activeDocument.type === 'note' || !activeCodexArchived) && <button className="autotitle-trigger" type="button" onClick={() => { void startAutotitle(activeDocument) }} aria-label={`Autotitle ${activeDocument.title}`} title="Autotitle"><WandSparkles aria-hidden="true" /></button>}{activeDocument.type === 'codexEntry' && <SummaryIcon state={summaryStates[activeDocument.id] ?? 'missing'} kind="codex" onOpen={() => { void openSummary(activeDocument) }} />}{activeDocument.type === 'codexEntry' && activeCodexArchived ? <button type="button" onClick={() => { void restoreCodex(activeDocument) }}><ArchiveRestore aria-hidden="true" /> Restore</button> : <button type="button" onClick={() => { void renameContentEntity(activeDocument) }}><Pencil aria-hidden="true" /> Rename</button>}</div></div>}
        {activeDocument?.type === 'codexEntry' && <RoleplayParticipant entry={activeDocument} disabled={generationActive} onBeforeChange={beforeSeriesCodexChange} onRefresh={refreshSeriesCodexWorkspace} onStart={() => { void beforeSeriesCodexChange().then(() => setCharacterSetupEntry(activeDocument.id)).catch(error => showToast(error.message)) }} />}
        {activeDocument?.type === 'codexEntry' && currentBook && <CodexTimeline key={activeDocument.id} bookId={currentBook.id} entry={activeDocument} currentSceneId={activeSceneId || undefined} disabled={generationActive} onBeforeChange={beforeSeriesCodexChange} onRefresh={refreshSeriesCodexWorkspace} onViewChange={nonBaseline => setTimelineView({ entryId: activeDocument.id, nonBaseline })} />}
        {activeDocument?.type === 'codexEntry' && <CodexScopeControls key={activeDocument.id} entry={activeDocument} seriesId={currentBook?.seriesId} disabled={generationActive} onBeforeChange={beforeSeriesCodexChange} onRefresh={refreshSeriesCodexWorkspace} />}
        {activeDocument?.type === 'note' && <NoteRoleControls key={activeDocument.id} note={activeDocument} onChange={updated => { setActiveDocument(current => current?.id === updated.id ? { ...current, useAsChatSkill: updated.useAsChatSkill, useAsCodexTemplate: updated.useAsCodexTemplate, compatibleLoreTypeIds: updated.compatibleLoreTypeIds } : current); void reloadBookContent(updated.bookId) }} />}
        {activeDocument?.type === 'codexEntry' && <div className={`document-metadata ${activeCodexArchived ? 'archived' : ''}`}><label><span>Category</span><LoreTypeSelect ownerId={activeDocument.bookId} disabled={activeCodexArchived || activeDocument.codexScope === 'inherited'} value={activeDocument.typeId ?? activeDocument.category} onChange={id => { void changeCodexCategory(id) }} /></label>{!activeCodexArchived && <label className="codex-summary-preference"><input type="checkbox" disabled={activeDocument.codexScope === 'inherited'} checked={activeDocument.preferSummaryForContext === true} onChange={(event) => { void changeCodexSummaryPreference(event.target.checked) }} /><span><strong>Prefer summary for AI context</strong><small>{codexSummaryPolicyText(activeDocument, summaryStates[activeDocument.id] ?? 'missing')}</small></span></label>}{!activeCodexArchived && <label className="codex-trigger-editor"><span><strong>Auto include when text contains</strong></span><textarea disabled={activeDocument.codexScope === 'inherited'} value={codexTriggerDraft} onChange={(event) => setCodexTriggerDraft(event.target.value)} onBlur={() => { void saveCodexTriggers() }} placeholder="One literal trigger per line" /><small>One name, alias, phrase, or #tag per line. New entries start with their title; removing it keeps it removed, and renaming the entry does not rewrite triggers.</small></label>}{activeCodexArchived && <p className="archived-document-note"><Archive aria-hidden="true" /><span><strong>Archived lore</strong><small>Readable here, but excluded from AI context, Chat discovery, and normal Codex search until restored.</small></span></p>}</div>}
        {activeDocument?.type === 'codexEntry' && activeDocument.codexScope !== 'inherited' && !activeCodexArchived && <CodexTemplates key={activeDocument.id} bookId={activeDocument.bookId} targetId={activeDocument.id} typeId={activeDocument.typeId ?? activeDocument.category} body={storyMarkdown} editor={editorRef} disabled={generationActive} />}
        {activeDocument?.type === 'codexEntry' && <CodexDependenciesMetadata key={`dependencies-${activeDocument.id}`} source={activeDocument} entries={codexEntries} edges={codexDependencies} readOnly={activeCodexArchived || activeDocument.codexScope === 'inherited'} onAdd={(targetId) => addCodexDependency(activeDocument.id, targetId)} onUpdate={changeCodexDependency} onRemove={deleteCodexDependency} onOpen={(entryId) => { void loadDocument(entryId) }} />}
        {activeDocument?.type === 'summary' && summaryContextIndicator && <div className="summary-context-indicator">{summaryContextIndicator}</div>}
        {activeDocument && currentBook && ['scene', 'note', 'codexEntry'].includes(activeDocument.type) && !activeCodexArchived && activeDocument.codexScope !== 'inherited' && <EditorBlocks key={activeDocument.id} bookId={currentBook.id} editor={editorRef} disabled={generationActive} onEditRequestHandled={() => setBlockEditRequest(null)} insertImage={imageInsertRequest === activeDocument.id} onInsertHandled={() => setImageInsertRequest(null)} editRequest={blockEditRequest?.documentId === activeDocument.id && blockEditRequest.snapshot.document === storyMarkdown ? blockEditRequest : null} />}
        <div hidden={timelineView?.entryId === activeDocument?.id && timelineView?.nonBaseline}>{activeDocument ? <MarkdownEditor key={`${activeDocument.id}-${editorRevision}`} ref={editorRef} onSelectionChange={(selection) => setSelectedProse(selection ? { documentId: activeDocument.id, selection } : null)} bookId={currentBook?.id} showBeats={showBeats} onBeatAction={actOnBeat} onEditBlock={(item) => { const snapshot = editorRef.current?.captureSelection(item.from, item.to); if (snapshot) setBlockEditRequest({ documentId: activeDocument.id, item, snapshot }) }} value={storyMarkdown} onChange={handleStoryChange} onHistoryChange={setEditorHistory} ariaLabel={`${activeDocument.title} Markdown editor`} readOnly={activeCodexArchived || activeSummarySourceArchived || activeDocument.codexScope === 'inherited'} mentionTerms={activeDocument.type === 'scene' ? codexMentionIndex : []} onMentionClick={activeDocument.type === 'scene' ? openLoreMention : undefined} /> : <div className="empty-editor"><FileText aria-hidden="true" /><strong>No document selected</strong><p>Choose a Scene, Note, Codex entry, or Summary from the book workspace.</p><button type="button" onClick={() => setRightOpen(true)}>Open Book Workspace</button></div>}</div>
        {characterSetupEntry && currentBook && <CharacterChatSetup bookId={currentBook.id} initialEntryId={characterSetupEntry} currentSceneId={activeSceneId || undefined} onClose={() => setCharacterSetupEntry(null)} onOpen={openChat} />}
      </article> : currentBook ? <ChatView bookId={currentBook.id} chatId={activeChatId} bookPromptValues={toBookPromptValues(currentBook, seriesList)} currentSceneId={activeSceneId} onChatChange={openChat} onToast={showToast} /> : <section className="conversation chat-empty"><MessageCircle aria-hidden="true" /><p>Open a book before starting a chat.</p></section>}


      {screen === 'editor' && activeDocument?.type === 'note' && <div className="note-editor-actions"><GenerationActions label="Editor actions" menuOnly onGenerate={() => {}} actions={[{ id: 'image', label: 'Insert image', icon: <ImagePlus aria-hidden="true" />, onSelect: () => setImageInsertRequest(activeDocument.id) }]} /></div>}
      {screen === 'editor' && activeDocument?.type === 'summary' && !activeSummarySourceArchived && <div className="summary-generate-wrap"><button className="summary-generate" type="button" onClick={generationActive ? stopGeneration : generate}>{generationActive ? <Square aria-hidden="true" fill="currentColor" /> : <RefreshCw aria-hidden="true" />} {generationActive ? 'Stop' : openSummaryState === 'missing' ? 'Summarize' : 'Re-summarize'}</button></div>}
      {screen === 'editor' && !(timelineView?.entryId === activeDocument?.id && timelineView?.nonBaseline) && (activeDocument?.type === 'scene' || (activeDocument?.type === 'codexEntry' && !activeCodexArchived && activeDocument.codexScope !== 'inherited')) && <Composer key={activeDocument.id} className={`workspace-composer ${drawerCollapsed ? 'is-collapsed' : ''}`} strip={
        <div className="workspace-composer-header" hidden={drawerCollapsed}><details className="chat-config-strip">
          <summary><span role="status">{generationActive && generationPhase ? `${generationPhaseLabel(generationPhase)} · ${generationElapsedSeconds}s` : generationDetails ? `${generationDetails.status === 'complete' ? 'Complete' : generationDetails.status === 'cancelled' ? 'Stopped' : 'Failed'} · ${generationElapsedSeconds}s` : 'Ready to generate'}</span><small>Thoughts and status</small><ChevronDown aria-hidden="true" /></summary>
          <div className="composer-status-body">
            {generationDetails ? <><p>{generationDetails.provider} · {generationDetails.requestedModel} · {generationDetails.targetTitle}</p>{generationDetails.thoughts ? <pre>{generationDetails.thoughts}</pre> : <p>No thoughts provided by this model.</p>}<button type="button" onClick={() => setGenerationDetailsOpen(true)}>Request details</button></> : <p>Start a generation to see its status and any thoughts provided by the model.</p>}
          </div>
        </details><button type="button" className="composer-collapse" onClick={() => setDrawerCollapsed(true)} aria-label="Hide instruction drawer" title="Hide instruction drawer"><ChevronDown aria-hidden="true" /></button></div>
      }><div className="arc-prompt-field" hidden={drawerCollapsed}><ExpandableTextInput ref={promptRef} value={activeDocument.type === 'codexEntry' ? lorePrompt : arcPrompt} onChange={activeDocument.type === 'codexEntry' ? setLorePrompt : setArcPrompt} readOnly={sttState.target === 'instruction' && ['requesting-permission', 'recording', 'recording-live', 'stopping', 'transcribing', 'finalizing'].includes(sttState.status)} aria-label="generation prompt" dialogTitle="Edit generation prompt" onDictate={dictateInstruction} dictationStatus={sttState.target === 'instruction' ? sttState.status : 'idle'} dictationError={sttState.target === 'instruction' ? sttState.error : undefined} dictationDisabled={generationActive} onStopDictation={stopSttSession} onCancelDictation={cancelSttSession} /></div><GenerateControl inDrawer={!drawerCollapsed} drawerCollapsed={drawerCollapsed} onToggleDrawer={() => setDrawerCollapsed(value => !value)} onInsertImage={() => setImageInsertRequest(activeDocument.id)} isGenerating={generationActive} phase={generationPhase} elapsedSeconds={generationElapsedSeconds} sttState={sttState} ttsState={ttsState} canUndo={editorHistory.canUndo} canRedo={editorHistory.canRedo} onOpenDetails={() => setGenerationDetailsOpen(true)} onGenerate={generate} onStop={stopGeneration} onMicro={() => { void dictateEditor() }} onMicro2={() => { void dictateInstruction() }} onUndo={() => editorRef.current?.undo()} onRedo={() => editorRef.current?.redo()} onRegenerate={regenerate} onReadAloud={() => { void readCurrentDocument() }} readAloudDisabled={activeDocument?.type === 'scene' && !lastGeneratedPassage.trim()} readAloudTitle={activeDocument?.type === 'scene' ? 'Read latest generated passage' : 'Read full Codex entry'} /></Composer>}

      {rightOpen && <aside className="book-panel">
        <header><div><small>{formatSeries(currentBook, seriesList)}</small><strong>{currentBook?.title ?? 'Untitled Book'}</strong></div><div className="book-panel-header-actions">{activeSceneId && <button type="button" onClick={() => { void loadScene(activeSceneId) }} aria-label="Return to Scene" title="Return to Scene"><CornerUpLeft aria-hidden="true" /></button>}<button type="button" onClick={() => setRightOpen(false)} aria-label="Close book workspace"><X aria-hidden="true" /></button></div></header>
        <nav>{([['book', Settings2], ['outline', BookOpenText], ['notes', NotebookPen], ['codex', WandSparkles], ['chat', MessageCircle]] as const).map(([tab, Icon]) => <button type="button" className={rightTab === tab ? 'active' : ''} onClick={() => { setRightTab(tab); if (tab === 'chat') setChatPanel(screen === 'chat' ? 'settings' : 'list') }} key={tab}><Icon aria-hidden="true" /><span>{tab}</span></button>)}</nav>
        <div className="panel-content">{rightTab === 'book' ? <><AuthorGoalsTasks key={currentBook?.id} bookId={currentBook?.id ?? ''} liveScene={activeDocument?.type === 'scene' ? { id: activeDocument.id, content: storyMarkdown } : undefined} onOpen={id => { void getEntity<EditableEntity>(id).then(entity => { if (!entity) return; if (entity.type === 'chapter') void openSummary(entity as unknown as StructuralEntity); else void loadDocument(id) }) }} /><BookSettings onBeforeExport={prepareBookExport} onImported={importedBook} book={currentBook} books={bookList} series={seriesList} onSave={saveBookMetadata} onCreateSeries={addSeries} onRenameSeries={renameSeries} onDelete={removeCurrentBookFromSettings} /></> : rightTab === 'outline' ? <Outline book={currentBook} entities={outlineEntities} activeSceneId={activeSceneId} summaryStates={summaryStates} expandedIds={expandedIds} onToggle={(id) => setExpandedIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })} onOpenScene={(id) => { void loadScene(id) }} onOpenSummary={(entity) => { void openSummary(entity) }} onCreate={(type, parentId) => { void addOutlineEntity(type, parentId) }} onAutotitle={(entity) => { void startAutotitle(entity) }} onRead={(entity) => { void readOutline(entity) }} onRename={(entity) => { void editOutlineTitle(entity) }} onMove={(entity, direction) => { void moveOutlineEntity(entity, direction) }} onDelete={(entity) => { void removeOutlineEntity(entity) }} /> : rightTab === 'notes' ? <Notes notes={notes} activeId={activeDocument?.type === 'note' ? activeDocument.id : null} onCreate={() => { void addNote() }} onOpen={(id) => { void loadDocument(id) }} onAutotitle={(entity) => { void startAutotitle(entity) }} onRead={(entity) => { void readNote(entity) }} onRename={(entity) => { void renameContentEntity(entity) }} onDelete={(entity) => { void removeContentEntity(entity) }} /> : rightTab === 'codex' ? <><LoreTypesManager key={currentBook?.id} bookId={currentBook?.id ?? ''} /><SeriesCodexManager bookId={currentBook?.id ?? ''} onBeforeChange={beforeSeriesCodexChange} onRefresh={refreshSeriesCodexWorkspace} /><CodexDashboard key={currentBook?.id} dependencies={codexDependencies} onBeforeChange={beforeSeriesCodexChange} onRefresh={refreshSeriesCodexWorkspace} bookId={currentBook?.id ?? ''} entries={codexEntries} activeId={activeDocument?.type === 'codexEntry' ? activeDocument.id : null} summaryStates={summaryStates} onCreate={() => { void addCodexEntry() }} onOpen={(id) => { void loadDocument(id) }} onOpenSummary={(entity) => { void openSummary(entity) }} onAutotitle={(entity) => { void startAutotitle(entity) }} onRename={(entity) => { void renameContentEntity(entity) }} onArchive={(entity) => { void archiveCodex(entity) }} onRestore={(entity) => { void restoreCodex(entity) }} onDelete={(entity) => { void removeContentEntity(entity) }} /></> : <ChatSidebar currentSceneId={activeSceneId || undefined} bookId={currentBook?.id ?? ''} activeChatId={screen === 'chat' ? activeChatId : ''} onOpen={openChat} />}</div>
      </aside>}
    </main>
  )
}

function LoreMentionPopover({ state, onClose, onSelect, onOpen }: {
  state: LoreMentionPopupState
  onClose: () => void
  onSelect: (entry: CodexMentionEntry) => void
  onOpen: (entryId: string) => void
}) {
  const panelRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && panelRef.current?.contains(target)) return
      if (event.target instanceof Element && event.target.closest('.cm-codex-mention')) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer, true)
    }
  }, [onClose])

  const viewportWidth = typeof window === 'undefined' ? 420 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight
  const width = Math.min(380, viewportWidth - 24)
  const left = Math.max(12, Math.min(state.anchor.left, viewportWidth - width - 12))
  const preferBelow = state.anchor.bottom + 300 < viewportHeight
  const top = preferBelow ? state.anchor.bottom + 8 : Math.max(12, state.anchor.top - 292)
  const selected = state.term.entries.find((entry) => entry.id === state.selectedId)

  const titleId = `codex-mention-title-${state.id}`
  return createPortal(<section ref={panelRef} className="codex-mention-popover" role="dialog" aria-labelledby={titleId} style={{ left, top, width, maxHeight: Math.max(180, viewportHeight - top - 12) }}>
    <header><div><small>Codex mention</small><strong id={titleId}>{state.preview?.title ?? selected?.title ?? (state.term.entries.length === 1 ? state.term.entries[0].title : state.term.text)}</strong></div><button className="codex-mention-close" type="button" onClick={onClose} aria-label="Close lore preview" title="Close"><X aria-hidden="true" /></button></header>
    {state.term.entries.length > 1 && <div className="codex-mention-choices"><p>{selected ? 'Other matching entries' : 'Multiple Codex entries use this name. Choose one:'}</p>{state.term.entries.map((entry) => <button key={entry.id} className={entry.id === state.selectedId ? 'selected' : ''} type="button" onClick={() => onSelect(entry)}><span><strong>{entry.title}</strong><small>{entry.category}</small></span>{entry.id === state.selectedId && <Check aria-hidden="true" />}</button>)}</div>}
    {state.loading && <p className="codex-mention-loading">Loading lore…</p>}
    {state.error && <p className="codex-mention-error" role="alert">{state.error}</p>}
    {state.preview && <div className="codex-mention-preview"><div className="codex-mention-preview-heading"><CodexThumbnail entryId={state.preview.entryId} title={state.preview.title} /><span><small>Preview</small><em>{state.preview.category} · {state.preview.source === 'summary' ? 'Current summary' : 'Entry excerpt'}</em></span></div><div className="codex-mention-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{state.preview.content}</ReactMarkdown></div><button className="codex-mention-open" type="button" onClick={() => onOpen(state.preview!.entryId)}>Open Codex entry <ChevronRight aria-hidden="true" /></button></div>}
    {!state.loading && !state.preview && !state.error && state.term.entries.length === 1 && <button className="codex-mention-choice-single" type="button" onClick={() => onSelect(state.term.entries[0])}>Load lore preview</button>}
  </section>, document.body)
}

function SttStatusBar() {
  const [stt, setStt] = useState<SttState>(() => getSttState())
  useEffect(() => subscribeSttState(setStt), [])
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!stt.startedAt || !['recording', 'recording-live'].includes(stt.status)) { setElapsed(0); return }
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - stt.startedAt!) / 1000)))
    update()
    const timer = window.setInterval(update, 250)
    return () => window.clearInterval(timer)
  }, [stt.status, stt.startedAt])
  if (stt.status === 'idle' || stt.presentation === 'expanded') return null
  const label = stt.status === 'requesting-permission' ? 'Requesting microphone permission'
    : stt.status === 'recording' ? `Recording · ${formatGenerationTime(elapsed)}`
    : stt.status === 'recording-live' ? `Recording live · ${formatGenerationTime(elapsed)}`
    : stt.status === 'stopping' ? 'Stopping recording'
    : stt.status === 'transcribing' ? 'Transcribing…'
    : stt.status === 'finalizing' ? 'Finalizing…'
    : stt.status === 'completed' ? 'Dictation inserted'
    : stt.status === 'cancelled' ? 'Dictation cancelled'
    : 'Dictation failed'
  const active = ['requesting-permission', 'recording', 'recording-live', 'stopping', 'transcribing', 'finalizing'].includes(stt.status)
  return <section className={`tts-status stt-status ${stt.status}`} role={stt.status === 'failed' ? 'alert' : 'status'} aria-live="polite">
    <Mic aria-hidden="true" />
    <div className="tts-status-copy"><strong>{stt.label || 'Dictation'}</strong><small>{stt.error || `${label}${stt.provider ? ` · ${stt.provider === 'openai' ? 'OpenAI' : 'NanoGPT'} · ${stt.model}` : ''}`}</small></div>
    <div className="tts-status-actions">
      {(stt.status === 'recording' || stt.status === 'recording-live') && <button type="button" onClick={stopSttSession} aria-label="Stop dictation"><Square aria-hidden="true" fill="currentColor" /></button>}
      {active && <button type="button" onClick={cancelSttSession} aria-label="Cancel dictation"><X aria-hidden="true" /></button>}
      {!active && <button type="button" onClick={dismissSttState} aria-label="Dismiss dictation status"><X aria-hidden="true" /></button>}
    </div>
  </section>
}

function TtsStatusBar() {
  const [tts, setTts] = useState<TtsState>(() => getTtsState())
  useEffect(() => subscribeTtsState(setTts), [])
  if (tts.status === 'idle') return null
  const label = tts.status === 'preparing' ? 'Preparing text'
    : tts.status === 'generating' ? 'Generating audio'
      : tts.status === 'playing' ? 'Playing'
        : tts.status === 'paused' ? 'Paused'
          : tts.status === 'waiting' ? 'Waiting for next audio…'
            : tts.status === 'stopping' ? 'Stopping'
              : tts.status === 'stopped' ? 'Stopped'
                : tts.status === 'complete' ? 'Complete'
                : 'Failed'
  const playbackActive = tts.status === 'playing' || tts.status === 'paused'
  const showTimeline = playbackActive || Boolean(tts.canReplay && tts.duration)
  const currentTime = Math.max(0, tts.currentTime ?? 0)
  const duration = Math.max(0, tts.duration ?? 0)
  return <section className={`tts-status tts-player ${tts.status}`} role="region" aria-label="Text to speech player">
    <div className="tts-player-main">
      <Volume2 aria-hidden="true" />
      <div className="tts-status-copy">
        <strong>{tts.label || 'Read aloud'}</strong>
        <small aria-live="polite">{label}{tts.chunkCount ? ` · Part ${Math.max(1, tts.chunkIndex || 1)} of ${tts.chunkCount}` : ''}{tts.error ? ` · ${tts.error}` : ''}</small>{tts.cachedChunks !== undefined && <small>{tts.cachedChunks} cached parts · {tts.missingChunks ?? 0} new audio requests</small>}
      </div>
      <div className="tts-status-actions">
        {tts.status === 'playing' && <button className="tts-playback-toggle" type="button" onClick={pauseTtsSession} aria-label="Pause audio" title="Pause"><Pause aria-hidden="true" /></button>}
        {tts.status === 'paused' && <button className="tts-playback-toggle" type="button" onClick={() => { void resumeTtsSession() }} aria-label="Resume audio" title="Resume"><Play aria-hidden="true" fill="currentColor" /></button>}
        {tts.canReplay && !playbackActive && <button className="tts-playback-toggle" type="button" onClick={() => { void replayTtsSession() }} aria-label="Replay generated audio" title="Replay"><RotateCcw aria-hidden="true" /></button>}
        {!['complete','failed','stopped'].includes(tts.status) && <button className="tts-stop" type="button" onClick={stopTtsSession} aria-label="Stop audio" title="Stop"><Square aria-hidden="true" fill="currentColor" /></button>}
        {['complete','failed','stopped'].includes(tts.status) && <button type="button" onClick={dismissTtsState} aria-label="Dismiss audio status" title="Dismiss"><X aria-hidden="true" /></button>}
      </div>
    </div>
    {showTimeline && <div className="tts-playback-timeline">
      <button type="button" onClick={() => seekTtsBy(-10)} disabled={!playbackActive} aria-label="Go back 10 seconds" title="Back 10 seconds"><RotateCcw aria-hidden="true" /><span>10</span></button>
      <time>{formatPlaybackTime(currentTime)}</time>
      <input type="range" min="0" max={Math.max(duration, 0.1)} step="0.1" value={Math.min(currentTime, Math.max(duration, 0.1))} disabled={!playbackActive || !duration} onChange={(event) => seekTtsTo(Number(event.target.value))} aria-label={`Audio position in part ${Math.max(1, tts.chunkIndex || 1)}`} aria-valuetext={`${formatPlaybackTime(currentTime)} of ${duration ? formatPlaybackTime(duration) : 'unknown duration'}`} />
      <time>{duration ? formatPlaybackTime(duration) : '–:––'}</time>
      <button type="button" onClick={() => seekTtsBy(10)} disabled={!playbackActive} aria-label="Go forward 10 seconds" title="Forward 10 seconds"><RotateCw aria-hidden="true" /><span>10</span></button>
    </div>}
  </section>
}

function formatPlaybackTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const whole = Math.floor(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
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

function GenerationActivityStrip({ phase, elapsedSeconds, placement, onOpenDetails }: {
  phase: GenerationPhase
  elapsedSeconds: number
  placement: 'drawer' | 'floating'
  onOpenDetails: () => void
}) {
  const label = generationPhaseLabel(phase)
  return <button className={`generation-activity-strip ${placement} generation-phase-${phase}`} type="button" onClick={onOpenDetails} aria-label={`${label}, ${formatGenerationTime(elapsedSeconds)} elapsed. Open generation details.`} title="Open generation details">
    <i aria-hidden="true" />
    <span className="generation-phase" role="status" aria-live="polite">{label}</span>
    <span className="generation-separator" aria-hidden="true">·</span>
    <span className="generation-time" aria-hidden="true">{formatGenerationTime(elapsedSeconds)}</span>
  </button>
}

function GenerateControl({ inDrawer = false, drawerCollapsed = false, onToggleDrawer, onInsertImage, isGenerating, phase, elapsedSeconds, sttState, ttsState, canUndo, canRedo, onOpenDetails, onGenerate, onStop, onMicro, onMicro2, onUndo, onRedo, onRegenerate, onReadAloud, readAloudDisabled, readAloudTitle }: {
  inDrawer?: boolean
  drawerCollapsed?: boolean
  onToggleDrawer?: () => void
  onInsertImage?: () => void
  isGenerating: boolean
  phase: GenerationPhase | null
  elapsedSeconds: number
  sttState: SttState
  ttsState: TtsState
  canUndo: boolean
  canRedo: boolean
  onOpenDetails: () => void
  onGenerate: () => void
  onStop: () => void
  onMicro: () => void
  onMicro2: () => void
  onUndo: () => void
  onRedo: () => void
  onRegenerate: () => void
  onReadAloud: () => void
  readAloudDisabled?: boolean
  readAloudTitle?: string
}) {
  const [speechElapsed, setSpeechElapsed] = useState(0)
  const sttActive = sttState.presentation !== 'expanded' && (sttState.target === 'editor' || sttState.target === 'instruction') && ['requesting-permission', 'recording', 'recording-live', 'stopping', 'transcribing', 'finalizing'].includes(sttState.status)
  const ttsActive = ['preparing', 'generating', 'playing', 'paused', 'waiting', 'stopping'].includes(ttsState.status)

  useEffect(() => {
    if (!sttActive || !sttState.startedAt || !['recording', 'recording-live'].includes(sttState.status)) { setSpeechElapsed(0); return }
    const update = () => setSpeechElapsed(Math.max(0, Math.floor((Date.now() - sttState.startedAt!) / 1000)))
    update()
    const timer = window.setInterval(update, 250)
    return () => window.clearInterval(timer)
  }, [sttActive, sttState.startedAt, sttState.status])

  if (inDrawer && isGenerating && phase) return <div className="generate-control-shell drawer-generation-stop"><button className="generation-stop-circle" type="button" onClick={onStop} aria-label="Stop generation"><Square aria-hidden="true" fill="currentColor" /></button></div>

  if (isGenerating && phase) return <div className="generate-control-shell generation-running">
    <GenerationActivityStrip phase={phase} elapsedSeconds={elapsedSeconds} placement="floating" onOpenDetails={onOpenDetails} />
    <button className="generation-stop-circle" type="button" onClick={onStop} aria-label="Stop generation"><Square aria-hidden="true" fill="currentColor" /></button>
  </div>

  if (sttActive) {
    const label = sttState.status === 'requesting-permission' ? 'Microphone permission'
      : sttState.status === 'recording' ? `Recording · ${formatGenerationTime(speechElapsed)}`
      : sttState.status === 'recording-live' ? `Recording · Live · ${formatGenerationTime(speechElapsed)}`
      : sttState.status === 'transcribing' ? 'Transcribing…'
      : sttState.status === 'finalizing' ? 'Finalizing…'
      : 'Stopping…'
    return <div className="generate-control-shell mode dictation-mode">
      <div className="generate-mode-card dictation" role="status" aria-live="polite"><Mic aria-hidden="true" /><span><strong>{sttState.label || 'Dictation'}</strong><small>{label}</small></span><div className="generate-mode-actions">{['recording','recording-live'].includes(sttState.status) && <button type="button" onClick={stopSttSession}><Square aria-hidden="true" fill="currentColor" /><span>Stop</span></button>}<button type="button" className="cancel" onClick={cancelSttSession}><X aria-hidden="true" /><span>Cancel</span></button></div></div>
    </div>
  }

  if (ttsActive) {
    const label = ttsState.status === 'preparing' ? 'Preparing audio…'
      : ttsState.status === 'generating' ? 'Generating audio…'
      : ttsState.status === 'playing' ? 'Playing'
      : ttsState.status === 'paused' ? 'Paused'
      : ttsState.status === 'waiting' ? 'Waiting for next chunk…'
      : 'Stopping…'
    return <div className="generate-control-shell mode playback-mode">
      <div className="generate-mode-card playback" role="status" aria-live="polite"><Volume2 aria-hidden="true" /><span><strong>{ttsState.label || 'Read aloud'}</strong><small>{label}</small></span><div className="generate-mode-actions">{ttsState.status === 'playing' && <button type="button" onClick={pauseTtsSession}><Pause aria-hidden="true" /><span>Pause</span></button>}{ttsState.status === 'paused' && <button type="button" onClick={() => { void resumeTtsSession() }}><Play aria-hidden="true" /><span>Resume</span></button>}<button type="button" className="cancel" onClick={stopTtsSession}><Square aria-hidden="true" fill="currentColor" /><span>Stop</span></button></div></div>
    </div>
  }

  return <div className="generate-control-shell"><GenerationActions label="Generate" onGenerate={onGenerate} actions={[
    ...(onInsertImage ? [{ id: 'image', label: 'Insert image', icon: <ImagePlus aria-hidden="true" />, onSelect: onInsertImage }] : []),
    ...(onToggleDrawer ? [{ id: 'drawer', label: drawerCollapsed ? 'Show instruction drawer' : 'Hide instruction drawer', icon: <ChevronDown aria-hidden="true" />, onSelect: onToggleDrawer }] : []),
    { id: 'instruction', label: 'Dictate instruction', icon: <Mic aria-hidden="true" />, onSelect: onMicro2 },
    { id: 'editor', label: 'Dictate editor', icon: <Mic aria-hidden="true" />, onSelect: onMicro },
    { id: 'regenerate', label: 'Regenerate', icon: <RefreshCw aria-hidden="true" />, onSelect: onRegenerate },
    { id: 'read', label: readAloudTitle || 'Read aloud', icon: <Volume2 aria-hidden="true" />, onSelect: onReadAloud, disabled: readAloudDisabled },
    { id: 'undo', label: 'Undo', icon: <Undo2 aria-hidden="true" />, onSelect: onUndo, disabled: !canUndo },
    { id: 'redo', label: 'Redo', icon: <Redo2 aria-hidden="true" />, onSelect: onRedo, disabled: !canRedo },
  ]} /></div>
}

function AutotitlePanel({ state, onAccept, onRegenerate, onStop, onCancel }: { state: AutotitleUiState; onAccept: () => void; onRegenerate: () => void; onStop: () => void; onCancel: () => void }) {
  const label = state.targetType === 'codexEntry' ? 'Codex entry' : state.targetType[0].toUpperCase() + state.targetType.slice(1)
  const diagnostics = state.request?.diagnostics
  const titleId = `autotitle-title-${state.targetId}`
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onCancel()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onCancel])

  return createPortal(<div className="autotitle-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
    <section className="autotitle-panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header><div className="autotitle-heading-icon"><WandSparkles aria-hidden="true" /></div><div><small>AI title · {label}</small><strong id={titleId}>{state.targetTitle}</strong></div><button className="autotitle-close" type="button" onClick={onCancel} aria-label="Close title generator" title="Close"><X aria-hidden="true" /></button></header>
      {state.status === 'loading' ? <div className="autotitle-suggestion loading" aria-live="polite"><small>Suggested title</small><span><RefreshCw aria-hidden="true" /> Generating suggestion…</span></div> : state.suggestion ? <div className="autotitle-suggestion" aria-live="polite"><small>Suggested title</small><strong>{state.suggestion}</strong></div> : null}
      {state.error && <p className="autotitle-error" role="alert">{state.error}</p>}
      {state.request && <><div className="autotitle-meta"><span>{label}</span><span>{state.request.model}</span>{diagnostics && <span>~{diagnostics.requestTokens.toLocaleString()} tokens · {Math.round(diagnostics.usageRatio * 100)}% context</span>}</div><details className="autotitle-request"><summary>Request details</summary><pre>{`TARGET: ${state.request.targetId}\n\nSYSTEM:\n${state.request.systemPrompt}\n\nUSER:\n${state.request.userMessage}`}</pre></details></>}
      <div className="autotitle-actions">{state.status === 'loading' ? <button className="danger" type="button" onClick={onStop}><Square aria-hidden="true" fill="currentColor" /> Stop</button> : <><button type="button" onClick={onCancel}>Cancel</button><button type="button" onClick={onRegenerate}><RefreshCw aria-hidden="true" /> Regenerate</button>{state.suggestion && <button className="primary" type="button" onClick={onAccept}><Check aria-hidden="true" /> Use title</button>}</>}</div>
    </section>
  </div>, document.body)
}

function GenerationDetailsDialog({ details, elapsedSeconds, onClose }: {
  details: GenerationDetails
  elapsedSeconds: number
  onClose: () => void
}) {
  const titleId = 'generation-details-title'
  const visibleElapsed = details.finishedAt
    ? Math.max(0, Math.floor((details.finishedAt - details.startedAt) / 1000))
    : elapsedSeconds
  const status = details.status === 'complete'
    ? 'Complete'
    : details.status === 'cancelled'
      ? 'Cancelled'
      : details.status === 'error'
        ? 'Failed'
        : generationPhaseLabel(details.status)
  const tokens = details.totalTokens !== undefined
    ? details.totalTokens.toLocaleString()
    : details.promptTokens !== undefined || details.completionTokens !== undefined
      ? `${(details.promptTokens ?? 0).toLocaleString()} input · ${(details.completionTokens ?? 0).toLocaleString()} output`
      : 'Not reported by provider'

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  return createPortal(
    <div className="generation-details-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="generation-details-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header>
          <div><small>{status} · {formatGenerationTime(visibleElapsed)}</small><h2 id={titleId}>{details.task} generation</h2></div>
          <button type="button" onClick={onClose} aria-label="Close generation details"><X aria-hidden="true" /></button>
        </header>
        <div className="generation-details-content">
          <section className="generation-thoughts">
            <h3>Thoughts</h3>
            {details.thoughts ? <pre>{details.thoughts}</pre> : <p>{details.status === 'sending' || details.status === 'thinking' ? 'Waiting for thoughts from the model…' : 'This model did not expose thoughts for this generation.'}</p>}
          </section>
          <section className="generation-metadata">
            <h3>Generation details</h3>
            <dl>
              <div><dt>Status</dt><dd>{status}</dd></div>
              <div><dt>Elapsed</dt><dd>{formatGenerationTime(visibleElapsed)}</dd></div>
              <div><dt>Action</dt><dd>{details.action}</dd></div>
              <div><dt>Target</dt><dd>{details.targetTitle}</dd></div>
              <div><dt>Provider</dt><dd>{details.provider}</dd></div>
              <div><dt>Requested model</dt><dd>{details.requestedModel}</dd></div>
              {details.responseModel && details.responseModel !== details.requestedModel && <div><dt>Response model</dt><dd>{details.responseModel}</dd></div>}
              <div><dt>Tokens</dt><dd>{tokens}</dd></div>
              {details.estimatedRequestTokens !== undefined && <div><dt>Estimated request</dt><dd>~{details.estimatedRequestTokens.toLocaleString()} tokens</dd></div>}
              {details.modelContextTokens !== undefined && <div><dt>Context window</dt><dd>{details.modelContextTokens.toLocaleString()} tokens</dd></div>}
              {details.finishReason && <div><dt>Finish reason</dt><dd>{details.finishReason}</dd></div>}
              {details.responseId && <div><dt>Response ID</dt><dd>{details.responseId}</dd></div>}
            </dl>
          </section>
        </div>
      </section>
    </div>,
    document.body,
  )
}

function MessageActions({ user = false }: { user?: boolean }) { return <div className="message-tools"><button type="button"><Pencil aria-hidden="true" /> Edit</button>{!user && <><button type="button"><GitFork aria-hidden="true" /> Fork</button><button type="button"><Volume2 aria-hidden="true" /> Read aloud</button><button type="button"><RefreshCw aria-hidden="true" /> Regenerate</button></>}<button type="button"><Trash2 aria-hidden="true" /> Delete</button></div> }
function SummaryIcon({ state, onOpen, kind = 'outline' }: { state: SummaryState; onOpen: () => void; kind?: 'outline' | 'codex' }) { const Icon = state === 'current' ? FileText : state === 'outdated' ? RefreshCw : FileQuestion; const title = kind === 'codex' ? state === 'missing' ? 'No summary — full entry is used for AI context.' : state === 'current' ? 'Current summary.' : 'Summary outdated — full entry will be used.' : `${state[0].toUpperCase()}${state.slice(1)} summary`; return <button className={`summary-status ${state} ${kind === 'codex' ? 'codex-summary-status' : ''}`} type="button" onClick={onOpen} aria-label={`Open ${state} summary`} title={title}><Icon aria-hidden="true" /></button> }
function codexSummaryPolicyText(entry: CodexEntryEntity, state: SummaryState) { if (!entry.preferSummaryForContext) return 'Full entry is used for AI context.'; if (state === 'current') return 'Current summary is used for AI context.'; if (state === 'missing') return 'No summary yet — full entry is used.'; return 'Summary is outdated — full entry is used until updated.' }
function formatEdited(updatedAt: number) {
  const minutes = Math.max(0, Math.round((Date.now() - updatedAt) / 60_000))
  if (minutes < 1) return 'Edited just now'
  if (minutes < 60) return `Edited ${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `Edited ${hours} hour${hours === 1 ? '' : 's'} ago`
  return `Edited ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(updatedAt)}`
}

function countWords(markdown: string) {
  const text = proseText(markdown)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/<[^>]+>/g, ' ')
  return text.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)?.length ?? 0
}

function formatWordCount(count: number) {
  return `${count.toLocaleString()} ${count === 1 ? 'word' : 'words'}`
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

function BookSettings({ book, books, series, onSave, onCreateSeries, onRenameSeries, onDelete, onBeforeExport, onImported }: {
  onBeforeExport: () => Promise<void>
  onImported: (bookId: string) => Promise<void>
  book: BookEntity | null
  books: BookEntity[]
  series: SeriesEntity[]
  onSave: (metadata: BookMetadata, seriesLorePolicy?: 'keep' | 'remove') => Promise<void>
  onCreateSeries: (title: string) => Promise<SeriesEntity>
  onRenameSeries: (id: string, title: string) => Promise<SeriesEntity>
  onDelete: () => Promise<void>
}) {
  const [draft, setDraft] = useState<BookMetadata | null>(book ? bookMetadata(book) : null)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [seriesPickerMode, setSeriesPickerMode] = useState<'choose' | 'rename' | null>(null)
  const [seriesQuery, setSeriesQuery] = useState('')
  const seriesLorePolicyRef = useRef<'keep' | 'remove'>('keep')
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
    seriesLorePolicyRef.current = 'keep'
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
    const draftSnapshot = draft
    const timer = window.setTimeout(async () => {
      try {
        await saveHandlerRef.current(draftSnapshot, seriesLorePolicyRef.current)
        if (sequence !== saveSequenceRef.current) return
        savedRef.current = JSON.stringify(draftSnapshot)
        setSaveStatus('saved')
      } catch (error) {
        console.error('Failed to save book metadata', error)
        if (sequence === saveSequenceRef.current) setSaveStatus('error')
      }
    }, 650)
    return () => window.clearTimeout(timer)
  }, [draft])

  useEffect(() => {
    if (!deleteConfirm) return
    const timer = window.setTimeout(() => setDeleteConfirm(false), 6000)
    return () => window.clearTimeout(timer)
  }, [deleteConfirm])

  useEffect(() => () => {
    const latest = latestDraftRef.current
    if (latest && JSON.stringify(latest) !== savedRef.current) void saveHandlerRef.current(latest, seriesLorePolicyRef.current)
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
            <div className="series-leave-policy">{book.seriesId && <label>When changing or leaving this series<select defaultValue="keep" onChange={event => { seriesLorePolicyRef.current = event.target.value as 'keep' | 'remove' }}><option value="keep">Keep visible inherited lore as local copies</option><option value="remove">Remove inherited links</option></select><small>Book-only entries and overrides are preserved.</small></label>}</div>
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
    <BookStorage key={book.id} bookId={book.id} onImported={onImported} beforeExport={async () => {
      if (latestDraftRef.current) await onSave(latestDraftRef.current)
      await onBeforeExport()
    }} />
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
  onAutotitle: (entity: StructuralEntity) => void
  onRead: (entity: StructuralEntity) => void
  onRename: (entity: StructuralEntity) => void
  onMove: (entity: StructuralEntity, direction: -1 | 1) => void
  onDelete: (entity: StructuralEntity) => void
}

function CodexDependenciesMetadata({ source, entries, edges, readOnly, onAdd, onUpdate, onRemove, onOpen }: {
  source: CodexEntryEntity
  entries: CodexEntryEntity[]
  edges: CodexDependencyEdge[]
  readOnly: boolean
  onAdd: (targetId: string) => Promise<void>
  onUpdate: (edgeId: string, patch: { relationLabel?: string; includeWithSource?: boolean }) => Promise<void>
  onRemove: (edgeId: string) => Promise<void>
  onOpen: (entryId: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const outgoing = edges.filter((edge) => edge.sourceId === source.id)
  const incoming = edges.filter((edge) => edge.targetId === source.id)
  const linkedIds = new Set(outgoing.map((edge) => edge.targetId))
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const candidates = entries
    .filter((entry) => entry.id !== source.id && !linkedIds.has(entry.id) && !isCodexEntryArchived(entry))
    .filter((entry) => !normalizedQuery || `${entry.title} ${entry.category}`.toLocaleLowerCase().includes(normalizedQuery))
    .sort((a, b) => a.title.localeCompare(b.title))

  return <section className={`codex-dependencies-metadata ${readOnly ? 'read-only' : ''}`} aria-label="Codex dependencies">
    <details className="codex-dependency-section">
      <summary><span>Dependencies · {outgoing.length}</span><small>Lore this entry may need when Arc includes it automatically.</small></summary>
      <div className="codex-dependency-content">
        {outgoing.length ? outgoing.map((edge) => {
          const target = byId.get(edge.targetId)
          const archived = Boolean(target && isCodexEntryArchived(target))
          return <article className={`codex-dependency-row ${archived ? 'archived' : ''}`} key={edge.id}>
            <button type="button" className="codex-dependency-open" disabled={!target} onClick={() => target && onOpen(target.id)}><span><strong>{target?.title ?? 'Missing dependency'}</strong><small>{target ? `${target.category}${archived ? ' · Archived · inactive for AI context' : ''}` : 'Target no longer exists'}</small></span><ChevronRight aria-hidden="true" /></button>
            <label className="codex-dependency-label"><span>Relation</span><input disabled={readOnly} defaultValue={edge.relationLabel} placeholder="Optional, e.g. member of" onBlur={(event) => { if (event.target.value.trim() !== edge.relationLabel) void onUpdate(edge.id, { relationLabel: event.target.value }) }} /></label>
            <label className="codex-dependency-include"><input type="checkbox" disabled={readOnly || archived || !target} checked={edge.includeWithSource} onChange={(event) => { void onUpdate(edge.id, { includeWithSource: event.target.checked }) }} /><span><strong>Include with this entry</strong><small>{archived ? 'Inactive while target is archived' : 'Available to automatic dependency cascade'}</small></span></label>
            {!readOnly && <button type="button" className="codex-dependency-remove" onClick={() => { void onRemove(edge.id) }}><Trash2 aria-hidden="true" /> Remove</button>}
          </article>
        }) : <p className="codex-dependency-empty">No dependencies yet.</p>}
        {!readOnly && <div className="codex-dependency-add">
          <button type="button" onClick={() => { setAdding((value) => !value); setQuery('') }}><Plus aria-hidden="true" /> Add dependency</button>
          {adding && <div className="codex-dependency-picker">
            <label><Search aria-hidden="true" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search active Codex by title or category" /></label>
            <div>{candidates.length ? candidates.map((entry) => <button type="button" key={entry.id} onClick={() => { void onAdd(entry.id); setAdding(false); setQuery('') }}><span><strong>{entry.title}</strong><small>{entry.category}</small></span><Plus aria-hidden="true" /></button>) : <p>No available Codex entries match.</p>}</div>
          </div>}
        </div>}
      </div>
    </details>
    <details className="codex-dependency-section needed-by">
      <summary><span>Needed by · {incoming.length}</span><small>Entries that declare this lore as a dependency.</small></summary>
      <div className="codex-dependency-content">
        {incoming.length ? incoming.map((edge) => {
          const owner = byId.get(edge.sourceId)
          return <button className="codex-needed-by-row" type="button" key={edge.id} disabled={!owner} onClick={() => owner && onOpen(owner.id)}><span><strong>{owner?.title ?? 'Missing source'}</strong><small>{owner ? `${owner.category}${edge.relationLabel ? ` · ${edge.relationLabel}` : ''}` : 'Source no longer exists'}</small></span><ChevronRight aria-hidden="true" /></button>
        }) : <p className="codex-dependency-empty">No entries currently need this one.</p>}
      </div>
    </details>
  </section>
}

function Outline({ book, entities, activeSceneId, summaryStates, expandedIds, onToggle, onOpenScene, onOpenSummary, onCreate, onAutotitle, onRead, onRename, onMove, onDelete }: OutlineProps) {
  if (!book) return <section className="outline-empty"><BookOpenText aria-hidden="true" /><p>Create or open a book to see its outline.</p></section>
  const children = (parentId: string, type: StructuralEntityType) => entities
    .filter((entity) => entity.parentId === parentId && entity.type === type)
    .sort((a, b) => a.order - b.order)
  const acts = children(book.id, 'act')
  const directChapters = children(book.id, 'chapter')
  const wordCounts = new Map<string, number>()
  const wordCountFor = (entity: StructuralEntity): number => {
    const cached = wordCounts.get(entity.id)
    if (cached !== undefined) return cached
    const count = entity.type === 'scene'
      ? countWords(typeof entity.content === 'string' ? entity.content : '')
      : children(entity.id, entity.type === 'act' ? 'chapter' : 'scene').reduce((sum, child) => sum + wordCountFor(child), 0)
    wordCounts.set(entity.id, count)
    return count
  }

  const renderChapter = (chapter: StructuralEntity, index: number, count: number) => {
    const scenes = children(chapter.id, 'scene')
    const open = expandedIds.has(chapter.id)
    return <div className="outline-branch" key={chapter.id}>
      <OutlineRow entity={chapter} label={`Chapter ${index + 1}`} wordCount={wordCountFor(chapter)} summaryState={summaryStates[chapter.id] ?? 'missing'} expanded={open} expandable onToggle={onToggle} onOpenScene={onOpenScene} onOpenSummary={onOpenSummary} onCreate={onCreate} onAutotitle={onAutotitle} onRead={onRead} onRename={onRename} onMove={onMove} onDelete={onDelete} first={index === 0} last={index === count - 1} />
      {open && <div className="tree-children">{scenes.length ? scenes.map((scene, sceneIndex) => <OutlineRow key={scene.id} entity={scene} label={`Scene ${sceneIndex + 1}`} wordCount={wordCountFor(scene)} summaryState={summaryStates[scene.id] ?? 'missing'} selected={activeSceneId === scene.id} onToggle={onToggle} onOpenScene={onOpenScene} onOpenSummary={onOpenSummary} onCreate={onCreate} onAutotitle={onAutotitle} onRead={onRead} onRename={onRename} onMove={onMove} onDelete={onDelete} first={sceneIndex === 0} last={sceneIndex === scenes.length - 1} />) : <p className="tree-empty">No scenes yet</p>}</div>}
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
          <OutlineRow entity={act} label={`Act ${actIndex + 1}`} wordCount={wordCountFor(act)} summaryState={summaryStates[act.id] ?? 'missing'} expanded={open} expandable onToggle={onToggle} onOpenScene={onOpenScene} onOpenSummary={onOpenSummary} onCreate={onCreate} onAutotitle={onAutotitle} onRead={onRead} onRename={onRename} onMove={onMove} onDelete={onDelete} first={actIndex === 0} last={actIndex === acts.length - 1} />
          {open && <div className="tree-children">{chapters.length ? chapters.map((chapter, chapterIndex) => renderChapter(chapter, chapterIndex, chapters.length)) : <p className="tree-empty">No chapters yet</p>}</div>}
        </div>
      })}
      {directChapters.length > 0 && <div className="direct-chapters">{acts.length > 0 && <small className="tree-group-label">Chapters without an act</small>}{directChapters.map((chapter, chapterIndex) => renderChapter(chapter, chapterIndex, directChapters.length))}</div>}
      {!acts.length && !directChapters.length && <div className="outline-empty"><BookOpenText aria-hidden="true" /><p>Add a chapter to start this manuscript.</p></div>}
    </div>
  </section>
}

function OutlineRow({ entity, label, wordCount, summaryState, selected = false, expandable = false, expanded = false, first, last, onToggle, onOpenScene, onOpenSummary, onCreate, onAutotitle, onRead, onRename, onMove, onDelete }: {
  entity: StructuralEntity
  label: string
  wordCount: number
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
  onAutotitle: (entity: StructuralEntity) => void
  onRead: (entity: StructuralEntity) => void
  onRename: (entity: StructuralEntity) => void
  onMove: (entity: StructuralEntity, direction: -1 | 1) => void
  onDelete: (entity: StructuralEntity) => void
}) {
  return <div className={`outline-row ${selected ? 'selected' : ''}`}>
    {expandable ? <button className="tree-toggle" type="button" onClick={() => onToggle(entity.id)} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${entity.title}`}>{expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}</button> : <span className="tree-spacer" />}
    <button className="tree-label" type="button" onClick={() => entity.type === 'scene' ? onOpenScene(entity.id) : onToggle(entity.id)}><small>{label} · {formatWordCount(wordCount)}</small><span>{entity.title}</span></button>
    <SummaryIcon state={summaryState} onOpen={() => onOpenSummary(entity)} />
    <div className="outline-actions">
      {entity.type === 'act' && <button type="button" onClick={() => onCreate('chapter', entity.id)} aria-label={`Add chapter to ${entity.title}`} title="Add chapter"><Plus aria-hidden="true" /></button>}
      {entity.type === 'chapter' && <button type="button" onClick={() => onCreate('scene', entity.id)} aria-label={`Add scene to ${entity.title}`} title="Add scene"><Plus aria-hidden="true" /></button>}
      <button className="autotitle-trigger" type="button" onClick={() => onAutotitle(entity)} aria-label={`Autotitle ${entity.title}`} title="Autotitle"><WandSparkles aria-hidden="true" /></button>
      {(entity.type === 'scene' || entity.type === 'chapter') && <button className="read-aloud-action" type="button" onClick={() => onRead(entity)} aria-label={`Read ${entity.title} aloud`} title="Read aloud · paid TTS"><Volume2 aria-hidden="true" /></button>}
      <button type="button" onClick={() => onRename(entity)} aria-label={`Rename ${entity.title}`} title="Rename"><Pencil aria-hidden="true" /></button>
      <button type="button" onClick={() => onMove(entity, -1)} disabled={first} aria-label={`Move ${entity.title} up`} title="Move up"><ArrowUp aria-hidden="true" /></button>
      <button type="button" onClick={() => onMove(entity, 1)} disabled={last} aria-label={`Move ${entity.title} down`} title="Move down"><ArrowDown aria-hidden="true" /></button>
      <button type="button" className="delete" onClick={() => onDelete(entity)} aria-label={`Delete ${entity.title}`} title="Delete"><Trash2 aria-hidden="true" /></button>
    </div>
  </div>
}
function Notes({ notes, activeId, onCreate, onOpen, onAutotitle, onRead, onRename, onDelete }: {
  notes: NoteEntity[]
  activeId: string | null
  onCreate: () => void
  onOpen: (id: string) => void
  onAutotitle: (entity: NoteEntity) => void
  onRead: (entity: NoteEntity) => void
  onRename: (entity: NoteEntity) => void
  onDelete: (entity: NoteEntity) => void
}) {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const visible = notes.filter((note) => !normalizedQuery || `${note.title} ${note.content}`.toLowerCase().includes(normalizedQuery))
  return <section><div className="panel-title"><div><small>Reference</small><h2>Notes</h2></div><button type="button" onClick={onCreate} aria-label="Add note"><Plus aria-hidden="true" /> New</button></div><input className="panel-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes"/>{visible.length ? visible.map((note) => <article className={`content-row ${activeId === note.id ? 'selected' : ''}`} key={note.id}><button className="content-open" type="button" onClick={() => onOpen(note.id)}><NotebookPen aria-hidden="true" /><span><strong>{note.title}</strong><small>{formatEdited(note.updatedAt)}</small></span><ChevronRight aria-hidden="true" /></button><div className="content-actions"><button className="autotitle-trigger" type="button" onClick={() => onAutotitle(note)} aria-label={`Autotitle ${note.title}`} title="Autotitle"><WandSparkles aria-hidden="true" /></button><button className="read-aloud-action" type="button" onClick={() => onRead(note)} aria-label={`Read ${note.title} aloud`} title="Read aloud"><Volume2 aria-hidden="true" /></button><button type="button" onClick={() => onRename(note)} aria-label={`Rename ${note.title}`}><Pencil aria-hidden="true" /></button><button type="button" onClick={() => onDelete(note)} aria-label={`Delete ${note.title}`}><Trash2 aria-hidden="true" /></button></div></article>) : <p className="content-empty">{query ? 'No matching notes.' : 'No notes yet.'}</p>}</section>
}


function ChatList({onOpen,activeChat,onSettings}:{onOpen:(title:string)=>void;activeChat:string;onSettings:()=>void}) { return <section><div className="panel-title"><div><small>Conversations</small><h2>Chats</h2></div><button type="button" aria-label="Start new chat"><Plus aria-hidden="true" /></button></div>{activeChat && <button className="current-chat" onClick={onSettings}><Settings2 aria-hidden="true" /><span><small>Current chat</small>{activeChat} settings</span><ChevronRight aria-hidden="true" /></button>}<input className="panel-search" placeholder="Search chats"/>{chats.map(([title,preview,time]) => <button className="chat-row" key={title} onClick={() => onOpen(title)}><i><MessageCircle aria-hidden="true" /></i><span><strong>{title}</strong><small>{preview}</small></span><em>{time}</em></button>)}</section> }
function ChatSettings({title,onBack}:{title:string;onBack:()=>void}) { return <section><button className="back-list" onClick={onBack}><ArrowLeft aria-hidden="true" /> All chats</button><div className="panel-title"><div><small>Current chat</small><h2>{title}</h2></div></div><label className="panel-field"><span>System prompt</span><textarea defaultValue="You are a thoughtful story collaborator. Use only selected book context."/></label><label className="panel-field"><span>Model</span><select><option>Claude 3.7 Sonnet</option><option>GPT-4.1</option></select></label><label className="thinking"><span>Thinking<small>Allow longer internal reasoning</small></span><input type="checkbox" defaultChecked/></label><label className="panel-field"><span>Context</span><div className="chips"><button>Chapter 7 <X aria-hidden="true" /></button><button>Codex <X aria-hidden="true" /></button><button><Plus aria-hidden="true" /> Add</button></div></label></section> }


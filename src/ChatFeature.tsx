import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Bot,
  Check,
  ChevronDown,
  Copy,
  Feather,
  GitFork,
  MessageCircle,
  Mic,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Square,
  Trash2,
  Volume2,
  X,
} from 'lucide-react'
import { streamChatCompletion } from './chat-api'
import ExpandableTextInput from './ExpandableTextInput'
import { chatMatchesBookSelection, onlyChatsForBook, reloadMatchesBookSelection } from './chat-book-guard'
import { chatHistoryPrefixMatches } from './chat-history-guard'
import {
  abortAllChatGenerations,
  abortChatGeneration,
  abortChatGenerationsOutsideSelection,
  createChatGenerationOwner,
  getChatGenerationOwner,
  ownsChatGeneration,
  registerChatGeneration,
  releaseChatGeneration,
  setChatGenerationPhase,
  type ChatGenerationOwner,
  type ChatGenerationOwners,
} from './chat-generation-owner'
import { runChatSendPipeline } from './chat-send-pipeline'
import {
  createChat,
  createChatMessage,
  deleteChat,
  deleteMessageAndFollowing,
  fetchAvailableChatModels,
  forkChat,
  getChat,
  getChatBookAiSettings,
  listChatMessages,
  listChats,
  updateChat,
  updateChatMessage,
  type ChatCodexCreationProposal,
  type ChatDocumentEditProposal,
  type ChatEntity,
  type ChatEntityActionProposal,
  type ChatMessageEntity,
  type ChatMessageStatus,
  type ChatModel,
  type ChatOutlineActionProposal,
} from './chat-service'
import { buildContextValues, contextLimitInputError, generationContextDiagnostics } from './context-service'
import { assertPromptTemplateValid, type BookPromptValues } from './prompt-template'
import { applyChatDocumentEdit, createChatCodexEntry, executeChatWorkspaceTool, rejectChatCodexEntry, rejectChatDocumentEdit } from './chat-tools'
import { applyChatEntityAction, chatEntityToolNames, executeChatEntityTool, rejectChatEntityAction } from './chat-entity-tools'
import { applyChatOutlineAction, chatOutlineToolNames, executeChatOutlineTool, rejectChatOutlineAction } from './chat-outline-tools'
import { assembleChatRequest, CHAT_TOOL_DEFINITIONS, serializeChatModelInput } from './chat-request'
import { appendNormalizedRequestPart, normalizeRuntimeMessagePart } from './prompt-composition'
import { startTtsSession } from './tts-service'
import { getSttState, normalizeTranscriptForInsertion, startSttSession, subscribeSttState, type SttState } from './stt-service'
import './chat.css'
import './context-limit-settings.css'

type GenerationPhase = 'sending' | 'thinking' | 'using-tools' | 'writing' | 'stopping'

type ChatViewProps = {
  bookId: string
  chatId: string
  bookPromptValues: BookPromptValues
  currentSceneId?: string | null
  onChatChange: (chatId: string) => void
  onToast: (message: string) => void
}

function formatElapsed(seconds: number) {
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function generationPhaseLabel(phase: GenerationPhase | null) {
  if (phase === 'sending') return 'Sending'
  if (phase === 'using-tools') return 'Using tools'
  if (phase === 'writing') return 'Writing'
  if (phase === 'stopping') return 'Stopping'
  return 'Thinking'
}

export function ChatView({ bookId, chatId, bookPromptValues, currentSceneId, onChatChange, onToast }: ChatViewProps) {
  const [chat, setChat] = useState<ChatEntity | null>(null)
  const [messages, setMessages] = useState<ChatMessageEntity[]>([])
  const [draft, setDraft] = useState('')
  const [models, setModels] = useState<ChatModel[]>([])
  const [modelStatus, setModelStatus] = useState('')
  const [promptOpen, setPromptOpen] = useState(false)
  const [promptDraft, setPromptDraft] = useState('')
  const [limitDraft, setLimitDraft] = useState('')
  const [editingId, setEditingId] = useState('')
  const [editingValue, setEditingValue] = useState('')
  const [copiedMessageId, setCopiedMessageId] = useState('')
  const [generating, setGenerating] = useState(false)
  const [phase, setPhase] = useState<GenerationPhase | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [streamedContent, setStreamedContent] = useState('')
  const [streamedThoughts, setStreamedThoughts] = useState('')
  const [liveThoughtsOpen, setLiveThoughtsOpen] = useState(true)
  const [openThoughtMessageIds, setOpenThoughtMessageIds] = useState<Set<string>>(new Set())
  const [followOutput, setFollowOutput] = useState(true)
  const [sttState, setSttState] = useState<SttState>(() => getSttState())
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const generationOwnersRef = useRef<ChatGenerationOwners>(new Map())
  const startedAtRef = useRef(0)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const followOutputRef = useRef(true)
  const selectedBookIdRef = useRef(bookId)
  const selectedChatIdRef = useRef(chatId)
  selectedBookIdRef.current = bookId
  selectedChatIdRef.current = chatId

  function isCurrentChat(candidate: Pick<ChatEntity, 'id' | 'bookId'> | null | undefined) {
    return chatMatchesBookSelection(candidate, selectedBookIdRef.current, selectedChatIdRef.current)
  }

  function applyIfCurrentChat(candidate: Pick<ChatEntity, 'id' | 'bookId'>, apply: () => void) {
    if (!isCurrentChat(candidate)) return false
    apply()
    return true
  }

  const sortedModels = useMemo(() => [...models].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id)), [models])

  useEffect(() => subscribeSttState(setSttState), [])

  useEffect(() => {
    let cancelled = false
    abortChatGenerationsOutsideSelection(generationOwnersRef.current, bookId, chatId)
    setGenerating(false)
    setPhase(null)
    setStreamedContent('')
    setStreamedThoughts('')
    setLiveThoughtsOpen(true)
    setOpenThoughtMessageIds(new Set())
    followOutputRef.current = true
    setFollowOutput(true)
    setEditingId('')
    setChat(null)
    setMessages([])
    setModels([])
    setModelStatus('')
    if (!bookId || !chatId) return () => { cancelled = true }
    ;(async () => {
      try {
        const loadedChat = await getChat(chatId)
        if (cancelled) return
        if (!loadedChat || !chatMatchesBookSelection(loadedChat, bookId, chatId)) {
          setChat(null)
          setMessages([])
          return
        }
        const [loadedMessages, settings] = await Promise.all([
          listChatMessages(loadedChat.bookId, loadedChat.id),
          getChatBookAiSettings(loadedChat.bookId),
        ])
        if (cancelled || !isCurrentChat(loadedChat)) return
        setChat(loadedChat)
        setPromptDraft(loadedChat.systemPrompt)
        setLimitDraft(loadedChat.effectiveContextLimit)
        setMessages(loadedMessages)
        setModelStatus('Loading models…')
        try {
          const available = await fetchAvailableChatModels(settings)
          if (!cancelled && isCurrentChat(loadedChat)) {
            setModels(available)
            setModelStatus(available.length ? '' : 'The provider returned no models.')
          }
        } catch (error) {
          if (!cancelled && isCurrentChat(loadedChat)) setModelStatus(error instanceof Error ? error.message : 'Could not load models.')
        }
      } catch (error) {
        if (!cancelled) onToast(error instanceof Error ? error.message : 'Could not load this chat.')
      }
    })()
    return () => { cancelled = true }
  }, [bookId, chatId])

  useEffect(() => {
    if (!generating) return
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1000)))
    update()
    const timer = window.setInterval(update, 250)
    return () => window.clearInterval(timer)
  }, [generating])

  useEffect(() => {
    if (!generating) return
    const updateFollowState = () => {
      const root = document.documentElement
      const distanceFromBottom = root.scrollHeight - (window.scrollY + window.innerHeight)
      const nearBottom = distanceFromBottom <= 120
      if (nearBottom === followOutputRef.current) return
      followOutputRef.current = nearBottom
      setFollowOutput(nearBottom)
    }
    window.addEventListener('scroll', updateFollowState, { passive: true })
    updateFollowState()
    return () => window.removeEventListener('scroll', updateFollowState)
  }, [generating])

  useEffect(() => {
    if (!followOutputRef.current) return
    const frame = window.requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: 'end' }))
    return () => window.cancelAnimationFrame(frame)
  }, [messages.length, streamedContent, streamedThoughts, phase])

  useEffect(() => () => {
    abortAllChatGenerations(generationOwnersRef.current)
    if (copyResetRef.current) clearTimeout(copyResetRef.current)
  }, [])

  async function reloadMessages() {
    if (!chat || !isCurrentChat(chat)) return []
    const sourceChat = chat
    const next = await listChatMessages(sourceChat.bookId, sourceChat.id)
    applyIfCurrentChat(sourceChat, () => setMessages(next))
    const refreshed = await getChat(sourceChat.id)
    if (refreshed?.bookId === sourceChat.bookId) applyIfCurrentChat(sourceChat, () => setChat(refreshed))
    return next
  }

  async function changeModel(modelId: string) {
    if (!chat || !isCurrentChat(chat)) return
    const sourceChat = chat
    const selected = models.find((model) => model.id === modelId)
    try {
      const updated = await updateChat(sourceChat.id, { model: modelId, modelContextLength: selected?.context_length })
      if (updated.bookId === sourceChat.bookId) applyIfCurrentChat(sourceChat, () => setChat(updated))
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not save the chat model.')
    }
  }

  async function saveEffectiveContextLimit() {
    if (!chat || !isCurrentChat(chat) || limitDraft === chat.effectiveContextLimit) return
    const sourceChat = chat
    const limitSnapshot = limitDraft
    const error = contextLimitInputError(limitSnapshot)
    if (error) { onToast(error); return }
    try {
      const updated = await updateChat(sourceChat.id, { effectiveContextLimit: limitSnapshot })
      if (updated.bookId !== sourceChat.bookId) return
      applyIfCurrentChat(sourceChat, () => {
        setChat(updated)
        setLimitDraft(updated.effectiveContextLimit)
      })
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not save the Chat context cap.')
    }
  }

  async function savePrompt() {
    if (!chat || !isCurrentChat(chat)) return
    const sourceChat = chat
    const promptSnapshot = promptDraft
    try {
      const updated = await updateChat(sourceChat.id, { systemPrompt: promptSnapshot })
      if (updated.bookId !== sourceChat.bookId) return
      applyIfCurrentChat(sourceChat, () => {
        setChat(updated)
        setPromptDraft(updated.systemPrompt)
        setPromptOpen(false)
      })
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not save the system prompt.')
    }
  }

  async function setThinking(value: boolean) {
    if (!chat || !isCurrentChat(chat)) return
    const sourceChat = chat
    applyIfCurrentChat(sourceChat, () => setChat({ ...sourceChat, thinking: value }))
    try {
      const updated = await updateChat(sourceChat.id, { thinking: value })
      if (updated.bookId === sourceChat.bookId) applyIfCurrentChat(sourceChat, () => setChat(updated))
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not save the thinking setting.')
    }
  }

  async function dictateMessage() {
    if (!chat || generating || !isCurrentChat(chat)) return
    const sourceChat = chat
    const input = inputRef.current
    const base = draft
    const start = input?.selectionStart ?? base.length
    const end = input?.selectionEnd ?? start
    const render = (transcript: string) => {
      const insertion = normalizeTranscriptForInsertion(transcript, base.slice(0, start), base.slice(end))
      return { value: `${base.slice(0, start)}${insertion}${base.slice(end)}`, cursor: start + insertion.length }
    }
    try {
      const settings = await getChatBookAiSettings(sourceChat.bookId)
      if (!isCurrentChat(sourceChat)) return
      await startSttSession(settings.speech, {
        kind: 'chat',
        label: 'Dictate message',
        isValid: () => isCurrentChat(sourceChat) && Boolean(inputRef.current),
        onProvisional: (transcript) => { if (isCurrentChat(sourceChat)) setDraft(render(transcript).value) },
        onFinal: (transcript) => {
          if (!isCurrentChat(sourceChat)) throw new Error('The original Chat composer is no longer available.')
          const next = render(transcript)
          setDraft(next.value)
          requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(next.cursor, next.cursor) })
        },
        onCancel: () => { if (isCurrentChat(sourceChat)) setDraft(base) },
      })
    } catch (error) {
      if (isCurrentChat(sourceChat)) setDraft(base)
      onToast(error instanceof Error ? error.message : 'Could not start message dictation.')
    }
  }

  type ChatRequestHistoryItem = Pick<ChatMessageEntity, 'role' | 'content' | 'thoughts' | 'documentEdits' | 'codexCreations' | 'outlineActions' | 'entityActions'>
  type PreparedAssistantGeneration = {
    settings: Awaited<ReturnType<typeof getChatBookAiSettings>>
    context: Awaited<ReturnType<typeof buildContextValues>>
  }

  function generationOwnsCurrentUi(owner: ChatGenerationOwner) {
    return ownsChatGeneration(generationOwnersRef.current, owner)
      && selectedBookIdRef.current === owner.bookId
      && selectedChatIdRef.current === owner.chatId
  }

  function setOwnedGenerationPhase(owner: ChatGenerationOwner, nextPhase: GenerationPhase) {
    if (!setChatGenerationPhase(generationOwnersRef.current, owner, nextPhase)) return false
    if (generationOwnsCurrentUi(owner)) setPhase(nextPhase)
    return true
  }

  function beginGenerationUi(owner: ChatGenerationOwner) {
    if (!generationOwnsCurrentUi(owner)) return
    startedAtRef.current = Date.now()
    setElapsed(0)
    setGenerating(true)
    setEditingId('')
    setPhase('sending')
    setStreamedContent('')
    setStreamedThoughts('')
    setLiveThoughtsOpen(true)
    followOutputRef.current = true
    setFollowOutput(true)
  }

  function finishGenerationOwner(owner: ChatGenerationOwner) {
    const ownsUi = generationOwnsCurrentUi(owner)
    const released = releaseChatGeneration(generationOwnersRef.current, owner)
    if (!released || !ownsUi) return
    setGenerating(false)
    setPhase(null)
    setElapsed(0)
    setStreamedContent('')
    setStreamedThoughts('')
  }

  function reserveGeneration(activeChat: ChatEntity) {
    const owner = createChatGenerationOwner(activeChat.bookId, activeChat.id)
    if (!registerChatGeneration(generationOwnersRef.current, owner)) return null
    beginGenerationUi(owner)
    return owner
  }

  function assertGenerationOwnerCurrent(owner: ChatGenerationOwner, activeChat: ChatEntity) {
    if (!ownsChatGeneration(generationOwnersRef.current, owner) || owner.controller.signal.aborted || !isCurrentChat(activeChat)) {
      throw new DOMException('Chat generation was cancelled.', 'AbortError')
    }
  }

  function buildProviderRequest(
    activeChat: ChatEntity,
    history: ChatRequestHistoryItem[],
    prepared: PreparedAssistantGeneration,
  ) {
    const { settings, context } = prepared
    const promptValues = { ...bookPromptValues, responseLength: settings.responseLength }
    assertPromptTemplateValid(activeChat.systemPrompt, 'assistant')
    const historyMessages = history.map((message) => {
      const editState = message.role === 'assistant' && message.documentEdits?.length
        ? `\n\n[Workspace edit proposals: ${message.documentEdits.map((proposal) => `${proposal.entityTitle}: ${proposal.status}`).join('; ')}]`
        : ''
      const creationState = message.role === 'assistant' && message.codexCreations?.length
        ? `\n\n[Codex creation proposals: ${message.codexCreations.map((proposal) => `${proposal.title}: ${proposal.status}`).join('; ')}]`
        : ''
      const outlineState = message.role === 'assistant' && message.outlineActions?.length
        ? `\n\n[Outline proposals: ${message.outlineActions.map((proposal) => `${proposal.action} ${proposal.entityTitle}: ${proposal.status}`).join('; ')}]`
        : ''
      const entityActionState = message.role === 'assistant' && message.entityActions?.length
        ? `\n\n[Entity proposals: ${message.entityActions.map((proposal) => `${proposal.action} ${proposal.entityTitle}: ${proposal.status}`).join('; ')}]`
        : ''
      return {
        id: 'id' in message && typeof message.id === 'string' ? message.id : undefined,
        role: message.role,
        content: `${message.content}${editState}${creationState}${outlineState}${entityActionState}`,
        ...(message.role === 'assistant' && message.thoughts ? { thoughts: message.thoughts } : {}),
      }
    })
    return assembleChatRequest({ systemPrompt: activeChat.systemPrompt, book: promptValues, context, history: historyMessages })
  }

  async function prepareAssistantGeneration(
    activeChat: ChatEntity,
    history: ChatRequestHistoryItem[],
    owner: ChatGenerationOwner,
  ): Promise<PreparedAssistantGeneration> {
    assertGenerationOwnerCurrent(owner, activeChat)
    let settings: Awaited<ReturnType<typeof getChatBookAiSettings>>
    try {
      settings = await getChatBookAiSettings(activeChat.bookId)
    } catch {
      assertGenerationOwnerCurrent(owner, activeChat)
      throw new Error('This book’s AI settings could not be loaded.')
    }
    assertGenerationOwnerCurrent(owner, activeChat)
    if (settings.provider !== 'fake' && !settings.apiKey.trim()) throw new Error('Add an API key in Book AI settings before chatting.')
    if (!activeChat.model.trim()) throw new Error('Choose a chat model before sending.')

    let context: Awaited<ReturnType<typeof buildContextValues>>
    try {
      context = await buildContextValues({
        bookId: activeChat.bookId,
        type: 'chat',
        currentSceneId: currentSceneId || undefined,
        profile: activeChat.contextProfile,
      })
    } catch (error) {
      assertGenerationOwnerCurrent(owner, activeChat)
      throw new Error(error instanceof Error ? error.message : 'Chat context could not be prepared.')
    }
    assertGenerationOwnerCurrent(owner, activeChat)

    const prepared = { settings, context }
    const normalizedRequest = buildProviderRequest(activeChat, history, prepared)
    const diagnostics = generationContextDiagnostics(activeChat.model, activeChat.modelContextLength, activeChat.effectiveContextLimit, serializeChatModelInput(normalizedRequest))
    if (!diagnostics.limitValid) throw new Error(diagnostics.limitError ?? 'The Chat context cap is invalid.')
    if (!diagnostics.fits) {
      const dependencyTitles = context.automaticCodex.filter((item) => item.source === 'dependency').map((item) => item.title)
      throw new Error(`Context is too large: ~${diagnostics.requestTokens.toLocaleString()} input tokens for a ${diagnostics.usableInputTokens.toLocaleString()}-token usable Chat budget (${diagnostics.effectiveContextTokens.toLocaleString()} effective limit, ${diagnostics.responseReserveTokens.toLocaleString()} reserved for the response). Reduce Chat context, summarize older material, raise the cap, or choose a larger model.${dependencyTitles.length ? ` Dependency cascade includes: ${dependencyTitles.join(', ')}.` : ''}`)
    }
    if (diagnostics.warning) {
      const dependencyTitles = context.automaticCodex.filter((item) => item.source === 'dependency').map((item) => item.title)
      onToast(`Chat context is near the configured limit (${Math.round(diagnostics.usageRatio * 100)}%). Consider reducing selected context or raising the cap.${dependencyTitles.length ? ` Dependency cascade includes: ${dependencyTitles.join(', ')}.` : ''}`)
    }
    assertGenerationOwnerCurrent(owner, activeChat)
    return prepared
  }

  async function runAssistantGeneration(
    activeChat: ChatEntity,
    history: ChatMessageEntity[],
    reservedOwner?: ChatGenerationOwner,
    preparedInputs?: PreparedAssistantGeneration,
  ) {
    const candidateOwner = reservedOwner ?? reserveGeneration(activeChat)
    if (!candidateOwner) {
      if (isCurrentChat(activeChat)) onToast('This Chat already has a generation finishing. Try again when it completes.')
      return
    }
    const owner: ChatGenerationOwner = candidateOwner
    const controller = owner.controller
    const sourceBookId = activeChat.bookId
    let completed = false
    let unexpectedFailure = false
    let historyInvalidated = false
    let activeRoundContent = ''
    let activeRoundThoughts = ''
    let activeRoundExtras: Pick<ChatMessageEntity, 'documentEdits' | 'codexCreations' | 'outlineActions' | 'entityActions'> = {}
    let activeRoundPersisted = false
    let activeRoundStartedAt = Date.now()

    async function ensureSourceHistoryStillCurrent() {
      const durableHistory = await listChatMessages(sourceBookId, activeChat.id)
      if (chatHistoryPrefixMatches(history, durableHistory)) return
      historyInvalidated = true
      controller.abort()
      throw new Error('Chat history changed while this response was generating. The streamed reply was not saved.')
    }

    async function persistAssistantRound(
      roundContent: string,
      roundThoughts: string,
      extras: Pick<ChatMessageEntity, 'documentEdits' | 'codexCreations' | 'outlineActions' | 'entityActions'> = {},
      status: ChatMessageStatus = 'complete',
    ) {
      const hasWorkspaceProposal = Boolean(extras.documentEdits?.length || extras.codexCreations?.length || extras.outlineActions?.length || extras.entityActions?.length)
      if (roundContent || roundThoughts || hasWorkspaceProposal) await ensureSourceHistoryStillCurrent()
      if (!roundContent && !roundThoughts && !hasWorkspaceProposal) return null
      return createChatMessage(activeChat, 'assistant', roundContent, {
        thoughts: roundThoughts || undefined,
        status,
        documentEdits: extras.documentEdits,
        codexCreations: extras.codexCreations,
        outlineActions: extras.outlineActions,
        entityActions: extras.entityActions,
      })
    }

    function workspaceProposalIds(extras: Pick<ChatMessageEntity, 'documentEdits' | 'codexCreations' | 'outlineActions' | 'entityActions'>) {
      return [
        ...(extras.documentEdits ?? []).map((proposal) => `document:${proposal.id}`),
        ...(extras.codexCreations ?? []).map((proposal) => `codex:${proposal.id}`),
        ...(extras.outlineActions ?? []).map((proposal) => `outline:${proposal.id}`),
        ...(extras.entityActions ?? []).map((proposal) => `entity:${proposal.id}`),
      ].sort().join('|')
    }

    async function findAlreadyPersistedRound() {
      const expectedProposalIds = workspaceProposalIds(activeRoundExtras)
      const persisted = await listChatMessages(sourceBookId, activeChat.id)
      return [...persisted].reverse().find((message) => message.role === 'assistant'
        && message.createdAt >= activeRoundStartedAt
        && message.content === activeRoundContent
        && (message.thoughts ?? '') === activeRoundThoughts
        && workspaceProposalIds(message) === expectedProposalIds) ?? null
    }

    function commitVisibleRound(saved: ChatMessageEntity | null, hadThoughts: boolean) {
      if (!generationOwnsCurrentUi(owner)) return
      if (saved) {
        setMessages((current) => current.some((message) => message.id === saved.id) ? current : [...current, saved])
        if (hadThoughts && liveThoughtsOpen) {
          setOpenThoughtMessageIds((current) => {
            const next = new Set(current)
            next.add(saved.id)
            return next
          })
        }
      }
      setStreamedContent('')
      setStreamedThoughts('')
    }

    async function persistInterruptedRound(status: Exclude<ChatMessageStatus, 'complete'>) {
      if (activeRoundPersisted) return
      const existing = await findAlreadyPersistedRound()
      if (existing) {
        activeRoundPersisted = true
        const saved = existing.status === status ? existing : await updateChatMessage(existing.id, { status })
        commitVisibleRound(saved, Boolean(activeRoundThoughts))
        return
      }
      const saved = await persistAssistantRound(activeRoundContent, activeRoundThoughts, activeRoundExtras, status)
      activeRoundPersisted = Boolean(saved)
      commitVisibleRound(saved, Boolean(activeRoundThoughts))
    }

    try {
      const prepared = preparedInputs ?? await prepareAssistantGeneration(activeChat, history, owner)
      assertGenerationOwnerCurrent(owner, activeChat)
      const { settings } = prepared
      let workingRequest = buildProviderRequest(activeChat, history, prepared)
      for (let round = 0; round < 8 && !controller.signal.aborted; round += 1) {
        const roundDiagnostics = generationContextDiagnostics(activeChat.model, activeChat.modelContextLength, activeChat.effectiveContextLimit, serializeChatModelInput(workingRequest))
        if (!roundDiagnostics.limitValid) throw new Error(roundDiagnostics.limitError ?? 'The Chat context cap is invalid.')
        if (!roundDiagnostics.fits) throw new Error(`Chat context exceeded its usable budget after workspace tool results (~${roundDiagnostics.requestTokens.toLocaleString()} / ${roundDiagnostics.usableInputTokens.toLocaleString()} input tokens). Reduce context or raise the cap; Arc will not remove older turns automatically.`)
        activeRoundContent = ''
        activeRoundThoughts = ''
        activeRoundExtras = {}
        activeRoundPersisted = false
        activeRoundStartedAt = Date.now()
        const result = await streamChatCompletion({
          apiKey: settings.apiKey.trim(),
          baseUrl: settings.baseUrl,
          provider: settings.provider,
          model: activeChat.model,
          normalizedRequest: workingRequest,
          thinking: activeChat.thinking,
        }, (chunk) => {
          if (!generationOwnsCurrentUi(owner)) return
          if (chunk.thoughts) {
            activeRoundThoughts += chunk.thoughts
            setStreamedThoughts(activeRoundThoughts)
            if (!activeRoundContent) setOwnedGenerationPhase(owner, 'thinking')
          }
          if (chunk.content) {
            activeRoundContent += chunk.content
            setStreamedContent(activeRoundContent)
            setOwnedGenerationPhase(owner, 'writing')
          }
        }, controller.signal, () => {
          if (!controller.signal.aborted) setOwnedGenerationPhase(owner, 'thinking')
        })

        if (controller.signal.aborted || !ownsChatGeneration(generationOwnersRef.current, owner)) break
        if (result.toolCalls.length) {
          setOwnedGenerationPhase(owner, 'using-tools')
          workingRequest = appendNormalizedRequestPart(workingRequest, normalizeRuntimeMessagePart({
            id: `chat-tool-call-${round}`,
            sourceKind: 'history',
            sourceId: `chat-tool-call-${round}`,
            name: 'Assistant tool call',
            ownership: 'conversation',
            message: {
              role: 'assistant',
              content: activeRoundContent || null,
              ...(activeRoundThoughts ? { reasoning_content: activeRoundThoughts } : {}),
              tool_calls: result.toolCalls,
            },
          }))
          const roundProposals: ChatDocumentEditProposal[] = []
          const roundCodexCreations: ChatCodexCreationProposal[] = []
          const roundOutlineActions: ChatOutlineActionProposal[] = []
          const roundEntityActions: ChatEntityActionProposal[] = []
          for (const call of result.toolCalls) {
            if (chatOutlineToolNames.has(call.function.name)) {
              const execution = await executeChatOutlineTool(sourceBookId, call)
              if (execution.outlineAction) {
                roundOutlineActions.push(execution.outlineAction)
                activeRoundExtras.outlineActions = roundOutlineActions
              }
              workingRequest = appendNormalizedRequestPart(workingRequest, normalizeRuntimeMessagePart({ id: `chat-tool-result-${call.id}`, sourceKind: 'app-managed', sourceId: call.id, name: call.function.name, ownership: 'app-managed', message: { role: 'tool', tool_call_id: call.id, content: execution.content } }))
            } else if (chatEntityToolNames.has(call.function.name)) {
              const execution = await executeChatEntityTool(sourceBookId, call)
              if (execution.entityAction) {
                roundEntityActions.push(execution.entityAction)
                activeRoundExtras.entityActions = roundEntityActions
              }
              workingRequest = appendNormalizedRequestPart(workingRequest, normalizeRuntimeMessagePart({ id: `chat-tool-result-${call.id}`, sourceKind: 'app-managed', sourceId: call.id, name: call.function.name, ownership: 'app-managed', message: { role: 'tool', tool_call_id: call.id, content: execution.content } }))
            } else {
              const execution = await executeChatWorkspaceTool(sourceBookId, call)
              if (execution.proposal) {
                roundProposals.push(execution.proposal)
                activeRoundExtras.documentEdits = roundProposals
              }
              if (execution.codexCreation) {
                roundCodexCreations.push(execution.codexCreation)
                activeRoundExtras.codexCreations = roundCodexCreations
              }
              workingRequest = appendNormalizedRequestPart(workingRequest, normalizeRuntimeMessagePart({ id: `chat-tool-result-${call.id}`, sourceKind: 'app-managed', sourceId: call.id, name: call.function.name, ownership: 'app-managed', message: { role: 'tool', tool_call_id: call.id, content: execution.content } }))
            }
          }

          const saved = await persistAssistantRound(activeRoundContent, activeRoundThoughts, activeRoundExtras)
          activeRoundPersisted = Boolean(saved)
          commitVisibleRound(saved, Boolean(activeRoundThoughts))
          if (controller.signal.aborted) break
          setOwnedGenerationPhase(owner, 'thinking')
          continue
        }

        const saved = await persistAssistantRound(activeRoundContent, activeRoundThoughts)
        activeRoundPersisted = Boolean(saved)
        commitVisibleRound(saved, Boolean(activeRoundThoughts))
        if (saved?.content && settings.speech.readAloudAfterGeneration) {
          void startTtsSession(settings.speech, saved.content, `Chat · ${activeChat.title}`).catch((error) => onToast(error instanceof Error ? error.message : 'Automatic read aloud failed.'))
        }
        completed = true
        break
      }
      if (!completed && !controller.signal.aborted) throw new Error('The assistant used too many workspace tool steps. Ask it to make a smaller edit.')
    } catch (error) {
      const aborted = controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')
      if (historyInvalidated) {
        onToast(error instanceof Error ? error.message : 'Chat history changed while this response was generating. The streamed reply was not saved.')
      } else if (!aborted) {
        unexpectedFailure = true
        onToast(error instanceof Error ? error.message : 'Chat generation stopped unexpectedly.')
      }
    } finally {
      const stopped = controller.signal.aborted
      if (!historyInvalidated && !activeRoundPersisted && (stopped || unexpectedFailure)) {
        try {
          await persistInterruptedRound(stopped ? 'stopped' : 'failed')
        } catch {
          // Keep the already streamed partial visible until teardown even if persistence fails.
        }
      }
      finishGenerationOwner(owner)
      const refreshed = await getChat(activeChat.id).catch(() => undefined)
      if (refreshed?.bookId === sourceBookId) applyIfCurrentChat(activeChat, () => setChat(refreshed))
    }
  }

  async function send() {
    if (!chat || generating || !isCurrentChat(chat)) return
    const sourceChat = chat
    const text = draft.trim()
    if (!text) return

    const owner = createChatGenerationOwner(sourceChat.bookId, sourceChat.id)
    if (!registerChatGeneration(generationOwnersRef.current, owner)) {
      onToast('This Chat already has a generation finishing. Try again when it completes.')
      return
    }
    beginGenerationUi(owner)
    setDraft('')
    let persisted = false

    try {
      await runChatSendPipeline({
        preflight: async () => {
          const durableHistory = await listChatMessages(sourceChat.bookId, sourceChat.id)
          assertGenerationOwnerCurrent(owner, sourceChat)
          const previewHistory: ChatRequestHistoryItem[] = [...durableHistory, { role: 'user', content: text }]
          const prepared = await prepareAssistantGeneration(sourceChat, previewHistory, owner)
          return { durableHistory, prepared }
        },
        persist: async ({ durableHistory }) => {
          assertGenerationOwnerCurrent(owner, sourceChat)
          const userMessage = await createChatMessage(sourceChat, 'user', text)
          persisted = true
          const history = [...durableHistory, userMessage]
          if (generationOwnsCurrentUi(owner)) {
            setMessages(history)
            setChat(sourceChat)
          }
          return { history }
        },
        generate: async ({ prepared }, { history }) => {
          await runAssistantGeneration(sourceChat, history, owner, prepared)
        },
        onPostPersistError: (error) => {
          finishGenerationOwner(owner)
          if (!(error instanceof DOMException && error.name === 'AbortError')) {
            onToast(error instanceof Error ? error.message : 'Chat generation stopped unexpectedly.')
          }
        },
      })
    } catch (error) {
      finishGenerationOwner(owner)
      if (!persisted) applyIfCurrentChat(sourceChat, () => setDraft(text))
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        onToast(error instanceof Error ? error.message : 'Could not send the message.')
      }
    }
  }

  function stop() {
    const owner = getChatGenerationOwner(generationOwnersRef.current, selectedBookIdRef.current, selectedChatIdRef.current)
    if (!owner) return
    setOwnedGenerationPhase(owner, 'stopping')
    abortChatGeneration(generationOwnersRef.current, owner.bookId, owner.chatId)
  }

  async function deleteFrom(message: ChatMessageEntity) {
    if (generating) { onToast('Stop the current response before deleting Chat history.'); return }
    if (!chat || !isCurrentChat(chat) || !window.confirm('Delete this message and everything after it in this chat?')) return
    const sourceChat = chat
    try {
      await deleteMessageAndFollowing(sourceChat.bookId, sourceChat.id, message.order)
      if (isCurrentChat(sourceChat)) await reloadMessages()
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not delete the message.')
    }
  }

  function beginEdit(message: ChatMessageEntity) {
    if (generating) { onToast('Stop the current response before editing Chat history.'); return }
    setEditingId(message.id)
    setEditingValue(message.content)
  }

  async function saveEdit(message: ChatMessageEntity, regenerate: boolean) {
    if (generating) { onToast('Stop the current response before saving a Chat history edit.'); return }
    if (!chat || !isCurrentChat(chat) || !editingValue.trim()) return
    const sourceChat = chat
    try {
      const updated = await updateChatMessage(message.id, { content: editingValue.trim() })
      if (!isCurrentChat(sourceChat)) return
      setEditingId('')
      if (regenerate && message.role === 'user') {
        await deleteMessageAndFollowing(sourceChat.bookId, sourceChat.id, message.order + 1)
        const history = (await listChatMessages(sourceChat.bookId, sourceChat.id)).filter((item) => item.order <= updated.order)
        if (!isCurrentChat(sourceChat)) return
        setMessages(history)
        await runAssistantGeneration(sourceChat, history)
      } else {
        await reloadMessages()
      }
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not edit the message.')
    }
  }

  async function regenerate(message: ChatMessageEntity) {
    if (!chat || !isCurrentChat(chat) || message.role !== 'assistant' || generating) return
    const sourceChat = chat
    try {
      await deleteMessageAndFollowing(sourceChat.bookId, sourceChat.id, message.order)
      const history = (await listChatMessages(sourceChat.bookId, sourceChat.id)).filter((item) => item.order < message.order)
      if (!isCurrentChat(sourceChat)) return
      setMessages(history)
      await runAssistantGeneration(sourceChat, history)
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not regenerate the message.')
    }
  }

  async function fork(message: ChatMessageEntity) {
    if (!chat || !isCurrentChat(chat)) return
    const sourceChat = chat
    try {
      const forked = await forkChat(sourceChat, message.order)
      if (isCurrentChat(sourceChat) && forked.bookId === sourceChat.bookId) onChatChange(forked.id)
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not fork the chat.')
    }
  }

  async function applyProposal(message: ChatMessageEntity, proposal: ChatDocumentEditProposal) {
    try {
      await applyChatDocumentEdit(message.id, proposal.id)
      await reloadMessages()
      onToast(`Applied changes to “${proposal.entityTitle}”.`)
    } catch (error) {
      await reloadMessages().catch(() => undefined)
      onToast(error instanceof Error ? error.message : 'Could not apply the proposed edit.')
    }
  }

  async function rejectProposal(message: ChatMessageEntity, proposal: ChatDocumentEditProposal) {
    try {
      await rejectChatDocumentEdit(message.id, proposal.id)
      await reloadMessages()
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not reject the proposed edit.')
    }
  }

  async function createCodexProposal(message: ChatMessageEntity, proposal: ChatCodexCreationProposal) {
    try {
      await createChatCodexEntry(message.id, proposal.id)
      await reloadMessages()
      onToast(`Created Codex entry “${proposal.title}”.`)
    } catch (error) {
      await reloadMessages().catch(() => undefined)
      onToast(error instanceof Error ? error.message : 'Could not create the proposed Codex entry.')
    }
  }

  async function rejectCodexProposal(message: ChatMessageEntity, proposal: ChatCodexCreationProposal) {
    try {
      await rejectChatCodexEntry(message.id, proposal.id)
      await reloadMessages()
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not reject the Codex proposal.')
    }
  }

  async function applyEntityProposal(message: ChatMessageEntity, proposal: ChatEntityActionProposal) {
    try {
      await applyChatEntityAction(message.id, proposal.id)
      await reloadMessages()
      const verb = proposal.action === 'create_note' ? 'Created' : proposal.action === 'rename' ? 'Renamed' : proposal.action === 'delete' ? 'Deleted' : 'Updated'
      onToast(`${verb} “${proposal.entityTitle}”.`)
    } catch (error) {
      await reloadMessages().catch(() => undefined)
      onToast(error instanceof Error ? error.message : 'Could not apply the entity proposal.')
    }
  }

  async function rejectEntityProposal(message: ChatMessageEntity, proposal: ChatEntityActionProposal) {
    try {
      await rejectChatEntityAction(message.id, proposal.id)
      await reloadMessages()
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not reject the entity proposal.')
    }
  }

  async function copyMessage(message: ChatMessageEntity) {
    if (!message.content) return
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(message.content)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = message.content
        textarea.setAttribute('readonly', '')
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        const copied = document.execCommand('copy')
        textarea.remove()
        if (!copied) throw new Error('Copy command was not accepted.')
      }
      setCopiedMessageId(message.id)
      if (copyResetRef.current) clearTimeout(copyResetRef.current)
      copyResetRef.current = setTimeout(() => {
        setCopiedMessageId((current) => current === message.id ? '' : current)
        copyResetRef.current = null
      }, 1600)
    } catch {
      onToast('Could not copy this message to the clipboard.')
    }
  }

  async function applyOutlineProposal(message: ChatMessageEntity, proposal: ChatOutlineActionProposal) {
    try {
      await applyChatOutlineAction(message.id, proposal.id)
      await reloadMessages()
      onToast(`Approved ${proposal.action} for “${proposal.entityTitle}”.`)
    } catch (error) {
      await reloadMessages().catch(() => undefined)
      onToast(error instanceof Error ? error.message : 'Could not apply the outline proposal.')
    }
  }

  async function rejectOutlineProposal(message: ChatMessageEntity, proposal: ChatOutlineActionProposal) {
    try {
      await rejectChatOutlineAction(message.id, proposal.id)
      await reloadMessages()
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not reject the outline proposal.')
    }
  }

  function setPersistedThoughtsOpen(messageId: string, open: boolean) {
    setOpenThoughtMessageIds((current) => {
      const next = new Set(current)
      if (open) next.add(messageId)
      else next.delete(messageId)
      return next
    })
  }

  function jumpToLatest() {
    followOutputRef.current = true
    setFollowOutput(true)
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }

  async function readAloud(message: ChatMessageEntity) {
    if (!chat || !isCurrentChat(chat) || !message.content.trim()) return
    const sourceChat = chat
    try {
      const settings = await getChatBookAiSettings(sourceChat.bookId)
      if (!isCurrentChat(sourceChat)) return
      await startTtsSession(settings.speech, message.content, `Chat · ${sourceChat.title}`)
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not start text to speech.')
    }
  }

  if (!chatId) return <section className="conversation chat-empty"><MessageCircle aria-hidden="true" /><strong>No chat selected</strong><p>Create or open a chat from the Chat panel.</p></section>
  if (!chat || !isCurrentChat(chat)) return <section className="conversation chat-empty"><span className="chat-loading" /> <p>Loading chat…</p></section>

  return <>
    <section className="conversation functional-chat">
      <header><small>Book chat</small><h1>{chat.title}</h1></header>
      <div className="messages">
        {!messages.length && !generating && <div className="chat-first-message"><Feather aria-hidden="true" /><strong>Start this conversation</strong><p>The model, prompt, and context are saved independently for this chat.</p></div>}
        {messages.map((message) => <article className={`message ${message.role === 'user' ? 'user' : 'bot no-thumb'}`} key={message.id}>
          {message.role === 'assistant' ? <div className="chat-message-stack">
            {editingId === message.id ? <InlineMessageEdit value={editingValue} onChange={setEditingValue} onCancel={() => setEditingId('')} onSave={() => { void saveEdit(message, false) }} /> : <>
              {message.thoughts && <details className="chat-thoughts" open={openThoughtMessageIds.has(message.id)} onToggle={(event) => setPersistedThoughtsOpen(message.id, event.currentTarget.open)}><summary>Thoughts</summary><div>{message.thoughts}</div></details>}
              <div className="bubble chat-markdown-bubble">{message.content ? <MarkdownMessage content={message.content} /> : (message.documentEdits?.length || message.codexCreations?.length || message.outlineActions?.length || message.entityActions?.length ? <em>Workspace proposal</em> : <em>No final answer returned.</em>)}</div>
              {message.documentEdits?.length ? <div className="chat-document-edits">{message.documentEdits.map((proposal) => <DocumentEditCard key={proposal.id} proposal={proposal} onApply={() => { void applyProposal(message, proposal) }} onReject={() => { void rejectProposal(message, proposal) }} />)}</div> : null}
              {message.codexCreations?.length ? <div className="chat-document-edits">{message.codexCreations.map((proposal) => <CodexCreationCard key={proposal.id} proposal={proposal} onCreate={() => { void createCodexProposal(message, proposal) }} onReject={() => { void rejectCodexProposal(message, proposal) }} />)}</div> : null}
              {message.outlineActions?.length ? <div className="chat-document-edits">{message.outlineActions.map((proposal) => <OutlineActionCard key={proposal.id} proposal={proposal} onApply={() => { void applyOutlineProposal(message, proposal) }} onReject={() => { void rejectOutlineProposal(message, proposal) }} />)}</div> : null}
              {message.entityActions?.length ? <div className="chat-document-edits">{message.entityActions.map((proposal) => <EntityActionCard key={proposal.id} proposal={proposal} onApply={() => { void applyEntityProposal(message, proposal) }} onReject={() => { void rejectEntityProposal(message, proposal) }} />)}</div> : null}
              {message.status && message.status !== 'complete' && <small className="chat-message-status">{message.status === 'failed' ? 'Interrupted' : 'Stopped'}</small>}
              <div className="message-tools"><button type="button" onClick={() => { void copyMessage(message) }}>{copiedMessageId === message.id ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />} {copiedMessageId === message.id ? 'Copied' : 'Copy'}</button><button type="button" disabled={generating} title={generating ? 'Stop the current response before editing history' : undefined} onClick={() => beginEdit(message)}><Pencil aria-hidden="true" /> Edit</button><button type="button" onClick={() => { void fork(message) }}><GitFork aria-hidden="true" /> Fork</button><button type="button" onClick={() => { void readAloud(message) }}><Volume2 aria-hidden="true" /> Read aloud</button><button type="button" onClick={() => { void regenerate(message) }}><RefreshCw aria-hidden="true" /> Regenerate</button><button type="button" disabled={generating} title={generating ? 'Stop the current response before deleting history' : undefined} onClick={() => { void deleteFrom(message) }}><Trash2 aria-hidden="true" /> Delete</button></div>
            </>}
          </div> : editingId === message.id ? <InlineMessageEdit value={editingValue} onChange={setEditingValue} onCancel={() => setEditingId('')} onSave={() => { void saveEdit(message, false) }} onSaveAndRegenerate={() => { void saveEdit(message, true) }} /> : <>
            <div className="bubble chat-markdown-bubble"><MarkdownMessage content={message.content} /></div>
            <div className="message-tools"><button type="button" onClick={() => { void copyMessage(message) }}>{copiedMessageId === message.id ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />} {copiedMessageId === message.id ? 'Copied' : 'Copy'}</button><button type="button" disabled={generating} title={generating ? 'Stop the current response before editing history' : undefined} onClick={() => beginEdit(message)}><Pencil aria-hidden="true" /> Edit</button><button type="button" disabled={generating} title={generating ? 'Stop the current response before deleting history' : undefined} onClick={() => { void deleteFrom(message) }}><Trash2 aria-hidden="true" /> Delete</button></div>
          </>}
        </article>)}
        {generating && <article className="message bot no-thumb streaming"><div className="chat-message-stack chat-live-generation">
          <div className="chat-live-status"><i /><span>{generationPhaseLabel(phase)} · {formatElapsed(elapsed)}</span></div>
          {streamedThoughts && <details className="chat-thoughts" open={liveThoughtsOpen} onToggle={(event) => setLiveThoughtsOpen(event.currentTarget.open)}><summary>Thoughts</summary><div>{streamedThoughts}</div></details>}
          {streamedContent && <div className="bubble chat-markdown-bubble"><MarkdownMessage content={streamedContent} /></div>}
        </div></article>}
        <div ref={bottomRef} />
      </div>
    </section>

    {generating && !followOutput && <button className="chat-follow-output" type="button" onClick={jumpToLatest}>↓ New content</button>}

    <section className="chat-composer functional-chat-composer">
      <details className="chat-config-strip">
        <summary><span>Generation settings</span><small>Model · context · system prompt</small><ChevronDown aria-hidden="true" /></summary>
        <div className="chat-config-row">
          <ChatModelPicker value={chat.model} models={sortedModels} onChange={(modelId) => { void changeModel(modelId) }} />
          <label className={`chat-context-limit ${contextLimitInputError(limitDraft) ? 'invalid' : ''}`}><span>Context cap</span><input value={limitDraft} onChange={(event) => setLimitDraft(event.target.value)} onBlur={() => { void saveEffectiveContextLimit() }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} placeholder="Model max" inputMode="text" aria-label="Chat effective context cap" /><small>{contextLimitInputError(limitDraft) || 'Empty uses the model maximum. 32k / 1m supported.'}</small></label>
          <button className="chat-system-prompt-button" type="button" onClick={() => { setPromptDraft(chat.systemPrompt); setPromptOpen(true) }}><Bot aria-hidden="true" /><span>System prompt</span></button>
          {modelStatus && <small className="chat-model-status">{modelStatus}</small>}
        </div>
      </details>
      <div className="chat-compose-row">
        <ExpandableTextInput ref={inputRef} value={draft} onChange={setDraft} readOnly={sttState.target === 'chat' && ['requesting-permission', 'recording', 'recording-live', 'stopping', 'transcribing', 'finalizing'].includes(sttState.status)} onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void send()
          }
        }} placeholder="Ask about the book…" aria-label="Chat message" dialogTitle="Write chat message" />
        <ChatGenerateButton generating={generating} phase={phase} elapsed={elapsed} thinking={chat.thinking} onGenerate={() => { void send() }} onStop={stop} onMicro={() => { void dictateMessage() }} onThinking={setThinking} />
      </div>
    </section>

    {promptOpen && <div className="chat-prompt-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setPromptOpen(false) }}>
      <section className="chat-prompt-dialog" role="dialog" aria-modal="true" aria-labelledby="chat-prompt-title">
        <header><div><small>Current chat</small><h2 id="chat-prompt-title">System prompt</h2></div><button type="button" onClick={() => setPromptOpen(false)} aria-label="Close system prompt"><X aria-hidden="true" /></button></header>
        <textarea value={promptDraft} onChange={(event) => setPromptDraft(event.target.value)} spellCheck={false} />
        <footer><span>Saved only for this chat.</span><div><button type="button" onClick={() => { setPromptDraft(chat.systemPrompt); setPromptOpen(false) }}>Cancel</button><button className="primary" type="button" onClick={() => { void savePrompt() }}>Save</button></div></footer>
      </section>
    </div>}
  </>
}

function MarkdownMessage({ content }: { content: string }) {
  return <div className="chat-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></div>
}

function ChatModelPicker({ value, models, onChange }: { value: string; models: ChatModel[]; onChange: (modelId: string) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const normalized = query.trim().toLowerCase()
  const visible = models.filter((model) => !normalized || `${model.id} ${model.name ?? ''}`.toLowerCase().includes(normalized)).slice(0, 80)
  const selected = models.find((model) => model.id === value)
  const selectedLabel = selected?.name && selected.name !== selected.id ? selected.name : selected?.id || value || 'Choose model'

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  function choose(modelId: string) {
    onChange(modelId)
    setOpen(false)
    setQuery('')
  }

  return <div className={`chat-model-picker ${open ? 'open' : ''}`} ref={rootRef}>
    <button className="chat-model-selector" type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => {
      setOpen((current) => !current)
      setQuery('')
    }}>
      <span>Model</span><strong title={value}>{selectedLabel}</strong><ChevronDown aria-hidden="true" />
    </button>
    {open && <section className="chat-model-menu" aria-label="Choose chat model">
      <label className="chat-model-search"><Search aria-hidden="true" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Escape') { setOpen(false); setQuery(''); return }
        if (event.key === 'Enter' && visible[0]) { event.preventDefault(); choose(visible[0].id) }
      }} placeholder="Search models by name or ID" aria-label="Search chat models" /></label>
      <div className="chat-model-options" role="listbox" aria-label="Available chat models">
        {value && !models.some((model) => model.id === value) && !normalized && <button type="button" className="selected" role="option" aria-selected="true" onClick={() => choose(value)}><span><strong>{value}</strong><small>Current model · not in loaded list</small></span><b>Current</b></button>}
        {visible.map((model) => {
          const isSelected = model.id === value
          return <button type="button" className={isSelected ? 'selected' : ''} role="option" aria-selected={isSelected} onClick={() => choose(model.id)} key={model.id}><span><strong>{model.name || model.id}</strong>{model.name && model.name !== model.id && <small>{model.id}</small>}</span>{isSelected && <b>Current</b>}</button>
        })}
        {!visible.length && <p>No models match “{query.trim()}”.</p>}
      </div>
    </section>}
  </div>
}

function EntityActionCard({ proposal, onApply, onReject }: { proposal: ChatEntityActionProposal; onApply: () => void; onReject: () => void }) {
  const actionLabel = proposal.action === 'create_note' ? 'Create' : proposal.action === 'rename' ? 'Rename' : proposal.action === 'delete' ? 'Delete' : 'Change category'
  const typeLabel = proposal.entityType === 'book' ? 'Book' : proposal.entityType === 'codexEntry' ? 'Codex' : 'Note'
  const statusLabel = proposal.status === 'proposed' ? 'Needs approval' : proposal.status === 'applying' ? 'Applying…' : proposal.status === 'applied' ? 'Applied' : proposal.status === 'stale' ? 'Item changed' : 'Rejected'
  return <section className={`chat-document-edit chat-entity-action ${proposal.action} ${proposal.status}`}>
    <header><div><small>{actionLabel} {typeLabel}</small><strong>{proposal.entityTitle}</strong></div><span>{statusLabel}</span></header>
    {proposal.summary && <p>{proposal.summary}</p>}
    <div className="chat-entity-action-body">
      {proposal.action === 'create_note' && <><p>Create a new Note.</p>{proposal.content && <details><summary>View initial content</summary><pre>{proposal.content}</pre></details>}</>}
      {proposal.action === 'rename' && <p><span>{proposal.entityTitle}</span><b>→</b><strong>{proposal.newTitle}</strong></p>}
      {proposal.action === 'set_codex_category' && <p><span>{proposal.previousCategory || 'Other'}</span><b>→</b><strong>{proposal.category}</strong></p>}
      {proposal.action === 'delete' && <p>Delete this {typeLabel.toLowerCase()} and its stored content ({proposal.contentLength ?? 0} characters).</p>}
    </div>
    {proposal.status === 'proposed' && <footer><button type="button" onClick={onReject}>Reject</button><button className={proposal.action === 'delete' ? 'danger' : 'primary'} type="button" onClick={onApply}>{actionLabel}</button></footer>}
  </section>
}

function OutlineActionCard({ proposal, onApply, onReject }: { proposal: ChatOutlineActionProposal; onApply: () => void; onReject: () => void }) {
  const actionLabel = proposal.action === 'create' ? 'Create' : proposal.action === 'rename' ? 'Rename' : proposal.action === 'move' ? 'Move' : 'Delete'
  const statusLabel = proposal.status === 'proposed' ? 'Needs approval' : proposal.status === 'applying' ? 'Applying…' : proposal.status === 'applied' ? 'Applied' : proposal.status === 'stale' ? 'Outline changed' : 'Rejected'
  const typeLabel = proposal.entityType[0].toUpperCase() + proposal.entityType.slice(1)
  return <section className={`chat-document-edit chat-outline-action ${proposal.action} ${proposal.status}`}>
    <header><div><small>{actionLabel} {typeLabel}</small><strong>{proposal.entityTitle}</strong></div><span>{statusLabel}</span></header>
    {proposal.summary && <p>{proposal.summary}</p>}
    <div className="chat-outline-action-body">
      {proposal.action === 'create' && <><p>Create under <strong>{proposal.targetParentTitle || 'target parent'}</strong>.</p>{proposal.initialContent && <details><summary>View initial Scene content</summary><pre>{proposal.initialContent}</pre></details>}</>}
      {proposal.action === 'rename' && <p><span>{proposal.entityTitle}</span><b>→</b><strong>{proposal.newTitle}</strong></p>}
      {proposal.action === 'move' && <p>Move to <strong>{proposal.targetParentTitle || 'target parent'}</strong>{proposal.beforeTitle ? <> before <strong>{proposal.beforeTitle}</strong></> : <> at the end</>}.</p>}
      {proposal.action === 'delete' && <p>Delete this item and its empty descendants. Non-empty Scene content blocks deletion.</p>}
    </div>
    {proposal.status === 'proposed' && <footer><button type="button" onClick={onReject}>Reject</button><button className={proposal.action === 'delete' ? 'danger' : 'primary'} type="button" onClick={onApply}>{actionLabel}</button></footer>}
  </section>
}

function CodexCreationCard({ proposal, onCreate, onReject }: { proposal: ChatCodexCreationProposal; onCreate: () => void; onReject: () => void }) {
  const statusLabel = proposal.status === 'proposed' ? 'Ready to create' : proposal.status === 'applying' ? 'Creating…' : proposal.status === 'created' ? 'Created' : proposal.status === 'duplicate' ? 'Already exists' : proposal.status === 'stale' ? 'Historical' : 'Rejected'
  return <section className={`chat-document-edit chat-codex-creation ${proposal.status}`}>
    <header><div><small>New Codex · {proposal.category}</small><strong>{proposal.title}</strong></div><span>{statusLabel}</span></header>
    {proposal.summary && <p>{proposal.summary}</p>}
    <details><summary>View entry</summary><div className="chat-document-diff"><pre className="new">{proposal.content || '[empty entry]'}</pre></div></details>
    {proposal.status === 'proposed' && <footer><button type="button" onClick={onReject}>Reject</button><button className="primary" type="button" onClick={onCreate}>Create</button></footer>}
  </section>
}

function DocumentEditCard({ proposal, onApply, onReject }: { proposal: ChatDocumentEditProposal; onApply: () => void; onReject: () => void }) {
  const statusLabel = proposal.status === 'proposed' ? 'Ready to apply' : proposal.status === 'applying' ? 'Applying…' : proposal.status === 'applied' ? 'Applied' : proposal.status === 'stale' ? 'Document changed' : 'Rejected'
  return <section className={`chat-document-edit ${proposal.status}`}>
    <header><div><small>${proposal.entityType === 'codexEntry' ? 'Codex' : proposal.entityType === 'scene' ? 'Scene' : 'Note'}</small><strong>{proposal.entityTitle}</strong></div><span>{statusLabel}</span></header>
    {proposal.summary && <p>{proposal.summary}</p>}
    <details><summary>View changes</summary><div className="chat-document-diff">
      {proposal.mode === 'replace_document' ? <><small>Whole document replacement</small><pre className="new">{proposal.newContent}</pre></> : proposal.edits?.map((edit, index) => <section key={index}><small>Change {index + 1}</small><pre className="old">{edit.oldText}</pre><pre className="new">{edit.newText || '[delete]'}</pre></section>)}
    </div></details>
    {proposal.status === 'proposed' && <footer><button type="button" onClick={onReject}>Reject</button><button className="primary" type="button" onClick={onApply}>Apply</button></footer>}
  </section>
}

function InlineMessageEdit({ value, onChange, onCancel, onSave, onSaveAndRegenerate }: {
  value: string
  onChange: (value: string) => void
  onCancel: () => void
  onSave: () => void
  onSaveAndRegenerate?: () => void
}) {
  return <div className="inline-edit chat-inline-edit"><ExpandableTextInput value={value} onChange={onChange} autoFocus aria-label="Edit chat message" dialogTitle="Edit chat message" /><div><button type="button" onClick={onCancel}>Cancel</button><button type="button" onClick={onSave}>Save</button>{onSaveAndRegenerate && <button type="button" onClick={onSaveAndRegenerate}>Save & regenerate</button>}</div></div>
}

function ChatGenerateButton({ generating, phase, elapsed, thinking, onGenerate, onStop, onMicro, onThinking }: {
  generating: boolean
  phase: GenerationPhase | null
  elapsed: number
  thinking: boolean
  onGenerate: () => void
  onStop: () => void
  onMicro: () => void
  onThinking: (value: boolean) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const longPressRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }

  if (generating) return <div className="chat-generation-running"><span><i />{generationPhaseLabel(phase)} · {formatElapsed(elapsed)}</span><button className="play generating" type="button" onClick={onStop} aria-label="Stop chat generation"><Square aria-hidden="true" fill="currentColor" /></button></div>

  if (expanded) return <div className="chat-generate-actions" role="toolbar" aria-label="Chat generation actions">
    <button type="button" onClick={onMicro} title="Micro"><Mic aria-hidden="true" /><span>Dictate message</span></button>
    <button type="button" className={thinking ? 'active' : ''} onClick={() => onThinking(!thinking)} title="Thinking"><Bot aria-hidden="true" /><span>Thinking {thinking ? 'on' : 'off'}</span></button>
    <button type="button" onClick={() => setExpanded(false)} aria-label="Collapse chat generation actions"><X aria-hidden="true" /></button>
  </div>

  return <button className="play chat-generate-trigger" type="button" aria-label="Send. Press and hold for more actions." onContextMenu={(event) => event.preventDefault()} onPointerDown={() => {
    longPressRef.current = false
    cancelTimer()
    timerRef.current = setTimeout(() => {
      longPressRef.current = true
      setExpanded(true)
    }, 450)
  }} onPointerUp={cancelTimer} onPointerCancel={cancelTimer} onPointerLeave={cancelTimer} onClick={() => {
    if (longPressRef.current) {
      longPressRef.current = false
      return
    }
    onGenerate()
  }}><Play aria-hidden="true" fill="currentColor" /></button>
}

export function ChatSidebar({ bookId, activeChatId, onOpen }: { bookId: string; activeChatId: string; onOpen: (chatId: string) => void }) {
  const [items, setItems] = useState<ChatEntity[]>([])
  const [query, setQuery] = useState('')
  const bookIdRef = useRef(bookId)
  const activeChatIdRef = useRef(activeChatId)
  const reloadVersionRef = useRef(0)
  bookIdRef.current = bookId
  activeChatIdRef.current = activeChatId

  async function reload(requestBookId = bookId) {
    const requestVersion = ++reloadVersionRef.current
    if (!requestBookId) {
      if (reloadMatchesBookSelection(requestBookId, requestVersion, bookIdRef.current, reloadVersionRef.current)) setItems([])
      return []
    }
    const next = await listChats(requestBookId)
    if (!reloadMatchesBookSelection(requestBookId, requestVersion, bookIdRef.current, reloadVersionRef.current)) return []
    const owned = onlyChatsForBook(next, requestBookId)
    setItems(owned)
    return owned
  }

  useEffect(() => {
    setItems([])
    void reload(bookId)
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<{ bookId?: string }>).detail
      if (!detail?.bookId || detail.bookId === bookId) void reload(bookId)
    }
    window.addEventListener('arc-chat-changed', handle)
    return () => window.removeEventListener('arc-chat-changed', handle)
  }, [bookId])

  const normalized = query.trim().toLowerCase()
  const visible = items.filter((chat) => chat.bookId === bookId && (!normalized || `${chat.title} ${chat.lastMessagePreview ?? ''}`.toLowerCase().includes(normalized)))

  async function add() {
    const sourceBookId = bookId
    if (!sourceBookId) return
    const chat = await createChat(sourceBookId)
    await reload(sourceBookId)
    if (bookIdRef.current === sourceBookId && chat.bookId === sourceBookId) onOpen(chat.id)
  }

  async function rename(chat: ChatEntity) {
    const sourceBookId = chat.bookId
    if (sourceBookId !== bookIdRef.current) return
    const title = window.prompt('Chat title', chat.title)
    if (title === null || !title.trim() || sourceBookId !== bookIdRef.current) return
    await updateChat(chat.id, { title: title.trim() })
    await reload(sourceBookId)
  }

  async function remove(chat: ChatEntity) {
    const sourceBookId = chat.bookId
    if (sourceBookId !== bookIdRef.current || !window.confirm(`Delete “${chat.title}” and its messages?`)) return
    await deleteChat(chat.id)
    await reload(sourceBookId)
    if (bookIdRef.current === sourceBookId && activeChatIdRef.current === chat.id) onOpen('')
  }

  return <section className="chat-sidebar"><div className="panel-title"><div><small>Conversations</small><h2>Chats</h2></div><button type="button" onClick={() => { void add() }} aria-label="Start new chat"><Plus aria-hidden="true" /></button></div>
    <label className="chat-sidebar-search"><Search aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search chats" /></label>
    <div className="chat-sidebar-list">{visible.map((chat) => <article className={`chat-row-wrap ${activeChatId === chat.id ? 'selected' : ''}`} key={chat.id}>
      <button className="chat-row" type="button" onClick={() => { if (chat.bookId === bookIdRef.current) onOpen(chat.id) }}><i><MessageCircle aria-hidden="true" /></i><span><strong>{chat.title}</strong><small>{chat.lastMessagePreview || 'No messages yet'}</small></span><em>{formatChatEdited(chat.updatedAt)}</em></button>
      <div className="chat-row-actions"><button type="button" onClick={() => { void rename(chat) }} aria-label={`Rename ${chat.title}`}><Pencil aria-hidden="true" /></button><button type="button" onClick={() => { void remove(chat) }} aria-label={`Delete ${chat.title}`}><Trash2 aria-hidden="true" /></button></div>
    </article>)}{!visible.length && <p className="content-empty">{query ? 'No matching chats.' : 'No chats yet.'}</p>}</div>
  </section>
}

function formatChatEdited(updatedAt: number) {
  const minutes = Math.max(0, Math.round((Date.now() - updatedAt) / 60_000))
  if (minutes < 1) return 'Now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(updatedAt)
}

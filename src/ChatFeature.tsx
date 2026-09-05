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
import { streamChatCompletion, type ChatCompletionMessage } from './chat-api'
import ExpandableTextInput from './ExpandableTextInput'
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
  type ChatMessageEntity,
  type ChatModel,
  type ChatOutlineActionProposal,
} from './chat-service'
import { buildContextValues, generationContextDiagnostics } from './context-service'
import { bookTemplateValues, renderPromptTemplate, type BookPromptValues } from './prompt-template'
import { applyChatDocumentEdit, chatWorkspaceTools, createChatCodexEntry, executeChatWorkspaceTool, rejectChatCodexEntry, rejectChatDocumentEdit } from './chat-tools'
import { applyChatOutlineAction, chatOutlineToolNames, chatOutlineTools, executeChatOutlineTool, rejectChatOutlineAction } from './chat-outline-tools'
import './chat.css'

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

function section(title: string, content: string) {
  return `# ${title}\n\n${content.trim()}`
}

export function ChatView({ bookId, chatId, bookPromptValues, currentSceneId, onChatChange, onToast }: ChatViewProps) {
  const [chat, setChat] = useState<ChatEntity | null>(null)
  const [messages, setMessages] = useState<ChatMessageEntity[]>([])
  const [draft, setDraft] = useState('')
  const [models, setModels] = useState<ChatModel[]>([])
  const [modelStatus, setModelStatus] = useState('')
  const [promptOpen, setPromptOpen] = useState(false)
  const [promptDraft, setPromptDraft] = useState('')
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
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const startedAtRef = useRef(0)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const followOutputRef = useRef(true)

  const sortedModels = useMemo(() => [...models].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id)), [models])

  useEffect(() => {
    let cancelled = false
    abortRef.current?.abort()
    setGenerating(false)
    setPhase(null)
    setStreamedContent('')
    setStreamedThoughts('')
    setLiveThoughtsOpen(true)
    setOpenThoughtMessageIds(new Set())
    followOutputRef.current = true
    setFollowOutput(true)
    setEditingId('')
    if (!bookId || !chatId) {
      setChat(null)
      setMessages([])
      return () => { cancelled = true }
    }
    ;(async () => {
      try {
        const [loadedChat, loadedMessages, settings] = await Promise.all([
          getChat(chatId),
          listChatMessages(bookId, chatId),
          getChatBookAiSettings(bookId),
        ])
        if (cancelled) return
        if (!loadedChat) {
          setChat(null)
          setMessages([])
          return
        }
        setChat(loadedChat)
        setPromptDraft(loadedChat.systemPrompt)
        setMessages(loadedMessages)
        setModelStatus('Loading models…')
        try {
          const available = await fetchAvailableChatModels(settings)
          if (!cancelled) {
            setModels(available)
            setModelStatus(available.length ? '' : 'The provider returned no models.')
          }
        } catch (error) {
          if (!cancelled) setModelStatus(error instanceof Error ? error.message : 'Could not load models.')
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
    abortRef.current?.abort()
    if (copyResetRef.current) clearTimeout(copyResetRef.current)
  }, [])

  async function reloadMessages() {
    if (!chat) return []
    const next = await listChatMessages(chat.bookId, chat.id)
    setMessages(next)
    const refreshed = await getChat(chat.id)
    if (refreshed) setChat(refreshed)
    return next
  }

  async function changeModel(modelId: string) {
    if (!chat) return
    const selected = models.find((model) => model.id === modelId)
    try {
      const updated = await updateChat(chat.id, { model: modelId, modelContextLength: selected?.context_length })
      setChat(updated)
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not save the chat model.')
    }
  }

  async function savePrompt() {
    if (!chat) return
    try {
      const updated = await updateChat(chat.id, { systemPrompt: promptDraft })
      setChat(updated)
      setPromptOpen(false)
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not save the system prompt.')
    }
  }

  async function setThinking(value: boolean) {
    if (!chat) return
    setChat({ ...chat, thinking: value })
    try {
      const updated = await updateChat(chat.id, { thinking: value })
      setChat(updated)
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not save the thinking setting.')
    }
  }

  function insertMicroPlaceholder() {
    const input = inputRef.current
    const start = input?.selectionStart ?? draft.length
    const end = input?.selectionEnd ?? start
    const insert = 'speech placeholder'
    const next = `${draft.slice(0, start)}${insert}${draft.slice(end)}`
    setDraft(next)
    requestAnimationFrame(() => {
      const target = inputRef.current
      if (!target) return
      const cursor = start + insert.length
      target.focus()
      target.setSelectionRange(cursor, cursor)
    })
  }

  async function runAssistantGeneration(activeChat: ChatEntity, history: ChatMessageEntity[]) {
    if (abortRef.current) return
    let settings
    try {
      settings = await getChatBookAiSettings(bookId)
    } catch {
      onToast('This book’s AI settings could not be loaded.')
      return
    }
    if (!settings.apiKey.trim()) {
      onToast('Add an API key in Book AI settings before chatting.')
      return
    }
    if (!activeChat.model.trim()) {
      onToast('Choose a chat model before sending.')
      return
    }

    let prepared
    try {
      prepared = await buildContextValues({
        bookId,
        type: 'chat',
        currentSceneId: currentSceneId || undefined,
        profile: activeChat.contextProfile,
      })
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Chat context could not be prepared.')
      return
    }

    const systemPrompt = renderPromptTemplate(activeChat.systemPrompt, bookTemplateValues(bookPromptValues))
    const contextSections = [
      prepared.lastSceneText ? section(`Current scene${prepared.lastSceneTitle ? ` — ${prepared.lastSceneTitle}` : ''}`, prepared.lastSceneText) : '',
      prepared.additionalContext ? section('Additional context', prepared.additionalContext) : '',
    ].filter(Boolean)
    const workspaceInstructions = `# Workspace tools

You can inspect and propose edits to Scenes, Notes, and Codex entries in this book. You can also propose creating a new Codex/lore entry. For the outline, use read_outline before structural changes; you may propose creating, renaming, moving/reordering, or deleting Acts, Chapters, and Scenes. Mutating tools only create approval proposals: never claim an edit, creation, rename, move, reorder, or deletion happened until the user approves the card in Chat. Outline deletion is allowed only when the target and every descendant Scene have empty content. Search/read tools are read-only and can run automatically. Use search_entities and read_entity when a document target is not already known. For localized document changes, prefer propose_document_edit with exact old_text copied from read_entity. Use propose_document_replacement only for whole-document rewrites.`
    const providerMessages: ChatCompletionMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'system', content: workspaceInstructions },
      ...(contextSections.length ? [{ role: 'system' as const, content: `# Selected book context\n\n${contextSections.join('\n\n')}` }] : []),
      ...history.map((message): ChatCompletionMessage => {
        const editState = message.role === 'assistant' && message.documentEdits?.length
          ? `\n\n[Workspace edit proposals: ${message.documentEdits.map((proposal) => `${proposal.entityTitle}: ${proposal.status}`).join('; ')}]`
          : ''
        const creationState = message.role === 'assistant' && message.codexCreations?.length
          ? `\n\n[Codex creation proposals: ${message.codexCreations.map((proposal) => `${proposal.title}: ${proposal.status}`).join('; ')}]`
          : ''
        const outlineState = message.role === 'assistant' && message.outlineActions?.length
          ? `\n\n[Outline proposals: ${message.outlineActions.map((proposal) => `${proposal.action} ${proposal.entityTitle}: ${proposal.status}`).join('; ')}]`
          : ''
        return {
          role: message.role,
          content: `${message.content}${editState}${creationState}${outlineState}`,
          ...(message.role === 'assistant' && message.thoughts ? { reasoning_content: message.thoughts } : {}),
        }
      }),
    ]
    const requestText = providerMessages.map((message) => `${message.role}: ${message.content ?? ''}${message.reasoning_content ? `\nreasoning: ${message.reasoning_content}` : ''}`).join('\n\n')
    const diagnostics = generationContextDiagnostics(activeChat.model, activeChat.modelContextLength, systemPrompt, requestText)
    if (!diagnostics.fits) {
      onToast(`Context is too large for this model (~${diagnostics.requestTokens.toLocaleString()} request tokens plus response space). Reduce Chat context in Context Management or choose a larger model.`)
      return
    }

    const controller = new AbortController()
    abortRef.current = controller
    startedAtRef.current = Date.now()
    setElapsed(0)
    setGenerating(true)
    setPhase('sending')
    setStreamedContent('')
    setStreamedThoughts('')
    setLiveThoughtsOpen(true)
    followOutputRef.current = true
    setFollowOutput(true)
    let completed = false
    let activeRoundContent = ''
    let activeRoundThoughts = ''
    let activeRoundPersisted = false

    async function persistAssistantRound(
      roundContent: string,
      roundThoughts: string,
      extras: Pick<ChatMessageEntity, 'documentEdits' | 'codexCreations' | 'outlineActions'> = {},
      status: 'complete' | 'stopped' = 'complete',
    ) {
      const hasWorkspaceProposal = Boolean(extras.documentEdits?.length || extras.codexCreations?.length || extras.outlineActions?.length)
      if (!roundContent && !roundThoughts && !hasWorkspaceProposal) return null
      return createChatMessage(activeChat, 'assistant', roundContent, {
        thoughts: roundThoughts || undefined,
        status,
        documentEdits: extras.documentEdits,
        codexCreations: extras.codexCreations,
        outlineActions: extras.outlineActions,
      })
    }

    function commitVisibleRound(saved: ChatMessageEntity | null, hadThoughts: boolean) {
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

    try {
      const workingMessages = [...providerMessages]
      for (let round = 0; round < 8 && !controller.signal.aborted; round += 1) {
        activeRoundContent = ''
        activeRoundThoughts = ''
        activeRoundPersisted = false
        const result = await streamChatCompletion({
          apiKey: settings.apiKey.trim(),
          baseUrl: settings.baseUrl,
          provider: settings.provider,
          model: activeChat.model,
          messages: workingMessages,
          thinking: activeChat.thinking,
          tools: [...chatWorkspaceTools, ...chatOutlineTools],
        }, (chunk) => {
          if (chunk.thoughts) {
            activeRoundThoughts += chunk.thoughts
            setStreamedThoughts(activeRoundThoughts)
            if (!activeRoundContent) setPhase('thinking')
          }
          if (chunk.content) {
            activeRoundContent += chunk.content
            setStreamedContent(activeRoundContent)
            setPhase('writing')
          }
        }, controller.signal, () => {
          if (!controller.signal.aborted) setPhase('thinking')
        })

        if (result.toolCalls.length) {
          setPhase('using-tools')
          workingMessages.push({
            role: 'assistant',
            content: activeRoundContent || null,
            ...(activeRoundThoughts ? { reasoning_content: activeRoundThoughts } : {}),
            tool_calls: result.toolCalls,
          })
          const roundProposals: ChatDocumentEditProposal[] = []
          const roundCodexCreations: ChatCodexCreationProposal[] = []
          const roundOutlineActions: ChatOutlineActionProposal[] = []
          for (const call of result.toolCalls) {
            if (chatOutlineToolNames.has(call.function.name)) {
              const execution = await executeChatOutlineTool(bookId, call)
              if (execution.outlineAction) roundOutlineActions.push(execution.outlineAction)
              workingMessages.push({ role: 'tool', tool_call_id: call.id, content: execution.content })
            } else {
              const execution = await executeChatWorkspaceTool(bookId, call)
              if (execution.proposal) roundProposals.push(execution.proposal)
              if (execution.codexCreation) roundCodexCreations.push(execution.codexCreation)
              workingMessages.push({ role: 'tool', tool_call_id: call.id, content: execution.content })
            }
          }

          const saved = await persistAssistantRound(activeRoundContent, activeRoundThoughts, {
            documentEdits: roundProposals.length ? roundProposals : undefined,
            codexCreations: roundCodexCreations.length ? roundCodexCreations : undefined,
            outlineActions: roundOutlineActions.length ? roundOutlineActions : undefined,
          })
          activeRoundPersisted = Boolean(saved)
          commitVisibleRound(saved, Boolean(activeRoundThoughts))
          if (controller.signal.aborted) break
          setPhase('thinking')
          continue
        }

        const saved = await persistAssistantRound(activeRoundContent, activeRoundThoughts)
        activeRoundPersisted = Boolean(saved)
        commitVisibleRound(saved, Boolean(activeRoundThoughts))
        completed = true
        break
      }
      if (!completed && !controller.signal.aborted) throw new Error('The assistant used too many workspace tool steps. Ask it to make a smaller edit.')
    } catch (error) {
      if (!controller.signal.aborted && !(error instanceof DOMException && error.name === 'AbortError')) {
        onToast(error instanceof Error ? error.message : 'Chat generation stopped unexpectedly.')
      }
    } finally {
      const stopped = controller.signal.aborted
      if (stopped && !activeRoundPersisted && (activeRoundContent || activeRoundThoughts)) {
        try {
          const saved = await persistAssistantRound(activeRoundContent, activeRoundThoughts, {}, 'stopped')
          commitVisibleRound(saved, Boolean(activeRoundThoughts))
        } catch {
          // Keep the already streamed partial visible until teardown even if persistence fails.
        }
      }
      abortRef.current = null
      setGenerating(false)
      setPhase(null)
      setElapsed(0)
      setStreamedContent('')
      setStreamedThoughts('')
      const refreshed = await getChat(activeChat.id).catch(() => undefined)
      if (refreshed) setChat(refreshed)
    }
  }

  async function send() {
    if (!chat || generating) return
    const text = draft.trim()
    if (!text) return
    setDraft('')
    try {
      const userMessage = await createChatMessage(chat, 'user', text)
      const refreshedChat = await getChat(chat.id) ?? chat
      const history = [...messages, userMessage]
      setChat(refreshedChat)
      setMessages(history)
      await runAssistantGeneration(refreshedChat, history)
    } catch (error) {
      setDraft(text)
      onToast(error instanceof Error ? error.message : 'Could not send the message.')
    }
  }

  function stop() {
    if (!abortRef.current) return
    setPhase('stopping')
    abortRef.current.abort()
  }

  async function deleteFrom(message: ChatMessageEntity) {
    if (!chat || !window.confirm('Delete this message and everything after it in this chat?')) return
    try {
      await deleteMessageAndFollowing(bookId, chat.id, message.order)
      await reloadMessages()
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not delete the message.')
    }
  }

  function beginEdit(message: ChatMessageEntity) {
    setEditingId(message.id)
    setEditingValue(message.content)
  }

  async function saveEdit(message: ChatMessageEntity, regenerate: boolean) {
    if (!chat || !editingValue.trim()) return
    try {
      const updated = await updateChatMessage(message.id, { content: editingValue.trim() })
      setEditingId('')
      if (regenerate && message.role === 'user') {
        await deleteMessageAndFollowing(bookId, chat.id, message.order + 1)
        const history = (await listChatMessages(bookId, chat.id)).filter((item) => item.order <= updated.order)
        setMessages(history)
        await runAssistantGeneration(chat, history)
      } else {
        await reloadMessages()
      }
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not edit the message.')
    }
  }

  async function regenerate(message: ChatMessageEntity) {
    if (!chat || message.role !== 'assistant' || generating) return
    try {
      await deleteMessageAndFollowing(bookId, chat.id, message.order)
      const history = (await listChatMessages(bookId, chat.id)).filter((item) => item.order < message.order)
      setMessages(history)
      await runAssistantGeneration(chat, history)
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not regenerate the message.')
    }
  }

  async function fork(message: ChatMessageEntity) {
    if (!chat) return
    try {
      const forked = await forkChat(chat, message.order)
      onChatChange(forked.id)
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

  function readAloud(message: ChatMessageEntity) {
    if (!('speechSynthesis' in window) || !message.content.trim()) return
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(message.content))
  }

  if (!chatId) return <section className="conversation chat-empty"><MessageCircle aria-hidden="true" /><strong>No chat selected</strong><p>Create or open a chat from the Chat panel.</p></section>
  if (!chat) return <section className="conversation chat-empty"><span className="chat-loading" /> <p>Loading chat…</p></section>

  return <>
    <section className="conversation functional-chat">
      <header><small>Book chat</small><h1>{chat.title}</h1></header>
      <div className="messages">
        {!messages.length && !generating && <div className="chat-first-message"><Feather aria-hidden="true" /><strong>Start this conversation</strong><p>The model, prompt, and context are saved independently for this chat.</p></div>}
        {messages.map((message) => <article className={`message ${message.role === 'user' ? 'user' : 'bot no-thumb'}`} key={message.id}>
          {message.role === 'assistant' ? <div className="chat-message-stack">
            {editingId === message.id ? <InlineMessageEdit value={editingValue} onChange={setEditingValue} onCancel={() => setEditingId('')} onSave={() => { void saveEdit(message, false) }} /> : <>
              {message.thoughts && <details className="chat-thoughts" open={openThoughtMessageIds.has(message.id)} onToggle={(event) => setPersistedThoughtsOpen(message.id, event.currentTarget.open)}><summary>Thoughts</summary><div>{message.thoughts}</div></details>}
              <div className="bubble chat-markdown-bubble">{message.content ? <MarkdownMessage content={message.content} /> : (message.documentEdits?.length || message.codexCreations?.length || message.outlineActions?.length ? <em>Workspace proposal</em> : <em>No final answer returned.</em>)}</div>
              {message.documentEdits?.length ? <div className="chat-document-edits">{message.documentEdits.map((proposal) => <DocumentEditCard key={proposal.id} proposal={proposal} onApply={() => { void applyProposal(message, proposal) }} onReject={() => { void rejectProposal(message, proposal) }} />)}</div> : null}
              {message.codexCreations?.length ? <div className="chat-document-edits">{message.codexCreations.map((proposal) => <CodexCreationCard key={proposal.id} proposal={proposal} onCreate={() => { void createCodexProposal(message, proposal) }} onReject={() => { void rejectCodexProposal(message, proposal) }} />)}</div> : null}
              {message.outlineActions?.length ? <div className="chat-document-edits">{message.outlineActions.map((proposal) => <OutlineActionCard key={proposal.id} proposal={proposal} onApply={() => { void applyOutlineProposal(message, proposal) }} onReject={() => { void rejectOutlineProposal(message, proposal) }} />)}</div> : null}
              {message.status === 'stopped' && <small className="chat-message-status">Stopped</small>}
              <div className="message-tools"><button type="button" onClick={() => { void copyMessage(message) }}>{copiedMessageId === message.id ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />} {copiedMessageId === message.id ? 'Copied' : 'Copy'}</button><button type="button" onClick={() => beginEdit(message)}><Pencil aria-hidden="true" /> Edit</button><button type="button" onClick={() => { void fork(message) }}><GitFork aria-hidden="true" /> Fork</button><button type="button" onClick={() => readAloud(message)}><Volume2 aria-hidden="true" /> Read aloud</button><button type="button" onClick={() => { void regenerate(message) }}><RefreshCw aria-hidden="true" /> Regenerate</button><button type="button" onClick={() => { void deleteFrom(message) }}><Trash2 aria-hidden="true" /> Delete</button></div>
            </>}
          </div> : editingId === message.id ? <InlineMessageEdit value={editingValue} onChange={setEditingValue} onCancel={() => setEditingId('')} onSave={() => { void saveEdit(message, false) }} onSaveAndRegenerate={() => { void saveEdit(message, true) }} /> : <>
            <div className="bubble chat-markdown-bubble"><MarkdownMessage content={message.content} /></div>
            <div className="message-tools"><button type="button" onClick={() => { void copyMessage(message) }}>{copiedMessageId === message.id ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />} {copiedMessageId === message.id ? 'Copied' : 'Copy'}</button><button type="button" onClick={() => beginEdit(message)}><Pencil aria-hidden="true" /> Edit</button><button type="button" onClick={() => { void deleteFrom(message) }}><Trash2 aria-hidden="true" /> Delete</button></div>
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
      <div className="chat-config-row">
        <ChatModelPicker value={chat.model} models={sortedModels} onChange={(modelId) => { void changeModel(modelId) }} />
        <button className="chat-system-prompt-button" type="button" onClick={() => { setPromptDraft(chat.systemPrompt); setPromptOpen(true) }}><Bot aria-hidden="true" /><span>System prompt</span></button>
        {modelStatus && <small className="chat-model-status">{modelStatus}</small>}
      </div>
      <div className="chat-compose-row">
        <ExpandableTextInput ref={inputRef} value={draft} onChange={setDraft} onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void send()
          }
        }} placeholder="Ask about the book…" aria-label="Chat message" dialogTitle="Write chat message" />
        <ChatGenerateButton generating={generating} phase={phase} elapsed={elapsed} thinking={chat.thinking} onGenerate={() => { void send() }} onStop={stop} onMicro={insertMicroPlaceholder} onThinking={setThinking} />
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

function OutlineActionCard({ proposal, onApply, onReject }: { proposal: ChatOutlineActionProposal; onApply: () => void; onReject: () => void }) {
  const actionLabel = proposal.action === 'create' ? 'Create' : proposal.action === 'rename' ? 'Rename' : proposal.action === 'move' ? 'Move' : 'Delete'
  const statusLabel = proposal.status === 'proposed' ? 'Needs approval' : proposal.status === 'applied' ? 'Applied' : proposal.status === 'stale' ? 'Outline changed' : 'Rejected'
  const typeLabel = proposal.entityType[0].toUpperCase() + proposal.entityType.slice(1)
  return <section className={`chat-document-edit chat-outline-action ${proposal.action} ${proposal.status}`}>
    <header><div><small>{actionLabel} {typeLabel}</small><strong>{proposal.entityTitle}</strong></div><span>{statusLabel}</span></header>
    {proposal.summary && <p>{proposal.summary}</p>}
    <div className="chat-outline-action-body">
      {proposal.action === 'create' && <p>Create under <strong>{proposal.targetParentTitle || 'target parent'}</strong>.</p>}
      {proposal.action === 'rename' && <p><span>{proposal.entityTitle}</span><b>→</b><strong>{proposal.newTitle}</strong></p>}
      {proposal.action === 'move' && <p>Move to <strong>{proposal.targetParentTitle || 'target parent'}</strong>{proposal.beforeTitle ? <> before <strong>{proposal.beforeTitle}</strong></> : <> at the end</>}.</p>}
      {proposal.action === 'delete' && <p>Delete this item and its empty descendants. Non-empty Scene content blocks deletion.</p>}
    </div>
    {proposal.status === 'proposed' && <footer><button type="button" onClick={onReject}>Reject</button><button className={proposal.action === 'delete' ? 'danger' : 'primary'} type="button" onClick={onApply}>{actionLabel}</button></footer>}
  </section>
}

function CodexCreationCard({ proposal, onCreate, onReject }: { proposal: ChatCodexCreationProposal; onCreate: () => void; onReject: () => void }) {
  const statusLabel = proposal.status === 'proposed' ? 'Ready to create' : proposal.status === 'created' ? 'Created' : proposal.status === 'duplicate' ? 'Already exists' : 'Rejected'
  return <section className={`chat-document-edit chat-codex-creation ${proposal.status}`}>
    <header><div><small>New Codex · {proposal.category}</small><strong>{proposal.title}</strong></div><span>{statusLabel}</span></header>
    {proposal.summary && <p>{proposal.summary}</p>}
    <details><summary>View entry</summary><div className="chat-document-diff"><pre className="new">{proposal.content || '[empty entry]'}</pre></div></details>
    {proposal.status === 'proposed' && <footer><button type="button" onClick={onReject}>Reject</button><button className="primary" type="button" onClick={onCreate}>Create</button></footer>}
  </section>
}

function DocumentEditCard({ proposal, onApply, onReject }: { proposal: ChatDocumentEditProposal; onApply: () => void; onReject: () => void }) {
  const statusLabel = proposal.status === 'proposed' ? 'Ready to apply' : proposal.status === 'applied' ? 'Applied' : proposal.status === 'stale' ? 'Document changed' : 'Rejected'
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
    <button type="button" onClick={onMicro} title="Micro"><Mic aria-hidden="true" /><span>Micro</span></button>
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

  async function reload() {
    if (!bookId) { setItems([]); return }
    setItems(await listChats(bookId))
  }

  useEffect(() => {
    void reload()
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<{ bookId?: string }>).detail
      if (!detail?.bookId || detail.bookId === bookId) void reload()
    }
    window.addEventListener('arc-chat-changed', handle)
    return () => window.removeEventListener('arc-chat-changed', handle)
  }, [bookId])

  const normalized = query.trim().toLowerCase()
  const visible = items.filter((chat) => !normalized || `${chat.title} ${chat.lastMessagePreview ?? ''}`.toLowerCase().includes(normalized))

  async function add() {
    if (!bookId) return
    const chat = await createChat(bookId)
    await reload()
    onOpen(chat.id)
  }

  async function rename(chat: ChatEntity) {
    const title = window.prompt('Chat title', chat.title)
    if (title === null || !title.trim()) return
    await updateChat(chat.id, { title: title.trim() })
    await reload()
  }

  async function remove(chat: ChatEntity) {
    if (!window.confirm(`Delete “${chat.title}” and its messages?`)) return
    await deleteChat(chat.id)
    await reload()
    if (activeChatId === chat.id) onOpen('')
  }

  return <section className="chat-sidebar"><div className="panel-title"><div><small>Conversations</small><h2>Chats</h2></div><button type="button" onClick={() => { void add() }} aria-label="Start new chat"><Plus aria-hidden="true" /></button></div>
    <label className="chat-sidebar-search"><Search aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search chats" /></label>
    <div className="chat-sidebar-list">{visible.map((chat) => <article className={`chat-row-wrap ${activeChatId === chat.id ? 'selected' : ''}`} key={chat.id}>
      <button className="chat-row" type="button" onClick={() => onOpen(chat.id)}><i><MessageCircle aria-hidden="true" /></i><span><strong>{chat.title}</strong><small>{chat.lastMessagePreview || 'No messages yet'}</small></span><em>{formatChatEdited(chat.updatedAt)}</em></button>
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

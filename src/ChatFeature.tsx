import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  ChevronDown,
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
  type ChatEntity,
  type ChatMessageEntity,
  type ChatModel,
} from './chat-service'
import { buildContextValues, generationContextDiagnostics } from './context-service'
import { bookTemplateValues, renderPromptTemplate, type BookPromptValues } from './prompt-template'
import './chat.css'

type GenerationPhase = 'sending' | 'thinking' | 'writing' | 'stopping'

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
  const [generating, setGenerating] = useState(false)
  const [phase, setPhase] = useState<GenerationPhase | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [streamedContent, setStreamedContent] = useState('')
  const [streamedThoughts, setStreamedThoughts] = useState('')
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const startedAtRef = useRef(0)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const sortedModels = useMemo(() => [...models].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id)), [models])

  useEffect(() => {
    let cancelled = false
    abortRef.current?.abort()
    setGenerating(false)
    setPhase(null)
    setStreamedContent('')
    setStreamedThoughts('')
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
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, streamedContent, streamedThoughts])

  useEffect(() => () => abortRef.current?.abort(), [])

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
    const providerMessages: ChatCompletionMessage[] = [
      { role: 'system', content: systemPrompt },
      ...(contextSections.length ? [{ role: 'system' as const, content: `# Selected book context\n\n${contextSections.join('\n\n')}` }] : []),
      ...history.map((message): ChatCompletionMessage => ({
        role: message.role,
        content: message.content,
        ...(message.role === 'assistant' && message.thoughts ? { reasoning_content: message.thoughts } : {}),
      })),
    ]
    const requestText = providerMessages.map((message) => `${message.role}: ${message.content}${message.reasoning_content ? `\nreasoning: ${message.reasoning_content}` : ''}`).join('\n\n')
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
    let content = ''
    let thoughts = ''
    let completed = false

    try {
      await streamChatCompletion({
        apiKey: settings.apiKey.trim(),
        baseUrl: settings.baseUrl,
        provider: settings.provider,
        model: activeChat.model,
        messages: providerMessages,
        thinking: activeChat.thinking,
      }, (chunk) => {
        if (chunk.thoughts) {
          thoughts += chunk.thoughts
          setStreamedThoughts(thoughts)
          if (!content) setPhase('thinking')
        }
        if (chunk.content) {
          content += chunk.content
          setStreamedContent(content)
          setPhase('writing')
        }
      }, controller.signal, () => {
        if (!controller.signal.aborted) setPhase('thinking')
      })
      completed = true
    } catch (error) {
      if (!controller.signal.aborted && !(error instanceof DOMException && error.name === 'AbortError')) {
        onToast(error instanceof Error ? error.message : 'Chat generation stopped unexpectedly.')
      }
    } finally {
      const stopped = controller.signal.aborted
      abortRef.current = null
      setGenerating(false)
      setPhase(null)
      setElapsed(0)
      setStreamedContent('')
      setStreamedThoughts('')
      if ((content || thoughts) && (completed || stopped)) {
        await createChatMessage(activeChat, 'assistant', content, { thoughts: thoughts || undefined, status: stopped ? 'stopped' : 'complete' })
        await reloadMessages()
      }
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
              {message.thoughts && <details className="chat-thoughts"><summary>Thoughts</summary><div>{message.thoughts}</div></details>}
              <div className="bubble">{message.content || <em>No final answer returned.</em>}</div>
              {message.status === 'stopped' && <small className="chat-message-status">Stopped</small>}
              <div className="message-tools"><button type="button" onClick={() => beginEdit(message)}><Pencil aria-hidden="true" /> Edit</button><button type="button" onClick={() => { void fork(message) }}><GitFork aria-hidden="true" /> Fork</button><button type="button" onClick={() => readAloud(message)}><Volume2 aria-hidden="true" /> Read aloud</button><button type="button" onClick={() => { void regenerate(message) }}><RefreshCw aria-hidden="true" /> Regenerate</button><button type="button" onClick={() => { void deleteFrom(message) }}><Trash2 aria-hidden="true" /> Delete</button></div>
            </>}
          </div> : editingId === message.id ? <InlineMessageEdit value={editingValue} onChange={setEditingValue} onCancel={() => setEditingId('')} onSave={() => { void saveEdit(message, false) }} onSaveAndRegenerate={() => { void saveEdit(message, true) }} /> : <>
            <div className="bubble">{message.content}</div>
            <div className="message-tools"><button type="button" onClick={() => beginEdit(message)}><Pencil aria-hidden="true" /> Edit</button><button type="button" onClick={() => { void deleteFrom(message) }}><Trash2 aria-hidden="true" /> Delete</button></div>
          </>}
        </article>)}
        {generating && <article className="message bot no-thumb streaming"><div className="chat-message-stack">
          {streamedThoughts && <details className="chat-thoughts" open={!streamedContent}><summary>Thoughts</summary><div>{streamedThoughts}</div></details>}
          {streamedContent && <div className="bubble">{streamedContent}</div>}
          {!streamedContent && !streamedThoughts && <div className="chat-thinking-indicator"><i /><span>{phase === 'sending' ? 'Sending' : 'Thinking'} · {formatElapsed(elapsed)}</span></div>}
        </div></article>}
        <div ref={bottomRef} />
      </div>
    </section>

    <section className="chat-composer functional-chat-composer">
      <div className="chat-config-row">
        <label className="chat-model-selector"><span>Model</span><select value={chat.model} onChange={(event) => { void changeModel(event.target.value) }} aria-label="Chat model">
          {chat.model && !models.some((model) => model.id === chat.model) && <option value={chat.model}>{chat.model}</option>}
          {sortedModels.map((model) => <option key={model.id} value={model.id}>{model.name && model.name !== model.id ? `${model.name} — ${model.id}` : model.id}</option>)}
        </select><ChevronDown aria-hidden="true" /></label>
        <button className="chat-system-prompt-button" type="button" onClick={() => { setPromptDraft(chat.systemPrompt); setPromptOpen(true) }}><Bot aria-hidden="true" /><span>System prompt</span></button>
        {modelStatus && <small className="chat-model-status">{modelStatus}</small>}
      </div>
      <div className="chat-compose-row">
        <textarea ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void send()
          }
        }} placeholder="Ask about the book…" aria-label="Chat message" />
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

function InlineMessageEdit({ value, onChange, onCancel, onSave, onSaveAndRegenerate }: {
  value: string
  onChange: (value: string) => void
  onCancel: () => void
  onSave: () => void
  onSaveAndRegenerate?: () => void
}) {
  return <div className="inline-edit"><textarea value={value} onChange={(event) => onChange(event.target.value)} autoFocus/><div><button type="button" onClick={onCancel}>Cancel</button><button type="button" onClick={onSave}>Save</button>{onSaveAndRegenerate && <button type="button" onClick={onSaveAndRegenerate}>Save & regenerate</button>}</div></div>
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

  if (generating) return <div className="chat-generation-running"><span><i />{phase === 'stopping' ? 'Stopping' : phase === 'writing' ? 'Writing' : phase === 'sending' ? 'Sending' : 'Thinking'} · {formatElapsed(elapsed)}</span><button className="play generating" type="button" onClick={onStop} aria-label="Stop chat generation"><Square aria-hidden="true" fill="currentColor" /></button></div>

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

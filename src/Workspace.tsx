import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  BookOpenText,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Expand,
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
import AiSettings from './App'
import MarkdownEditor, { type MarkdownEditorHandle } from './MarkdownEditor'
import { loadNanoGptSettings, streamNanoGptGeneration, type NanoGptSettings } from './nano-gpt'
import {
  PROTOTYPE_SCENE_ID,
  createSnapshot,
  ensurePrototypeSeed,
  getEntity,
  saveDocumentContent,
  type SnapshotReason,
} from './persistence'
import './generation-controls.css'

type Screen = 'home' | 'editor' | 'chat' | 'settings'
type RightTab = 'outline' | 'notes' | 'codex' | 'chat'
type ChatPanel = 'list' | 'settings'
type SaveState = 'loading' | 'saving' | 'saved' | 'error'
type GenerationMetadata = { preDocument: string; position: number; instruction: string; settings: NanoGptSettings; finalDocument: string }
type Toast = { id: number; message: string }

const books = [
  { title: 'The City Beneath the Tide', series: 'Atlas of Lost Coasts · Book II', edited: 'Edited 12 minutes ago', cover: 'tide' },
  { title: 'The Glass Orchard', series: 'Standalone', edited: 'Edited yesterday', cover: 'orchard' },
  { title: 'A Map of Quiet Fires', series: 'The Northward Letters · Book I', edited: 'Edited August 28', cover: 'fires' },
]

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
  const [promptDraft, setPromptDraft] = useState('')
  const [promptExpanded, setPromptExpanded] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [chatEdit, setChatEdit] = useState(false)
  const [aiReady, setAiReady] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('loading')
  const editorRef = useRef<MarkdownEditorHandle | null>(null)
  const promptRef = useRef<HTMLTextAreaElement | null>(null)
  const storyRef = useRef(initialStoryMarkdown)
  const storageReadyRef = useRef(false)
  const changedSinceSnapshotRef = useRef(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const lastGenerationRef = useRef<GenerationMetadata | null>(null)

  useEffect(() => { setAiReady(Boolean(localStorage.getItem('arc-ai-defaults-v1'))) }, [])

  useEffect(() => () => {
    abortControllerRef.current?.abort()
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
  }, [])

  function showToast(message: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    const next = { id: Date.now(), message }
    setToast(next)
    toastTimerRef.current = setTimeout(() => setToast((current) => current?.id === next.id ? null : current), 6500)
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await ensurePrototypeSeed(initialStoryMarkdown)
        const scene = await getEntity(PROTOTYPE_SCENE_ID)
        if (cancelled) return
        const content = typeof scene?.content === 'string' ? scene.content : initialStoryMarkdown
        storyRef.current = content
        setStoryMarkdown(content)
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
    if (!storageReadyRef.current) return
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    setSaveState('saving')
    try {
      await saveDocumentContent(PROTOTYPE_SCENE_ID, storyRef.current)
      if (snapshot && changedSinceSnapshotRef.current) {
        await createSnapshot(PROTOTYPE_SCENE_ID, reason, storyRef.current)
        changedSinceSnapshotRef.current = false
      }
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

  async function runGeneration(previous?: GenerationMetadata) {
    if (abortControllerRef.current) return
    const editor = editorRef.current
    if (!editor) return

    let settings: NanoGptSettings
    try {
      settings = previous?.settings ?? loadNanoGptSettings()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'AI settings could not be loaded.')
      return
    }

    if (previous && !editor.restoreDocument(previous.preDocument, previous.position)) return
    const started = editor.beginGeneration(previous?.position)
    if (!started) return

    const controller = new AbortController()
    abortControllerRef.current = controller
    setIsGenerating(true)
    let result: ReturnType<MarkdownEditorHandle['finishGeneration']> = null

    try {
      await streamNanoGptGeneration({
        settings,
        context: {
          bookTitle: 'The City Beneath the Tide',
          sceneText: started.document,
        },
        instruction: previous?.instruction ?? arcPrompt,
        signal: controller.signal,
        onChunk: (chunk) => { editor.appendGeneration(started.id, chunk) },
      })
      result = editor.finishGeneration(started.id)
    } catch (error) {
      result = editor.finishGeneration(started.id)
      if (!controller.signal.aborted) {
        const fallback = result?.generatedText
          ? 'Generation stopped unexpectedly. The partial passage was kept.'
          : 'NanoGPT generation failed.'
        const detail = error instanceof Error && !error.message.includes(settings.apiKey) ? error.message : fallback
        showToast(result?.generatedText ? fallback : detail)
      }
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null
      setIsGenerating(false)
    }

    if (result?.generatedText) {
      lastGenerationRef.current = {
        preDocument: started.document,
        position: started.position,
        instruction: previous?.instruction ?? arcPrompt,
        settings,
        finalDocument: result.document,
      }
      await flushDocument('generation', true)
    }
  }

  function generate() {
    void runGeneration()
  }

  function stopGeneration() {
    abortControllerRef.current?.abort()
  }

  function regenerate() {
    const latest = lastGenerationRef.current
    if (!latest) {
      showToast('Generate a passage before using Regenerate.')
      return
    }
    void runGeneration(latest)
  }

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

  if (screen === 'settings') return <AiSettings onHome={() => setScreen('home')} onBack={() => setScreen(returnScreen)} onSaved={() => setAiReady(true)} />

  if (screen === 'home') return (
    <main className="library-screen">
      <header className="library-top"><div className="arc-brand"><Feather aria-hidden="true" /> ARC</div><button type="button" onClick={() => openSettings('home')} aria-label="Open default settings"><Settings2 aria-hidden="true" /></button></header>
      <section className="library-content">
        <div className="library-title"><div><small>Your library</small><h1>Books</h1></div><button type="button" onClick={() => setScreen('editor')}><Plus aria-hidden="true" /><span>New book</span></button></div>
        {!aiReady && <div className="setup-warning"><Bot aria-hidden="true" /><div><strong>Text AI is not set up</strong><p>Choose a provider and models before using generation or chat.</p></div><button type="button" onClick={() => openSettings('home')}>Set up AI <ChevronRight aria-hidden="true" /></button></div>}
        <div className="library-grid">{books.map((book) => <button type="button" className="library-book" key={book.title} onClick={() => setScreen('editor')}><i className={`mock-cover ${book.cover}`}>{book.title.slice(0,1)}</i><span><small>{book.series}</small><strong>{book.title}</strong><em>{book.edited}</em></span></button>)}</div>
      </section>
    </main>
  )

  return (
    <main className={`workspace-screen ${screen === 'chat' ? 'chat-active' : ''}`}>
      <header className="floating-controls">
        <button type="button" onClick={() => openSettings(screen)} aria-label="Open settings"><ChevronsRight aria-hidden="true" /></button>
        <span className={`save-state ${saveState}`} title={saveState === 'error' ? 'Local save failed; your current editor text remains in memory.' : undefined}><i /> {saveState === 'loading' ? 'Loading' : saveState === 'saving' ? 'Saving' : saveState === 'error' ? 'Save failed' : 'Saved'}</span>
        <button type="button" onClick={() => setRightOpen(true)} aria-label="Open book workspace"><ChevronsLeft aria-hidden="true" /></button>
      </header>
      {toast && <div className="generation-toast" role="alert"><AlertCircle aria-hidden="true" /><span>{toast.message}</span><button type="button" onClick={() => setToast(null)} aria-label="Dismiss error"><X aria-hidden="true" /></button></div>}

      {screen === 'editor' ? <article className="story-editor">
        <small className="page-number">07</small><p className="document-path">Outline / Chapter 7 / Scene 2</p>
        <MarkdownEditor ref={editorRef} value={storyMarkdown} onChange={handleStoryChange} ariaLabel="Scene Markdown editor" />
      </article> : <section className="conversation">
        <header><small>Book chat</small><h1>{activeChat}</h1><p>Context: Chapter 7 · Codex</p></header>
        <div className="messages">
          <article className="message user"><div className="bubble">Why does Mara open the door even though she knows her father’s warning?</div><MessageActions user /></article>
          <article className="message bot"><i className="bot-thumb"><Feather aria-hidden="true" /></i><div><div className="bubble"><p>Mara opens it because the warning has become evidence. Her father taught her the rule but never explained how he knew it, so hearing her own name confirms that the door is tied to the life he concealed.</p><p>Every compass also turns toward the threshold. For a cartographer, that transforms fear into a navigational fact.</p></div><MessageActions /></div></article>
          <article className="message user">{chatEdit ? <div className="inline-edit"><textarea defaultValue="Does that choice contradict her promise to Elias in Chapter Four?"/><div><button type="button" onClick={() => setChatEdit(false)}>Cancel</button><button type="button" onClick={() => setChatEdit(false)}>Save</button><button type="button" onClick={() => setChatEdit(false)}>Save & regenerate</button></div></div> : <><div className="bubble">Does that choice contradict her promise to Elias in Chapter Four?</div><div className="message-tools"><button type="button" onClick={() => setChatEdit(true)}><Pencil aria-hidden="true" /> Edit</button><button type="button"><Trash2 aria-hidden="true" /> Delete</button></div></>}</article>
          <article className="message bot no-thumb"><div><div className="bubble">Not necessarily. She promised Elias she would not cross alone. Opening the door tests the boundary of that promise without yet breaking it.</div><MessageActions /></div></article>
        </div>
      </section>}

      {screen === 'editor' && <div className="editor-bottom"><button type="button" onClick={() => setArcOpen(true)} aria-label="Open generation input"><PanelBottomOpen aria-hidden="true" /></button><GenerateControl isGenerating={isGenerating} onGenerate={generate} onStop={stopGeneration} onMicro={insertEditorSpeech} onMicro2={insertPromptSpeech} onUndo={() => editorRef.current?.undo()} onRedo={() => editorRef.current?.redo()} onRegenerate={regenerate} /></div>}
      {screen === 'editor' && arcOpen && <section className="arc-drawer"><div><small>ARC</small><span>{isGenerating ? 'Writing into the scene…' : 'Guide the next passage'}</span><button type="button" onClick={() => setArcOpen(false)} aria-label="Close Arc"><X aria-hidden="true" /></button></div><div className="arc-compose"><label className="arc-prompt-field"><textarea ref={promptRef} value={arcPrompt} onChange={(event) => setArcPrompt(event.target.value)} disabled={isGenerating}/><small aria-live="polite">{arcPrompt.length} characters</small></label><button type="button" aria-label="Expand prompt" onClick={() => { setPromptDraft(arcPrompt); setPromptExpanded(true) }} disabled={isGenerating}><Expand aria-hidden="true" /></button><button className={`play ${isGenerating ? 'generation-stop' : ''}`} type="button" onClick={isGenerating ? stopGeneration : generate} aria-label={isGenerating ? 'Stop generation' : 'Generate'}>{isGenerating ? <Square aria-hidden="true" fill="currentColor" /> : <Play aria-hidden="true" fill="currentColor" />}</button></div></section>}
      {promptExpanded && <section className="prompt-expand-backdrop" role="dialog" aria-modal="true" aria-label="Edit generation input"><div className="prompt-expand-card"><header><strong>Generation input</strong><button type="button" onClick={() => setPromptExpanded(false)} aria-label="Close expanded input"><X aria-hidden="true" /></button></header><textarea autoFocus value={promptDraft} onChange={(event) => setPromptDraft(event.target.value)} /><footer><small>{promptDraft.length} characters</small><div><button type="button" onClick={() => setPromptExpanded(false)}>Cancel</button><button type="button" onClick={() => { setArcPrompt(promptDraft); setPromptExpanded(false) }}>Apply</button></div></footer></div></section>}
      {screen === 'chat' && <section className="chat-composer"><small>Chapter 7 + Codex <ChevronDown aria-hidden="true" /></small><div><button type="button" aria-label="Dictate message"><Mic aria-hidden="true" /></button><textarea defaultValue="Compare Mara’s choice with what she promised Elias."/><button className="send" type="button" aria-label="Send message"><Send aria-hidden="true" fill="currentColor" /></button></div></section>}

      {rightOpen && <aside className="book-panel">
        <header><div><small>Atlas of Lost Coasts · Book II</small><strong>The City Beneath the Tide</strong></div><button type="button" onClick={() => setRightOpen(false)} aria-label="Close book workspace"><X aria-hidden="true" /></button></header>
        <nav>{([['outline', BookOpenText], ['notes', NotebookPen], ['codex', WandSparkles], ['chat', MessageCircle]] as const).map(([tab, Icon]) => <button type="button" className={rightTab === tab ? 'active' : ''} onClick={() => { setRightTab(tab); if (tab === 'chat') setChatPanel(screen === 'chat' ? 'settings' : 'list') }} key={tab}><Icon aria-hidden="true" /><span>{tab}</span></button>)}</nav>
        <div className="panel-content">{rightTab === 'outline' ? <Outline /> : rightTab === 'notes' ? <Notes /> : rightTab === 'codex' ? <Codex /> : chatPanel === 'list' ? <ChatList onOpen={openChat} activeChat={screen === 'chat' ? activeChat : ''} onSettings={() => setChatPanel('settings')} /> : <ChatSettings title={activeChat} onBack={() => setChatPanel('list')} />}</div>
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

  if (isGenerating) return <button className="play generate-trigger generation-stop" type="button" onClick={onStop} aria-label="Stop generation"><Square aria-hidden="true" fill="currentColor" /></button>

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
    onPointerUp={() => {
      cancelTimer()
      if (!longPressRef.current) onGenerate()
    }}
    onPointerCancel={cancelTimer}
    onPointerLeave={cancelTimer}
    onClick={(event) => { if (event.detail === 0) onGenerate() }}
  ><Play aria-hidden="true" fill="currentColor" /></button>
}

function MessageActions({ user = false }: { user?: boolean }) { return <div className="message-tools"><button type="button"><Pencil aria-hidden="true" /> Edit</button>{!user && <><button type="button"><GitFork aria-hidden="true" /> Fork</button><button type="button"><Volume2 aria-hidden="true" /> Read aloud</button><button type="button"><RefreshCw aria-hidden="true" /> Regenerate</button></>}<button type="button"><Trash2 aria-hidden="true" /> Delete</button></div> }
function SummaryIcon({ state }: { state: 'complete' | 'outdated' | 'missing' }) { const Icon = state === 'complete' ? FileText : state === 'outdated' ? RefreshCw : FileQuestion; return <button className={`summary-status ${state}`} type="button" aria-label={`${state} summary`} title={`${state[0].toUpperCase()}${state.slice(1)} summary`}><Icon aria-hidden="true" /></button> }
function Outline() { return <section className="outline"><div className="panel-title"><div><small>Manuscript</small><h2>Outline</h2></div><button type="button" aria-label="Add outline item"><Plus aria-hidden="true" /></button></div><div className="tree"><p><b><ChevronDown aria-hidden="true" /></b><span><small>Act I</small>The doors remember</span><SummaryIcon state="complete" /></p><div><p><b><ChevronDown aria-hidden="true" /></b><span><small>Chapter 7</small>The Cartographer’s Door</span><SummaryIcon state="outdated" /></p><div><p className="selected"><span><small>Scene 2</small>The voice beyond</span><SummaryIcon state="outdated" /></p><p><span><small>Scene 3</small>Crossing</span><SummaryIcon state="missing" /></p></div><p><b><ChevronRight aria-hidden="true" /></b><span><small>Chapter 8</small>What the sea kept</span><SummaryIcon state="missing" /></p></div><p><b><ChevronRight aria-hidden="true" /></b><span><small>Act II</small>The map without coastlines</span><SummaryIcon state="missing" /></p></div></section> }
function Notes() { return <section><div className="panel-title"><div><small>Reference</small><h2>Notes</h2></div><button type="button" aria-label="Add note"><Plus aria-hidden="true" /></button></div><input className="panel-search" placeholder="Search notes"/>{['Rules of the remembered doors','Questions for Act II','Images of the drowned city','Father’s timeline'].map((note) => <button className="list-row" key={note}><NotebookPen aria-hidden="true" /><span>{note}<small>Edited recently</small></span><ChevronRight aria-hidden="true" /></button>)}</section> }
function Codex() { return <section><div className="panel-title"><div><small>Book knowledge</small><h2>Codex</h2></div><button type="button"><Plus aria-hidden="true" /> New</button></div><input className="panel-search" placeholder="Search the Codex"/><div className="chips"><button>All</button><button>Characters</button><button>Places</button></div>{[['M','Mara Vale','Character'],['D','The Drowned Quarter','Place'],['B','Brass Compass','Object']].map(([letter,title,type]) => <button className="codex-row" key={title}><i>{letter}</i><span><small>{type}</small>{title}</span><ChevronRight aria-hidden="true" /></button>)}</section> }
function ChatList({onOpen,activeChat,onSettings}:{onOpen:(title:string)=>void;activeChat:string;onSettings:()=>void}) { return <section><div className="panel-title"><div><small>Conversations</small><h2>Chats</h2></div><button type="button" aria-label="Start new chat"><Plus aria-hidden="true" /></button></div>{activeChat && <button className="current-chat" onClick={onSettings}><Settings2 aria-hidden="true" /><span><small>Current chat</small>{activeChat} settings</span><ChevronRight aria-hidden="true" /></button>}<input className="panel-search" placeholder="Search chats"/>{chats.map(([title,preview,time]) => <button className="chat-row" key={title} onClick={() => onOpen(title)}><i><MessageCircle aria-hidden="true" /></i><span><strong>{title}</strong><small>{preview}</small></span><em>{time}</em></button>)}</section> }
function ChatSettings({title,onBack}:{title:string;onBack:()=>void}) { return <section><button className="back-list" onClick={onBack}><ArrowLeft aria-hidden="true" /> All chats</button><div className="panel-title"><div><small>Current chat</small><h2>{title}</h2></div></div><label className="panel-field"><span>System prompt</span><textarea defaultValue="You are a thoughtful story collaborator. Use only selected book context."/></label><label className="panel-field"><span>Model</span><select><option>Claude 3.7 Sonnet</option><option>GPT-4.1</option></select></label><label className="thinking"><span>Thinking<small>Allow longer internal reasoning</small></span><input type="checkbox" defaultChecked/></label><label className="panel-field"><span>Context</span><div className="chips"><button>Chapter 7 <X aria-hidden="true" /></button><button>Codex <X aria-hidden="true" /></button><button><Plus aria-hidden="true" /> Add</button></div></label></section> }

from pathlib import Path
import re


def replace_once(path: str, old: str, new: str, label: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'{label} not found in {path}')
    p.write_text(text.replace(old, new, 1))

# Pure mode helpers shared by the UI and tests.
Path('src/generate-control-state.ts').write_text(r'''import type { SttState } from './stt-service'
import type { TtsState } from './tts-service'

export type GenerateControlMode = 'idle' | 'generation' | 'stt' | 'tts'
export type GeneratePanelAction = 'undo' | 'redo' | 'regenerate' | 'dictate-editor' | 'dictate-instruction' | 'read-aloud' | 'collapse'

const ACTIVE_STT = new Set<SttState['status']>([
  'requesting-permission', 'recording', 'recording-live', 'stopping', 'transcribing', 'finalizing', 'failed',
])
const ACTIVE_TTS = new Set<TtsState['status']>([
  'preparing', 'generating', 'playing', 'paused', 'waiting', 'stopping', 'failed',
])

export function editorSttIsVisible(state: SttState) {
  return (state.target === 'editor' || state.target === 'instruction') && ACTIVE_STT.has(state.status)
}

export function editorTtsIsVisible(state: TtsState) {
  return ACTIVE_TTS.has(state.status)
}

export function generateControlMode(generating: boolean, stt: SttState, tts: TtsState): GenerateControlMode {
  if (generating) return 'generation'
  if (editorSttIsVisible(stt)) return 'stt'
  if (editorTtsIsVisible(tts)) return 'tts'
  return 'idle'
}

export function generatePanelActionKeepsOpen(action: GeneratePanelAction) {
  return action === 'undo' || action === 'redo'
}
''')

Path('tests/generate-control-state.test.mjs').write_text(r'''import test from 'node:test'
import assert from 'node:assert/strict'
import { editorSttIsVisible, editorTtsIsVisible, generateControlMode, generatePanelActionKeepsOpen } from '../src/generate-control-state.ts'

const idleStt = { status: 'idle', label: '', target: null, live: false }
const idleTts = { status: 'idle', label: '', chunkIndex: 0, chunkCount: 0 }

test('generation takes precedence over speech modes', () => {
  const stt = { ...idleStt, status: 'recording', target: 'editor' }
  const tts = { ...idleTts, status: 'playing' }
  assert.equal(generateControlMode(true, stt, tts), 'generation')
})

test('editor and instruction STT are represented, Chat STT is not claimed by the editor control', () => {
  assert.equal(editorSttIsVisible({ ...idleStt, status: 'recording-live', target: 'editor' }), true)
  assert.equal(editorSttIsVisible({ ...idleStt, status: 'transcribing', target: 'instruction' }), true)
  assert.equal(editorSttIsVisible({ ...idleStt, status: 'recording', target: 'chat' }), false)
  assert.equal(editorSttIsVisible({ ...idleStt, status: 'completed', target: 'editor' }), false)
})

test('working and failed TTS are represented while terminal success returns to idle control', () => {
  assert.equal(editorTtsIsVisible({ ...idleTts, status: 'playing' }), true)
  assert.equal(editorTtsIsVisible({ ...idleTts, status: 'failed' }), true)
  assert.equal(editorTtsIsVisible({ ...idleTts, status: 'complete' }), false)
})

test('only repeated history actions keep the expanded panel open', () => {
  assert.equal(generatePanelActionKeepsOpen('undo'), true)
  assert.equal(generatePanelActionKeepsOpen('redo'), true)
  for (const action of ['regenerate', 'dictate-editor', 'dictate-instruction', 'read-aloud', 'collapse']) {
    assert.equal(generatePanelActionKeepsOpen(action), false, action)
  }
})
''')

# MarkdownEditor reports real undo/redo availability.
p = Path('src/MarkdownEditor.tsx')
text = p.read_text()
text = text.replace(
    "import { defaultKeymap, history, historyKeymap, isolateHistory, redo, undo } from '@codemirror/commands'",
    "import { defaultKeymap, history, historyKeymap, isolateHistory, redo, redoDepth, undo, undoDepth } from '@codemirror/commands'",
    1,
)
text = text.replace(
    "  onMentionClick?: (mention: CodexMentionClick) => void\n}",
    "  onMentionClick?: (mention: CodexMentionClick) => void\n  onHistoryAvailability?: (availability: { canUndo: boolean; canRedo: boolean }) => void\n}",
    1,
)
text = text.replace(
    "  { value, onChange, ariaLabel = 'Markdown editor', className = '', readOnly = false, mentionTerms = [], onMentionClick },",
    "  { value, onChange, ariaLabel = 'Markdown editor', className = '', readOnly = false, mentionTerms = [], onMentionClick, onHistoryAvailability },",
    1,
)
text = text.replace(
    "  const onMentionClickRef = useRef(onMentionClick)\n",
    "  const onMentionClickRef = useRef(onMentionClick)\n  const onHistoryAvailabilityRef = useRef(onHistoryAvailability)\n",
    1,
)
text = text.replace(
    "  useEffect(() => { onMentionClickRef.current = onMentionClick }, [onMentionClick])\n",
    "  useEffect(() => { onMentionClickRef.current = onMentionClick }, [onMentionClick])\n  useEffect(() => { onHistoryAvailabilityRef.current = onHistoryAvailability }, [onHistoryAvailability])\n",
    1,
)
old_listener = """        EditorView.updateListener.of(update => {\n          if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(dictationProvisional))) onChangeRef.current(update.state.doc.toString())\n        }),\n"""
new_listener = """        EditorView.updateListener.of(update => {\n          if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(dictationProvisional))) onChangeRef.current(update.state.doc.toString())\n          onHistoryAvailabilityRef.current?.({ canUndo: undoDepth(update.state) > 0, canRedo: redoDepth(update.state) > 0 })\n        }),\n"""
if old_listener not in text: raise SystemExit('editor update listener not found')
text = text.replace(old_listener, new_listener, 1)
text = text.replace(
    "    viewRef.current = view\n    if (mentionTermsRef.current.length) view.dispatch({ effects: setMentionTerms.of(mentionTermsRef.current) })\n",
    "    viewRef.current = view\n    onHistoryAvailabilityRef.current?.({ canUndo: undoDepth(view.state) > 0, canRedo: redoDepth(view.state) > 0 })\n    if (mentionTermsRef.current.length) view.dispatch({ effects: setMentionTerms.of(mentionTermsRef.current) })\n",
    1,
)
p.write_text(text)

# Workspace consumes history + shared STT/TTS state and replaces the old toolbar.
p = Path('src/Workspace.tsx')
text = p.read_text()
text = text.replace(
    "import { cancelSttSession, dismissSttState, getSttState, normalizeTranscriptForInsertion, startSttSession, stopSttSession, subscribeSttState, type SttState } from './stt-service'",
    "import { cancelSttSession, dismissSttState, getSttState, normalizeTranscriptForInsertion, startSttSession, stopSttSession, subscribeSttState, type SttState } from './stt-service'\nimport { generateControlMode, generatePanelActionKeepsOpen, type GeneratePanelAction } from './generate-control-state'",
    1,
)
text = text.replace(
    "  const [lastGeneratedPassage, setLastGeneratedPassage] = useState('')\n  const [sttState, setSttState] = useState<SttState>(() => getSttState())\n",
    "  const [lastGeneratedPassage, setLastGeneratedPassage] = useState('')\n  const [sttState, setSttState] = useState<SttState>(() => getSttState())\n  const [ttsState, setTtsState] = useState<TtsState>(() => getTtsState())\n  const [editorHistory, setEditorHistory] = useState({ canUndo: false, canRedo: false })\n",
    1,
)
text = text.replace(
    "    setLastGeneratedPassage('')\n    setCodexTriggerDraft",
    "    setLastGeneratedPassage('')\n    setEditorHistory({ canUndo: false, canRedo: false })\n    setCodexTriggerDraft",
    1,
)
text = text.replace(
    "  useEffect(() => subscribeSttState(setSttState), [])\n",
    "  useEffect(() => subscribeSttState(setSttState), [])\n  useEffect(() => subscribeTtsState(setTtsState), [])\n",
    1,
)
# Add editor-control visibility next to other derived view state.
context_anchor = """  const contextType: GenerationContextType = screen === 'chat' || (screen === 'settings' && returnScreen === 'chat') ? 'chat' : activeDocument?.type === 'codexEntry' ? 'codex' : activeDocument?.type === 'note' ? 'note' : 'scene'\n\n"""
if context_anchor not in text: raise SystemExit('context type anchor not found')
text = text.replace(context_anchor, context_anchor + "  const editorGenerateControlVisible = screen === 'editor' && (activeDocument?.type === 'scene' || (activeDocument?.type === 'codexEntry' && !activeCodexArchived)) && !arcOpen\n\n", 1)
# Global bars stay for non-editor surfaces; editor control owns its active speech modes.
text = text.replace(
    "      <TtsStatusBar />\n      <SttStatusBar />",
    "      {!editorGenerateControlVisible && <TtsStatusBar />}\n      {(!editorGenerateControlVisible || (sttState.target !== 'editor' && sttState.target !== 'instruction')) && <SttStatusBar />}" ,
    1,
)
# History callback from CodeMirror.
text = text.replace(
    "onChange={handleStoryChange} ariaLabel=",
    "onChange={handleStoryChange} onHistoryAvailability={setEditorHistory} ariaLabel=",
    1,
)
old_control = """      {screen === 'editor' && (activeDocument?.type === 'scene' || (activeDocument?.type === 'codexEntry' && !activeCodexArchived)) && !arcOpen && <div className=\"editor-bottom\"><button type=\"button\" onClick={() => setArcOpen(true)} aria-label=\"Open generation input\"><PanelBottomOpen aria-hidden=\"true\" /></button><GenerateControl isGenerating={generationActive} phase={generationPhase} elapsedSeconds={generationElapsedSeconds} onOpenDetails={() => setGenerationDetailsOpen(true)} onGenerate={generate} onStop={stopGeneration} onMicro={() => { void dictateEditor() }} onMicro2={() => { void dictateInstruction() }} onUndo={() => editorRef.current?.undo()} onRedo={() => editorRef.current?.redo()} onRegenerate={regenerate} onReadAloud={() => { void readCurrentDocument() }} readAloudDisabled={activeDocument?.type === 'scene' && !lastGeneratedPassage.trim()} readAloudTitle={activeDocument?.type === 'scene' ? 'Read latest generated passage' : 'Read full Codex entry'} /></div>}\n"""
new_control = """      {editorGenerateControlVisible && <div className=\"editor-bottom\"><button type=\"button\" onClick={() => setArcOpen(true)} aria-label=\"Open generation input\"><PanelBottomOpen aria-hidden=\"true\" /></button><GenerateControl isGenerating={generationActive} phase={generationPhase} elapsedSeconds={generationElapsedSeconds} stt={sttState} tts={ttsState} canUndo={editorHistory.canUndo} canRedo={editorHistory.canRedo} onOpenDetails={() => setGenerationDetailsOpen(true)} onGenerate={generate} onStop={stopGeneration} onMicro={() => { void dictateEditor() }} onMicro2={() => { void dictateInstruction() }} onUndo={() => editorRef.current?.undo()} onRedo={() => editorRef.current?.redo()} onRegenerate={regenerate} onReadAloud={() => { void readCurrentDocument() }} readAloudDisabled={activeDocument?.type === 'scene' && !lastGeneratedPassage.trim()} readAloudTitle={activeDocument?.type === 'scene' ? 'Read latest generated passage' : 'Read full Codex entry'} /></div>}\n"""
if old_control not in text: raise SystemExit('old GenerateControl render not found')
text = text.replace(old_control, new_control, 1)

# Replace old horizontal toolbar implementation with anchored transformed control.
pattern = re.compile(r"function GenerateControl\([\s\S]*?\n}\n\nfunction AutotitlePanel", re.M)
match = pattern.search(text)
if not match: raise SystemExit('GenerateControl function block not found')
new_function = r'''function GenerateControl({ isGenerating, phase, elapsedSeconds, stt, tts, canUndo, canRedo, onOpenDetails, onGenerate, onStop, onMicro, onMicro2, onUndo, onRedo, onRegenerate, onReadAloud, readAloudDisabled, readAloudTitle }: {
  isGenerating: boolean
  phase: GenerationPhase | null
  elapsedSeconds: number
  stt: SttState
  tts: TtsState
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
  const [expanded, setExpanded] = useState(false)
  const [pressing, setPressing] = useState(false)
  const [speechElapsed, setSpeechElapsed] = useState(0)
  const longPressRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mode = generateControlMode(isGenerating, stt, tts)

  useEffect(() => {
    if (mode !== 'stt' || !stt.startedAt || !['recording', 'recording-live'].includes(stt.status)) {
      setSpeechElapsed(0)
      return
    }
    const update = () => setSpeechElapsed(Math.max(0, Math.floor((Date.now() - stt.startedAt!) / 1000)))
    update()
    const timer = window.setInterval(update, 250)
    return () => window.clearInterval(timer)
  }, [mode, stt.startedAt, stt.status])

  useEffect(() => {
    if (mode !== 'idle') setExpanded(false)
  }, [mode])

  function cancelTimer() {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    setPressing(false)
  }

  function runPanelAction(action: GeneratePanelAction, callback?: () => void) {
    if (!generatePanelActionKeepsOpen(action)) setExpanded(false)
    callback?.()
  }

  if (mode === 'generation' && phase) return <div className="generate-control generate-mode generation-mode" role="group" aria-label="Generation in progress">
    <button className="generate-mode-copy" type="button" onClick={onOpenDetails} title="Open generation details"><i aria-hidden="true" /><span><strong>{generationPhaseLabel(phase)}</strong><small>{formatGenerationTime(elapsedSeconds)} · view details</small></span></button>
    <button className="generate-mode-action stop" type="button" onClick={onStop} aria-label="Stop generation"><Square aria-hidden="true" fill="currentColor" /><span>Stop</span></button>
  </div>

  if (mode === 'stt') {
    const recording = stt.status === 'recording' || stt.status === 'recording-live'
    const label = stt.status === 'requesting-permission' ? 'Microphone permission'
      : stt.status === 'recording-live' ? 'Recording'
      : stt.status === 'recording' ? 'Recording'
      : stt.status === 'stopping' ? 'Stopping'
      : stt.status === 'transcribing' ? 'Transcribing…'
      : stt.status === 'finalizing' ? 'Finalizing…'
      : 'Dictation failed'
    return <div className={`generate-control generate-mode stt-mode ${stt.status}`} role={stt.status === 'failed' ? 'alert' : 'group'} aria-label="Dictation status">
      <div className="generate-mode-copy static"><Mic aria-hidden="true" /><span><strong>{label}{stt.status === 'recording-live' && <b className="mode-badge">Live</b>}</strong><small>{recording ? formatGenerationTime(speechElapsed) : stt.error || stt.label}</small></span></div>
      <div className="generate-mode-actions">{recording && <button className="generate-mode-action stop" type="button" onClick={stopSttSession} aria-label="Stop dictation"><Square aria-hidden="true" fill="currentColor" /><span>Stop</span></button>}{stt.status === 'failed' ? <button className="generate-mode-action quiet" type="button" onClick={dismissSttState} aria-label="Dismiss dictation failure"><X aria-hidden="true" /><span>Close</span></button> : <button className="generate-mode-action quiet" type="button" onClick={cancelSttSession} aria-label="Cancel dictation"><X aria-hidden="true" /><span>Cancel</span></button>}</div>
    </div>
  }

  if (mode === 'tts') {
    const label = tts.status === 'preparing' ? 'Preparing audio'
      : tts.status === 'generating' ? 'Generating audio'
      : tts.status === 'playing' ? 'Playing'
      : tts.status === 'paused' ? 'Paused'
      : tts.status === 'waiting' ? 'Waiting for audio'
      : tts.status === 'stopping' ? 'Stopping audio'
      : 'Read aloud failed'
    return <div className={`generate-control generate-mode tts-mode ${tts.status}`} role={tts.status === 'failed' ? 'alert' : 'group'} aria-label="Read aloud status">
      <div className="generate-mode-copy static"><Volume2 aria-hidden="true" /><span><strong>{label}</strong><small>{tts.error || tts.label || 'Read aloud'}{tts.chunkCount ? ` · ${Math.max(1, tts.chunkIndex || 1)}/${tts.chunkCount}` : ''}</small></span></div>
      <div className="generate-mode-actions">{tts.status === 'playing' && <button className="generate-mode-action quiet icon-only" type="button" onClick={pauseTtsSession} aria-label="Pause read aloud"><Pause aria-hidden="true" /></button>}{tts.status === 'paused' && <button className="generate-mode-action quiet icon-only" type="button" onClick={() => { void resumeTtsSession() }} aria-label="Resume read aloud"><Play aria-hidden="true" /></button>}{tts.status === 'failed' ? <button className="generate-mode-action quiet" type="button" onClick={dismissTtsState}><X aria-hidden="true" /><span>Close</span></button> : <button className="generate-mode-action stop" type="button" onClick={stopTtsSession}><Square aria-hidden="true" fill="currentColor" /><span>Stop</span></button>}</div>
    </div>
  }

  return <div className={`generate-control ${expanded ? 'expanded' : ''} ${pressing ? 'pressing' : ''}`}>
    {expanded && <section className="generate-panel" role="toolbar" aria-label="Generate actions">
      <div className="generate-panel-utilities">
        <button type="button" onClick={() => runPanelAction('undo', onUndo)} disabled={!canUndo} aria-label="Undo editor change" title="Undo"><Undo2 aria-hidden="true" /></button>
        <button type="button" onClick={() => runPanelAction('redo', onRedo)} disabled={!canRedo} aria-label="Redo editor change" title="Redo"><Redo2 aria-hidden="true" /></button>
        <span aria-hidden="true" />
        <button className="collapse" type="button" onClick={() => runPanelAction('collapse')} aria-label="Collapse generate actions" title="Collapse"><X aria-hidden="true" /></button>
      </div>
      <div className="generate-panel-actions">
        <button type="button" onClick={() => runPanelAction('regenerate', onRegenerate)}><RefreshCw aria-hidden="true" /><span>Regenerate</span></button>
        <button type="button" onClick={() => runPanelAction('dictate-editor', onMicro)}><Mic aria-hidden="true" /><span>Dictate editor</span></button>
        <button type="button" onClick={() => runPanelAction('dictate-instruction', onMicro2)}><Mic aria-hidden="true" /><span>Dictate instruction</span></button>
        <button type="button" onClick={() => runPanelAction('read-aloud', onReadAloud)} disabled={readAloudDisabled} title={readAloudDisabled ? 'No readable generated passage is available' : readAloudTitle || 'Read aloud'}><Volume2 aria-hidden="true" /><span>Read aloud</span></button>
      </div>
    </section>}
    <button
      className="play generate-trigger generate-main-button"
      type="button"
      aria-label="Generate. Long press or press Arrow Up for more actions."
      aria-haspopup="toolbar"
      aria-expanded={expanded}
      aria-keyshortcuts="ArrowUp"
      title="Generate · Arrow Up for more actions"
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowUp') return
        event.preventDefault()
        cancelTimer()
        setExpanded(true)
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        longPressRef.current = false
        cancelTimer()
        setPressing(true)
        try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* no-op */ }
        timerRef.current = setTimeout(() => {
          longPressRef.current = true
          setPressing(false)
          setExpanded(true)
        }, 450)
      }}
      onPointerUp={(event) => {
        cancelTimer()
        try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* no-op */ }
      }}
      onPointerCancel={cancelTimer}
      onClick={() => {
        if (longPressRef.current) {
          longPressRef.current = false
          return
        }
        if (expanded) {
          setExpanded(false)
          return
        }
        onGenerate()
      }}
    >
      <svg className="generate-hold-ring" viewBox="0 0 48 48" aria-hidden="true"><circle className="hold-track" cx="24" cy="24" r="21" pathLength="100"/><circle className="hold-progress" cx="24" cy="24" r="21" pathLength="100"/></svg>
      <Play className="generate-main-icon" aria-hidden="true" fill="currentColor" />
    </button>
  </div>
}

function AutotitlePanel'''
text = text[:match.start()] + new_function + text[match.end():]
p.write_text(text)

# Editor transformed-control CSS. Intentionally semantic-token based so themes remain authoritative.
p = Path('src/generation-controls.css')
css = p.read_text()
css += r'''

/* #81 transformed Generate control */
.editor-bottom .generate-control {
  --gc-surface: var(--surface);
  --gc-surface-raised: var(--surface-2);
  --gc-border: var(--line);
  --gc-text: var(--ink);
  --gc-muted: var(--soft);
  --gc-faint: var(--faint);
  --gc-primary: var(--accent);
  --gc-primary-strong: var(--accent-bright);
  --gc-danger: var(--danger);
  position: relative;
  flex: none;
  pointer-events: auto;
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
}

.editor-bottom .generate-main-button {
  position: relative;
  isolation: isolate;
  transition: transform .12s ease, border-color .16s ease, background-color .16s ease;
}
.editor-bottom .generate-main-button:active,
.editor-bottom .generate-control.pressing .generate-main-button { transform: scale(.95); }
.editor-bottom .generate-main-button:focus-visible,
.editor-bottom .generate-panel button:focus-visible,
.editor-bottom .generate-mode button:focus-visible { outline: 2px solid var(--gc-primary-strong); outline-offset: 3px; }

.generate-main-icon { position: relative; z-index: 2; }
.generate-hold-ring { position: absolute; z-index: 3; inset: -4px; width: calc(100% + 8px)!important; height: calc(100% + 8px)!important; overflow: visible; transform: rotate(-90deg); pointer-events: none; }
.generate-hold-ring circle { fill: none; stroke-width: 2; }
.generate-hold-ring .hold-track { stroke: var(--gc-border); }
.generate-hold-ring .hold-progress { stroke: var(--gc-primary-strong); stroke-linecap: round; stroke-dasharray: 100; stroke-dashoffset: 100; transition: stroke-dashoffset .14s ease; }
.generate-control.pressing .hold-progress { animation: generate-hold-progress 450ms linear forwards; }

.editor-bottom .generate-panel {
  position: absolute;
  right: 0;
  bottom: calc(100% + 10px);
  width: min(292px, calc(100vw - 28px));
  max-height: min(62svh, 390px);
  padding: 8px;
  overflow: auto;
  border: 1px solid var(--gc-border);
  border-radius: 18px 18px 8px 18px;
  background: var(--gc-surface);
  color: var(--gc-text);
  box-shadow: 0 18px 48px color-mix(in srgb, var(--deep) 74%, transparent);
  transform-origin: bottom right;
  animation: generate-panel-in .14s ease-out both;
}
.editor-bottom .generate-panel::after { content: ''; position: absolute; right: 20px; bottom: -6px; width: 11px; height: 11px; border-right: 1px solid var(--gc-border); border-bottom: 1px solid var(--gc-border); background: var(--gc-surface); transform: rotate(45deg); }
.generate-panel-utilities { min-height: 42px; padding-bottom: 7px; border-bottom: 1px solid var(--gc-border); display: grid; grid-template-columns: 40px 40px 1fr 40px; gap: 5px; }
.generate-panel-utilities button { width: 40px; height: 40px; padding: 0; border: 1px solid transparent; border-radius: 11px; background: transparent; color: var(--gc-muted); display: grid; place-items: center; cursor: pointer; }
.generate-panel-utilities button:hover:not(:disabled) { border-color: var(--gc-border); background: var(--gc-surface-raised); color: var(--gc-text); }
.generate-panel-utilities svg { width: 17px; height: 17px; }
.generate-panel-utilities .collapse { color: var(--gc-faint); }
.generate-panel-actions { padding-top: 7px; display: grid; gap: 5px; }
.generate-panel-actions button { min-height: 44px; padding: 0 11px; border: 1px solid transparent; border-radius: 12px; background: transparent; color: var(--gc-muted); display: grid; grid-template-columns: 20px minmax(0, 1fr); align-items: center; gap: 9px; text-align: left; cursor: pointer; transition: background-color .12s ease, border-color .12s ease, transform .1s ease; }
.generate-panel-actions button:hover:not(:disabled) { border-color: var(--gc-border); background: var(--gc-surface-raised); color: var(--gc-text); }
.generate-panel-actions button:active:not(:disabled) { transform: scale(.985); }
.generate-panel-actions svg { width: 17px; height: 17px; color: var(--gc-primary-strong); }
.generate-panel-actions span { min-width: 0; font-size: 12px; font-weight: 650; }
.generate-panel button:disabled { opacity: .34; cursor: not-allowed; filter: saturate(.45); }

.editor-bottom .generate-mode {
  min-height: 58px;
  max-width: min(360px, calc(100vw - 84px));
  padding: 5px;
  border: 1px solid var(--gc-border);
  border-radius: 18px;
  background: var(--gc-surface);
  color: var(--gc-text);
  box-shadow: 0 16px 44px color-mix(in srgb, var(--deep) 72%, transparent);
  display: flex;
  align-items: center;
  gap: 5px;
  animation: generate-mode-in .15s ease-out both;
}
.generate-mode-copy { min-width: 0; min-height: 46px; padding: 0 10px; border: 0; border-radius: 13px; background: transparent; color: inherit; display: flex; flex: 1; align-items: center; gap: 9px; text-align: left; cursor: pointer; }
.generate-mode-copy.static { cursor: default; }
.generate-mode-copy > i { width: 7px; height: 7px; flex: none; border-radius: 50%; background: var(--gc-primary); }
.generate-mode-copy > svg { width: 18px; height: 18px; flex: none; color: var(--gc-primary-strong); }
.generate-mode-copy span { min-width: 0; }
.generate-mode-copy strong,.generate-mode-copy small { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.generate-mode-copy strong { font-size: 11px; }
.generate-mode-copy small { margin-top: 2px; color: var(--gc-faint); font-size: 9px; font-variant-numeric: tabular-nums; }
.mode-badge { margin-left: 7px; padding: 2px 5px; border: 1px solid var(--gc-border); border-radius: 8px; color: var(--gc-primary-strong); font-size: 8px; letter-spacing: .08em; text-transform: uppercase; }
.generate-mode-actions { flex: none; display: flex; align-items: center; gap: 4px; }
.generate-mode-action { min-height: 44px; padding: 0 10px; border: 1px solid var(--gc-border); border-radius: 12px; background: var(--gc-surface-raised); color: var(--gc-text); display: inline-flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer; }
.generate-mode-action svg { width: 15px; height: 15px; }
.generate-mode-action span { font-size: 10px; font-weight: 700; }
.generate-mode-action.stop { border-color: var(--gc-danger); color: var(--gc-danger); }
.generate-mode-action.quiet { color: var(--gc-muted); }
.generate-mode-action.icon-only { width: 44px; padding: 0; }
.stt-mode .generate-mode-copy > svg { color: var(--gc-primary-strong); }
.tts-mode .generate-mode-copy > svg { color: var(--gc-muted); }
.stt-mode.recording .generate-mode-copy > svg,.stt-mode.recording-live .generate-mode-copy > svg { animation: dictation-recording-pulse 1.2s ease-in-out infinite; }
.generation-mode .generate-mode-copy > i { animation: generation-pulse 1.7s ease-out infinite; }

@keyframes generate-hold-progress { from { stroke-dashoffset: 100; } to { stroke-dashoffset: 0; } }
@keyframes generate-panel-in { from { opacity: 0; transform: translateY(6px) scale(.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes generate-mode-in { from { opacity: 0; transform: translateY(5px) scale(.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes dictation-recording-pulse { 50% { transform: scale(1.1); } }

/* Chat remains composer-specific but shares focus/pressed language. */
.chat-generate-trigger:focus-visible,.chat-generate-actions button:focus-visible,.chat-generation-running button:focus-visible { outline: 2px solid var(--accent-bright); outline-offset: 3px; }
.chat-generate-trigger:active,.chat-generate-actions button:active { transform: scale(.96); }

@media (max-width: 420px) {
  .editor-bottom .generate-panel { width: min(276px, calc(100vw - 28px)); max-height: min(58svh, 360px); }
  .editor-bottom .generate-mode { max-width: calc(100vw - 76px); }
  .generate-mode-copy { padding-inline: 8px; }
  .generate-mode-action { min-width: 42px; padding-inline: 8px; }
  .generate-mode-action span { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .generate-control.pressing .hold-progress { animation-timing-function: steps(4, end); }
  .editor-bottom .generate-panel,.editor-bottom .generate-mode { animation: none; }
  .editor-bottom .generate-main-button,.generate-panel-actions button { transition: none; }
  .stt-mode.recording .generate-mode-copy > svg,.stt-mode.recording-live .generate-mode-copy > svg { animation: none; }
}
'''
p.write_text(css)

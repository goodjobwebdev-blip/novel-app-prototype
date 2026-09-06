from pathlib import Path
import re


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'{label} not found in {path}')
    p.write_text(text.replace(old, new, 1))

# MarkdownEditor: expose real history availability to the control.
p = Path('src/MarkdownEditor.tsx')
text = p.read_text()
text = text.replace(
    "import { defaultKeymap, history, historyKeymap, isolateHistory, redo, undo } from '@codemirror/commands'",
    "import { defaultKeymap, history, historyKeymap, isolateHistory, redo, redoDepth, undo, undoDepth } from '@codemirror/commands'",
    1,
)
text = text.replace(
    """  mentionTerms?: CodexMentionTerm[]\n  onMentionClick?: (mention: CodexMentionClick) => void\n}\n""",
    """  mentionTerms?: CodexMentionTerm[]\n  onMentionClick?: (mention: CodexMentionClick) => void\n  onHistoryChange?: (state: { canUndo: boolean; canRedo: boolean }) => void\n}\n""",
    1,
)
text = text.replace(
    """  { value, onChange, ariaLabel = 'Markdown editor', className = '', readOnly = false, mentionTerms = [], onMentionClick },\n""",
    """  { value, onChange, ariaLabel = 'Markdown editor', className = '', readOnly = false, mentionTerms = [], onMentionClick, onHistoryChange },\n""",
    1,
)
text = text.replace(
    """  const onChangeRef = useRef(onChange)\n  const mentionTermsRef = useRef(mentionTerms)\n""",
    """  const onChangeRef = useRef(onChange)\n  const onHistoryChangeRef = useRef(onHistoryChange)\n  const mentionTermsRef = useRef(mentionTerms)\n""",
    1,
)
text = text.replace(
    """  useEffect(() => { onChangeRef.current = onChange }, [onChange])\n  useEffect(() => { onMentionClickRef.current = onMentionClick }, [onMentionClick])\n""",
    """  useEffect(() => { onChangeRef.current = onChange }, [onChange])\n  useEffect(() => { onHistoryChangeRef.current = onHistoryChange }, [onHistoryChange])\n  useEffect(() => { onMentionClickRef.current = onMentionClick }, [onMentionClick])\n""",
    1,
)
text = text.replace(
    """        EditorView.updateListener.of(update => {\n          if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(dictationProvisional))) onChangeRef.current(update.state.doc.toString())\n        }),\n""",
    """        EditorView.updateListener.of(update => {\n          if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(dictationProvisional))) onChangeRef.current(update.state.doc.toString())\n          if (update.docChanged || update.transactions.length) {\n            onHistoryChangeRef.current?.({ canUndo: undoDepth(update.state) > 0, canRedo: redoDepth(update.state) > 0 })\n          }\n        }),\n""",
    1,
)
text = text.replace(
    """    viewRef.current = view\n    if (mentionTermsRef.current.length) view.dispatch({ effects: setMentionTerms.of(mentionTermsRef.current) })\n""",
    """    viewRef.current = view\n    onHistoryChangeRef.current?.({ canUndo: undoDepth(view.state) > 0, canRedo: redoDepth(view.state) > 0 })\n    if (mentionTermsRef.current.length) view.dispatch({ effects: setMentionTerms.of(mentionTermsRef.current) })\n""",
    1,
)
p.write_text(text)

# Workspace: subscribe to TTS, track editor history, feed the transformed control.
p = Path('src/Workspace.tsx')
text = p.read_text()
text = text.replace(
    """  const [lastGeneratedPassage, setLastGeneratedPassage] = useState('')\n  const [sttState, setSttState] = useState<SttState>(() => getSttState())\n""",
    """  const [lastGeneratedPassage, setLastGeneratedPassage] = useState('')\n  const [sttState, setSttState] = useState<SttState>(() => getSttState())\n  const [ttsState, setTtsState] = useState<TtsState>(() => getTtsState())\n  const [editorHistory, setEditorHistory] = useState({ canUndo: false, canRedo: false })\n""",
    1,
)
text = text.replace(
    """  useEffect(() => subscribeSttState(setSttState), [])\n\n""",
    """  useEffect(() => subscribeSttState(setSttState), [])\n  useEffect(() => subscribeTtsState(setTtsState), [])\n\n""",
    1,
)
text = text.replace(
    """    setLastGeneratedPassage('')\n    setCodexTriggerDraft(activeDocument?.type === 'codexEntry' ? (activeDocument.autoIncludeTriggers ?? []).join('\\n') : '')\n""",
    """    setLastGeneratedPassage('')\n    setEditorHistory({ canUndo: false, canRedo: false })\n    setCodexTriggerDraft(activeDocument?.type === 'codexEntry' ? (activeDocument.autoIncludeTriggers ?? []).join('\\n') : '')\n""",
    1,
)
text = text.replace(
    """        {activeDocument ? <MarkdownEditor key={`${activeDocument.id}-${editorRevision}`} ref={editorRef} value={storyMarkdown} onChange={handleStoryChange} ariaLabel={`${activeDocument.title} Markdown editor`} readOnly={activeCodexArchived || activeSummarySourceArchived} mentionTerms={activeDocument.type === 'scene' ? codexMentionIndex : []} onMentionClick={activeDocument.type === 'scene' ? openLoreMention : undefined} /> : <div className=\"empty-editor\">""",
    """        {activeDocument ? <MarkdownEditor key={`${activeDocument.id}-${editorRevision}`} ref={editorRef} value={storyMarkdown} onChange={handleStoryChange} onHistoryChange={setEditorHistory} ariaLabel={`${activeDocument.title} Markdown editor`} readOnly={activeCodexArchived || activeSummarySourceArchived} mentionTerms={activeDocument.type === 'scene' ? codexMentionIndex : []} onMentionClick={activeDocument.type === 'scene' ? openLoreMention : undefined} /> : <div className=\"empty-editor\">""",
    1,
)
old_call = """      {screen === 'editor' && (activeDocument?.type === 'scene' || (activeDocument?.type === 'codexEntry' && !activeCodexArchived)) && !arcOpen && <div className=\"editor-bottom\"><button type=\"button\" onClick={() => setArcOpen(true)} aria-label=\"Open generation input\"><PanelBottomOpen aria-hidden=\"true\" /></button><GenerateControl isGenerating={generationActive} phase={generationPhase} elapsedSeconds={generationElapsedSeconds} onOpenDetails={() => setGenerationDetailsOpen(true)} onGenerate={generate} onStop={stopGeneration} onMicro={() => { void dictateEditor() }} onMicro2={() => { void dictateInstruction() }} onUndo={() => editorRef.current?.undo()} onRedo={() => editorRef.current?.redo()} onRegenerate={regenerate} onReadAloud={() => { void readCurrentDocument() }} readAloudDisabled={activeDocument?.type === 'scene' && !lastGeneratedPassage.trim()} readAloudTitle={activeDocument?.type === 'scene' ? 'Read latest generated passage' : 'Read full Codex entry'} /></div>}\n"""
new_call = """      {screen === 'editor' && (activeDocument?.type === 'scene' || (activeDocument?.type === 'codexEntry' && !activeCodexArchived)) && !arcOpen && <div className=\"editor-bottom\"><button type=\"button\" onClick={() => setArcOpen(true)} aria-label=\"Open generation input\"><PanelBottomOpen aria-hidden=\"true\" /></button><GenerateControl isGenerating={generationActive} phase={generationPhase} elapsedSeconds={generationElapsedSeconds} sttState={sttState} ttsState={ttsState} canUndo={editorHistory.canUndo} canRedo={editorHistory.canRedo} onOpenDetails={() => setGenerationDetailsOpen(true)} onGenerate={generate} onStop={stopGeneration} onMicro={() => { void dictateEditor() }} onMicro2={() => { void dictateInstruction() }} onUndo={() => editorRef.current?.undo()} onRedo={() => editorRef.current?.redo()} onRegenerate={regenerate} onReadAloud={() => { void readCurrentDocument() }} readAloudDisabled={activeDocument?.type === 'scene' && !lastGeneratedPassage.trim()} readAloudTitle={activeDocument?.type === 'scene' ? 'Read latest generated passage' : 'Read full Codex entry'} /></div>}\n"""
if old_call not in text: raise SystemExit('GenerateControl call not found')
text = text.replace(old_call, new_call, 1)

start = text.index('function GenerateControl(')
end = text.index('\nfunction AutotitlePanel(', start)
new_component = r'''function GenerateControl({ isGenerating, phase, elapsedSeconds, sttState, ttsState, canUndo, canRedo, onOpenDetails, onGenerate, onStop, onMicro, onMicro2, onUndo, onRedo, onRegenerate, onReadAloud, readAloudDisabled, readAloudTitle }: {
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
  const [expanded, setExpanded] = useState(false)
  const [pressing, setPressing] = useState(false)
  const [speechElapsed, setSpeechElapsed] = useState(0)
  const longPressRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const sttActive = (sttState.target === 'editor' || sttState.target === 'instruction') && ['requesting-permission', 'recording', 'recording-live', 'stopping', 'transcribing', 'finalizing'].includes(sttState.status)
  const ttsActive = ['preparing', 'generating', 'playing', 'paused', 'waiting', 'stopping'].includes(ttsState.status)

  useEffect(() => {
    if (!sttActive || !sttState.startedAt || !['recording', 'recording-live'].includes(sttState.status)) { setSpeechElapsed(0); return }
    const update = () => setSpeechElapsed(Math.max(0, Math.floor((Date.now() - sttState.startedAt!) / 1000)))
    update()
    const timer = window.setInterval(update, 250)
    return () => window.clearInterval(timer)
  }, [sttActive, sttState.startedAt, sttState.status])

  useEffect(() => {
    if (isGenerating || sttActive || ttsActive) setExpanded(false)
  }, [isGenerating, sttActive, ttsActive])

  function cancelTimer() {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    setPressing(false)
  }

  function startHold() {
    if (isGenerating || sttActive || ttsActive) return
    longPressRef.current = false
    cancelTimer()
    setPressing(true)
    timerRef.current = setTimeout(() => {
      longPressRef.current = true
      setPressing(false)
      setExpanded(true)
    }, 450)
  }

  function collapseAnd(action: () => void) {
    setExpanded(false)
    action()
  }

  if (isGenerating && phase) return <div className="generate-control-shell mode generation-mode">
    <div className="generate-mode-card generation" role="status" aria-live="polite">
      <GenerationActivityStrip phase={phase} elapsedSeconds={elapsedSeconds} placement="floating" onOpenDetails={onOpenDetails} />
      <button className="generate-mode-stop" type="button" onClick={onStop} aria-label="Stop generation"><Square aria-hidden="true" fill="currentColor" /><span>Stop</span></button>
    </div>
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

  return <div className={`generate-control-shell ${expanded ? 'expanded' : ''}`}>
    {expanded && <section className="generate-panel" role="toolbar" aria-label="Generate actions">
      <div className="generate-panel-primary">
        <button type="button" className="generate-action labeled" onClick={() => collapseAnd(onMicro)}><Mic aria-hidden="true" /><span>Dictate editor</span></button>
        <button type="button" className="generate-action labeled" onClick={() => collapseAnd(onMicro2)}><Mic aria-hidden="true" /><span>Dictate instruction</span></button>
        <button type="button" className="generate-action labeled" onClick={() => collapseAnd(onRegenerate)}><RefreshCw aria-hidden="true" /><span>Regenerate</span></button>
        <button type="button" className="generate-action labeled" onClick={() => collapseAnd(onReadAloud)} disabled={readAloudDisabled} aria-label={readAloudTitle || 'Read aloud'} title={readAloudDisabled ? 'No latest generated passage is available' : readAloudTitle || 'Read aloud'}><Volume2 aria-hidden="true" /><span>Read aloud</span></button>
      </div>
      <div className="generate-panel-utilities">
        <button type="button" className="generate-action icon-only" onClick={onUndo} disabled={!canUndo} aria-label="Undo editor change" title={canUndo ? 'Undo' : 'Nothing to undo'}><Undo2 aria-hidden="true" /></button>
        <button type="button" className="generate-action icon-only" onClick={onRedo} disabled={!canRedo} aria-label="Redo editor change" title={canRedo ? 'Redo' : 'Nothing to redo'}><Redo2 aria-hidden="true" /></button>
        <button type="button" className="generate-action icon-only collapse" onClick={() => { setExpanded(false); triggerRef.current?.focus() }} aria-label="Collapse generate actions" title="Collapse"><X aria-hidden="true" /></button>
      </div>
    </section>}
    <button
      ref={triggerRef}
      className={`play generate-trigger transformed ${pressing ? 'pressing' : ''} ${expanded ? 'expanded' : ''}`}
      type="button"
      aria-haspopup="toolbar"
      aria-expanded={expanded}
      aria-label="Generate. Press and hold, or press Arrow Up, for more actions."
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp') { event.preventDefault(); cancelTimer(); setExpanded(true) }
        if (event.key === 'Escape' && expanded) { event.preventDefault(); setExpanded(false) }
      }}
      onPointerDown={startHold}
      onPointerUp={cancelTimer}
      onPointerCancel={cancelTimer}
      onPointerLeave={cancelTimer}
      onClick={() => {
        if (longPressRef.current) { longPressRef.current = false; return }
        setExpanded(false)
        onGenerate()
      }}
    ><span className="generate-hold-ring" aria-hidden="true"><svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="21" /></svg></span><Play aria-hidden="true" fill="currentColor" /><span className="generate-trigger-label">Generate</span></button>
  </div>
}
'''
text = text[:start] + new_component + text[end:]
p.write_text(text)

# CSS: anchored transformed control, semantic state treatment, mobile/safe-area rules.
p = Path('src/generation-controls.css')
css = p.read_text()
css += r'''

/* Issue #81 — anchored transformed Generate control */
.generate-control-shell {
  --generate-surface: color-mix(in srgb, var(--deep) 90%, transparent);
  --generate-surface-raised: color-mix(in srgb, var(--deep) 78%, var(--accent) 6%);
  --generate-border: color-mix(in srgb, var(--line) 84%, var(--accent) 16%);
  --generate-muted: var(--faint);
  position: relative;
  pointer-events: auto;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
}

.generate-trigger.transformed {
  position: relative;
  width: auto;
  min-width: 50px;
  height: 50px;
  padding: 0 15px;
  gap: 8px;
  overflow: visible;
  border: 1px solid color-mix(in srgb, var(--accent) 52%, var(--line));
  box-shadow: 0 12px 34px rgba(0,0,0,.34), inset 0 1px 0 rgba(255,255,255,.07);
  transition: transform .14s ease, background-color .16s ease, border-color .16s ease, box-shadow .16s ease;
}
.generate-trigger.transformed:active,
.generate-trigger.transformed.pressing { transform: scale(.96); }
.generate-trigger-label { font: 700 10px ui-sans-serif, system-ui, sans-serif; letter-spacing: .03em; }
.generate-hold-ring { position: absolute; inset: -5px; pointer-events: none; opacity: 0; }
.generate-hold-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
.generate-hold-ring circle { fill: none; stroke: var(--accent); stroke-width: 2; stroke-linecap: round; stroke-dasharray: 132; stroke-dashoffset: 132; }
.generate-trigger.pressing .generate-hold-ring { opacity: 1; }
.generate-trigger.pressing .generate-hold-ring circle { animation: generate-hold-progress .45s linear forwards; }

.generate-panel {
  position: absolute;
  z-index: 5;
  right: 0;
  bottom: calc(100% + 10px);
  width: min(292px, calc(100vw - 28px));
  padding: 9px;
  border: 1px solid var(--generate-border);
  border-radius: 16px;
  background: var(--generate-surface);
  box-shadow: 0 18px 50px rgba(0,0,0,.42);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  transform-origin: right bottom;
  animation: generate-panel-in .16s ease-out both;
}
.generate-panel::after {
  content: '';
  position: absolute;
  right: 20px;
  bottom: -6px;
  width: 11px;
  height: 11px;
  border-right: 1px solid var(--generate-border);
  border-bottom: 1px solid var(--generate-border);
  background: var(--generate-surface);
  transform: rotate(45deg);
}
.generate-panel-primary { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
.generate-panel-utilities { display: flex; gap: 6px; margin-top: 7px; padding-top: 7px; border-top: 1px solid var(--line); }
.generate-action {
  min-height: 42px;
  border: 1px solid var(--line);
  border-radius: 11px;
  background: color-mix(in srgb, var(--deep) 72%, transparent);
  color: var(--soft);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  cursor: pointer;
  transition: transform .12s ease, background-color .14s ease, color .14s ease, border-color .14s ease, opacity .14s ease;
}
.generate-action.labeled { justify-content: flex-start; padding: 0 10px; font: 600 9px ui-sans-serif, system-ui, sans-serif; text-align: left; }
.generate-action.icon-only { width: 42px; padding: 0; flex: none; }
.generate-action.collapse { margin-left: auto; }
.generate-action svg { width: 15px; height: 15px; flex: none; }
.generate-action:hover, .generate-action:focus-visible { color: var(--ink); border-color: color-mix(in srgb, var(--accent) 44%, var(--line)); background: var(--generate-surface-raised); }
.generate-action:active { transform: scale(.96); }
.generate-action:disabled { cursor: default; opacity: .34; text-decoration: none; }
.generate-action:disabled svg { opacity: .72; }

.generate-control-shell.mode { max-width: min(420px, calc(100vw - 24px)); }
.generate-mode-card {
  min-height: 52px;
  max-width: min(420px, calc(100vw - 24px));
  padding: 8px 9px 8px 11px;
  border: 1px solid var(--generate-border);
  border-radius: 16px;
  background: var(--generate-surface);
  box-shadow: 0 14px 40px rgba(0,0,0,.36);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  display: flex;
  align-items: center;
  gap: 9px;
}
.generate-mode-card > svg { width: 18px; height: 18px; flex: none; }
.generate-mode-card > span { min-width: 0; display: grid; gap: 2px; }
.generate-mode-card > span strong { color: var(--ink); font: 650 10px ui-sans-serif, system-ui, sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.generate-mode-card > span small { color: var(--generate-muted); font: 9px ui-sans-serif, system-ui, sans-serif; white-space: nowrap; }
.generate-mode-actions { margin-left: auto; display: flex; gap: 6px; }
.generate-mode-actions button, .generate-mode-stop {
  min-height: 36px;
  padding: 0 9px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: color-mix(in srgb, var(--deep) 70%, transparent);
  color: var(--ink);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: 650 9px ui-sans-serif, system-ui, sans-serif;
  cursor: pointer;
}
.generate-mode-actions button svg, .generate-mode-stop svg { width: 14px; height: 14px; }
.generate-mode-card.dictation { border-color: color-mix(in srgb, #c48372 48%, var(--line)); }
.generate-mode-card.dictation > svg { color: #dca08e; }
.generate-mode-card.playback { border-color: color-mix(in srgb, var(--accent) 46%, var(--line)); }
.generate-mode-card.playback > svg { color: var(--accent); }
.generate-control-shell.generation-mode .generate-mode-card { padding-left: 8px; }
.generate-control-shell.generation-mode .generation-activity-strip { box-shadow: none; }
.generate-mode-stop { margin-left: auto; background: color-mix(in srgb, #a85f55 72%, var(--deep)); color: #fff; border-color: color-mix(in srgb, #d8897d 56%, var(--line)); }

.chat-generate-main,
.chat-generate-menu button,
.chat-thinking-toggle {
  transition: transform .12s ease, border-color .14s ease, background-color .14s ease, opacity .14s ease;
}
.chat-generate-main:active,
.chat-generate-menu button:active,
.chat-thinking-toggle:active { transform: scale(.96); }

@keyframes generate-hold-progress { to { stroke-dashoffset: 0; } }
@keyframes generate-panel-in { from { opacity: 0; transform: translateY(6px) scale(.97); } to { opacity: 1; transform: translateY(0) scale(1); } }

@media (max-width: 560px) {
  .generate-panel { width: min(274px, calc(100vw - 20px)); right: 0; bottom: calc(100% + 9px); }
  .generate-panel-primary { grid-template-columns: 1fr; }
  .generate-action.labeled { min-height: 40px; }
  .generate-trigger.transformed { min-width: 48px; padding: 0 13px; }
  .generate-trigger-label { display: none; }
  .generate-mode-card { max-width: calc(100vw - 18px); }
  .generate-mode-card > span small { white-space: normal; }
}

@media (max-height: 540px) {
  .generate-panel { bottom: auto; top: calc(100% + 9px); transform-origin: right top; }
  .generate-panel::after { top: -6px; bottom: auto; border: 0; border-left: 1px solid var(--generate-border); border-top: 1px solid var(--generate-border); }
}

@media (prefers-reduced-motion: reduce) {
  .generate-trigger.transformed,
  .generate-action,
  .generate-panel,
  .chat-generate-main,
  .chat-generate-menu button,
  .chat-thinking-toggle { transition: none; animation: none; }
  .generate-trigger.pressing .generate-hold-ring circle { animation: none; stroke-dashoffset: 0; }
}
'''
p.write_text(css)

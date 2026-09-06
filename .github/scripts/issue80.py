from pathlib import Path
import re


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'{label} not found in {path}')
    p.write_text(text.replace(old, new, 1))

# Speech settings persistence / migration
replace_once('src/ai-settings.ts', """export type SpeechSettings = {\n  provider: SpeechProvider\n  apiKey: string\n  model: string\n  voice: string\n  readAloudAfterGeneration: boolean\n  maxParallelRequests: string\n}\n""", """export type SpeechSettings = {\n  provider: SpeechProvider\n  apiKey: string\n  model: string\n  voice: string\n  readAloudAfterGeneration: boolean\n  maxParallelRequests: string\n  openaiApiKey: string\n  transcriptionModel: string\n  transcriptionLanguage: string\n  streamTranscription: boolean\n}\n""", 'speech type')
replace_once('src/ai-settings.ts', """  readAloudAfterGeneration: false,\n  maxParallelRequests: '1',\n}\n""", """  readAloudAfterGeneration: false,\n  maxParallelRequests: '1',\n  openaiApiKey: '',\n  transcriptionModel: 'openai:whisper-1',\n  transcriptionLanguage: 'auto',\n  streamTranscription: false,\n}\n""", 'speech defaults')
replace_once('src/ai-settings.ts', """    readAloudAfterGeneration: speech.readAloudAfterGeneration === true,\n    maxParallelRequests: String(concurrency),\n  }\n""", """    readAloudAfterGeneration: speech.readAloudAfterGeneration === true,\n    maxParallelRequests: String(concurrency),\n    openaiApiKey: typeof speech.openaiApiKey === 'string' ? speech.openaiApiKey : '',\n    transcriptionModel: typeof speech.transcriptionModel === 'string' && speech.transcriptionModel.trim() ? speech.transcriptionModel : initialSpeechSettings.transcriptionModel,\n    transcriptionLanguage: typeof speech.transcriptionLanguage === 'string' && speech.transcriptionLanguage.trim() ? speech.transcriptionLanguage.trim() : 'auto',\n    streamTranscription: speech.streamTranscription === true,\n  }\n""", 'speech normalize')

# Expandable textarea must honor readOnly in expanded mode too.
replace_once('src/ExpandableTextInput.tsx', """          <textarea ref={expandedRef} value={draft} onChange={(event) => setDraft(event.target.value)} aria-label={`Expanded ${ariaLabel}`} />\n""", """          <textarea ref={expandedRef} value={draft} onChange={(event) => setDraft(event.target.value)} aria-label={`Expanded ${ariaLabel}`} readOnly={textareaProps.readOnly} disabled={textareaProps.disabled} spellCheck={textareaProps.spellCheck} />\n""", 'expanded readOnly')

# Markdown editor: captured dictation transaction with provisional changes excluded from history/autosave.
p = Path('src/MarkdownEditor.tsx')
text = p.read_text()
text = text.replace("import { EditorState, StateEffect, StateField, Transaction } from '@codemirror/state'", "import { Annotation, Compartment, EditorState, StateEffect, StateField, Transaction } from '@codemirror/state'", 1)
text = text.replace("import { findTriggerRanges, type CodexMentionTerm } from './codex-trigger-service'", "import { findTriggerRanges, type CodexMentionTerm } from './codex-trigger-service'\nimport { normalizeTranscriptForInsertion } from './stt-service'", 1)
text = text.replace("""  finishGeneration: (status: GenerationStatus) => GenerationResult | null\n  insertSpeech: () => boolean\n  undo: () => boolean\n""", """  finishGeneration: (status: GenerationStatus) => GenerationResult | null\n  beginDictation: () => string | null\n  updateDictation: (sessionId: string, transcript: string) => boolean\n  finishDictation: (sessionId: string, transcript: string) => boolean\n  cancelDictation: (sessionId: string) => boolean\n  undo: () => boolean\n""", 1)
text = text.replace("\nconst SPEECH_TEXT = 'speech placeholder'\n", "\ntype ActiveDictation = { id: string; preDocument: string; from: number; to: number; provisional: string }\nconst dictationProvisional = Annotation.define<boolean>()\n")
anchor = """function insertAtSelection(view: EditorView, text: string) {\n  const selection = view.state.selection.main\n  view.dispatch({\n    changes: { from: selection.from, to: selection.to, insert: text },\n    selection: { anchor: selection.from + text.length },\n    scrollIntoView: true,\n  })\n  view.focus()\n  return true\n}\n\n"""
replacement = """function dictationInsertion(session: ActiveDictation, transcript: string) {\n  const before = session.preDocument.slice(0, session.from)\n  const after = session.preDocument.slice(session.to)\n  return normalizeTranscriptForInsertion(transcript, before, after)\n}\n\nfunction dictationDocument(session: ActiveDictation, transcript: string) {\n  const insertion = dictationInsertion(session, transcript)\n  return {\n    insertion,\n    document: `${session.preDocument.slice(0, session.from)}${insertion}${session.preDocument.slice(session.to)}`,\n    cursor: session.from + insertion.length,\n  }\n}\n\n"""
if anchor not in text: raise SystemExit('markdown insert helper not found')
text = text.replace(anchor, replacement, 1)
text = text.replace("""  const activeGenerationRef = useRef<ActiveGeneration | null>(null)\n  const latestGenerationRef = useRef<GenerationRecord | null>(null)\n""", """  const activeGenerationRef = useRef<ActiveGeneration | null>(null)\n  const latestGenerationRef = useRef<GenerationRecord | null>(null)\n  const activeDictationRef = useRef<ActiveDictation | null>(null)\n  const editableCompartmentRef = useRef(new Compartment())\n""", 1)
old = """    insertSpeech: () => viewRef.current ? insertAtSelection(viewRef.current, SPEECH_TEXT) : false,\n    undo: () => runHistoryCommand(viewRef.current, undo),\n"""
new = """    beginDictation: () => {\n      const view = viewRef.current\n      if (!view || activeGenerationRef.current || activeDictationRef.current || readOnly) return null\n      const selection = view.state.selection.main\n      const session: ActiveDictation = {\n        id: `dictation-${Date.now()}-${Math.random().toString(36).slice(2)}`,\n        preDocument: view.state.doc.toString(),\n        from: selection.from,\n        to: selection.to,\n        provisional: '',\n      }\n      activeDictationRef.current = session\n      view.dispatch({ effects: editableCompartmentRef.current.reconfigure(EditorView.editable.of(false)) })\n      return session.id\n    },\n    updateDictation: (sessionId, transcript) => {\n      const view = viewRef.current\n      const session = activeDictationRef.current\n      if (!view || !session || session.id !== sessionId) return false\n      const next = dictationDocument(session, transcript)\n      view.dispatch({\n        changes: { from: 0, to: view.state.doc.length, insert: next.document },\n        selection: { anchor: next.cursor },\n        annotations: [Transaction.addToHistory.of(false), dictationProvisional.of(true)],\n      })\n      session.provisional = transcript\n      return true\n    },\n    finishDictation: (sessionId, transcript) => {\n      const view = viewRef.current\n      const session = activeDictationRef.current\n      if (!view || !session || session.id !== sessionId) return false\n      if (session.provisional) view.dispatch({\n        changes: { from: 0, to: view.state.doc.length, insert: session.preDocument },\n        annotations: [Transaction.addToHistory.of(false), dictationProvisional.of(true)],\n      })\n      const insertion = dictationInsertion(session, transcript)\n      view.dispatch({\n        changes: { from: session.from, to: session.to, insert: insertion },\n        selection: { anchor: session.from + insertion.length },\n        annotations: [Transaction.userEvent.of('input.type.dictation'), isolateHistory.of('full')],\n        effects: editableCompartmentRef.current.reconfigure(EditorView.editable.of(!readOnly)),\n      })\n      activeDictationRef.current = null\n      view.focus()\n      return true\n    },\n    cancelDictation: (sessionId) => {\n      const view = viewRef.current\n      const session = activeDictationRef.current\n      if (!view || !session || session.id !== sessionId) return false\n      if (view.state.doc.toString() !== session.preDocument) view.dispatch({\n        changes: { from: 0, to: view.state.doc.length, insert: session.preDocument },\n        selection: { anchor: session.from, head: session.to },\n        annotations: [Transaction.addToHistory.of(false), dictationProvisional.of(true)],\n      })\n      view.dispatch({ effects: editableCompartmentRef.current.reconfigure(EditorView.editable.of(!readOnly)) })\n      activeDictationRef.current = null\n      return true\n    },\n    undo: () => runHistoryCommand(viewRef.current, undo),\n"""
if old not in text: raise SystemExit('markdown handle speech not found')
text = text.replace(old, new, 1)
text = text.replace("""        EditorState.readOnly.of(readOnly),\n        EditorView.editable.of(!readOnly),\n""", """        EditorState.readOnly.of(readOnly),\n        editableCompartmentRef.current.of(EditorView.editable.of(!readOnly)),\n""", 1)
text = text.replace("""        EditorView.updateListener.of(update => {\n          if (update.docChanged) onChangeRef.current(update.state.doc.toString())\n        }),\n""", """        EditorView.updateListener.of(update => {\n          if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(dictationProvisional))) onChangeRef.current(update.state.doc.toString())\n        }),\n""", 1)
text = text.replace("""      activeGenerationRef.current = null\n      view.destroy()\n""", """      activeGenerationRef.current = null\n      activeDictationRef.current = null\n      view.destroy()\n""", 1)
p.write_text(text)

# AI Speech settings UI
p = Path('src/App.tsx')
text = p.read_text()
text = text.replace("  MessageCircle,\n  Plus,", "  MessageCircle,\n  Mic,\n  Plus,", 1)
text = text.replace("import { fetchSpeechModels, type SpeechModel } from './tts-service'", "import { fetchSpeechModels, type SpeechModel } from './tts-service'\nimport { fetchTranscriptionModels, type SttModel } from './stt-service'", 1)
start = text.index("function SpeechSettingsPanel(")
end = text.index("function SettingsPlaceholder(", start)
new_panel = r'''function SpeechSettingsPanel({ settings, scope, onChange }: { settings: AiSettings; scope: 'book' | 'defaults'; onChange: (speech: AiSettings['speech']) => void }) {
  const [models, setModels] = useState<SpeechModel[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [sttModels, setSttModels] = useState<SttModel[]>([])
  const [sttQuery, setSttQuery] = useState('')
  const [sttLoading, setSttLoading] = useState(false)
  const [sttMessage, setSttMessage] = useState('')
  const selected = models.find((model) => model.id === settings.speech.model)
  const selectedStt = sttModels.find((model) => model.id === settings.speech.transcriptionModel)
  const voices = selected?.voices ?? []
  const filtered = models.filter((model) => !query.trim() || `${model.id} ${model.name}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 80)
  const filteredStt = sttModels.filter((model) => !sttQuery.trim() || `${model.provider} ${model.modelId} ${model.name}`.toLowerCase().includes(sttQuery.trim().toLowerCase())).slice(0, 100)

  async function loadModels() {
    setLoading(true)
    setMessage('Loading NanoGPT audio models…')
    try {
      const next = await fetchSpeechModels(settings.speech.apiKey)
      setModels(next)
      setMessage(next.length ? `${next.length} text-to-speech models available.` : 'NanoGPT returned no text-to-speech models.')
    } catch (error) {
      setModels([])
      setMessage(error instanceof Error ? error.message : 'Could not load NanoGPT audio models.')
    } finally { setLoading(false) }
  }

  async function loadSttModels() {
    setSttLoading(true)
    setSttMessage('Loading transcription models…')
    try {
      const next = await fetchTranscriptionModels(settings.speech)
      setSttModels(next)
      setSttMessage(next.length ? `${next.length} transcription models available across OpenAI and NanoGPT.` : 'No transcription models were returned.')
    } catch (error) {
      setSttModels([])
      setSttMessage(error instanceof Error ? error.message : 'Could not load transcription models.')
    } finally { setSttLoading(false) }
  }

  useEffect(() => { void loadModels(); void loadSttModels() }, [])
  const updateSpeech = (patch: Partial<AiSettings['speech']>) => onChange({ ...settings.speech, ...patch })
  const unavailableModel = models.length > 0 && !selected
  const unavailableVoice = Boolean(selected?.voices.length && settings.speech.voice && !selected.voices.includes(settings.speech.voice))
  const unavailableStt = sttModels.length > 0 && !selectedStt
  const liveSupported = selectedStt?.supportsLive === true

  return <section className="speech-settings">
    <header className="page-heading"><div><p>{scope === 'book' ? 'Book Speech' : 'Default Speech'}</p><h1 id="page-title">Speech</h1><span>{scope === 'book' ? 'Independent TTS and dictation settings for this book.' : 'Copied into each new book, then edited independently.'}</span></div><Volume2 aria-hidden="true" /></header>
    <section className="settings-card">
      <div className="card-heading"><div><span>01</span><h2>Speech credentials</h2></div><p>Speech credentials are separate from text AI.</p></div>
      <div className="speech-settings-grid">
        <label><span>NanoGPT Speech API key</span><div className="speech-key-row"><input type="password" value={settings.speech.apiKey} onChange={(event) => updateSpeech({ apiKey: event.target.value })} autoComplete="off" spellCheck={false} />{settings.provider === 'nanogpt' && settings.apiKey.trim() && <button type="button" onClick={() => updateSpeech({ apiKey: settings.apiKey })}>Copy NanoGPT key from AI settings</button>}</div><small className="speech-help">Used by NanoGPT TTS and NanoGPT transcription models.</small></label>
        <label><span>OpenAI Speech API key</span><input type="password" value={settings.speech.openaiApiKey} onChange={(event) => updateSpeech({ openaiApiKey: event.target.value })} autoComplete="off" spellCheck={false} /><small className="speech-help">Used only for OpenAI transcription. Stored with this Speech configuration on this device.</small></label>
      </div>
    </section>
    <section className="settings-card">
      <div className="card-heading"><div><span>02</span><h2>Text to speech</h2></div><button type="button" onClick={() => { void loadModels() }} disabled={loading}><RefreshCw className={loading ? 'spinning' : ''} aria-hidden="true" /> Reload</button></div>
      <div className="speech-model-search"><Search aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search TTS models" /></div>
      {message && <p className="speech-help">{message}</p>}
      {unavailableModel && <p className="speech-model-unavailable" role="alert">Saved model “{settings.speech.model}” is unavailable. Arc will not silently switch paid models.</p>}
      <div className="speech-model-list">{filtered.map((model) => <button type="button" key={model.id} className={model.id === settings.speech.model ? 'selected' : ''} onClick={() => updateSpeech({ model: model.id, voice: model.voices.includes(settings.speech.voice) ? settings.speech.voice : model.voices[0] ?? '' })}><span><strong>{model.name}</strong><small>{model.id}</small></span><small>{model.averagePrice ? `Avg. ${model.averagePrice}` : 'Price not supplied'}</small></button>)}</div>
      <div className="speech-settings-grid">
        <label><span>Voice</span><select value={settings.speech.voice} onChange={(event) => updateSpeech({ voice: event.target.value })}>{unavailableVoice && <option value={settings.speech.voice}>{settings.speech.voice} — unavailable</option>}{!voices.length && settings.speech.voice && <option value={settings.speech.voice}>{settings.speech.voice}</option>}{voices.map((voice) => <option key={voice} value={voice}>{voice}</option>)}</select>{unavailableVoice && <small className="speech-model-unavailable">Choose an available voice before reading aloud.</small>}</label>
        <label><span>Maximum parallel TTS requests</span><input type="number" min="1" max="8" value={settings.speech.maxParallelRequests} onChange={(event) => updateSpeech({ maxParallelRequests: event.target.value })} /><small className="speech-help">Default 1. Audio may generate concurrently but always plays in prose order.</small></label>
      </div>
      <label className="speech-toggle"><span><input type="checkbox" checked={settings.speech.readAloudAfterGeneration} onChange={(event) => updateSpeech({ readAloudAfterGeneration: event.target.checked })} /> Read aloud after generation</span><small className="speech-help">Story reads only the latest generated passage; Codex reads the resulting entry; Chat reads the new visible assistant answer.</small></label>
    </section>
    <section className="settings-card stt-settings-card">
      <div className="card-heading"><div><span>03</span><h2>Speech to text</h2></div><button type="button" onClick={() => { void loadSttModels() }} disabled={sttLoading}><RefreshCw className={sttLoading ? 'spinning' : ''} aria-hidden="true" /> Reload</button></div>
      <p className="speech-help">Dictation sends microphone audio only to the provider named by the selected transcription model. Raw recordings are not stored by Arc.</p>
      <div className="speech-model-search"><Search aria-hidden="true" /><input value={sttQuery} onChange={(event) => setSttQuery(event.target.value)} placeholder="Search transcription models" /></div>
      {sttMessage && <p className="speech-help">{sttMessage}</p>}
      {unavailableStt && <p className="speech-model-unavailable" role="alert">Saved transcription model “{settings.speech.transcriptionModel}” is unavailable in the loaded catalogs. Arc will not silently substitute another paid model.</p>}
      <div className="speech-model-list stt-model-list">{filteredStt.map((model) => <button type="button" key={model.id} className={model.id === settings.speech.transcriptionModel ? 'selected' : ''} onClick={() => updateSpeech({ transcriptionModel: model.id, streamTranscription: model.supportsLive })}><span><strong>{model.provider === 'openai' ? 'OpenAI' : 'NanoGPT'} · {model.name}</strong><small>{model.modelId} · {model.supportsLive ? 'Live + file transcription' : 'File transcription'}</small></span><small>{model.price || 'Price not supplied by catalog'}</small></button>)}</div>
      <div className="speech-settings-grid">
        <label><span>Language hint</span><input value={settings.speech.transcriptionLanguage === 'auto' ? '' : settings.speech.transcriptionLanguage} onChange={(event) => updateSpeech({ transcriptionLanguage: event.target.value.trim() || 'auto' })} placeholder="Auto-detect" /><small className="speech-help">Leave empty for Auto-detect. Enter a provider-supported language code/name to provide a hint.</small></label>
        <label className="speech-toggle stt-live-toggle"><span><input type="checkbox" checked={settings.speech.streamTranscription && liveSupported} disabled={!liveSupported} onChange={(event) => updateSpeech({ streamTranscription: event.target.checked })} /> Stream text while speaking</span><small className="speech-help">{liveSupported ? 'Supported by this model. Partial text stays provisional until Stop/finalization.' : selectedStt ? 'This selected model does not expose live partial transcription.' : 'Load/select a model to check live-transcription capability.'}</small></label>
      </div>
      {settings.speech.transcriptionModel.startsWith('openai:') && <p className="speech-help"><Mic aria-hidden="true" /> OpenAI live-capable models use a direct browser Realtime connection; ordinary models record locally and upload once after Stop.</p>}
    </section>
  </section>
}

'''
text = text[:start] + new_panel + text[end:]
p.write_text(text)

# Workspace integration
p = Path('src/Workspace.tsx')
text = p.read_text()
text = text.replace("import { dismissTtsState, estimateSpeechRequest, fetchSpeechModels, getTtsState, pauseTtsSession, resumeTtsSession, startTtsSession, stopTtsSession, subscribeTtsState, type TtsState } from './tts-service'", "import { dismissTtsState, estimateSpeechRequest, fetchSpeechModels, getTtsState, pauseTtsSession, resumeTtsSession, startTtsSession, stopTtsSession, subscribeTtsState, type TtsState } from './tts-service'\nimport { cancelSttSession, dismissSttState, getSttState, normalizeTranscriptForInsertion, startSttSession, stopSttSession, subscribeSttState, type SttState } from './stt-service'", 1)
text = text.replace("""  const [lastGeneratedPassage, setLastGeneratedPassage] = useState('')\n""", """  const [lastGeneratedPassage, setLastGeneratedPassage] = useState('')\n  const [sttState, setSttState] = useState<SttState>(() => getSttState())\n""", 1)
text = text.replace("""  useEffect(() => () => {\n    generationAbortRef.current?.abort()\n""", """  useEffect(() => subscribeSttState(setSttState), [])\n\n  useEffect(() => () => {\n    generationAbortRef.current?.abort()\n""", 1)
old = """  function insertEditorSpeech() {\n    editorRef.current?.insertSpeech()\n  }\n\n  function insertPromptSpeech() {\n    const input = promptRef.current\n    const prompt = activeDocument?.type === 'codexEntry' ? lorePrompt : arcPrompt\n    const setPrompt = activeDocument?.type === 'codexEntry' ? setLorePrompt : setArcPrompt\n    const start = input?.selectionStart ?? prompt.length\n    const end = input?.selectionEnd ?? start\n    const insert = 'speech placeholder'\n    const next = `${prompt.slice(0, start)}${insert}${prompt.slice(end)}`\n    setPrompt(next)\n    requestAnimationFrame(() => {\n      const target = promptRef.current\n      if (!target) return\n      const cursor = start + insert.length\n      target.focus()\n      target.setSelectionRange(cursor, cursor)\n    })\n  }\n"""
new = """  async function currentSpeechSettings() {\n    const defaults = loadAiSettings()\n    return currentBook ? (await getBookAiSettings(currentBook.id, defaults.favorites)).speech : defaults.speech\n  }\n\n  async function dictateEditor() {\n    const documentId = activeDocumentIdRef.current\n    const editor = editorRef.current\n    if (!currentBook || !documentId || !editor || activeDocument?.type === 'summary' || activeCodexArchived) return\n    const sessionId = editor.beginDictation()\n    if (!sessionId) { showToast('The editor is busy and cannot start dictation right now.'); return }\n    try {\n      const speech = await currentSpeechSettings()\n      await startSttSession(speech, {\n        kind: 'editor',\n        label: 'Dictate to editor',\n        isValid: () => activeDocumentIdRef.current === documentId && Boolean(editorRef.current),\n        onProvisional: (transcript) => { if (!editorRef.current?.updateDictation(sessionId, transcript)) throw new Error('The original editor dictation target is no longer available.') },\n        onFinal: (transcript) => { if (!editorRef.current?.finishDictation(sessionId, transcript)) throw new Error('The original editor dictation target is no longer available.') },\n        onCancel: () => { editorRef.current?.cancelDictation(sessionId) },\n      })\n    } catch (error) {\n      editor.cancelDictation(sessionId)\n      showToast(error instanceof Error ? error.message : 'Could not start dictation.')\n    }\n  }\n\n  async function dictateInstruction() {\n    const input = promptRef.current\n    const documentId = activeDocumentIdRef.current\n    if (!input || !documentId || !activeDocument || activeDocument.type === 'summary') return\n    const isLore = activeDocument.type === 'codexEntry'\n    const base = isLore ? lorePrompt : arcPrompt\n    const setPrompt = isLore ? setLorePrompt : setArcPrompt\n    const start = input.selectionStart ?? base.length\n    const end = input.selectionEnd ?? start\n    const render = (transcript: string) => {\n      const insertion = normalizeTranscriptForInsertion(transcript, base.slice(0, start), base.slice(end))\n      return { value: `${base.slice(0, start)}${insertion}${base.slice(end)}`, cursor: start + insertion.length }\n    }\n    try {\n      const speech = await currentSpeechSettings()\n      await startSttSession(speech, {\n        kind: 'instruction',\n        label: 'Dictate instruction',\n        isValid: () => activeDocumentIdRef.current === documentId && Boolean(promptRef.current),\n        onProvisional: (transcript) => setPrompt(render(transcript).value),\n        onFinal: (transcript) => {\n          const next = render(transcript)\n          setPrompt(next.value)\n          requestAnimationFrame(() => { promptRef.current?.focus(); promptRef.current?.setSelectionRange(next.cursor, next.cursor) })\n        },\n        onCancel: () => { if (activeDocumentIdRef.current === documentId) setPrompt(base) },\n      })\n    } catch (error) {\n      setPrompt(base)\n      showToast(error instanceof Error ? error.message : 'Could not start instruction dictation.')\n    }\n  }\n"""
if old not in text: raise SystemExit('workspace speech placeholder functions not found')
text = text.replace(old, new, 1)
text = text.replace("onMicro={insertEditorSpeech} onMicro2={insertPromptSpeech}", "onMicro={() => { void dictateEditor() }} onMicro2={() => { void dictateInstruction() }}", 1)
text = text.replace("aria-label=\"Insert speech placeholder into editor\" title=\"Micro\"", "aria-label=\"Dictate to editor\" title=\"Dictate editor\"", 1)
text = text.replace("aria-label=\"Insert speech placeholder into generation input\" title=\"Micro 2\"", "aria-label=\"Dictate generation instruction\" title=\"Dictate instruction\"", 1)
text = text.replace("""<ExpandableTextInput ref={promptRef} value={activeDocument.type === 'codexEntry' ? lorePrompt : arcPrompt} onChange={activeDocument.type === 'codexEntry' ? setLorePrompt : setArcPrompt} aria-label="generation prompt" dialogTitle="Edit generation prompt" />""", """<ExpandableTextInput ref={promptRef} value={activeDocument.type === 'codexEntry' ? lorePrompt : arcPrompt} onChange={activeDocument.type === 'codexEntry' ? setLorePrompt : setArcPrompt} readOnly={sttState.target === 'instruction' && ['requesting-permission', 'recording', 'recording-live', 'stopping', 'transcribing', 'finalizing'].includes(sttState.status)} aria-label="generation prompt" dialogTitle="Edit generation prompt" />""", 1)
text = text.replace("      <TtsStatusBar />\n", "      <TtsStatusBar />\n      <SttStatusBar />\n", 1)
# Add SttStatusBar immediately before TtsStatusBar.
marker = "function TtsStatusBar() {"
idx = text.index(marker)
stt_bar = r'''function SttStatusBar() {
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
  if (stt.status === 'idle') return null
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

'''
text = text[:idx] + stt_bar + text[idx:]
p.write_text(text)

# Chat composer integration
p = Path('src/ChatFeature.tsx')
text = p.read_text()
text = text.replace("import { startTtsSession } from './tts-service'", "import { startTtsSession } from './tts-service'\nimport { getSttState, normalizeTranscriptForInsertion, startSttSession, subscribeSttState, type SttState } from './stt-service'", 1)
text = text.replace("""  const [followOutput, setFollowOutput] = useState(true)\n""", """  const [followOutput, setFollowOutput] = useState(true)\n  const [sttState, setSttState] = useState<SttState>(() => getSttState())\n""", 1)
text = text.replace("""  useEffect(() => {\n    let cancelled = false\n    abortRef.current?.abort()\n""", """  useEffect(() => subscribeSttState(setSttState), [])\n\n  useEffect(() => {\n    let cancelled = false\n    abortRef.current?.abort()\n""", 1)
old = """  function insertMicroPlaceholder() {\n    const input = inputRef.current\n    const start = input?.selectionStart ?? draft.length\n    const end = input?.selectionEnd ?? start\n    const insert = 'speech placeholder'\n    const next = `${draft.slice(0, start)}${insert}${draft.slice(end)}`\n    setDraft(next)\n    requestAnimationFrame(() => {\n      const target = inputRef.current\n      if (!target) return\n      const cursor = start + insert.length\n      target.focus()\n      target.setSelectionRange(cursor, cursor)\n    })\n  }\n"""
new = """  async function dictateMessage() {\n    if (!chat || generating || chat.id !== selectedChatIdRef.current) return\n    const sourceChatId = chat.id\n    const input = inputRef.current\n    const base = draft\n    const start = input?.selectionStart ?? base.length\n    const end = input?.selectionEnd ?? start\n    const render = (transcript: string) => {\n      const insertion = normalizeTranscriptForInsertion(transcript, base.slice(0, start), base.slice(end))\n      return { value: `${base.slice(0, start)}${insertion}${base.slice(end)}`, cursor: start + insertion.length }\n    }\n    try {\n      const settings = await getChatBookAiSettings(bookId)\n      await startSttSession(settings.speech, {\n        kind: 'chat',\n        label: 'Dictate message',\n        isValid: () => selectedChatIdRef.current === sourceChatId && Boolean(inputRef.current),\n        onProvisional: (transcript) => { if (selectedChatIdRef.current === sourceChatId) setDraft(render(transcript).value) },\n        onFinal: (transcript) => {\n          if (selectedChatIdRef.current !== sourceChatId) throw new Error('The original Chat composer is no longer available.')\n          const next = render(transcript)\n          setDraft(next.value)\n          requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(next.cursor, next.cursor) })\n        },\n        onCancel: () => { if (selectedChatIdRef.current === sourceChatId) setDraft(base) },\n      })\n    } catch (error) {\n      if (selectedChatIdRef.current === sourceChatId) setDraft(base)\n      onToast(error instanceof Error ? error.message : 'Could not start message dictation.')\n    }\n  }\n"""
if old not in text: raise SystemExit('chat placeholder function not found')
text = text.replace(old, new, 1)
text = text.replace("""        <ExpandableTextInput ref={inputRef} value={draft} onChange={setDraft} onKeyDown={(event) => {\n""", """        <ExpandableTextInput ref={inputRef} value={draft} onChange={setDraft} readOnly={sttState.target === 'chat' && ['requesting-permission', 'recording', 'recording-live', 'stopping', 'transcribing', 'finalizing'].includes(sttState.status)} onKeyDown={(event) => {\n""", 1)
text = text.replace("onMicro={insertMicroPlaceholder}", "onMicro={() => { void dictateMessage() }}", 1)
text = text.replace("<Mic aria-hidden=\"true\" /><span>Micro</span>", "<Mic aria-hidden=\"true\" /><span>Dictate message</span>", 1)
p.write_text(text)

# Speech styling
p = Path('src/tts.css')
text = p.read_text()
text += """\n.stt-settings-card { gap: 12px; }\n.stt-model-list button > small { text-align: right; max-width: 180px; }\n.stt-live-toggle { align-self: start; }\n.stt-status.recording svg, .stt-status.recording-live svg { animation: stt-pulse 1.2s ease-in-out infinite; }\n.stt-status.failed { border-color: rgba(255,120,120,.38); }\n@keyframes stt-pulse { 0%,100% { opacity: .55; transform: scale(.94); } 50% { opacity: 1; transform: scale(1.06); } }\n@media (prefers-reduced-motion: reduce) { .stt-status.recording svg, .stt-status.recording-live svg { animation: none; } }\n@media (max-width: 700px) { .stt-model-list button { grid-template-columns: 1fr; } .stt-model-list button > small { text-align: left; max-width: none; } }\n"""
p.write_text(text)

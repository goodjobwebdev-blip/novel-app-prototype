from pathlib import Path
import re


def replace(path: str, old: str, new: str, count: int = 1):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'Missing block in {path}: {old[:160]!r}')
    p.write_text(text.replace(old, new, count))


def insert_before(path: str, marker: str, value: str):
    p = Path(path)
    text = p.read_text()
    if marker not in text:
        raise SystemExit(f'Missing marker in {path}: {marker[:120]!r}')
    p.write_text(text.replace(marker, value + marker, 1))

# AI settings: Speech is independent configuration, but persists/copies with the same defaults -> book settings lifecycle.
replace('src/ai-settings.ts',
"export type AiProvider = 'openrouter' | 'nanogpt' | 'openai' | 'compatible'\n",
"export type AiProvider = 'openrouter' | 'nanogpt' | 'openai' | 'compatible'\nexport type SpeechProvider = 'nanogpt'\nexport type SpeechSettings = {\n  provider: SpeechProvider\n  apiKey: string\n  model: string\n  voice: string\n  readAloudAfterGeneration: boolean\n  maxParallelRequests: string\n}\n\nexport const initialSpeechSettings: SpeechSettings = {\n  provider: 'nanogpt',\n  apiKey: '',\n  model: 'Kokoro-82m',\n  voice: 'af_bella',\n  readAloudAfterGeneration: false,\n  maxParallelRequests: '1',\n}\n")
replace('src/ai-settings.ts',
"  responseLength: string\n  favorites: string[]\n",
"  responseLength: string\n  speech: SpeechSettings\n  favorites: string[]\n")
replace('src/ai-settings.ts',
"  responseLength: '',\n  favorites: [],\n",
"  responseLength: '',\n  speech: initialSpeechSettings,\n  favorites: [],\n")
insert_before('src/ai-settings.ts', 'export function normalizeAiSettings(value?: Partial<AiSettings>): AiSettings {', '''function normalizeSpeechSettings(value: unknown): SpeechSettings {
  const speech = value && typeof value === 'object' ? value as Partial<SpeechSettings> : {}
  const rawConcurrency = typeof speech.maxParallelRequests === 'number' || typeof speech.maxParallelRequests === 'string' ? String(speech.maxParallelRequests).trim() : '1'
  const concurrency = /^\d+$/.test(rawConcurrency) ? Math.max(1, Math.min(8, Number(rawConcurrency))) : 1
  return {
    provider: 'nanogpt',
    apiKey: typeof speech.apiKey === 'string' ? speech.apiKey : '',
    model: typeof speech.model === 'string' && speech.model.trim() ? speech.model : initialSpeechSettings.model,
    voice: typeof speech.voice === 'string' ? speech.voice : initialSpeechSettings.voice,
    readAloudAfterGeneration: speech.readAloudAfterGeneration === true,
    maxParallelRequests: String(concurrency),
  }
}

''')
replace('src/ai-settings.ts',
"    responseLength: typeof value?.responseLength === 'string' ? value.responseLength : '',\n",
"    responseLength: typeof value?.responseLength === 'string' ? value.responseLength : '',\n    speech: normalizeSpeechSettings(value?.speech),\n")

# Settings UI: make Speech tab functional and connected to the same auto-save path.
replace('src/App.tsx',
"import { clearModelCatalog, getCachedModelCatalog, providerModelEndpoint, saveModelCatalog, type ProviderModel } from './model-catalog'\n",
"import { clearModelCatalog, getCachedModelCatalog, providerModelEndpoint, saveModelCatalog, type ProviderModel } from './model-catalog'\nimport { fetchSpeechModels, type SpeechModel } from './tts-service'\n")
replace('src/App.tsx', "import './codex-summary.css'\n", "import './codex-summary.css'\nimport './tts.css'\n")
replace('src/App.tsx',
"          : <SettingsPlaceholder tab={settingsTab} scope={isBookSettings ? 'book' : 'defaults'} />}",
"          : settingsTab === 'speech' ? <SpeechSettingsPanel settings={settings} scope={isBookSettings ? 'book' : 'defaults'} onChange={(speech) => update('speech', speech)} />\n          : <SettingsPlaceholder tab={settingsTab} scope={isBookSettings ? 'book' : 'defaults'} />}")
insert_before('src/App.tsx', 'function SettingsPlaceholder({ tab, scope }:', r'''function SpeechSettingsPanel({ settings, scope, onChange }: { settings: AiSettings; scope: 'book' | 'defaults'; onChange: (speech: AiSettings['speech']) => void }) {
  const [models, setModels] = useState<SpeechModel[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const selected = models.find((model) => model.id === settings.speech.model)
  const voices = selected?.voices ?? []
  const filtered = models.filter((model) => !query.trim() || `${model.id} ${model.name}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 80)

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

  useEffect(() => { void loadModels() }, [])
  const updateSpeech = (patch: Partial<AiSettings['speech']>) => onChange({ ...settings.speech, ...patch })
  const unavailableModel = models.length > 0 && !selected
  const unavailableVoice = Boolean(selected?.voices.length && settings.speech.voice && !selected.voices.includes(settings.speech.voice))

  return <section className="speech-settings">
    <header className="page-heading"><div><p>{scope === 'book' ? 'Book Speech' : 'Default Speech'}</p><h1 id="page-title">Text to speech</h1><span>{scope === 'book' ? 'Independent TTS settings for this book.' : 'Copied into each new book, then edited independently.'}</span></div><Volume2 aria-hidden="true" /></header>
    <section className="settings-card">
      <div className="card-heading"><div><span>01</span><h2>Provider & credential</h2></div><p>Speech credentials are separate from text AI.</p></div>
      <div className="speech-settings-grid">
        <label><span>Provider</span><select value={settings.speech.provider} onChange={() => undefined}><option value="nanogpt">NanoGPT</option></select></label>
        <label><span>NanoGPT Speech API key</span><div className="speech-key-row"><input type="password" value={settings.speech.apiKey} onChange={(event) => updateSpeech({ apiKey: event.target.value })} autoComplete="off" spellCheck={false} />{settings.provider === 'nanogpt' && settings.apiKey.trim() && <button type="button" onClick={() => updateSpeech({ apiKey: settings.apiKey })}>Copy NanoGPT key from AI settings</button>}</div></label>
      </div>
    </section>
    <section className="settings-card">
      <div className="card-heading"><div><span>02</span><h2>Voice model</h2></div><button type="button" onClick={() => { void loadModels() }} disabled={loading}><RefreshCw className={loading ? 'spinning' : ''} aria-hidden="true" /> Reload</button></div>
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
  </section>
}

''')

# Workspace: shared TTS controller, latest generated Story passage, editor/list actions and paid outline confirmation.
replace('src/Workspace.tsx', "  PanelBottomOpen,\n  Pencil,", "  PanelBottomOpen,\n  Pause,\n  Pencil,")
replace('src/Workspace.tsx',
"import { generateAutotitleSuggestion, prepareAutotitleRequest, type AutotitleEntity, type AutotitleRequest, type AutotitleTargetType } from './autotitle-service'\n",
"import { generateAutotitleSuggestion, prepareAutotitleRequest, type AutotitleEntity, type AutotitleRequest, type AutotitleTargetType } from './autotitle-service'\nimport { estimateSpeechRequest, fetchSpeechModels, getTtsState, pauseTtsSession, resumeTtsSession, startTtsSession, stopTtsSession, subscribeTtsState, type TtsState } from './tts-service'\n")
replace('src/Workspace.tsx', "import './autotitle.css'\n", "import './autotitle.css'\nimport './tts.css'\n")
replace('src/Workspace.tsx',
"  const [toast, setToast] = useState<ToastMessage | null>(null)\n",
"  const [toast, setToast] = useState<ToastMessage | null>(null)\n  const [lastGeneratedPassage, setLastGeneratedPassage] = useState('')\n")
replace('src/Workspace.tsx',
"  useEffect(() => {\n    setArcPrompt('')\n    setLorePrompt('')\n  }, [activeDocument?.id])",
"  useEffect(() => {\n    setArcPrompt('')\n    setLorePrompt('')\n    setLastGeneratedPassage('')\n  }, [activeDocument?.id])")

insert_before('src/Workspace.tsx', '  function startGenerationActivity(', r'''  async function speechSettings() {
    if (!currentBook) throw new Error('Open a book before reading aloud.')
    const defaults = loadAiSettings()
    return (await getBookAiSettings(currentBook.id, defaults.favorites)).speech
  }

  async function readText(text: string, label: string) {
    try {
      const speech = await speechSettings()
      await startTtsSession(speech, text, label)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not start text to speech.')
    }
  }

  async function readCurrentDocument() {
    if (!activeDocument) return
    if (activeDocument.type === 'scene') {
      if (!lastGeneratedPassage.trim()) { showToast('There is no identifiable latest generated passage to read in this Scene.'); return }
      await readText(lastGeneratedPassage, `Scene · ${activeDocument.title}`)
      return
    }
    if (activeDocument.type === 'codexEntry') await readText(storyMarkdown, `Codex · ${activeDocument.title}`)
  }

  async function readNote(note: NoteEntity) {
    const text = activeDocument?.id === note.id ? storyMarkdown : note.content
    await readText(text, `Note · ${note.title}`)
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
      const models = await fetchSpeechModels(speech.apiKey).catch(() => [])
      const modelInfo = models.find((model) => model.id === speech.model)
      const estimate = estimateSpeechRequest(speech, text, modelInfo)
      const price = modelInfo?.averagePrice ? `\nProvider average price: ${modelInfo.averagePrice}` : '\nProvider price: unavailable for a reliable estimate'
      const confirmed = window.confirm(`Read ${entity.type === 'scene' ? 'Scene' : 'Chapter'} “${entity.title}” aloud with a paid NanoGPT request?\n\n${estimate.words.toLocaleString()} words · ${estimate.characters.toLocaleString()} characters · about ${estimate.chunks} TTS request${estimate.chunks === 1 ? '' : 's'}\nModel: ${speech.model}${price}`)
      if (!confirmed) return
      await startTtsSession(speech, text, `${entity.type === 'scene' ? 'Scene' : 'Chapter'} · ${entity.title}`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not start text to speech.')
    }
  }

''')

replace('src/Workspace.tsx',
"      if (result?.status === 'complete') {\n        latestGenerationRequestRef.current = requestSnapshot\n        if (isCodex) changedSinceSnapshotRef.current = true\n        await flushDocument('generation', true)\n      }",
"      if (result?.status === 'complete') {\n        latestGenerationRequestRef.current = requestSnapshot\n        if (!isCodex) setLastGeneratedPassage(result.generatedText)\n        if (isCodex) changedSinceSnapshotRef.current = true\n        await flushDocument('generation', true)\n        if (settings.speech.readAloudAfterGeneration) {\n          const textToRead = isCodex ? result.resultDocument : result.generatedText\n          void startTtsSession(settings.speech, textToRead, `${isCodex ? 'Codex' : 'Story'} · ${activeDocument.title}`).catch((error) => showToast(error instanceof Error ? error.message : 'Automatic read aloud failed.'))\n        }\n      }")

replace('src/Workspace.tsx',
"      {toast && <div className=\"app-toast\" role=\"alert\" key={toast.id}><span>{toast.message}</span><button type=\"button\" onClick={() => setToast(null)} aria-label=\"Dismiss notification\"><X aria-hidden=\"true\" /></button></div>}\n",
"      {toast && <div className=\"app-toast\" role=\"alert\" key={toast.id}><span>{toast.message}</span><button type=\"button\" onClick={() => setToast(null)} aria-label=\"Dismiss notification\"><X aria-hidden=\"true\" /></button></div>}\n      <TtsStatusBar />\n")
replace('src/Workspace.tsx',
"<GenerateControl isGenerating={generationActive} phase={generationPhase} elapsedSeconds={generationElapsedSeconds} onOpenDetails={() => setGenerationDetailsOpen(true)} onGenerate={generate} onStop={stopGeneration} onMicro={insertEditorSpeech} onMicro2={insertPromptSpeech} onUndo={() => editorRef.current?.undo()} onRedo={() => editorRef.current?.redo()} onRegenerate={regenerate} />",
"<GenerateControl isGenerating={generationActive} phase={generationPhase} elapsedSeconds={generationElapsedSeconds} onOpenDetails={() => setGenerationDetailsOpen(true)} onGenerate={generate} onStop={stopGeneration} onMicro={insertEditorSpeech} onMicro2={insertPromptSpeech} onUndo={() => editorRef.current?.undo()} onRedo={() => editorRef.current?.redo()} onRegenerate={regenerate} onReadAloud={() => { void readCurrentDocument() }} readAloudDisabled={activeDocument?.type === 'scene' && !lastGeneratedPassage.trim()} readAloudTitle={activeDocument?.type === 'scene' ? 'Read latest generated passage' : 'Read full Codex entry'} />")
replace('src/Workspace.tsx',
"onAutotitle={(entity) => { void startAutotitle(entity) }} onRename={(entity) => { void editOutlineTitle(entity) }}",
"onAutotitle={(entity) => { void startAutotitle(entity) }} onRead={(entity) => { void readOutline(entity) }} onRename={(entity) => { void editOutlineTitle(entity) }}")
replace('src/Workspace.tsx',
"onAutotitle={(entity) => { void startAutotitle(entity) }} onRename={(entity) => { void renameContentEntity(entity) }} onDelete={(entity) => { void removeContentEntity(entity) }} /> : rightTab === 'codex'",
"onAutotitle={(entity) => { void startAutotitle(entity) }} onRead={(entity) => { void readNote(entity) }} onRename={(entity) => { void renameContentEntity(entity) }} onDelete={(entity) => { void removeContentEntity(entity) }} /> : rightTab === 'codex'")

replace('src/Workspace.tsx',
"function GenerateControl({ isGenerating, phase, elapsedSeconds, onOpenDetails, onGenerate, onStop, onMicro, onMicro2, onUndo, onRedo, onRegenerate }: {",
"function GenerateControl({ isGenerating, phase, elapsedSeconds, onOpenDetails, onGenerate, onStop, onMicro, onMicro2, onUndo, onRedo, onRegenerate, onReadAloud, readAloudDisabled, readAloudTitle }: {")
replace('src/Workspace.tsx',
"  onRegenerate: () => void\n}) {",
"  onRegenerate: () => void\n  onReadAloud: () => void\n  readAloudDisabled?: boolean\n  readAloudTitle?: string\n}) {")
replace('src/Workspace.tsx',
"    <button type=\"button\" onClick={onRegenerate} aria-label=\"Regenerate latest result\" title=\"Regenerate\"><RefreshCw aria-hidden=\"true\" /></button>\n    <button type=\"button\" onClick={() => setExpanded(false)}",
"    <button type=\"button\" onClick={onRegenerate} aria-label=\"Regenerate latest result\" title=\"Regenerate\"><RefreshCw aria-hidden=\"true\" /></button>\n    <button className=\"read-aloud-action\" type=\"button\" onClick={onReadAloud} disabled={readAloudDisabled} aria-label={readAloudTitle || 'Read aloud'} title={readAloudDisabled ? 'No latest generated passage is available' : readAloudTitle || 'Read aloud'}><Volume2 aria-hidden=\"true\" /></button>\n    <button type=\"button\" onClick={() => setExpanded(false)}")

# Outline / Notes prop plumbing.
replace('src/Workspace.tsx', "  onAutotitle: (entity: StructuralEntity) => void\n  onRename:", "  onAutotitle: (entity: StructuralEntity) => void\n  onRead: (entity: StructuralEntity) => void\n  onRename:")
replace('src/Workspace.tsx',
"function Outline({ book, entities, activeSceneId, summaryStates, expandedIds, onToggle, onOpenScene, onOpenSummary, onCreate, onAutotitle, onRename, onMove, onDelete }: OutlineProps)",
"function Outline({ book, entities, activeSceneId, summaryStates, expandedIds, onToggle, onOpenScene, onOpenSummary, onCreate, onAutotitle, onRead, onRename, onMove, onDelete }: OutlineProps)")
# Pass onRead through every OutlineRow call.
p = Path('src/Workspace.tsx')
text = p.read_text().replace('onAutotitle={onAutotitle} onRename={onRename}', 'onAutotitle={onAutotitle} onRead={onRead} onRename={onRename}')
p.write_text(text)
replace('src/Workspace.tsx',
"function OutlineRow({ entity, label, wordCount, summaryState, selected = false, expandable = false, expanded = false, first, last, onToggle, onOpenScene, onOpenSummary, onCreate, onAutotitle, onRename, onMove, onDelete }: {",
"function OutlineRow({ entity, label, wordCount, summaryState, selected = false, expandable = false, expanded = false, first, last, onToggle, onOpenScene, onOpenSummary, onCreate, onAutotitle, onRead, onRename, onMove, onDelete }: {")
replace('src/Workspace.tsx', "  onAutotitle: (entity: StructuralEntity) => void\n  onRename: (entity: StructuralEntity) => void", "  onAutotitle: (entity: StructuralEntity) => void\n  onRead: (entity: StructuralEntity) => void\n  onRename: (entity: StructuralEntity) => void", 1)
replace('src/Workspace.tsx',
"      <button className=\"autotitle-trigger\" type=\"button\" onClick={() => onAutotitle(entity)} aria-label={`Autotitle ${entity.title}`} title=\"Autotitle\"><WandSparkles aria-hidden=\"true\" /></button>\n      <button type=\"button\" onClick={() => onRename(entity)}",
"      <button className=\"autotitle-trigger\" type=\"button\" onClick={() => onAutotitle(entity)} aria-label={`Autotitle ${entity.title}`} title=\"Autotitle\"><WandSparkles aria-hidden=\"true\" /></button>\n      {(entity.type === 'scene' || entity.type === 'chapter') && <button className=\"read-aloud-action\" type=\"button\" onClick={() => onRead(entity)} aria-label={`Read ${entity.title} aloud`} title=\"Read aloud · paid TTS\"><Volume2 aria-hidden=\"true\" /></button>}\n      <button type=\"button\" onClick={() => onRename(entity)}")

replace('src/Workspace.tsx', "function Notes({ notes, activeId, onCreate, onOpen, onAutotitle, onRename, onDelete }: {", "function Notes({ notes, activeId, onCreate, onOpen, onAutotitle, onRead, onRename, onDelete }: {")
replace('src/Workspace.tsx', "  onAutotitle: (entity: NoteEntity) => void\n  onRename: (entity: NoteEntity) => void", "  onAutotitle: (entity: NoteEntity) => void\n  onRead: (entity: NoteEntity) => void\n  onRename: (entity: NoteEntity) => void")
replace('src/Workspace.tsx',
"<button className=\"autotitle-trigger\" type=\"button\" onClick={() => onAutotitle(note)} aria-label={`Autotitle ${note.title}`} title=\"Autotitle\"><WandSparkles aria-hidden=\"true\" /></button><button type=\"button\" onClick={() => onRename(note)}",
"<button className=\"autotitle-trigger\" type=\"button\" onClick={() => onAutotitle(note)} aria-label={`Autotitle ${note.title}`} title=\"Autotitle\"><WandSparkles aria-hidden=\"true\" /></button><button className=\"read-aloud-action\" type=\"button\" onClick={() => onRead(note)} aria-label={`Read ${note.title} aloud`} title=\"Read aloud\"><Volume2 aria-hidden=\"true\" /></button><button type=\"button\" onClick={() => onRename(note)}")

# Shared playback strip component.
insert_before('src/Workspace.tsx', 'function formatGenerationTime(seconds: number) {', r'''function TtsStatusBar() {
  const [tts, setTts] = useState<TtsState>(() => getTtsState())
  useEffect(() => subscribeTtsState(setTts), [])
  if (tts.status === 'idle') return null
  const label = tts.status === 'preparing' ? 'Preparing text'
    : tts.status === 'generating' ? 'Generating audio'
      : tts.status === 'playing' ? 'Playing'
        : tts.status === 'paused' ? 'Paused'
          : tts.status === 'waiting' ? 'Waiting for next audio…'
            : tts.status === 'stopping' ? 'Stopping'
              : tts.status === 'complete' ? 'Complete'
                : 'Failed'
  return <section className={`tts-status ${tts.status}`} aria-live="polite"><Volume2 aria-hidden="true" /><div className="tts-status-copy"><strong>{tts.label || 'Read aloud'}</strong><small>{label}{tts.chunkCount ? ` · ${Math.max(1, tts.chunkIndex || 1)}/${tts.chunkCount}` : ''}{tts.error ? ` · ${tts.error}` : ''}</small></div><div className="tts-status-actions">{tts.status === 'playing' && <button type="button" onClick={pauseTtsSession} aria-label="Pause audio"><Pause aria-hidden="true" /></button>}{tts.status === 'paused' && <button type="button" onClick={() => { void resumeTtsSession() }} aria-label="Resume audio"><Play aria-hidden="true" /></button>}{!['complete','failed'].includes(tts.status) && <button type="button" onClick={stopTtsSession} aria-label="Stop audio"><Square aria-hidden="true" /></button>}</div></section>
}

''')

# Chat: replace browser speechSynthesis with book Speech settings and auto-read only the final visible assistant answer.
replace('src/ChatFeature.tsx', "import { CHAT_TOOL_DEFINITIONS, CHAT_WORKSPACE_INSTRUCTIONS, serializeChatModelInput } from './chat-request'\n", "import { CHAT_TOOL_DEFINITIONS, CHAT_WORKSPACE_INSTRUCTIONS, serializeChatModelInput } from './chat-request'\nimport { startTtsSession } from './tts-service'\n")
replace('src/ChatFeature.tsx',
"  function readAloud(message: ChatMessageEntity) {\n    if (!('speechSynthesis' in window) || !message.content.trim()) return\n    window.speechSynthesis.cancel()\n    window.speechSynthesis.speak(new SpeechSynthesisUtterance(message.content))\n  }",
"  async function readAloud(message: ChatMessageEntity) {\n    if (!message.content.trim()) return\n    try {\n      const settings = await getChatBookAiSettings(bookId)\n      await startTtsSession(settings.speech, message.content, `Chat · ${chat?.title ?? 'Assistant'}`)\n    } catch (error) {\n      onToast(error instanceof Error ? error.message : 'Could not start text to speech.')\n    }\n  }")
replace('src/ChatFeature.tsx', "onClick={() => readAloud(message)}", "onClick={() => { void readAloud(message) }}")
replace('src/ChatFeature.tsx',
"        const saved = await persistAssistantRound(activeRoundContent, activeRoundThoughts)\n        activeRoundPersisted = Boolean(saved)\n        commitVisibleRound(saved, Boolean(activeRoundThoughts))\n        completed = true",
"        const saved = await persistAssistantRound(activeRoundContent, activeRoundThoughts)\n        activeRoundPersisted = Boolean(saved)\n        commitVisibleRound(saved, Boolean(activeRoundThoughts))\n        if (saved?.content && settings.speech.readAloudAfterGeneration) {\n          void startTtsSession(settings.speech, saved.content, `Chat · ${activeChat.title}`).catch((error) => onToast(error instanceof Error ? error.message : 'Automatic read aloud failed.'))\n        }\n        completed = true")

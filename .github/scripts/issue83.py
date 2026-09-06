from pathlib import Path
import re


def replace(path, old, new, count=1):
    p=Path(path); text=p.read_text()
    if old not in text: raise SystemExit(f'Missing block in {path}: {old[:180]!r}')
    p.write_text(text.replace(old,new,count))


def insert_before(path, marker, value):
    p=Path(path); text=p.read_text()
    if marker not in text: raise SystemExit(f'Missing marker in {path}: {marker[:120]!r}')
    p.write_text(text.replace(marker,value+marker,1))

# Persistence: trigger field + global Context default + per-book copied scan window.
replace('src/persistence.ts',
"} from './ai-settings'\n",
"} from './ai-settings'\nimport { normalizeCodexTriggerList } from './codex-trigger-service'\n")
replace('src/persistence.ts',
"export type CodexEntryEntity = ArcEntity & { type: 'codexEntry'; bookId: string; parentId: string; title: string; category: string; content: string; archivedAt?: number; preferSummaryForContext?: boolean; sourceRevision?: number }",
"export type CodexEntryEntity = ArcEntity & { type: 'codexEntry'; bookId: string; parentId: string; title: string; category: string; content: string; archivedAt?: number; preferSummaryForContext?: boolean; sourceRevision?: number; autoIncludeTriggers?: string[] }")
replace('src/persistence.ts',
"export type BookContextSettings = {\n  lastOpenedSceneId: string\n  profiles:",
"export type BookContextSettings = {\n  lastOpenedSceneId: string\n  previousScenesForCodexTriggers: number\n  profiles:")
replace('src/persistence.ts',
"export const defaultBookContextSettings: BookContextSettings = {\n  lastOpenedSceneId: '',\n",
"export const defaultBookContextSettings: BookContextSettings = {\n  lastOpenedSceneId: '',\n  previousScenesForCodexTriggers: 2,\n")
replace('src/persistence.ts',
"  return {\n    lastOpenedSceneId: typeof value?.lastOpenedSceneId === 'string' ? value.lastOpenedSceneId : '',\n    profiles:",
"  const previousScenes = Number(value?.previousScenesForCodexTriggers)\n  return {\n    lastOpenedSceneId: typeof value?.lastOpenedSceneId === 'string' ? value.lastOpenedSceneId : '',\n    previousScenesForCodexTriggers: Number.isSafeInteger(previousScenes) && previousScenes >= 0 ? previousScenes : 2,\n    profiles:")
insert_before('src/persistence.ts', "export const PROTOTYPE_BOOK_ID", '''export const CONTEXT_DEFAULTS_STORAGE_KEY = 'arc-context-defaults-v1'

export function loadDefaultBookContextSettings(): BookContextSettings {
  if (typeof localStorage === 'undefined') return normalizeBookContextSettings(defaultBookContextSettings)
  try {
    const stored = localStorage.getItem(CONTEXT_DEFAULTS_STORAGE_KEY)
    return stored ? normalizeBookContextSettings(JSON.parse(stored)) : normalizeBookContextSettings(defaultBookContextSettings)
  } catch {
    return normalizeBookContextSettings(defaultBookContextSettings)
  }
}

export function saveDefaultBookContextSettings(value: BookContextSettings): BookContextSettings {
  const normalized = normalizeBookContextSettings(value)
  if (typeof localStorage !== 'undefined') localStorage.setItem(CONTEXT_DEFAULTS_STORAGE_KEY, JSON.stringify(normalized))
  return normalized
}

''')
# Fresh prototype seeded Codex gets ordinary title triggers.
replace('src/persistence.ts',
"title: 'Mara Vale', category: 'Character', content: 'A cartographer who inherited her father’s rules and his unfinished map.', createdAt:",
"title: 'Mara Vale', category: 'Character', content: 'A cartographer who inherited her father’s rules and his unfinished map.', autoIncludeTriggers: ['Mara Vale'], createdAt:")
replace('src/persistence.ts',
"title: 'The Drowned Quarter', category: 'Place', content: 'A district exposed only at low tide.', createdAt:",
"title: 'The Drowned Quarter', category: 'Place', content: 'A district exposed only at low tide.', autoIncludeTriggers: ['The Drowned Quarter'], createdAt:")
replace('src/persistence.ts',
"title: 'Brass Compass', category: 'Object', content: 'One of several compasses that point toward remembered doors.', createdAt:",
"title: 'Brass Compass', category: 'Object', content: 'One of several compasses that point toward remembered doors.', autoIncludeTriggers: ['Brass Compass'], createdAt:")
replace('src/persistence.ts',
"  const contextSettings = makeBookContextSettingsEntity(bookId, defaultBookContextSettings, now)",
"  const contextSettings = makeBookContextSettingsEntity(bookId, loadDefaultBookContextSettings(), now)")
replace('src/persistence.ts',
"const entry: CodexEntryEntity = { id: makeId('codex'), type: 'codexEntry', bookId, parentId: bookId, title, category, content: '', preferSummaryForContext: false, sourceRevision: now, createdAt: now, updatedAt: now }",
"const entry: CodexEntryEntity = { id: makeId('codex'), type: 'codexEntry', bookId, parentId: bookId, title, category, content: '', autoIncludeTriggers: normalizeCodexTriggerList([title]), preferSummaryForContext: false, sourceRevision: now, createdAt: now, updatedAt: now }")
insert_before('src/persistence.ts', 'export async function renameEntity', '''export async function updateCodexAutoIncludeTriggers(id: string, triggers: string[]): Promise<CodexEntryEntity> {
  const db = await database()
  const current = await db.table('entities').get(id) as CodexEntryEntity | undefined
  if (!current || current.type !== 'codexEntry') throw new Error(`Cannot update missing Codex entry ${id}`)
  if (isCodexEntryArchived(current)) throw new Error('Restore this archived Codex entry before editing automatic triggers.')
  const now = Date.now()
  const sourceRevision = typeof current.sourceRevision === 'number' ? current.sourceRevision : current.updatedAt
  const updated: CodexEntryEntity = { ...current, sourceRevision, autoIncludeTriggers: normalizeCodexTriggerList(triggers), updatedAt: now }
  await db.transaction('rw', db.table('entities'), async () => {
    await db.table('entities').put(updated)
    await touchAncestors(db, current.bookId, now)
  })
  return updated
}

''')

# Context service: shared auto match result becomes part of the same PreparedContext used by provider and preview.
replace('src/context-service.ts',
"import { isCodexEntryArchived, listEntitiesByBook, type ArcEntity, type CodexEntryEntity, type GenerationContextProfile, type GenerationContextType, type StructuralEntity, type SummaryEntity } from './persistence'\n",
"import { getBookContextSettings, isCodexEntryArchived, listEntitiesByBook, type ArcEntity, type CodexEntryEntity, type GenerationContextProfile, type GenerationContextType, type StructuralEntity, type SummaryEntity } from './persistence'\nimport { automaticCodexMatches, type CodexTriggerSceneMatch } from './codex-trigger-service'\n")
replace('src/context-service.ts',
"export type PreparedContextValues = {\n",
"export type PreparedAutomaticCodex = { entryId: string; title: string; category: string; representation: 'full' | 'summary'; fallbackReason?: string; matches: CodexTriggerSceneMatch[] }\n\nexport type PreparedContextValues = {\n")
replace('src/context-service.ts',
"  codexRepresentations: CodexContextRepresentation[]\n}",
"  codexRepresentations: CodexContextRepresentation[]\n  automaticCodex: PreparedAutomaticCodex[]\n}")
replace('src/context-service.ts',
"  const entities = await listEntitiesByBook(options.bookId)\n  const outline = orderedOutline(options.bookId, entities)\n  const scenes = outline.filter((item) => item.type === 'scene')\n",
"  const [entities, contextSettings] = await Promise.all([listEntitiesByBook(options.bookId), getBookContextSettings(options.bookId)])\n  const outline = orderedOutline(options.bookId, entities)\n  const scenes = outline.filter((item) => item.type === 'scene')\n  const anchorSceneId = options.currentSceneId || contextSettings.lastOpenedSceneId || undefined\n")
replace('src/context-service.ts',
"  const currentIndex = options.currentSceneId ? scenes.findIndex((item) => item.id === options.currentSceneId) : -1\n",
"  const currentIndex = anchorSceneId ? scenes.findIndex((item) => item.id === anchorSceneId) : -1\n")
replace('src/context-service.ts',
"  const liveCurrentText = options.currentSceneText ?? String(currentScene?.content ?? '')\n",
"  const liveCurrentText = options.currentSceneText !== undefined && options.currentSceneId === anchorSceneId ? options.currentSceneText : String(currentScene?.content ?? '')\n")
replace('src/context-service.ts', "automaticSummaries(options.bookId, entities, outline, options.currentSceneId,", "automaticSummaries(options.bookId, entities, outline, anchorSceneId,")
replace('src/context-service.ts', "if (options.type === 'scene' && options.currentSceneId) automaticFullIds.add(options.currentSceneId)", "if (options.type === 'scene' && anchorSceneId) automaticFullIds.add(anchorSceneId)")
replace('src/context-service.ts', "if ((options.type === 'codex' || options.type === 'chat') && options.profile.includeLastScene && options.currentSceneId) automaticFullIds.add(options.currentSceneId)", "if ((options.type === 'codex' || options.type === 'chat') && options.profile.includeLastScene && anchorSceneId) automaticFullIds.add(anchorSceneId)")
replace('src/context-service.ts', "summaryMatches(item, outline, options.currentSceneId, options.profile.summaryRange)", "summaryMatches(item, outline, anchorSceneId, options.profile.summaryRange)")
# Replace selected codex block.
old='''  const selectedCodex = entities.filter((item): item is CodexEntryEntity => item.type === 'codexEntry' && !isCodexEntryArchived(item) && item.id !== options.currentDocumentId && options.profile.codexEntryIds.includes(item.id))
  const codexRepresentations = selectedCodex.map((item) => codexContextRepresentation(item, entities))
  const codex: AdditionalContextSection[] = selectedCodex.map((item) => {
    const representation = codexRepresentations.find((candidate) => candidate.entryId === item.id)!
    return {
      text: section(`Codex — ${String(item.category ?? 'Other')}: ${item.title ?? 'Untitled'}`, representation.content),
      id: item.id,
      updatedAt: item.updatedAt,
      stabilityRank: 1,
      typeRank: 0,
      outlineIndex: Number.MAX_SAFE_INTEGER,
    }
  })
'''
new='''  const automaticMatches = automaticCodexMatches({
    entities,
    scenes,
    anchorSceneId,
    anchorSceneText: liveCurrentText,
    previousSceneCount: contextSettings.previousScenesForCodexTriggers,
    excludeEntryId: options.type === 'codex' ? options.currentDocumentId : undefined,
  })
  const automaticIds = new Set(automaticMatches.map((match) => match.entry.id))
  const automaticRepresentations = automaticMatches.map((match) => codexContextRepresentation(match.entry, entities))
  const automaticCodex: PreparedAutomaticCodex[] = automaticMatches.map((match) => {
    const representation = automaticRepresentations.find((candidate) => candidate.entryId === match.entry.id)!
    return { entryId: match.entry.id, title: match.entry.title, category: match.entry.category, representation: representation.representation, fallbackReason: representation.fallbackReason, matches: match.matches }
  })
  const automaticText = automaticMatches.map((match) => {
    const representation = automaticRepresentations.find((candidate) => candidate.entryId === match.entry.id)!
    return `### ${match.entry.category}: ${match.entry.title}\n\n${representation.content}`
  }).join('\n\n')
  const automaticSection = automaticText ? section('Automatic Codex', automaticText) : ''

  const selectedCodex = entities.filter((item): item is CodexEntryEntity => item.type === 'codexEntry' && !isCodexEntryArchived(item) && item.id !== options.currentDocumentId && !automaticIds.has(item.id) && options.profile.codexEntryIds.includes(item.id))
  const manualRepresentations = selectedCodex.map((item) => codexContextRepresentation(item, entities))
  const codexRepresentations = [...automaticRepresentations, ...manualRepresentations]
  const codex: AdditionalContextSection[] = selectedCodex.map((item) => {
    const representation = manualRepresentations.find((candidate) => candidate.entryId === item.id)!
    return {
      text: section(`Codex — ${String(item.category ?? 'Other')}: ${item.title ?? 'Untitled'}`, representation.content),
      id: item.id,
      updatedAt: item.updatedAt,
      stabilityRank: 1,
      typeRank: 0,
      outlineIndex: Number.MAX_SAFE_INTEGER,
    }
  })
'''
replace('src/context-service.ts', old, new)
replace('src/context-service.ts',
"    codexRepresentations,\n    additionalContext: [...fullSections, ...summarySections, ...notes, ...codex].sort(additionalContextOrder).map((item) => item.text).join('\\n\\n'),",
"    codexRepresentations,\n    automaticCodex,\n    additionalContext: [automaticSection, ...[...fullSections, ...summarySections, ...notes, ...codex].sort(additionalContextOrder).map((item) => item.text)].filter(Boolean).join('\\n\\n'),")

# App settings + preview.
replace('src/App.tsx',
"  getBookContextSettings,\n  getBookAiSettings,",
"  getBookContextSettings,\n  getBookAiSettings,\n  loadDefaultBookContextSettings,")
replace('src/App.tsx',
"  saveBookContextSettings,\n  saveBookAiSettings,",
"  saveBookContextSettings,\n  saveDefaultBookContextSettings,\n  saveBookAiSettings,")
replace('src/App.tsx', "import './tts.css'\n", "import './tts.css'\nimport './codex-triggers.css'\n")
replace('src/App.tsx',
"      setContextSettings(defaultBookContextSettings)\n",
"      setContextSettings(loadDefaultBookContextSettings())\n")
replace('src/App.tsx',
"    if (!book) return\n    const version = ++contextSaveVersionRef.current",
"    if (!book) {\n      const saved = saveDefaultBookContextSettings(value)\n      setContextSettings(saved)\n      setContextSaved(true)\n      return\n    }\n    const version = ++contextSaveVersionRef.current")
# Render global Context panel.
old="""        </> : settingsTab === 'context' && book ? (book.contextType === 'note'
          ? <NoteContextPlaceholder />
          : <ContextSettings bookId={book.id} bookTitle={book.title} bookPromptValues={book.promptValues} type={book.contextType ?? 'scene'} currentDocumentId={book.currentDocumentId} currentDocumentText={book.currentDocumentText} chatId={book.chatId} settings={settings} value={contextSettings} sources={contextSources} saved={contextSaved} onChange={updateContextDefaults} />)
          : settingsTab === 'speech' ?"""
new="""        </> : settingsTab === 'context' ? (book ? (book.contextType === 'note'
          ? <NoteContextPlaceholder />
          : <ContextSettings bookId={book.id} bookTitle={book.title} bookPromptValues={book.promptValues} type={book.contextType ?? 'scene'} currentDocumentId={book.currentDocumentId} currentDocumentText={book.currentDocumentText} chatId={book.chatId} settings={settings} value={contextSettings} sources={contextSources} saved={contextSaved} onChange={updateContextDefaults} />)
          : <GlobalContextDefaults value={contextSettings} onChange={updateContextDefaults} />)
          : settingsTab === 'speech' ?"""
replace('src/App.tsx', old, new)
# Book Context automatic section gets scan setting.
replace('src/App.tsx',
"    <section className=\"settings-card context-defaults-card\"><div className=\"card-heading\"><div><span>01</span><h2>Automatic context</h2></div></div>\n",
"    <section className=\"settings-card context-defaults-card\"><div className=\"card-heading\"><div><span>01</span><h2>Automatic context</h2></div></div>\n      <label className=\"context-trigger-window\"><span><strong>Previous Scenes to scan for Codex triggers</strong><small>The current/last-opened Scene is always scanned; this controls how many immediately previous Scenes join it.</small></span><input type=\"number\" min=\"0\" step=\"1\" value={value.previousScenesForCodexTriggers} onChange={(event) => onChange({ ...value, previousScenesForCodexTriggers: Math.max(0, Math.floor(Number(event.target.value) || 0)) })} /></label>\n")
# Preview automatic results before combined representation.
replace('src/App.tsx',
"        {preview.codexRepresentations.length > 0 && <div className=\"codex-context-representations\">",
"        {preview.automaticCodex.length > 0 && <div className=\"automatic-codex-preview\"><strong>Automatic Codex</strong>{preview.automaticCodex.map((item) => <article key={item.entryId}><header><b>{item.title}</b><small>{item.representation === 'summary' ? 'Summary' : 'Full entry'}{item.fallbackReason ? ` · ${item.fallbackReason}` : ''}</small></header><ul>{item.matches.map((match, index) => <li key={`${item.entryId}-${match.sceneId}-${match.trigger}-${index}`}><code>{match.trigger}</code> · {match.sceneTitle}</li>)}</ul></article>)}</div>}\n        {preview.codexRepresentations.length > 0 && <div className=\"codex-context-representations\">")
insert_before('src/App.tsx', 'function NoteContextPlaceholder()', '''function GlobalContextDefaults({ value, onChange }: { value: BookContextSettings; onChange: (value: BookContextSettings) => void }) {
  return <section className="context-defaults-settings">
    <header className="page-heading"><div><p>Default Context</p><h1 id="page-title">Context defaults</h1><span>Copied into new books. Existing books keep their own Context settings.</span></div></header>
    <section className="settings-card context-defaults-card"><div className="card-heading"><div><span>01</span><h2>Automatic Codex</h2></div></div>
      <label className="context-trigger-window"><span><strong>Previous Scenes to scan for Codex triggers</strong><small>The current Scene is included in addition to this many immediately previous Scenes. 0 means current Scene only.</small></span><input type="number" min="0" step="1" value={value.previousScenesForCodexTriggers} onChange={(event) => onChange({ ...value, previousScenesForCodexTriggers: Math.max(0, Math.floor(Number(event.target.value) || 0)) })} /></label>
    </section>
  </section>
}

''')

# Workspace Codex trigger editor.
replace('src/Workspace.tsx',
"  updateCodexCategory,\n  updateCodexSummaryPreference,",
"  updateCodexCategory,\n  updateCodexAutoIncludeTriggers,\n  updateCodexSummaryPreference,")
replace('src/Workspace.tsx', "import './tts.css'\n", "import './tts.css'\nimport './codex-triggers.css'\n")
replace('src/Workspace.tsx',
"  const [lorePrompt, setLorePrompt] = useState('')\n",
"  const [lorePrompt, setLorePrompt] = useState('')\n  const [codexTriggerDraft, setCodexTriggerDraft] = useState('')\n")
replace('src/Workspace.tsx',
"    setLastGeneratedPassage('')\n  }, [activeDocument?.id])",
"    setLastGeneratedPassage('')\n    setCodexTriggerDraft(activeDocument?.type === 'codexEntry' ? (activeDocument.autoIncludeTriggers ?? []).join('\\n') : '')\n  }, [activeDocument?.id])")
insert_before('src/Workspace.tsx', '  async function changeCodexSummaryPreference', '''  async function saveCodexTriggers() {
    if (activeDocument?.type !== 'codexEntry' || isCodexEntryArchived(activeDocument)) return
    try {
      const updated = await updateCodexAutoIncludeTriggers(activeDocument.id, codexTriggerDraft.split(/\r?\n/))
      setActiveDocument(updated)
      setCodexEntries((entries) => entries.map((entry) => entry.id === updated.id ? updated : entry))
      setCodexTriggerDraft((updated.autoIncludeTriggers ?? []).join('\n'))
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not save Codex triggers.')
    }
  }

''')
# Metadata: add trigger field after summary preference for active codex.
needle="""{!activeCodexArchived && <label className="codex-summary-preference"><input type="checkbox" checked={activeDocument.preferSummaryForContext === true} onChange={(event) => { void changeCodexSummaryPreference(event.target.checked) }} /><span><strong>Prefer summary for AI context</strong><small>{codexSummaryPolicyText(activeDocument, summaryStates[activeDocument.id] ?? 'missing')}</small></span></label>}"""
replacement=needle+"""{!activeCodexArchived && <label className="codex-trigger-editor"><span><strong>Auto include when text contains</strong></span><textarea value={codexTriggerDraft} onChange={(event) => setCodexTriggerDraft(event.target.value)} onBlur={() => { void saveCodexTriggers() }} placeholder="One literal trigger per line" /><small>One name, alias, phrase, or #tag per line. New entries start with their title; removing it keeps it removed, and renaming the entry does not rewrite triggers.</small></label>}"""
replace('src/Workspace.tsx', needle, replacement)

from pathlib import Path


def replace(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'missing replacement in {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1))

# Extend the reusable #83 mention index so display highlighting includes the active
# Codex title even when the ordinary auto-include title trigger was removed.
replace('src/codex-trigger-service.ts',
"      entryTriggers(entry).forEach((trigger) => {",
"      normalizeCodexTriggerList([entry.title, ...entryTriggers(entry)]).forEach((trigger) => {")

# CodeMirror mention decorations and click bridge.
replace('src/MarkdownEditor.tsx',
"import { EditorState, StateEffect, StateField, Transaction } from '@codemirror/state'\n",
"import { EditorState, StateEffect, StateField, Transaction } from '@codemirror/state'\nimport { findTriggerRanges, type CodexMentionTerm } from './codex-trigger-service'\n")
replace('src/MarkdownEditor.tsx',
"import './markdown-editor.css'\n",
"import './markdown-editor.css'\nimport './codex-mentions.css'\n")
replace('src/MarkdownEditor.tsx',
"type MarkdownEditorProps = {\n  value: string\n  onChange: (value: string) => void\n  ariaLabel?: string\n  className?: string\n  readOnly?: boolean\n}\n",
"export type CodexMentionClick = {\n  term: CodexMentionTerm\n  rect: { left: number; top: number; right: number; bottom: number; width: number; height: number }\n}\n\ntype MarkdownEditorProps = {\n  value: string\n  onChange: (value: string) => void\n  ariaLabel?: string\n  className?: string\n  readOnly?: boolean\n  mentionTerms?: CodexMentionTerm[]\n  onMentionClick?: (mention: CodexMentionClick) => void\n}\n")
insert_marker = "type GenerationHighlight = { from: number; to: number; active: boolean } | null\n"
insert = r'''type MentionFieldValue = { terms: CodexMentionTerm[]; decorations: DecorationSet }
const setMentionTerms = StateEffect.define<CodexMentionTerm[]>()

function intersects(from: number, to: number, blocked: Array<{ from: number; to: number }>) {
  return blocked.some((range) => range.from < to && range.to > from)
}

function mentionBlockedRanges(state: EditorState) {
  const blocked: Array<{ from: number; to: number }> = []
  syntaxTree(state).iterate({
    enter(node) {
      if (/Code|URL|LinkMark/i.test(node.name)) blocked.push({ from: node.from, to: node.to })
    },
  })
  const text = state.doc.toString()
  for (const match of text.matchAll(/(?:https?:\/\/|www\.)[^\s<>()]+/giu)) {
    const from = match.index ?? -1
    if (from >= 0) blocked.push({ from, to: from + match[0].length })
  }
  return blocked
}

function buildMentionDecorations(state: EditorState, terms: CodexMentionTerm[]) {
  if (!terms.length || !state.doc.length) return Decoration.none
  const text = state.doc.toString()
  const blocked = mentionBlockedRanges(state)
  const candidates = terms.flatMap((term) => findTriggerRanges(text, term.text).map((range) => ({ ...range, term })))
    .filter((candidate) => !intersects(candidate.from, candidate.to, blocked))
    .sort((left, right) => left.from - right.from || (right.to - right.from) - (left.to - left.from) || left.term.key.localeCompare(right.term.key))
  const accepted: typeof candidates = []
  let occupiedTo = -1
  candidates.forEach((candidate) => {
    if (candidate.from < occupiedTo) return
    accepted.push(candidate)
    occupiedTo = candidate.to
  })
  return Decoration.set(accepted.map((candidate) => Decoration.mark({
    class: 'cm-codex-mention',
    attributes: { 'data-codex-term': candidate.term.key, 'aria-label': `Codex mention: ${candidate.term.text}` },
  }).range(candidate.from, candidate.to)), true)
}

const mentionField = StateField.define<MentionFieldValue>({
  create: () => ({ terms: [], decorations: Decoration.none }),
  update(value, transaction) {
    let terms = value.terms
    let shouldRebuild = transaction.docChanged
    for (const effect of transaction.effects) {
      if (!effect.is(setMentionTerms)) continue
      terms = effect.value
      shouldRebuild = true
    }
    return shouldRebuild
      ? { terms, decorations: buildMentionDecorations(transaction.state, terms) }
      : { terms, decorations: value.decorations.map(transaction.changes) }
  },
  provide: field => EditorView.decorations.from(field, value => value.decorations),
})

'''
replace('src/MarkdownEditor.tsx', insert_marker, insert + insert_marker)
replace('src/MarkdownEditor.tsx',
"  { value, onChange, ariaLabel = 'Markdown editor', className = '', readOnly = false },\n",
"  { value, onChange, ariaLabel = 'Markdown editor', className = '', readOnly = false, mentionTerms = [], onMentionClick },\n")
replace('src/MarkdownEditor.tsx',
"  const onChangeRef = useRef(onChange)\n",
"  const onChangeRef = useRef(onChange)\n  const mentionTermsRef = useRef(mentionTerms)\n  const onMentionClickRef = useRef(onMentionClick)\n")
replace('src/MarkdownEditor.tsx',
"  useEffect(() => { onChangeRef.current = onChange }, [onChange])\n",
"  useEffect(() => { onChangeRef.current = onChange }, [onChange])\n  useEffect(() => { onMentionClickRef.current = onMentionClick }, [onMentionClick])\n  useEffect(() => {\n    mentionTermsRef.current = mentionTerms\n    viewRef.current?.dispatch({ effects: setMentionTerms.of(mentionTerms) })\n  }, [mentionTerms])\n")
replace('src/MarkdownEditor.tsx',
"        livePreview,\n        generationHighlightField,\n",
"        livePreview,\n        generationHighlightField,\n        mentionField,\n        EditorView.domEventHandlers({\n          click: (event, view) => {\n            if (event.button !== 0 || !view.state.selection.main.empty) return false\n            const element = event.target instanceof Element ? event.target.closest<HTMLElement>('.cm-codex-mention') : null\n            const key = element?.dataset.codexTerm\n            const term = key ? mentionTermsRef.current.find((candidate) => candidate.key === key) : undefined\n            if (!element || !term || !onMentionClickRef.current) return false\n            const bounds = element.getBoundingClientRect()\n            onMentionClickRef.current({ term, rect: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom, width: bounds.width, height: bounds.height } })\n            return false\n          },\n        }),\n")
replace('src/MarkdownEditor.tsx',
"    const view = new EditorView({ state, parent: hostRef.current })\n    viewRef.current = view\n",
"    const view = new EditorView({ state, parent: hostRef.current })\n    viewRef.current = view\n    if (mentionTermsRef.current.length) view.dispatch({ effects: setMentionTerms.of(mentionTermsRef.current) })\n")

# Workspace popup state and navigation.
replace('src/Workspace.tsx',
"import { useEffect, useRef, useState } from 'react'\n",
"import { useEffect, useMemo, useRef, useState } from 'react'\nimport ReactMarkdown from 'react-markdown'\nimport remarkGfm from 'remark-gfm'\n")
replace('src/Workspace.tsx',
"import MarkdownEditor, { type MarkdownEditorHandle } from './MarkdownEditor'\n",
"import MarkdownEditor, { type CodexMentionClick, type MarkdownEditorHandle } from './MarkdownEditor'\n")
replace('src/Workspace.tsx',
"import { buildSummarySource, getSummaryStateMap, renderSummaryPrompt, type SummaryState } from './summary-service'\n",
"import { buildSummarySource, getSummaryStateMap, renderSummaryPrompt, summaryStateForSource, type SummaryState } from './summary-service'\nimport { buildCodexMentionIndex, type CodexMentionEntry, type CodexMentionTerm } from './codex-trigger-service'\n")
replace('src/Workspace.tsx',
"import './codex-triggers.css'\n",
"import './codex-triggers.css'\nimport './codex-mentions.css'\n")
replace('src/Workspace.tsx',
"type AutotitleUiState = { targetId: string; targetType: AutotitleTargetType; targetTitle: string; status: 'loading' | 'ready' | 'error'; suggestion?: string; error?: string; request?: AutotitleRequest }\n",
"type AutotitleUiState = { targetId: string; targetType: AutotitleTargetType; targetTitle: string; status: 'loading' | 'ready' | 'error'; suggestion?: string; error?: string; request?: AutotitleRequest }\ntype LoreMentionPreview = { entryId: string; title: string; category: string; content: string; source: 'summary' | 'excerpt' }\ntype LoreMentionPopupState = { id: number; term: CodexMentionTerm; anchor: CodexMentionClick['rect']; selectedId?: string; loading?: boolean; preview?: LoreMentionPreview; error?: string }\n")
replace('src/Workspace.tsx',
"  const [autotitle, setAutotitle] = useState<AutotitleUiState | null>(null)\n",
"  const [autotitle, setAutotitle] = useState<AutotitleUiState | null>(null)\n  const [loreMention, setLoreMention] = useState<LoreMentionPopupState | null>(null)\n")
replace('src/Workspace.tsx',
"  const latestGenerationRequestRef = useRef<GenerationRequestSnapshot | null>(null)\n",
"  const latestGenerationRequestRef = useRef<GenerationRequestSnapshot | null>(null)\n  const codexMentionIndex = useMemo(() => buildCodexMentionIndex(codexEntries), [codexEntries])\n")
replace('src/Workspace.tsx',
"    setCodexTriggerDraft(activeDocument?.type === 'codexEntry' ? (activeDocument.autoIncludeTriggers ?? []).join('\\n') : '')\n",
"    setCodexTriggerDraft(activeDocument?.type === 'codexEntry' ? (activeDocument.autoIncludeTriggers ?? []).join('\\n') : '')\n    setLoreMention(null)\n")

# Insert popup helpers before generation/TTS helpers.
marker = "  async function speechSettings() {\n"
helpers = r'''  function compactLoreExcerpt(markdown: string, limit = 700) {
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
      const currentSummary = summaryStateForSource(entry, entities) === 'current' && summary?.content.trim() ? summary.content.trim() : ''
      const preview: LoreMentionPreview = {
        entryId: entry.id,
        title: entry.title,
        category: entry.category,
        content: currentSummary || compactLoreExcerpt(entry.content),
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

'''
replace('src/Workspace.tsx', marker, helpers + marker)

# Wire Scene-only mentions into the main editor and render popup.
replace('src/Workspace.tsx',
"        {activeDocument ? <MarkdownEditor key={`${activeDocument.id}-${editorRevision}`} ref={editorRef} value={storyMarkdown} onChange={handleStoryChange} ariaLabel={`${activeDocument.title} Markdown editor`} readOnly={activeCodexArchived || activeSummarySourceArchived} /> :",
"        {activeDocument ? <MarkdownEditor key={`${activeDocument.id}-${editorRevision}`} ref={editorRef} value={storyMarkdown} onChange={handleStoryChange} ariaLabel={`${activeDocument.title} Markdown editor`} readOnly={activeCodexArchived || activeSummarySourceArchived} mentionTerms={activeDocument.type === 'scene' ? codexMentionIndex : []} onMentionClick={activeDocument.type === 'scene' ? openLoreMention : undefined} /> :")
replace('src/Workspace.tsx',
"      {autotitle && <AutotitlePanel state={autotitle}",
"      {loreMention && <LoreMentionPopover state={loreMention} onClose={() => setLoreMention(null)} onSelect={(entry) => { void loadLoreMentionPreview(loreMention.id, entry) }} onOpen={(entryId) => { void openLoreMentionEntry(entryId) }} />}\n      {autotitle && <AutotitlePanel state={autotitle}")

# Insert popup component before TTS status component.
popup_marker = "function TtsStatusBar() {\n"
popup_component = r'''function LoreMentionPopover({ state, onClose, onSelect, onOpen }: {
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

  return createPortal(<section ref={panelRef} className="codex-mention-popover" role="dialog" aria-label={`Lore preview for ${state.term.text}`} style={{ left, top, width }}>
    <header><div><small>Codex mention</small><strong>{state.term.text}</strong></div><button type="button" onClick={onClose} aria-label="Close lore preview"><X aria-hidden="true" /></button></header>
    {state.term.entries.length > 1 && <div className="codex-mention-choices"><p>{selected ? 'Other matching entries' : 'Multiple Codex entries use this name. Choose one:'}</p>{state.term.entries.map((entry) => <button key={entry.id} className={entry.id === state.selectedId ? 'selected' : ''} type="button" onClick={() => onSelect(entry)}><span><strong>{entry.title}</strong><small>{entry.category}</small></span>{entry.id === state.selectedId && <Check aria-hidden="true" />}</button>)}</div>}
    {state.loading && <p className="codex-mention-loading">Loading lore…</p>}
    {state.error && <p className="codex-mention-error" role="alert">{state.error}</p>}
    {state.preview && <div className="codex-mention-preview"><div className="codex-mention-preview-heading"><span><strong>{state.preview.title}</strong><small>{state.preview.category} · {state.preview.source === 'summary' ? 'Current summary' : 'Entry excerpt'}</small></span></div><div className="codex-mention-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{state.preview.content}</ReactMarkdown></div><button className="codex-mention-open" type="button" onClick={() => onOpen(state.preview!.entryId)}>Open Codex entry <ChevronRight aria-hidden="true" /></button></div>}
    {!state.loading && !state.preview && !state.error && state.term.entries.length === 1 && <button className="codex-mention-choice-single" type="button" onClick={() => onSelect(state.term.entries[0])}>Load lore preview</button>}
  </section>, document.body)
}

'''
replace('src/Workspace.tsx', popup_marker, popup_component + popup_marker)

# Styling for subtle inline mentions and mobile-safe popup.
Path('src/codex-mentions.css').write_text(r'''.cm-codex-mention {
  border-radius: 3px;
  background: color-mix(in srgb, var(--accent-bright, #c6a86b) 10%, transparent);
  text-decoration-line: underline;
  text-decoration-style: dotted;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
  text-decoration-color: color-mix(in srgb, var(--accent-bright, #c6a86b) 58%, transparent);
  cursor: pointer;
}
.cm-codex-mention:hover { background: color-mix(in srgb, var(--accent-bright, #c6a86b) 17%, transparent); }
.codex-mention-popover { position: fixed; z-index: 110; max-height: min(440px, calc(100vh - 24px)); overflow: auto; padding: 12px; border: 1px solid rgba(255,255,255,.12); border-radius: 14px; background: color-mix(in srgb, var(--panel, #1b1b1e) 96%, transparent); box-shadow: 0 18px 60px rgba(0,0,0,.42); backdrop-filter: blur(18px); display: grid; gap: 11px; }
.codex-mention-popover > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.codex-mention-popover > header > div { display: grid; gap: 2px; min-width: 0; }
.codex-mention-popover > header small, .codex-mention-preview-heading small { opacity: .62; }
.codex-mention-popover > header strong { overflow-wrap: anywhere; }
.codex-mention-popover > header button { width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; flex: none; }
.codex-mention-choices { display: grid; gap: 6px; }
.codex-mention-choices p { margin: 0 0 2px; font-size: .8rem; opacity: .68; }
.codex-mention-choices button { display: flex; align-items: center; justify-content: space-between; gap: 10px; text-align: left; padding: 8px 9px; border-radius: 9px; }
.codex-mention-choices button span { display: grid; gap: 1px; min-width: 0; }
.codex-mention-choices button small { opacity: .6; }
.codex-mention-choices button.selected { outline: 1px solid color-mix(in srgb, var(--accent-bright, #c6a86b) 55%, transparent); }
.codex-mention-preview { display: grid; gap: 9px; }
.codex-mention-preview-heading span { display: grid; gap: 2px; }
.codex-mention-markdown { max-height: 230px; overflow: auto; font-family: var(--editor-font, inherit); line-height: 1.48; font-size: .94rem; }
.codex-mention-markdown > :first-child { margin-top: 0; }
.codex-mention-markdown > :last-child { margin-bottom: 0; }
.codex-mention-open, .codex-mention-choice-single { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.codex-mention-open svg { width: 15px; height: 15px; }
.codex-mention-loading, .codex-mention-error { margin: 0; font-size: .86rem; }
.codex-mention-error { color: #e9a6a6; }
@media (max-width: 640px) {
  .codex-mention-popover { max-height: min(54vh, 430px); padding: 11px; }
  .codex-mention-choices button { min-height: 44px; }
  .codex-mention-open, .codex-mention-choice-single { min-height: 44px; }
}
''')

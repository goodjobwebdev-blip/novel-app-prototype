from pathlib import Path
import re

workspace_path = Path('src/Workspace.tsx')
text = workspace_path.read_text()

# Shared pure ownership predicate for defense-in-depth completion checks.
Path('src/summary-generation-owner.ts').write_text(r'''export type SummaryGenerationOwner = {
  requestId: number
  bookId: string
  summaryId: string
}

export type SummaryGenerationUiState = {
  bookId: string | null
  documentId: string | null
  screen: 'home' | 'editor' | 'chat' | 'settings'
}

export function summaryGenerationOwnsUi(
  owner: SummaryGenerationOwner,
  currentOwner: SummaryGenerationOwner | null,
  state: SummaryGenerationUiState,
) {
  return Boolean(
    currentOwner
    && currentOwner.requestId === owner.requestId
    && currentOwner.bookId === owner.bookId
    && currentOwner.summaryId === owner.summaryId
    && state.bookId === owner.bookId
    && state.documentId === owner.summaryId
    && state.screen === 'editor',
  )
}
''')

# Focused regression coverage. One structural assertion protects the critical
# "ownership before first await" invariant which cannot be expressed by the pure helper alone.
Path('tests/summary-generation-owner.test.mjs').write_text(r'''import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { summaryGenerationOwnsUi } from '../src/summary-generation-owner.ts'

const owner = { requestId: 7, bookId: 'book-a', summaryId: 'summary-a' }

test('summary completion owns UI only for the exact request, book, summary, and editor screen', () => {
  assert.equal(summaryGenerationOwnsUi(owner, owner, { bookId: 'book-a', documentId: 'summary-a', screen: 'editor' }), true)
  assert.equal(summaryGenerationOwnsUi(owner, { ...owner, requestId: 8 }, { bookId: 'book-a', documentId: 'summary-a', screen: 'editor' }), false)
  assert.equal(summaryGenerationOwnsUi(owner, owner, { bookId: 'book-b', documentId: 'summary-a', screen: 'editor' }), false)
  assert.equal(summaryGenerationOwnsUi(owner, owner, { bookId: 'book-a', documentId: 'scene-b', screen: 'editor' }), false)
  assert.equal(summaryGenerationOwnsUi(owner, owner, { bookId: 'book-a', documentId: 'summary-a', screen: 'chat' }), false)
})

test('summary generation reserves navigation ownership before its first async preflight', () => {
  const source = readFileSync(new URL('../src/Workspace.tsx', import.meta.url), 'utf8')
  const start = source.indexOf('  async function runSummaryGeneration() {')
  const end = source.indexOf('\n  function generate() {', start)
  assert.ok(start >= 0 && end > start, 'runSummaryGeneration block exists')
  const block = source.slice(start, end)
  const reserve = block.indexOf('generationAbortRef.current = controller')
  const firstAwait = block.indexOf('await ')
  assert.ok(reserve >= 0, 'summary reserves the shared generation controller')
  assert.ok(firstAwait > reserve, 'navigation ownership is reserved before the first await')
  const ownershipGuard = block.indexOf('summaryGenerationOwnsUi(')
  const uiMutation = block.indexOf('activeDocumentIdRef.current = saved.id')
  assert.ok(ownershipGuard >= 0 && uiMutation > ownershipGuard, 'completion guard precedes active-editor mutation')
})

test('book switching also honors the active generation navigation guard', () => {
  const source = readFileSync(new URL('../src/Workspace.tsx', import.meta.url), 'utf8')
  const start = source.indexOf('  async function openBook(')
  const end = source.indexOf('\n  async function deleteWithSaveBarrier', start)
  const block = source.slice(start, end)
  assert.match(block, /canUnmountEditor\(Boolean\(generationAbortRef\.current\)\)/)
  assert.match(block, /Stop generation before switching books\./)
})
''')

# Import the pure ownership predicate.
anchor = "import { canUnmountEditor } from './editor-unmount-guard'\n"
if anchor not in text:
    raise SystemExit('editor guard import anchor missing')
text = text.replace(anchor, anchor + "import { summaryGenerationOwnsUi, type SummaryGenerationOwner } from './summary-generation-owner'\n", 1)

# Active owner includes the AbortController, while the shared helper stays browser-agnostic.
type_anchor = "type LoreMentionPopupState = { id: number; term: CodexMentionTerm; anchor: CodexMentionClick['rect']; selectedId?: string; loading?: boolean; preview?: LoreMentionPreview; error?: string }\n"
if type_anchor not in text:
    raise SystemExit('type anchor missing')
text = text.replace(type_anchor, type_anchor + "type ActiveSummaryGenerationOwner = SummaryGenerationOwner & { controller: AbortController }\n", 1)

# Keep authoritative synchronous refs for the completion guard.
ref_anchor = "  const latestGenerationRequestRef = useRef<GenerationRequestSnapshot | null>(null)\n"
if ref_anchor not in text:
    raise SystemExit('generation request ref anchor missing')
text = text.replace(ref_anchor, ref_anchor + "  const summaryGenerationSequenceRef = useRef(0)\n  const summaryGenerationOwnerRef = useRef<ActiveSummaryGenerationOwner | null>(null)\n  const currentBookIdRef = useRef<string | null>(currentBook?.id ?? null)\n  const screenRef = useRef<Screen>(screen)\n  currentBookIdRef.current = currentBook?.id ?? null\n  screenRef.current = screen\n", 1)

# #138 explicitly requires Book transitions to obey the same Stop-first rule.
open_book_anchor = "  async function openBook(bookId: string, preferredSceneId?: string) {\n"
if open_book_anchor not in text:
    raise SystemExit('openBook anchor missing')
text = text.replace(open_book_anchor, open_book_anchor + "    if (!canUnmountEditor(Boolean(generationAbortRef.current))) {\n      showToast('Stop generation before switching books.')\n      return\n    }\n", 1)

# Replace Summary generation with synchronous ownership reservation, abort-aware preflight,
# and guarded completion. Persistence remains scoped to the captured Summary even if UI ownership is stale.
pattern = re.compile(r"  async function runSummaryGeneration\(\) \{[\s\S]*?\n  \}\n\n  function generate\(\) \{", re.M)
match = pattern.search(text)
if not match:
    raise SystemExit('runSummaryGeneration block missing')
new_block = r'''  async function runSummaryGeneration() {
    if (generationAbortRef.current || summaryGenerationOwnerRef.current || !currentBook || activeDocument?.type !== 'summary') return

    const book = currentBook
    const startingSummary = activeDocument
    const controller = new AbortController()
    const owner: ActiveSummaryGenerationOwner = {
      requestId: ++summaryGenerationSequenceRef.current,
      bookId: book.id,
      summaryId: startingSummary.id,
      controller,
    }

    // Reserve generation/navigation ownership synchronously, before any save/settings/source await.
    summaryGenerationOwnerRef.current = owner
    generationAbortRef.current = controller
    generationStartedAtRef.current = Date.now()
    setGenerationElapsedSeconds(0)
    setGenerationPhase('sending')
    setGenerationDetails(null)
    setGenerationDetailsOpen(false)
    setGenerationActive(true)

    let status: 'complete' | 'cancelled' | 'error' = 'complete'
    const cancelledDuringPreflight = () => {
      if (!controller.signal.aborted) return false
      status = 'cancelled'
      return true
    }

    try {
      if (changedSinceSnapshotRef.current) {
        await flushDocument('manual', true)
        if (cancelledDuringPreflight()) return
      }

      const summary = await getEntity<SummaryEntity>(owner.summaryId)
      if (cancelledDuringPreflight()) return
      if (!summary || summary.type !== 'summary') {
        status = 'error'
        showToast('This summary is no longer available.')
        return
      }

      let settings: AiSettings
      try {
        const defaults = loadAiSettings()
        settings = await getBookAiSettings(owner.bookId, defaults.favorites)
      } catch {
        if (cancelledDuringPreflight()) return
        status = 'error'
        showToast('This book’s AI settings could not be loaded.')
        return
      }
      if (cancelledDuringPreflight()) return
      if (settings.provider !== 'nanogpt' || !settings.apiKey.trim() || !settings.supportModel.trim()) {
        status = 'error'
        showToast('Choose NanoGPT and a Support model in Book settings before summarizing.')
        return
      }

      const source = await buildSummarySource(summary.sourceEntityId)
      if (cancelledDuringPreflight()) return
      if (source.source.type === 'codexEntry' && isCodexEntryArchived(source.source)) {
        status = 'error'
        showToast('Restore this Codex entry before updating its summary.')
        return
      }

      setGenerationDetails({
        task: 'Summary',
        action: 'Summarize',
        targetTitle: source.source.title,
        requestedModel: settings.supportModel,
        provider: 'NanoGPT',
        startedAt: generationStartedAtRef.current,
        status: 'sending',
        thoughts: '',
      })

      let generated = ''
      await streamNanoGPTCompletion({
        apiKey: settings.apiKey.trim(),
        baseUrl: settings.baseUrl,
        model: settings.supportModel,
        systemPrompt: renderSummaryPrompt(settings.prompts.summarize, summary.sourceType, summary.content, toBookPromptValues(book, seriesList)),
        userMessage: `${summary.content.trim() ? `# Existing summary\n\n${summary.content.trim()}\n\n` : ''}# Source material\n\n${source.content}\n\nReturn only the updated summary as Markdown.`,
      }, (chunk) => {
        if (!controller.signal.aborted) setGenerationActivityPhase('writing')
        generated += chunk
      }, controller.signal, {
        onResponse: () => {
          if (!controller.signal.aborted) setGenerationActivityPhase('thinking')
        },
        onThoughts: appendGenerationThoughts,
        onMetadata: updateGenerationMetadata,
      })
      if (controller.signal.aborted) {
        status = 'cancelled'
        return
      }

      await createSnapshot(summary.id, 'generation', summary.content)
      if (controller.signal.aborted) {
        status = 'cancelled'
        return
      }
      const saved = await saveSummaryContent(summary.id, generated, source.sourceRevision)
      const nextSummaryStates = await getSummaryStateMap(owner.bookId)

      // Persistence is safely scoped to the captured Summary. Active UI is mutated only
      // if the exact request still owns the same Book/Summary/editor screen.
      if (summaryGenerationOwnsUi(owner, summaryGenerationOwnerRef.current, {
        bookId: currentBookIdRef.current,
        documentId: activeDocumentIdRef.current,
        screen: screenRef.current,
      })) {
        activeDocumentIdRef.current = saved.id
        setActiveDocument(saved)
        storyRef.current = saved.content
        setStoryMarkdown(saved.content)
        changedSinceSnapshotRef.current = false
        setEditorRevision((revision) => revision + 1)
        setSummaryStates(nextSummaryStates)
        setSaveState('saved')
      }
    } catch (error) {
      status = controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError') ? 'cancelled' : 'error'
      if (status === 'error') showToast(error instanceof Error ? error.message : 'Summary generation stopped unexpectedly.')
    } finally {
      if (summaryGenerationOwnerRef.current?.requestId === owner.requestId) summaryGenerationOwnerRef.current = null
      if (generationAbortRef.current === controller) generationAbortRef.current = null
      finishGenerationActivity(status)
    }
  }

  function generate() {'''
text = text[:match.start()] + new_block + text[match.end():]

workspace_path.write_text(text)

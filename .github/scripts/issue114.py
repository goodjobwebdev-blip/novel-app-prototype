from pathlib import Path
import re

path = Path('src/Workspace.tsx')
text = path.read_text()

anchor = "import { applyIfStillCurrent } from './async-state-guard'\n"
if anchor not in text:
    raise SystemExit('import anchor not found')
text = text.replace(anchor, anchor + "import { KeyedAsyncQueue } from './keyed-async-queue'\n", 1)

ref_anchor = "  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)\n"
if ref_anchor not in text:
    raise SystemExit('save timer ref anchor not found')
text = text.replace(ref_anchor, ref_anchor + "  const documentSaveQueueRef = useRef(new KeyedAsyncQueue())\n", 1)

pattern = re.compile(r"  async function flushDocument\(reason: SnapshotReason = 'autosave', snapshot = false\): Promise<boolean> \{.*?\n  \}\n\n  useEffect\(\(\) => \{", re.S)
match = pattern.search(text)
if not match:
    raise SystemExit('flushDocument block not found')

replacement = r'''  async function flushDocument(reason: SnapshotReason = 'autosave', snapshot = false): Promise<boolean> {
    const documentId = activeDocumentIdRef.current
    if (!storageReadyRef.current || !documentId) return false
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    if (activeDocumentIdRef.current === documentId) setSaveState('saving')

    while (true) {
      const contentSnapshot = storyRef.current
      const snapshotRequested = snapshot && changedSinceSnapshotRef.current
      let savedDocument: EditableEntity
      try {
        savedDocument = await documentSaveQueueRef.current.run(documentId, async () => {
          const current = await getEntity<EditableEntity>(documentId)
          if (!current) throw new Error(`Cannot save missing document ${documentId}`)
          return current.type === 'summary'
            ? await saveSummaryContent(current.id, contentSnapshot, (await buildSummarySource(current.sourceEntityId)).sourceRevision)
            : await saveDocumentContent(documentId, contentSnapshot) as EditableEntity
        })
      } catch (error) {
        console.error('Failed to persist document', error)
        if (activeDocumentIdRef.current === documentId) setSaveState('error')
        return false
      }

      const editedAt = Date.now()
      if (savedDocument.type === 'note') setNotes((items) => items.map((item) => item.id === savedDocument.id ? savedDocument : item))
      if (savedDocument.type === 'codexEntry') setCodexEntries((items) => items.map((item) => item.id === savedDocument.id ? savedDocument : item))
      setCurrentBook((book) => book && book.id === savedDocument.bookId ? { ...book, updatedAt: editedAt } : book)
      setBookList((books) => books.map((book) => book.id === savedDocument.bookId ? { ...book, updatedAt: editedAt } : book))

      if (activeDocumentIdRef.current !== documentId) return true
      if (storyRef.current !== contentSnapshot) {
        // A newer edit arrived while this immutable snapshot was saving. Autosave may
        // leave it for the newly scheduled debounce; navigation/snapshot saves must
        // continue until the exact current editor value is durable.
        if (!snapshot) return true
        setSaveState('saving')
        continue
      }

      let nextSummaryStates: Record<string, SummaryState> | null = null
      try {
        if (savedDocument.bookId) nextSummaryStates = await getSummaryStateMap(savedDocument.bookId)
        if (snapshotRequested) {
          await documentSaveQueueRef.current.run(documentId, async () => {
            await createSnapshot(documentId, reason, contentSnapshot)
          })
        }
      } catch (error) {
        console.error('Failed to finalize document save', error)
        if (activeDocumentIdRef.current === documentId) setSaveState('error')
        return false
      }

      if (activeDocumentIdRef.current !== documentId) return true
      if (storyRef.current !== contentSnapshot) {
        if (!snapshot) return true
        setSaveState('saving')
        continue
      }

      if (snapshotRequested) changedSinceSnapshotRef.current = false
      setActiveDocument(savedDocument)
      if (nextSummaryStates) setSummaryStates(nextSummaryStates)
      setSaveState('saved')
      return true
    }
  }

  useEffect(() => {'''

text = text[:match.start()] + replacement + text[match.end():]
path.write_text(text)

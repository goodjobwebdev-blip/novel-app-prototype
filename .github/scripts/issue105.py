from pathlib import Path

path = Path('src/Workspace.tsx')
text = path.read_text()

anchor = "import { applyIfStillCurrent } from './async-state-guard'\n"
if anchor not in text:
    raise SystemExit('Workspace async guard import anchor not found')
if "import { navigateAfterRequiredSave } from './navigation-save-guard'" not in text:
    text = text.replace(anchor, anchor + "import { navigateAfterRequiredSave } from './navigation-save-guard'\n", 1)

text = text.replace(
    "  async function flushDocument(reason: SnapshotReason = 'autosave', snapshot = false) {\n    const documentId = activeDocumentIdRef.current\n    if (!storageReadyRef.current || !documentId) return\n",
    "  async function flushDocument(reason: SnapshotReason = 'autosave', snapshot = false): Promise<boolean> {\n    const documentId = activeDocumentIdRef.current\n    if (!storageReadyRef.current || !documentId) return false\n",
    1,
)

old = """      if (savedDocument.bookId) setSummaryStates(await getSummaryStateMap(savedDocument.bookId))
      setSaveState('saved')
    } catch (error) {
      console.error('Failed to persist document', error)
      setSaveState('error')
    }
  }
"""
new = """      if (savedDocument.bookId) setSummaryStates(await getSummaryStateMap(savedDocument.bookId))
      setSaveState('saved')
      return true
    } catch (error) {
      console.error('Failed to persist document', error)
      setSaveState('error')
      return false
    }
  }
"""
if old not in text:
    raise SystemExit('flushDocument result block not found')
text = text.replace(old, new, 1)

old = """  function openChat(chatId: string) {
    if (screen === 'editor' && changedSinceSnapshotRef.current) void flushDocument('navigation', true)
    setActiveChatId(chatId)
    setChatPanel('list')
    setScreen('chat')
    setRightOpen(false)
  }
"""
new = """  async function openChat(chatId: string) {
    const opened = await navigateAfterRequiredSave(
      screen === 'editor' && changedSinceSnapshotRef.current,
      () => flushDocument('navigation', true),
      () => {
        setActiveChatId(chatId)
        setChatPanel('list')
        setScreen('chat')
        setRightOpen(false)
      },
    )
    if (!opened) showToast('Could not save the current document. Chat was not opened because its context could be stale.')
  }
"""
if old not in text:
    raise SystemExit('openChat block not found')
text = text.replace(old, new, 1)

path.write_text(text)

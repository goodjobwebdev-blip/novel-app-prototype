from pathlib import Path

path = Path('src/Workspace.tsx')
text = path.read_text()
import_anchor = "import { createBufferedWordRenderer } from './buffered-word-renderer'\n"
if import_anchor not in text:
    raise SystemExit('Workspace import anchor not found')
text = text.replace(import_anchor, import_anchor + "import { applyIfStillCurrent } from './async-state-guard'\n", 1)
old = """  async function saveCodexTriggers() {
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
"""
new = """  async function saveCodexTriggers() {
    if (activeDocument?.type !== 'codexEntry' || isCodexEntryArchived(activeDocument)) return
    const sourceId = activeDocument.id
    const triggerSnapshot = codexTriggerDraft.split(/\r?\n/)
    try {
      const updated = await updateCodexAutoIncludeTriggers(sourceId, triggerSnapshot)
      setCodexEntries((entries) => entries.map((entry) => entry.id === updated.id ? updated : entry))
      applyIfStillCurrent(sourceId, () => activeDocumentIdRef.current, () => {
        setActiveDocument(updated)
        setCodexTriggerDraft((updated.autoIncludeTriggers ?? []).join('\n'))
      })
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not save Codex triggers.')
    }
  }
"""
if old not in text:
    raise SystemExit('saveCodexTriggers target block not found')
path.write_text(text.replace(old, new, 1))

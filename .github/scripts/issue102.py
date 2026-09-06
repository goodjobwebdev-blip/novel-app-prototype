from pathlib import Path
import re

path = Path('src/Workspace.tsx')
text = path.read_text()
import_anchor = "import { createBufferedWordRenderer } from './buffered-word-renderer'\n"
if import_anchor not in text:
    raise SystemExit('Workspace import anchor not found')
if "import { applyIfStillCurrent } from './async-state-guard'" not in text:
    text = text.replace(import_anchor, import_anchor + "import { applyIfStillCurrent } from './async-state-guard'\n", 1)

pattern = r"  async function saveCodexTriggers\(\) \{[\s\S]*?\n  \}\n\n(?=  async function changeCodexSummaryPreference)"
replacement = r'''  async function saveCodexTriggers() {
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

'''
text, count = re.subn(pattern, lambda _: replacement, text, count=1)
if count != 1:
    raise SystemExit('saveCodexTriggers structural block not found')
path.write_text(text)

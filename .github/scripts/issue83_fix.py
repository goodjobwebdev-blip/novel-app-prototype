from pathlib import Path
import re

# Keep TypeScript escape sequences literal when generated through the Python patch.
p = Path('src/context-service.ts')
text = p.read_text()
text = text.replace("}).join('\n\n')", "}).join('\\n\\n')")
p.write_text(text)

p = Path('src/Workspace.tsx')
text = p.read_text()
pattern = r"  async function saveCodexTriggers\(\) \{[\s\S]*?\n  \}\n\n(?=  async function changeCodexSummaryPreference)"
replacement = r'''  async function saveCodexTriggers() {
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

'''
next_text, count = re.subn(pattern, lambda _: replacement, text, count=1)
if count != 1:
    raise SystemExit('Could not replace generated saveCodexTriggers block')
p.write_text(next_text)

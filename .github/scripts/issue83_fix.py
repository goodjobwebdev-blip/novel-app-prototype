from pathlib import Path
import re

# Keep TypeScript escape sequences literal when generated through the Python patch.
p = Path('src/context-service.ts')
text = p.read_text()
text = text.replace("}).join('\n\n')", "}).join('\\n\\n')")
text = text.replace("representation: 'full' | 'summary'", "representation: 'Full entry' | 'Summary'")
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

# Correct global Context default persistence. The initial patch deliberately targets
# the common book-only guard, so normalize both affected functions after generation.
p = Path('src/App.tsx')
text = p.read_text()
text = text.replace(
'''  async function saveContextDefaults() {
    if (!book) {
      const saved = saveDefaultBookContextSettings(value)
      setContextSettings(saved)
      setContextSaved(true)
      return
    }
    const version = ++contextSaveVersionRef.current
    const value = contextSettings
''',
'''  async function saveContextDefaults() {
    if (!book) {
      const saved = saveDefaultBookContextSettings(contextSettings)
      setContextSettings(saved)
      setContextSaved(true)
      return
    }
    const version = ++contextSaveVersionRef.current
    const value = contextSettings
''',
1,
)
text = text.replace(
'''  function updateContextDefaults(value: BookContextSettings) {
    setContextSettings(value)
    setContextSaved(false)
    if (!book) return
    const version = ++contextSaveVersionRef.current
''',
'''  function updateContextDefaults(value: BookContextSettings) {
    setContextSettings(value)
    setContextSaved(false)
    if (!book) {
      const saved = saveDefaultBookContextSettings(value)
      setContextSettings(saved)
      setContextSaved(true)
      return
    }
    const version = ++contextSaveVersionRef.current
''',
1,
)
text = text.replace("item.representation === 'summary' ? 'Summary' : 'Full entry'", "item.representation === 'Summary' ? 'Summary' : 'Full entry'")
p.write_text(text)

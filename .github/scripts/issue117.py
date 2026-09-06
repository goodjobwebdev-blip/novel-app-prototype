from pathlib import Path

path = Path('src/Workspace.tsx')
text = path.read_text()

old = """  async function changeCodexCategory(category: string) {
    if (activeDocument?.type !== 'codexEntry' || !currentBook || isCodexEntryArchived(activeDocument)) return
    const updated = await updateCodexCategory(activeDocument.id, category)
    setActiveDocument(updated)
    await reloadBookContent(currentBook.id)
  }
"""
new = """  async function changeCodexCategory(category: string) {
    if (activeDocument?.type !== 'codexEntry' || !currentBook || isCodexEntryArchived(activeDocument)) return
    const sourceId = activeDocument.id
    const updated = await updateCodexCategory(sourceId, category)
    setCodexEntries((items) => items.map((item) => item.id === updated.id ? updated : item))
    applyIfStillCurrent(sourceId, () => activeDocumentIdRef.current, () => setActiveDocument(updated))
  }
"""
if old not in text:
    raise SystemExit('changeCodexCategory block not found')
text = text.replace(old, new, 1)

old = """  async function changeCodexSummaryPreference(prefer: boolean) {
    if (activeDocument?.type !== 'codexEntry' || !currentBook || isCodexEntryArchived(activeDocument)) return
    const updated = await updateCodexSummaryPreference(activeDocument.id, prefer)
    setActiveDocument(updated)
    setCodexEntries((items) => items.map((item) => item.id === updated.id ? updated : item))
  }
"""
new = """  async function changeCodexSummaryPreference(prefer: boolean) {
    if (activeDocument?.type !== 'codexEntry' || !currentBook || isCodexEntryArchived(activeDocument)) return
    const sourceId = activeDocument.id
    const updated = await updateCodexSummaryPreference(sourceId, prefer)
    setCodexEntries((items) => items.map((item) => item.id === updated.id ? updated : item))
    applyIfStillCurrent(sourceId, () => activeDocumentIdRef.current, () => setActiveDocument(updated))
  }
"""
if old not in text:
    raise SystemExit('changeCodexSummaryPreference block not found')
text = text.replace(old, new, 1)

path.write_text(text)

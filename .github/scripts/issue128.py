from pathlib import Path

path = Path('src/Workspace.tsx')
text = path.read_text()
old = """  async function removeContentEntity(entity: NoteEntity | CodexEntryEntity) {
    if (!currentBook || !window.confirm(`Delete “${entity.title}”? This cannot be undone.`)) return
    await deleteWithSaveBarrier(entity.id)
    await reloadBookContent(currentBook.id)
    if (activeDocumentIdRef.current === entity.id) {
"""
new = """  async function removeContentEntity(entity: NoteEntity | CodexEntryEntity) {
    if (!currentBook || !window.confirm(`Delete “${entity.title}”? This cannot be undone.`)) return
    const removedIds = await deleteWithSaveBarrier(entity.id)
    await reloadBookContent(currentBook.id)
    if (activeDocumentIdRef.current && removedIds.includes(activeDocumentIdRef.current)) {
"""
if old not in text:
    raise SystemExit('removeContentEntity block not found')
path.write_text(text.replace(old, new, 1))

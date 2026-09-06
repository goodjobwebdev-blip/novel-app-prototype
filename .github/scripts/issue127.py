from pathlib import Path

path = Path('src/Workspace.tsx')
text = path.read_text()

old_import = "import { navigateAfterRequiredSave } from './navigation-save-guard'"
new_import = "import { navigateAfterRequiredSave, saveRequiredBeforeNavigation } from './navigation-save-guard'"
if old_import not in text:
    raise SystemExit('navigation guard import not found')
text = text.replace(old_import, new_import, 1)

old_document = "    if (changedSinceSnapshotRef.current) await flushDocument('navigation', true)\n    const document = await getEntity<ArcEntity>(documentId)"
new_document = "    if (!await saveRequiredBeforeNavigation(changedSinceSnapshotRef.current, () => flushDocument('navigation', true))) {\n      showToast('Could not save the current document. Fix the save problem before switching documents.')\n      return\n    }\n    const document = await getEntity<ArcEntity>(documentId)"
if old_document not in text:
    raise SystemExit('loadDocument save block not found')
text = text.replace(old_document, new_document, 1)

old_book = "  async function openBook(bookId: string, preferredSceneId?: string) {\n    if (activeDocumentIdRef.current && changedSinceSnapshotRef.current) await flushDocument('navigation', true)\n    const book = await getEntity<BookEntity>(bookId)"
new_book = "  async function openBook(bookId: string, preferredSceneId?: string) {\n    if (!await saveRequiredBeforeNavigation(Boolean(activeDocumentIdRef.current && changedSinceSnapshotRef.current), () => flushDocument('navigation', true))) {\n      showToast('Could not save the current document. Fix the save problem before switching books.')\n      return\n    }\n    const book = await getEntity<BookEntity>(bookId)"
if old_book not in text:
    raise SystemExit('openBook save block not found')
text = text.replace(old_book, new_book, 1)

path.write_text(text)

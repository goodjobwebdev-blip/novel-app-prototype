from pathlib import Path


def replace(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'Missing block in {path}: {old[:140]!r}')
    p.write_text(text.replace(old, new, 1))

replace(
    'src/autotitle-service.ts',
    "  getEntity,\n  listEntitiesByBook,",
    "  getEntity,\n  isCodexEntryArchived,\n  listEntitiesByBook,",
)
replace(
    'src/autotitle-service.ts',
    """  if (!isSupported(targetEntity) || (targetEntity.type !== 'book' && targetEntity.bookId !== bookId) || (targetEntity.type === 'book' && targetEntity.id !== bookId)) {
    throw new Error('That item cannot be autotitled in this book.')
  }
""",
    """  if (!isSupported(targetEntity) || (targetEntity.type !== 'book' && targetEntity.bookId !== bookId) || (targetEntity.type === 'book' && targetEntity.id !== bookId)) {
    throw new Error('That item cannot be autotitled in this book.')
  }
  if (targetEntity.type === 'codexEntry' && isCodexEntryArchived(targetEntity)) {
    throw new Error('Restore this archived Codex entry before generating a title.')
  }
""",
)
replace(
    'src/Workspace.tsx',
    """<div className="document-title-actions"><button className="autotitle-trigger" type="button" onClick={() => { void startAutotitle(activeDocument) }} aria-label={`Autotitle ${activeDocument.title}`} title="Autotitle"><WandSparkles aria-hidden="true" /></button>{activeDocument.type === 'codexEntry' && <SummaryIcon""",
    """<div className="document-title-actions">{(activeDocument.type === 'note' || !activeCodexArchived) && <button className="autotitle-trigger" type="button" onClick={() => { void startAutotitle(activeDocument) }} aria-label={`Autotitle ${activeDocument.title}`} title="Autotitle"><WandSparkles aria-hidden="true" /></button>}{activeDocument.type === 'codexEntry' && <SummaryIcon""",
)

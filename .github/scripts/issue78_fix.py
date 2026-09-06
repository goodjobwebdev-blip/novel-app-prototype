from pathlib import Path


def replace(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'Missing block in {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1))

replace(
    'src/Workspace.tsx',
    "function OutlineRow({ entity, label, wordCount, summaryState, selected = false, expandable = false, expanded = false, first, last, onToggle, onOpenScene, onOpenSummary, onCreate, onRename, onMove, onDelete }:",
    "function OutlineRow({ entity, label, wordCount, summaryState, selected = false, expandable = false, expanded = false, first, last, onToggle, onOpenScene, onOpenSummary, onCreate, onAutotitle, onRename, onMove, onDelete }:",
)

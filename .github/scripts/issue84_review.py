from pathlib import Path
p = Path('src/Workspace.tsx')
text = p.read_text()
old = "style={{ left, top, width }}"
new = "style={{ left, top, width, maxHeight: Math.max(180, viewportHeight - top - 12) }}"
if old not in text:
    raise SystemExit('popover style marker missing')
p.write_text(text.replace(old, new, 1))

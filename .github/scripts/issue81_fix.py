from pathlib import Path

p = Path('src/Workspace.tsx')
text = p.read_text()
old = '      aria-haspopup="toolbar"\n'
new = '      aria-haspopup="menu"\n'
if old not in text:
    raise SystemExit('Generate control aria-haspopup target not found')
p.write_text(text.replace(old, new, 1))

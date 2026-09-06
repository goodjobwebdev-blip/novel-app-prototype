from pathlib import Path
p = Path('src/autotitle-service.ts')
text = p.read_text()
text = text.replace("target.content.trim() || '_Note is empty._'", "String(target.content ?? '').trim() || '_Note is empty._'")
text = text.replace("target.content.trim() || '_Codex entry is empty._'", "String(target.content ?? '').trim() || '_Codex entry is empty._'")
p.write_text(text)

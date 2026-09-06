from pathlib import Path
p = Path('src/Workspace.tsx')
text = p.read_text()
old = """<div className=\"autotitle-meta\">Model: {state.request.model}{diagnostics ? ` · ~${diagnostics.requestTokens.toLocaleString()} input tokens · ${Math.round(diagnostics.usageRatio * 100)}% of usable context` : ''}</div>"""
new = """<div className=\"autotitle-meta\">Target: {label} · {state.request.targetId}<br />Model: {state.request.model}{diagnostics ? ` · ~${diagnostics.requestTokens.toLocaleString()} input tokens · ${Math.round(diagnostics.usageRatio * 100)}% of usable context` : ''}</div>"""
if old not in text:
    raise SystemExit('Missing autotitle diagnostics metadata block')
p.write_text(text.replace(old, new, 1))

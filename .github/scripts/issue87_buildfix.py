from pathlib import Path
p = Path('src/ai-settings.ts')
text = p.read_text()
old = """    codexEffectiveContextLimit: typeof value?.codexEffectiveContextLimit === 'string' ? value.codexEffectiveContextLimit : '',
    prompts,
    favorites: Array.isArray(value?.favorites) ? [...value.favorites] : [],
"""
new = """    codexEffectiveContextLimit: typeof value?.codexEffectiveContextLimit === 'string' ? value.codexEffectiveContextLimit : '',
    favorites: Array.isArray(value?.favorites) ? [...value.favorites] : [],
"""
if old not in text:
    raise SystemExit('missing duplicate legacy prompts property')
p.write_text(text.replace(old, new, 1))

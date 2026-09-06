from pathlib import Path


def replace(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'Missing block in {path}: {old[:140]!r}')
    p.write_text(text.replace(old, new, 1))

replace(
    'src/context-service.ts',
    "type BuildOptions = { bookId: string; type: GenerationContextType; currentSceneId?: string; currentSceneText?: string; currentDocumentId?: string; profile: GenerationContextProfile }",
    "type BuildOptions = { bookId: string; type: GenerationContextType; currentSceneId?: string; currentSceneText?: string; currentDocumentId?: string; previousScenesForCodexTriggers?: number; profile: GenerationContextProfile }",
)
replace(
    'src/context-service.ts',
    "  const automaticMatches = automaticCodexMatches({\n    entities,\n    scenes,\n    anchorSceneId,\n    anchorSceneText: liveCurrentText,\n    previousSceneCount: contextSettings.previousScenesForCodexTriggers,\n    excludeEntryId: options.type === 'codex' ? options.currentDocumentId : undefined,\n  })",
    "  const automaticMatches = ['scene', 'codex', 'chat'].includes(options.type) ? automaticCodexMatches({\n    entities,\n    scenes,\n    anchorSceneId,\n    anchorSceneText: liveCurrentText,\n    previousSceneCount: options.previousScenesForCodexTriggers ?? contextSettings.previousScenesForCodexTriggers,\n    excludeEntryId: options.type === 'codex' ? options.currentDocumentId : undefined,\n  }) : []",
)
replace(
    'src/App.tsx',
    "const prepared = await buildContextValues({ bookId, type, currentSceneId, currentSceneText: type === 'scene' ? currentDocumentText : undefined, currentDocumentId, profile })",
    "const prepared = await buildContextValues({ bookId, type, currentSceneId, currentSceneText: type === 'scene' ? currentDocumentText : undefined, currentDocumentId, previousScenesForCodexTriggers: value.previousScenesForCodexTriggers, profile })",
)
replace(
    'src/App.tsx',
    "  }, [bookId, chatId, currentDocumentId, currentDocumentText, profile, sources, type, value.lastOpenedSceneId])",
    "  }, [bookId, chatId, currentDocumentId, currentDocumentText, profile, sources, type, value.lastOpenedSceneId, value.previousScenesForCodexTriggers])",
)

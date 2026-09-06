from pathlib import Path

path = Path('src/Workspace.tsx')
text = path.read_text()

anchor = "import { navigateAfterRequiredSave, saveRequiredBeforeNavigation } from './navigation-save-guard'\n"
if anchor not in text:
    raise SystemExit('navigation guard import anchor not found')
text = text.replace(anchor, anchor + "import { canUnmountEditor } from './editor-unmount-guard'\n", 1)

old = """    if (generationAbortRef.current) {\n      showToast('Stop generation before switching documents.')\n      return\n    }\n"""
new = """    if (!canUnmountEditor(Boolean(generationAbortRef.current))) {\n      showToast('Stop generation before switching documents.')\n      return\n    }\n"""
if old not in text:
    raise SystemExit('loadDocument generation guard not found')
text = text.replace(old, new, 1)

old = """  function openSettings(from: Screen) {\n    if (from === 'editor' && changedSinceSnapshotRef.current) void flushDocument('navigation', true)\n    setReturnScreen(from)\n    setScreen('settings')\n    setRightOpen(false)\n  }\n\n  async function openChat(chatId: string) {\n    const opened = await navigateAfterRequiredSave(\n"""
new = """  function openSettings(from: Screen) {\n    if (from === 'editor' && !canUnmountEditor(Boolean(generationAbortRef.current))) {\n      showToast('Stop generation before opening Settings.')\n      return\n    }\n    if (from === 'editor' && changedSinceSnapshotRef.current) void flushDocument('navigation', true)\n    setReturnScreen(from)\n    setScreen('settings')\n    setRightOpen(false)\n  }\n\n  async function openChat(chatId: string) {\n    if (screen === 'editor' && !canUnmountEditor(Boolean(generationAbortRef.current))) {\n      showToast('Stop generation before opening Chat.')\n      return\n    }\n    const opened = await navigateAfterRequiredSave(\n"""
if old not in text:
    raise SystemExit('Settings/Chat navigation block not found')
text = text.replace(old, new, 1)

path.write_text(text)

from pathlib import Path

path = Path('src/chat-tools.ts')
text = path.read_text()

anchor = "import type { ChatToolCall, ChatToolDefinition } from './chat-api'\n"
if anchor not in text:
    raise SystemExit('chat api import anchor not found')
text = text.replace(anchor, anchor + "import { isActiveCodexTitleDuplicate } from './chat-codex-duplicate'\n", 1)

old = """function normalizedTitle(title: string) {\n  return title.trim().replace(/\\s+/g, ' ').toLocaleLowerCase()\n}\n\n"""
if old not in text:
    raise SystemExit('normalizedTitle helper not found')
text = text.replace(old, '', 1)

old = ".filter((entity) => !isCodexEntryArchived(entity) && normalizedTitle(String(entity.title ?? '')) === normalizedTitle(title))"
if old not in text:
    raise SystemExit('proposal duplicate filter not found')
text = text.replace(old, ".filter((entity) => isActiveCodexTitleDuplicate(entity, title))", 1)

old = ".filter((entity) => normalizedTitle(String(entity.title ?? '')) === normalizedTitle(proposal.title))"
if old not in text:
    raise SystemExit('approval duplicate filter not found')
text = text.replace(old, ".filter((entity) => isActiveCodexTitleDuplicate(entity, proposal.title))", 1)

path.write_text(text)

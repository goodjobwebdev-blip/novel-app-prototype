from pathlib import Path

# Document-edit proposals
path = Path('src/chat-tools.ts')
text = path.read_text()
anchor = "import { isActiveCodexTitleDuplicate } from './chat-codex-duplicate'\n"
if anchor not in text:
    raise SystemExit('chat-tools import anchor not found')
text = text.replace(anchor, anchor + "import { loadProposalTargetOrMarkStale } from './chat-proposal-target'\n", 1)
old = """  const entity = await editableEntity(message.bookId, proposal.entityId)\n  if (entity.updatedAt !== proposal.expectedUpdatedAt) {\n"""
new = """  const entity = await loadProposalTargetOrMarkStale(\n    () => editableEntity(message.bookId, proposal.entityId),\n    () => setProposalStatus(message, proposal.id, 'stale'),\n  )\n  if (entity.updatedAt !== proposal.expectedUpdatedAt) {\n"""
if old not in text:
    raise SystemExit('document target lookup not found')
text = text.replace(old, new, 1)
path.write_text(text)

# Note/Codex entity-action proposals
path = Path('src/chat-entity-tools.ts')
text = path.read_text()
anchor = "import type { ChatToolCall, ChatToolDefinition } from './chat-api'\n"
if anchor not in text:
    raise SystemExit('chat-entity import anchor not found')
text = text.replace(anchor, anchor + "import { loadProposalTargetOrMarkStale } from './chat-proposal-target'\n", 1)
old = """  const entity = proposal.entityType === 'book'\n    ? await getEntity<ArcEntity>(proposal.entityId ?? '')\n    : await manageableEntity(message.bookId, proposal.entityId ?? '')\n  if (!entity || (proposal.entityType === 'book' ? entity.type !== 'book' || entity.id !== message.bookId : false)) {\n"""
new = """  const entity = proposal.entityType === 'book'\n    ? await getEntity<ArcEntity>(proposal.entityId ?? '')\n    : await loadProposalTargetOrMarkStale(\n        () => manageableEntity(message.bookId, proposal.entityId ?? ''),\n        () => setActionStatus(message, proposal.id, { status: 'stale' }),\n      )\n  if (!entity || (proposal.entityType === 'book' ? entity.type !== 'book' || entity.id !== message.bookId : false)) {\n"""
if old not in text:
    raise SystemExit('entity-action target lookup not found')
text = text.replace(old, new, 1)
path.write_text(text)

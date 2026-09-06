from pathlib import Path

path = Path('src/chat-service.ts')
text = path.read_text()
anchor = "import { transitionProposalList } from './chat-proposal-transition'\n"
if anchor not in text:
    raise SystemExit('proposal transition import anchor missing')
text = text.replace(anchor, anchor + "import { snapshotProposalListForFork } from './chat-fork-proposals'\n", 1)
text = text.replace("export type ChatCodexCreationStatus = 'proposed' | 'applying' | 'created' | 'rejected' | 'duplicate'", "export type ChatCodexCreationStatus = 'proposed' | 'applying' | 'created' | 'rejected' | 'duplicate' | 'stale'", 1)
old = """    await putEntity({\n      ...message,\n      id: makeId('chat-message'),\n      parentId: fork.id,\n      createdAt: Date.now(),\n      updatedAt: Date.now(),\n    })\n"""
new = """    await putEntity({\n      ...message,\n      id: makeId('chat-message'),\n      parentId: fork.id,\n      documentEdits: snapshotProposalListForFork(message.documentEdits),\n      codexCreations: snapshotProposalListForFork(message.codexCreations),\n      outlineActions: snapshotProposalListForFork(message.outlineActions),\n      entityActions: snapshotProposalListForFork(message.entityActions),\n      createdAt: Date.now(),\n      updatedAt: Date.now(),\n    })\n"""
if old not in text:
    raise SystemExit('fork message copy anchor missing')
text = text.replace(old, new, 1)
path.write_text(text)

path = Path('src/ChatFeature.tsx')
text = path.read_text()
old = "proposal.status === 'proposed' ? 'Ready to create' : proposal.status === 'applying' ? 'Creating…' : proposal.status === 'created' ? 'Created' : proposal.status === 'duplicate' ? 'Already exists' : 'Rejected'"
new = "proposal.status === 'proposed' ? 'Ready to create' : proposal.status === 'applying' ? 'Creating…' : proposal.status === 'created' ? 'Created' : proposal.status === 'duplicate' ? 'Already exists' : proposal.status === 'stale' ? 'Historical' : 'Rejected'"
if old not in text:
    raise SystemExit('Codex status label anchor missing')
text = text.replace(old, new, 1)
path.write_text(text)

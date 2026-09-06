from pathlib import Path

# persistence: atomic entity read-modify-write
path = Path('src/persistence.ts')
text = path.read_text()
anchor = """export async function putEntity(entity: ArcEntity) {\n  const db = await database()\n  await db.table('entities').put(entity)\n  return entity\n}\n\n"""
insert = anchor + """export async function updateEntityAtomically<T extends ArcEntity = ArcEntity>(id: string, update: (current: T) => T): Promise<T> {\n  const db = await database()\n  return db.transaction('rw', db.table('entities'), async () => {\n    const current = await db.table('entities').get(id) as T | undefined\n    if (!current) throw new Error(`Cannot update missing entity ${id}`)\n    const next = update(current)\n    await db.table('entities').put(next)\n    return next\n  })\n}\n\n"""
if anchor not in text:
    raise SystemExit('putEntity anchor not found')
text = text.replace(anchor, insert, 1)
path.write_text(text)

# chat-service: proposal status model + atomic transition API
path = Path('src/chat-service.ts')
text = path.read_text()
text = text.replace("import { getCachedModelCatalog } from './model-catalog'\n", "import { getCachedModelCatalog } from './model-catalog'\nimport { transitionProposalList } from './chat-proposal-transition'\n", 1)
text = text.replace("  putEntity,\n", "  putEntity,\n  updateEntityAtomically,\n", 1)
text = text.replace("export type ChatCodexCreationStatus = 'proposed' | 'created' | 'rejected' | 'duplicate'", "export type ChatCodexCreationStatus = 'proposed' | 'applying' | 'created' | 'rejected' | 'duplicate'")
text = text.replace("  status: 'proposed' | 'applied' | 'rejected' | 'stale'\n", "  status: 'proposed' | 'applying' | 'applied' | 'rejected' | 'stale'\n", 3)

anchor = """export async function updateChatMessage(messageId: string, patch: Partial<Pick<ChatMessageEntity, 'content' | 'thoughts' | 'status' | 'documentEdits' | 'codexCreations' | 'outlineActions' | 'entityActions'>>): Promise<ChatMessageEntity> {\n  const current = await getEntity<ArcEntity>(messageId)\n  if (!current || current.type !== 'chatMessage') throw new Error('Message is no longer available.')\n  const next = { ...current, ...patch, updatedAt: Date.now() } as ChatMessageEntity\n  await putEntity(next)\n  await touchFromMessages(next.bookId, next.parentId)\n  return next\n}\n\n"""
addition = anchor + """export type ChatProposalField = 'documentEdits' | 'codexCreations' | 'outlineActions' | 'entityActions'\ntype AnyChatProposal = ChatDocumentEditProposal | ChatCodexCreationProposal | ChatOutlineActionProposal | ChatEntityActionProposal\n\nexport async function transitionChatMessageProposal(\n  messageId: string,\n  field: ChatProposalField,\n  proposalId: string,\n  allowedStatuses: readonly string[] | null,\n  patch: Partial<AnyChatProposal>,\n): Promise<{ message: ChatMessageEntity; proposal: AnyChatProposal; changed: boolean }> {\n  let selected: AnyChatProposal | undefined\n  let changed = false\n  const next = await updateEntityAtomically<ChatMessageEntity>(messageId, (current) => {\n    if (current.type !== 'chatMessage') throw new Error('Message is no longer available.')\n    const proposals = (current[field] ?? []) as AnyChatProposal[]\n    const result = transitionProposalList(proposals, proposalId, allowedStatuses, patch)\n    selected = result.proposal\n    changed = result.changed\n    return result.changed\n      ? { ...current, [field]: result.proposals, updatedAt: Date.now() } as ChatMessageEntity\n      : current\n  })\n  if (!selected) throw new Error('That proposal is no longer available.')\n  if (changed) await touchFromMessages(next.bookId, next.parentId)\n  return { message: next, proposal: selected, changed }\n}\n\nexport async function claimChatMessageProposal(messageId: string, field: ChatProposalField, proposalId: string) {\n  const result = await transitionChatMessageProposal(messageId, field, proposalId, ['proposed'], { status: 'applying' })\n  if (!result.changed) throw new Error(`This proposal is already ${result.proposal.status}.`)\n  return result\n}\n\n"""
if anchor not in text:
    raise SystemExit('updateChatMessage anchor not found')
text = text.replace(anchor, addition, 1)
path.write_text(text)

# chat-tools: atomic claim/final transitions
path = Path('src/chat-tools.ts')
text = path.read_text()
text = text.replace("  updateChatMessage,\n", "  claimChatMessageProposal,\n  transitionChatMessageProposal,\n", 1)
start = text.index("async function messageWithProposal(")
end = text.index("export async function applyChatDocumentEdit", start)
replacement = """async function setProposalStatus(messageId: string, proposalId: string, status: ChatDocumentEditProposal['status'], appliedAt?: number) {\n  return transitionChatMessageProposal(messageId, 'documentEdits', proposalId, ['applying'], { status, ...(appliedAt ? { appliedAt } : {}) })\n}\n\n"""
text = text[:start] + replacement + text[end:]
text = text.replace("""export async function applyChatDocumentEdit(messageId: string, proposalId: string) {\n  const { message, proposal } = await messageWithProposal(messageId, proposalId)\n  if (proposal.status !== 'proposed') throw new Error(`This proposal is already ${proposal.status}.`)\n""", """export async function applyChatDocumentEdit(messageId: string, proposalId: string) {\n  const claimed = await claimChatMessageProposal(messageId, 'documentEdits', proposalId)\n  const message = claimed.message\n  const proposal = claimed.proposal as ChatDocumentEditProposal\n""", 1)
text = text.replace("() => setProposalStatus(message, proposal.id, 'stale')", "() => setProposalStatus(message.id, proposal.id, 'stale')")
text = text.replace("await setProposalStatus(message, proposal.id, 'stale')", "await setProposalStatus(message.id, proposal.id, 'stale')")
text = text.replace("await setProposalStatus(message, proposal.id, 'applied', appliedAt)", "await setProposalStatus(message.id, proposal.id, 'applied', appliedAt)")
old = """export async function rejectChatDocumentEdit(messageId: string, proposalId: string) {\n  const { message, proposal } = await messageWithProposal(messageId, proposalId)\n  if (proposal.status !== 'proposed') return\n  await setProposalStatus(message, proposal.id, 'rejected')\n}\n\n"""
new = """export async function rejectChatDocumentEdit(messageId: string, proposalId: string) {\n  await transitionChatMessageProposal(messageId, 'documentEdits', proposalId, ['proposed'], { status: 'rejected' })\n}\n\n"""
if old not in text:
    raise SystemExit('reject document block not found')
text = text.replace(old, new, 1)
start = text.index("async function messageWithCodexCreation(")
end = text.index("export async function createChatCodexEntry", start)
replacement = """async function setCodexCreationStatus(messageId: string, proposalId: string, patch: Partial<ChatCodexCreationProposal>) {\n  return transitionChatMessageProposal(messageId, 'codexCreations', proposalId, ['applying'], patch)\n}\n\n"""
text = text[:start] + replacement + text[end:]
text = text.replace("""export async function createChatCodexEntry(messageId: string, proposalId: string) {\n  const { message, proposal } = await messageWithCodexCreation(messageId, proposalId)\n  if (proposal.status !== 'proposed') throw new Error(`This Codex proposal is already ${proposal.status}.`)\n""", """export async function createChatCodexEntry(messageId: string, proposalId: string) {\n  const claimed = await claimChatMessageProposal(messageId, 'codexCreations', proposalId)\n  const message = claimed.message\n  const proposal = claimed.proposal as ChatCodexCreationProposal\n""", 1)
text = text.replace("await setCodexCreationStatus(message, proposal.id,", "await setCodexCreationStatus(message.id, proposal.id,")
old = """export async function rejectChatCodexEntry(messageId: string, proposalId: string) {\n  const { message, proposal } = await messageWithCodexCreation(messageId, proposalId)\n  if (proposal.status !== 'proposed') return\n  await setCodexCreationStatus(message.id, proposal.id, { status: 'rejected' })\n}\n"""
new = """export async function rejectChatCodexEntry(messageId: string, proposalId: string) {\n  await transitionChatMessageProposal(messageId, 'codexCreations', proposalId, ['proposed'], { status: 'rejected' })\n}\n"""
if old not in text:
    raise SystemExit('reject codex block not found')
text = text.replace(old, new, 1)
path.write_text(text)

# entity tools
path = Path('src/chat-entity-tools.ts')
text = path.read_text()
text = text.replace("  updateChatMessage,\n", "  claimChatMessageProposal,\n  transitionChatMessageProposal,\n", 1)
start = text.index("async function messageWithAction(")
end = text.index("export async function applyChatEntityAction", start)
replacement = """async function setActionStatus(messageId: string, proposalId: string, patch: Partial<ChatEntityActionProposal>) {\n  return transitionChatMessageProposal(messageId, 'entityActions', proposalId, ['applying'], patch)\n}\n\n"""
text = text[:start] + replacement + text[end:]
text = text.replace("""export async function applyChatEntityAction(messageId: string, proposalId: string) {\n  const { message, proposal } = await messageWithAction(messageId, proposalId)\n  if (proposal.status !== 'proposed') throw new Error(`This proposal is already ${proposal.status}.`)\n""", """export async function applyChatEntityAction(messageId: string, proposalId: string) {\n  const claimed = await claimChatMessageProposal(messageId, 'entityActions', proposalId)\n  const message = claimed.message\n  const proposal = claimed.proposal as ChatEntityActionProposal\n""", 1)
text = text.replace("await setActionStatus(message, proposal.id,", "await setActionStatus(message.id, proposal.id,")
text = text.replace("() => setActionStatus(message, proposal.id,", "() => setActionStatus(message.id, proposal.id,")
old = """export async function rejectChatEntityAction(messageId: string, proposalId: string) {\n  const { message, proposal } = await messageWithAction(messageId, proposalId)\n  if (proposal.status !== 'proposed') return\n  await setActionStatus(message.id, proposal.id, { status: 'rejected' })\n}\n"""
new = """export async function rejectChatEntityAction(messageId: string, proposalId: string) {\n  await transitionChatMessageProposal(messageId, 'entityActions', proposalId, ['proposed'], { status: 'rejected' })\n}\n"""
if old not in text:
    raise SystemExit('reject entity block not found')
text = text.replace(old, new, 1)
path.write_text(text)

# outline tools
path = Path('src/chat-outline-tools.ts')
text = path.read_text()
text = text.replace("  updateChatMessage,\n", "  claimChatMessageProposal,\n  transitionChatMessageProposal,\n", 1)
start = text.index("async function messageWithOutlineAction(")
end = text.index("export async function applyChatOutlineAction", start)
replacement = """async function setOutlineActionStatus(messageId: string, proposalId: string, patch: Partial<ChatOutlineActionProposal>) {\n  return transitionChatMessageProposal(messageId, 'outlineActions', proposalId, ['applying'], patch)\n}\n\n"""
text = text[:start] + replacement + text[end:]
text = text.replace("""export async function applyChatOutlineAction(messageId: string, proposalId: string) {\n  const { message, proposal } = await messageWithOutlineAction(messageId, proposalId)\n  if (proposal.status !== 'proposed') throw new Error(`This outline proposal is already ${proposal.status}.`)\n\n  try {\n""", """export async function applyChatOutlineAction(messageId: string, proposalId: string) {\n  const claimed = await claimChatMessageProposal(messageId, 'outlineActions', proposalId)\n  const message = claimed.message\n  const proposal = claimed.proposal as ChatOutlineActionProposal\n\n  try {\n""", 1)
text = text.replace("await setOutlineActionStatus(message, proposal.id,", "await setOutlineActionStatus(message.id, proposal.id,")
text = text.replace("if (proposal.status === 'proposed' && proposal.action !== 'create') {", "if (proposal.status === 'applying') {")
old = """export async function rejectChatOutlineAction(messageId: string, proposalId: string) {\n  const { message, proposal } = await messageWithOutlineAction(messageId, proposalId)\n  if (proposal.status !== 'proposed') return\n  await setOutlineActionStatus(message.id, proposal.id, { status: 'rejected' })\n}\n"""
new = """export async function rejectChatOutlineAction(messageId: string, proposalId: string) {\n  await transitionChatMessageProposal(messageId, 'outlineActions', proposalId, ['proposed'], { status: 'rejected' })\n}\n"""
if old not in text:
    raise SystemExit('reject outline block not found')
text = text.replace(old, new, 1)
path.write_text(text)

# Chat UI: make persisted applying state clear and non-actionable
path = Path('src/ChatFeature.tsx')
text = path.read_text()
text = text.replace("proposal.status === 'proposed' ? 'Needs approval' : proposal.status === 'applied' ? 'Applied'", "proposal.status === 'proposed' ? 'Needs approval' : proposal.status === 'applying' ? 'Applying…' : proposal.status === 'applied' ? 'Applied'", 2)
text = text.replace("proposal.status === 'proposed' ? 'Ready to create' : proposal.status === 'created' ? 'Created'", "proposal.status === 'proposed' ? 'Ready to create' : proposal.status === 'applying' ? 'Creating…' : proposal.status === 'created' ? 'Created'", 1)
text = text.replace("proposal.status === 'proposed' ? 'Ready to apply' : proposal.status === 'applied' ? 'Applied'", "proposal.status === 'proposed' ? 'Ready to apply' : proposal.status === 'applying' ? 'Applying…' : proposal.status === 'applied' ? 'Applied'", 1)
path.write_text(text)

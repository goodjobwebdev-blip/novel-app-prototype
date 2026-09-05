import fs from 'node:fs'

function read(path) { return fs.readFileSync(path, 'utf8') }
function write(path, value) { fs.writeFileSync(path, value) }
function replaceOnce(path, from, to) {
  const source = read(path)
  if (!source.includes(from)) throw new Error(`${path}: anchor not found: ${from.slice(0, 180)}`)
  write(path, source.replace(from, to))
}

// Persist approved outline mutation proposals on assistant messages.
replaceOnce('src/chat-service.ts',
`export type ChatTextReplacement = { oldText: string; newText: string }`,
`export type ChatOutlineActionProposal = {\n  id: string\n  action: 'create' | 'rename' | 'move' | 'delete'\n  entityId?: string\n  entityType: 'act' | 'chapter' | 'scene'\n  entityTitle: string\n  newTitle?: string\n  expectedUpdatedAt?: number\n  sourceParentId?: string\n  sourceOrder?: number\n  targetParentId?: string\n  targetParentTitle?: string\n  beforeId?: string\n  beforeTitle?: string\n  summary?: string\n  status: 'proposed' | 'applied' | 'rejected' | 'stale'\n  createdAt: number\n  appliedAt?: number\n}\nexport type ChatTextReplacement = { oldText: string; newText: string }`)

replaceOnce('src/chat-service.ts',
`  codexCreations?: ChatCodexCreationProposal[]\n}`,
`  codexCreations?: ChatCodexCreationProposal[]\n  outlineActions?: ChatOutlineActionProposal[]\n}`)

replaceOnce('src/chat-service.ts',
`export async function createChatMessage(chat: ChatEntity, role: ChatMessageEntity['role'], content: string, extra: Pick<ChatMessageEntity, 'thoughts' | 'status' | 'documentEdits' | 'codexCreations'> = {}): Promise<ChatMessageEntity> {`,
`export async function createChatMessage(chat: ChatEntity, role: ChatMessageEntity['role'], content: string, extra: Pick<ChatMessageEntity, 'thoughts' | 'status' | 'documentEdits' | 'codexCreations' | 'outlineActions'> = {}): Promise<ChatMessageEntity> {`)

replaceOnce('src/chat-service.ts',
`    codexCreations: extra.codexCreations?.map((proposal) => ({ ...proposal })),\n    createdAt: now,`,
`    codexCreations: extra.codexCreations?.map((proposal) => ({ ...proposal })),\n    outlineActions: extra.outlineActions?.map((proposal) => ({ ...proposal })),\n    createdAt: now,`)

replaceOnce('src/chat-service.ts',
`export async function updateChatMessage(messageId: string, patch: Partial<Pick<ChatMessageEntity, 'content' | 'thoughts' | 'status' | 'documentEdits' | 'codexCreations'>>): Promise<ChatMessageEntity> {`,
`export async function updateChatMessage(messageId: string, patch: Partial<Pick<ChatMessageEntity, 'content' | 'thoughts' | 'status' | 'documentEdits' | 'codexCreations' | 'outlineActions'>>): Promise<ChatMessageEntity> {`)

// Add a general structural placement primitive used by approved Chat moves.
replaceOnce('src/persistence.ts',
`export async function deleteEntityTree(id: string): Promise<string[]> {`,
`export async function placeStructuralEntity(id: string, targetParentId: string, beforeId?: string): Promise<StructuralEntity> {\n  const db = await database()\n  return db.transaction('rw', db.table('entities'), async () => {\n    const entity = await db.table('entities').get(id) as StructuralEntity | undefined\n    const parent = await db.table('entities').get(targetParentId) as ArcEntity | undefined\n    if (!entity || !['act', 'chapter', 'scene'].includes(entity.type)) throw new Error(\`Cannot move missing structural entity ${'${id}'}\`)\n    const validParent = entity.type === 'act'\n      ? parent?.type === 'book' && parent.id === entity.bookId\n      : entity.type === 'chapter'\n        ? (parent?.type === 'book' && parent.id === entity.bookId) || (parent?.type === 'act' && parent.bookId === entity.bookId)\n        : parent?.type === 'chapter' && parent.bookId === entity.bookId\n    if (!validParent) throw new Error(\`Cannot move ${'${entity.type}'} under ${'${parent?.type ?? \'missing parent\'}'}\`)\n\n    const sourceParentId = entity.parentId\n    const sourceSiblings = (await db.table('entities').where('parentId').equals(sourceParentId).toArray() as ArcEntity[])\n      .filter((candidate): candidate is StructuralEntity => candidate.type === entity.type && candidate.id !== entity.id)\n      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))\n    const targetSiblings = sourceParentId === targetParentId\n      ? sourceSiblings\n      : (await db.table('entities').where('parentId').equals(targetParentId).toArray() as ArcEntity[])\n          .filter((candidate): candidate is StructuralEntity => candidate.type === entity.type && candidate.id !== entity.id)\n          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))\n\n    let targetIndex = targetSiblings.length\n    if (beforeId) {\n      targetIndex = targetSiblings.findIndex((candidate) => candidate.id === beforeId)\n      if (targetIndex < 0) throw new Error('The requested before_id is no longer a sibling in the target parent.')\n    }\n    const destination = [...targetSiblings]\n    destination.splice(targetIndex, 0, { ...entity, parentId: targetParentId })\n    const now = Date.now()\n    const updates: StructuralEntity[] = destination.map((candidate, index) => ({ ...candidate, parentId: targetParentId, order: index, updatedAt: now }))\n    if (sourceParentId !== targetParentId) {\n      updates.push(...sourceSiblings.map((candidate, index) => ({ ...candidate, order: index, updatedAt: now })))\n    }\n    await db.table('entities').bulkPut(updates)\n    await touchAncestors(db, sourceParentId, now)\n    if (targetParentId !== sourceParentId) await touchAncestors(db, targetParentId, now)\n    return updates.find((candidate) => candidate.id === entity.id)!\n  })\n}\n\nexport async function deleteEntityTree(id: string): Promise<string[]> {`)

// Wire outline tools into Chat's tool loop, history, and approval cards.
replaceOnce('src/ChatFeature.tsx',
`  type ChatMessageEntity,\n  type ChatModel,`,
`  type ChatMessageEntity,\n  type ChatModel,\n  type ChatOutlineActionProposal,`)

replaceOnce('src/ChatFeature.tsx',
`import { applyChatDocumentEdit, chatWorkspaceTools, createChatCodexEntry, executeChatWorkspaceTool, rejectChatCodexEntry, rejectChatDocumentEdit } from './chat-tools'`,
`import { applyChatDocumentEdit, chatWorkspaceTools, createChatCodexEntry, executeChatWorkspaceTool, rejectChatCodexEntry, rejectChatDocumentEdit } from './chat-tools'\nimport { applyChatOutlineAction, chatOutlineToolNames, chatOutlineTools, executeChatOutlineTool, rejectChatOutlineAction } from './chat-outline-tools'`)

replaceOnce('src/ChatFeature.tsx',
`const workspaceInstructions = \`# Workspace tools\n\nYou can inspect and propose edits to Scenes, Notes, and Codex entries in this book. You can also propose creating a new Codex/lore entry with propose_codex_entry. Search existing entries first when the requested lore may already exist. Use search_entities and read_entity when the target document is not already known. For localized changes, prefer propose_document_edit with exact old_text copied from read_entity. Use propose_document_replacement only when the user asks for a whole-document rewrite. Tool edit and creation calls create proposals only: never claim a document has already changed or been created. The user must press Apply or Create in the chat first.\``,
`const workspaceInstructions = \`# Workspace tools\n\nYou can inspect and propose edits to Scenes, Notes, and Codex entries in this book. You can also propose creating a new Codex/lore entry. For the outline, use read_outline before structural changes; you may propose creating, renaming, moving/reordering, or deleting Acts, Chapters, and Scenes. Mutating tools only create approval proposals: never claim an edit, creation, rename, move, reorder, or deletion happened until the user approves the card in Chat. Outline deletion is allowed only when the target and every descendant Scene have empty content. Search/read tools are read-only and can run automatically. Use search_entities and read_entity when a document target is not already known. For localized document changes, prefer propose_document_edit with exact old_text copied from read_entity. Use propose_document_replacement only for whole-document rewrites.\``)

replaceOnce('src/ChatFeature.tsx',
`        const creationState = message.role === 'assistant' && message.codexCreations?.length\n          ? \`\\n\\n[Codex creation proposals: ${'${message.codexCreations.map((proposal) => `${proposal.title}: ${proposal.status}`).join(\'; \')}'}]\`\n          : ''\n        return {\n          role: message.role,\n          content: \`${'${message.content}${editState}${creationState}'}\`,`,
`        const creationState = message.role === 'assistant' && message.codexCreations?.length\n          ? \`\\n\\n[Codex creation proposals: ${'${message.codexCreations.map((proposal) => `${proposal.title}: ${proposal.status}`).join(\'; \')}'}]\`\n          : ''\n        const outlineState = message.role === 'assistant' && message.outlineActions?.length\n          ? \`\\n\\n[Outline proposals: ${'${message.outlineActions.map((proposal) => `${proposal.action} ${proposal.entityTitle}: ${proposal.status}`).join(\'; \')}'}]\`\n          : ''\n        return {\n          role: message.role,\n          content: \`${'${message.content}${editState}${creationState}${outlineState}'}\`,`)

replaceOnce('src/ChatFeature.tsx',
`    const proposals: ChatDocumentEditProposal[] = []\n    const codexCreations: ChatCodexCreationProposal[] = []`,
`    const proposals: ChatDocumentEditProposal[] = []\n    const codexCreations: ChatCodexCreationProposal[] = []\n    const outlineActions: ChatOutlineActionProposal[] = []`)

replaceOnce('src/ChatFeature.tsx',
`          tools: chatWorkspaceTools,`,
`          tools: [...chatWorkspaceTools, ...chatOutlineTools],`)

replaceOnce('src/ChatFeature.tsx',
`          for (const call of result.toolCalls) {\n            const execution = await executeChatWorkspaceTool(bookId, call)\n            if (execution.proposal) proposals.push(execution.proposal)\n            if (execution.codexCreation) codexCreations.push(execution.codexCreation)\n            workingMessages.push({ role: 'tool', tool_call_id: call.id, content: execution.content })\n          }`,
`          for (const call of result.toolCalls) {\n            if (chatOutlineToolNames.has(call.function.name)) {\n              const execution = await executeChatOutlineTool(bookId, call)\n              if (execution.outlineAction) outlineActions.push(execution.outlineAction)\n              workingMessages.push({ role: 'tool', tool_call_id: call.id, content: execution.content })\n            } else {\n              const execution = await executeChatWorkspaceTool(bookId, call)\n              if (execution.proposal) proposals.push(execution.proposal)\n              if (execution.codexCreation) codexCreations.push(execution.codexCreation)\n              workingMessages.push({ role: 'tool', tool_call_id: call.id, content: execution.content })\n            }\n          }`)

replaceOnce('src/ChatFeature.tsx',
`      if ((content || thoughts || proposals.length || codexCreations.length) && (completed || stopped)) {`,
`      if ((content || thoughts || proposals.length || codexCreations.length || outlineActions.length) && (completed || stopped)) {`)

replaceOnce('src/ChatFeature.tsx',
`          codexCreations: codexCreations.length ? codexCreations : undefined,\n        })`,
`          codexCreations: codexCreations.length ? codexCreations : undefined,\n          outlineActions: outlineActions.length ? outlineActions : undefined,\n        })`)

replaceOnce('src/ChatFeature.tsx',
`  function readAloud(message: ChatMessageEntity) {`,
`  async function applyOutlineProposal(message: ChatMessageEntity, proposal: ChatOutlineActionProposal) {\n    try {\n      await applyChatOutlineAction(message.id, proposal.id)\n      await reloadMessages()\n      onToast(\`Approved ${'${proposal.action}'} for “${'${proposal.entityTitle}'}”.\`)\n    } catch (error) {\n      await reloadMessages().catch(() => undefined)\n      onToast(error instanceof Error ? error.message : 'Could not apply the outline proposal.')\n    }\n  }\n\n  async function rejectOutlineProposal(message: ChatMessageEntity, proposal: ChatOutlineActionProposal) {\n    try {\n      await rejectChatOutlineAction(message.id, proposal.id)\n      await reloadMessages()\n    } catch (error) {\n      onToast(error instanceof Error ? error.message : 'Could not reject the outline proposal.')\n    }\n  }\n\n  function readAloud(message: ChatMessageEntity) {`)

replaceOnce('src/ChatFeature.tsx',
`              <div className="bubble chat-markdown-bubble">{message.content ? <MarkdownMessage content={message.content} /> : (message.documentEdits?.length || message.codexCreations?.length ? <em>Workspace proposal</em> : <em>No final answer returned.</em>)}</div>`,
`              <div className="bubble chat-markdown-bubble">{message.content ? <MarkdownMessage content={message.content} /> : (message.documentEdits?.length || message.codexCreations?.length || message.outlineActions?.length ? <em>Workspace proposal</em> : <em>No final answer returned.</em>)}</div>`)

replaceOnce('src/ChatFeature.tsx',
`              {message.codexCreations?.length ? <div className="chat-document-edits">{message.codexCreations.map((proposal) => <CodexCreationCard key={proposal.id} proposal={proposal} onCreate={() => { void createCodexProposal(message, proposal) }} onReject={() => { void rejectCodexProposal(message, proposal) }} />)}</div> : null}\n              {message.status === 'stopped'`,
`              {message.codexCreations?.length ? <div className="chat-document-edits">{message.codexCreations.map((proposal) => <CodexCreationCard key={proposal.id} proposal={proposal} onCreate={() => { void createCodexProposal(message, proposal) }} onReject={() => { void rejectCodexProposal(message, proposal) }} />)}</div> : null}\n              {message.outlineActions?.length ? <div className="chat-document-edits">{message.outlineActions.map((proposal) => <OutlineActionCard key={proposal.id} proposal={proposal} onApply={() => { void applyOutlineProposal(message, proposal) }} onReject={() => { void rejectOutlineProposal(message, proposal) }} />)}</div> : null}\n              {message.status === 'stopped'`)

replaceOnce('src/ChatFeature.tsx',
`function CodexCreationCard({ proposal, onCreate, onReject }: { proposal: ChatCodexCreationProposal; onCreate: () => void; onReject: () => void }) {`,
`function OutlineActionCard({ proposal, onApply, onReject }: { proposal: ChatOutlineActionProposal; onApply: () => void; onReject: () => void }) {\n  const actionLabel = proposal.action === 'create' ? 'Create' : proposal.action === 'rename' ? 'Rename' : proposal.action === 'move' ? 'Move' : 'Delete'\n  const statusLabel = proposal.status === 'proposed' ? 'Needs approval' : proposal.status === 'applied' ? 'Applied' : proposal.status === 'stale' ? 'Outline changed' : 'Rejected'\n  const typeLabel = proposal.entityType[0].toUpperCase() + proposal.entityType.slice(1)\n  return <section className={\`chat-document-edit chat-outline-action ${'${proposal.action}'} ${'${proposal.status}'}\`}>\n    <header><div><small>{actionLabel} {typeLabel}</small><strong>{proposal.entityTitle}</strong></div><span>{statusLabel}</span></header>\n    {proposal.summary && <p>{proposal.summary}</p>}\n    <div className="chat-outline-action-body">\n      {proposal.action === 'create' && <p>Create under <strong>{proposal.targetParentTitle || 'target parent'}</strong>.</p>}\n      {proposal.action === 'rename' && <p><span>{proposal.entityTitle}</span><b>→</b><strong>{proposal.newTitle}</strong></p>}\n      {proposal.action === 'move' && <p>Move to <strong>{proposal.targetParentTitle || 'target parent'}</strong>{proposal.beforeTitle ? <> before <strong>{proposal.beforeTitle}</strong></> : <> at the end</>}.</p>}\n      {proposal.action === 'delete' && <p>Delete this item and its empty descendants. Non-empty Scene content blocks deletion.</p>}\n    </div>\n    {proposal.status === 'proposed' && <footer><button type="button" onClick={onReject}>Reject</button><button className={proposal.action === 'delete' ? 'danger' : 'primary'} type="button" onClick={onApply}>{actionLabel}</button></footer>}\n  </section>\n}\n\nfunction CodexCreationCard({ proposal, onCreate, onReject }: { proposal: ChatCodexCreationProposal; onCreate: () => void; onReject: () => void }) {`)

// Refresh outline after mutations and recover if an approved deletion removes the active Scene.
replaceOnce('src/Workspace.tsx',
`      const detail = (event as CustomEvent<{ bookId?: string; entityId?: string }>).detail\n      if (!detail?.bookId || !detail.entityId || detail.bookId !== currentBook?.id) return\n      void (async () => {\n        await reloadBookContent(detail.bookId!)\n        if (activeDocumentIdRef.current !== detail.entityId) return`,
`      const detail = (event as CustomEvent<{ bookId?: string; entityId?: string; deletedIds?: string[] }>).detail\n      if (!detail?.bookId || !detail.entityId || detail.bookId !== currentBook?.id) return\n      void (async () => {\n        const structural = await reloadBookContent(detail.bookId!)\n        if (activeDocumentIdRef.current && detail.deletedIds?.includes(activeDocumentIdRef.current)) {\n          const fallback = structural.find((entity) => entity.type === 'scene')\n          if (fallback) {\n            await loadDocument(fallback.id, false)\n          } else {\n            activeDocumentIdRef.current = null\n            activeSceneIdRef.current = null\n            setActiveSceneId(null)\n            setActiveDocument(null)\n            storyRef.current = ''\n            changedSinceSnapshotRef.current = false\n            setStoryMarkdown('')\n            setEditorRevision((revision) => revision + 1)\n            setSaveState('saved')\n          }\n          return\n        }\n        if (activeDocumentIdRef.current !== detail.entityId) return`)

const css = `\n\n.chat-outline-action-body { padding: .7rem .8rem; color: var(--soft); font-size: .82rem; line-height: 1.45; }\n.chat-outline-action-body p { margin: 0; }\n.chat-outline-action-body p > span,.chat-outline-action-body p > strong,.chat-outline-action-body p > b { margin-right: .35rem; }\n.chat-document-edit > footer button.danger { border-color: rgba(225,142,135,.35); background: rgba(225,142,135,.12); color: var(--danger); }\n.chat-document-edit.delete > header > span { color: var(--danger); }\n`
write('src/chat.css', read('src/chat.css') + css)

console.log('Chat outline tools integration applied.')

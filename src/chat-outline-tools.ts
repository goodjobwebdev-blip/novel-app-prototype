import type { ChatToolCall, ChatToolDefinition } from './chat-api'
import {
  claimChatMessageProposal,
  transitionChatMessageProposal,
  type ChatMessageEntity,
  type ChatOutlineActionProposal,
} from './chat-service'
import {
  createStructuralEntity,
  deleteEntityTree,
  getEntity,
  listEntitiesByBook,
  placeStructuralEntity,
  renameEntity,
  saveDocumentContent,
  type ArcEntity,
  type StructuralEntity,
  type StructuralEntityType,
} from './persistence'

const structuralTypes = ['act', 'chapter', 'scene'] as const
const structuralTypeSet = new Set<string>(structuralTypes)

export const chatOutlineToolNames = new Set([
  'read_outline',
  'propose_outline_create',
  'propose_outline_rename',
  'propose_outline_move',
  'propose_outline_delete',
])

export const chatOutlineTools: ChatToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'read_outline',
      description: 'Read Acts, Chapters, and Scenes in the current book with their IDs, parents, order, and whether each Scene is empty. Use this before proposing outline mutations.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_outline_create',
      description: 'Propose creating an Act, Chapter, or Scene. A Scene may include initial Markdown content. This does not create anything until the user approves the proposal in Chat.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: structuralTypes },
          parent_id: { type: 'string', description: 'Book ID for an Act; Book or Act ID for a Chapter; Chapter ID for a Scene.' },
          title: { type: 'string' },
          content: { type: 'string', description: 'Optional initial Markdown body. Supported only when type is scene.' },
          summary: { type: 'string', description: 'Short explanation of why this outline item should be created.' },
        },
        required: ['type', 'parent_id', 'title'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_outline_rename',
      description: 'Propose renaming an existing Act, Chapter, or Scene. This does not rename anything until the user approves the proposal in Chat.',
      parameters: {
        type: 'object',
        properties: {
          entity_id: { type: 'string' },
          new_title: { type: 'string' },
          summary: { type: 'string' },
        },
        required: ['entity_id', 'new_title'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_outline_move',
      description: 'Propose moving/reordering an Act, Chapter, or Scene. target_parent_id may also move a Chapter to another Act/book or a Scene to another Chapter. before_id is an optional sibling of the same type; omit it to place the item last. This does not move anything until the user approves it.',
      parameters: {
        type: 'object',
        properties: {
          entity_id: { type: 'string' },
          target_parent_id: { type: 'string' },
          before_id: { type: 'string', description: 'Optional same-type sibling in the target parent to place this item before.' },
          summary: { type: 'string' },
        },
        required: ['entity_id', 'target_parent_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_outline_delete',
      description: 'Propose deleting an Act, Chapter, or Scene. Deletion is allowed only when the target and every descendant Scene have empty content. This does not delete anything until the user approves it.',
      parameters: {
        type: 'object',
        properties: {
          entity_id: { type: 'string' },
          summary: { type: 'string' },
        },
        required: ['entity_id'],
        additionalProperties: false,
      },
    },
  },
]

function result(value: unknown) {
  return JSON.stringify(value)
}

function makeProposalId() {
  return `chat-outline-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function parseArguments(call: ChatToolCall): Record<string, unknown> {
  try {
    const value = JSON.parse(call.function.arguments || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    throw new Error(`Invalid JSON arguments for ${call.function.name}.`)
  }
}

function cleanTitle(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

function entityTitle(entity: ArcEntity | undefined) {
  return String(entity?.title ?? 'Untitled')
}

async function structuralEntity(bookId: string, entityId: string): Promise<StructuralEntity> {
  const entity = await getEntity<ArcEntity>(entityId)
  if (!entity || entity.bookId !== bookId || !structuralTypeSet.has(entity.type)) {
    throw new Error('That outline item was not found in the current book.')
  }
  return entity as StructuralEntity
}

async function outlineParent(bookId: string, type: StructuralEntityType, parentId: string) {
  const parent = await getEntity<ArcEntity>(parentId)
  const valid = type === 'act'
    ? parent?.type === 'book' && parent.id === bookId
    : type === 'chapter'
      ? (parent?.type === 'book' && parent.id === bookId) || (parent?.type === 'act' && parent.bookId === bookId)
      : parent?.type === 'chapter' && parent.bookId === bookId
  if (!valid) throw new Error(`That is not a valid parent for a ${type}.`)
  return parent!
}

async function nonEmptyScenesInSubtree(bookId: string, rootId: string) {
  const structural = (await listEntitiesByBook(bookId))
    .filter((entity): entity is StructuralEntity => structuralTypeSet.has(entity.type))
  const children = new Map<string, StructuralEntity[]>()
  for (const entity of structural) {
    if (!entity.parentId) continue
    const list = children.get(entity.parentId) ?? []
    list.push(entity)
    children.set(entity.parentId, list)
  }
  const ids = new Set<string>()
  const visit = (id: string) => {
    if (ids.has(id)) return
    ids.add(id)
    for (const child of children.get(id) ?? []) visit(child.id)
  }
  visit(rootId)
  return structural.filter((entity) => ids.has(entity.id) && entity.type === 'scene' && String(entity.content ?? '').trim())
}

async function validateBefore(bookId: string, entity: StructuralEntity, targetParentId: string, beforeId?: string) {
  if (!beforeId) return undefined
  if (beforeId === entity.id) throw new Error('An outline item cannot be placed before itself.')
  const before = await structuralEntity(bookId, beforeId)
  if (before.type !== entity.type || before.parentId !== targetParentId) {
    throw new Error('before_id must be a same-type sibling in the target parent.')
  }
  return before
}

export async function executeChatOutlineTool(bookId: string, call: ChatToolCall): Promise<{ content: string; outlineAction?: ChatOutlineActionProposal }> {
  try {
    const args = parseArguments(call)

    if (call.function.name === 'read_outline') {
      const entities = (await listEntitiesByBook(bookId))
        .filter((entity): entity is StructuralEntity => structuralTypeSet.has(entity.type))
        .sort((a, b) => `${a.parentId}:${a.type}:${String(a.order ?? 0).padStart(8, '0')}`.localeCompare(`${b.parentId}:${b.type}:${String(b.order ?? 0).padStart(8, '0')}`))
      return { content: result({
        ok: true,
        bookId,
        items: entities.map((entity) => ({
          id: entity.id,
          type: entity.type,
          title: entityTitle(entity),
          parentId: entity.parentId,
          order: entity.order ?? 0,
          updatedAt: entity.updatedAt,
          contentEmpty: entity.type === 'scene' ? !String(entity.content ?? '').trim() : undefined,
        })),
      }) }
    }

    if (call.function.name === 'propose_outline_create') {
      const type = typeof args.type === 'string' && structuralTypeSet.has(args.type) ? args.type as StructuralEntityType : null
      if (!type) return { content: result({ ok: false, error: 'type must be act, chapter, or scene.' }) }
      const parentId = typeof args.parent_id === 'string' ? args.parent_id : ''
      const title = cleanTitle(args.title)
      if (!title) return { content: result({ ok: false, error: 'The new outline item needs a title.' }) }
      const initialContent = typeof args.content === 'string' ? args.content : ''
      if (type !== 'scene' && initialContent.trim()) return { content: result({ ok: false, error: 'Initial content is supported only for Scene creation.' }) }
      const parent = await outlineParent(bookId, type, parentId)
      const proposal: ChatOutlineActionProposal = {
        id: makeProposalId(),
        action: 'create',
        entityType: type,
        entityTitle: title,
        targetParentId: parent.id,
        targetParentTitle: entityTitle(parent),
        newTitle: title,
        initialContent: type === 'scene' ? initialContent : undefined,
        summary: cleanTitle(args.summary),
        status: 'proposed',
        createdAt: Date.now(),
      }
      return { content: result({ ok: true, proposalId: proposal.id, message: 'Outline creation proposal created. The user must approve it before anything is created.' }), outlineAction: proposal }
    }

    if (call.function.name === 'propose_outline_rename') {
      const entityId = typeof args.entity_id === 'string' ? args.entity_id : ''
      const entity = await structuralEntity(bookId, entityId)
      const newTitle = cleanTitle(args.new_title)
      if (!newTitle) return { content: result({ ok: false, error: 'The new title cannot be empty.' }) }
      const proposal: ChatOutlineActionProposal = {
        id: makeProposalId(),
        action: 'rename',
        entityId: entity.id,
        entityType: entity.type,
        entityTitle: entityTitle(entity),
        newTitle,
        expectedUpdatedAt: entity.updatedAt,
        summary: cleanTitle(args.summary),
        status: 'proposed',
        createdAt: Date.now(),
      }
      return { content: result({ ok: true, proposalId: proposal.id, message: 'Outline rename proposal created. The user must approve it before anything is renamed.' }), outlineAction: proposal }
    }

    if (call.function.name === 'propose_outline_move') {
      const entityId = typeof args.entity_id === 'string' ? args.entity_id : ''
      const entity = await structuralEntity(bookId, entityId)
      const targetParentId = typeof args.target_parent_id === 'string' ? args.target_parent_id : ''
      const parent = await outlineParent(bookId, entity.type, targetParentId)
      const beforeId = typeof args.before_id === 'string' && args.before_id ? args.before_id : undefined
      const before = await validateBefore(bookId, entity, targetParentId, beforeId)
      const proposal: ChatOutlineActionProposal = {
        id: makeProposalId(),
        action: 'move',
        entityId: entity.id,
        entityType: entity.type,
        entityTitle: entityTitle(entity),
        expectedUpdatedAt: entity.updatedAt,
        sourceParentId: entity.parentId,
        sourceOrder: entity.order ?? 0,
        targetParentId: parent.id,
        targetParentTitle: entityTitle(parent),
        beforeId: before?.id,
        beforeTitle: before ? entityTitle(before) : undefined,
        summary: cleanTitle(args.summary),
        status: 'proposed',
        createdAt: Date.now(),
      }
      return { content: result({ ok: true, proposalId: proposal.id, message: 'Outline move proposal created. The user must approve it before the outline is reordered.' }), outlineAction: proposal }
    }

    if (call.function.name === 'propose_outline_delete') {
      const entityId = typeof args.entity_id === 'string' ? args.entity_id : ''
      const entity = await structuralEntity(bookId, entityId)
      const blockers = await nonEmptyScenesInSubtree(bookId, entity.id)
      if (blockers.length) {
        return { content: result({ ok: false, error: 'This outline item cannot be deleted because it contains non-empty Scene content.', nonEmptyScenes: blockers.map((scene) => ({ id: scene.id, title: entityTitle(scene) })) }) }
      }
      const proposal: ChatOutlineActionProposal = {
        id: makeProposalId(),
        action: 'delete',
        entityId: entity.id,
        entityType: entity.type,
        entityTitle: entityTitle(entity),
        expectedUpdatedAt: entity.updatedAt,
        summary: cleanTitle(args.summary),
        status: 'proposed',
        createdAt: Date.now(),
      }
      return { content: result({ ok: true, proposalId: proposal.id, message: 'Outline deletion proposal created. The user must approve it before anything is deleted.' }), outlineAction: proposal }
    }

    return { content: result({ ok: false, error: `Unknown outline tool: ${call.function.name}` }) }
  } catch (error) {
    return { content: result({ ok: false, error: error instanceof Error ? error.message : 'Outline tool execution failed.' }) }
  }
}

async function setOutlineActionStatus(messageId: string, proposalId: string, patch: Partial<ChatOutlineActionProposal>) {
  return transitionChatMessageProposal(messageId, 'outlineActions', proposalId, ['applying'], patch)
}

export async function applyChatOutlineAction(messageId: string, proposalId: string) {
  const claimed = await claimChatMessageProposal(messageId, 'outlineActions', proposalId)
  const message = claimed.message
  const proposal = claimed.proposal as ChatOutlineActionProposal

  try {
    if (proposal.action === 'create') {
      const parentId = proposal.targetParentId ?? ''
      await outlineParent(message.bookId, proposal.entityType, parentId)
      const created = await createStructuralEntity(proposal.entityType, message.bookId, parentId, proposal.newTitle || proposal.entityTitle)
      if (proposal.entityType === 'scene' && proposal.initialContent) await saveDocumentContent(created.id, proposal.initialContent)
      const appliedAt = Date.now()
      await setOutlineActionStatus(message.id, proposal.id, { status: 'applied', appliedAt, entityId: created.id })
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('arc-entity-changed', { detail: { bookId: message.bookId, entityId: created.id } }))
      return { entityId: created.id, appliedAt }
    }

    const entity = await structuralEntity(message.bookId, proposal.entityId ?? '')
    if (proposal.expectedUpdatedAt !== undefined && entity.updatedAt !== proposal.expectedUpdatedAt) {
      await setOutlineActionStatus(message.id, proposal.id, { status: 'stale' })
      throw new Error('The outline item changed after this proposal was created. Ask Chat to read the outline again.')
    }

    if (proposal.action === 'rename') {
      await renameEntity(entity.id, proposal.newTitle || entity.title)
      const appliedAt = Date.now()
      await setOutlineActionStatus(message.id, proposal.id, { status: 'applied', appliedAt })
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('arc-entity-changed', { detail: { bookId: message.bookId, entityId: entity.id } }))
      return { entityId: entity.id, appliedAt }
    }

    if (proposal.action === 'move') {
      if (entity.parentId !== proposal.sourceParentId || (entity.order ?? 0) !== proposal.sourceOrder) {
        await setOutlineActionStatus(message.id, proposal.id, { status: 'stale' })
        throw new Error('The outline order changed after this proposal was created. Ask Chat to read the outline again.')
      }
      await outlineParent(message.bookId, entity.type, proposal.targetParentId ?? '')
      await validateBefore(message.bookId, entity, proposal.targetParentId ?? '', proposal.beforeId)
      await placeStructuralEntity(entity.id, proposal.targetParentId ?? '', proposal.beforeId)
      const appliedAt = Date.now()
      await setOutlineActionStatus(message.id, proposal.id, { status: 'applied', appliedAt })
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('arc-entity-changed', { detail: { bookId: message.bookId, entityId: entity.id } }))
      return { entityId: entity.id, appliedAt }
    }

    const blockers = await nonEmptyScenesInSubtree(message.bookId, entity.id)
    if (blockers.length) {
      await setOutlineActionStatus(message.id, proposal.id, { status: 'stale' })
      throw new Error('This outline item now contains non-empty Scene content, so it cannot be deleted.')
    }
    const deletedIds = await deleteEntityTree(entity.id)
    const appliedAt = Date.now()
    await setOutlineActionStatus(message.id, proposal.id, { status: 'applied', appliedAt })
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('arc-entity-changed', { detail: { bookId: message.bookId, entityId: entity.id, deletedIds } }))
    return { entityId: entity.id, appliedAt, deletedIds }
  } catch (error) {
    if (proposal.status === 'applying') {
      const refreshed = await getEntity<ArcEntity>(proposal.entityId ?? '')
      if (!refreshed) await setOutlineActionStatus(message.id, proposal.id, { status: 'stale' }).catch(() => undefined)
    }
    throw error
  }
}

export async function rejectChatOutlineAction(messageId: string, proposalId: string) {
  await transitionChatMessageProposal(messageId, 'outlineActions', proposalId, ['proposed'], { status: 'rejected' })
}

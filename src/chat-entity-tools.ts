import type { ChatToolCall, ChatToolDefinition } from './chat-api'
import {
  updateChatMessage,
  type ChatEntityActionProposal,
  type ChatMessageEntity,
} from './chat-service'
import {
  createNote,
  deleteEntityTree,
  getEntity,
  isCodexEntryArchived,
  listEntitiesByBook,
  renameEntity,
  saveDocumentContent,
  updateCodexCategory,
  type ArcEntity,
} from './persistence'

const manageableTypes = ['note', 'codexEntry'] as const
const manageableTypeSet = new Set<string>(manageableTypes)
const CODEX_CATEGORIES = ['Character', 'Place', 'Object', 'Event', 'Group', 'Other'] as const

export const chatEntityToolNames = new Set([
  'propose_note_create',
  'propose_entity_rename',
  'propose_entity_delete',
  'propose_codex_category',
])

export const chatEntityTools: ChatToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'propose_note_create',
      description: 'Propose creating a new Note with Markdown content. This only creates an approval proposal; the Note is not created until the user presses Create in Chat.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Title for the new Note.' },
          content: { type: 'string', description: 'Markdown body for the new Note.' },
          summary: { type: 'string', description: 'Short explanation of why the Note should be created.' },
        },
        required: ['title', 'content'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_entity_rename',
      description: 'Propose renaming an existing Note or Codex entry. This does not rename anything until the user approves the proposal in Chat.',
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
      name: 'propose_entity_delete',
      description: 'Propose deleting an existing Note or Codex entry. This does not delete anything until the user explicitly approves the proposal in Chat.',
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
  {
    type: 'function',
    function: {
      name: 'propose_codex_category',
      description: 'Propose changing the category of an existing Codex entry. This does not change the category until the user approves the proposal in Chat.',
      parameters: {
        type: 'object',
        properties: {
          entity_id: { type: 'string' },
          category: { type: 'string', enum: CODEX_CATEGORIES },
          summary: { type: 'string' },
        },
        required: ['entity_id', 'category'],
        additionalProperties: false,
      },
    },
  },
]

function result(value: unknown) {
  return JSON.stringify(value)
}

function makeProposalId() {
  return `chat-entity-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function parseArguments(call: ChatToolCall): Record<string, unknown> {
  try {
    const parsed = JSON.parse(call.function.arguments || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    throw new Error(`Invalid JSON arguments for ${call.function.name}.`)
  }
}

function cleanTitle(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

function normalizedTitle(value: unknown) {
  return cleanTitle(value).toLocaleLowerCase()
}

function entityTitle(entity: ArcEntity) {
  return String(entity.title ?? 'Untitled')
}

async function manageableEntity(bookId: string, entityId: string) {
  const entity = await getEntity<ArcEntity>(entityId)
  if (!entity || entity.bookId !== bookId || !manageableTypeSet.has(entity.type) || isCodexEntryArchived(entity)) {
    throw new Error('That Note or Codex entry was not found in the current book.')
  }
  return entity
}

async function duplicateTitle(bookId: string, type: 'note' | 'codexEntry', title: string, exceptId?: string) {
  return (await listEntitiesByBook(bookId, type))
    .find((entity) => entity.id !== exceptId && !isCodexEntryArchived(entity) && normalizedTitle(entity.title) === normalizedTitle(title))
}

export async function executeChatEntityTool(bookId: string, call: ChatToolCall): Promise<{ content: string; entityAction?: ChatEntityActionProposal }> {
  try {
    const args = parseArguments(call)

    if (call.function.name === 'propose_note_create') {
      const title = cleanTitle(args.title)
      const content = typeof args.content === 'string' ? args.content : ''
      if (!title) return { content: result({ ok: false, error: 'The new Note needs a title.' }) }
      const duplicate = await duplicateTitle(bookId, 'note', title)
      if (duplicate) {
        return { content: result({ ok: false, error: 'A Note with this title already exists. Read or edit the existing Note instead of creating an exact-title duplicate.', existing: { id: duplicate.id, title: entityTitle(duplicate) } }) }
      }
      const proposal: ChatEntityActionProposal = {
        id: makeProposalId(),
        action: 'create_note',
        entityType: 'note',
        entityTitle: title,
        newTitle: title,
        content,
        contentLength: content.length,
        summary: cleanTitle(args.summary),
        status: 'proposed',
        createdAt: Date.now(),
      }
      return { content: result({ ok: true, proposalId: proposal.id, message: 'Note creation proposal created. The user must press Create before the Note exists.' }), entityAction: proposal }
    }

    if (call.function.name === 'propose_entity_rename') {
      const entityId = typeof args.entity_id === 'string' ? args.entity_id : ''
      const entity = await manageableEntity(bookId, entityId)
      const newTitle = cleanTitle(args.new_title)
      if (!newTitle) return { content: result({ ok: false, error: 'The new title cannot be empty.' }) }
      if (entity.type === 'codexEntry') {
        const duplicate = await duplicateTitle(bookId, 'codexEntry', newTitle, entity.id)
        if (duplicate) {
          return { content: result({ ok: false, error: 'Another Codex entry already has this title. Use a distinct canonical title.', existing: { id: duplicate.id, title: entityTitle(duplicate) } }) }
        }
      }
      const proposal: ChatEntityActionProposal = {
        id: makeProposalId(),
        action: 'rename',
        entityId: entity.id,
        entityType: entity.type as 'note' | 'codexEntry',
        entityTitle: entityTitle(entity),
        newTitle,
        expectedUpdatedAt: entity.updatedAt,
        summary: cleanTitle(args.summary),
        status: 'proposed',
        createdAt: Date.now(),
      }
      return { content: result({ ok: true, proposalId: proposal.id, message: 'Rename proposal created. The user must approve it before the title changes.' }), entityAction: proposal }
    }

    if (call.function.name === 'propose_entity_delete') {
      const entityId = typeof args.entity_id === 'string' ? args.entity_id : ''
      const entity = await manageableEntity(bookId, entityId)
      const contentLength = String(entity.content ?? '').length
      const proposal: ChatEntityActionProposal = {
        id: makeProposalId(),
        action: 'delete',
        entityId: entity.id,
        entityType: entity.type as 'note' | 'codexEntry',
        entityTitle: entityTitle(entity),
        expectedUpdatedAt: entity.updatedAt,
        contentLength,
        summary: cleanTitle(args.summary),
        status: 'proposed',
        createdAt: Date.now(),
      }
      return { content: result({ ok: true, proposalId: proposal.id, contentLength, message: 'Deletion proposal created. Nothing is deleted until the user explicitly approves it.' }), entityAction: proposal }
    }

    if (call.function.name === 'propose_codex_category') {
      const entityId = typeof args.entity_id === 'string' ? args.entity_id : ''
      const entity = await manageableEntity(bookId, entityId)
      if (entity.type !== 'codexEntry') return { content: result({ ok: false, error: 'Only Codex entries have categories.' }) }
      const category = typeof args.category === 'string' && CODEX_CATEGORIES.includes(args.category as typeof CODEX_CATEGORIES[number]) ? args.category : null
      if (!category) return { content: result({ ok: false, error: 'Choose a valid Codex category.' }) }
      const proposal: ChatEntityActionProposal = {
        id: makeProposalId(),
        action: 'set_codex_category',
        entityId: entity.id,
        entityType: 'codexEntry',
        entityTitle: entityTitle(entity),
        expectedUpdatedAt: entity.updatedAt,
        previousCategory: String(entity.category ?? 'Other'),
        category,
        summary: cleanTitle(args.summary),
        status: 'proposed',
        createdAt: Date.now(),
      }
      return { content: result({ ok: true, proposalId: proposal.id, message: 'Codex category proposal created. The category does not change until the user approves it.' }), entityAction: proposal }
    }

    return { content: result({ ok: false, error: `Unknown entity tool: ${call.function.name}` }) }
  } catch (error) {
    return { content: result({ ok: false, error: error instanceof Error ? error.message : 'Entity tool execution failed.' }) }
  }
}

async function messageWithAction(messageId: string, proposalId: string) {
  const entity = await getEntity<ArcEntity>(messageId)
  if (!entity || entity.type !== 'chatMessage') throw new Error('The chat message is no longer available.')
  const message = entity as ChatMessageEntity
  const proposal = message.entityActions?.find((item) => item.id === proposalId)
  if (!proposal) throw new Error('That entity proposal is no longer available.')
  return { message, proposal }
}

async function setActionStatus(message: ChatMessageEntity, proposalId: string, patch: Partial<ChatEntityActionProposal>) {
  const entityActions = (message.entityActions ?? []).map((proposal) => proposal.id === proposalId ? { ...proposal, ...patch } : proposal)
  return updateChatMessage(message.id, { entityActions })
}

export async function applyChatEntityAction(messageId: string, proposalId: string) {
  const { message, proposal } = await messageWithAction(messageId, proposalId)
  if (proposal.status !== 'proposed') throw new Error(`This proposal is already ${proposal.status}.`)

  if (proposal.action === 'create_note') {
    const title = proposal.newTitle || proposal.entityTitle
    const duplicate = await duplicateTitle(message.bookId, 'note', title)
    if (duplicate) {
      await setActionStatus(message, proposal.id, { status: 'stale' })
      throw new Error('A Note with this title now exists. Ask Chat to prepare a new proposal or edit the existing Note.')
    }
    const created = await createNote(message.bookId, title)
    if (proposal.content) await saveDocumentContent(created.id, proposal.content)
    const appliedAt = Date.now()
    await setActionStatus(message, proposal.id, { status: 'applied', appliedAt, entityId: created.id })
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('arc-entity-changed', { detail: { bookId: message.bookId, entityId: created.id } }))
    return { entityId: created.id, appliedAt }
  }

  const entity = await manageableEntity(message.bookId, proposal.entityId ?? '')
  if (proposal.expectedUpdatedAt !== undefined && entity.updatedAt !== proposal.expectedUpdatedAt) {
    await setActionStatus(message, proposal.id, { status: 'stale' })
    throw new Error('This item changed after the proposal was created. Ask Chat to read it again and prepare a new proposal.')
  }

  if (proposal.action === 'rename') {
    const newTitle = proposal.newTitle || entityTitle(entity)
    if (entity.type === 'codexEntry') {
      const duplicate = await duplicateTitle(message.bookId, 'codexEntry', newTitle, entity.id)
      if (duplicate) {
        await setActionStatus(message, proposal.id, { status: 'stale' })
        throw new Error('Another Codex entry now has this title. Ask Chat to choose a distinct title.')
      }
    }
    await renameEntity(entity.id, newTitle)
    const appliedAt = Date.now()
    await setActionStatus(message, proposal.id, { status: 'applied', appliedAt })
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('arc-entity-changed', { detail: { bookId: message.bookId, entityId: entity.id } }))
    return { entityId: entity.id, appliedAt }
  }

  if (proposal.action === 'set_codex_category') {
    if (entity.type !== 'codexEntry') throw new Error('Only Codex entries have categories.')
    await updateCodexCategory(entity.id, proposal.category || 'Other')
    const appliedAt = Date.now()
    await setActionStatus(message, proposal.id, { status: 'applied', appliedAt })
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('arc-entity-changed', { detail: { bookId: message.bookId, entityId: entity.id } }))
    return { entityId: entity.id, appliedAt }
  }

  if (proposal.action === 'delete') {
    const removedIds = await deleteEntityTree(entity.id)
    const appliedAt = Date.now()
    await setActionStatus(message, proposal.id, { status: 'applied', appliedAt })
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('arc-entity-changed', { detail: { bookId: message.bookId, entityId: entity.id, deletedIds: removedIds } }))
    return { entityId: entity.id, appliedAt, removedIds }
  }

  throw new Error(`Unsupported entity action: ${proposal.action}`)
}

export async function rejectChatEntityAction(messageId: string, proposalId: string) {
  const { message, proposal } = await messageWithAction(messageId, proposalId)
  if (proposal.status !== 'proposed') throw new Error(`This proposal is already ${proposal.status}.`)
  await setActionStatus(message, proposal.id, { status: 'rejected' })
}

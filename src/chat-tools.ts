import type { ChatToolCall, ChatToolDefinition } from './chat-api'
import { isActiveCodexTitleDuplicate } from './chat-codex-duplicate'
import { loadProposalTargetOrMarkStale } from './chat-proposal-target'
import {
  claimChatMessageProposal,
  transitionChatMessageProposal,
  type ChatCodexCreationProposal,
  type ChatDocumentEditProposal,
  type ChatMessageEntity,
  type ChatTextReplacement,
} from './chat-service'
import {
  createCodexEntry,
  createSnapshot,
  getEntity,
  isCodexEntryArchived,
  listEntitiesByBook,
  saveDocumentContent,
  type ArcEntity,
} from './persistence'

const editableTypes = ['scene', 'note', 'codexEntry'] as const
const editableTypeSet = new Set<string>(editableTypes)
const MAX_SEARCH_RESULTS = 12
const MAX_REPLACEMENTS = 12
const CODEX_CATEGORIES = ['Character', 'Place', 'Object', 'Event', 'Group', 'Other'] as const

export const chatWorkspaceTools: ChatToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'search_entities',
      description: 'Search Scenes, Notes, and Codex entries in the current book. Use this when the user refers to a document that is not already obvious from context.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Title, category, or content text to search for.' },
          types: {
            type: 'array',
            items: { type: 'string', enum: editableTypes },
            description: 'Optional entity types to include.',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_entity',
      description: 'Read the current complete content and metadata of one Scene, Note, or Codex entry before proposing an edit.',
      parameters: {
        type: 'object',
        properties: {
          entity_id: { type: 'string' },
        },
        required: ['entity_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_codex_entry',
      description: 'Propose creating a new Codex/lore entry in the current book. Search existing Codex entries first when the name may already exist. This only creates a proposal; the entry is not created until the user presses Create.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Concise canonical name for the lore entry.' },
          category: { type: 'string', enum: CODEX_CATEGORIES, description: 'Codex category.' },
          content: { type: 'string', description: 'Markdown body for the new Codex entry.' },
          summary: { type: 'string', description: 'Short explanation of why this lore entry should be created.' },
        },
        required: ['title', 'category', 'content'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_document_edit',
      description: 'Propose one or more exact-text replacements in a Scene, Note, or Codex entry. This does not modify the document. old_text must be copied exactly from the current document and uniquely identify the text to replace. All replacements are validated and later applied together only after the user presses Apply.',
      parameters: {
        type: 'object',
        properties: {
          entity_id: { type: 'string' },
          expected_updated_at: { type: 'number', description: 'The exact updatedAt value returned by read_entity.' },
          summary: { type: 'string', description: 'Short human-readable explanation of the proposed change.' },
          edits: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_REPLACEMENTS,
            items: {
              type: 'object',
              properties: {
                old_text: { type: 'string', description: 'Exact existing text to replace. It must occur exactly once.' },
                new_text: { type: 'string', description: 'Replacement text. Use an empty string to delete old_text.' },
              },
              required: ['old_text', 'new_text'],
              additionalProperties: false,
            },
          },
        },
        required: ['entity_id', 'expected_updated_at', 'edits'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_document_replacement',
      description: 'Propose replacing the complete body of a Scene, Note, or Codex entry. Use this only for whole-document rewrites; prefer propose_document_edit for localized changes. This does not modify the document until the user presses Apply.',
      parameters: {
        type: 'object',
        properties: {
          entity_id: { type: 'string' },
          expected_updated_at: { type: 'number', description: 'The exact updatedAt value returned by read_entity.' },
          new_content: { type: 'string' },
          summary: { type: 'string', description: 'Short human-readable explanation of the proposed rewrite.' },
        },
        required: ['entity_id', 'expected_updated_at', 'new_content'],
        additionalProperties: false,
      },
    },
  },
]

function makeProposalId(prefix = 'chat-edit') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function toolResult(value: unknown) {
  return JSON.stringify(value)
}

function parseArguments(call: ChatToolCall): Record<string, unknown> {
  try {
    const parsed = JSON.parse(call.function.arguments || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    throw new Error(`Invalid JSON arguments for ${call.function.name}.`)
  }
}

function titleFor(entity: ArcEntity) {
  return String(entity.title ?? 'Untitled')
}

async function editableEntity(bookId: string, entityId: string) {
  const entity = await getEntity<ArcEntity>(entityId)
  if (!entity || entity.bookId !== bookId || !editableTypeSet.has(entity.type) || isCodexEntryArchived(entity)) {
    throw new Error('That editable document was not found in the current book.')
  }
  return entity
}

function occurrenceCount(text: string, needle: string) {
  if (!needle) return 0
  let count = 0
  let from = 0
  while (true) {
    const index = text.indexOf(needle, from)
    if (index < 0) return count
    count += 1
    from = index + needle.length
  }
}

function applyExactReplacements(content: string, edits: ChatTextReplacement[]) {
  let next = content
  for (const edit of edits) {
    if (!edit.oldText) throw new Error('old_text cannot be empty. Use an exact existing anchor or a whole-document replacement.')
    const count = occurrenceCount(next, edit.oldText)
    if (count === 0) throw new Error('One requested old_text passage is no longer present. Read the document again before proposing the edit.')
    if (count > 1) throw new Error(`One requested old_text passage is ambiguous (${count} exact matches). Use a larger unique passage.`)
    const index = next.indexOf(edit.oldText)
    next = `${next.slice(0, index)}${edit.newText}${next.slice(index + edit.oldText.length)}`
  }
  return next
}

function normalizeReplacements(value: unknown): ChatTextReplacement[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_REPLACEMENTS) {
    throw new Error(`Provide between 1 and ${MAX_REPLACEMENTS} text replacements.`)
  }
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('Each edit must contain old_text and new_text.')
    const edit = item as Record<string, unknown>
    if (typeof edit.old_text !== 'string' || typeof edit.new_text !== 'string') throw new Error('Each edit must contain string old_text and new_text values.')
    return { oldText: edit.old_text, newText: edit.new_text }
  })
}

export async function executeChatWorkspaceTool(bookId: string, call: ChatToolCall): Promise<{ content: string; proposal?: ChatDocumentEditProposal; codexCreation?: ChatCodexCreationProposal }> {
  try {
    const args = parseArguments(call)
    if (call.function.name === 'search_entities') {
      const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : ''
      if (!query) return { content: toolResult({ ok: false, error: 'Search query is empty.' }) }
      const requestedTypes = Array.isArray(args.types)
        ? new Set(args.types.filter((value): value is string => typeof value === 'string' && editableTypeSet.has(value)))
        : null
      const entities = (await listEntitiesByBook(bookId))
        .filter((entity) => editableTypeSet.has(entity.type) && !isCodexEntryArchived(entity) && (!requestedTypes?.size || requestedTypes.has(entity.type)))
        .filter((entity) => `${entity.title ?? ''} ${entity.category ?? ''} ${entity.content ?? ''}`.toLowerCase().includes(query))
        .slice(0, MAX_SEARCH_RESULTS)
        .map((entity) => ({
          id: entity.id,
          type: entity.type,
          title: titleFor(entity),
          category: entity.type === 'codexEntry' ? String(entity.category ?? 'Other') : undefined,
          updatedAt: entity.updatedAt,
          preview: String(entity.content ?? '').replace(/\s+/g, ' ').slice(0, 240),
        }))
      return { content: toolResult({ ok: true, results: entities }) }
    }

    if (call.function.name === 'read_entity') {
      const entityId = typeof args.entity_id === 'string' ? args.entity_id : ''
      const entity = await editableEntity(bookId, entityId)
      return { content: toolResult({
        ok: true,
        entity: {
          id: entity.id,
          type: entity.type,
          title: titleFor(entity),
          category: entity.type === 'codexEntry' ? String(entity.category ?? 'Other') : undefined,
          updatedAt: entity.updatedAt,
          content: String(entity.content ?? ''),
        },
      }) }
    }

    if (call.function.name === 'propose_codex_entry') {
      const title = typeof args.title === 'string' ? args.title.trim().replace(/\s+/g, ' ') : ''
      const category = typeof args.category === 'string' && CODEX_CATEGORIES.includes(args.category as typeof CODEX_CATEGORIES[number]) ? args.category : 'Other'
      const content = typeof args.content === 'string' ? args.content : ''
      if (!title) return { content: toolResult({ ok: false, error: 'Codex title cannot be empty.' }) }
      const existing = (await listEntitiesByBook(bookId, 'codexEntry'))
        .filter((entity) => isActiveCodexTitleDuplicate(entity, title))
      if (existing.length) {
        return { content: toolResult({ ok: false, error: 'A Codex entry with this title already exists. Read or edit the existing entry instead of creating a duplicate.', existing: existing.map((entity) => ({ id: entity.id, title: titleFor(entity), category: String(entity.category ?? 'Other') })) }) }
      }
      const proposal: ChatCodexCreationProposal = {
        id: makeProposalId('chat-codex-create'),
        title,
        category,
        content,
        summary: typeof args.summary === 'string' ? args.summary.trim() : '',
        status: 'proposed',
        createdAt: Date.now(),
      }
      return { content: toolResult({ ok: true, proposalId: proposal.id, message: 'Codex creation proposal created. The entry has not been created; the user must press Create.' }), codexCreation: proposal }
    }

    if (call.function.name === 'propose_document_edit') {
      const entityId = typeof args.entity_id === 'string' ? args.entity_id : ''
      const entity = await editableEntity(bookId, entityId)
      const expectedUpdatedAt = Number(args.expected_updated_at)
      if (!Number.isFinite(expectedUpdatedAt) || expectedUpdatedAt !== entity.updatedAt) {
        return { content: toolResult({ ok: false, error: 'The document changed since it was read. Read it again and retry with the new updatedAt value.', currentUpdatedAt: entity.updatedAt }) }
      }
      const edits = normalizeReplacements(args.edits)
      applyExactReplacements(String(entity.content ?? ''), edits)
      const proposal: ChatDocumentEditProposal = {
        id: makeProposalId(),
        entityId: entity.id,
        entityType: entity.type as ChatDocumentEditProposal['entityType'],
        entityTitle: titleFor(entity),
        expectedUpdatedAt,
        mode: 'text_replacements',
        edits,
        summary: typeof args.summary === 'string' ? args.summary.trim() : '',
        status: 'proposed',
        createdAt: Date.now(),
      }
      return { content: toolResult({ ok: true, proposalId: proposal.id, message: 'Edit proposal created. The document has not been changed; the user must press Apply.' }), proposal }
    }

    if (call.function.name === 'propose_document_replacement') {
      const entityId = typeof args.entity_id === 'string' ? args.entity_id : ''
      const entity = await editableEntity(bookId, entityId)
      const expectedUpdatedAt = Number(args.expected_updated_at)
      if (!Number.isFinite(expectedUpdatedAt) || expectedUpdatedAt !== entity.updatedAt) {
        return { content: toolResult({ ok: false, error: 'The document changed since it was read. Read it again and retry with the new updatedAt value.', currentUpdatedAt: entity.updatedAt }) }
      }
      if (typeof args.new_content !== 'string') return { content: toolResult({ ok: false, error: 'new_content must be a string.' }) }
      const proposal: ChatDocumentEditProposal = {
        id: makeProposalId(),
        entityId: entity.id,
        entityType: entity.type as ChatDocumentEditProposal['entityType'],
        entityTitle: titleFor(entity),
        expectedUpdatedAt,
        mode: 'replace_document',
        newContent: args.new_content,
        summary: typeof args.summary === 'string' ? args.summary.trim() : '',
        status: 'proposed',
        createdAt: Date.now(),
      }
      return { content: toolResult({ ok: true, proposalId: proposal.id, message: 'Whole-document proposal created. The document has not been changed; the user must press Apply.' }), proposal }
    }

    return { content: toolResult({ ok: false, error: `Unknown tool: ${call.function.name}` }) }
  } catch (error) {
    return { content: toolResult({ ok: false, error: error instanceof Error ? error.message : 'Tool execution failed.' }) }
  }
}

async function setProposalStatus(messageId: string, proposalId: string, status: ChatDocumentEditProposal['status'], appliedAt?: number) {
  return transitionChatMessageProposal(messageId, 'documentEdits', proposalId, ['applying'], { status, ...(appliedAt ? { appliedAt } : {}) })
}

export async function applyChatDocumentEdit(messageId: string, proposalId: string) {
  const claimed = await claimChatMessageProposal(messageId, 'documentEdits', proposalId)
  const message = claimed.message
  const proposal = claimed.proposal as ChatDocumentEditProposal
  const entity = await loadProposalTargetOrMarkStale(
    () => editableEntity(message.bookId, proposal.entityId),
    () => setProposalStatus(message.id, proposal.id, 'stale'),
  )
  if (entity.updatedAt !== proposal.expectedUpdatedAt) {
    await setProposalStatus(message.id, proposal.id, 'stale')
    throw new Error('This document changed after the proposal was created. Ask the chat to read it again and prepare a new edit.')
  }

  const currentContent = String(entity.content ?? '')
  let nextContent: string
  try {
    nextContent = proposal.mode === 'replace_document'
      ? proposal.newContent ?? ''
      : applyExactReplacements(currentContent, proposal.edits ?? [])
  } catch (error) {
    await setProposalStatus(message.id, proposal.id, 'stale')
    throw error
  }

  if (nextContent !== currentContent) {
    await createSnapshot(entity.id, 'generation', currentContent)
    await saveDocumentContent(entity.id, nextContent)
  }
  const appliedAt = Date.now()
  await setProposalStatus(message.id, proposal.id, 'applied', appliedAt)
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('arc-entity-changed', { detail: { bookId: message.bookId, entityId: entity.id } }))
  return { entityId: entity.id, appliedAt }
}

export async function rejectChatDocumentEdit(messageId: string, proposalId: string) {
  await transitionChatMessageProposal(messageId, 'documentEdits', proposalId, ['proposed'], { status: 'rejected' })
}

async function setCodexCreationStatus(messageId: string, proposalId: string, patch: Partial<ChatCodexCreationProposal>) {
  return transitionChatMessageProposal(messageId, 'codexCreations', proposalId, ['applying'], patch)
}

export async function createChatCodexEntry(messageId: string, proposalId: string) {
  const claimed = await claimChatMessageProposal(messageId, 'codexCreations', proposalId)
  const message = claimed.message
  const proposal = claimed.proposal as ChatCodexCreationProposal

  const duplicates = (await listEntitiesByBook(message.bookId, 'codexEntry'))
    .filter((entity) => isActiveCodexTitleDuplicate(entity, proposal.title))
  if (duplicates.length) {
    await setCodexCreationStatus(message.id, proposal.id, { status: 'duplicate', entityId: duplicates[0].id })
    throw new Error('A Codex entry with this title now exists. The proposal was not created again.')
  }

  const created = await createCodexEntry(message.bookId, proposal.title, proposal.category)
  if (proposal.content) await saveDocumentContent(created.id, proposal.content)
  const appliedAt = Date.now()
  await setCodexCreationStatus(message.id, proposal.id, { status: 'created', entityId: created.id, appliedAt })
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('arc-entity-changed', { detail: { bookId: message.bookId, entityId: created.id } }))
  return { entityId: created.id, appliedAt }
}

export async function rejectChatCodexEntry(messageId: string, proposalId: string) {
  await transitionChatMessageProposal(messageId, 'codexCreations', proposalId, ['proposed'], { status: 'rejected' })
}

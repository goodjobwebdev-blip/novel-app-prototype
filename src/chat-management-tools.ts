import { sceneBeats } from './scene-beats'
import { proseEntities } from './document-projection.ts'
import { sceneWritingFields, sceneWritingLabels, sceneWritingValues, validateSceneWritingPatch, resolveSceneWriting } from './scene-writing'
import type { ChatToolCall, ChatToolDefinition } from './chat-api'
import { transitionChatMessageProposal, type ChatEntityActionProposal, type ChatMessageEntity } from './chat-service'
import { applyChatManagementChange, getEntity, isCodexEntryArchived, listCodexDependencies, listEntitiesByBook, listSeries, type ArcEntity, type BookEntity, type CodexEntryEntity, type SummaryEntity } from './persistence'
import { bookMetadataFields, bookMetadataLabels, metadataValues, validateMetadataPatch, type ChatManagementOperation } from './chat-management-schema'
import { normalizeCodexTriggerList } from './codex-trigger-service'
import { searchBookEntities, searchableTypes } from './chat-search'
import { summaryStateForSource, type SummarySourceEntity } from './summary-service'
import { regenerateEntitySummary } from './summary-generation'

type Properties = Record<string, unknown>
function tool(name: string, description: string, properties: Properties, required: string[] = []): ChatToolDefinition {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } }
}
const string = { type: 'string' }
const entityId = { entity_id: string }
export const entitySearchProperties = {
  types: { type: 'array', items: { type: 'string', enum: searchableTypes } },
  parent_id: { type: 'string', description: 'Optional parent ID, for example a Chapter to limit results to its Scenes.' },
  offset: { type: 'integer', minimum: 0, description: 'Use next_offset from the previous page.' },
  limit: { type: 'integer', minimum: 1, maximum: 50 },
  include_archived: { type: 'boolean', description: 'Include archived Codex entries for discovery. They must be restored in the workspace before editing.' },
}
export const chatManagementTools: ChatToolDefinition[] = [
  tool('read_book_metadata', 'Read all current Book metadata and available Series IDs/titles before proposing metadata changes.', {}),
  tool('propose_book_metadata_update', 'Propose changes to any Book metadata fields. Only supplied fields change; empty strings clear optional fields. seriesId must identify an existing Series, or be empty for standalone. Requires approval.', { changes: { type: 'object', properties: Object.fromEntries(bookMetadataFields.map((field) => [field, string])), additionalProperties: false }, summary: string }, ['changes']),
  tool('propose_scene_beat', 'Propose creating a planning beat at the end of a Scene or editing an existing beat by beat_id returned by read_entity. This changes planning only after approval; it never generates or replaces prose.', { ...entityId, beat_id: string, text: string, summary: string }, ['entity_id', 'text']),
  tool('read_scene_settings', 'Read explicit scene writing overrides and effective settings with their origin.', entityId, ['entity_id']),
  tool('propose_scene_settings_update', 'Propose scene POV, tense, writingStyle or language overrides. Empty strings restore live inheritance from the Book. Requires approval.', { ...entityId, changes: { type: 'object', properties: Object.fromEntries(sceneWritingFields.map((field) => [field, string])), additionalProperties: false }, summary: string }, ['entity_id', 'changes']),
  tool('list_entities', 'List Scenes, Chapters, Acts, Notes and Codex entries without a search term. Results are paginated; use next_offset until null.', entitySearchProperties),
  tool('read_codex_settings', 'Read a Codex entry’s automatic inclusion triggers, outgoing dependencies, and incoming Needed by links. Edges are directional: including the source can include its dependency target.', entityId, ['entity_id']),
  tool('propose_codex_dependency', 'Propose creating, updating or removing a directional Codex dependency. Read settings first. source entity_id depends on target_id; include_with_source controls automatic inclusion of the target. Requires approval.', { ...entityId, target_id: string, action: { type: 'string', enum: ['create', 'update', 'remove'] }, relation_label: string, include_with_source: { type: 'boolean' }, summary: string }, ['entity_id', 'target_id', 'action']),
  tool('propose_codex_triggers', 'Propose replacing the entire automatic inclusion trigger list for a Codex entry. Read its settings first and retain any existing triggers that should remain. An empty array clears the list. Requires approval.', { ...entityId, triggers: { type: 'array', items: string }, summary: string }, ['entity_id', 'triggers']),
  tool('read_summary', 'Read the stored summary and its missing/current/outdated state for a Scene, Chapter, Act or Codex entry. Does not create or regenerate it. Notes and Books do not have summaries.', entityId, ['entity_id']),
  tool('propose_summary_regeneration', 'Propose generating or regenerating an entity summary using the existing summary prompt, hierarchical source selection, and the Support model selected for summaries in Book AI settings. Runs only after approval; use read_summary in a later turn to read the saved result. Supported: Scene, Chapter, Act, Codex entry.', { ...entityId, summary: string }, ['entity_id']),
]
export const chatManagementToolNames = new Set(chatManagementTools.map((item) => item.function.name))

async function bookEntity(bookId: string) {
  const book = await getEntity<BookEntity>(bookId)
  if (book?.type !== 'book') throw new Error('This Book is no longer available.')
  return book
}
async function codexEntity(bookId: string, id: unknown, allowArchived = false) {
  const entry = await getEntity<CodexEntryEntity>(String(id ?? ''))
  if (!entry || entry.type !== 'codexEntry' || entry.bookId !== bookId || (!allowArchived && isCodexEntryArchived(entry))) throw new Error('The Codex entry is unavailable or archived in this Book.')
  return entry
}
async function summarySource(bookId: string, id: unknown) {
  const entity = await getEntity<SummarySourceEntity>(String(id ?? ''))
  if (!entity || entity.bookId !== bookId || !['act', 'chapter', 'scene', 'codexEntry'].includes(entity.type)) throw new Error('Only Scenes, Chapters, Acts and Codex entries in this Book support summaries.')
  return entity
}
function proposal(entity: ArcEntity, action: ChatEntityActionProposal['action'], operation: ChatManagementOperation, args: Record<string, unknown>, changes: NonNullable<ChatEntityActionProposal['changes']>): ChatEntityActionProposal {
  return { id: `chat-management-${crypto.randomUUID()}`, action, entityId: entity.id, entityTitle: String(entity.title ?? 'Untitled'), entityType: entity.type as ChatEntityActionProposal['entityType'], operation, changes, summary: typeof args.summary === 'string' ? args.summary : '', status: 'proposed', createdAt: Date.now() }
}

export async function executeChatManagementTool(bookId: string, call: ChatToolCall): Promise<{ content: string; entityAction?: ChatEntityActionProposal }> {
  try {
    const args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Arguments must be an object.')
    const name = call.function.name
    let item: ChatEntityActionProposal
    if (name === 'read_book_metadata') return { content: JSON.stringify({ ok: true, bookId, metadata: metadataValues(await bookEntity(bookId)), series: (await listSeries()).map(({ id, title }) => ({ id, title })) }) }
    if (name === 'list_entities') return { content: JSON.stringify(searchBookEntities(await listEntitiesByBook(bookId), args, true)) }
    if (name === 'propose_book_metadata_update') {
      const book = await bookEntity(bookId)
      const patch = validateMetadataPatch(args.changes)
      const current = metadataValues(book)
      const series = await listSeries()
      if (patch.seriesId && !series.some((s) => s.id === patch.seriesId)) throw new Error('Choose an existing Series ID returned by read_book_metadata.')
      if (patch.seriesOrder && !(patch.seriesId ?? current.seriesId)) throw new Error('Choose a Series before setting its book order.')
      const before = Object.fromEntries(Object.keys(patch).map((key) => [key, current[key as keyof typeof current]]))
      item = proposal(book, 'update_metadata', { kind: 'metadata', patch, before }, args, Object.entries(patch).map(([field, after]) => ({ field: bookMetadataLabels[field as keyof typeof bookMetadataLabels], before: field === 'seriesId' ? series.find((s) => s.id === before[field])?.title ?? 'Standalone' : before[field], after: field === 'seriesId' ? series.find((s) => s.id === after)?.title ?? 'Standalone' : after })))
    } else if (name === 'propose_scene_beat') {
      const entry = await getEntity(String(args.entity_id ?? ''))
      if (!entry || entry.type !== 'scene' || entry.bookId !== bookId) throw new Error('Choose a Scene in this Book.')
      if (typeof args.text !== 'string' || !args.text.trim()) throw new Error('Provide nonempty planning text.')
      const existing = args.beat_id ? sceneBeats(String(entry.content ?? '')).filter((item) => item.block.id === args.beat_id) : []
      if (args.beat_id && existing.length !== 1) throw new Error('The beat is unavailable. Read the Scene again.')
      const before = existing[0]?.block.text
      const operation: ChatManagementOperation = { kind: 'beat', action: args.beat_id ? 'edit' : 'create', beatId: existing[0]?.block.id ?? `beat-${crypto.randomUUID()}`, text: args.text.trim(), before }
      item = proposal(entry, 'update_metadata', operation, args, [{ field: 'Scene beat (planning)', before: before ?? 'No beat', after: operation.text }])
    } else if (name === 'read_scene_settings' || name === 'propose_scene_settings_update') {
      const entry = await getEntity(String(args.entity_id ?? ''))
      if (!entry || entry.type !== 'scene' || entry.bookId !== bookId) throw new Error('This Scene is unavailable in this Book.')
      const before = sceneWritingValues(entry)
      const book = await bookEntity(bookId)
      if (name === 'read_scene_settings') return { content: JSON.stringify({ ok: true, entityId: entry.id, overrides: before, effective: resolveSceneWriting({ pov: book.pointOfView, tense: book.tense, style: book.writingStyle, language: book.language }, before) }) }
      const patch = validateSceneWritingPatch(args.changes)
      item = proposal(entry, 'update_metadata', { kind: 'scene_metadata', patch, before }, args, Object.entries(patch).map(([field, after]) => ({ field: sceneWritingLabels[field as keyof typeof sceneWritingLabels], before: before[field as keyof typeof before] || 'Inherit from book', after: after || 'Inherit from book' })))
    } else if (name === 'read_codex_settings') {
      const entry = await codexEntity(bookId, args.entity_id, true)
      const [edges, entities] = await Promise.all([listCodexDependencies(bookId), listEntitiesByBook(bookId)])
      const withTitles = edges.map((edge) => ({ ...edge, sourceTitle: entities.find((e) => e.id === edge.sourceId)?.title, targetTitle: entities.find((e) => e.id === edge.targetId)?.title }))
      return { content: JSON.stringify({ ok: true, entityId: entry.id, title: entry.title, archived: isCodexEntryArchived(entry), triggers: entry.autoIncludeTriggers ?? [], dependencies: withTitles.filter((e) => e.sourceId === entry.id), neededBy: withTitles.filter((e) => e.targetId === entry.id) }) }
    } else if (name === 'propose_codex_triggers') {
      const entry = await codexEntity(bookId, args.entity_id)
      if (!Array.isArray(args.triggers) || args.triggers.some((v) => typeof v !== 'string')) throw new Error('triggers must be an array of strings.')
      const triggers = normalizeCodexTriggerList(args.triggers)
      const before = entry.autoIncludeTriggers ?? []
      item = proposal(entry, 'update_triggers', { kind: 'triggers', triggers, before }, args, [{ field: 'Automatic inclusion triggers', before: before.join(', '), after: triggers.join(', ') }])
    } else if (name === 'propose_codex_dependency') {
      const entry = await codexEntity(bookId, args.entity_id)
      const target = await codexEntity(bookId, args.target_id, args.action === 'remove')
      if (entry.id === target.id) throw new Error('An entry cannot depend on itself.')
      const action = args.action
      if (action !== 'create' && action !== 'update' && action !== 'remove') throw new Error('Choose create, update or remove.')
      const before = (await listCodexDependencies(bookId)).find((e) => e.sourceId === entry.id && e.targetId === target.id) ?? null
      if (action === 'create' ? before : !before) throw new Error(action === 'create' ? 'This dependency already exists.' : 'This dependency no longer exists.')
      if (args.relation_label !== undefined && typeof args.relation_label !== 'string') throw new Error('relation_label must be a string.')
      if (args.include_with_source !== undefined && typeof args.include_with_source !== 'boolean') throw new Error('include_with_source must be a boolean.')
      const relationLabel = typeof args.relation_label === 'string' ? args.relation_label.trim() : before?.relationLabel ?? ''
      const includeWithSource = typeof args.include_with_source === 'boolean' ? args.include_with_source : before?.includeWithSource ?? true
      item = proposal(entry, 'update_dependency', { kind: 'dependency', action, targetId: target.id, relationLabel, includeWithSource, before }, args, [{ field: `${entry.title} → ${target.title}`, before: before ? `${before.relationLabel || 'Dependency'}; include: ${before.includeWithSource}` : 'No dependency', after: action === 'remove' ? 'No dependency' : `${relationLabel || 'Dependency'}; include: ${includeWithSource}` }])
    } else if (name === 'read_summary' || name === 'propose_summary_regeneration') {
      const entity = await summarySource(bookId, args.entity_id)
      const entities = await listEntitiesByBook(bookId)
      const summary = entities.find((e): e is SummaryEntity => e.type === 'summary' && e.sourceEntityId === entity.id)
      const state = summaryStateForSource(entity, entities)
      if (name === 'read_summary') return { content: JSON.stringify({ ok: true, entityId: entity.id, title: entity.title, state, summaryId: summary?.id ?? null, content: proseEntities(entities).find((item) => item.id === summary?.id)?.content ?? '', updatedAt: summary?.updatedAt ?? null }) }
      if (isCodexEntryArchived(entity)) throw new Error('Restore this Codex entry before regenerating its summary.')
      item = proposal(entity, 'regenerate_summary', { kind: 'summary' }, args, [{ field: 'Summary', before: state, after: 'Regenerate from the current source using Book summary settings' }])
    } else throw new Error(`Unknown tool: ${name}`)
    return { content: JSON.stringify({ ok: true, proposalId: item.id, message: 'Approval proposal created. No change has been applied. Summary generation starts only after approval.' }), entityAction: item }
  } catch (error) {
    return { content: JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Tool failed.' }) }
  }
}

export async function applyChatManagementProposal(message: ChatMessageEntity, item: ChatEntityActionProposal, signal: AbortSignal) {
  const operation = item.operation
  if (!operation || !item.entityId) throw new Error('This proposal is incomplete.')
  let entityId = item.entityId
  try {
    signal.throwIfAborted()
    if (operation.kind === 'summary') entityId = (await regenerateEntitySummary(message.bookId, entityId, signal, { messageId: message.id, proposalId: item.id })).id
    else await applyChatManagementChange(message.bookId, entityId, operation)
  } catch (error) {
    await transitionChatMessageProposal(message.id, 'entityActions', item.id, ['applying'], { status: operation.kind === 'summary' ? 'proposed' : 'stale', error: signal.aborted ? 'Generation stopped. The previous summary was kept.' : error instanceof Error ? error.message : 'Could not apply this proposal.' })
    throw error
  }
  const appliedAt = Date.now()
  await transitionChatMessageProposal(message.id, 'entityActions', item.id, ['applying'], { status: 'applied', appliedAt, error: undefined })
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('arc-entity-changed', { detail: { bookId: message.bookId, entityId } }))
  return { entityId, appliedAt }
}

import { updateBrainstormDraft, type ChatBrainstorm } from './chat-brainstorm'
import { normalizeChatRoundLimit, validateChatRoundLimit } from './chat-round-limit'
import { chatHistorySignature } from './chat-history-guard'
import type { NormalizedRequestPart } from './prompt-composition'
import { editProposalDraft, type EditableProposal, type EditableProposalField, type ProposalDraft } from './chat-proposal-draft'
import type { ChatImageProposal, ImageJob } from './image-generation-types'
import { loadAiSettings, type AiSettings } from './ai-settings'
import { clonePromptComposition, normalizePromptComposition, type PromptComposition } from './prompt-composition'
import { getCachedModelCatalog } from './model-catalog'
import { FAKE_PROVIDER_MODEL } from './fake-provider'
import { KeyedAsyncQueue } from './keyed-async-queue'
import { transitionProposalList } from './chat-proposal-transition'
import { snapshotProposalListForFork } from './chat-fork-proposals'
import {
  database,
  deleteEntityTree,
  getBookAiSettings,
  getBookContextSettings,
  getEntity,
  listEntitiesByBook,
  putEntity,
  updateEntityAtomically,
  type ArcEntity,
  type GenerationContextProfile,
} from './persistence'

export type ChatEntity = ArcEntity & {
  type: 'chat'
  bookId: string
  parentId: string
  title: string
  model: string
  modelContextLength?: number
  effectiveContextLimit: string
  promptComposition: PromptComposition
  thinking: boolean
  contextProfile: GenerationContextProfile
  lastMessagePreview?: string
  skillNoteIds?: string[]
  maxModelRounds?: number
}

export type ChatMessageStatus = 'complete' | 'stopped' | 'failed' | 'limited'
export type ChatContinuation = { baseHistoryIds: string[]; historySignature: string; runtimeParts: NormalizedRequestPart[]; maxRounds: number }
export type ChatCodexCreationStatus = 'proposed' | 'applying' | 'created' | 'rejected' | 'duplicate' | 'stale'
export type ChatCodexCreationProposal = ProposalDraft & {
  id: string
  title: string
  category: string
  content: string
  summary?: string
  status: ChatCodexCreationStatus
  createdAt: number
  appliedAt?: number
  entityId?: string
}
export type ChatEntityActionProposal = ProposalDraft & {
  id: string
  action: 'create_note' | 'rename' | 'delete' | 'set_codex_category' | 'update_metadata' | 'update_dependency' | 'update_triggers' | 'regenerate_summary'
  entityId?: string
  entityType: 'book' | 'note' | 'codexEntry' | 'act' | 'chapter' | 'scene'
  operation?: import('./chat-management-schema').ChatManagementOperation
  changes?: Array<{ field: string; before: string; after: string }>
  error?: string
  entityTitle: string
  newTitle?: string
  content?: string
  contentLength?: number
  previousCategory?: string
  category?: string
  expectedUpdatedAt?: number
  summary?: string
  status: 'proposed' | 'applying' | 'applied' | 'rejected' | 'stale'
  createdAt: number
  appliedAt?: number
}
export type ChatOutlineActionProposal = ProposalDraft & {
  id: string
  action: 'create' | 'rename' | 'move' | 'delete'
  entityId?: string
  entityType: 'act' | 'chapter' | 'scene'
  entityTitle: string
  newTitle?: string
  initialContent?: string
  expectedUpdatedAt?: number
  sourceParentId?: string
  sourceOrder?: number
  targetParentId?: string
  targetParentTitle?: string
  beforeId?: string
  beforeTitle?: string
  summary?: string
  status: 'proposed' | 'applying' | 'applied' | 'rejected' | 'stale'
  createdAt: number
  appliedAt?: number
}
export type ChatTextReplacement = { oldText: string; newText: string }
export type ChatDocumentEditProposal = ProposalDraft & {
  id: string
  entityId: string
  entityType: 'scene' | 'note' | 'codexEntry'
  entityTitle: string
  expectedUpdatedAt: number
  mode: 'text_replacements' | 'replace_document'
  edits?: ChatTextReplacement[]
  newContent?: string
  summary?: string
  status: 'proposed' | 'applying' | 'applied' | 'rejected' | 'stale'
  createdAt: number
  appliedAt?: number
}
export type ChatMessageEntity = ArcEntity & {
  type: 'chatMessage'
  bookId: string
  parentId: string
  order: number
  role: 'user' | 'assistant'
  content: string
  thoughts?: string
  status?: ChatMessageStatus
  responseId?: string
  toolActivity?: string[]
  roundNumber?: number
  continuation?: ChatContinuation
  continuedAt?: number
  imageGenerations?: ChatImageProposal[]
  brainstorms?: ChatBrainstorm[]
  documentEdits?: ChatDocumentEditProposal[]
  codexCreations?: ChatCodexCreationProposal[]
  outlineActions?: ChatOutlineActionProposal[]
  entityActions?: ChatEntityActionProposal[]
}

export type ChatModel = {
  id: string
  name?: string
  context_length?: number
}

const chatWriteQueue = new KeyedAsyncQueue()

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function notifyChatChange(bookId: string) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('arc-chat-changed', { detail: { bookId } }))
}

function copyProfile(profile: GenerationContextProfile): GenerationContextProfile {
  return {
    includeLastScene: profile.includeLastScene,
    includePreviousSceneWhenEmpty: profile.includePreviousSceneWhenEmpty,
    structuralIds: [...profile.structuralIds],
    noteIds: [...profile.noteIds],
    codexEntryIds: [...profile.codexEntryIds],
    summaryRange: profile.summaryRange,
  }
}

function profileForNewChat(profile: GenerationContextProfile) {
  const next = copyProfile(profile)
  const legacyUntouchedDefault = !next.includeLastScene
    && !next.includePreviousSceneWhenEmpty
    && !next.structuralIds.length
    && !next.noteIds.length
    && !next.codexEntryIds.length
    && next.summaryRange === 'none'
  if (legacyUntouchedDefault) next.includeLastScene = true
  return next
}

export async function listChats(bookId: string): Promise<ChatEntity[]> {
  const entities = await listEntitiesByBook(bookId)
  return entities
    .filter((entity): entity is ChatEntity => entity.type === 'chat')
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getChat(chatId: string): Promise<ChatEntity | undefined> {
  const entity = await getEntity<ArcEntity>(chatId)
  if (entity?.type !== 'chat') return undefined
  const chat = entity as ChatEntity
  const compositionNeedsNormalization = !chat.promptComposition || !Array.isArray(chat.promptComposition.predefinedMessages)
  const limitNeedsMigration = typeof chat.effectiveContextLimit !== 'string'
  const roundsNeedMigration = chat.maxModelRounds !== normalizeChatRoundLimit(chat.maxModelRounds)
  if (!compositionNeedsNormalization && !limitNeedsMigration && !roundsNeedMigration) return chat
  return chatWriteQueue.run(chatId, () => updateEntityAtomically<ChatEntity>(chatId, (current) => {
    if (current.type !== 'chat') throw new Error('Chat is no longer available.')
    const currentCompositionNeedsNormalization = !current.promptComposition || !Array.isArray(current.promptComposition.predefinedMessages)
    const currentLimitNeedsMigration = typeof current.effectiveContextLimit !== 'string'
    if (!currentCompositionNeedsNormalization && !currentLimitNeedsMigration && current.maxModelRounds === normalizeChatRoundLimit(current.maxModelRounds)) return current
    return {
      ...current,
      maxModelRounds: normalizeChatRoundLimit(current.maxModelRounds),
      promptComposition: normalizePromptComposition(current.promptComposition),
      effectiveContextLimit: currentLimitNeedsMigration ? '' : current.effectiveContextLimit,
    }
  }))
}

export async function createChat(bookId: string, title = 'New chat'): Promise<ChatEntity> {
  const defaults = loadAiSettings()
  const [settings, contextSettings] = await Promise.all([
    getBookAiSettings(bookId, defaults.favorites),
    getBookContextSettings(bookId),
  ])
  const now = Date.now()
  const chat: ChatEntity = {
    id: makeId('chat'),
    type: 'chat',
    bookId,
    parentId: bookId,
    title,
    model: settings.chatModel.trim() || settings.mainModel,
    modelContextLength: settings.chatModel.trim() ? settings.chatModelContextLength : settings.mainModelContextLength,
    effectiveContextLimit: settings.chatModel.trim() ? '' : settings.mainEffectiveContextLimit,
    promptComposition: clonePromptComposition(settings.promptCompositions.assistant),
    thinking: false,
    maxModelRounds: normalizeChatRoundLimit(defaults.chatMaxModelRounds),
    skillNoteIds: [],
    contextProfile: profileForNewChat(contextSettings.profiles.chat),
    createdAt: now,
    updatedAt: now,
  }
  await putEntity(chat)
  notifyChatChange(bookId)
  return chat
}

export async function updateChat(chatId: string, patch: Partial<Pick<ChatEntity, 'title' | 'model' | 'modelContextLength' | 'effectiveContextLimit' | 'promptComposition' | 'thinking' | 'contextProfile' | 'lastMessagePreview' | 'maxModelRounds' | 'skillNoteIds'>>): Promise<ChatEntity> {
  if (patch.maxModelRounds !== undefined) validateChatRoundLimit(patch.maxModelRounds)
  const patchSnapshot = {
    ...patch,
    ...(patch.skillNoteIds ? { skillNoteIds: [...new Set(patch.skillNoteIds)] } : {}),
    ...(patch.promptComposition ? { promptComposition: clonePromptComposition(patch.promptComposition) } : {}),
    ...(patch.contextProfile ? { contextProfile: copyProfile(patch.contextProfile) } : {}),
  }
  return chatWriteQueue.run(chatId, async () => {
    const next = await updateEntityAtomically<ChatEntity>(chatId, (current) => {
      if (current.type !== 'chat') throw new Error('Chat is no longer available.')
      return {
        ...current,
        ...patchSnapshot,
        contextProfile: patchSnapshot.contextProfile ? copyProfile(patchSnapshot.contextProfile) : current.contextProfile,
        updatedAt: Date.now(),
      }
    })
    notifyChatChange(next.bookId)
    return next
  })
}

export async function saveChatContextProfile(chatId: string, profile: GenerationContextProfile) {
  return updateChat(chatId, { contextProfile: copyProfile(profile) })
}

export async function resetChatPromptComposition(chatId: string) {
  const chat = await getChat(chatId)
  if (!chat) throw new Error('Chat is no longer available.')
  const settings = await getChatBookAiSettings(chat.bookId)
  return updateChat(chatId, { promptComposition: clonePromptComposition(settings.promptCompositions.assistant) })
}

export async function deleteChat(chatId: string) {
  const chat = await getChat(chatId)
  if (!chat) return
  await deleteEntityTree(chatId)
  notifyChatChange(chat.bookId)
}

export async function listChatMessages(bookId: string, chatId: string): Promise<ChatMessageEntity[]> {
  const entities = await listEntitiesByBook(bookId)
  return entities
    .filter((entity): entity is ChatMessageEntity => entity.type === 'chatMessage' && entity.parentId === chatId)
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
}

async function touchFromMessages(bookId: string, chatId: string, autoTitle?: string) {
  await chatWriteQueue.run(chatId, async () => {
    const messages = await listChatMessages(bookId, chatId)
    const last = messages[messages.length - 1]
    const preview = last?.content.trim().replace(/\s+/g, ' ').slice(0, 120) ?? ''
    const next = await updateEntityAtomically<ChatEntity>(chatId, (current) => {
      if (current.type !== 'chat' || current.bookId !== bookId) throw new Error('Chat is no longer available.')
      return {
        ...current,
        ...(autoTitle && current.title === 'New chat' ? { title: autoTitle } : {}),
        lastMessagePreview: preview,
        updatedAt: Date.now(),
      }
    })
    notifyChatChange(next.bookId)
  })
}

export async function createChatMessage(chat: ChatEntity, role: ChatMessageEntity['role'], content: string, extra: Pick<ChatMessageEntity, 'thoughts' | 'status' | 'responseId' | 'toolActivity' | 'roundNumber' | 'continuation' | 'continuedAt' | 'documentEdits' | 'codexCreations' | 'outlineActions' | 'entityActions' | 'imageGenerations' | 'brainstorms'> = {}): Promise<ChatMessageEntity> {
  const messages = await listChatMessages(chat.bookId, chat.id)
  const now = Date.now()
  const message: ChatMessageEntity = {
    id: makeId('chat-message'),
    type: 'chatMessage',
    bookId: chat.bookId,
    parentId: chat.id,
    order: messages.length ? Math.max(...messages.map((item) => item.order)) + 1 : 0,
    role,
    content,
    thoughts: extra.thoughts,
    status: extra.status ?? 'complete',
    responseId: extra.responseId,
    toolActivity: extra.toolActivity ? [...extra.toolActivity] : undefined,
    roundNumber: extra.roundNumber,
    continuation: extra.continuation ? structuredClone(extra.continuation) : undefined,
    continuedAt: extra.continuedAt,
    brainstorms: extra.brainstorms ? structuredClone(extra.brainstorms) : undefined,
    imageGenerations: extra.imageGenerations?.map((proposal) => ({ ...proposal })),
    documentEdits: extra.documentEdits?.map((proposal) => ({ ...proposal, edits: proposal.edits?.map((edit) => ({ ...edit })) })),
    codexCreations: extra.codexCreations?.map((proposal) => ({ ...proposal })),
    outlineActions: extra.outlineActions?.map((proposal) => ({ ...proposal })),
    entityActions: extra.entityActions?.map((proposal) => ({ ...proposal })),
    createdAt: now,
    updatedAt: now,
  }
  await putEntity(message)
  if (role === 'user' && chat.title === 'New chat') {
    const title = content.trim().replace(/\s+/g, ' ').slice(0, 54) || 'New chat'
    await touchFromMessages(chat.bookId, chat.id, title)
  } else {
    await touchFromMessages(chat.bookId, chat.id)
  }
  return message
}

export async function updateChatMessage(messageId: string, patch: Partial<Pick<ChatMessageEntity, 'content' | 'thoughts' | 'status' | 'responseId' | 'toolActivity' | 'roundNumber' | 'continuation' | 'continuedAt' | 'documentEdits' | 'codexCreations' | 'outlineActions' | 'entityActions' | 'imageGenerations' | 'brainstorms'>>): Promise<ChatMessageEntity> {
  const snapshot = structuredClone(patch)
  const next = await updateEntityAtomically<ChatMessageEntity>(messageId, current => {
    if (current.type !== 'chatMessage') throw new Error('Message is no longer available.')
    return { ...current, ...snapshot, updatedAt: Date.now() }
  })
  await touchFromMessages(next.bookId, next.parentId)
  return next
}

export async function saveChatBrainstormDraft(bookId: string, chatId: string, messageId: string, value: ChatBrainstorm) {
  const snapshot = structuredClone(value)
  let saved: ChatBrainstorm | undefined
  await updateEntityAtomically<ChatMessageEntity>(messageId, current => {
    if (current.type !== 'chatMessage' || current.bookId !== bookId || current.parentId !== chatId) throw new Error('The original chat is no longer available.')
    const original = current.brainstorms?.find(item => item.id === snapshot.id)
    if (!original) throw new Error('This brainstorm is no longer available.')
    saved = updateBrainstormDraft(original, snapshot)
    return { ...current, brainstorms: current.brainstorms!.map(item => item.id === saved!.id ? saved! : item), updatedAt: Date.now() }
  })
  notifyChatChange(bookId)
  return saved!
}

export async function markChatBrainstormSubmitted(bookId: string, chatId: string, messageId: string, brainstormId: string, text: string) {
  await updateEntityAtomically<ChatMessageEntity>(messageId, current => {
    if (current.type !== 'chatMessage' || current.bookId !== bookId || current.parentId !== chatId) throw new Error('The original chat is no longer available.')
    return { ...current, brainstorms: current.brainstorms?.map(item => item.id === brainstormId ? { ...item, submittedText: text } : item), updatedAt: Date.now() }
  })
}

export async function claimChatContinuation(bookId: string, chatId: string, messageId: string) {
  const db = await database()
  return db.transaction('rw', db.table('entities'), async () => {
    const message = await db.table('entities').get(messageId) as ChatMessageEntity | undefined
    if (!message || message.type !== 'chatMessage' || message.bookId !== bookId || message.parentId !== chatId || !message.continuation || message.continuedAt) throw new Error('This continuation is no longer available.')
    const history = (await listChatMessages(bookId, chatId))
    if (history.at(-1)?.id !== messageId || chatHistorySignature(history) !== message.continuation.historySignature) throw new Error('Chat history changed. Continue is available only from the unchanged latest response.')
    await db.table('entities').update(messageId, { continuedAt: Date.now() })
    return { history, continuation: structuredClone(message.continuation) }
  })
}

export async function saveChatProposalDraft(bookId: string, chatId: string, messageId: string, field: EditableProposalField, proposalId: string, values: Record<string, string>, expectedRevision: number) {
  const snapshot = structuredClone(values)
  const next = await updateEntityAtomically<ChatMessageEntity>(messageId, current => {
    if (current.type !== 'chatMessage' || current.bookId !== bookId || current.parentId !== chatId) throw new Error('The original chat is no longer available.')
    const proposals = current[field] as EditableProposal[] | undefined
    const selected = proposals?.find(proposal => proposal.id === proposalId)
    if (!selected) throw new Error('This proposal is no longer available.')
    const edited = editProposalDraft(field, selected, snapshot, expectedRevision)
    return { ...current, [field]: proposals!.map(proposal => proposal.id === proposalId ? edited : proposal), updatedAt: Date.now() }
  })
  notifyChatChange(bookId)
  return next
}

export type ChatProposalField = 'documentEdits' | 'codexCreations' | 'outlineActions' | 'entityActions' | 'imageGenerations'
type AnyChatProposal = ChatImageProposal | ChatDocumentEditProposal | ChatCodexCreationProposal | ChatOutlineActionProposal | ChatEntityActionProposal

export async function transitionChatMessageProposal(
  messageId: string,
  field: ChatProposalField,
  proposalId: string,
  allowedStatuses: readonly string[] | null,
  patch: Partial<AnyChatProposal>,
): Promise<{ message: ChatMessageEntity; proposal: AnyChatProposal; changed: boolean }> {
  let selected: AnyChatProposal | undefined
  let changed = false
  const next = await updateEntityAtomically<ChatMessageEntity>(messageId, (current) => {
    if (current.type !== 'chatMessage') throw new Error('Message is no longer available.')
    const proposals = (current[field] ?? []) as AnyChatProposal[]
    const result = transitionProposalList(proposals, proposalId, allowedStatuses, patch)
    selected = result.proposal
    changed = result.changed
    return result.changed
      ? { ...current, [field]: result.proposals, updatedAt: Date.now() } as ChatMessageEntity
      : current
  })
  if (!selected) throw new Error('That proposal is no longer available.')
  if (changed) await touchFromMessages(next.bookId, next.parentId)
  return { message: next, proposal: selected, changed }
}

export async function claimChatMessageProposal(messageId: string, field: ChatProposalField, proposalId: string) {
  const result = await transitionChatMessageProposal(messageId, field, proposalId, ['proposed'], { status: 'applying' })
  if (!result.changed) throw new Error(`This proposal is already ${result.proposal.status}.`)
  return result
}

export async function deleteMessageAndFollowing(bookId: string, chatId: string, order: number) {
  const messages = await listChatMessages(bookId, chatId)
  for (const message of messages.filter((item) => item.order >= order)) await deleteEntityTree(message.id)
  await touchFromMessages(bookId, chatId)
}

export async function forkChat(source: ChatEntity, throughOrder: number): Promise<ChatEntity> {
  const now = Date.now()
  const fork: ChatEntity = {
    ...source,
    id: makeId('chat'),
    title: `${source.title} — fork`,
    promptComposition: clonePromptComposition(source.promptComposition),
    contextProfile: copyProfile(source.contextProfile),
    lastMessagePreview: '',
    createdAt: now,
    updatedAt: now,
  }
  await putEntity(fork)
  const messages = (await listChatMessages(source.bookId, source.id)).filter((message) => message.order <= throughOrder)
  for (const message of messages) {
    const messageId = makeId('chat-message')
    await putEntity({
      ...message,
      id: messageId,
      parentId: fork.id,
      continuation: undefined, continuedAt: undefined,
      imageGenerations: message.imageGenerations?.map((p) => ({ ...p, status: 'stale' })),
      documentEdits: snapshotProposalListForFork(message.documentEdits),
      codexCreations: snapshotProposalListForFork(message.codexCreations),
      outlineActions: snapshotProposalListForFork(message.outlineActions),
      entityActions: snapshotProposalListForFork(message.entityActions),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    // Share kept originals, but never copy an active paid request into the fork.
    const db = await database()
    await db.transaction('rw', db.table('entities'), db.table('imageJobs'), db.table('galleryImages'), async () => {
      if (!await db.table('entities').get(messageId)) return
      const jobs: ImageJob[] = await db.table('imageJobs').where('messageId').equals(message.id).toArray()
      for (const job of jobs) {
        if (job.status !== 'completed' || job.decision !== 'kept' || job.hiddenInChat || !job.assetId || !(await db.table('galleryImages').get(job.assetId))?.kept) continue
        const { providerJobId: _p, owner: _o, heartbeat: _h, ...attachment } = job
        await db.table('imageJobs').add({ ...attachment, id: makeId('image-job'), chatId: fork.id, messageId })
      }
    })
  }
  await touchFromMessages(fork.bookId, fork.id)
  return (await getChat(fork.id)) ?? fork
}

export async function fetchAvailableChatModels(settings: AiSettings): Promise<ChatModel[]> {
  if (settings.provider === 'fake') return [{ ...FAKE_PROVIDER_MODEL }]
  if (!settings.apiKey.trim()) throw new Error('Add an API key in Book AI settings before loading chat models.')
  const cached = getCachedModelCatalog(settings)
  if (!cached) throw new Error('No cached model list. Open Book AI settings and use Reload model list first.')
  return cached.models.map((model) => ({
    id: model.id,
    name: model.name,
    context_length: Number.isFinite(model.context_length) ? model.context_length : undefined,
  }))
}

export async function getChatBookAiSettings(bookId: string) {
  const defaults = loadAiSettings()
  return getBookAiSettings(bookId, defaults.favorites)
}


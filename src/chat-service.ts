import { loadAiSettings, type AiSettings } from './ai-settings'
import {
  deleteEntityTree,
  getBookAiSettings,
  getBookContextSettings,
  getEntity,
  listEntitiesByBook,
  putEntity,
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
  systemPrompt: string
  thinking: boolean
  contextProfile: GenerationContextProfile
  lastMessagePreview?: string
}

export type ChatMessageStatus = 'complete' | 'stopped'
export type ChatCodexCreationStatus = 'proposed' | 'created' | 'rejected' | 'duplicate'
export type ChatCodexCreationProposal = {
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
export type ChatTextReplacement = { oldText: string; newText: string }
export type ChatDocumentEditProposal = {
  id: string
  entityId: string
  entityType: 'scene' | 'note' | 'codexEntry'
  entityTitle: string
  expectedUpdatedAt: number
  mode: 'text_replacements' | 'replace_document'
  edits?: ChatTextReplacement[]
  newContent?: string
  summary?: string
  status: 'proposed' | 'applied' | 'rejected' | 'stale'
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
  documentEdits?: ChatDocumentEditProposal[]
  codexCreations?: ChatCodexCreationProposal[]
}

export type ChatModel = {
  id: string
  name?: string
  context_length?: number
}

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
  return entity?.type === 'chat' ? entity as ChatEntity : undefined
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
    model: settings.mainModel,
    modelContextLength: settings.mainModelContextLength,
    systemPrompt: settings.prompts.assistant,
    thinking: false,
    contextProfile: profileForNewChat(contextSettings.profiles.chat),
    createdAt: now,
    updatedAt: now,
  }
  await putEntity(chat)
  notifyChatChange(bookId)
  return chat
}

export async function updateChat(chatId: string, patch: Partial<Pick<ChatEntity, 'title' | 'model' | 'modelContextLength' | 'systemPrompt' | 'thinking' | 'contextProfile' | 'lastMessagePreview'>>): Promise<ChatEntity> {
  const current = await getChat(chatId)
  if (!current) throw new Error('Chat is no longer available.')
  const next: ChatEntity = {
    ...current,
    ...patch,
    contextProfile: patch.contextProfile ? copyProfile(patch.contextProfile) : current.contextProfile,
    updatedAt: Date.now(),
  }
  await putEntity(next)
  notifyChatChange(next.bookId)
  return next
}

export async function saveChatContextProfile(chatId: string, profile: GenerationContextProfile) {
  return updateChat(chatId, { contextProfile: copyProfile(profile) })
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

async function touchFromMessages(bookId: string, chatId: string) {
  const messages = await listChatMessages(bookId, chatId)
  const last = messages[messages.length - 1]
  const preview = last?.content.trim().replace(/\s+/g, ' ').slice(0, 120) ?? ''
  const chat = await getChat(chatId)
  if (!chat) return
  await putEntity({ ...chat, lastMessagePreview: preview, updatedAt: Date.now() })
  notifyChatChange(bookId)
}

export async function createChatMessage(chat: ChatEntity, role: ChatMessageEntity['role'], content: string, extra: Pick<ChatMessageEntity, 'thoughts' | 'status' | 'documentEdits' | 'codexCreations'> = {}): Promise<ChatMessageEntity> {
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
    documentEdits: extra.documentEdits?.map((proposal) => ({ ...proposal, edits: proposal.edits?.map((edit) => ({ ...edit })) })),
    codexCreations: extra.codexCreations?.map((proposal) => ({ ...proposal })),
    createdAt: now,
    updatedAt: now,
  }
  await putEntity(message)
  if (role === 'user' && chat.title === 'New chat') {
    const title = content.trim().replace(/\s+/g, ' ').slice(0, 54) || 'New chat'
    await updateChat(chat.id, { title, lastMessagePreview: content.trim().replace(/\s+/g, ' ').slice(0, 120) })
  } else {
    await touchFromMessages(chat.bookId, chat.id)
  }
  return message
}

export async function updateChatMessage(messageId: string, patch: Partial<Pick<ChatMessageEntity, 'content' | 'thoughts' | 'status' | 'documentEdits' | 'codexCreations'>>): Promise<ChatMessageEntity> {
  const current = await getEntity<ArcEntity>(messageId)
  if (!current || current.type !== 'chatMessage') throw new Error('Message is no longer available.')
  const next = { ...current, ...patch, updatedAt: Date.now() } as ChatMessageEntity
  await putEntity(next)
  await touchFromMessages(next.bookId, next.parentId)
  return next
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
    contextProfile: copyProfile(source.contextProfile),
    lastMessagePreview: '',
    createdAt: now,
    updatedAt: now,
  }
  await putEntity(fork)
  const messages = (await listChatMessages(source.bookId, source.id)).filter((message) => message.order <= throughOrder)
  for (const message of messages) {
    await putEntity({
      ...message,
      id: makeId('chat-message'),
      parentId: fork.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  }
  await touchFromMessages(fork.bookId, fork.id)
  return (await getChat(fork.id)) ?? fork
}

function modelEndpoint(settings: AiSettings) {
  const base = settings.baseUrl.trim().replace(/\/$/, '')
  if (settings.provider === 'nanogpt') return `${base || 'https://nano-gpt.com/api/v1'}/models?detailed=true&sort=favorites`
  return `${base}/models`
}

export async function fetchAvailableChatModels(settings: AiSettings): Promise<ChatModel[]> {
  if (!settings.apiKey.trim()) throw new Error('Add an API key in Book AI settings before loading chat models.')
  const endpoint = modelEndpoint(settings)
  if (!endpoint || endpoint === '/models') throw new Error('Configure the provider endpoint in Book AI settings first.')
  const response = await fetch(endpoint, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${settings.apiKey.trim()}` },
  })
  const payload = await response.json().catch(() => ({})) as { data?: ChatModel[]; error?: { message?: string } | string; message?: string }
  if (!response.ok) {
    const reason = typeof payload.error === 'string' ? payload.error : payload.error?.message || payload.message
    throw new Error(reason || `Model list request failed (${response.status}).`)
  }
  return (Array.isArray(payload.data) ? payload.data : [])
    .filter((model) => typeof model.id === 'string' && model.id.length > 0)
    .map((model) => ({ id: model.id, name: model.name, context_length: Number.isFinite(model.context_length) ? model.context_length : undefined }))
}

export async function getChatBookAiSettings(bookId: string) {
  const defaults = loadAiSettings()
  return getBookAiSettings(bookId, defaults.favorites)
}

import type { ChatToolDefinition } from './chat-api'
import type { CharacterBoundary } from './character-chat'
import { database, type ArcEntity } from './persistence'
import type { ChatEntity, ChatMessageEntity } from './chat-service'
import { proseText } from './document-projection'
import { resolveImageSpec } from './image-settings'
import { imageId, listGalleryImages, notifyImageStore } from './image-store'
import type { GenerationSource, ImageJob } from './image-generation-types'

export function explicitlyRequestsImage(text: string) {
  const input = proseText(text).replace(/```[\s\S]*?```|`[^`]*`|"[^"]*"|“[^”]*”/g, '').trim().toLocaleLowerCase()
  if (/\bhow to\b/.test(input)) return false
  if (/\b(?:do not|don't|don’t|never|without|no)\b.{0,60}\b(?:image|picture|photo|portrait|illustration|selfie)s?\b/.test(input)) return false
  return /^(?:(?:please|can you|could you|would you|will you|i'd like you to|i’d like you to)\s+)*(?:generate|create|draw|paint|render|make|show|send|give)\b.{0,100}\b(?:image|picture|photo|portrait|illustration|selfie)\b/s.test(input) || /^i (?:want|would like|need) (?:an?|the) (?:image|picture|photo|portrait|illustration|selfie)\b/.test(input)
}
export const directImageTools: ChatToolDefinition[] = [{ type: 'function', function: { name: 'generate_requested_image', description: 'Generate one still image for the current explicit user image request, especially a character/roleplay photo. Uses only the configured still-image model/size and the user-selected reference images. Queues directly without a proposal; one job per user turn. Never use for an unsolicited suggestion or invent a model/size. No automatic paid retries.', parameters: { type: 'object', properties: { prompt: { type: 'string', description: 'Visual prompt using only allowed context and the current request.' } }, required: ['prompt'], additionalProperties: false } } }]
export async function queueRequestedImage(input: { chat: ChatEntity; userMessageId: string; userText: string; responseId: string; roundNumber: number; callId: string; prompt: string; boundary?: CharacterBoundary; signal?: AbortSignal }) {
  if (!explicitlyRequestsImage(input.userText)) throw new Error('Direct image generation requires an explicit image request in the current user turn.')
  if (!input.prompt.trim() || input.prompt.length > 16000) throw new Error('Provide a visual prompt of at most 16,000 characters.')
  const db = await database()
  // A durable claim survives job clearing/retries so this user turn cannot charge twice.
  const prior = await db.table('entities').get(input.userMessageId) as ChatMessageEntity | undefined
  if (!prior || prior.type !== 'chatMessage' || prior.role !== 'user' || prior.parentId !== input.chat.id || prior.bookId !== input.chat.bookId || prior.content !== input.userText) throw new Error('The originating user request changed or is unavailable.')
  input.signal?.throwIfAborted()
  if (prior.directImageClaim) return { ...prior.directImageClaim, reused: true }
  const selectedIds = [...new Set(input.chat.directImageReferenceIds ?? [])]
  const assets = selectedIds.length ? await listGalleryImages(input.chat.bookId) : []
  const sources: GenerationSource[] = selectedIds.map(id => {
    const asset = assets.find(asset => asset.id === id && asset.bookId === input.chat.bookId && asset.kind !== 'video')
    if (!asset) throw new Error('A selected image reference is unavailable. Update the chat’s image references.')
    const mime = asset.image.type
    if (mime !== 'image/png' && mime !== 'image/jpeg' && mime !== 'image/webp') throw new Error('Use a PNG, JPEG or WebP reference image.')
    return { id: asset.id, mime, data: asset.image, width: asset.width, height: asset.height }
  })
  const spec = resolveImageSpec(input.prompt, undefined, undefined, undefined, undefined, sources.length ? 'image-to-image' : 'text-to-image', sources)
  const result = await db.transaction('rw', db.table('entities'), db.table('imageJobs'), async () => {
    input.signal?.throwIfAborted()
    const chat = await db.table('entities').get(input.chat.id) as ChatEntity | undefined, book = await db.table('entities').get(input.chat.bookId)
    const user = await db.table('entities').get(input.userMessageId) as ChatMessageEntity | undefined
    const messages = await db.table('entities').where('parentId').equals(input.chat.id).toArray() as ArcEntity[]
    const latestUser = messages.filter(message => message.type === 'chatMessage' && message.role === 'user').sort((a, b) => Number(b.order) - Number(a.order))[0]
    if (!chat || book?.type !== 'book' || chat.bookId !== input.chat.bookId || user?.role !== 'user' || user.parentId !== chat.id || user.bookId !== chat.bookId || latestUser?.id !== user.id || user.content !== input.userText || !explicitlyRequestsImage(user.content)) throw new Error('The originating user request changed or is unavailable.')
    if (JSON.stringify(chat.character) !== JSON.stringify(input.chat.character) || JSON.stringify(chat.directImageReferenceIds ?? []) !== JSON.stringify(input.chat.directImageReferenceIds ?? [])) throw new Error('The chat’s boundary or image references changed. Send a new request.')
    if (user.directImageClaim) return { ...user.directImageClaim, reused: true }
    const now = Date.now(), messageId = imageId('chat-image-message'), jobId = imageId('image-job')
    const claim = { jobId, messageId, callId: input.callId }
    const message: ChatMessageEntity = { id: messageId, type: 'chatMessage', bookId: chat.bookId, parentId: chat.id, order: Math.max(-1, ...messages.map(message => Number(message.order ?? -1))) + 1, role: 'assistant', content: '', status: 'complete', responseId: input.responseId, roundNumber: input.roundNumber, toolActivity: ['generate_requested_image'], directImageRequest: claim, characterBoundary: input.boundary, createdAt: now, updatedAt: now }
    const job: ImageJob = { ...spec, id: jobId, bookId: chat.bookId, bookTitle: book.title, chatId: chat.id, messageId, directUserMessageId: user.id, submissionId: `direct-${user.id}`, status: 'queued', createdAt: now }
    input.signal?.throwIfAborted()
    await db.table('entities').add(message)
    await db.table('entities').update(user.id, { directImageClaim: claim })
    await db.table('imageJobs').add(job)
    return { ...claim, reused: false }
  })
  notifyImageStore()
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('arc-chat-changed', { detail: { bookId: input.chat.bookId } }))
  return result
}

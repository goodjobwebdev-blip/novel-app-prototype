export type ChatGenerationPhase = 'sending' | 'thinking' | 'using-tools' | 'writing' | 'stopping'

export type ChatGenerationOwner = {
  bookId: string
  chatId: string
  requestId: string
  controller: AbortController
  startedAt: number
  phase: ChatGenerationPhase
}

let generationSequence = 0

export function chatGenerationKey(bookId: string, chatId: string) {
  return `${bookId}\u0000${chatId}`
}

export function createChatGenerationOwner(bookId: string, chatId: string): ChatGenerationOwner {
  generationSequence += 1
  return {
    bookId,
    chatId,
    requestId: `chat-generation-${Date.now()}-${generationSequence}`,
    controller: new AbortController(),
    startedAt: Date.now(),
    phase: 'sending',
  }
}

export function getChatGenerationOwner(owners: Map<string, ChatGenerationOwner>, bookId: string, chatId: string) {
  return owners.get(chatGenerationKey(bookId, chatId))
}

export function registerChatGeneration(owners: Map<string, ChatGenerationOwner>, owner: ChatGenerationOwner) {
  const key = chatGenerationKey(owner.bookId, owner.chatId)
  if (owners.has(key)) return false
  owners.set(key, owner)
  return true
}

export function ownsChatGeneration(owners: Map<string, ChatGenerationOwner>, owner: ChatGenerationOwner) {
  const current = getChatGenerationOwner(owners, owner.bookId, owner.chatId)
  return current?.requestId === owner.requestId
}

export function setChatGenerationPhase(owners: Map<string, ChatGenerationOwner>, owner: ChatGenerationOwner, phase: ChatGenerationPhase) {
  if (!ownsChatGeneration(owners, owner)) return false
  owner.phase = phase
  return true
}

export function releaseChatGeneration(owners: Map<string, ChatGenerationOwner>, owner: ChatGenerationOwner) {
  if (!ownsChatGeneration(owners, owner)) return false
  owners.delete(chatGenerationKey(owner.bookId, owner.chatId))
  return true
}

export function abortChatGenerationsOutsideSelection(owners: Map<string, ChatGenerationOwner>, bookId: string, chatId: string) {
  for (const owner of owners.values()) {
    if (owner.bookId !== bookId || owner.chatId !== chatId) owner.controller.abort()
  }
}

export function abortAllChatGenerations(owners: Map<string, ChatGenerationOwner>) {
  for (const owner of owners.values()) owner.controller.abort()
}

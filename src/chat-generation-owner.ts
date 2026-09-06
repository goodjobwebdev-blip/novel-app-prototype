export type ChatGenerationPhase = 'sending' | 'thinking' | 'using-tools' | 'writing' | 'stopping'

export type ChatGenerationOwner = {
  requestId: number
  bookId: string
  chatId: string
  controller: AbortController
  phase: ChatGenerationPhase
}

export type ChatGenerationOwners = Map<string, ChatGenerationOwner>

let nextRequestId = 0

export function chatGenerationKey(bookId: string, chatId: string) {
  return `${bookId}\u0000${chatId}`
}

export function createChatGenerationOwner(bookId: string, chatId: string): ChatGenerationOwner {
  return {
    requestId: ++nextRequestId,
    bookId,
    chatId,
    controller: new AbortController(),
    phase: 'sending',
  }
}

export function getChatGenerationOwner(owners: ChatGenerationOwners, bookId: string, chatId: string) {
  return owners.get(chatGenerationKey(bookId, chatId))
}

export function ownsChatGeneration(owners: ChatGenerationOwners, owner: ChatGenerationOwner) {
  const current = getChatGenerationOwner(owners, owner.bookId, owner.chatId)
  return Boolean(current && current.requestId === owner.requestId && current.controller === owner.controller)
}

export function registerChatGeneration(owners: ChatGenerationOwners, owner: ChatGenerationOwner) {
  const key = chatGenerationKey(owner.bookId, owner.chatId)
  if (owners.has(key)) return false
  owners.set(key, owner)
  return true
}

export function setChatGenerationPhase(owners: ChatGenerationOwners, owner: ChatGenerationOwner, phase: ChatGenerationPhase) {
  if (!ownsChatGeneration(owners, owner)) return false
  owner.phase = phase
  return true
}

export function releaseChatGeneration(owners: ChatGenerationOwners, owner: ChatGenerationOwner) {
  if (!ownsChatGeneration(owners, owner)) return false
  owners.delete(chatGenerationKey(owner.bookId, owner.chatId))
  return true
}

export function abortChatGeneration(owners: ChatGenerationOwners, bookId: string, chatId: string) {
  const owner = getChatGenerationOwner(owners, bookId, chatId)
  if (!owner) return false
  setChatGenerationPhase(owners, owner, 'stopping')
  owner.controller.abort()
  return true
}

export function abortChatGenerationsOutsideSelection(owners: ChatGenerationOwners, bookId: string, chatId: string) {
  for (const owner of owners.values()) {
    if (owner.bookId === bookId && owner.chatId === chatId) continue
    setChatGenerationPhase(owners, owner, 'stopping')
    owner.controller.abort()
  }
}

export function abortAllChatGenerations(owners: ChatGenerationOwners) {
  for (const owner of owners.values()) {
    setChatGenerationPhase(owners, owner, 'stopping')
    owner.controller.abort()
  }
}

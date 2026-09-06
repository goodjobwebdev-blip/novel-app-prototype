export type ChatBookIdentity = {
  id: string
  bookId: string
}

export function chatMatchesBookSelection(
  chat: ChatBookIdentity | null | undefined,
  currentBookId: string | null | undefined,
  currentChatId: string | null | undefined,
) {
  return Boolean(chat && chat.bookId === currentBookId && chat.id === currentChatId)
}

export function reloadMatchesBookSelection(
  requestBookId: string,
  requestVersion: number,
  currentBookId: string,
  currentVersion: number,
) {
  return requestBookId === currentBookId && requestVersion === currentVersion
}

export function onlyChatsForBook<T extends { bookId: string }>(chats: T[], bookId: string) {
  return chats.filter((chat) => chat.bookId === bookId)
}

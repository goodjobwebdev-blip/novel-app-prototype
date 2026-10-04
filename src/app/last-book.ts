export type LastBookLocation = { bookId: string; screen: 'editor' | 'chat'; documentId?: string; chatId?: string }
export const LAST_BOOK_STORAGE_KEY = 'arc.last-book.v1'

export function loadLastBookLocation(): LastBookLocation | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(LAST_BOOK_STORAGE_KEY) ?? 'null') as Partial<LastBookLocation> | null
    if (!value || typeof value.bookId !== 'string' || !value.bookId || (value.screen !== 'editor' && value.screen !== 'chat')) return undefined
    if (value.screen === 'chat' && (typeof value.chatId !== 'string' || !value.chatId)) return undefined
    return { bookId: value.bookId, screen: value.screen, ...(typeof value.documentId === 'string' && value.documentId ? { documentId: value.documentId } : {}), ...(value.screen === 'chat' ? { chatId: value.chatId } : {}) }
  } catch { return undefined }
}

export function rememberLastBookLocation(location?: LastBookLocation) {
  try {
    if (location) localStorage.setItem(LAST_BOOK_STORAGE_KEY, JSON.stringify(location))
    else localStorage.removeItem(LAST_BOOK_STORAGE_KEY)
  } catch { /* Navigation remains available if the optional preference cannot be stored. */ }
}

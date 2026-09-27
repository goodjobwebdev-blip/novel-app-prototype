export const CHAT_LIST_PAGE_SIZE = 20

export function paginateChatList<T>(items: T[], requestedPage: number, pageSize = CHAT_LIST_PAGE_SIZE) {
  const safePageSize = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : CHAT_LIST_PAGE_SIZE
  const totalItems = items.length
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize))
  const page = Math.min(Math.max(1, Number.isInteger(requestedPage) ? requestedPage : 1), totalPages)
  const offset = (page - 1) * safePageSize
  return {
    items: items.slice(offset, offset + safePageSize),
    page,
    totalPages,
    totalItems,
    from: totalItems ? offset + 1 : 0,
    to: Math.min(offset + safePageSize, totalItems),
  }
}

export function chatListPageForIndex(index: number, pageSize = CHAT_LIST_PAGE_SIZE) {
  const safePageSize = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : CHAT_LIST_PAGE_SIZE
  return index < 0 ? 1 : Math.floor(index / safePageSize) + 1
}

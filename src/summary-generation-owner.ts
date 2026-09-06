export type SummaryGenerationOwner = {
  requestId: number
  bookId: string
  summaryId: string
}

export type SummaryGenerationUiState = {
  bookId: string | null
  documentId: string | null
  screen: 'home' | 'editor' | 'chat' | 'settings'
}

export function summaryGenerationOwnsUi(
  owner: SummaryGenerationOwner,
  currentOwner: SummaryGenerationOwner | null,
  state: SummaryGenerationUiState,
) {
  return Boolean(
    currentOwner
    && currentOwner.requestId === owner.requestId
    && currentOwner.bookId === owner.bookId
    && currentOwner.summaryId === owner.summaryId
    && state.bookId === owner.bookId
    && state.documentId === owner.summaryId
    && state.screen === 'editor',
  )
}

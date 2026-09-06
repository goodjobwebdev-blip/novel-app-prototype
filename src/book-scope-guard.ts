export class LatestAsyncIntent {
  private version = 0

  begin() {
    this.version += 1
    return this.version
  }

  invalidate() {
    this.version += 1
  }

  isCurrent(intent: number) {
    return intent === this.version
  }
}

export function bookScopeMatches(expectedBookId: string, currentBookId: string | null | undefined) {
  return currentBookId === expectedBookId
}

export function documentBelongsToBook(documentBookId: string | undefined, currentBookId: string | null | undefined) {
  return Boolean(currentBookId && documentBookId === currentBookId)
}

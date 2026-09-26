export type CodexDuplicateCandidate = {
  title?: unknown
  archivedAt?: unknown
}

function normalizedTitle(value: unknown) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

export function isActiveCodexTitleDuplicate(candidate: CodexDuplicateCandidate, title: string): boolean {
  const archived = typeof candidate.archivedAt === 'number' && candidate.archivedAt > 0
  return !archived && normalizedTitle(candidate.title) === normalizedTitle(title)
}

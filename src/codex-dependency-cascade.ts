import type { CodexDependencyEdge, CodexEntryEntity } from './persistence'

export type CascadedCodexDependency = {
  entry: CodexEntryEntity
  pathIds: string[]
}

function codexEntryArchived(entry: CodexEntryEntity) {
  return typeof entry.archivedAt === 'number' && entry.archivedAt > 0
}

function edgeOrder(a: CodexDependencyEdge, b: CodexDependencyEdge) {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id)
}

export function cascadeAutomaticCodexDependencies(
  directEntries: CodexEntryEntity[],
  allEntries: CodexEntryEntity[],
  edges: CodexDependencyEdge[],
  excludeEntryId?: string,
): CascadedCodexDependency[] {
  const available = new Map(allEntries
    .filter((entry) => !codexEntryArchived(entry) && entry.id !== excludeEntryId)
    .map((entry) => [entry.id, entry]))
  const outgoing = new Map<string, CodexDependencyEdge[]>()
  for (const edge of edges.filter((candidate) => candidate.includeWithSource).sort(edgeOrder)) {
    const list = outgoing.get(edge.sourceId) ?? []
    list.push(edge)
    outgoing.set(edge.sourceId, list)
  }

  const directIds = new Set(directEntries.map((entry) => entry.id))
  const visited = new Set(directIds)
  const queue: Array<{ edge: CodexDependencyEdge; pathIds: string[] }> = []
  for (const root of directEntries) {
    for (const edge of outgoing.get(root.id) ?? []) queue.push({ edge, pathIds: [root.id] })
  }

  const result: CascadedCodexDependency[] = []
  while (queue.length) {
    const next = queue.shift()!
    const target = available.get(next.edge.targetId)
    if (!target) continue
    if (visited.has(target.id)) continue
    visited.add(target.id)
    const pathIds = [...next.pathIds, target.id]
    result.push({ entry: target, pathIds })
    for (const edge of outgoing.get(target.id) ?? []) queue.push({ edge, pathIds })
  }
  return result
}

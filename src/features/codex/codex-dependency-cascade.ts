import type { CodexDependencyEdge, CodexEntryEntity } from '../../data/persistence'
import { automaticCodexCandidates } from './codex-trigger-service.ts'

export type CascadedCodexDependency = {
  entry: CodexEntryEntity
  pathIds: string[]
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
  const available = new Map(automaticCodexCandidates(allEntries)
    .filter((entry) => entry.id !== excludeEntryId)
    .map((entry) => [entry.id, entry]))
  const outgoing = new Map<string, CodexDependencyEdge[]>()
  for (const edge of edges.filter((candidate) => candidate.includeWithSource).sort(edgeOrder)) {
    const list = outgoing.get(edge.sourceId) ?? []
    list.push(edge)
    outgoing.set(edge.sourceId, list)
  }

  const eligibleRoots = directEntries.filter(entry => available.has(entry.id))
  const directIds = new Set(eligibleRoots.map((entry) => entry.id))
  const visited = new Set(directIds)
  const queue: Array<{ edge: CodexDependencyEdge; pathIds: string[] }> = []
  for (const root of eligibleRoots) {
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

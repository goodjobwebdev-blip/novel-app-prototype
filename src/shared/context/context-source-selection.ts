/** Resolve structural selections without changing their stored identities. */
export type ContextTreeItem = { id: string; parentId?: string; type: string; order?: number }
export function structuralSelectionIds(items: ContextTreeItem[], selected: string[]): Set<string> {
  const result = new Set(selected)
  for (const item of items) {
    const visited = new Set<string>()
    let parent = item.parentId
    while (parent && !visited.has(parent)) {
      if (selected.includes(parent)) { result.add(item.id); break }
      visited.add(parent)
      parent = items.find(candidate => candidate.id === parent)?.parentId
    }
  }
  return result
}
export function orderedContextScenes(items: ContextTreeItem[]): ContextTreeItem[] {
  const structural = items.filter(item => ['act', 'chapter', 'scene'].includes(item.type))
  const ids = new Set(structural.map(item => item.id))
  const result: ContextTreeItem[] = []
  const seen = new Set<string>()
  const visit = (item: ContextTreeItem) => {
    if (seen.has(item.id)) return
    seen.add(item.id)
    if (item.type === 'scene') result.push(item)
    structural.filter(child => child.parentId === item.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).forEach(visit)
  }
  structural.filter(item => !item.parentId || !ids.has(item.parentId)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).forEach(visit)
  return result
}

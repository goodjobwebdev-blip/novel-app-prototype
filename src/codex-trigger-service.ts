import type { ArcEntity, CodexEntryEntity, StructuralEntity } from './persistence'

export type CodexTriggerSceneMatch = {
  trigger: string
  sceneId: string
  sceneTitle: string
}

export type AutomaticCodexMatch = {
  entry: CodexEntryEntity
  matches: CodexTriggerSceneMatch[]
}

export type CodexMentionEntry = {
  id: string
  title: string
  category: string
  trigger: string
}

export type CodexMentionTerm = {
  key: string
  text: string
  entries: CodexMentionEntry[]
}

export type TriggerRange = { from: number; to: number }

export function normalizeCodexTrigger(value: string) {
  return value.trim().replace(/\s+/gu, ' ')
}

function triggerKey(value: string) {
  return normalizeCodexTrigger(value).toLocaleLowerCase()
}

export function normalizeCodexTriggerList(values: string[]) {
  const seen = new Set<string>()
  const result: string[] = []
  values.forEach((value) => {
    if (typeof value !== 'string') return
    const normalized = normalizeCodexTrigger(value)
    if (!normalized) return
    const key = triggerKey(normalized)
    if (seen.has(key)) return
    seen.add(key)
    result.push(normalized)
  })
  return result
}

function entryTriggers(entry: CodexEntryEntity) {
  const value: unknown = entry.autoIncludeTriggers
  return normalizeCodexTriggerList(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])
}

function archived(entry: CodexEntryEntity) {
  return typeof entry.archivedAt === 'number' && entry.archivedAt > 0
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function lexical(character: string | undefined) {
  return Boolean(character && /[\p{L}\p{N}_]/u.test(character))
}

export function findTriggerRanges(text: string, trigger: string): TriggerRange[] {
  const normalized = normalizeCodexTrigger(trigger)
  if (!normalized || !text) return []
  const pattern = normalized.split(' ').map(escapeRegex).join('\\s+')
  let regex: RegExp
  try { regex = new RegExp(pattern, 'giu') } catch { return [] }
  const tagLike = /^[#@]/u.test(normalized)
  const needsLeftBoundary = !tagLike && lexical(normalized[0])
  const needsRightBoundary = !tagLike && lexical(normalized[normalized.length - 1])
  const result: TriggerRange[] = []
  for (const match of text.matchAll(regex)) {
    const from = match.index ?? -1
    if (from < 0) continue
    const to = from + match[0].length
    if (needsLeftBoundary && lexical(text[from - 1])) continue
    if (needsRightBoundary && lexical(text[to])) continue
    result.push({ from, to })
  }
  return result
}

export function triggerMatchesText(text: string, trigger: string) {
  return findTriggerRanges(text, trigger).length > 0
}

export function buildCodexMentionIndex(entities: ArcEntity[]): CodexMentionTerm[] {
  const byKey = new Map<string, CodexMentionTerm>()
  entities
    .filter((entity): entity is CodexEntryEntity => entity.type === 'codexEntry')
    .filter((entry) => !archived(entry))
    .forEach((entry) => {
      entryTriggers(entry).forEach((trigger) => {
        const key = triggerKey(trigger)
        const existing = byKey.get(key) ?? { key, text: trigger, entries: [] }
        if (!existing.entries.some((candidate) => candidate.id === entry.id)) {
          existing.entries.push({ id: entry.id, title: entry.title, category: entry.category, trigger })
        }
        byKey.set(key, existing)
      })
    })
  return [...byKey.values()]
    .map((term) => ({ ...term, entries: [...term.entries].sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id)) }))
    .sort((a, b) => b.text.length - a.text.length || a.text.localeCompare(b.text))
}

export function automaticCodexMatches({
  entities,
  scenes,
  anchorSceneId,
  anchorSceneText,
  previousSceneCount,
  excludeEntryId,
}: {
  entities: ArcEntity[]
  scenes: StructuralEntity[]
  anchorSceneId?: string
  anchorSceneText?: string
  previousSceneCount: number
  excludeEntryId?: string
}): AutomaticCodexMatch[] {
  if (!anchorSceneId) return []
  const anchorIndex = scenes.findIndex((scene) => scene.id === anchorSceneId)
  if (anchorIndex < 0) return []
  const count = Math.max(0, Math.floor(previousSceneCount))
  const scanned = scenes.slice(Math.max(0, anchorIndex - count), anchorIndex + 1).map((scene) => ({
    scene,
    text: scene.id === anchorSceneId && anchorSceneText !== undefined ? anchorSceneText : String(scene.content ?? ''),
  }))
  const activeEntries = entities
    .filter((entity): entity is CodexEntryEntity => entity.type === 'codexEntry')
    .filter((entity) => entity.id !== excludeEntryId && !archived(entity) && entryTriggers(entity).length > 0)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))

  return activeEntries.map((entry) => {
    const matches: CodexTriggerSceneMatch[] = []
    for (const trigger of entryTriggers(entry)) {
      for (const { scene, text } of scanned) {
        if (triggerMatchesText(text, trigger)) matches.push({ trigger, sceneId: scene.id, sceneTitle: scene.title })
      }
    }
    return { entry, matches }
  }).filter((match) => match.matches.length > 0)
}

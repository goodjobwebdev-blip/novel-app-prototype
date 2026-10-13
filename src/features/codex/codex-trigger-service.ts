import type { ArcEntity, CodexEntryEntity, StructuralEntity } from '../../data/persistence'

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

export function codexTriggerKey(value: string) {
  return normalizeCodexTrigger(value).toLocaleLowerCase()
}

export function normalizeCodexTriggerList(values: string[]) {
  const seen = new Set<string>()
  const result: string[] = []
  values.forEach((value) => {
    if (typeof value !== 'string') return
    const normalized = normalizeCodexTrigger(value)
    if (!normalized) return
    const key = codexTriggerKey(normalized)
    if (seen.has(key)) return
    seen.add(key)
    result.push(normalized)
  })
  return result
}

const nameHonorific = /^(?:mr|mister|mrs|missus|ms|miss|mx|dr|doctor|prof|professor|sir|dame|lady|lord|rev|reverend|fr|father|st|saint|capt|captain)\.?$/iu

export function codexTitleTriggerSuggestions(title: string, current: string[] = []): string[] {
  const full = normalizeCodexTrigger(title)
  if (!full || /^untitled entry(?: \d+)?$/iu.test(full)) return []
  const words = full.split(' ')
  // Honorifics are useful with a name, but much too broad as standalone triggers.
  while (words.length && nameHonorific.test(words[0])) words.shift()
  if (!words.length) return []
  const name = words.join(' ')
  const parts = words.filter(word => /[\p{L}\p{N}]/u.test(word) && !nameHonorific.test(word))
  const existing = new Set(current.map(codexTriggerKey))
  return normalizeCodexTriggerList([...parts, name, full]).filter(value => !existing.has(codexTriggerKey(value)))
}

function entryTriggers(entry: CodexEntryEntity) {
  const value: unknown = entry.autoIncludeTriggers
  return normalizeCodexTriggerList(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])
}

export function codexEntryActiveForAutomatic(entry: CodexEntryEntity) {
  return !entry.hiddenInBook && entry.codexStatus !== 'draft' && !(typeof entry.archivedAt === 'number' && entry.archivedAt > 0)
}

export type CodexTriggerConflict = { entryId: string; title: string; trigger: string }

/** Compare across scopes; owner-level trigger uniqueness is enforced by persistence. */
export function conflictingCodexTriggers(entry: CodexEntryEntity, candidates: CodexEntryEntity[]): CodexTriggerConflict[] {
  const keys = new Set(entryTriggers(entry).map(codexTriggerKey))
  return candidates.filter(candidate => candidate.id !== entry.id).flatMap(candidate =>
    entryTriggers(candidate).filter(trigger => keys.has(codexTriggerKey(trigger))).map(trigger => ({ entryId: candidate.id, title: candidate.title, trigger })),
  )
}

/** Any shared trigger reserves the entire World entry for the active local entry. */
export function automaticCodexCandidates(entries: CodexEntryEntity[]): CodexEntryEntity[] {
  const active = entries.filter(codexEntryActiveForAutomatic)
  const localKeys = new Set(active.filter(entry => !entry.worldId).flatMap(entry => entryTriggers(entry).map(codexTriggerKey)))
  return active.filter(entry => !entry.worldId || !entryTriggers(entry).some(trigger => localKeys.has(codexTriggerKey(trigger))))
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
    .filter(codexEntryActiveForAutomatic)
    .forEach((entry) => {
      normalizeCodexTriggerList([entry.title, ...entryTriggers(entry)]).forEach((trigger) => {
        const key = codexTriggerKey(trigger)
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
  const activeEntries = automaticCodexCandidates(entities
    .filter((entity): entity is CodexEntryEntity => entity.type === 'codexEntry'))
    .filter((entity) => entity.id !== excludeEntryId && entryTriggers(entity).length > 0)
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

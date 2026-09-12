import { proseText } from './document-projection.ts'
import type { ArcEntity } from './persistence'

export const searchableTypes = ['scene', 'note', 'codexEntry', 'chapter', 'act'] as const

export function searchBookEntities(entities: ArcEntity[], args: Record<string, unknown>, listing = false) {
  const query = typeof args.query === 'string' ? args.query.trim().toLocaleLowerCase() : ''
  if (!listing && !query) throw new Error('Search query is empty. Use list_entities to browse without a query.')
  const types = args.types === undefined ? null : args.types
  if (types !== null && (!Array.isArray(types) || types.some((type) => !searchableTypes.includes(type)))) throw new Error('Invalid entity types.')
  const offset = args.offset === undefined ? 0 : args.offset
  const limit = args.limit === undefined ? 12 : args.limit
  if (!Number.isInteger(offset) || Number(offset) < 0 || !Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 50) throw new Error('offset must be a nonnegative integer; limit must be 1–50.')
  if (args.include_archived !== undefined && typeof args.include_archived !== 'boolean') throw new Error('include_archived must be a boolean.')
  const matches = entities.filter((entity) =>
    searchableTypes.includes(entity.type as typeof searchableTypes[number])
    && (args.include_archived === true || !(entity.type === 'codexEntry' && Number(entity.archivedAt) > 0))
    && (!Array.isArray(types) || !types.length || types.includes(entity.type))
    && (args.parent_id === undefined || entity.parentId === args.parent_id)
    && (!query || `${entity.title ?? ''} ${entity.category ?? ''} ${proseText(String(entity.content ?? ''))}`.toLocaleLowerCase().includes(query)),
  ).sort((a, b) => String(a.title ?? '').localeCompare(String(b.title ?? '')) || a.id.localeCompare(b.id))
  const results = matches.slice(Number(offset), Number(offset) + Number(limit)).map((entity) => {
    const body = proseText(String(entity.content ?? '')).replace(/\s+/g, ' ')
    const hit = query ? body.toLocaleLowerCase().indexOf(query) : -1
    const start = Math.max(0, hit - 100)
    return {
      id: entity.id, type: entity.type, title: String(entity.title ?? 'Untitled'), parentId: entity.parentId,
      category: entity.category, updatedAt: entity.updatedAt, archived: Number(entity.archivedAt) > 0,
      preview: `${start ? '…' : ''}${body.slice(start, start + 320)}${body.length > start + 320 ? '…' : ''}`,
    }
  })
  const next = Number(offset) + results.length
  return { ok: true, results, total: matches.length, offset, next_offset: next < matches.length ? next : null }
}

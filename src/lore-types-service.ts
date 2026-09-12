import { database, type ArcEntity, type CodexEntryEntity } from './persistence'
import { seriesTransaction } from './series-codex'
import { ensureLoreTypesWithDb, loreTypeNameKey, resolveLoreType, storedLoreTypes, type LoreType } from './lore-types'
function notify() { if (typeof window !== 'undefined') { window.dispatchEvent(new Event('arc-lore-types-changed')); window.dispatchEvent(new Event('arc-series-codex-changed')) } }
export async function getEffectiveLoreTypes(ownerId: string) {
  const db = await database()
  return seriesTransaction(db, () => ensureLoreTypesWithDb(db, ownerId))
}
export async function requireLoreType(ownerId: string, value: string) {
  const type = resolveLoreType(await getEffectiveLoreTypes(ownerId), value)
  if (!type) throw new Error('This lore type is unavailable. Choose a current type from this book or series.')
  return type
}
async function validateTypeName(db: Awaited<ReturnType<typeof database>>, owner: ArcEntity, name: string, exceptId?: string) {
  if (!name.trim() || name.trim().length > 80) throw new Error('Enter a lore type name of 1–80 characters.')
  const scopes = owner.type === 'series' ? [owner.id, ...(await db.table('entities').where('type').equals('book').toArray() as ArcEntity[]).filter(book => book.seriesId === owner.id).map(book => book.id)] : [owner.id]
  for (const id of scopes) if ((await ensureLoreTypesWithDb(db, id)).some(type => type.id !== exceptId && loreTypeNameKey(type.name) === loreTypeNameKey(name))) throw new Error('This name already exists in the effective book or series registry.')
}
export async function createLoreType(ownerId: string, name: string) {
  const db = await database()
  const type = await seriesTransaction(db, async () => {
    await ensureLoreTypesWithDb(db, ownerId)
    const owner = await db.table('entities').get(ownerId) as ArcEntity | undefined
    if (!owner || !['book', 'series'].includes(owner.type)) throw new Error('This book or series is unavailable.')
    await validateTypeName(db, owner, name)
    const types = storedLoreTypes(owner)
    const type: LoreType = { id: `lore-${crypto.randomUUID()}`, name: name.trim(), order: Math.max(-1, ...types.map(item => item.order)) + 1, ownerId }
    await db.table('entities').update(ownerId, { loreTypes: [...types, type] }); return type
  }); notify(); return type
}
export async function renameLoreType(ownerId: string, typeId: string, name: string) {
  const db = await database()
  await seriesTransaction(db, async () => {
    await ensureLoreTypesWithDb(db, ownerId)
    const owner = await db.table('entities').get(ownerId) as ArcEntity
    const type = storedLoreTypes(owner).find(item => item.id === typeId)
    if (!type || type.builtin) throw new Error('Only custom types in this scope can be renamed.')
    await validateTypeName(db, owner, name, typeId)
    await db.table('entities').update(ownerId, { loreTypes: storedLoreTypes(owner).map(item => item.id === typeId ? { ...item, name: name.trim() } : item) })
    const entries = await db.table('entities').where('type').equals('codexEntry').toArray() as CodexEntryEntity[]
    const memberIds = owner.type === 'series' ? (await db.table('entities').where('type').equals('book').toArray() as ArcEntity[]).filter(book => book.seriesId === ownerId).map(book => book.id) : []
    for (const entry of entries.filter(item => item.typeId === typeId && (item.bookId === ownerId || memberIds.includes(item.bookId)))) {
      const revision = Math.max(Date.now(), entry.updatedAt + 1, (entry.sourceRevision ?? 0) + 1)
      await db.table('entities').update(entry.id, { category: name.trim(), updatedAt: revision, sourceRevision: revision })
    }
  }); notify()
}
export async function moveLoreType(ownerId: string, typeId: string, delta: -1 | 1) {
  const db = await database()
  await seriesTransaction(db, async () => {
    await ensureLoreTypesWithDb(db, ownerId)
    const owner = await db.table('entities').get(ownerId) as ArcEntity
    const all = storedLoreTypes(owner), inheritedBook = owner.type === 'book' && Boolean(owner.seriesId)
    const types = inheritedBook ? all.filter(type => !type.builtin) : all, index = types.findIndex(type => type.id === typeId), target = index + delta
    if (index < 0 || target < 0 || target >= types.length) return
    ;[types[index], types[target]] = [types[target], types[index]]
    await db.table('entities').update(ownerId, { loreTypes: [...(inheritedBook ? all.filter(type => type.builtin) : []), ...types.map((type, order) => ({ ...type, order: order + (inheritedBook ? 6 : 0) }))] })
  }); notify()
}
async function usageWithDb(db: Awaited<ReturnType<typeof database>>, ownerId: string, typeId: string) {
  const owner = await db.table('entities').get(ownerId) as ArcEntity | undefined
  if (!owner || !['book', 'series'].includes(owner.type)) throw new Error('This registry is unavailable.')
  const members = owner.type === 'series' ? (await db.table('entities').where('type').equals('book').toArray() as ArcEntity[]).filter(book => book.seriesId === owner.id) : []
  const scopes = new Set([ownerId, ...members.map(book => book.id)])
  const affected = (await db.table('entities').toArray() as ArcEntity[]).filter(entity => entity.bookId && scopes.has(entity.bookId) && ((entity.type === 'codexEntry' && entity.typeId === typeId) || (entity.type === 'note' && Array.isArray(entity.compatibleLoreTypeIds) && entity.compatibleLoreTypeIds.includes(typeId))))
  const entries = affected.filter(entity => entity.type === 'codexEntry'), templates = affected.filter(entity => entity.type === 'note')
  return { owner, entries, templates, token: JSON.stringify(affected.map(entity => [entity.id, entity.updatedAt, entity.typeId, entity.compatibleLoreTypeIds]).sort((a,b) => String(a[0]).localeCompare(String(b[0])))), scope: owner.type === 'series' ? `${owner.title} series · ${members.length} books` : `${owner.title} book` }
}
export async function loreTypeUsage(ownerId: string, typeId: string) {
  const db = await database(); await getEffectiveLoreTypes(ownerId)
  return usageWithDb(db, ownerId, typeId)
}
export async function retireLoreType(ownerId: string, typeId: string, replacementId: string, expectedToken: string) {
  const db = await database()
  await seriesTransaction(db, async () => {
    const types = await ensureLoreTypesWithDb(db, ownerId), usage = await usageWithDb(db, ownerId, typeId)
    const own = storedLoreTypes(usage.owner), type = own.find(item => item.id === typeId), replacement = types.find(item => item.id === replacementId && item.id !== typeId)
    if (!type || type.builtin) throw new Error('Built-in lore types cannot be retired.')
    if (!replacement) throw new Error('Choose an available replacement type in this scope.')
    if (usage.token !== expectedToken) throw new Error('Affected entries or templates changed. Review the reassignment count again.')
    for (const entry of usage.entries) await db.table('entities').update(entry.id, { typeId: replacement.id, category: replacement.name, updatedAt: Date.now(), sourceRevision: Date.now() })
    for (const note of usage.templates) await db.table('entities').update(note.id, { compatibleLoreTypeIds: [...new Set((note.compatibleLoreTypeIds as string[]).map(id => id === typeId ? replacement.id : id))], updatedAt: Date.now() })
    await db.table('entities').update(ownerId, { loreTypes: own.filter(item => item.id !== typeId) })
  }); notify()
}

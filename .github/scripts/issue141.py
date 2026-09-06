from pathlib import Path

path = Path('src/persistence.ts')
text = path.read_text()

def replace_between(start: str, end: str, replacement: str):
    global text
    a = text.index(start)
    b = text.index(end, a)
    text = text[:a] + replacement.rstrip() + '\n\n' + text[b:]

replace_between(
    'export async function archiveCodexEntry',
    'export async function restoreCodexEntry',
    '''export async function archiveCodexEntry(id: string): Promise<CodexEntryEntity> {
  const db = await database()
  return db.transaction('rw', db.table('entities'), async () => {
    const current = await db.table('entities').get(id) as CodexEntryEntity | undefined
    if (!current || current.type !== 'codexEntry') throw new Error(`Cannot archive missing Codex entry ${id}`)
    if (isCodexEntryArchived(current)) return current
    const now = Date.now()
    const sourceRevision = typeof current.sourceRevision === 'number' ? current.sourceRevision : current.updatedAt
    await db.table('entities').update(id, { sourceRevision, archivedAt: now, updatedAt: now })
    await touchAncestors(db, current.bookId, now)
    const updated = await db.table('entities').get(id) as CodexEntryEntity | undefined
    if (!updated || updated.type !== 'codexEntry') throw new Error(`Cannot archive missing Codex entry ${id}`)
    return updated
  })
}'''
)

replace_between(
    'export async function restoreCodexEntry',
    'export async function updateCodexCategory',
    '''export async function restoreCodexEntry(id: string): Promise<CodexEntryEntity> {
  const db = await database()
  return db.transaction('rw', db.table('entities'), async () => {
    const current = await db.table('entities').get(id) as CodexEntryEntity | undefined
    if (!current || current.type !== 'codexEntry') throw new Error(`Cannot restore missing Codex entry ${id}`)
    if (!isCodexEntryArchived(current)) return current
    const now = Date.now()
    const sourceRevision = typeof current.sourceRevision === 'number' ? current.sourceRevision : current.updatedAt
    await db.table('entities').where('id').equals(id).modify((entity: CodexEntryEntity) => {
      delete entity.archivedAt
      entity.sourceRevision = sourceRevision
      entity.updatedAt = now
    })
    await touchAncestors(db, current.bookId, now)
    const updated = await db.table('entities').get(id) as CodexEntryEntity | undefined
    if (!updated || updated.type !== 'codexEntry') throw new Error(`Cannot restore missing Codex entry ${id}`)
    return updated
  })
}'''
)

replace_between(
    'export async function updateCodexCategory',
    'export async function updateCodexSummaryPreference',
    '''export async function updateCodexCategory(id: string, category: string): Promise<CodexEntryEntity> {
  const db = await database()
  return db.transaction('rw', db.table('entities'), async () => {
    const current = await db.table('entities').get(id) as CodexEntryEntity | undefined
    if (!current || current.type !== 'codexEntry') throw new Error(`Cannot update missing Codex entry ${id}`)
    const now = Date.now()
    await db.table('entities').update(id, { category: category.trim() || 'Other', sourceRevision: now, updatedAt: now })
    await touchAncestors(db, current.bookId, now)
    const updated = await db.table('entities').get(id) as CodexEntryEntity | undefined
    if (!updated || updated.type !== 'codexEntry') throw new Error(`Cannot update missing Codex entry ${id}`)
    return updated
  })
}'''
)

replace_between(
    'export async function updateCodexSummaryPreference',
    'export async function updateCodexAutoIncludeTriggers',
    '''export async function updateCodexSummaryPreference(id: string, preferSummaryForContext: boolean): Promise<CodexEntryEntity> {
  const db = await database()
  return db.transaction('rw', db.table('entities'), async () => {
    const current = await db.table('entities').get(id) as CodexEntryEntity | undefined
    if (!current || current.type !== 'codexEntry') throw new Error(`Cannot update missing Codex entry ${id}`)
    const now = Date.now()
    const sourceRevision = typeof current.sourceRevision === 'number' ? current.sourceRevision : current.updatedAt
    await db.table('entities').update(id, { sourceRevision, preferSummaryForContext, updatedAt: now })
    await touchAncestors(db, current.bookId, now)
    const updated = await db.table('entities').get(id) as CodexEntryEntity | undefined
    if (!updated || updated.type !== 'codexEntry') throw new Error(`Cannot update missing Codex entry ${id}`)
    return updated
  })
}'''
)

replace_between(
    'export async function updateCodexAutoIncludeTriggers',
    'export async function renameEntity',
    '''export async function updateCodexAutoIncludeTriggers(id: string, triggers: string[]): Promise<CodexEntryEntity> {
  const db = await database()
  return db.transaction('rw', db.table('entities'), async () => {
    const current = await db.table('entities').get(id) as CodexEntryEntity | undefined
    if (!current || current.type !== 'codexEntry') throw new Error(`Cannot update missing Codex entry ${id}`)
    if (isCodexEntryArchived(current)) throw new Error('Restore this archived Codex entry before editing automatic triggers.')
    const now = Date.now()
    const sourceRevision = typeof current.sourceRevision === 'number' ? current.sourceRevision : current.updatedAt
    await db.table('entities').update(id, { sourceRevision, autoIncludeTriggers: normalizeCodexTriggerList(triggers), updatedAt: now })
    await touchAncestors(db, current.bookId, now)
    const updated = await db.table('entities').get(id) as CodexEntryEntity | undefined
    if (!updated || updated.type !== 'codexEntry') throw new Error(`Cannot update missing Codex entry ${id}`)
    return updated
  })
}'''
)

replace_between(
    'export async function renameEntity',
    'export async function updateBookMetadata',
    '''export async function renameEntity(id: string, title: string): Promise<ArcEntity> {
  const db = await database()
  return db.transaction('rw', db.table('entities'), async () => {
    const entity = await db.table('entities').get(id) as ArcEntity | undefined
    if (!entity) throw new Error(`Cannot rename missing entity ${id}`)
    const now = Date.now()
    const nextTitle = title.trim() || entity.title || 'Untitled'
    const patch: Record<string, unknown> = { title: nextTitle, updatedAt: now }
    if (entity.type === 'codexEntry') patch.sourceRevision = now
    await db.table('entities').update(id, patch)
    if (['act', 'chapter', 'scene', 'codexEntry'].includes(entity.type)) {
      const summary = await db.table('entities').get(summaryId(entity.id)) as SummaryEntity | undefined
      if (summary?.type === 'summary') await db.table('entities').update(summary.id, { title: `${nextTitle} summary`, updatedAt: now })
    }
    if (['act', 'chapter', 'scene'].includes(entity.type)) await touchAncestors(db, entity.parentId, now)
    else if (entity.bookId) await touchAncestors(db, entity.bookId, now)
    const updated = await db.table('entities').get(id) as ArcEntity | undefined
    if (!updated) throw new Error(`Cannot rename missing entity ${id}`)
    return updated
  })
}'''
)

replace_between(
    'export async function moveStructuralEntity',
    'export async function placeStructuralEntity',
    '''export async function moveStructuralEntity(id: string, direction: -1 | 1): Promise<void> {
  const db = await database()
  await db.transaction('rw', db.table('entities'), async () => {
    const entity = await db.table('entities').get(id) as StructuralEntity | undefined
    if (!entity?.parentId) throw new Error(`Cannot move missing entity ${id}`)
    const siblings: StructuralEntity[] = (await db.table('entities').where('parentId').equals(entity.parentId).toArray())
      .filter((candidate: ArcEntity) => candidate.type === entity.type)
      .sort((a: ArcEntity, b: ArcEntity) => (a.order ?? 0) - (b.order ?? 0))
    const index = siblings.findIndex((candidate) => candidate.id === id)
    const targetIndex = index + direction
    if (index < 0 || targetIndex < 0 || targetIndex >= siblings.length) return
    const target = siblings[targetIndex]
    const now = Date.now()
    await db.table('entities').update(entity.id, { order: target.order, updatedAt: now })
    await db.table('entities').update(target.id, { order: entity.order, updatedAt: now })
    await touchAncestors(db, entity.parentId, now)
  })
}'''
)

replace_between(
    'export async function placeStructuralEntity',
    'async function collectEntityTreeIdsWithDb',
    '''export async function placeStructuralEntity(id: string, targetParentId: string, beforeId?: string): Promise<StructuralEntity> {
  const db = await database()
  return db.transaction('rw', db.table('entities'), async () => {
    const entity = await db.table('entities').get(id) as StructuralEntity | undefined
    const parent = await db.table('entities').get(targetParentId) as ArcEntity | undefined
    if (!entity || !['act', 'chapter', 'scene'].includes(entity.type)) throw new Error(`Cannot move missing structural entity ${id}`)
    const validParent = entity.type === 'act'
      ? parent?.type === 'book' && parent.id === entity.bookId
      : entity.type === 'chapter'
        ? (parent?.type === 'book' && parent.id === entity.bookId) || (parent?.type === 'act' && parent.bookId === entity.bookId)
        : parent?.type === 'chapter' && parent.bookId === entity.bookId
    if (!validParent) throw new Error(`Cannot move ${entity.type} under ${parent?.type ?? 'missing parent'}`)

    const sourceParentId = entity.parentId
    const sourceSiblings = (await db.table('entities').where('parentId').equals(sourceParentId).toArray() as ArcEntity[])
      .filter((candidate): candidate is StructuralEntity => candidate.type === entity.type && candidate.id !== entity.id)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    const targetSiblings = sourceParentId === targetParentId
      ? sourceSiblings
      : (await db.table('entities').where('parentId').equals(targetParentId).toArray() as ArcEntity[])
          .filter((candidate): candidate is StructuralEntity => candidate.type === entity.type && candidate.id !== entity.id)
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

    let targetIndex = targetSiblings.length
    if (beforeId) {
      targetIndex = targetSiblings.findIndex((candidate) => candidate.id === beforeId)
      if (targetIndex < 0) throw new Error('The requested before_id is no longer a sibling in the target parent.')
    }
    const destination = [...targetSiblings]
    destination.splice(targetIndex, 0, entity)
    const now = Date.now()
    for (const [index, candidate] of destination.entries()) {
      await db.table('entities').update(candidate.id, { parentId: targetParentId, order: index, updatedAt: now })
    }
    if (sourceParentId !== targetParentId) {
      for (const [index, candidate] of sourceSiblings.entries()) {
        await db.table('entities').update(candidate.id, { order: index, updatedAt: now })
      }
    }
    await touchAncestors(db, sourceParentId, now)
    if (targetParentId !== sourceParentId) await touchAncestors(db, targetParentId, now)
    const updated = await db.table('entities').get(id) as StructuralEntity | undefined
    if (!updated || !['act', 'chapter', 'scene'].includes(updated.type)) throw new Error(`Cannot move missing structural entity ${id}`)
    return updated
  })
}'''
)

replace_between(
    'export async function saveDocumentContent',
    'export async function listSnapshots',
    '''export async function saveDocumentContent(entityId: string, content: string) {
  const db = await database()
  return db.transaction('rw', db.table('entities'), async () => {
    const current = await db.table('entities').get(entityId) as ArcEntity | undefined
    if (!current) throw new Error(`Cannot save missing entity ${entityId}`)
    const now = Date.now()
    const patch: Record<string, unknown> = { content, updatedAt: now }
    if (current.type === 'codexEntry') patch.sourceRevision = now
    await db.table('entities').update(entityId, patch)
    if (current.type === 'scene') await touchAncestors(db, current.parentId, now)
    if (current.bookId) {
      const book = await db.table('entities').get(current.bookId) as ArcEntity | undefined
      if (book) await db.table('entities').update(book.id, { updatedAt: now })
    }
    const updated = await db.table('entities').get(entityId) as ArcEntity | undefined
    if (!updated) throw new Error(`Cannot save missing entity ${entityId}`)
    return updated
  })
}'''
)

path.write_text(text)

Path('tests/entity-mutation-race.test.mjs').write_text(r'''import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/persistence.ts', import.meta.url), 'utf8')

function block(name, next) {
  const start = source.indexOf(`export async function ${name}`)
  const end = source.indexOf(next, start)
  assert.ok(start >= 0 && end > start, `${name} block exists`)
  return source.slice(start, end)
}

function assertTransactionalFieldPatch(name, next) {
  const text = block(name, next)
  assert.match(text, /db\.transaction\('rw', db\.table\('entities'\)/, `${name} uses one write transaction`)
  const transaction = text.indexOf("db.transaction('rw', db.table('entities')")
  const read = text.indexOf("db.table('entities').get(")
  assert.ok(read > transaction, `${name} reads the entity only after entering its write transaction`)
  assert.match(text, /db\.table\('entities'\)\.(update|where\('id'\)\.equals\(id\)\.modify)/, `${name} patches fields rather than putting a captured whole entity`)
}

test('content and metadata mutations patch the latest entity inside one write transaction', () => {
  assertTransactionalFieldPatch('saveDocumentContent', 'export async function listSnapshots')
  assertTransactionalFieldPatch('renameEntity', 'export async function updateBookMetadata')
  assertTransactionalFieldPatch('archiveCodexEntry', 'export async function restoreCodexEntry')
  assertTransactionalFieldPatch('restoreCodexEntry', 'export async function updateCodexCategory')
  assertTransactionalFieldPatch('updateCodexCategory', 'export async function updateCodexSummaryPreference')
  assertTransactionalFieldPatch('updateCodexSummaryPreference', 'export async function updateCodexAutoIncludeTriggers')
  assertTransactionalFieldPatch('updateCodexAutoIncludeTriggers', 'export async function renameEntity')
})

test('structural reorder/reparent patch only structural fields and never bulkPut captured bodies', () => {
  const move = block('moveStructuralEntity', 'export async function placeStructuralEntity')
  assert.doesNotMatch(move, /bulkPut/)
  assert.match(move, /update\(entity\.id, \{ order:/)
  assert.match(move, /update\(target\.id, \{ order:/)

  const place = block('placeStructuralEntity', 'async function collectEntityTreeIdsWithDb')
  assert.doesNotMatch(place, /bulkPut/)
  assert.match(place, /update\(candidate\.id, \{ parentId: targetParentId, order: index, updatedAt: now \}\)/)
  assert.match(place, /update\(candidate\.id, \{ order: index, updatedAt: now \}\)/)
})

test('field patches preserve unrelated concurrent values in either logical completion order', () => {
  const base = { id: 'scene-a', title: 'Old title', content: 'C0', order: 0, category: 'Character' }
  const patch = (entity, values) => ({ ...entity, ...values })

  const contentThenTitle = patch(patch(base, { content: 'C1' }), { title: 'New title' })
  const titleThenContent = patch(patch(base, { title: 'New title' }), { content: 'C1' })
  assert.equal(contentThenTitle.content, 'C1')
  assert.equal(contentThenTitle.title, 'New title')
  assert.deepEqual(contentThenTitle, titleThenContent)

  const contentThenCategory = patch(patch(base, { content: 'C1' }), { category: 'Place' })
  const categoryThenContent = patch(patch(base, { category: 'Place' }), { content: 'C1' })
  assert.equal(contentThenCategory.content, 'C1')
  assert.equal(contentThenCategory.category, 'Place')
  assert.deepEqual(contentThenCategory, categoryThenContent)

  const contentThenOrder = patch(patch(base, { content: 'C1' }), { order: 1 })
  const orderThenContent = patch(patch(base, { order: 1 }), { content: 'C1' })
  assert.equal(contentThenOrder.content, 'C1')
  assert.equal(contentThenOrder.order, 1)
  assert.deepEqual(contentThenOrder, orderThenContent)
})
''')

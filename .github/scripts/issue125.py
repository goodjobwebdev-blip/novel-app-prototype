from pathlib import Path
import re

# ---- persistence.ts ----
p = Path('src/persistence.ts')
text = p.read_text()

summary_pattern = re.compile(r"export async function saveSummaryContent\(summaryIdValue: string, content: string, sourceRevision: number\): Promise<SummaryEntity> \{.*?\n\}\n\nexport function isCodexEntryArchived", re.S)
if not summary_pattern.search(text):
    raise SystemExit('saveSummaryContent block not found')
summary_replacement = '''export async function saveSummaryContent(summaryIdValue: string, content: string, sourceRevision: number): Promise<SummaryEntity> {
  const db = await database()
  return db.transaction('rw', db.table('entities'), async () => {
    const current = await db.table('entities').get(summaryIdValue) as SummaryEntity | undefined
    if (!current || current.type !== 'summary') throw new Error(`Cannot save missing summary ${summaryIdValue}`)
    const updated: SummaryEntity = { ...current, content, summarizedSourceRevision: sourceRevision, updatedAt: Date.now() }
    await db.table('entities').put(updated)
    await touchAncestors(db, current.bookId, updated.updatedAt)
    return updated
  })
}

export function isCodexEntryArchived'''
text = summary_pattern.sub(summary_replacement, text, count=1)

delete_pattern = re.compile(r"export async function deleteEntityTree\(id: string\): Promise<string\[]> \{.*?\n\}\n\nexport async function deleteEntity\(id: string\)", re.S)
if not delete_pattern.search(text):
    raise SystemExit('deleteEntityTree block not found')
delete_replacement = '''async function collectEntityTreeIdsWithDb(db: any, id: string): Promise<{ root?: ArcEntity; ids: string[] }> {
  const removedIds = new Set<string>()
  async function collect(entityId: string) {
    if (removedIds.has(entityId)) return
    const children: ArcEntity[] = await db.table('entities').where('parentId').equals(entityId).toArray()
    for (const child of children) await collect(child.id)
    removedIds.add(entityId)
  }
  const root = await db.table('entities').get(id) as ArcEntity | undefined
  await collect(id)
  if (root?.type === 'book') {
    const bookEntities: ArcEntity[] = await db.table('entities').where('bookId').equals(id).toArray()
    for (const entity of bookEntities) await collect(entity.id)
  }
  return { root, ids: [...removedIds] }
}

export async function collectEntityTreeIds(id: string): Promise<string[]> {
  const db = await database()
  return (await collectEntityTreeIdsWithDb(db, id)).ids
}

export async function deleteEntityTree(id: string): Promise<string[]> {
  const db = await database()
  let deletedIds: string[] = []
  await db.transaction('rw', db.table('entities'), db.table('snapshots'), async () => {
    const { root, ids } = await collectEntityTreeIdsWithDb(db, id)
    deletedIds = ids
    const removedIds = new Set(ids)
    await db.table('entities').bulkDelete(ids)
    const snapshots: DocumentSnapshot[] = await db.table('snapshots').toArray()
    const snapshotIds = snapshots.filter((snapshot) => removedIds.has(snapshot.entityId)).map((snapshot) => snapshot.id)
    if (snapshotIds.length) await db.table('snapshots').bulkDelete(snapshotIds)
    await touchAncestors(db, root?.parentId, Date.now())
  })
  return deletedIds
}

export async function deleteEntity(id: string)'''
text = delete_pattern.sub(delete_replacement, text, count=1)

save_pattern = re.compile(r"export async function saveDocumentContent\(entityId: string, content: string\) \{.*?\n\}\n\nexport async function listSnapshots", re.S)
if not save_pattern.search(text):
    raise SystemExit('saveDocumentContent block not found')
save_replacement = '''export async function saveDocumentContent(entityId: string, content: string) {
  const db = await database()
  return db.transaction('rw', db.table('entities'), async () => {
    const current = await db.table('entities').get(entityId) as ArcEntity | undefined
    if (!current) throw new Error(`Cannot save missing entity ${entityId}`)
    const now = Date.now()
    const updated = { ...current, content, updatedAt: now, ...(current.type === 'codexEntry' ? { sourceRevision: now } : {}) }
    await db.table('entities').put(updated)
    if (current.type === 'scene') await touchAncestors(db, current.parentId, now)
    if (current.bookId) {
      const book = await db.table('entities').get(current.bookId) as ArcEntity | undefined
      if (book) await db.table('entities').put({ ...book, updatedAt: now })
    }
    return updated
  })
}

export async function listSnapshots'''
text = save_pattern.sub(save_replacement, text, count=1)

snapshot_pattern = re.compile(r"export async function createSnapshot\(entityId: string, reason: SnapshotReason, contentOverride\?: string\) \{.*?\n\}\n\nexport async function restoreSnapshot", re.S)
if not snapshot_pattern.search(text):
    raise SystemExit('createSnapshot block not found')
snapshot_replacement = '''export async function createSnapshot(entityId: string, reason: SnapshotReason, contentOverride?: string) {
  const db = await database()
  let result: DocumentSnapshot | undefined
  let created = false
  await db.transaction('rw', db.table('entities'), db.table('snapshots'), async () => {
    const entity = await db.table('entities').get(entityId) as ArcEntity | undefined
    if (!entity) throw new Error(`Cannot snapshot missing entity ${entityId}`)
    const content = contentOverride ?? String(entity.content ?? '')
    const snapshots: DocumentSnapshot[] = await db.table('snapshots').where('entityId').equals(entityId).toArray()
    snapshots.sort((a, b) => b.createdAt - a.createdAt)
    if (snapshots[0]?.content === content) {
      result = snapshots[0]
      return
    }
    result = {
      id: makeId('snapshot'),
      entityId,
      entityType: entity.type,
      createdAt: Date.now(),
      content,
      reason,
    }
    await db.table('snapshots').put(result)
    created = true
  })
  if (!result) throw new Error(`Could not create snapshot for ${entityId}`)
  if (created) await pruneSnapshots(entityId)
  return result
}

export async function restoreSnapshot'''
text = snapshot_pattern.sub(snapshot_replacement, text, count=1)
p.write_text(text)

# ---- Workspace.tsx ----
w = Path('src/Workspace.tsx')
text = w.read_text()

import_anchor = "import { KeyedAsyncQueue } from './keyed-async-queue'\n"
if import_anchor not in text:
    raise SystemExit('KeyedAsyncQueue import not found')
text = text.replace(import_anchor, import_anchor + "import { runDeletionSaveBarrier } from './deletion-save-barrier'\n", 1)

persistence_anchor = "  createStructuralEntity,\n  deleteEntityTree,\n"
if persistence_anchor not in text:
    raise SystemExit('persistence import anchor not found')
text = text.replace(persistence_anchor, "  createStructuralEntity,\n  collectEntityTreeIds,\n  deleteEntityTree,\n", 1)

ref_anchor = "  const documentSaveQueueRef = useRef(new KeyedAsyncQueue())\n"
if ref_anchor not in text:
    raise SystemExit('document save queue ref not found')
text = text.replace(ref_anchor, ref_anchor + "  const deletingEntityIdsRef = useRef(new Set<string>())\n", 1)

start_anchor = "    if (!storageReadyRef.current || !documentId) return false\n"
if start_anchor not in text:
    raise SystemExit('flush start anchor not found')
text = text.replace(start_anchor, "    if (!storageReadyRef.current || !documentId || deletingEntityIdsRef.current.has(documentId)) return false\n", 1)

loop_anchor = "    while (true) {\n      const contentSnapshot = storyRef.current\n"
if loop_anchor not in text:
    raise SystemExit('flush loop anchor not found')
text = text.replace(loop_anchor, "    while (true) {\n      if (deletingEntityIdsRef.current.has(documentId)) return false\n      const contentSnapshot = storyRef.current\n", 1)

helper_anchor = "  async function makeBook() {\n"
if helper_anchor not in text:
    raise SystemExit('makeBook anchor not found')
helper = '''  async function deleteWithSaveBarrier(rootId: string) {
    const ids = await collectEntityTreeIds(rootId)
    if (activeDocumentIdRef.current && ids.includes(activeDocumentIdRef.current) && saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    return runDeletionSaveBarrier(
      ids,
      deletingEntityIdsRef.current,
      (id) => documentSaveQueueRef.current.whenIdle(id),
      () => deleteEntityTree(rootId),
    )
  }

'''
text = text.replace(helper_anchor, helper + helper_anchor, 1)

text = text.replace("    await deleteEntityTree(book.id)\n", "    await deleteWithSaveBarrier(book.id)\n", 1)
text = text.replace("    await deleteEntityTree(currentBook.id)\n", "    await deleteWithSaveBarrier(currentBook.id)\n", 1)
text = text.replace("    const removedIds = await deleteEntityTree(entity.id)\n", "    const removedIds = await deleteWithSaveBarrier(entity.id)\n", 1)
text = text.replace("    await deleteEntityTree(entity.id)\n    await reloadBookContent(currentBook.id)\n", "    await deleteWithSaveBarrier(entity.id)\n    await reloadBookContent(currentBook.id)\n", 1)

w.write_text(text)

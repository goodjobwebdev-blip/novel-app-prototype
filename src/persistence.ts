type DexieModule = { default: new (name: string) => any }

const dexieUrl = 'https://esm.sh/dexie@4.4.5'

export type EntityType = 'book' | 'act' | 'chapter' | 'scene' | 'note' | 'codexEntry' | 'chat' | 'chatMessage' | 'settings'
export type SnapshotReason = 'autosave' | 'generation' | 'manual' | 'navigation' | 'lifecycle'

export type ArcEntity = {
  id: string
  type: EntityType
  bookId?: string
  parentId?: string
  order?: number
  title?: string
  content?: string
  createdAt: number
  updatedAt: number
  [key: string]: unknown
}

export type DocumentSnapshot = {
  id: string
  entityId: string
  entityType: EntityType
  createdAt: number
  content: string
  reason: SnapshotReason
}

export const PROTOTYPE_BOOK_ID = 'book-city-beneath-tide'
export const PROTOTYPE_SCENE_ID = 'scene-ch7-2'

let databasePromise: Promise<any> | null = null

async function database() {
  if (!databasePromise) {
    databasePromise = import(/* @vite-ignore */ dexieUrl).then((module: DexieModule) => {
      const db = new module.default('arc-novel-local-v1')
      db.version(1).stores({
        entities: 'id,type,bookId,parentId,[parentId+order],updatedAt',
        snapshots: 'id,entityId,entityType,createdAt,[entityId+createdAt],reason',
        meta: 'key',
      })
      return db.open().then(() => db)
    })
  }
  return databasePromise
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export async function ensurePrototypeSeed(initialStoryMarkdown: string) {
  const db = await database()
  const seeded = await db.table('meta').get('prototype-seeded-v1')
  if (seeded) return

  const now = Date.now()
  const entities: ArcEntity[] = [
    { id: PROTOTYPE_BOOK_ID, type: 'book', title: 'The City Beneath the Tide', series: 'Atlas of Lost Coasts · Book II', createdAt: now, updatedAt: now },
    { id: 'act-1', type: 'act', bookId: PROTOTYPE_BOOK_ID, parentId: PROTOTYPE_BOOK_ID, order: 0, title: 'The doors remember', createdAt: now, updatedAt: now },
    { id: 'chapter-7', type: 'chapter', bookId: PROTOTYPE_BOOK_ID, parentId: 'act-1', order: 0, title: 'The Cartographer’s Door', createdAt: now, updatedAt: now },
    { id: PROTOTYPE_SCENE_ID, type: 'scene', bookId: PROTOTYPE_BOOK_ID, parentId: 'chapter-7', order: 0, title: 'The voice beyond', content: initialStoryMarkdown, createdAt: now, updatedAt: now },
    { id: 'scene-ch7-3', type: 'scene', bookId: PROTOTYPE_BOOK_ID, parentId: 'chapter-7', order: 1, title: 'Crossing', content: '', createdAt: now, updatedAt: now },
    { id: 'chapter-8', type: 'chapter', bookId: PROTOTYPE_BOOK_ID, parentId: 'act-1', order: 1, title: 'What the sea kept', createdAt: now, updatedAt: now },
    { id: 'act-2', type: 'act', bookId: PROTOTYPE_BOOK_ID, parentId: PROTOTYPE_BOOK_ID, order: 1, title: 'The map without coastlines', createdAt: now, updatedAt: now },
  ]

  await db.transaction('rw', db.table('entities'), db.table('meta'), async () => {
    await db.table('entities').bulkPut(entities)
    await db.table('meta').put({ key: 'prototype-seeded-v1', value: true, createdAt: now })
  })
}

export async function getEntity<T extends ArcEntity = ArcEntity>(id: string): Promise<T | undefined> {
  const db = await database()
  return db.table('entities').get(id)
}

export async function putEntity(entity: ArcEntity) {
  const db = await database()
  await db.table('entities').put(entity)
  return entity
}

export async function listEntitiesByParent(parentId: string): Promise<ArcEntity[]> {
  const db = await database()
  const children: ArcEntity[] = await db.table('entities').where('parentId').equals(parentId).toArray()
  return children.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

export async function listEntitiesByBook(bookId: string, type?: EntityType): Promise<ArcEntity[]> {
  const db = await database()
  const entities: ArcEntity[] = await db.table('entities').where('bookId').equals(bookId).toArray()
  return type ? entities.filter((entity) => entity.type === type) : entities
}

export async function deleteEntity(id: string) {
  const db = await database()
  await db.table('entities').delete(id)
}

export async function saveDocumentContent(entityId: string, content: string) {
  const db = await database()
  const current = await db.table('entities').get(entityId) as ArcEntity | undefined
  if (!current) throw new Error(`Cannot save missing entity ${entityId}`)
  const updated = { ...current, content, updatedAt: Date.now() }
  await db.table('entities').put(updated)
  return updated
}

export async function listSnapshots(entityId: string): Promise<DocumentSnapshot[]> {
  const db = await database()
  const snapshots: DocumentSnapshot[] = await db.table('snapshots').where('entityId').equals(entityId).toArray()
  return snapshots.sort((a, b) => b.createdAt - a.createdAt)
}

export async function readSnapshot(id: string): Promise<DocumentSnapshot | undefined> {
  const db = await database()
  return db.table('snapshots').get(id)
}

export async function createSnapshot(entityId: string, reason: SnapshotReason, contentOverride?: string) {
  const db = await database()
  const entity = await db.table('entities').get(entityId) as ArcEntity | undefined
  if (!entity) throw new Error(`Cannot snapshot missing entity ${entityId}`)
  const content = contentOverride ?? String(entity.content ?? '')
  const existing = await listSnapshots(entityId)
  if (existing[0]?.content === content) return existing[0]

  const snapshot: DocumentSnapshot = {
    id: makeId('snapshot'),
    entityId,
    entityType: entity.type,
    createdAt: Date.now(),
    content,
    reason,
  }
  await db.table('snapshots').put(snapshot)
  await pruneSnapshots(entityId)
  return snapshot
}

export async function restoreSnapshot(snapshotId: string) {
  const db = await database()
  const snapshot = await readSnapshot(snapshotId)
  if (!snapshot) throw new Error(`Snapshot ${snapshotId} was not found`)
  const entity = await db.table('entities').get(snapshot.entityId) as ArcEntity | undefined
  if (!entity) throw new Error(`Cannot restore missing entity ${snapshot.entityId}`)

  await createSnapshot(entity.id, 'manual', String(entity.content ?? ''))
  return saveDocumentContent(entity.id, snapshot.content)
}

export async function pruneSnapshots(entityId: string, now = Date.now()) {
  const db = await database()
  const snapshots = await listSnapshots(entityId)
  const keep = new Set<string>()
  const buckets = new Set<string>()
  const hour = 60 * 60 * 1000
  const day = 24 * hour

  for (const snapshot of snapshots) {
    const age = now - snapshot.createdAt
    if (snapshot.reason === 'manual') {
      keep.add(snapshot.id)
      continue
    }
    if (age <= hour) {
      keep.add(snapshot.id)
      continue
    }
    if (age <= day) {
      const bucket = `hour:${Math.floor(snapshot.createdAt / hour)}`
      if (!buckets.has(bucket)) { buckets.add(bucket); keep.add(snapshot.id) }
      continue
    }
    if (age <= 30 * day) {
      const bucket = `day:${Math.floor(snapshot.createdAt / day)}`
      if (!buckets.has(bucket)) { buckets.add(bucket); keep.add(snapshot.id) }
    }
  }

  const remove = snapshots.filter((snapshot) => !keep.has(snapshot.id)).map((snapshot) => snapshot.id)
  if (remove.length) await db.table('snapshots').bulkDelete(remove)
}

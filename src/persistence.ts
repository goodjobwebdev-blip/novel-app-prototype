import {
  copyAiSettings,
  toBookAiSettings,
  withGlobalFavorites,
  type AiSettings,
  type BookAiSettings,
} from './ai-settings'

type DexieModule = { default: new (name: string) => any }

const dexieUrl = 'https://esm.sh/dexie@4.4.5'

export type EntityType = 'book' | 'act' | 'chapter' | 'scene' | 'note' | 'codexEntry' | 'summary' | 'chat' | 'chatMessage' | 'settings'
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

export type StructuralEntityType = 'act' | 'chapter' | 'scene'
export type StructuralEntity = ArcEntity & { type: StructuralEntityType; bookId: string; parentId: string; order: number; title: string }
export type BookMetadata = {
  title: string
  series: string
  seriesOrder: string
  overview: string
  genre: string
  writingStyle: string
  pointOfView: string
  tense: string
  language: string
}
export type BookEntity = ArcEntity & { type: 'book'; title: string } & Partial<Omit<BookMetadata, 'title'>>
export type NoteEntity = ArcEntity & { type: 'note'; bookId: string; parentId: string; title: string; content: string }
export type CodexEntryEntity = ArcEntity & { type: 'codexEntry'; bookId: string; parentId: string; title: string; category: string; content: string }
export type SummaryEntity = ArcEntity & {
  type: 'summary'
  bookId: string
  parentId: string
  sourceEntityId: string
  sourceType: StructuralEntityType
  title: string
  content: string
  summarizedSourceRevision?: number
}
export type EditableEntity = StructuralEntity | NoteEntity | CodexEntryEntity | SummaryEntity
export type BookContextDefaults = {
  includePreviousScene: boolean
  includePreviousSummaries: boolean
  includeChapterSummary: boolean
  includeActSummary: boolean
}
export type SceneContextSelection = {
  noteIds: string[]
  codexEntryIds: string[]
}
export type GenerationContextSelection = BookContextDefaults & SceneContextSelection
export type BookAiSettingsEntity = ArcEntity & {
  type: 'settings'
  bookId: string
  parentId: string
  settingsType: 'ai'
  value: BookAiSettings
}
export type BookContextSettingsEntity = ArcEntity & {
  type: 'settings'
  bookId: string
  parentId: string
  settingsType: 'context-book'
  value: BookContextDefaults
}
export type SceneContextSettingsEntity = ArcEntity & {
  type: 'settings'
  bookId: string
  parentId: string
  settingsType: 'context-scene'
  value: SceneContextSelection
}

export const defaultBookContextDefaults: BookContextDefaults = {
  includePreviousScene: false,
  includePreviousSummaries: true,
  includeChapterSummary: true,
  includeActSummary: true,
}

function normalizeBookContextDefaults(value?: Partial<BookContextDefaults>): BookContextDefaults {
  return {
    includePreviousScene: value?.includePreviousScene ?? defaultBookContextDefaults.includePreviousScene,
    includePreviousSummaries: value?.includePreviousSummaries ?? defaultBookContextDefaults.includePreviousSummaries,
    includeChapterSummary: value?.includeChapterSummary ?? defaultBookContextDefaults.includeChapterSummary,
    includeActSummary: value?.includeActSummary ?? defaultBookContextDefaults.includeActSummary,
  }
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

function aiSettingsId(bookId: string) {
  return `settings-ai-${bookId}`
}

function summaryId(sourceEntityId: string) {
  return `summary-${sourceEntityId}`
}

function bookContextSettingsId(bookId: string) {
  return `settings-context-book-${bookId}`
}

function sceneContextSettingsId(sceneId: string) {
  return `settings-context-scene-${sceneId}`
}

function uniqueIds(ids: string[]) {
  return [...new Set(ids.filter((id) => typeof id === 'string' && id.trim()))]
}

async function touchAncestors(db: any, parentId: string | undefined, now: number) {
  let nextId = parentId
  while (nextId) {
    const parent = await db.table('entities').get(nextId) as ArcEntity | undefined
    if (!parent) return
    await db.table('entities').put({ ...parent, updatedAt: now })
    nextId = parent.parentId
  }
}

function makeBookAiSettingsEntity(bookId: string, settings: AiSettings, now = Date.now()): BookAiSettingsEntity {
  return {
    id: aiSettingsId(bookId),
    type: 'settings',
    bookId,
    parentId: bookId,
    settingsType: 'ai',
    value: toBookAiSettings(settings),
    createdAt: now,
    updatedAt: now,
  }
}

function makeBookContextSettingsEntity(bookId: string, value: BookContextDefaults = defaultBookContextDefaults, now = Date.now()): BookContextSettingsEntity {
  return {
    id: bookContextSettingsId(bookId),
    type: 'settings',
    bookId,
    parentId: bookId,
    settingsType: 'context-book',
    value: normalizeBookContextDefaults(value),
    createdAt: now,
    updatedAt: now,
  }
}

export async function ensurePrototypeSeed(initialStoryMarkdown: string) {
  const db = await database()
  const seeded = await db.table('meta').get('prototype-seeded-v1')
  if (!seeded) {
    const now = Date.now()
    const entities: ArcEntity[] = [
      {
        id: PROTOTYPE_BOOK_ID,
        type: 'book',
        title: 'The City Beneath the Tide',
        series: 'Atlas of Lost Coasts',
        seriesOrder: '2',
        overview: 'A cartographer discovers that the drowned parts of her city still exist behind doors that remember them.',
        genre: 'Fantasy',
        writingStyle: 'Lyrical tension',
        pointOfView: 'Third person limited',
        tense: 'Past',
        language: 'English',
        createdAt: now,
        updatedAt: now,
      },
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

  const contentSeeded = await db.table('meta').get('prototype-content-seeded-v1')
  const prototypeBook = await db.table('entities').get(PROTOTYPE_BOOK_ID)
  if (!contentSeeded && prototypeBook) {
    const now = Date.now()
    const contentEntities: ArcEntity[] = [
      { id: 'note-remembered-doors', type: 'note', bookId: PROTOTYPE_BOOK_ID, parentId: PROTOTYPE_BOOK_ID, title: 'Rules of the remembered doors', content: '# Rules of the remembered doors\n\nA door that remembers a name should never be answered alone.', createdAt: now, updatedAt: now },
      { id: 'note-act-two-questions', type: 'note', bookId: PROTOTYPE_BOOK_ID, parentId: PROTOTYPE_BOOK_ID, title: 'Questions for Act II', content: '- What does crossing cost Mara?\n- Why did her father hide the map?', createdAt: now, updatedAt: now },
      { id: 'codex-mara-vale', type: 'codexEntry', bookId: PROTOTYPE_BOOK_ID, parentId: PROTOTYPE_BOOK_ID, title: 'Mara Vale', category: 'Character', content: 'A cartographer who inherited her father’s rules and his unfinished map.', createdAt: now, updatedAt: now },
      { id: 'codex-drowned-quarter', type: 'codexEntry', bookId: PROTOTYPE_BOOK_ID, parentId: PROTOTYPE_BOOK_ID, title: 'The Drowned Quarter', category: 'Place', content: 'A district exposed only at low tide.', createdAt: now, updatedAt: now },
      { id: 'codex-brass-compass', type: 'codexEntry', bookId: PROTOTYPE_BOOK_ID, parentId: PROTOTYPE_BOOK_ID, title: 'Brass Compass', category: 'Object', content: 'One of several compasses that point toward remembered doors.', createdAt: now, updatedAt: now },
    ]
    await db.transaction('rw', db.table('entities'), db.table('meta'), async () => {
      for (const entity of contentEntities) {
        if (!await db.table('entities').get(entity.id)) await db.table('entities').put(entity)
      }
      await db.table('meta').put({ key: 'prototype-content-seeded-v1', value: true, createdAt: now })
    })
  }
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

export async function listBooks(): Promise<BookEntity[]> {
  const db = await database()
  const books: BookEntity[] = await db.table('entities').where('type').equals('book').toArray()
  return books.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function createBook(defaultAiSettings: AiSettings, title = 'Untitled Book'): Promise<{ book: BookEntity; chapter: StructuralEntity; scene: StructuralEntity }> {
  const db = await database()
  const now = Date.now()
  const bookId = makeId('book')
  const chapterId = makeId('chapter')
  const book: BookEntity = {
    id: bookId,
    type: 'book',
    title,
    series: 'Standalone',
    seriesOrder: '',
    overview: '',
    genre: '',
    writingStyle: '',
    pointOfView: '',
    tense: 'Past',
    language: 'English',
    createdAt: now,
    updatedAt: now,
  }
  const chapter: StructuralEntity = { id: chapterId, type: 'chapter', bookId, parentId: bookId, order: 0, title: 'Chapter 1', createdAt: now, updatedAt: now }
  const scene: StructuralEntity = { id: makeId('scene'), type: 'scene', bookId, parentId: chapterId, order: 0, title: 'Scene 1', content: '', createdAt: now, updatedAt: now }
  const aiSettings = makeBookAiSettingsEntity(bookId, defaultAiSettings, now)
  const contextSettings = makeBookContextSettingsEntity(bookId, defaultBookContextDefaults, now)
  await db.table('entities').bulkPut([book, chapter, scene, aiSettings, contextSettings])
  return { book, chapter, scene }
}

export async function ensureBookAiSettings(bookId: string, defaults: AiSettings): Promise<BookAiSettingsEntity> {
  const db = await database()
  const existing = await db.table('entities').get(aiSettingsId(bookId)) as BookAiSettingsEntity | undefined
  if (existing?.type === 'settings' && existing.settingsType === 'ai') return existing
  const created = makeBookAiSettingsEntity(bookId, defaults)
  await db.table('entities').put(created)
  return created
}

export async function getBookAiSettings(bookId: string, globalFavorites: string[]): Promise<AiSettings> {
  const db = await database()
  const entity = await db.table('entities').get(aiSettingsId(bookId)) as BookAiSettingsEntity | undefined
  if (!entity || entity.type !== 'settings' || entity.settingsType !== 'ai') {
    throw new Error(`AI settings for book ${bookId} were not found`)
  }
  return withGlobalFavorites(entity.value, globalFavorites)
}

export async function saveBookAiSettings(bookId: string, settings: AiSettings): Promise<AiSettings> {
  const db = await database()
  const id = aiSettingsId(bookId)
  const existing = await db.table('entities').get(id) as BookAiSettingsEntity | undefined
  const now = Date.now()
  const entity: BookAiSettingsEntity = {
    ...makeBookAiSettingsEntity(bookId, settings, existing?.createdAt ?? now),
    updatedAt: now,
  }
  await db.table('entities').put(entity)
  return withGlobalFavorites(entity.value, settings.favorites)
}

export async function copyDefaultAiSettingsToBook(bookId: string, defaults: AiSettings): Promise<AiSettings> {
  await saveBookAiSettings(bookId, copyAiSettings(defaults))
  return copyAiSettings(defaults)
}

export async function getBookContextDefaults(bookId: string): Promise<BookContextDefaults> {
  const db = await database()
  const id = bookContextSettingsId(bookId)
  const existing = await db.table('entities').get(id) as BookContextSettingsEntity | undefined
  if (existing?.type === 'settings' && existing.settingsType === 'context-book') {
    return normalizeBookContextDefaults(existing.value)
  }
  const created = makeBookContextSettingsEntity(bookId)
  await db.table('entities').put(created)
  return { ...created.value }
}

export async function saveBookContextDefaults(bookId: string, value: BookContextDefaults): Promise<BookContextDefaults> {
  const db = await database()
  const id = bookContextSettingsId(bookId)
  const existing = await db.table('entities').get(id) as BookContextSettingsEntity | undefined
  const now = Date.now()
  const normalized = normalizeBookContextDefaults(value)
  await db.table('entities').put({
    ...makeBookContextSettingsEntity(bookId, normalized, existing?.createdAt ?? now),
    updatedAt: now,
  })
  return normalized
}

export async function getSceneContextSelection(bookId: string, sceneId: string): Promise<SceneContextSelection> {
  const db = await database()
  const existing = await db.table('entities').get(sceneContextSettingsId(sceneId)) as SceneContextSettingsEntity | undefined
  if (!existing || existing.type !== 'settings' || existing.settingsType !== 'context-scene' || existing.bookId !== bookId) {
    return { noteIds: [], codexEntryIds: [] }
  }
  return { noteIds: uniqueIds(existing.value.noteIds ?? []), codexEntryIds: uniqueIds(existing.value.codexEntryIds ?? []) }
}

export async function saveSceneContextSelection(bookId: string, sceneId: string, value: SceneContextSelection): Promise<SceneContextSelection> {
  const db = await database()
  const id = sceneContextSettingsId(sceneId)
  const existing = await db.table('entities').get(id) as SceneContextSettingsEntity | undefined
  const now = Date.now()
  const normalized = { noteIds: uniqueIds(value.noteIds), codexEntryIds: uniqueIds(value.codexEntryIds) }
  const entity: SceneContextSettingsEntity = {
    id,
    type: 'settings',
    bookId,
    parentId: sceneId,
    settingsType: 'context-scene',
    value: normalized,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await db.table('entities').put(entity)
  return normalized
}

export async function getGenerationContextSelection(bookId: string, sceneId: string): Promise<GenerationContextSelection> {
  const [defaults, selected] = await Promise.all([
    getBookContextDefaults(bookId),
    getSceneContextSelection(bookId, sceneId),
  ])
  return { ...defaults, ...selected }
}

export async function saveGenerationContextSelection(bookId: string, sceneId: string, value: GenerationContextSelection): Promise<GenerationContextSelection> {
  const [defaults, selected] = await Promise.all([
    saveBookContextDefaults(bookId, value),
    saveSceneContextSelection(bookId, sceneId, value),
  ])
  return { ...defaults, ...selected }
}

export async function createStructuralEntity(
  type: StructuralEntityType,
  bookId: string,
  parentId: string,
  title = `Untitled ${type[0].toUpperCase()}${type.slice(1)}`,
): Promise<StructuralEntity> {
  const db = await database()
  const parent = await db.table('entities').get(parentId) as ArcEntity | undefined
  const validParent = type === 'act'
    ? parent?.type === 'book'
    : type === 'chapter'
      ? parent?.type === 'book' || parent?.type === 'act'
      : parent?.type === 'chapter'
  if (!validParent) throw new Error(`Cannot create ${type} under ${parent?.type ?? 'missing parent'}`)
  const siblings: ArcEntity[] = await db.table('entities').where('parentId').equals(parentId).toArray()
  const order = siblings.filter((entity) => entity.type === type).reduce((maximum, entity) => Math.max(maximum, entity.order ?? -1), -1) + 1
  const now = Date.now()
  const entity: StructuralEntity = {
    id: makeId(type), type, bookId, parentId, order, title,
    ...(type === 'scene' ? { content: '' } : {}),
    createdAt: now, updatedAt: now,
  }
  await db.transaction('rw', db.table('entities'), async () => {
    await db.table('entities').put(entity)
    await touchAncestors(db, parentId, now)
  })
  return entity
}

export async function createNote(bookId: string, title = 'Untitled Note'): Promise<NoteEntity> {
  const db = await database()
  const now = Date.now()
  const note: NoteEntity = { id: makeId('note'), type: 'note', bookId, parentId: bookId, title, content: '', createdAt: now, updatedAt: now }
  await db.transaction('rw', db.table('entities'), async () => {
    await db.table('entities').put(note)
    await touchAncestors(db, bookId, now)
  })
  return note
}

export async function createCodexEntry(bookId: string, title = 'Untitled Entry', category = 'Character'): Promise<CodexEntryEntity> {
  const db = await database()
  const now = Date.now()
  const entry: CodexEntryEntity = { id: makeId('codex'), type: 'codexEntry', bookId, parentId: bookId, title, category, content: '', createdAt: now, updatedAt: now }
  await db.transaction('rw', db.table('entities'), async () => {
    await db.table('entities').put(entry)
    await touchAncestors(db, bookId, now)
  })
  return entry
}

export async function getOrCreateSummary(source: StructuralEntity): Promise<SummaryEntity> {
  const db = await database()
  const id = summaryId(source.id)
  const existing = await db.table('entities').get(id) as SummaryEntity | undefined
  if (existing?.type === 'summary') return existing
  const now = Date.now()
  const summary: SummaryEntity = {
    id,
    type: 'summary',
    bookId: source.bookId,
    parentId: source.id,
    sourceEntityId: source.id,
    sourceType: source.type,
    title: `${source.title} summary`,
    content: '',
    createdAt: now,
    updatedAt: now,
  }
  await db.table('entities').put(summary)
  return summary
}

export async function saveSummaryContent(summaryIdValue: string, content: string, sourceRevision: number): Promise<SummaryEntity> {
  const db = await database()
  const current = await db.table('entities').get(summaryIdValue) as SummaryEntity | undefined
  if (!current || current.type !== 'summary') throw new Error(`Cannot save missing summary ${summaryIdValue}`)
  const updated: SummaryEntity = { ...current, content, summarizedSourceRevision: sourceRevision, updatedAt: Date.now() }
  await db.transaction('rw', db.table('entities'), async () => {
    await db.table('entities').put(updated)
    await touchAncestors(db, current.bookId, updated.updatedAt)
  })
  return updated
}

export async function updateCodexCategory(id: string, category: string): Promise<CodexEntryEntity> {
  const db = await database()
  const current = await db.table('entities').get(id) as CodexEntryEntity | undefined
  if (!current || current.type !== 'codexEntry') throw new Error(`Cannot update missing Codex entry ${id}`)
  const updated: CodexEntryEntity = { ...current, category: category.trim() || 'Other', updatedAt: Date.now() }
  await db.transaction('rw', db.table('entities'), async () => {
    await db.table('entities').put(updated)
    await touchAncestors(db, current.bookId, updated.updatedAt)
  })
  return updated
}

export async function renameEntity(id: string, title: string): Promise<ArcEntity> {
  const db = await database()
  const entity = await db.table('entities').get(id) as ArcEntity | undefined
  if (!entity) throw new Error(`Cannot rename missing entity ${id}`)
  const updated = { ...entity, title: title.trim() || entity.title || 'Untitled', updatedAt: Date.now() }
  await db.transaction('rw', db.table('entities'), async () => {
    await db.table('entities').put(updated)
    if (['act', 'chapter', 'scene'].includes(entity.type)) await touchAncestors(db, entity.parentId, updated.updatedAt)
    else if (entity.bookId) await touchAncestors(db, entity.bookId, updated.updatedAt)
  })
  return updated
}

export async function updateBookMetadata(id: string, metadata: BookMetadata): Promise<BookEntity> {
  const db = await database()
  const entity = await db.table('entities').get(id) as BookEntity | undefined
  if (!entity || entity.type !== 'book') throw new Error(`Cannot update missing book ${id}`)
  const updated: BookEntity = {
    ...entity,
    ...metadata,
    title: metadata.title.trim() || entity.title || 'Untitled Book',
    series: metadata.series.trim() || 'Standalone',
    seriesOrder: metadata.series.trim() === 'Standalone' ? '' : metadata.seriesOrder.trim(),
    updatedAt: Date.now(),
  }
  await db.table('entities').put(updated)
  return updated
}

export async function moveStructuralEntity(id: string, direction: -1 | 1): Promise<void> {
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
    await db.table('entities').bulkPut([
      { ...entity, order: target.order, updatedAt: now },
      { ...target, order: entity.order, updatedAt: now },
    ])
    await touchAncestors(db, entity.parentId, now)
  })
}

export async function deleteEntityTree(id: string): Promise<string[]> {
  const db = await database()
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
  const ids = [...removedIds]
  await db.transaction('rw', db.table('entities'), db.table('snapshots'), async () => {
    await db.table('entities').bulkDelete(ids)
    const snapshots: DocumentSnapshot[] = await db.table('snapshots').toArray()
    const snapshotIds = snapshots.filter((snapshot) => removedIds.has(snapshot.entityId)).map((snapshot) => snapshot.id)
    if (snapshotIds.length) await db.table('snapshots').bulkDelete(snapshotIds)
    await touchAncestors(db, root?.parentId, Date.now())
  })
  return ids
}

export async function deleteEntity(id: string) {
  const db = await database()
  await db.table('entities').delete(id)
}

export async function saveDocumentContent(entityId: string, content: string) {
  const db = await database()
  const current = await db.table('entities').get(entityId) as ArcEntity | undefined
  if (!current) throw new Error(`Cannot save missing entity ${entityId}`)
  const now = Date.now()
  const updated = { ...current, content, updatedAt: now }
  await db.transaction('rw', db.table('entities'), async () => {
    await db.table('entities').put(updated)
    if (current.type === 'scene') await touchAncestors(db, current.parentId, now)
    if (current.bookId) {
      const book = await db.table('entities').get(current.bookId) as ArcEntity | undefined
      if (book) await db.table('entities').put({ ...book, updatedAt: now })
    }
  })
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

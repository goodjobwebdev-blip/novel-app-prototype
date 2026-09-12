import { documentBlocks, remapDocumentBlocks } from './document-projection.ts'
import type { GalleryImage, ImageJob } from './image-generation-types'
import type { ArcEntity, BookArchiveData, Illustration } from './persistence'
import { assertImageFile } from './illustration-image'

const MAGIC = 'ARCBK001'
const MAX_MANIFEST = 64 * 1024 * 1024
const MAX_ARCHIVE = 2_000_000_000
const TYPES = new Set(['book', 'series', 'act', 'chapter', 'scene', 'note', 'codexEntry', 'summary', 'chat', 'chatMessage', 'settings'])
const REF_KEYS = new Set(['bookId', 'entryId', 'parentId', 'seriesId', 'sourceEntityId', 'entityId', 'sourceId', 'targetId', 'primaryImageId', 'assetId', 'messageId', 'chatId', 'lastOpenedSceneId', 'sourceParentId', 'targetParentId', 'beforeId'])
const REF_ARRAYS = new Set(['skillNoteIds', 'structuralIds', 'noteIds', 'codexEntryIds', 'sourceIds'])

type StoredGalleryImage = Omit<GalleryImage, 'image' | 'thumbnail'> & { imageSize: number; imageType: string; thumbnailSize: number; thumbnailType: string }
type StoredImage = Omit<Illustration, 'image' | 'thumbnail'> & { imageSize: number; imageType: string; thumbnailSize: number; thumbnailType: string }

function withoutKeys(value: unknown): any {
  if (Array.isArray(value)) return value.map(withoutKeys)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /(apiKey$|^accessToken$|^refreshToken$|^authorization$)/i.test(key) ? '' : withoutKeys(item)]))
  return value
}

/** A versioned binary archive: JSON metadata followed by image blobs (no base64 overhead). */
export function encodeBookArchive(data: BookArchiveData): Blob {
  const images: StoredImage[] = data.illustrations.map(({ image, thumbnail, ...rest }) => ({ ...rest, imageSize: image.size, imageType: image.type, thumbnailSize: thumbnail.size, thumbnailType: thumbnail.type }))
  const gallery: StoredGalleryImage[] = (data.galleryImages ?? []).map(({ image, thumbnail, ...rest }) => ({ ...rest, imageSize: image.size, imageType: image.type, thumbnailSize: thumbnail.size, thumbnailType: thumbnail.type }))
  const entities = data.entities.map((entity) => entity.type === 'settings' ? withoutKeys(entity) : entity.type === 'chatMessage' && Array.isArray(entity.imageGenerations) ? { ...entity, imageGenerations: entity.imageGenerations.map((proposal: any) => ({ ...proposal, ...(proposal.draft ? { draft: { ...proposal.draft, sources: [] } } : {}) })) } : entity)
  const version = (data.galleryImages ?? []).some((asset) => asset.kind === 'video') ? 3 : 2
  const jobs = (data.imageJobs ?? []).map(({ sources: _sources, providerJobId: _providerJobId, owner: _owner, heartbeat: _heartbeat, ...job }) => job)
  const manifest = new TextEncoder().encode(JSON.stringify({ format: 'arc-book', version, entities, snapshots: data.snapshots, dependencies: data.dependencies, illustrations: images, galleryImages: gallery, imageJobs: jobs }))
  if (manifest.length > MAX_MANIFEST) throw new Error('Book metadata is too large for this archive version.')
  const header = new Uint8Array(12)
  header.set(new TextEncoder().encode(MAGIC))
  new DataView(header.buffer).setUint32(8, manifest.length)
  const archive = new Blob([header, manifest, ...[...data.illustrations, ...(data.galleryImages ?? [])].flatMap((image) => [image.image, image.thumbnail])], { type: 'application/octet-stream' })
  if (archive.size > MAX_ARCHIVE) throw new Error('This backup exceeds the current 2 GB archive limit.')
  return archive
}

function valid(condition: unknown): asserts condition {
  if (!condition) throw new Error('This book backup is incomplete or invalid. Nothing was imported.')
}
async function assertArchivedVideo(video: Blob) {
  const bytes = new Uint8Array(await video.slice(0, 12).arrayBuffer())
  const mp4 = bytes.length >= 8 && new TextDecoder().decode(bytes.slice(4, 8)) === 'ftyp'
  const webm = bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3
  valid(mp4 || webm)
}

export async function decodeBookArchive(file: Blob): Promise<BookArchiveData> {
  valid(file.size >= 12 && file.size <= MAX_ARCHIVE)
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  valid(new TextDecoder().decode(header.slice(0, 8)) === MAGIC)
  const length = new DataView(header.buffer).getUint32(8)
  valid(length > 0 && length <= MAX_MANIFEST && 12 + length <= file.size)
  let manifest: any
  try { manifest = JSON.parse(await file.slice(12, 12 + length).text()) } catch { throw new Error('This book backup could not be read. Nothing was imported.') }
  valid(manifest?.format === 'arc-book' && [1, 2, 3].includes(manifest.version))
  for (const key of ['entities', 'snapshots', 'dependencies', 'illustrations']) valid(Array.isArray(manifest[key]))
  valid(manifest.entities.length <= 100_000 && manifest.illustrations.length <= 20_000)
  const entities: ArcEntity[] = manifest.entities
  valid(entities.every((entity) => entity && typeof entity.id === 'string' && entity.id.length > 0 && TYPES.has(entity.type) && Number.isFinite(entity.createdAt) && Number.isFinite(entity.updatedAt)))
  const byId = new Map(entities.map((entity) => [entity.id, entity]))
  valid(byId.size === entities.length)
  const books = entities.filter((entity) => entity.type === 'book')
  valid(books.length === 1 && typeof books[0].title === 'string')
  const book = books[0]
  valid(!book.parentId && !book.bookId)
  for (const entity of entities) {
    if (entity.type === 'series') { valid(!entity.parentId && !entity.bookId); continue }
    if (entity.type === 'book') continue
    if (['act', 'chapter', 'scene', 'note', 'codexEntry', 'summary', 'chat'].includes(entity.type)) valid(typeof entity.title === 'string')
    if (['note', 'codexEntry', 'summary', 'chatMessage'].includes(entity.type)) valid(typeof entity.content === 'string')
    if (entity.type === 'codexEntry') valid(typeof entity.category === 'string')
    if (entity.type === 'settings') valid(['ai', 'context-book'].includes(String(entity.settingsType)) && entity.value && typeof entity.value === 'object')
    valid(entity.bookId === book.id && typeof entity.parentId === 'string' && byId.has(entity.parentId))
    const visited = new Set([entity.id])
    let parent = byId.get(entity.parentId)
    while (parent && parent.id !== book.id) {
      valid(!visited.has(parent.id) && parent.type !== 'series')
      visited.add(parent.id)
      parent = byId.get(parent.parentId ?? '')
    }
    valid(parent?.id === book.id)
    if (entity.type === 'summary') valid(typeof entity.sourceEntityId === 'string' && ['act', 'chapter', 'scene', 'codexEntry'].includes(byId.get(entity.sourceEntityId)?.type ?? ''))
  }
  if (book.seriesId) valid(typeof book.seriesId === 'string' && byId.get(book.seriesId)?.type === 'series')
  const unique = (rows: any[]) => rows.every((row) => row && typeof row.id === 'string' && row.id.length > 0) && new Set(rows.map((row) => row.id)).size === rows.length
  valid(unique(manifest.snapshots) && unique(manifest.dependencies) && unique(manifest.illustrations))
  for (const snapshot of manifest.snapshots) valid(byId.has(snapshot.entityId) && typeof snapshot.content === 'string' && Number.isFinite(snapshot.createdAt))
  for (const edge of manifest.dependencies) valid(edge.bookId === book.id && byId.get(edge.sourceId)?.type === 'codexEntry' && byId.get(edge.targetId)?.type === 'codexEntry' && edge.sourceId !== edge.targetId)
  let offset = 12 + length
  const illustrations: Illustration[] = []
  const usedEntries = new Set<string>()
  for (const record of manifest.illustrations as StoredImage[]) {
    valid(record.bookId === book.id && byId.get(record.entryId)?.type === 'codexEntry' && !usedEntries.has(record.entryId))
    usedEntries.add(record.entryId)
    valid(byId.get(record.entryId)?.primaryImageId === record.id)
    valid(typeof record.caption === 'string' && typeof record.alt === 'string' && record.caption.length <= 2000 && record.alt.length <= 2000)
    valid(record.cropZoom === undefined || (Number.isFinite(record.cropZoom) && record.cropZoom >= 1 && record.cropZoom <= 4))
    valid([record.cropX, record.cropY].every((n) => Number.isFinite(n) && n >= 0 && n <= 100))
    valid(Number.isInteger(record.width) && Number.isInteger(record.height) && record.width > 0 && record.height > 0 && record.width <= 1600 && record.height <= 1600)
    for (const size of [record.imageSize, record.thumbnailSize]) valid(Number.isSafeInteger(size) && size > 0 && size <= 20 * 1024 * 1024)
    valid(offset + record.imageSize + record.thumbnailSize <= file.size)
    valid(['image/webp', 'image/png', 'image/jpeg'].includes(record.imageType) && ['image/webp', 'image/png', 'image/jpeg'].includes(record.thumbnailType))
    const image = file.slice(offset, offset += record.imageSize, record.imageType)
    const thumbnail = file.slice(offset, offset += record.thumbnailSize, record.thumbnailType)
    await assertImageFile(image)
    await assertImageFile(thumbnail)
    const { imageSize: _i, imageType: _it, thumbnailSize: _t, thumbnailType: _tt, ...details } = record
    illustrations.push({ ...details, image, thumbnail })
  }
  const galleryImages: GalleryImage[] = []
  const storedGallery = manifest.galleryImages ?? []
  valid(Array.isArray(storedGallery) && storedGallery.length <= 20000 && unique(storedGallery))
  for (const record of storedGallery as StoredGalleryImage[]) {
    valid(record.entryId === undefined && record.illustrationId === undefined)
    valid(record.provider === undefined || ['openai', 'nanogpt', 'pruna'].includes(record.provider))
    valid([record.model, record.modelAlias, record.bookTitle, record.requestedSize, record.revisedPrompt].every((value) => value === undefined || typeof value === 'string'))
    valid([record.seed, record.cost, record.durationMs].every((value) => value === undefined || Number.isFinite(value)))
    valid(record.bookId === book.id && record.kept === true && typeof record.prompt === 'string' && record.prompt.length <= 32000 && Number.isFinite(record.createdAt))
    valid(Number.isInteger(record.width) && Number.isInteger(record.height) && record.width > 0 && record.height > 0 && record.width * record.height <= 40_000_000)
    const kind = record.kind ?? 'image'
    valid(kind === 'image' || (manifest.version >= 3 && kind === 'video'))
    valid(Number.isSafeInteger(record.imageSize) && record.imageSize > 0 && record.imageSize <= (kind === 'video' ? 200 : 20) * 1024 * 1024)
    valid(Number.isSafeInteger(record.thumbnailSize) && record.thumbnailSize > 0 && record.thumbnailSize <= 20 * 1024 * 1024)
    valid(offset + record.imageSize + record.thumbnailSize <= file.size)
    valid((kind === 'video' ? ['video/mp4', 'video/webm'] : ['image/webp', 'image/png', 'image/jpeg']).includes(record.imageType) && ['image/webp', 'image/png', 'image/jpeg'].includes(record.thumbnailType))
    const image = file.slice(offset, offset += record.imageSize, record.imageType)
    const thumbnail = file.slice(offset, offset += record.thumbnailSize, record.thumbnailType)
    if (kind === 'video') await assertArchivedVideo(image); else await assertImageFile(image)
    await assertImageFile(thumbnail)
    const { imageSize: _i, imageType: _it, thumbnailSize: _t, thumbnailType: _tt, ...details } = record
    galleryImages.push({ ...details, image, thumbnail })
  }
  const imageJobs: ImageJob[] = manifest.imageJobs ?? []
  valid(Array.isArray(imageJobs) && imageJobs.length <= 100000 && unique(imageJobs))
  for (const job of imageJobs) {
    valid(job.bookId === book.id && job.status === 'completed' && job.decision === 'kept' && galleryImages.some((a) => a.id === job.assetId))
    valid(typeof job.prompt === 'string' && typeof job.modelAlias === 'string' && typeof job.model === 'string' && ['openai', 'nanogpt', 'pruna'].includes(job.provider) && typeof job.size?.value === 'string' && Number.isFinite(job.size.width) && Number.isFinite(job.size.height) && Number.isFinite(job.createdAt))
    if (job.messageId) valid(byId.get(job.messageId)?.type === 'chatMessage' && byId.get(job.messageId)?.parentId === job.chatId)
    valid(job.task === undefined || ['text-to-image', 'image-to-image', 'text-to-video', 'image-to-video'].includes(job.task))
    valid(job.sources === undefined)
    delete job.providerJobId; delete job.owner; delete job.heartbeat; delete job.sources
  }
  valid(offset === file.size)
  for (const entity of entities) if (entity.primaryImageId) valid(illustrations.some((image) => image.id === entity.primaryImageId && image.entryId === entity.id))
  return { entities, snapshots: manifest.snapshots, dependencies: manifest.dependencies, illustrations, galleryImages, imageJobs }
}

/** Import as a new book; preserve text verbatim while remapping structural references. */
export function copyBookArchive(data: BookArchiveData, newId = () => crypto.randomUUID()): { data: BookArchiveData; bookId: string } {
  const ids = new Map<string, string>()
  for (const entity of data.entities) if (entity.type !== 'settings' && entity.type !== 'summary') ids.set(entity.id, `${entity.type}-${newId()}`)
  for (const entity of data.entities) {
    if (entity.type === 'settings') {
      const kind = entity.settingsType === 'ai' ? 'ai' : entity.settingsType === 'context-book' ? 'context-book' : String(entity.settingsType)
      ids.set(entity.id, `settings-${kind}-${ids.get(entity.bookId!)}`)
    }
    if (entity.type === 'summary') ids.set(entity.id, `summary-${ids.get(String(entity.sourceEntityId))}`)
  }
  for (const asset of data.galleryImages ?? []) ids.set(asset.id, `generated-${newId()}`)
  for (const job of data.imageJobs ?? []) ids.set(job.id, `image-job-${newId()}`)
  for (const image of data.illustrations) ids.set(image.id, `image-${newId()}`)
  for (const row of [...data.entities, ...data.snapshots]) for (const item of documentBlocks(row.content ?? '')) if (!ids.has(item.block.id)) ids.set(item.block.id, `block-${newId()}`)
  const remap = (value: any, key = '', depth = 0): any => {
    if (depth > 80) throw new Error('This backup contains excessively nested data.')
    if (Array.isArray(value) && key === 'skillNoteIds') return value.map(id => ids.get(id) ?? `missing-skill-${id}`)
    if (Array.isArray(value)) return REF_ARRAYS.has(key) ? value.map((id) => ids.get(id)).filter(Boolean) : value.map((item) => remap(item, '', depth + 1))
    if (value && typeof value === 'object') {
      if (value instanceof Blob) return value
      return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, remap(item, name, depth + 1)]))
    }
    if (typeof value === 'string' && key === 'content') return remapDocumentBlocks(value, ids)
    if (typeof value === 'string' && (REF_KEYS.has(key) || key === 'id')) return ids.get(value) ?? (key === 'id' ? value : '')
    return value
  }
  const entities = data.entities.map((entity) => {
    const copy = remap(entity) as ArcEntity
    if (copy.type === 'chatMessage') { delete copy.continuation; delete copy.continuedAt }
    // Old chat proposals cannot safely apply to a newly imported book.
    if (copy.type === 'chatMessage') for (const key of ['documentEdits', 'codexCreations', 'outlineActions', 'entityActions', 'imageGenerations']) {
      if (Array.isArray(copy[key])) copy[key] = (copy[key] as any[]).map((proposal) => ({ ...proposal, status: 'stale' }))
    }
    return copy.type === 'settings' ? withoutKeys(copy) : copy
  })
  const book = entities.find((entity) => entity.type === 'book')!
  book.title = `${book.title} (imported)`
  book.updatedAt = Date.now()
  return { bookId: book.id, data: {
    entities,
    snapshots: data.snapshots.map((row) => ({ ...remap(row), id: `snapshot-${newId()}` })),
    dependencies: data.dependencies.map((row) => ({ ...remap(row), id: `dependency-${newId()}` })),
    illustrations: data.illustrations.map((row) => remap(row)),
    galleryImages: data.galleryImages?.map((row) => remap(row)),
    imageJobs: data.imageJobs?.map((row) => remap(row)),
  } }
}

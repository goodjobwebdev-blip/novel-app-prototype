import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import 'fake-indexeddb/auto'
const storage = new Map()
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) }
globalThis.window = new EventTarget()
window.localStorage = localStorage
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const url = new URL(specifier + '.ts', context.parentURL)
    if (existsSync(fileURLToPath(url))) return next(url.href, context)
  }
  return next(specifier, context)
} })
const p = await import('../src/data/persistence.ts')
const w = await import('../src/features/worlds/world-service.ts')
const { initialAiSettings } = await import('../src/shared/ai/ai-settings.ts')
const { articleLink, articleLinkIds } = await import('../src/features/codex/codex-article-links.ts')
const { copyBookArchive, encodeBookArchive, decodeBookArchive } = await import('../src/data/book-archive.ts')
after(async () => (await p.database()).close())

function linkedContent(id) {
  const encoded = encodeURIComponent(id).replace(/[()]/g, c => c === '(' ? '%28' : '%29')
  return {
    actual: `${articleLink(id, 'Article')}\n[Angle](<arc-codex:${encoded}> "Title")`,
    examples: `\n\n\`${articleLink(id, 'Inline example')}\`\n\n\`\`\`md\n${articleLink(id, 'Fenced example')}\n\`\`\`\n\n~~~markdown\n${articleLink(id, 'Tilde example')}\n~~~\n\n[External](https://example.com/arc-codex:${encoded})\n![Image](arc-codex:${encoded})\nPlain arc-codex:${encoded}\n`,
  }
}

test('independent Book copy remaps Markdown destinations in documents, snapshots and checkpoints, not examples or unrelated URLs', async () => {
  const book = { id: 'source-book', type: 'book', title: 'Source', createdAt: 1, updatedAt: 1 }
  const id = 'entry (encoded)/雪', { actual, examples } = linkedContent(id)
  const content = actual + examples
  const entry = { id, type: 'codexEntry', bookId: book.id, parentId: book.id, title: 'Article', category: 'Character', content, createdAt: 1, updatedAt: 1,
    checkpoints: [{ id: 'checkpoint', label: 'Checkpoint', anchorBookId: book.id, sceneId: 'scene', content, revision: 1 }] }
  const data = { entities: [book, entry], snapshots: [{ id: 'snapshot', entityId: id, entityType: 'codexEntry', content, createdAt: 1 }], dependencies: [], illustrations: [] }
  let sequence = 0
  const copied = copyBookArchive(data, () => String(++sequence)).data
  const imported = copied.entities.find(row => row.type === 'codexEntry')
  const expected = linkedContent(imported.id).actual + examples
  assert.notEqual(imported.id, id)
  assert.equal(imported.content, expected)
  assert.equal(copied.snapshots[0].content, expected)
  assert.equal(imported.checkpoints[0].content, expected)
  assert.deepEqual(articleLinkIds(imported.content), [imported.id])
  assert.equal(entry.content, content)
})

test('World-to-Book snapshot remaps World article destinations from local and shared documents to snapshot IDs', async () => {
  const world = await w.createWorld('Archive links World')
  const { book } = await p.createBook(initialAiSettings, 'Snapshot links Book')
  await w.setBookWorld(book.id, world.id)
  const shared = await p.createCodexEntry(world.id, 'Shared article')
  const local = await p.createCodexEntry(book.id, 'Local article')
  const { actual, examples } = linkedContent(shared.id), content = actual + examples
  await p.saveDocumentContent(shared.id, content)
  await p.saveDocumentContent(local.id, content)
  const data = await p.readBookArchive(book.id)
  const snapshot = data.entities.find(row => row.type === 'codexEntry' && row.title === shared.title)
  const expected = linkedContent(snapshot.id).actual + examples
  assert.notEqual(snapshot.id, shared.id)
  assert.equal(snapshot.content, expected)
  assert.equal(data.entities.find(row => row.id === local.id).content, expected)
  assert.equal((await p.getEntity(shared.id)).content, content)
  const decoded = await decodeBookArchive(encodeBookArchive(data))
  assert.deepEqual(articleLinkIds(decoded.entities.find(row => row.id === snapshot.id).content), [snapshot.id])
})

test('Book backup after persisted workspace navigation roundtrips without exporting local navigation settings', async () => {
  const { book } = await p.createBook(initialAiSettings, 'Opened Book')
  const entry = await p.createCodexEntry(book.id, 'Opened article')
  await p.saveOwnerWorkspaceState(book.id, { lastOpenedCodexEntryId: entry.id })
  assert.equal((await p.getOwnerWorkspaceState(book.id)).lastOpenedCodexEntryId, entry.id)
  const data = await p.readBookArchive(book.id)
  const decoded = await decodeBookArchive(encodeBookArchive(data))
  assert.equal(decoded.entities.some(row => row.settingsType === 'workspace-owner'), false)
  assert.equal(data.entities.some(row => row.settingsType === 'workspace-owner'), false)
  assert.ok(decoded.entities.some(row => row.settingsType === 'profiles-book'))
  assert.ok(decoded.entities.some(row => row.id === entry.id))
  // Callers with pre-portability data must also be safe at encode/copy boundaries.
  const navigation = await p.getEntity(`settings-workspace-${book.id}`)
  assert.equal(navigation.settingsType, 'workspace-owner')
  const raw = { ...data, entities: [...data.entities, navigation] }
  const rawDecoded = await decodeBookArchive(encodeBookArchive(raw))
  assert.equal(rawDecoded.entities.some(row => row.settingsType === 'workspace-owner'), false)
  const copied = copyBookArchive(raw)
  assert.equal(copied.data.entities.some(row => row.settingsType === 'workspace-owner'), false)
  await decodeBookArchive(encodeBookArchive(copied.data))
  assert.equal((await p.getOwnerWorkspaceState(book.id)).lastOpenedCodexEntryId, entry.id)
})

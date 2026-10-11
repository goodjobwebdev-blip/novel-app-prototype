import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test from 'node:test'
import assert from 'node:assert/strict'

const { persistenceTestEnvironment, withTransactionPaused, structuralRows } = await import('./persistence-test-fixture.mjs')
const { p, db, book } = await persistenceTestEnvironment()

const metadataCases = [
  {
    name: 'rename',
    mutate: id => p.renameEntity(id, '  Renamed entry  '),
    check: entity => assert.equal(entity.title, 'Renamed entry'),
  },
  {
    name: 'archive',
    mutate: id => p.archiveCodexEntry(id),
    check: entity => assert.equal(p.isCodexEntryArchived(entity), true),
  },
  {
    name: 'restore',
    prepare: id => p.archiveCodexEntry(id),
    mutate: id => p.restoreCodexEntry(id),
    check: entity => {
      assert.equal(p.isCodexEntryArchived(entity), false)
      assert.equal(Object.hasOwn(entity, 'archivedAt'), false)
    },
  },
  {
    name: 'category',
    mutate: id => p.updateCodexCategory(id, 'Place'),
    check: entity => {
      assert.equal(entity.category, 'Place')
      assert.equal(entity.typeId, 'lore-place')
    },
  },
  {
    name: 'summary preference',
    mutate: id => p.updateCodexSummaryPreference(id, true),
    check: entity => assert.equal(entity.preferSummaryForContext, true),
  },
  {
    name: 'automatic triggers',
    mutate: id => p.updateCodexAutoIncludeTriggers(id, ['  Silver   Gate ', 'silver gate', '', 'Moon']),
    check: entity => assert.deepEqual(entity.autoIncludeTriggers, ['Silver Gate', 'Moon']),
  },
]

function metadata(entity) {
  return {
    title: entity.title, category: entity.category, typeId: entity.typeId,
    archivedAt: entity.archivedAt, preferSummaryForContext: entity.preferSummaryForContext,
    autoIncludeTriggers: entity.autoIncludeTriggers,
  }
}

for (const scenario of metadataCases) {
  for (const paused of ['metadata', 'content']) {
    test(`${scenario.name} and content both survive when ${paused} waits for its write transaction`, async t => {
      const f = await book(t)
      const entry = await p.createCodexEntry(f.book.id, 'Original entry', 'Character')
      await p.saveDocumentContent(entry.id, 'Original body')
      await scenario.prepare?.(entry.id)
      const summary = await p.getOrCreateSummary(await p.getEntity(entry.id))
      await p.saveSummaryContent(summary.id, 'Existing summary body', 1)
      const before = await p.getEntity(entry.id)
      let metadataResult
      const changeMetadata = async () => { metadataResult = await scenario.mutate(entry.id); return metadataResult }
      const changeContent = () => p.saveDocumentContent(entry.id, 'Latest body committed during the race')
      await withTransactionPaused(t, db,
        paused === 'metadata' ? changeMetadata : changeContent,
        paused === 'metadata' ? changeContent : changeMetadata,
      )
      const saved = await p.getEntity(entry.id)
      assert.equal(saved.content, 'Latest body committed during the race')
      scenario.check(saved)
      assert.deepEqual(metadata(saved), metadata(metadataResult), 'The content write preserves all committed metadata fields')
      assert.equal(saved.id, before.id)
      assert.equal(saved.bookId, before.bookId)
      assert.equal(saved.parentId, before.parentId)
      assert.equal(saved.createdAt, before.createdAt)
      assert.equal(saved.codexStatus, before.codexStatus)
      assert.equal(typeof saved.sourceRevision, 'number')
      const savedSummary = await p.getEntity(summary.id)
      assert.equal(savedSummary.content, 'Existing summary body')
      assert.equal(savedSummary.title, `${saved.title} summary`)
    })
  }
}

test('scene rename and body save both survive an overlapping rename', async t => {
  const f = await book(t)
  const summary = await p.getOrCreateSummary(f.scene)
  await withTransactionPaused(t, db,
    () => p.renameEntity(f.scene.id, 'Renamed scene'),
    () => p.saveDocumentContent(f.scene.id, 'Latest scene prose'),
  )
  const scene = await p.getEntity(f.scene.id)
  assert.equal(scene.content, 'Latest scene prose')
  assert.equal(scene.title, 'Renamed scene')
  assert.equal((await p.getEntity(summary.id)).title, 'Renamed scene summary')
})

test('structural move preserves the latest bodies of both swapped siblings', async t => {
  const f = await book(t)
  const second = await p.createStructuralEntity('scene', f.book.id, f.chapter.id, 'Second scene')
  await withTransactionPaused(t, db,
    () => p.moveStructuralEntity(f.scene.id, 1),
    async () => {
      await p.saveDocumentContent(f.scene.id, 'First latest body')
      await p.saveDocumentContent(second.id, 'Second latest body')
      await p.renameEntity(second.id, 'Renamed second scene')
    },
  )
  assert.deepEqual(await structuralRows(p, [f.scene.id, second.id]), [
    { id: f.scene.id, parentId: f.chapter.id, order: 1, content: 'First latest body', title: f.scene.title },
    { id: second.id, parentId: f.chapter.id, order: 0, content: 'Second latest body', title: 'Renamed second scene' },
  ])
  await p.moveStructuralEntity(f.scene.id, -1)
  assert.deepEqual((await structuralRows(p, [f.scene.id, second.id])).map(row => row.order), [0, 1])
  assert.equal((await p.getEntity(second.id)).content, 'Second latest body')
})

test('same-parent placement reorders every sibling without replacing their latest bodies', async t => {
  const f = await book(t)
  const second = await p.createStructuralEntity('scene', f.book.id, f.chapter.id, 'Second scene')
  const third = await p.createStructuralEntity('scene', f.book.id, f.chapter.id, 'Third scene')
  const ids = [f.scene.id, second.id, third.id]
  await withTransactionPaused(t, db,
    () => p.placeStructuralEntity(third.id, f.chapter.id, f.scene.id),
    async () => { for (const [index, id] of ids.entries()) await p.saveDocumentContent(id, `Latest body ${index}`) },
  )
  const rows = await structuralRows(p, ids)
  assert.deepEqual(rows.map(row => row.order), [1, 2, 0])
  assert.deepEqual(rows.map(row => row.parentId), ids.map(() => f.chapter.id))
  assert.deepEqual(rows.map(row => row.content), ['Latest body 0', 'Latest body 1', 'Latest body 2'])
})

test('reparenting preserves latest bodies in the moved, source and destination siblings', async t => {
  const f = await book(t)
  const sourceSibling = await p.createStructuralEntity('scene', f.book.id, f.chapter.id, 'Source sibling')
  const destination = await p.createStructuralEntity('chapter', f.book.id, f.book.id, 'Destination chapter')
  const targetSibling = await p.createStructuralEntity('scene', f.book.id, destination.id, 'Target sibling')
  const ids = [f.scene.id, sourceSibling.id, targetSibling.id]
  const summary = await p.getOrCreateSummary(f.scene)
  await withTransactionPaused(t, db,
    () => p.placeStructuralEntity(f.scene.id, destination.id, targetSibling.id),
    async () => { for (const [index, id] of ids.entries()) await p.saveDocumentContent(id, `Latest body ${index}`) },
  )
  const rows = await structuralRows(p, ids)
  assert.deepEqual(rows.map(row => row.parentId), [destination.id, f.chapter.id, destination.id])
  assert.deepEqual(rows.map(row => row.order), [0, 0, 1])
  assert.deepEqual(rows.map(row => row.content), ['Latest body 0', 'Latest body 1', 'Latest body 2'])
  assert.equal((await p.getEntity(summary.id)).parentId, f.scene.id, 'The summary remains attached to its moved source')
})

test('a body save waiting for its transaction preserves a committed reparent', async t => {
  const f = await book(t)
  const destination = await p.createStructuralEntity('chapter', f.book.id, f.book.id, 'Destination chapter')
  const sibling = await p.createStructuralEntity('scene', f.book.id, destination.id, 'Destination sibling')
  await withTransactionPaused(t, db,
    () => p.saveDocumentContent(f.scene.id, 'Body saved after reparenting'),
    () => p.placeStructuralEntity(f.scene.id, destination.id),
  )
  const rows = await structuralRows(p, [sibling.id, f.scene.id])
  assert.deepEqual(rows.map(row => row.parentId), [destination.id, destination.id])
  assert.deepEqual(rows.map(row => row.order), [0, 1])
  assert.equal(rows[1].content, 'Body saved after reparenting')
})

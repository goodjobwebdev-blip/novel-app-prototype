import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test from 'node:test'
import assert from 'node:assert/strict'

const { persistenceTestEnvironment, withTransactionPaused } = await import('./persistence-test-fixture.mjs')
const { p, db, book } = await persistenceTestEnvironment()

const writers = [
  { name: 'document', save: f => p.saveDocumentContent(f.scene.id, 'Late document body'), missing: /Cannot save missing entity/ },
  { name: 'summary', save: f => p.saveSummaryContent(f.summary.id, 'Late summary body', 123), missing: /Cannot save missing summary/ },
  { name: 'snapshot', save: f => p.createSnapshot(f.scene.id, 'manual', 'Late snapshot body'), missing: /Cannot snapshot missing entity/ },
]

async function fixture(t) {
  const f = await book(t)
  await p.saveDocumentContent(f.scene.id, 'Original document body')
  const summary = await p.getOrCreateSummary(await p.getEntity(f.scene.id))
  await p.saveSummaryContent(summary.id, 'Original summary body', 1)
  await p.createSnapshot(f.scene.id, 'manual')
  await p.createSnapshot(summary.id, 'manual')
  return { ...f, summary }
}

async function assertTreeGone(f) {
  assert.equal(await p.getEntity(f.scene.id), undefined, 'The source must not be resurrected')
  assert.equal(await p.getEntity(f.summary.id), undefined, 'The summary must not be resurrected')
  assert.deepEqual(await p.listSnapshots(f.scene.id), [], 'No source snapshot may outlive the deleted source')
  assert.deepEqual(await p.listSnapshots(f.summary.id), [], 'No summary snapshot may outlive the deleted summary')
  assert.equal((await p.getEntity(f.chapter.id)).id, f.chapter.id, 'The parent outside the deleted subtree survives')
  assert.equal((await p.getEntity(f.book.id)).id, f.book.id, 'The owning book survives')
}

for (const writer of writers) {
  test(`deleting a source while its ${writer.name} write waits rejects the stale write without resurrection`, async t => {
    const f = await fixture(t)
    let deleted
    await assert.rejects(() => withTransactionPaused(t, db,
      () => writer.save(f),
      async () => { deleted = await p.deleteEntityTree(f.scene.id) },
    ), writer.missing)
    assert.deepEqual([...deleted].sort(), [f.scene.id, f.summary.id].sort())
    await assertTreeGone(f)
    // A fresh invocation after deletion has the same liveness contract.
    await assert.rejects(() => writer.save(f), writer.missing)
    await assertTreeGone(f)
  })

  test(`deletion removes a ${writer.name} write committed while deletion waits`, async t => {
    const f = await fixture(t)
    const deleted = await withTransactionPaused(t, db,
      () => p.deleteEntityTree(f.scene.id),
      async () => {
        const result = await writer.save(f)
        // Prove the competing operation really committed before deletion ran.
        if (writer.name === 'snapshot') {
          assert.equal((await p.readSnapshot(result.id)).content, 'Late snapshot body')
        } else {
          assert.equal((await p.getEntity(result.id)).content, writer.name === 'summary' ? 'Late summary body' : 'Late document body')
          if (writer.name === 'summary') assert.equal(result.summarizedSourceRevision, 123)
        }
      },
    )
    assert.deepEqual([...deleted].sort(), [f.scene.id, f.summary.id].sort())
    await assertTreeGone(f)
  })
}

test('subtree deletion includes children, summaries and snapshots committed while deletion waits', async t => {
  const f = await fixture(t)
  const survivorChapter = await p.createStructuralEntity('chapter', f.book.id, f.book.id, 'Surviving chapter')
  const survivor = await p.createStructuralEntity('scene', f.book.id, survivorChapter.id, 'Surviving scene')
  await p.saveDocumentContent(survivor.id, 'Untouched surviving body')
  const survivorSnapshot = await p.createSnapshot(survivor.id, 'manual')
  let lateChild, lateSummary, lateSnapshot
  const deleted = await withTransactionPaused(t, db,
    () => p.deleteEntityTree(f.chapter.id),
    async () => {
      lateChild = await p.createStructuralEntity('scene', f.book.id, f.chapter.id, 'Child created during deletion')
      await p.saveDocumentContent(lateChild.id, 'New child body')
      lateSummary = await p.getOrCreateSummary(await p.getEntity(lateChild.id))
      await p.saveSummaryContent(lateSummary.id, 'New child summary', 42)
      lateSnapshot = await p.createSnapshot(lateChild.id, 'manual')
      await p.createSnapshot(lateSummary.id, 'manual')
    },
  )
  const expected = [f.chapter.id, f.scene.id, f.summary.id, lateChild.id, lateSummary.id].sort()
  assert.deepEqual([...deleted].sort(), expected, 'The deletion returns the final subtree, not an earlier captured tree')
  for (const id of expected) {
    assert.equal(await p.getEntity(id), undefined, `Deleted descendant ${id} is absent`)
    assert.deepEqual(await p.listSnapshots(id), [], `Deleted descendant ${id} has no snapshots`)
  }
  assert.equal(await p.readSnapshot(lateSnapshot.id), undefined)
  assert.equal((await p.getEntity(survivor.id)).content, 'Untouched surviving body')
  assert.equal((await p.getEntity(survivor.id)).parentId, survivorChapter.id)
  assert.equal((await p.readSnapshot(survivorSnapshot.id)).content, 'Untouched surviving body')
  assert.equal((await p.getEntity(f.book.id)).id, f.book.id)
  const remaining = await db.table('entities').where('bookId').equals(f.book.id).toArray()
  assert.equal(remaining.some(entity => expected.includes(entity.parentId)), false, 'No orphan still points into the deleted subtree')
})

test('book subtree deletion removes document, summary and snapshot writes across its descendants', async t => {
  const f = await fixture(t)
  const chapter = await p.createStructuralEntity('chapter', f.book.id, f.book.id, 'Another chapter')
  const scene = await p.createStructuralEntity('scene', f.book.id, chapter.id, 'Another scene')
  const summary = await p.getOrCreateSummary(scene)
  const note = await p.createNote(f.book.id, 'Book note')
  const deleted = await withTransactionPaused(t, db,
    () => p.deleteEntityTree(f.book.id),
    async () => {
      await p.saveDocumentContent(scene.id, 'Latest descendant body')
      await p.saveSummaryContent(summary.id, 'Latest descendant summary', 55)
      await p.createSnapshot(scene.id, 'manual')
      await p.createSnapshot(summary.id, 'manual')
      await p.saveDocumentContent(note.id, 'Latest note body')
      await p.createSnapshot(note.id, 'manual')
    },
  )
  const expected = [f.book.id, f.chapter.id, f.scene.id, f.summary.id, chapter.id, scene.id, summary.id, note.id]
  for (const id of expected) {
    assert.ok(deleted.includes(id), `The deletion includes ${id}`)
    assert.equal(await p.getEntity(id), undefined)
    assert.deepEqual(await p.listSnapshots(id), [])
  }
  assert.equal(await db.table('entities').where('bookId').equals(f.book.id).count(), 0, 'Book-owned settings are deleted along with document descendants')
})

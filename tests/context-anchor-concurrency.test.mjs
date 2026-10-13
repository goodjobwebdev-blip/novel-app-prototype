import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test from 'node:test'
import assert from 'node:assert/strict'

const { persistenceTestEnvironment, withTransactionPaused } = await import('./persistence-test-fixture.mjs')
const { p, db, book } = await persistenceTestEnvironment()
const { createWorld, deleteWorld } = await import('../src/features/worlds/world-service.ts')

async function fixture(t) {
  const f = await book(t)
  const second = await p.createStructuralEntity('scene', f.book.id, f.chapter.id, 'Second scene')
  const note = await p.createNote(f.book.id, 'Selected note')
  const entry = await p.createCodexEntry(f.book.id, 'Selected entry', 'Character')
  const initial = await p.getBookContextSettings(f.book.id)
  initial.lastOpenedSceneId = f.scene.id
  await p.saveBookContextSettings(f.book.id, initial)
  const edited = structuredClone(initial)
  edited.previousScenesForCodexTriggers = 5
  for (const type of ['scene', 'codex', 'note', 'chat']) {
    edited.profiles[type] = {
      includeLastScene: false,
      includePreviousSceneWhenEmpty: false,
      structuralIds: [f.chapter.id, second.id],
      noteIds: [note.id],
      codexEntryIds: [entry.id],
      loreAtCurrentScene: true,
      summaryRange: 'before',
    }
  }
  return { ...f, second, initial, edited }
}

function assertSelections(actual, expected) {
  assert.equal(actual.previousScenesForCodexTriggers, expected.previousScenesForCodexTriggers)
  assert.deepEqual(actual.profiles, expected.profiles)
}

for (const paused of ['sidebar', 'navigation']) {
  test(`context selections and navigation anchor both survive when ${paused} waits for its write lock`, async t => {
    const f = await fixture(t)
    const sidebar = () => p.saveBookContextSettings(f.book.id, f.edited, { preserveSceneAnchor: true })
    const navigation = () => p.rememberLastOpenedScene(f.book.id, f.second.id)
    const result = await withTransactionPaused(t, db,
      paused === 'sidebar' ? sidebar : navigation,
      paused === 'sidebar' ? navigation : sidebar,
    )
    assert.equal(result.lastOpenedSceneId, f.second.id)
    assertSelections(result, f.edited)
    const saved = await p.getBookContextSettings(f.book.id)
    assert.equal(saved.lastOpenedSceneId, f.second.id)
    assertSelections(saved, f.edited)
    assert.equal(f.edited.lastOpenedSceneId, f.scene.id, 'Saving does not mutate the sidebar snapshot')
  })
}

// Hold the first transaction's result only AFTER its real write lock is released.
// The old read-then-save navigation API would now resume with a stale profile snapshot.
async function withFirstTransactionResultPaused(t, operation, whilePaused) {
  let release, entered, claimed = false, timer, pending
  const gate = new Promise(resolve => { release = resolve })
  const reached = new Promise(resolve => { entered = resolve })
  const original = db.transaction
  const interception = t.mock.method(db, 'transaction', function (...args) {
    const result = original.apply(this, args)
    if (claimed) return result
    claimed = true
    return result.then(async value => {
      entered()
      await gate
      return value
    })
  })
  const cleanup = async () => {
    clearTimeout(timer)
    release()
    interception.mock.restore()
    await pending?.catch(() => undefined)
  }
  t.after(cleanup)
  try {
    pending = Promise.resolve().then(operation)
    pending.catch(() => undefined)
    await Promise.race([
      reached,
      pending.then(() => { throw new Error('Operation completed without pausing its transaction result') }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Operation did not reach its transaction result')), 5000)
      }),
    ])
    clearTimeout(timer)
    await whilePaused()
    release()
    return await pending
  } finally {
    await cleanup()
  }
}

test('rememberLastOpenedScene cannot overwrite profiles committed before its transaction result returns', async t => {
  const f = await fixture(t)
  await withFirstTransactionResultPaused(t,
    () => p.rememberLastOpenedScene(f.book.id, f.second.id),
    () => p.saveBookContextSettings(f.book.id, f.edited, { preserveSceneAnchor: true }),
  )
  const saved = await p.getBookContextSettings(f.book.id)
  assert.equal(saved.lastOpenedSceneId, f.second.id)
  assertSelections(saved, f.edited)
})

test('sidebar saves preserve the persisted anchor even when their snapshot has a different or empty anchor', async t => {
  const f = await fixture(t)
  await p.rememberLastOpenedScene(f.book.id, f.second.id)
  for (const lastOpenedSceneId of [f.scene.id, '']) {
    const value = { ...f.edited, lastOpenedSceneId }
    const result = await p.saveBookContextSettings(f.book.id, value, { preserveSceneAnchor: true })
    assert.equal(result.lastOpenedSceneId, f.second.id)
    assertSelections(result, f.edited)
    const saved = await p.getBookContextSettings(f.book.id)
    assert.equal(saved.lastOpenedSceneId, f.second.id)
    assertSelections(saved, f.edited)
    assert.equal(value.lastOpenedSceneId, lastOpenedSceneId)
  }
})

test('default and explicitly disabled preservation retain whole-record replacement semantics', async t => {
  const f = await fixture(t)
  for (const options of [undefined, {}, { preserveSceneAnchor: false }]) {
    await p.rememberLastOpenedScene(f.book.id, f.second.id)
    const result = await p.saveBookContextSettings(f.book.id, f.edited, options)
    assert.equal(result.lastOpenedSceneId, f.scene.id)
    assertSelections(result, f.edited)
    assert.equal((await p.getBookContextSettings(f.book.id)).lastOpenedSceneId, f.scene.id)
  }
})

test('preserving an absent settings record uses an empty persisted anchor, not the stale caller anchor', async t => {
  const f = await fixture(t)
  await db.table('entities').delete(`settings-context-book-${f.book.id}`)
  const result = await p.saveBookContextSettings(f.book.id, f.edited, { preserveSceneAnchor: true })
  assert.equal(result.lastOpenedSceneId, '')
  assertSelections(result, f.edited)
  assert.equal((await p.getBookContextSettings(f.book.id)).lastOpenedSceneId, '')
})

test('navigation initializes missing settings and leaves an unchanged anchor record untouched', async t => {
  const f = await fixture(t)
  const recordId = `settings-context-book-${f.book.id}`
  await db.table('entities').delete(recordId)
  const result = await p.rememberLastOpenedScene(f.book.id, f.second.id)
  assert.equal(result.lastOpenedSceneId, f.second.id)
  const before = await db.table('entities').get(recordId)
  assert.ok(before, 'Navigation recreates missing context settings')
  const unchanged = await p.rememberLastOpenedScene(f.book.id, f.second.id)
  assert.deepEqual(unchanged, result)
  assert.deepEqual(await db.table('entities').get(recordId), before)
})

test('World calls accept sidebar preservation without introducing a scene anchor', async t => {
  const world = await createWorld(t.name)
  t.after(async () => {
    for (const note of await p.listEntitiesByOwner(world.id, 'note')) await p.deleteEntityTree(note.id)
    await deleteWorld(world.id)
  })
  const note = await p.createNote(world.id, 'World note')
  const value = await p.getBookContextSettings(world.id)
  value.lastOpenedSceneId = 'stale-book-scene'
  value.profiles.chat.noteIds = [note.id]
  const saved = await p.saveBookContextSettings(world.id, value, { preserveSceneAnchor: true })
  assert.equal(saved.lastOpenedSceneId, '')
  assert.deepEqual(saved.profiles.chat.noteIds, [note.id])
  const remembered = await p.rememberLastOpenedScene(world.id, 'another-book-scene')
  assert.equal(remembered.lastOpenedSceneId, '')
  assert.deepEqual(remembered.profiles.chat.noteIds, [note.id])
  assert.equal((await p.getBookContextSettings(world.id)).lastOpenedSceneId, '')
})

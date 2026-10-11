import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import 'fake-indexeddb/auto'

const storage = new Map()
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) }
globalThis.window = new EventTarget()
window.localStorage = localStorage
registerHooks({ resolve(specifier, context, next) { if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) { const url = new URL(specifier + '.ts', context.parentURL); if (existsSync(fileURLToPath(url))) return next(url.href, context) } return next(specifier, context) } })
const p = await import('../src/data/persistence.ts')
const profiles = await import('../src/features/settings/settings-profiles.ts')
// A second module instance models another tab's independent reference queue while
// retaining real IndexedDB transactions and a shared settings library.
const otherTabProfiles = await import('../src/features/settings/settings-profiles.ts?world-reference-tab')
const worlds = await import('../src/features/worlds/world-service.ts')
afterEach(async () => (await p.database()).table('entities').clear())
after(async () => (await p.database()).close())

async function fixture(title) {
  const world = await worlds.createWorld(title)
  const value = await p.getWorldProfileSelections(world.id)
  const profile = profiles.createSettingsProfile('text', title)
  const db = await p.database()
  const recordId = `settings-profiles-book-${world.id}`
  return { world, value, profile, db, recordId }
}

function pauseSecondWrite(db) {
  const original = db.transaction
  let release, entered, writes = 0
  const gate = new Promise(resolve => { release = resolve })
  const paused = new Promise(resolve => { entered = resolve })
  db.transaction = function (...args) {
    if (args[0] === 'rw' && args.length === 3 && args[1].name === 'entities' && ++writes === 2) {
      // Pause before acquiring a transaction, never inside an IndexedDB lock.
      db.transaction = original
      entered()
      return gate.then(() => original.apply(this, args))
    }
    return original.apply(this, args)
  }
  return { paused, release, restore: () => { db.transaction = original } }
}

const outcome = operation => operation.then(value => ({ value }), error => ({ error }))

for (const field of ['bookId', 'worldId', 'settingsType']) {
  test(`World profile ownership rejects a competing ${field} change before saving`, async () => {
    const f = await fixture(`World profile ${field} ownership race`)
    const original = await f.db.table('entities').get(f.recordId)
    const pause = pauseSecondWrite(f.db)
    const saving = outcome(p.saveWorldProfileSelections(f.world.id, { ...f.value, text: f.profile.id }))
    const changed = { ...original, [field]: field === 'settingsType' ? 'profiles-book' : 'another-owner' }
    try {
      await pause.paused
      if (field === 'settingsType') {
        await f.db.table('entities').put(changed)
        pause.release()
        const result = await saving
        assert.match(result.error?.message ?? '', /World profiles changed/)
        assert.deepEqual(await f.db.table('entities').get(f.recordId), changed)
      } else {
        // Canonical-owner validation rejects the competing raw mutation before
        // it can corrupt the row. The queued legitimate save may then finish.
        await assert.rejects(f.db.table('entities').put(changed), /canonical.*owner/i)
        assert.deepEqual(await f.db.table('entities').get(f.recordId), original)
        pause.release()
        const result = await saving
        assert.equal(result.error, undefined)
        assert.equal((await f.db.table('entities').get(f.recordId)).value.text, f.profile.id)
      }
    } finally { pause.release(); pause.restore(); await saving }
  })
}

test('World profile save does not recreate settings after its World is deleted before the write lock', async () => {
  const f = await fixture('World owner deleted before saving')
  const pause = pauseSecondWrite(f.db)
  const saving = outcome(p.saveWorldProfileSelections(f.world.id, { ...f.value, text: f.profile.id }))
  try {
    await pause.paused
    await f.db.transaction('rw', f.db.table('entities'), async () => {
      await f.db.table('entities').where('bookId').equals(f.world.id).delete()
      await f.db.table('entities').delete(f.world.id)
    })
    pause.release()
    const result = await saving
    assert.match(result.error?.message ?? '', /World no longer exists/)
    assert.equal(await f.db.table('entities').get(f.recordId), undefined)
    assert.equal(await f.db.table('entities').get(f.world.id), undefined)
  } finally { pause.release(); pause.restore(); await saving }
})

test('World profile save rejects a profile deleted by another tab before its write lock', async () => {
  const f = await fixture('World selection loses deletion race')
  const original = await f.db.table('entities').get(f.recordId)
  const pause = pauseSecondWrite(f.db)
  const saving = outcome(p.saveWorldProfileSelections(f.world.id, { ...f.value, text: f.profile.id }))
  try {
    await pause.paused
    await otherTabProfiles.deleteSettingsProfile(f.profile.id)
    pause.release()
    const result = await saving
    assert.match(result.error?.message ?? '', /unavailable/)
    assert.deepEqual(await f.db.table('entities').get(f.recordId), original)
    assert.equal(profiles.loadSettingsProfiles().profiles.some(profile => profile.id === f.profile.id), false)
  } finally { pause.release(); pause.restore(); await saving }
})

test('profile deletion rechecks World references committed by another tab after preflight', async () => {
  const f = await fixture('World selection wins deletion race')
  const pause = pauseSecondWrite(f.db)
  // Usage preflight reads this World's selections in the first rw transaction;
  // deletion's second rw transaction is held until the selection commits.
  const deleting = outcome(otherTabProfiles.deleteSettingsProfile(f.profile.id))
  try {
    await pause.paused
    await p.saveWorldProfileSelections(f.world.id, { ...f.value, text: f.profile.id })
    pause.release()
    const result = await deleting
    assert.match(result.error?.message ?? '', /used/)
    assert.ok(profiles.loadSettingsProfiles().profiles.some(profile => profile.id === f.profile.id))
    assert.equal((await f.db.table('entities').get(f.recordId)).value.text, f.profile.id)
  } finally { pause.release(); pause.restore(); await deleting }
})

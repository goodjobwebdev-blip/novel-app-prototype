import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { stripTypeScriptTypes } from 'node:module'

// Execute the actual Workspace scheduler with controlled time and sync I/O.
const source = readFileSync(new URL('../src/app/Workspace.tsx', import.meta.url), 'utf8')
const start = source.indexOf('  function scheduleAutomaticSync()')
const end = source.indexOf('  function handleStoryChange(', start)
assert.ok(start >= 0 && end > start)
const scheduler = stripTypeScriptTypes(source.slice(start, end))
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

function fixture(type = 'book', connected = true) {
  let automaticUpload = true, connection = connected, nextTimer = 0
  const timers = new Map(), calls = [], errors = []
  const context = {
    Error,
    currentBookRef: { current: { id: 'local-owner', type } },
    currentBookIdRef: { current: 'local-owner' }, autoSyncTimerRef: { current: null },
    loadSyncSettings: () => ({ automaticUpload }),
    getSyncLink: async () => connection ? { bookId: 'local-owner' } : undefined,
    getBookSyncState: async () => connection ? { status: 'synced' } : undefined,
    getWorldSyncState: async () => connection ? { worldId: 'local-owner' } : undefined,
    prepareBookExport: async () => {}, importedBook: async () => {}, refreshWorldCodexWorkspace: async () => {},
    syncBookNow: async id => { calls.push(['book', id]); return { kind: 'unchanged' } },
    syncWorldNow: async id => { calls.push(['world', id]); return { kind: 'unchanged' } },
    showToast: message => errors.push(message),
    window: {
      setTimeout: (callback, delay) => { assert.equal(delay, 120000); const id = ++nextTimer; timers.set(id, callback); return id },
      clearTimeout: id => timers.delete(id),
    },
  }
  const schedule = runInNewContext(`${scheduler}\nscheduleAutomaticSync`, context)
  return { context, schedule, timers, calls, errors,
    disconnect: () => { connection = false }, disable: () => { automaticUpload = false },
    fire: async () => { const callbacks = [...timers.values()]; timers.clear(); for (const callback of callbacks) callback(); await settle() },
  }
}

for (const type of ['book', 'world']) {
  test(`automatic sync does not schedule an unconnected ${type}`, async () => {
    const f = fixture(type, false)
    f.schedule(); await settle()
    assert.equal(f.timers.size, 0)
    await f.fire()
    assert.equal(f.calls.length, 0)
    assert.deepEqual(f.errors, [])
  })
  test(`connected ${type} still syncs once after the idle interval`, async () => {
    const f = fixture(type)
    f.schedule(); f.schedule(); await settle()
    assert.equal(f.timers.size, 1)
    await f.fire()
    assert.deepEqual(f.calls, [[type, 'local-owner']])
    assert.deepEqual(f.errors, [])
  })
  test(`disconnecting ${type} during the idle interval skips automatic sync`, async () => {
    const f = fixture(type)
    f.schedule(); await settle(); f.disconnect(); await f.fire()
    assert.equal(f.calls.length, 0)
    assert.deepEqual(f.errors, [])
  })
}

test('a newer edit supersedes a timeout waiting for its connection lookup', async () => {
  const f = fixture()
  f.schedule(); await settle()
  let release
  f.context.getSyncLink = () => new Promise(resolve => { release = resolve })
  await f.fire()
  const releaseOldLookup = release
  f.schedule(); await settle()
  releaseOldLookup({ bookId: 'local-owner' }); await settle()
  assert.equal(f.calls.length, 0)
  assert.equal(f.timers.size, 1)
})

test('disabling automatic upload during the idle interval skips sync', async () => {
  const f = fixture()
  f.schedule(); await settle(); f.disable(); await f.fire()
  assert.equal(f.calls.length, 0)
})
test('changing workspace during the idle interval skips sync', async () => {
  const f = fixture()
  f.schedule(); await settle(); f.context.currentBookIdRef.current = 'other-owner'; await f.fire()
  assert.equal(f.calls.length, 0)
})
test('a connection lookup failure is reported and never starts sync', async () => {
  const f = fixture()
  f.context.getSyncLink = async () => { throw new Error('Connection lookup failed') }
  f.schedule(); await settle(); await f.fire()
  assert.equal(f.calls.length, 0)
  assert.ok(f.errors.includes('Connection lookup failed'))
})

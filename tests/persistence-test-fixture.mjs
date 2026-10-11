import assert from 'node:assert/strict'
import { after } from 'node:test'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import 'fake-indexeddb/auto'

// Use the same native TypeScript resolver as the existing persistence tests.
export async function persistenceTestEnvironment() {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const storage = new Map()
  globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
  }
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const url = new URL(specifier + '.ts', context.parentURL)
      if (existsSync(fileURLToPath(url))) return nextResolve(url.href, context)
    }
    return nextResolve(specifier, context)
  } })
  let db, cache
  // Register before imports/opening, so partial setup failures also clean up.
  after(async () => {
    try {
      if (cache) await cache.delete()
    } finally {
      try {
        if (db) await db.delete()
      } finally {
        hooks.deregister()
        if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage)
        else delete globalThis.localStorage
      }
    }
  })
  const p = await import('../src/data/persistence.ts')
  const { initialAiSettings } = await import('../src/shared/ai/ai-settings.ts')
  const { ttsCacheDatabase } = await import('../src/features/speech/tts-cache.ts')
  db = await p.database()
  // deleteEntityTree opens this second database for owner invalidation.
  cache = await ttsCacheDatabase()
  assert.ok(cache, 'The fake IndexedDB TTS cache opens for deletion cleanup')
  return {
    p, db,
    async book(t) {
      const fixture = await p.createBook(initialAiSettings, t.name)
      t.after(() => p.deleteEntityTree(fixture.book.id))
      return fixture
    },
  }
}

// Pause just the first transaction BEFORE acquiring its real IndexedDB lock.
// A competing persistence call can commit while the first API is in flight.
// Any entity/sibling/subtree captured outside that transaction is now stale;
// implementations which read under the lock instead see the committed state.
// Only scheduling is replaced: callbacks, reads, writes and locks remain real.
export async function withTransactionPaused(t, db, operation, whilePaused) {
  let release, entered, claimed = false, timer
  const gate = new Promise(resolve => { release = resolve })
  const reached = new Promise(resolve => { entered = resolve })
  const original = db.transaction
  const interception = t.mock.method(db, 'transaction', function (...args) {
    if (claimed) return original.apply(this, args)
    claimed = true
    entered()
    return gate.then(() => original.apply(this, args))
  })
  let pending
  const cleanup = async () => {
    clearTimeout(timer)
    release()
    interception.mock.restore()
    await pending?.catch(() => undefined)
  }
  t.after(cleanup)
  try {
    pending = Promise.resolve().then(operation)
    // Observe early errors immediately; do not leave an unhandled rejection.
    pending.catch(() => undefined)
    await Promise.race([
      reached,
      pending.then(() => { throw new Error('Operation completed without reaching its transaction') }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Operation did not reach its transaction')), 5000)
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

export async function structuralRows(p, ids) {
  return Promise.all(ids.map(async id => {
    const entity = await p.getEntity(id)
    assert.ok(entity, `Structural entity ${id} still exists`)
    return { id: entity.id, parentId: entity.parentId, order: entity.order, content: entity.content, title: entity.title }
  }))
}

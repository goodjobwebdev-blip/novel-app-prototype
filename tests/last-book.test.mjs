import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test from 'node:test'
import assert from 'node:assert/strict'
import { LAST_BOOK_STORAGE_KEY, loadLastBookLocation, rememberLastBookLocation } from '../src/app/last-book.ts'

function storage(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  } })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete globalThis.localStorage
  })
  return values
}

test('last-book locations round-trip editor/document and chat destinations and can be cleared', t => {
  const values = storage(t)
  assert.equal(loadLastBookLocation(), undefined)
  for (const location of [
    { bookId: 'book-a', screen: 'editor', documentId: 'note-a' },
    { bookId: 'book-a', screen: 'chat', documentId: 'scene-a', chatId: 'chat-a' },
  ]) {
    rememberLastBookLocation(location)
    assert.deepEqual(loadLastBookLocation(), location)
    assert.deepEqual(JSON.parse(values.get(LAST_BOOK_STORAGE_KEY)), location)
  }
  rememberLastBookLocation()
  assert.equal(values.has(LAST_BOOK_STORAGE_KEY), false)
  assert.equal(loadLastBookLocation(), undefined)
})

test('invalid persisted locations are ignored without rewriting their original data', t => {
  const values = storage(t)
  for (const stored of [
    '{broken json', 'null', '[]',
    JSON.stringify({ bookId: '', screen: 'editor' }),
    JSON.stringify({ bookId: 3, screen: 'editor' }),
    JSON.stringify({ bookId: 'book-a', screen: 'settings' }),
    JSON.stringify({ bookId: 'book-a', screen: ['editor'] }),
    JSON.stringify({ bookId: 'book-a', screen: ['chat'] }),
    JSON.stringify({ bookId: 'book-a', screen: 'chat' }),
    JSON.stringify({ bookId: 'book-a', screen: 'chat', chatId: '' }),
    JSON.stringify({ bookId: 'book-a', screen: 'chat', chatId: 3 }),
  ]) {
    values.set(LAST_BOOK_STORAGE_KEY, stored)
    assert.equal(loadLastBookLocation(), undefined, `Ignore invalid location: ${stored}`)
    assert.equal(values.get(LAST_BOOK_STORAGE_KEY), stored)
  }
})

test('loading strips unknown fields, invalid optional documents, and chat IDs from editor destinations', t => {
  const values = storage(t)
  values.set(LAST_BOOK_STORAGE_KEY, JSON.stringify({ bookId: 'book-a', screen: 'editor', documentId: 3, chatId: 'stale-chat', extra: 'ignored' }))
  assert.deepEqual(loadLastBookLocation(), { bookId: 'book-a', screen: 'editor' })
  values.set(LAST_BOOK_STORAGE_KEY, JSON.stringify({ bookId: 'book-a', screen: 'chat', documentId: '', chatId: 'chat-a', extra: 'ignored' }))
  assert.deepEqual(loadLastBookLocation(), { bookId: 'book-a', screen: 'chat', chatId: 'chat-a' })
})

test('unavailable preference storage never throws during load, remember or clear', t => {
  storage(t)
  for (const method of ['getItem', 'setItem', 'removeItem']) t.mock.method(localStorage, method, () => { throw new Error('Preference storage unavailable') })
  assert.equal(loadLastBookLocation(), undefined)
  assert.doesNotThrow(() => rememberLastBookLocation({ bookId: 'book-a', screen: 'editor' }))
  assert.doesNotThrow(() => rememberLastBookLocation())
})

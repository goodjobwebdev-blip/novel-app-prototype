import assert from 'node:assert/strict'
import test from 'node:test'
import {
  chatMatchesBookSelection,
  onlyChatsForBook,
  reloadMatchesBookSelection,
} from '../src/chat-book-guard.ts'

test('late Book A sidebar reload cannot replace Book B state', async () => {
  let currentBookId = 'book-a'
  let currentVersion = 1
  let items = [{ id: 'chat-a', bookId: 'book-a' }]
  let resolveA
  const delayedA = new Promise((resolve) => { resolveA = resolve })

  const completion = delayedA.then((next) => {
    if (reloadMatchesBookSelection('book-a', 1, currentBookId, currentVersion)) {
      items = onlyChatsForBook(next, 'book-a')
    }
  })

  currentBookId = 'book-b'
  currentVersion = 2
  items = [{ id: 'chat-b', bookId: 'book-b' }]
  resolveA([{ id: 'chat-a', bookId: 'book-a' }])
  await completion

  assert.deepEqual(items, [{ id: 'chat-b', bookId: 'book-b' }])
})

test('older same-book reload is rejected after a newer reload starts', () => {
  assert.equal(reloadMatchesBookSelection('book-b', 2, 'book-b', 3), false)
  assert.equal(reloadMatchesBookSelection('book-b', 3, 'book-b', 3), true)
})

test('Chat A cannot be treated as selected while Book B is authoritative', () => {
  const chatA = { id: 'chat-a1', bookId: 'book-a' }
  assert.equal(chatMatchesBookSelection(chatA, 'book-b', 'chat-a1'), false)
  assert.equal(chatMatchesBookSelection(chatA, 'book-a', 'chat-a1'), true)
})

test('malformed chat lists are filtered to the current Book', () => {
  const items = onlyChatsForBook([
    { id: 'chat-a', bookId: 'book-a' },
    { id: 'chat-b', bookId: 'book-b' },
  ], 'book-b')

  assert.deepEqual(items, [{ id: 'chat-b', bookId: 'book-b' }])
})

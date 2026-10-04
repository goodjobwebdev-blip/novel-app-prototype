import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test from 'node:test'
import assert from 'node:assert/strict'
import { CHAT_LIST_PAGE_SIZE, chatListPageForIndex, paginateChatList } from '../src/features/chat/chat-list-pagination.ts'

test('chat pages contain at most twenty newest-first items without overlap', () => {
  const chats = Array.from({ length: 45 }, (_, index) => `chat-${index + 1}`)
  const first = paginateChatList(chats, 1)
  const second = paginateChatList(chats, 2)
  const third = paginateChatList(chats, 3)

  assert.equal(CHAT_LIST_PAGE_SIZE, 20)
  assert.deepEqual(first.items, chats.slice(0, 20))
  assert.deepEqual(second.items, chats.slice(20, 40))
  assert.deepEqual(third.items, chats.slice(40, 45))
  assert.deepEqual([first.from, first.to, second.from, second.to, third.from, third.to], [1, 20, 21, 40, 41, 45])
  assert.equal(third.totalPages, 3)
})

test('pagination clamps stale and malformed pages after search or deletion', () => {
  const chats = Array.from({ length: 21 }, (_, index) => index)
  assert.equal(paginateChatList(chats, 99).page, 2)
  assert.equal(paginateChatList(chats.slice(0, 4), 2).page, 1)
  assert.equal(paginateChatList([], Number.NaN).page, 1)
  assert.deepEqual(paginateChatList([], 1).items, [])
})

test('an active chat index maps to its containing page', () => {
  assert.equal(chatListPageForIndex(-1), 1)
  assert.equal(chatListPageForIndex(0), 1)
  assert.equal(chatListPageForIndex(19), 1)
  assert.equal(chatListPageForIndex(20), 2)
  assert.equal(chatListPageForIndex(44), 3)
})

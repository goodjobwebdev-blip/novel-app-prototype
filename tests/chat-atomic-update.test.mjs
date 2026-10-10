import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'


const source = readFileSync(new URL('../src/features/chat/chat-service.ts', import.meta.url), 'utf8')

function block(startText, endText) {
  const start = source.indexOf(startText)
  const end = source.indexOf(endText, start)
  assert.ok(start >= 0 && end > start, `${startText} block exists`)
  return source.slice(start, end)
}

test('Chat explicit updates are queued and atomically re-read the durable Chat', () => {
  const update = block('export async function updateChat(', '\nexport async function saveChatContextProfile')
  assert.match(update, /chatWriteQueue\.run\(chatId/)
  assert.match(update, /updateEntityAtomically<ChatEntity>\(chatId/)
  assert.doesNotMatch(update, /await getChat\(chatId\)/)
})

test('message preview maintenance atomically patches only current Chat metadata', () => {
  const touch = block('async function touchFromMessages(', '\nexport async function createChatMessage')
  assert.match(touch, /chatWriteQueue\.run\(chatId/)
  assert.match(touch, /updateEntityAtomically<ChatEntity>\(chatId/)
  assert.match(touch, /lastMessagePreview: preview/)
  assert.doesNotMatch(touch, /await getChat\(chatId\)/)
  assert.match(touch, /current\.title === 'New chat'/)
})


test('automatic first-message title cannot overwrite an already renamed durable Chat', () => {
  const touch = block('async function touchFromMessages(', '\nexport async function createChatMessage')
  assert.match(touch, /autoTitle && current\.title === 'New chat'/)
})

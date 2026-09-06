import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { KeyedAsyncQueue } from '../src/keyed-async-queue.ts'

const source = readFileSync(new URL('../src/chat-service.ts', import.meta.url), 'utf8')

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

test('different explicit fields survive concurrent invocation order', async () => {
  const queue = new KeyedAsyncQueue()
  let record = { systemPrompt: 'old', thinking: false }
  let releaseFirst
  const gate = new Promise((resolve) => { releaseFirst = resolve })

  const first = queue.run('chat-a', async () => {
    await gate
    record = { ...record, systemPrompt: 'new prompt' }
  })
  const second = queue.run('chat-a', async () => {
    record = { ...record, thinking: true }
  })

  releaseFirst()
  await Promise.all([first, second])
  assert.deepEqual(record, { systemPrompt: 'new prompt', thinking: true })
})

test('same-field explicit updates resolve by invocation order, not async completion timing', async () => {
  const queue = new KeyedAsyncQueue()
  let title = 'Initial'
  let releaseFirst
  const gate = new Promise((resolve) => { releaseFirst = resolve })

  const first = queue.run('chat-a', async () => {
    await gate
    title = 'First requested title'
  })
  const second = queue.run('chat-a', async () => {
    title = 'Latest requested title'
  })

  releaseFirst()
  await Promise.all([first, second])
  assert.equal(title, 'Latest requested title')
})

test('automatic first-message title cannot overwrite an already renamed durable Chat', () => {
  const touch = block('async function touchFromMessages(', '\nexport async function createChatMessage')
  assert.match(touch, /autoTitle && current\.title === 'New chat'/)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { applyIfStillCurrent } from '../src/async-state-guard.ts'

test('late Chat A settings completion cannot replace selected Chat B state', async () => {
  let selectedChatId = 'chat-a'
  let activeChat = { id: 'chat-a', model: 'old-a' }
  let messages = ['a-1']
  let persistedA
  let resolveSave
  const delayedSave = new Promise((resolve) => { resolveSave = resolve })

  const saveCompletion = delayedSave.then((updated) => {
    persistedA = updated
    applyIfStillCurrent(updated.id, () => selectedChatId, () => { activeChat = updated })
  })

  selectedChatId = 'chat-b'
  activeChat = { id: 'chat-b', model: 'b-model' }
  messages = ['b-1']
  resolveSave({ id: 'chat-a', model: 'new-a' })
  await saveCompletion

  assert.deepEqual(persistedA, { id: 'chat-a', model: 'new-a' }, 'old Chat mutation still persists')
  assert.deepEqual(activeChat, { id: 'chat-b', model: 'b-model' })
  assert.deepEqual(messages, ['b-1'])
})

test('send work for a no-longer-selected Chat is not committed to visible state', () => {
  let selectedChatId = 'chat-b'
  let activeChat = { id: 'chat-b' }
  let messages = ['b-1']
  const staleUserMessage = 'a-new'

  const applied = applyIfStillCurrent('chat-a', () => selectedChatId, () => {
    activeChat = { id: 'chat-a' }
    messages = ['a-1', staleUserMessage]
  })

  assert.equal(applied, false)
  assert.equal(activeChat.id, 'chat-b')
  assert.deepEqual(messages, ['b-1'])
})

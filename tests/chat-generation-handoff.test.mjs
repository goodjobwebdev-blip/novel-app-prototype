import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  abortChatGeneration,
  abortChatGenerationsOutsideSelection,
  chatGenerationKey,
  createChatGenerationOwner,
  getChatGenerationOwner,
  ownsChatGeneration,
  registerChatGeneration,
  releaseChatGeneration,
  setChatGenerationPhase,
} from '../src/chat-generation-owner.ts'
import { runChatSendPipeline } from '../src/chat-send-pipeline.ts'

test('Chat B can own generation while aborted Chat A is still tearing down', () => {
  const owners = new Map()
  const chatA = createChatGenerationOwner('book-a', 'chat-a')
  assert.equal(registerChatGeneration(owners, chatA), true)
  assert.equal(setChatGenerationPhase(owners, chatA, 'using-tools'), true)

  abortChatGenerationsOutsideSelection(owners, 'book-b', 'chat-b')
  assert.equal(chatA.controller.signal.aborted, true)

  const chatB = createChatGenerationOwner('book-b', 'chat-b')
  assert.equal(registerChatGeneration(owners, chatB), true, 'A teardown is not a cross-Chat lock')
  assert.equal(setChatGenerationPhase(owners, chatB, 'writing'), true)
  assert.equal(ownsChatGeneration(owners, chatB), true)

  assert.equal(releaseChatGeneration(owners, chatA), true, 'A can finish its own teardown')
  assert.equal(ownsChatGeneration(owners, chatB), true, 'A teardown cannot clear B ownership')
  assert.equal(getChatGenerationOwner(owners, 'book-b', 'chat-b')?.phase, 'writing')
  assert.equal(chatB.controller.signal.aborted, false)
})

test('late teardown cannot release or mutate a newer generation token for the same Chat', () => {
  const owners = new Map()
  const oldOwner = createChatGenerationOwner('book-a', 'chat-a')
  const newOwner = createChatGenerationOwner('book-a', 'chat-a')
  owners.set(chatGenerationKey('book-a', 'chat-a'), newOwner)

  assert.equal(releaseChatGeneration(owners, oldOwner), false)
  assert.equal(setChatGenerationPhase(owners, oldOwner, 'stopping'), false)
  assert.equal(ownsChatGeneration(owners, newOwner), true)
  assert.equal(newOwner.phase, 'sending')
})

test('same-Chat overlap remains blocked while an aborted generation tears down', () => {
  const owners = new Map()
  const first = createChatGenerationOwner('book-a', 'chat-a')
  const replacement = createChatGenerationOwner('book-a', 'chat-a')
  assert.equal(registerChatGeneration(owners, first), true)
  abortChatGeneration(owners, 'book-a', 'chat-a')
  assert.equal(first.controller.signal.aborted, true)
  assert.equal(registerChatGeneration(owners, replacement), false)
  assert.equal(releaseChatGeneration(owners, first), true)
  assert.equal(registerChatGeneration(owners, replacement), true)
})

test('failed generation preflight refuses Send before a user turn is persisted', async () => {
  let persisted = 0
  let generated = 0
  await assert.rejects(() => runChatSendPipeline({
    preflight: async () => { throw new Error('missing model') },
    persist: async () => { persisted += 1; return 'user-turn' },
    generate: async () => { generated += 1 },
  }), /missing model/)
  assert.equal(persisted, 0)
  assert.equal(generated, 0)
})

test('post-persistence generation failure keeps the accepted turn and reports the failure', async () => {
  let persisted = 0
  let visibleFailure = ''
  const result = await runChatSendPipeline({
    preflight: async () => 'ready',
    persist: async () => { persisted += 1; return 'user-turn' },
    generate: async () => { throw new Error('provider failed') },
    onPostPersistError: (error) => { visibleFailure = error instanceof Error ? error.message : String(error) },
  })
  assert.equal(persisted, 1)
  assert.equal(result.persisted, 'user-turn')
  assert.match(visibleFailure, /provider failed/)
  assert.ok(result.postPersistError)
})

test('ChatFeature reserves per-Chat generation ownership before accepted Send persistence', () => {
  const source = readFileSync(new URL('../src/ChatFeature.tsx', import.meta.url), 'utf8')
  assert.match(source, /createChatGenerationOwner\(sourceChat\.bookId, sourceChat\.id\)/)
  assert.match(source, /registerChatGeneration\(generationOwnersRef\.current, owner\)/)
  assert.match(source, /runChatSendPipeline\(/)
  const sendStart = source.indexOf('  async function send() {')
  const stopStart = source.indexOf('\n  function stop()', sendStart)
  assert.ok(sendStart >= 0 && stopStart > sendStart)
  const send = source.slice(sendStart, stopStart)
  assert.ok(send.indexOf('registerChatGeneration(') < send.indexOf('createChatMessage('), 'ownership is reserved before persistence')
})

test('ChatFeature selection and teardown use exact generation ownership', () => {
  const source = readFileSync(new URL('../src/ChatFeature.tsx', import.meta.url), 'utf8')
  assert.match(source, /abortChatGenerationsOutsideSelection\(generationOwnersRef\.current, bookId, chatId\)/)
  assert.match(source, /ownsChatGeneration\(generationOwnersRef\.current, owner\)/)
  assert.match(source, /releaseChatGeneration\(generationOwnersRef\.current, owner\)/)
  assert.doesNotMatch(source, /if \(abortRef\.current \|\| !isCurrentChat\(activeChat\)\) return/)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  abortChatGenerationsOutsideSelection,
  createChatGenerationOwner,
  ownsChatGeneration,
  registerChatGeneration,
  releaseChatGeneration,
  setChatGenerationPhase,
} from '../src/chat-generation-owner.ts'

test('Chat B remains independent while Chat A finishes delayed tool work after abort', async () => {
  const owners = new Map()
  const chatA = createChatGenerationOwner('book-a', 'chat-a')
  assert.equal(registerChatGeneration(owners, chatA), true)
  assert.equal(setChatGenerationPhase(owners, chatA, 'using-tools'), true)

  let finishTool
  const delayedTool = new Promise((resolve) => { finishTool = resolve })
  const aTeardown = delayedTool.then(() => {
    assert.equal(chatA.controller.signal.aborted, true)
    assert.equal(releaseChatGeneration(owners, chatA), true)
  })

  abortChatGenerationsOutsideSelection(owners, 'book-b', 'chat-b')
  const chatB = createChatGenerationOwner('book-b', 'chat-b')
  assert.equal(registerChatGeneration(owners, chatB), true)
  assert.equal(setChatGenerationPhase(owners, chatB, 'writing'), true)

  finishTool()
  await aTeardown

  assert.equal(ownsChatGeneration(owners, chatB), true)
  assert.equal(chatB.phase, 'writing')
  assert.equal(chatB.controller.signal.aborted, false)
})

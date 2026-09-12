import test from 'node:test'
import assert from 'node:assert/strict'
import { groupChatAnswers, answerProse } from '../src/chat-answer-groups.ts'

test('assistant rounds group by response without mutating history or proposal ownership', () => {
  const messages = [
    { id: 'u', role: 'user', content: 'Help' },
    { id: 'a', role: 'assistant', responseId: 'run1', content: 'Looking', toolActivity: ['read_entity'] },
    { id: 'b', role: 'assistant', responseId: 'run1', content: 'Answer', documentEdits: [{ id: 'p' }] },
    { id: 'c', role: 'assistant', responseId: 'run2', content: 'Continued' },
  ]
  const before = structuredClone(messages)
  const groups = groupChatAnswers(messages)
  assert.deepEqual(groups.map(group => group.messages.map(message => message.id)), [['u'], ['a', 'b'], ['c']])
  assert.equal(groups[1].messages[1].documentEdits[0].id, 'p')
  assert.deepEqual(messages, before)
})

test('legacy rounds group only between user turns, and copy excludes internal activity', () => {
  const rounds = [{ id: 'a', role: 'assistant', content: 'First', thoughts: 'Private', toolActivity: ['read_entity'] }, { id: 'b', role: 'assistant', content: 'Second', status: 'stopped' }]
  assert.equal(groupChatAnswers(rounds).length, 1)
  assert.equal(answerProse(rounds), 'First\n\nSecond')
  assert.equal(groupChatAnswers([...rounds, { id: 'u', role: 'user', content: 'Next' }, { id: 'c', role: 'assistant', content: '' }]).length, 3)
})

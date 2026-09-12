import test from 'node:test'
import assert from 'node:assert/strict'
import { executeBrainstormTool, brainstormSelectionText, updateBrainstormDraft } from '../src/chat-brainstorm.ts'
const call = args => ({ function: { name: 'present_brainstorm', arguments: typeof args === 'string' ? args : JSON.stringify(args) } })
const options = [{ title: 'Explore', description: 'Follow the river' }, { title: 'Wait', description: 'Watch the gate', trade_off: 'Lose daylight' }]
test('brainstorm payload validation rejects malformed and out-of-range options safely', () => {
  for (const args of ['{', {}, { topic: 'Scene', options: [] }, { topic: 'Scene', options: Array(9).fill(options[0]) }, { topic: 'Scene', options: [{ title: '', description: 'Empty' }, options[1]] }]) {
    const result = executeBrainstormTool(call(args))
    assert.equal(result.brainstorm, undefined)
    assert.equal(JSON.parse(result.content).ok, false)
  }
})
test('option identity and order survive edits; only explicit selected values become follow-up text', () => {
  const { brainstorm } = executeBrainstormTool(call({ topic: 'Scene', options }))
  assert.equal(brainstormSelectionText(brainstorm), '')
  const next = { ...brainstorm, selectedIds: [brainstorm.options[1].id], options: brainstorm.options.map(option => ({ ...option })), customOption: 'My own path' }
  next.options[1].description = 'Wait until dark'
  const saved = updateBrainstormDraft(brainstorm, next)
  assert.deepEqual(saved.options.map(option => option.id), brainstorm.options.map(option => option.id))
  assert.match(brainstormSelectionText(saved), /Wait until dark/)
  assert.match(brainstormSelectionText(saved), /My own path/)
  assert.doesNotMatch(brainstormSelectionText(saved), /Follow the river/)
  assert.throws(() => updateBrainstormDraft(saved, next), /changed elsewhere/)
})

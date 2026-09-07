import assert from 'node:assert/strict'
import test from 'node:test'
import { structuralSelectionIds, orderedContextScenes } from '../src/context-source-selection.ts'
const items = [
  { id: 'act', parentId: 'book', type: 'act', order: 0 },
  { id: 'second', parentId: 'act', type: 'chapter', order: 2 },
  { id: 'first', parentId: 'act', type: 'chapter', order: 1 },
  { id: 'later', parentId: 'second', type: 'scene', order: 0 },
  { id: 'anchor', parentId: 'first', type: 'scene', order: 2 },
  { id: 'earlier', parentId: 'first', type: 'scene', order: 1 },
  { id: 'note', parentId: 'book', type: 'note' },
]
test('chapter selections include their descendant scenes without selecting sibling chapters or notes', () => {
  assert.deepEqual([...structuralSelectionIds(items, ['first'])].sort(), ['anchor', 'earlier', 'first'])
  assert.ok(!structuralSelectionIds(items, ['first']).has('later'))
})
test('Act selection includes descendants while clearing the parent leaves explicit scene selections intact', () => {
  assert.ok(structuralSelectionIds(items, ['act']).has('later'))
  assert.deepEqual([...structuralSelectionIds(items, ['earlier'])], ['earlier'])
  assert.equal(structuralSelectionIds(items, []).size, 0)
})
test('reference-scene order follows the outline rather than the incoming entity array', () => {
  assert.deepEqual(orderedContextScenes(items).map(item => item.id), ['earlier', 'anchor', 'later'])
})
test('malformed parent cycles cannot hang source selection', () => {
  assert.deepEqual([...structuralSelectionIds([{ id: 'a', parentId: 'b', type: 'chapter' }, { id: 'b', parentId: 'a', type: 'chapter' }], [])], [])
})

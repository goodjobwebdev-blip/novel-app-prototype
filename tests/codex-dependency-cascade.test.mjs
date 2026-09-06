import test from 'node:test'
import assert from 'node:assert/strict'
import { cascadeAutomaticCodexDependencies } from '../src/codex-dependency-cascade.ts'

const entry = (id, archived = false) => ({ id, type: 'codexEntry', bookId: 'book', parentId: 'book', title: id.toUpperCase(), category: 'Other', content: id, createdAt: 1, updatedAt: 1, ...(archived ? { archivedAt: 10 } : {}) })
const edge = (id, sourceId, targetId, includeWithSource = true, createdAt = 1) => ({ id, bookId: 'book', sourceId, targetId, relationLabel: '', includeWithSource, createdAt, updatedAt: createdAt })

test('cascade is recursive, deterministic, cycle-safe, and deduplicated', () => {
  const entries = ['a','b','c','d'].map((id) => entry(id))
  const result = cascadeAutomaticCodexDependencies([entries[0]], entries, [
    edge('2','a','c',true,2), edge('1','a','b',true,1), edge('3','b','d',true,3), edge('4','d','a',true,4), edge('5','c','d',true,5),
  ])
  assert.deepEqual(result.map((item) => item.entry.id), ['b','c','d'])
  assert.deepEqual(result.find((item) => item.entry.id === 'd').pathIds, ['a','b','d'])
})

test('disabled, archived, deleted and excluded targets do not cascade or bridge through', () => {
  const a = entry('a'), b = entry('b', true), c = entry('c'), d = entry('d')
  const result = cascadeAutomaticCodexDependencies([a], [a,b,c,d], [
    edge('1','a','b'), edge('2','b','c'), edge('3','a','d',false), edge('4','a','missing'), edge('5','a','c'),
  ], 'c')
  assert.deepEqual(result, [])
})

test('entries already directly matched remain direct rather than duplicated as dependencies', () => {
  const a = entry('a'), b = entry('b'), c = entry('c')
  const result = cascadeAutomaticCodexDependencies([a,b], [a,b,c], [edge('1','a','b'), edge('2','b','c')])
  assert.deepEqual(result.map((item) => item.entry.id), ['c'])
  assert.deepEqual(result[0].pathIds, ['b','c'])
})

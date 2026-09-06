import assert from 'node:assert/strict'
import test from 'node:test'
import { canUnmountEditor } from '../src/editor-unmount-guard.ts'

test('active Story/Codex generation blocks transitions that unmount the editor', () => {
  assert.equal(canUnmountEditor(true), false)
})

test('editor can be unmounted when no generation is active', () => {
  assert.equal(canUnmountEditor(false), true)
})

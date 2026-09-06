import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { saveRequiredSettingsForLeave } from '../src/settings-leave-policy.ts'

const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

function block(startText, endText) {
  const start = source.indexOf(startText)
  const end = source.indexOf(endText, start)
  assert.ok(start >= 0 && end > start, `${startText} block exists`)
  return source.slice(start, end)
}

test('mixed Settings leave saves succeed only when every required save succeeds', async () => {
  assert.equal(await saveRequiredSettingsForLeave([
    async () => true,
    async () => false,
  ]), false)
  assert.equal(await saveRequiredSettingsForLeave([
    async () => true,
    async () => true,
  ]), true)
})

test('required Settings save errors become an enforceable failure result', async () => {
  assert.equal(await saveRequiredSettingsForLeave([
    async () => { throw new Error('storage failed') },
  ]), false)
})

test('AI and Context final-save helpers expose boolean success contracts', () => {
  const persist = block('  function persistAiSettings(', '\n  function scheduleAiSettingsSave')
  const flush = block('  async function flushAiSettings()', '\n  function invalidateModelRefresh')
  const context = block('  async function saveContextDefaults()', '\n  function updateContextDefaults')
  assert.match(persist, /Promise<boolean>/)
  assert.match(persist, /return false/)
  assert.match(flush, /Promise<boolean>/)
  assert.match(flush, /return true/)
  assert.match(context, /Promise<boolean>/)
  assert.match(context, /return false/)
  assert.match(context, /return true/)
})

test('failed leave blocks destination and exposes Retry plus confirmed discard', () => {
  const leave = block('  async function leaveSettings(', '\n  async function retrySettingsLeave')
  assert.match(leave, /const saved = await saveRequiredSettingsForLeave/)
  assert.match(leave, /if \(!saved\) \{[\s\S]*setLeaveRecoveryOpen\(true\)[\s\S]*return/)
  assert.ok(leave.lastIndexOf('destination()') > leave.indexOf('if (!saved)'), 'destination runs only after failed-save early return')

  const discard = block('  async function leaveSettingsWithoutSaving()', '\n\n  return \(')
  assert.match(discard, /window\.confirm\('Leave without saving\? Unsaved settings changes will be lost\.'\)/)
  assert.match(discard, /if \(!window\.confirm/)
  assert.match(discard, /aiSaveQueueRef\.current\.whenIdle\(scope\)/)
  assert.match(discard, /contextSaveQueueRef\.current\.catch/)
})

test('recovery UI keeps the mounted draft and offers both recovery actions', () => {
  assert.match(source, /leaveRecoveryOpen && <section className="settings-save-recovery"/)
  assert.match(source, /leaveSaving \? 'Retrying…' : 'Retry'/)
  assert.match(source, />Leave without saving</)
  assert.match(source, /Your unsaved changes are still here/)
})

test('global Context default write failure remains dirty for navigation recovery', () => {
  const update = block('  function updateContextDefaults(', '\n  async function leaveSettings')
  assert.match(update, /if \(!book\) \{[\s\S]*try \{[\s\S]*saveDefaultBookContextSettings\(value\)[\s\S]*catch \{[\s\S]*setContextSaved\(false\)/)
})

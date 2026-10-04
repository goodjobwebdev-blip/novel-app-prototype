import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { saveRequiredSettingsForLeave } from '../src/features/settings/settings-leave-policy.ts'

const source = readFileSync(new URL('../src/app/App.tsx', import.meta.url), 'utf8')
const profiles = readFileSync(new URL('../src/features/settings/SettingsProfilesPanel.tsx', import.meta.url), 'utf8')

function block(startText, endText, input = source) {
  const start = input.indexOf(startText)
  const end = input.indexOf(endText, start)
  assert.ok(start >= 0 && end > start, `${startText} block exists`)
  return input.slice(start, end)
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

test('explicit profile Save and Context final-save helpers expose enforceable success contracts', () => {
  const save = block('  async function save()', '\n  function discard', profiles)
  const context = block('  async function saveContextDefaults()', '\n  function updateContextDefaults')
  assert.match(save, /Promise<boolean>/)
  assert.match(save, /if \(busyRef\.current\) return false/)
  assert.match(save, /let succeeded = false/)
  assert.ok(save.indexOf('succeeded = true') > save.indexOf('await saveSettingsProfile(clean)'))
  assert.match(save, /return succeeded/)
  assert.match(context, /Promise<boolean>/)
  assert.match(context, /return false/)
  assert.match(context, /return true/)
})

test('failed leave blocks destination and exposes Retry plus confirmed discard', () => {
  const leave = block('  async function leaveSettings(', '\n  function navigate')
  assert.match(leave, /const saved = await saveRequiredSettingsForLeave/)
  assert.match(leave, /if \(!saved\) \{[\s\S]*setLeaveRecoveryOpen\(true\)[\s\S]*return/)
  assert.ok(leave.lastIndexOf('destination()') > leave.indexOf('if (!saved)'), 'destination runs only after failed-save early return')

  assert.match(leave, /await profileSaveQueueRef\.current/)
  const discard = block('  async function leaveSettingsWithoutSaving()', '\n  function openGlobalProfile')
  assert.match(discard, /!window\.confirm\('Leave without saving Context\? Unsaved changes will be lost\.'\)/)
  assert.ok(discard.indexOf('contextSaveVersionRef.current += 1') < discard.indexOf('await contextSaveQueueRef.current.catch'))
  assert.ok(discard.lastIndexOf('destination()') > discard.indexOf('await contextSaveQueueRef.current.catch'))
  const navigate = block('  function navigate(', '\n  async function leaveSettingsWithoutSaving')
  assert.match(navigate, /profilePanelRef\.current\?\.requestLeave/)
  assert.match(profiles, /if \(!discard\(\)\) return; const destination = pending; setPending\(null\); destination\(\)/)
})

test('recovery UI keeps the mounted draft and offers both recovery actions', () => {
  assert.match(source, /leaveRecoveryOpen && <section className="settings-save-recovery"/)
  assert.match(source, /<Button disabled=\{leaveSaving\} onClick=\{\(\) => \{ void leaveSettings\(pendingLeaveDestinationRef\.current \?\? undefined\) \}\}>Retry<\/Button>/)
    assert.match(profiles, /Save and continue[\s\S]*Discard and continue[\s\S]*Keep editing/)
  assert.match(source, />Leave without saving</)
  assert.match(source, /Your unsaved changes are still here/)
})

test('global Context default write failure remains dirty for navigation recovery', () => {
  const update = block('  function updateContextDefaults(', '\n  async function leaveSettings')
  assert.match(update, /if \(!book\) \{[\s\S]*try \{[\s\S]*saveDefaultBookContextSettings\(value\)[\s\S]*catch \{[\s\S]*setContextSaved\(false\)/)
})

import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test from 'node:test'
import assert from 'node:assert/strict'
import { automaticCodexCandidates, automaticCodexMatches, buildCodexMentionIndex, codexTriggerKey, codexTitleTriggerSuggestions, conflictingCodexTriggers } from '../src/features/codex/codex-trigger-service.ts'
import { cascadeAutomaticCodexDependencies } from '../src/features/codex/codex-dependency-cascade.ts'
import { dashboardPreferences, defaultCodexDashboard, queryCodexDashboard } from '../src/features/codex/codex-dashboard.ts'

const entry = (id, triggers = [], extra = {}) => ({ id, type: 'codexEntry', bookId: 'book', parentId: 'book', title: id, category: 'Place', content: id, autoIncludeTriggers: triggers, createdAt: 1, updatedAt: 1, ...extra })
const worldEntry = (id, triggers, extra = {}) => entry(id, triggers, { bookId: 'world', parentId: 'world', worldId: 'world', ...extra })
const scene = { id: 'scene', type: 'scene', bookId: 'book', parentId: 'book', title: 'Opening', content: '', createdAt: 1, updatedAt: 1 }
const matchIds = (entries, text, extra = {}) => automaticCodexMatches({ entities: entries, scenes: [scene], anchorSceneId: scene.id, anchorSceneText: text, previousSceneCount: 0, ...extra }).map(match => match.entry.id)
const edge = (sourceId, targetId) => ({ id: `${sourceId}-${targetId}`, bookId: 'book', sourceId, targetId, relationLabel: '', includeWithSource: true, createdAt: 1, updatedAt: 1 })

test('title suggestions exclude standalone honorifics, placeholders and existing triggers', () => {
  assert.deepEqual(codexTitleTriggerSuggestions('Nicholas Cage'), ['Nicholas', 'Cage', 'Nicholas Cage'])
  for (const prefix of ['Mr.', 'Mister', 'Dr.', 'Doctor', 'Mrs.']) {
    assert.deepEqual(codexTitleTriggerSuggestions(`${prefix} Nicholas Cage`, ['nicholas']), ['Cage', 'Nicholas Cage', `${prefix} Nicholas Cage`])
  }
  assert.deepEqual(codexTitleTriggerSuggestions('Untitled Entry 2'), [])
})

test('an active local normalized trigger suppresses the whole World entry, including its other triggers', () => {
  const world = worldEntry('World tower', ['North Tower', 'Beacon'])
  const local = entry('Book tower', ['  NORTH\t  tower  '])
  assert.equal(codexTriggerKey(local.autoIncludeTriggers[0]), 'north tower')
  assert.deepEqual(matchIds([world, local], 'Beacon'), [], 'A non-conflicting alias cannot re-enable the World entry')
  assert.deepEqual(matchIds([world, local], 'North Tower and Beacon'), [local.id])
  assert.deepEqual(matchIds([world, local], 'North Tower', { excludeEntryId: local.id }), [], 'Excluding the current document does not remove its trigger reservation')
  assert.deepEqual(automaticCodexCandidates([world, local]).map(entry => entry.id), [local.id])
})

test('draft, archived and hidden entries neither auto-match nor reserve local priority', () => {
  for (const inactive of [{ codexStatus: 'draft' }, { archivedAt: 12 }, { hiddenInBook: true }]) {
    const world = worldEntry('World', ['name', 'alias'])
    const local = entry('Local', ['name'], inactive)
    assert.deepEqual(matchIds([world, local], 'name alias'), [world.id])
    assert.deepEqual(matchIds([worldEntry('Inactive World', ['name'], inactive)], 'name'), [])
  }
  assert.deepEqual(matchIds([entry('Legacy active', ['name'])], 'name'), ['Legacy active'])
})

test('priority compares normalized equality, not overlapping text or titles', () => {
  const world = worldEntry('World', ['North Tower'])
  const local = entry('North Tower', ['Tower'])
  assert.deepEqual(matchIds([world, local], 'North Tower'), [local.id, world.id])
  assert.deepEqual(conflictingCodexTriggers(world, [local]), [])
})

test('cross-scope conflict comparison cites titles and deduplicates case/whitespace variants without mutating entries', () => {
  const local = entry('Local', [' NORTH\nTOWER '])
  const world = worldEntry('World title', ['North Tower', 'north\t tower', 'Other'], { codexStatus: 'draft' })
  const before = JSON.stringify([local, world])
  assert.deepEqual(conflictingCodexTriggers(local, [local, world]), [{ entryId: world.id, title: 'World title', trigger: 'North Tower' }])
  assert.equal(JSON.stringify([local, world]), before)
})

test('dependency cascades cannot include or bridge through a losing World entry', () => {
  const root = entry('Root', ['root']), local = entry('Local', ['same'])
  const loser = worldEntry('Loser', ['same', 'alias']), downstream = worldEntry('Downstream', [])
  const winner = worldEntry('Uncontested', ['unique'])
  const entries = [root, local, loser, downstream, winner]
  const edges = [edge(root.id, loser.id), edge(loser.id, downstream.id), edge(root.id, winner.id)]
  assert.deepEqual(cascadeAutomaticCodexDependencies([root], entries, edges).map(item => item.entry.id), [winner.id])
  assert.deepEqual(cascadeAutomaticCodexDependencies([loser], entries, edges), [], 'An ineligible direct root cannot seed a cascade')
  const restored = entries.map(item => item.id === local.id ? { ...item, codexStatus: 'draft' } : item)
  assert.deepEqual(cascadeAutomaticCodexDependencies([root], restored, edges).map(item => item.entry.id), [loser.id, winner.id, downstream.id])
})

test('draft, archived and hidden dependency targets cannot bridge to active entries', () => {
  const root = entry('Root'), tail = entry('Tail')
  for (const inactive of [{ codexStatus: 'draft' }, { archivedAt: 12 }, { hiddenInBook: true }]) {
    const middle = worldEntry('Middle', [], inactive)
    assert.deepEqual(cascadeAutomaticCodexDependencies([root], [root, middle, tail], [edge(root.id, middle.id), edge(middle.id, tail.id)]), [])
  }
})

test('mention browsing retains both active scopes, even when automatic priority suppresses World', () => {
  const local = entry('Local title', ['shared'])
  const world = worldEntry('World title', ['shared', 'alias'])
  const index = buildCodexMentionIndex([local, world, entry('Draft', ['draft'], { codexStatus: 'draft' }), worldEntry('Hidden', ['hidden'], { hiddenInBook: true }), entry('Archived', ['archived'], { archivedAt: 12 })])
  assert.deepEqual(index.find(term => term.key === 'shared').entries.map(entry => entry.id), [local.id, world.id])
  assert.ok(index.some(term => term.key === 'alias'))
  assert.ok(!index.some(term => ['draft', 'hidden', 'archived'].includes(term.key)))
})

test('dashboard browses drafts and both scopes while keeping archive and hidden mechanics separate', () => {
  const local = entry('Local'), draft = entry('Draft', [], { codexStatus: 'draft' })
  const world = worldEntry('World', ['shared']), archived = worldEntry('Archived', [], { archivedAt: 12, codexStatus: 'draft' })
  const hidden = worldEntry('Hidden', [], { hiddenInBook: true })
  const entries = [local, draft, world, archived, hidden]
  const ids = preferences => queryCodexDashboard(entries, { ...defaultCodexDashboard, ...preferences }, {}).map(entry => entry.id)
  assert.deepEqual(ids({}), [draft.id, local.id, world.id])
  assert.deepEqual(ids({ scope: 'world' }), [world.id])
  assert.deepEqual(ids({ scope: 'book' }), [draft.id, local.id])
  assert.deepEqual(ids({ status: 'draft' }), [draft.id])
  assert.deepEqual(ids({ status: 'active' }), [local.id, world.id])
  assert.deepEqual(ids({ archived: true, status: 'active' }), [archived.id], 'Archived status takes precedence over the unarchived status filter')
  assert.equal(dashboardPreferences({ scope: 'inherited' }).scope, 'world')
  assert.equal(dashboardPreferences({ scope: 'override' }).scope, 'book')
  assert.equal(dashboardPreferences({ status: 'obsolete' }).status, 'all')
})

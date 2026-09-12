import test from 'node:test'
import assert from 'node:assert/strict'
import { queryCodexDashboard, defaultCodexDashboard, dashboardPreferences, CODEX_PAGE_SIZE } from '../src/codex-dashboard.ts'
const entries = Array.from({ length: 1050 }, (_, i) => ({ id: 'entry-'+i, type: 'codexEntry', bookId: 'book', parentId: 'book', title: `Entry ${String(i).padStart(4, '0')}`, category: i % 2 ? 'Character' : 'Place', typeId: i % 2 ? 'character' : 'place', content: `Body ${i}. <!-- PRIVATE_ONLY --> ![SECRET_ALT](image.png)`, createdAt: i, updatedAt: i, autoIncludeTriggers: i % 3 ? ['name'] : [], ...(i % 5 === 0 ? { codexScope: 'inherited' } : {}), ...(i > 1000 ? { archivedAt: 1 } : {}) }))
test('list and cards share projected search, filters, stable sorts and bounded pages for 1000+ entries', () => {
  const prefs = { ...defaultCodexDashboard, typeId: 'character', scope: 'book', triggers: 'yes', summary: 'current' }
  const summaries = Object.fromEntries(entries.map(e => [e.id, Number(e.id.slice(6)) % 4 ? 'current' : 'missing']))
  const list = queryCodexDashboard(entries, prefs, summaries)
  assert.ok(list.length > 40)
  assert.deepEqual(queryCodexDashboard(entries, { ...prefs, view: 'cards' }, summaries), list)
  assert.ok(list.every(e => e.typeId === 'character' && !e.codexScope && e.autoIncludeTriggers.length && summaries[e.id] === 'current' && !e.archivedAt))
  assert.equal(queryCodexDashboard(entries, { ...defaultCodexDashboard, query: 'PRIVATE_ONLY' }, summaries).length, 0)
  assert.equal(queryCodexDashboard(entries, { ...defaultCodexDashboard, query: 'SECRET_ALT' }, summaries).length, 0)
  assert.equal(queryCodexDashboard(entries, { ...defaultCodexDashboard, query: 'Character' }, summaries).length, 500)
  assert.ok(list.slice(0, CODEX_PAGE_SIZE).length <= 40)
  const recent = queryCodexDashboard(entries, { ...defaultCodexDashboard, sort: 'edited' }, summaries)
  assert.equal(recent[0].id, 'entry-1000')
  assert.equal(queryCodexDashboard(entries, { ...defaultCodexDashboard, archived: true }, summaries).length, 49)
})
test('saved preferences recover safely from obsolete values', () => {
  assert.deepEqual(dashboardPreferences({ view: 'spreadsheet', sort: 'random', archived: 'yes', scope: 'invalid', summary: 'wrong', triggers: 'maybe', query: 4 }), defaultCodexDashboard)
})

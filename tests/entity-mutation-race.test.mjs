import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/persistence.ts', import.meta.url), 'utf8')

function block(name, next) {
  const start = source.indexOf(`export async function ${name}`)
  const end = source.indexOf(next, start)
  assert.ok(start >= 0 && end > start, `${name} block exists`)
  return source.slice(start, end)
}

function assertTransactionalFieldPatch(name, next) {
  const text = block(name, next)
  assert.match(text, /db\.transaction\('rw', db\.table\('entities'\)/, `${name} uses one write transaction`)
  const transaction = text.indexOf("db.transaction('rw', db.table('entities')")
  const read = text.indexOf("db.table('entities').get(")
  assert.ok(read > transaction, `${name} reads the entity only after entering its write transaction`)
  assert.match(text, /db\.table\('entities'\)\.(update|where\('id'\)\.equals\(id\)\.modify)/, `${name} patches fields rather than putting a captured whole entity`)
}

test('content and metadata mutations patch the latest entity inside one write transaction', () => {
  assertTransactionalFieldPatch('saveDocumentContent', 'export async function listSnapshots')
  assertTransactionalFieldPatch('renameEntity', 'export async function updateBookMetadata')
  assertTransactionalFieldPatch('archiveCodexEntry', 'export async function restoreCodexEntry')
  assertTransactionalFieldPatch('restoreCodexEntry', 'export async function updateCodexCategory')
  assertTransactionalFieldPatch('updateCodexCategory', 'export async function updateCodexSummaryPreference')
  assertTransactionalFieldPatch('updateCodexSummaryPreference', 'export async function updateCodexAutoIncludeTriggers')
  assertTransactionalFieldPatch('updateCodexAutoIncludeTriggers', 'export async function renameEntity')
})

test('structural reorder/reparent patch only structural fields and never bulkPut captured bodies', () => {
  const move = block('moveStructuralEntity', 'export async function placeStructuralEntity')
  assert.doesNotMatch(move, /bulkPut/)
  assert.match(move, /update\(entity\.id, \{ order:/)
  assert.match(move, /update\(target\.id, \{ order:/)

  const place = block('placeStructuralEntity', 'async function collectEntityTreeIdsWithDb')
  assert.doesNotMatch(place, /bulkPut/)
  assert.match(place, /update\(candidate\.id, \{ parentId: targetParentId, order: index, updatedAt: now \}\)/)
  assert.match(place, /update\(candidate\.id, \{ order: index, updatedAt: now \}\)/)
})

test('field patches preserve unrelated concurrent values in either logical completion order', () => {
  const base = { id: 'scene-a', title: 'Old title', content: 'C0', order: 0, category: 'Character' }
  const patch = (entity, values) => ({ ...entity, ...values })

  const contentThenTitle = patch(patch(base, { content: 'C1' }), { title: 'New title' })
  const titleThenContent = patch(patch(base, { title: 'New title' }), { content: 'C1' })
  assert.equal(contentThenTitle.content, 'C1')
  assert.equal(contentThenTitle.title, 'New title')
  assert.deepEqual(contentThenTitle, titleThenContent)

  const contentThenCategory = patch(patch(base, { content: 'C1' }), { category: 'Place' })
  const categoryThenContent = patch(patch(base, { category: 'Place' }), { content: 'C1' })
  assert.equal(contentThenCategory.content, 'C1')
  assert.equal(contentThenCategory.category, 'Place')
  assert.deepEqual(contentThenCategory, categoryThenContent)

  const contentThenOrder = patch(patch(base, { content: 'C1' }), { order: 1 })
  const orderThenContent = patch(patch(base, { order: 1 }), { content: 'C1' })
  assert.equal(contentThenOrder.content, 'C1')
  assert.equal(contentThenOrder.order, 1)
  assert.deepEqual(contentThenOrder, orderThenContent)
})

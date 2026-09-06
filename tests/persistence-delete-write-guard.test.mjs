import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/persistence.ts', import.meta.url), 'utf8')

function functionBody(name, nextName) {
  const start = source.indexOf(`export async function ${name}`)
  assert.notEqual(start, -1, `${name} exists`)
  const end = source.indexOf(`export async function ${nextName}`, start + 1)
  assert.notEqual(end, -1, `${nextName} follows ${name}`)
  return source.slice(start, end)
}

test('document and summary saves re-read liveness inside their write transaction', () => {
  for (const [name, next] of [
    ['saveSummaryContent', 'archiveCodexEntry'],
    ['saveDocumentContent', 'listSnapshots'],
  ]) {
    const body = functionBody(name, next)
    const transaction = body.indexOf("db.transaction('rw'")
    const read = body.indexOf("db.table('entities').get")
    const write = body.indexOf("db.table('entities').put")
    assert.ok(transaction >= 0 && read > transaction && write > read, `${name} reads and writes inside one transaction`)
  }
})

test('snapshot creation checks entity liveness and writes snapshot in one transaction', () => {
  const body = functionBody('createSnapshot', 'restoreSnapshot')
  const transaction = body.indexOf("db.transaction('rw'")
  const entityRead = body.indexOf("db.table('entities').get")
  const snapshotWrite = body.indexOf("db.table('snapshots').put")
  assert.ok(transaction >= 0 && entityRead > transaction && snapshotWrite > entityRead)
})

test('tree deletion collects the final subtree inside the same write transaction that deletes it', () => {
  const body = functionBody('deleteEntityTree', 'deleteEntity')
  const transaction = body.indexOf("db.transaction('rw'")
  const collect = body.indexOf('collectEntityTreeIdsWithDb')
  const deletion = body.indexOf("db.table('entities').bulkDelete")
  assert.ok(transaction >= 0 && collect > transaction && deletion > collect)
})

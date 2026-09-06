import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const persistence = readFileSync(new URL('../src/persistence.ts', import.meta.url), 'utf8')
const workspace = readFileSync(new URL('../src/Workspace.tsx', import.meta.url), 'utf8')
const chatTools = readFileSync(new URL('../src/chat-tools.ts', import.meta.url), 'utf8')
const contextService = readFileSync(new URL('../src/context-service.ts', import.meta.url), 'utf8')

test('Codex dependency edges are normalized, directional and indexed for outgoing/incoming queries', () => {
  assert.match(persistence, /export type CodexDependencyEdge = \{[\s\S]*sourceId: string[\s\S]*targetId: string[\s\S]*includeWithSource: boolean/)
  assert.match(persistence, /codexDependencies: 'id,bookId,sourceId,targetId,\[bookId\+sourceId\],\[bookId\+targetId\],\[sourceId\+targetId\],updatedAt'/)
  assert.match(persistence, /if \(sourceId === targetId\) throw new Error/)
  assert.match(persistence, /where\('\[sourceId\+targetId\]'\)\.equals\(\[sourceId, targetId\]\)/)
  assert.match(persistence, /includeWithSource: true/)
})

test('permanent deletion cleans both outgoing and incoming dependency edges', () => {
  const start = persistence.indexOf('export async function deleteEntityTree')
  const end = persistence.indexOf('export async function saveDocumentContent', start)
  const block = persistence.slice(start, end)
  assert.match(block, /removedIds\.has\(edge\.sourceId\) \|\| removedIds\.has\(edge\.targetId\)/)
  assert.match(block, /codexDependencies.*bulkDelete/s)
})

test('opened Codex metadata exposes Dependencies and read-only Needed by without list-row management', () => {
  assert.match(workspace, /CodexDependenciesMetadata/)
  assert.match(workspace, /Dependencies · \{outgoing\.length\}/)
  assert.match(workspace, /Needed by · \{incoming\.length\}/)
  assert.match(workspace, /Include with this entry/)
  assert.match(workspace, /Add dependency/)
  assert.match(workspace, /!isCodexEntryArchived\(entry\)/)
})

test('Chat explicit Codex reads expose dependency metadata but dependency tools are not added', () => {
  assert.match(chatTools, /dependencies: edges\.filter\(\(edge\) => edge\.sourceId === entity\.id\)/)
  assert.match(chatTools, /neededBy: edges\.filter\(\(edge\) => edge\.targetId === entity\.id\)/)
  assert.doesNotMatch(chatTools, /propose_codex_dependency|create_codex_dependency|remove_codex_dependency/)
})

test('issue 85 alone does not change automatic context cascade', () => {
  assert.doesNotMatch(contextService, /listOutgoingCodexDependencies|includeWithSource|dependency of/i)
})

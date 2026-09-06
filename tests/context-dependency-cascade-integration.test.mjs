import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const context = readFileSync(new URL('../src/context-service.ts', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

test('only direct trigger matches seed dependency cascade and cascaded ids dedupe manual Codex', () => {
  assert.match(context, /cascadeAutomaticCodexDependencies\(\s*automaticMatches\.map\(\(match\) => match\.entry\)/s)
  assert.match(context, /const automaticIds = new Set\(automaticEntries\.map/)
  assert.match(context, /!automaticIds\.has\(item\.id\).*options\.profile\.codexEntryIds\.includes/s)
})

test('each cascaded entry independently uses normal Codex representation and no token pruning is added', () => {
  assert.match(context, /automaticEntries\.map\(\(item\) => codexContextRepresentation\(item\.entry, entities\)\)/)
  assert.doesNotMatch(context, /maxDepth|tokenThreshold|trimDependencies|dropDependenc/)
})

test('Request Preview distinguishes direct trigger matches from dependency paths', () => {
  assert.match(app, /Dependency cascade/)
  assert.match(app, /Dependency path:/)
  assert.match(app, /Direct trigger/)
})

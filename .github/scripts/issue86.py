from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'missing {label}')
    return text.replace(old, new, 1)

Path('src/codex-dependency-cascade.ts').write_text(r'''import { isCodexEntryArchived, type CodexDependencyEdge, type CodexEntryEntity } from './persistence'

export type CascadedCodexDependency = {
  entry: CodexEntryEntity
  pathIds: string[]
}

function edgeOrder(a: CodexDependencyEdge, b: CodexDependencyEdge) {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id)
}

export function cascadeAutomaticCodexDependencies(
  directEntries: CodexEntryEntity[],
  allEntries: CodexEntryEntity[],
  edges: CodexDependencyEdge[],
  excludeEntryId?: string,
): CascadedCodexDependency[] {
  const available = new Map(allEntries
    .filter((entry) => !isCodexEntryArchived(entry) && entry.id !== excludeEntryId)
    .map((entry) => [entry.id, entry]))
  const outgoing = new Map<string, CodexDependencyEdge[]>()
  for (const edge of edges.filter((candidate) => candidate.includeWithSource).sort(edgeOrder)) {
    const list = outgoing.get(edge.sourceId) ?? []
    list.push(edge)
    outgoing.set(edge.sourceId, list)
  }

  const directIds = new Set(directEntries.map((entry) => entry.id))
  const visited = new Set(directIds)
  const queue: Array<{ edge: CodexDependencyEdge; pathIds: string[] }> = []
  for (const root of directEntries) {
    for (const edge of outgoing.get(root.id) ?? []) queue.push({ edge, pathIds: [root.id] })
  }

  const result: CascadedCodexDependency[] = []
  while (queue.length) {
    const next = queue.shift()!
    const target = available.get(next.edge.targetId)
    if (!target) continue
    if (visited.has(target.id)) continue
    visited.add(target.id)
    const pathIds = [...next.pathIds, target.id]
    result.push({ entry: target, pathIds })
    for (const edge of outgoing.get(target.id) ?? []) queue.push({ edge, pathIds })
  }
  return result
}
''')

context = Path('src/context-service.ts')
c = context.read_text()
c = replace_once(c,
    "import { getBookContextSettings, isCodexEntryArchived, listEntitiesByBook, type ArcEntity, type CodexEntryEntity, type GenerationContextProfile, type GenerationContextType, type StructuralEntity, type SummaryEntity } from './persistence'\n",
    "import { getBookContextSettings, isCodexEntryArchived, listCodexDependencies, listEntitiesByBook, type ArcEntity, type CodexEntryEntity, type GenerationContextProfile, type GenerationContextType, type StructuralEntity, type SummaryEntity } from './persistence'\n",
    'dependency list import')
c = replace_once(c,
    "import { automaticCodexMatches, type CodexTriggerSceneMatch } from './codex-trigger-service'\n",
    "import { automaticCodexMatches, type CodexTriggerSceneMatch } from './codex-trigger-service'\nimport { cascadeAutomaticCodexDependencies } from './codex-dependency-cascade'\n",
    'cascade import')
c = replace_once(c,
    "export type PreparedAutomaticCodex = { entryId: string; title: string; category: string; representation: 'Full entry' | 'Summary'; fallbackReason?: string; matches: CodexTriggerSceneMatch[] }\n",
    "export type PreparedAutomaticCodex = { entryId: string; title: string; category: string; representation: 'Full entry' | 'Summary'; fallbackReason?: string; source: 'trigger' | 'dependency'; matches: CodexTriggerSceneMatch[]; dependencyPath?: Array<{ entryId: string; title: string }> }\n",
    'prepared type')
c = replace_once(c,
    "  const [entities, contextSettings] = await Promise.all([listEntitiesByBook(options.bookId), getBookContextSettings(options.bookId)])\n",
    "  const [entities, contextSettings, dependencyEdges] = await Promise.all([listEntitiesByBook(options.bookId), getBookContextSettings(options.bookId), listCodexDependencies(options.bookId)])\n",
    'dependency load')
old = r'''  const automaticMatches = ['scene', 'codex', 'chat'].includes(options.type) ? automaticCodexMatches({
    entities,
    scenes,
    anchorSceneId,
    anchorSceneText: liveCurrentText,
    previousSceneCount: options.previousScenesForCodexTriggers ?? contextSettings.previousScenesForCodexTriggers,
    excludeEntryId: options.type === 'codex' ? options.currentDocumentId : undefined,
  }) : []
  const automaticIds = new Set(automaticMatches.map((match) => match.entry.id))
  const automaticRepresentations = automaticMatches.map((match) => codexContextRepresentation(match.entry, entities))
  const automaticCodex: PreparedAutomaticCodex[] = automaticMatches.map((match) => {
    const representation = automaticRepresentations.find((candidate) => candidate.entryId === match.entry.id)!
    return { entryId: match.entry.id, title: match.entry.title, category: match.entry.category, representation: representation.representation, fallbackReason: representation.fallbackReason, matches: match.matches }
  })
  const automaticText = automaticMatches.map((match) => {
    const representation = automaticRepresentations.find((candidate) => candidate.entryId === match.entry.id)!
    return `### ${match.entry.category}: ${match.entry.title}

${representation.content}`
  }).join('\n\n')
  const automaticSection = automaticText ? section('Automatic Codex', automaticText) : ''

  const selectedCodex = entities.filter((item): item is CodexEntryEntity => item.type === 'codexEntry' && !isCodexEntryArchived(item) && item.id !== options.currentDocumentId && !automaticIds.has(item.id) && options.profile.codexEntryIds.includes(item.id))
'''
new = r'''  const automaticMatches = ['scene', 'codex', 'chat'].includes(options.type) ? automaticCodexMatches({
    entities,
    scenes,
    anchorSceneId,
    anchorSceneText: liveCurrentText,
    previousSceneCount: options.previousScenesForCodexTriggers ?? contextSettings.previousScenesForCodexTriggers,
    excludeEntryId: options.type === 'codex' ? options.currentDocumentId : undefined,
  }) : []
  const allCodexEntries = entities.filter((item): item is CodexEntryEntity => item.type === 'codexEntry')
  const cascadedDependencies = cascadeAutomaticCodexDependencies(
    automaticMatches.map((match) => match.entry),
    allCodexEntries,
    dependencyEdges,
    options.type === 'codex' ? options.currentDocumentId : undefined,
  )
  const automaticEntries = [
    ...automaticMatches.map((match) => ({ entry: match.entry, source: 'trigger' as const, matches: match.matches, pathIds: [match.entry.id] })),
    ...cascadedDependencies.map((item) => ({ entry: item.entry, source: 'dependency' as const, matches: [] as CodexTriggerSceneMatch[], pathIds: item.pathIds })),
  ]
  const automaticIds = new Set(automaticEntries.map((item) => item.entry.id))
  const automaticRepresentations = automaticEntries.map((item) => codexContextRepresentation(item.entry, entities))
  const codexById = new Map(allCodexEntries.map((entry) => [entry.id, entry]))
  const automaticCodex: PreparedAutomaticCodex[] = automaticEntries.map((item) => {
    const representation = automaticRepresentations.find((candidate) => candidate.entryId === item.entry.id)!
    const dependencyPath = item.source === 'dependency'
      ? item.pathIds.map((entryId) => codexById.get(entryId)).filter((entry): entry is CodexEntryEntity => Boolean(entry)).map((entry) => ({ entryId: entry.id, title: entry.title }))
      : undefined
    return { entryId: item.entry.id, title: item.entry.title, category: item.entry.category, representation: representation.representation, fallbackReason: representation.fallbackReason, source: item.source, matches: item.matches, dependencyPath }
  })
  const automaticText = automaticEntries.map((item) => {
    const representation = automaticRepresentations.find((candidate) => candidate.entryId === item.entry.id)!
    return `### ${item.entry.category}: ${item.entry.title}\n\n${representation.content}`
  }).join('\n\n')
  const automaticSection = automaticText ? section('Automatic Codex', automaticText) : ''

  const selectedCodex = entities.filter((item): item is CodexEntryEntity => item.type === 'codexEntry' && !isCodexEntryArchived(item) && item.id !== options.currentDocumentId && !automaticIds.has(item.id) && options.profile.codexEntryIds.includes(item.id))
'''
c = replace_once(c, old, new, 'automatic cascade block')
context.write_text(c)

app = Path('src/App.tsx')
a = app.read_text()
old_preview = '''        {preview.automaticCodex.length > 0 && <div className="automatic-codex-preview"><strong>Automatic Codex</strong>{preview.automaticCodex.map((item) => <article key={item.entryId}><header><b>{item.title}</b><small>{item.representation === 'Summary' ? 'Summary' : 'Full entry'}{item.fallbackReason ? ` · ${item.fallbackReason}` : ''}</small></header><ul>{item.matches.map((match, index) => <li key={`${item.entryId}-${match.sceneId}-${match.trigger}-${index}`}><code>{match.trigger}</code> · {match.sceneTitle}</li>)}</ul></article>)}</div>}'''
new_preview = '''        {preview.automaticCodex.length > 0 && <div className="automatic-codex-preview"><strong>Automatic Codex</strong>{preview.automaticCodex.map((item) => <article key={item.entryId} className={item.source === 'dependency' ? 'dependency-cascade' : 'trigger-match'}><header><b>{item.title}</b><small>{item.source === 'dependency' ? 'Dependency cascade' : 'Direct trigger'} · {item.representation === 'Summary' ? 'Summary' : 'Full entry'}{item.fallbackReason ? ` · ${item.fallbackReason}` : ''}</small></header>{item.source === 'dependency' ? <p>Dependency path: {(item.dependencyPath ?? []).map((step) => step.title).join(' → ')}</p> : <ul>{item.matches.map((match, index) => <li key={`${item.entryId}-${match.sceneId}-${match.trigger}-${index}`}><code>{match.trigger}</code> · {match.sceneTitle}</li>)}</ul>}</article>)}</div>}'''
a = replace_once(a, old_preview, new_preview, 'request preview cascade reasons')
app.write_text(a)

workspace = Path('src/Workspace.tsx')
w = workspace.read_text()
old_refusal = '''          showToast(`Context is too large: ~${diagnostics.requestTokens.toLocaleString()} input tokens for a ${diagnostics.usableInputTokens.toLocaleString()}-token usable budget (${diagnostics.effectiveContextTokens.toLocaleString()} effective limit, ${diagnostics.responseReserveTokens.toLocaleString()} reserved for the response). Deselect context, summarize older material, raise the cap, or choose a larger model.`)'''
new_refusal = '''          const dependencyTitles = prepared.automaticCodex.filter((item) => item.source === 'dependency').map((item) => item.title)
          showToast(`Context is too large: ~${diagnostics.requestTokens.toLocaleString()} input tokens for a ${diagnostics.usableInputTokens.toLocaleString()}-token usable budget (${diagnostics.effectiveContextTokens.toLocaleString()} effective limit, ${diagnostics.responseReserveTokens.toLocaleString()} reserved for the response). Deselect context, summarize older material, raise the cap, or choose a larger model.${dependencyTitles.length ? ` Dependency cascade includes: ${dependencyTitles.join(', ')}.` : ''}`)'''
w = replace_once(w, old_refusal, new_refusal, 'workspace cascade refusal')
old_warning = '''          showToast(`Context is near the configured limit (${Math.round(diagnostics.usageRatio * 100)}%). Consider summarizing older material, deselecting full-text context, or raising the cap before adding more context.`)'''
new_warning = '''          const dependencyTitles = prepared.automaticCodex.filter((item) => item.source === 'dependency').map((item) => item.title)
          showToast(`Context is near the configured limit (${Math.round(diagnostics.usageRatio * 100)}%). Consider summarizing older material, deselecting full-text context, or raising the cap before adding more context.${dependencyTitles.length ? ` Dependency cascade includes: ${dependencyTitles.join(', ')}.` : ''}`)'''
w = replace_once(w, old_warning, new_warning, 'workspace cascade warning')
workspace.write_text(w)

chat = Path('src/ChatFeature.tsx')
ch = chat.read_text()
old_chat_refusal = '''      throw new Error(`Context is too large: ~${diagnostics.requestTokens.toLocaleString()} input tokens for a ${diagnostics.usableInputTokens.toLocaleString()}-token usable Chat budget (${diagnostics.effectiveContextTokens.toLocaleString()} effective limit, ${diagnostics.responseReserveTokens.toLocaleString()} reserved for the response). Reduce Chat context, summarize older material, raise the cap, or choose a larger model.`)'''
new_chat_refusal = '''      const dependencyTitles = context.automaticCodex.filter((item) => item.source === 'dependency').map((item) => item.title)
      throw new Error(`Context is too large: ~${diagnostics.requestTokens.toLocaleString()} input tokens for a ${diagnostics.usableInputTokens.toLocaleString()}-token usable Chat budget (${diagnostics.effectiveContextTokens.toLocaleString()} effective limit, ${diagnostics.responseReserveTokens.toLocaleString()} reserved for the response). Reduce Chat context, summarize older material, raise the cap, or choose a larger model.${dependencyTitles.length ? ` Dependency cascade includes: ${dependencyTitles.join(', ')}.` : ''}`)'''
ch = replace_once(ch, old_chat_refusal, new_chat_refusal, 'chat cascade refusal')
old_chat_warning = '''    if (diagnostics.warning) onToast(`Chat context is near the configured limit (${Math.round(diagnostics.usageRatio * 100)}%). Consider reducing selected context or raising the cap.`)'''
new_chat_warning = '''    if (diagnostics.warning) {
      const dependencyTitles = context.automaticCodex.filter((item) => item.source === 'dependency').map((item) => item.title)
      onToast(`Chat context is near the configured limit (${Math.round(diagnostics.usageRatio * 100)}%). Consider reducing selected context or raising the cap.${dependencyTitles.length ? ` Dependency cascade includes: ${dependencyTitles.join(', ')}.` : ''}`)
    }'''
ch = replace_once(ch, old_chat_warning, new_chat_warning, 'chat cascade warning')
chat.write_text(ch)

Path('tests/codex-dependency-cascade.test.mjs').write_text(r'''import test from 'node:test'
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
''')

Path('tests/context-dependency-cascade-integration.test.mjs').write_text(r'''import test from 'node:test'
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
''')

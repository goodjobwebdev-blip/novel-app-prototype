from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'missing {label}')
    return text.replace(old, new, 1)

persistence = Path('src/persistence.ts')
p = persistence.read_text()
p = replace_once(
    p,
    "export type DocumentSnapshot = {\n",
    "export type CodexDependencyEdge = {\n  id: string\n  bookId: string\n  sourceId: string\n  targetId: string\n  relationLabel: string\n  includeWithSource: boolean\n  createdAt: number\n  updatedAt: number\n}\n\nexport type DocumentSnapshot = {\n",
    'dependency type',
)
p = replace_once(
    p,
    "      db.version(1).stores({\n        entities: 'id,type,bookId,parentId,[parentId+order],updatedAt',\n        snapshots: 'id,entityId,entityType,createdAt,[entityId+createdAt],reason',\n        meta: 'key',\n      })",
    "      db.version(1).stores({\n        entities: 'id,type,bookId,parentId,[parentId+order],updatedAt',\n        snapshots: 'id,entityId,entityType,createdAt,[entityId+createdAt],reason',\n        meta: 'key',\n      })\n      db.version(2).stores({\n        entities: 'id,type,bookId,parentId,[parentId+order],updatedAt',\n        snapshots: 'id,entityId,entityType,createdAt,[entityId+createdAt],reason',\n        codexDependencies: 'id,bookId,sourceId,targetId,[bookId+sourceId],[bookId+targetId],[sourceId+targetId],updatedAt',\n        meta: 'key',\n      })",
    'database v2',
)

anchor = "export async function listEntitiesByParent(parentId: string): Promise<ArcEntity[]> {"
api = r'''export async function listCodexDependencies(bookId: string): Promise<CodexDependencyEdge[]> {
  const db = await database()
  const edges = await db.table('codexDependencies').where('bookId').equals(bookId).toArray() as CodexDependencyEdge[]
  return edges.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}

export async function listOutgoingCodexDependencies(bookId: string, sourceId: string): Promise<CodexDependencyEdge[]> {
  const db = await database()
  const edges = await db.table('codexDependencies').where('[bookId+sourceId]').equals([bookId, sourceId]).toArray() as CodexDependencyEdge[]
  return edges.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}

export async function listIncomingCodexDependencies(bookId: string, targetId: string): Promise<CodexDependencyEdge[]> {
  const db = await database()
  const edges = await db.table('codexDependencies').where('[bookId+targetId]').equals([bookId, targetId]).toArray() as CodexDependencyEdge[]
  return edges.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}

export async function createCodexDependency(bookId: string, sourceId: string, targetId: string, relationLabel = ''): Promise<CodexDependencyEdge> {
  if (sourceId === targetId) throw new Error('A Codex entry cannot depend on itself.')
  const db = await database()
  return db.transaction('rw', db.table('entities'), db.table('codexDependencies'), async () => {
    const [source, target] = await Promise.all([
      db.table('entities').get(sourceId) as Promise<CodexEntryEntity | undefined>,
      db.table('entities').get(targetId) as Promise<CodexEntryEntity | undefined>,
    ])
    if (!source || source.type !== 'codexEntry' || source.bookId !== bookId) throw new Error('The dependency source is not available in this Book.')
    if (!target || target.type !== 'codexEntry' || target.bookId !== bookId) throw new Error('The dependency target is not available in this Book.')
    if (isCodexEntryArchived(target)) throw new Error('Restore the target Codex entry before adding it as a dependency.')
    const duplicate = await db.table('codexDependencies').where('[sourceId+targetId]').equals([sourceId, targetId]).first() as CodexDependencyEdge | undefined
    if (duplicate) throw new Error('This dependency already exists.')
    const now = Date.now()
    const edge: CodexDependencyEdge = {
      id: makeId('codex-dependency'),
      bookId,
      sourceId,
      targetId,
      relationLabel: relationLabel.trim(),
      includeWithSource: true,
      createdAt: now,
      updatedAt: now,
    }
    await db.table('codexDependencies').put(edge)
    return edge
  })
}

export async function updateCodexDependency(id: string, patch: { relationLabel?: string; includeWithSource?: boolean }): Promise<CodexDependencyEdge> {
  const db = await database()
  return db.transaction('rw', db.table('codexDependencies'), async () => {
    const current = await db.table('codexDependencies').get(id) as CodexDependencyEdge | undefined
    if (!current) throw new Error('This dependency no longer exists.')
    const next = {
      ...(patch.relationLabel !== undefined ? { relationLabel: patch.relationLabel.trim() } : {}),
      ...(patch.includeWithSource !== undefined ? { includeWithSource: patch.includeWithSource } : {}),
      updatedAt: Date.now(),
    }
    await db.table('codexDependencies').update(id, next)
    const updated = await db.table('codexDependencies').get(id) as CodexDependencyEdge | undefined
    if (!updated) throw new Error('This dependency no longer exists.')
    return updated
  })
}

export async function removeCodexDependency(id: string): Promise<void> {
  const db = await database()
  await db.table('codexDependencies').delete(id)
}

'''
p = replace_once(p, anchor, api + anchor, 'dependency persistence api')

pattern = re.compile(r"export async function deleteEntityTree\(id: string\): Promise<string\[]> \{.*?\n\}\n\nexport async function deleteEntity\(id: string\) \{.*?\n\}", re.S)
match = pattern.search(p)
if not match:
    raise SystemExit('missing delete functions')
replacement = r'''export async function deleteEntityTree(id: string): Promise<string[]> {
  const db = await database()
  let deletedIds: string[] = []
  await db.transaction('rw', db.table('entities'), db.table('snapshots'), db.table('codexDependencies'), async () => {
    const { root, ids } = await collectEntityTreeIdsWithDb(db, id)
    deletedIds = ids
    const removedIds = new Set(ids)
    await db.table('entities').bulkDelete(ids)
    const snapshots: DocumentSnapshot[] = await db.table('snapshots').toArray()
    const snapshotIds = snapshots.filter((snapshot) => removedIds.has(snapshot.entityId)).map((snapshot) => snapshot.id)
    if (snapshotIds.length) await db.table('snapshots').bulkDelete(snapshotIds)
    const dependencies = await db.table('codexDependencies').toArray() as CodexDependencyEdge[]
    const dependencyIds = dependencies.filter((edge) => removedIds.has(edge.sourceId) || removedIds.has(edge.targetId)).map((edge) => edge.id)
    if (dependencyIds.length) await db.table('codexDependencies').bulkDelete(dependencyIds)
    await touchAncestors(db, root?.parentId, Date.now())
  })
  return deletedIds
}

export async function deleteEntity(id: string) {
  const db = await database()
  await db.transaction('rw', db.table('entities'), db.table('codexDependencies'), async () => {
    await db.table('entities').delete(id)
    const dependencies = await db.table('codexDependencies').toArray() as CodexDependencyEdge[]
    const dependencyIds = dependencies.filter((edge) => edge.sourceId === id || edge.targetId === id).map((edge) => edge.id)
    if (dependencyIds.length) await db.table('codexDependencies').bulkDelete(dependencyIds)
  })
}'''
p = p[:match.start()] + replacement + p[match.end():]
persistence.write_text(p)

workspace = Path('src/Workspace.tsx')
w = workspace.read_text()
w = replace_once(w, "  createCodexEntry,\n", "  createCodexEntry,\n  createCodexDependency,\n", 'workspace create dependency import')
w = replace_once(w, "  listBooks,\n", "  listBooks,\n  listCodexDependencies,\n", 'workspace list dependency import')
w = replace_once(w, "  restoreCodexEntry,\n", "  restoreCodexEntry,\n  removeCodexDependency,\n", 'workspace remove dependency import')
w = replace_once(w, "  updateCodexCategory,\n", "  updateCodexCategory,\n  updateCodexDependency,\n", 'workspace update dependency import')
w = replace_once(w, "  type CodexEntryEntity,\n", "  type CodexDependencyEdge,\n  type CodexEntryEntity,\n", 'workspace dependency type import')
w = replace_once(w, "import './codex-mentions.css'\n", "import './codex-mentions.css'\nimport './codex-dependencies.css'\n", 'dependency css import')
w = replace_once(w, "  const [codexEntries, setCodexEntries] = useState<CodexEntryEntity[]>([])\n", "  const [codexEntries, setCodexEntries] = useState<CodexEntryEntity[]>([])\n  const [codexDependencies, setCodexDependencies] = useState<CodexDependencyEdge[]>([])\n", 'dependency state')

w = replace_once(
    w,
    "        const entities = book ? await listEntitiesByBook(book.id) : []\n",
    "        const entities = book ? await listEntitiesByBook(book.id) : []\n        const initialCodexDependencies = book ? await listCodexDependencies(book.id) : []\n",
    'initial dependency load',
)
w = replace_once(
    w,
    "        setCodexEntries(entities.filter((entity): entity is CodexEntryEntity => entity.type === 'codexEntry'))\n        setSummaryStates(initialSummaryStates)\n",
    "        setCodexEntries(entities.filter((entity): entity is CodexEntryEntity => entity.type === 'codexEntry'))\n        setCodexDependencies(initialCodexDependencies)\n        setSummaryStates(initialSummaryStates)\n",
    'initial dependency state',
)
w = replace_once(
    w,
    "  type LoadedBookContent = {\n    structural: StructuralEntity[]\n    notes: NoteEntity[]\n    codexEntries: CodexEntryEntity[]\n    summaryStates: Record<string, SummaryState>\n  }\n\n  async function readBookContent(bookId: string): Promise<LoadedBookContent> {\n    const entities = await listEntitiesByBook(bookId)\n    const summaryStateSnapshot = await getSummaryStateMap(bookId)\n    return {\n      structural: entities.filter((entity): entity is StructuralEntity => ['act', 'chapter', 'scene'].includes(entity.type)),\n      notes: entities.filter((entity): entity is NoteEntity => entity.type === 'note').sort((a, b) => b.updatedAt - a.updatedAt),\n      codexEntries: entities.filter((entity): entity is CodexEntryEntity => entity.type === 'codexEntry').sort((a, b) => a.title.localeCompare(b.title)),\n      summaryStates: summaryStateSnapshot,\n    }\n  }\n\n  function applyBookContent(content: LoadedBookContent) {\n    setOutlineEntities(content.structural)\n    setNotes(content.notes)\n    setCodexEntries(content.codexEntries)\n    setSummaryStates(content.summaryStates)\n  }",
    "  type LoadedBookContent = {\n    structural: StructuralEntity[]\n    notes: NoteEntity[]\n    codexEntries: CodexEntryEntity[]\n    codexDependencies: CodexDependencyEdge[]\n    summaryStates: Record<string, SummaryState>\n  }\n\n  async function readBookContent(bookId: string): Promise<LoadedBookContent> {\n    const [entities, codexDependencySnapshot, summaryStateSnapshot] = await Promise.all([\n      listEntitiesByBook(bookId),\n      listCodexDependencies(bookId),\n      getSummaryStateMap(bookId),\n    ])\n    return {\n      structural: entities.filter((entity): entity is StructuralEntity => ['act', 'chapter', 'scene'].includes(entity.type)),\n      notes: entities.filter((entity): entity is NoteEntity => entity.type === 'note').sort((a, b) => b.updatedAt - a.updatedAt),\n      codexEntries: entities.filter((entity): entity is CodexEntryEntity => entity.type === 'codexEntry').sort((a, b) => a.title.localeCompare(b.title)),\n      codexDependencies: codexDependencySnapshot,\n      summaryStates: summaryStateSnapshot,\n    }\n  }\n\n  function applyBookContent(content: LoadedBookContent) {\n    setOutlineEntities(content.structural)\n    setNotes(content.notes)\n    setCodexEntries(content.codexEntries)\n    setCodexDependencies(content.codexDependencies)\n    setSummaryStates(content.summaryStates)\n  }",
    'book content dependency load',
)
w = re.sub(r"(?m)^(\s*)setCodexEntries\(\[\]\)\n(?!\1setCodexDependencies)", lambda m: f"{m.group(1)}setCodexEntries([])\n{m.group(1)}setCodexDependencies([])\n", w)

insert_before = "  async function archiveCodex(entity: CodexEntryEntity) {"
handlers = r'''  async function addCodexDependency(sourceId: string, targetId: string) {
    if (!currentBook || sourceId !== activeDocumentIdRef.current) return
    try {
      const edge = await createCodexDependency(currentBook.id, sourceId, targetId)
      setCodexDependencies((items) => [...items, edge].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)))
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not add the dependency.')
    }
  }

  async function changeCodexDependency(edgeId: string, patch: { relationLabel?: string; includeWithSource?: boolean }) {
    try {
      const updated = await updateCodexDependency(edgeId, patch)
      setCodexDependencies((items) => items.map((edge) => edge.id === updated.id ? updated : edge))
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not update the dependency.')
    }
  }

  async function deleteCodexDependency(edgeId: string) {
    try {
      await removeCodexDependency(edgeId)
      setCodexDependencies((items) => items.filter((edge) => edge.id !== edgeId))
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not remove the dependency.')
    }
  }

'''
w = replace_once(w, insert_before, handlers + insert_before, 'dependency handlers')

needle = "        {activeDocument?.type === 'summary' && summaryContextIndicator && <div className=\"summary-context-indicator\">{summaryContextIndicator}</div>}"
component_call = "        {activeDocument?.type === 'codexEntry' && <CodexDependenciesMetadata key={`dependencies-${activeDocument.id}`} source={activeDocument} entries={codexEntries} edges={codexDependencies} readOnly={activeCodexArchived} onAdd={(targetId) => addCodexDependency(activeDocument.id, targetId)} onUpdate={changeCodexDependency} onRemove={deleteCodexDependency} onOpen={(entryId) => { void loadDocument(entryId) }} />}\n"
w = replace_once(w, needle, component_call + needle, 'dependency editor placement')

component_anchor = "function Outline({ book, entities, activeSceneId, summaryStates, expandedIds, onToggle, onOpenScene, onOpenSummary, onCreate, onAutotitle, onRead, onRename, onMove, onDelete }: OutlineProps) {"
component = r'''function CodexDependenciesMetadata({ source, entries, edges, readOnly, onAdd, onUpdate, onRemove, onOpen }: {
  source: CodexEntryEntity
  entries: CodexEntryEntity[]
  edges: CodexDependencyEdge[]
  readOnly: boolean
  onAdd: (targetId: string) => Promise<void>
  onUpdate: (edgeId: string, patch: { relationLabel?: string; includeWithSource?: boolean }) => Promise<void>
  onRemove: (edgeId: string) => Promise<void>
  onOpen: (entryId: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const outgoing = edges.filter((edge) => edge.sourceId === source.id)
  const incoming = edges.filter((edge) => edge.targetId === source.id)
  const linkedIds = new Set(outgoing.map((edge) => edge.targetId))
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const candidates = entries
    .filter((entry) => entry.id !== source.id && !linkedIds.has(entry.id) && !isCodexEntryArchived(entry))
    .filter((entry) => !normalizedQuery || `${entry.title} ${entry.category}`.toLocaleLowerCase().includes(normalizedQuery))
    .sort((a, b) => a.title.localeCompare(b.title))

  return <section className={`codex-dependencies-metadata ${readOnly ? 'read-only' : ''}`} aria-label="Codex dependencies">
    <details className="codex-dependency-section">
      <summary><span>Dependencies · {outgoing.length}</span><small>Lore this entry may need when Arc includes it automatically.</small></summary>
      <div className="codex-dependency-content">
        {outgoing.length ? outgoing.map((edge) => {
          const target = byId.get(edge.targetId)
          const archived = Boolean(target && isCodexEntryArchived(target))
          return <article className={`codex-dependency-row ${archived ? 'archived' : ''}`} key={edge.id}>
            <button type="button" className="codex-dependency-open" disabled={!target} onClick={() => target && onOpen(target.id)}><span><strong>{target?.title ?? 'Missing dependency'}</strong><small>{target ? `${target.category}${archived ? ' · Archived · inactive for AI context' : ''}` : 'Target no longer exists'}</small></span><ChevronRight aria-hidden="true" /></button>
            <label className="codex-dependency-label"><span>Relation</span><input disabled={readOnly} defaultValue={edge.relationLabel} placeholder="Optional, e.g. member of" onBlur={(event) => { if (event.target.value.trim() !== edge.relationLabel) void onUpdate(edge.id, { relationLabel: event.target.value }) }} /></label>
            <label className="codex-dependency-include"><input type="checkbox" disabled={readOnly || archived || !target} checked={edge.includeWithSource} onChange={(event) => { void onUpdate(edge.id, { includeWithSource: event.target.checked }) }} /><span><strong>Include with this entry</strong><small>{archived ? 'Inactive while target is archived' : 'Available to automatic dependency cascade'}</small></span></label>
            {!readOnly && <button type="button" className="codex-dependency-remove" onClick={() => { void onRemove(edge.id) }}><Trash2 aria-hidden="true" /> Remove</button>}
          </article>
        }) : <p className="codex-dependency-empty">No dependencies yet.</p>}
        {!readOnly && <div className="codex-dependency-add">
          <button type="button" onClick={() => { setAdding((value) => !value); setQuery('') }}><Plus aria-hidden="true" /> Add dependency</button>
          {adding && <div className="codex-dependency-picker">
            <label><Search aria-hidden="true" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search active Codex by title or category" /></label>
            <div>{candidates.length ? candidates.map((entry) => <button type="button" key={entry.id} onClick={() => { void onAdd(entry.id); setAdding(false); setQuery('') }}><span><strong>{entry.title}</strong><small>{entry.category}</small></span><Plus aria-hidden="true" /></button>) : <p>No available Codex entries match.</p>}</div>
          </div>}
        </div>}
      </div>
    </details>
    <details className="codex-dependency-section needed-by">
      <summary><span>Needed by · {incoming.length}</span><small>Entries that declare this lore as a dependency.</small></summary>
      <div className="codex-dependency-content">
        {incoming.length ? incoming.map((edge) => {
          const owner = byId.get(edge.sourceId)
          return <button className="codex-needed-by-row" type="button" key={edge.id} disabled={!owner} onClick={() => owner && onOpen(owner.id)}><span><strong>{owner?.title ?? 'Missing source'}</strong><small>{owner ? `${owner.category}${edge.relationLabel ? ` · ${edge.relationLabel}` : ''}` : 'Source no longer exists'}</small></span><ChevronRight aria-hidden="true" /></button>
        }) : <p className="codex-dependency-empty">No entries currently need this one.</p>}
      </div>
    </details>
  </section>
}

'''
w = replace_once(w, component_anchor, component + component_anchor, 'dependency component')
workspace.write_text(w)

chat_tools = Path('src/chat-tools.ts')
c = chat_tools.read_text()
c = replace_once(c, "  listEntitiesByBook,\n", "  listEntitiesByBook,\n  listCodexDependencies,\n", 'chat dependency import')
old_read = r'''    if (call.function.name === 'read_entity') {
      const entityId = typeof args.entity_id === 'string' ? args.entity_id : ''
      const entity = await editableEntity(bookId, entityId)
      return { content: toolResult({
        ok: true,
        entity: {
          id: entity.id,
          type: entity.type,
          title: titleFor(entity),
          category: entity.type === 'codexEntry' ? String(entity.category ?? 'Other') : undefined,
          updatedAt: entity.updatedAt,
          content: String(entity.content ?? ''),
        },
      }) }
    }
'''
new_read = r'''    if (call.function.name === 'read_entity') {
      const entityId = typeof args.entity_id === 'string' ? args.entity_id : ''
      const entity = await editableEntity(bookId, entityId)
      let dependencyMetadata: Record<string, unknown> = {}
      if (entity.type === 'codexEntry') {
        const [edges, codexEntries] = await Promise.all([
          listCodexDependencies(bookId),
          listEntitiesByBook(bookId, 'codexEntry'),
        ])
        const byId = new Map(codexEntries.map((entry) => [entry.id, entry]))
        dependencyMetadata = {
          dependencies: edges.filter((edge) => edge.sourceId === entity.id).map((edge) => {
            const target = byId.get(edge.targetId)
            return { targetId: edge.targetId, title: titleFor(target ?? { title: 'Missing dependency' } as ArcEntity), category: target ? String(target.category ?? 'Other') : undefined, relationLabel: edge.relationLabel || undefined, includeWithSource: edge.includeWithSource, inactive: !target || isCodexEntryArchived(target) }
          }),
          neededBy: edges.filter((edge) => edge.targetId === entity.id).map((edge) => {
            const source = byId.get(edge.sourceId)
            return { sourceId: edge.sourceId, title: titleFor(source ?? { title: 'Missing source' } as ArcEntity), category: source ? String(source.category ?? 'Other') : undefined, relationLabel: edge.relationLabel || undefined, inactive: !source || isCodexEntryArchived(source) }
          }),
        }
      }
      return { content: toolResult({
        ok: true,
        entity: {
          id: entity.id,
          type: entity.type,
          title: titleFor(entity),
          category: entity.type === 'codexEntry' ? String(entity.category ?? 'Other') : undefined,
          updatedAt: entity.updatedAt,
          content: String(entity.content ?? ''),
          ...dependencyMetadata,
        },
      }) }
    }
'''
c = replace_once(c, old_read, new_read, 'chat read dependency metadata')
chat_tools.write_text(c)

Path('src/codex-dependencies.css').write_text(r'''.codex-dependencies-metadata{width:min(780px,calc(100% - 32px));margin:0 auto 18px;display:grid;gap:8px}.codex-dependency-section{border:1px solid color-mix(in srgb,currentColor 14%,transparent);border-radius:14px;background:color-mix(in srgb,var(--surface,#fff) 86%,transparent);overflow:visible}.codex-dependency-section>summary{cursor:pointer;list-style:none;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:12px}.codex-dependency-section>summary::-webkit-details-marker{display:none}.codex-dependency-section>summary span{font-weight:700}.codex-dependency-section>summary small{opacity:.62;text-align:right}.codex-dependency-content{padding:0 12px 12px;display:grid;gap:9px}.codex-dependency-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(150px,.65fr);gap:9px;padding:10px;border:1px solid color-mix(in srgb,currentColor 10%,transparent);border-radius:12px}.codex-dependency-row.archived{opacity:.72}.codex-dependency-open,.codex-needed-by-row{border:0;background:transparent;color:inherit;display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left;min-width:0;padding:4px;cursor:pointer}.codex-dependency-open span,.codex-needed-by-row span{display:grid;min-width:0}.codex-dependency-open strong,.codex-needed-by-row strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.codex-dependency-open small,.codex-needed-by-row small,.codex-dependency-include small{opacity:.62}.codex-dependency-label{display:grid;gap:4px}.codex-dependency-label>span{font-size:.72rem;opacity:.65}.codex-dependency-label input{width:100%;box-sizing:border-box}.codex-dependency-include{grid-column:1/2;display:flex;align-items:flex-start;gap:8px}.codex-dependency-include span{display:grid}.codex-dependency-remove{grid-column:2/3;justify-self:end;align-self:end}.codex-dependency-add{position:relative}.codex-dependency-picker{position:absolute;z-index:12;left:0;right:0;top:calc(100% + 6px);padding:10px;border-radius:12px;border:1px solid color-mix(in srgb,currentColor 14%,transparent);background:var(--surface,#fff);box-shadow:0 12px 36px rgba(0,0,0,.15)}.codex-dependency-picker>label{display:flex;gap:7px;align-items:center}.codex-dependency-picker input{width:100%}.codex-dependency-picker>div{max-height:240px;overflow:auto;margin-top:8px;display:grid;gap:4px}.codex-dependency-picker>div>button{display:flex;align-items:center;justify-content:space-between;text-align:left}.codex-dependency-picker>div>button span{display:grid}.codex-needed-by-row{width:100%;padding:9px 10px;border:1px solid color-mix(in srgb,currentColor 9%,transparent);border-radius:10px}.codex-dependency-empty{margin:2px 0;opacity:.62}.codex-dependencies-metadata.read-only .codex-dependency-section{opacity:.9}@media(max-width:700px){.codex-dependencies-metadata{width:calc(100% - 20px);margin-bottom:14px}.codex-dependency-section>summary{align-items:flex-start;flex-direction:column}.codex-dependency-section>summary small{text-align:left}.codex-dependency-row{grid-template-columns:1fr}.codex-dependency-include,.codex-dependency-remove{grid-column:1}.codex-dependency-remove{justify-self:start}.codex-dependency-picker{position:fixed;left:10px;right:10px;top:auto;bottom:78px;max-height:55vh}}
''')

Path('tests/codex-dependencies.test.mjs').write_text(r'''import test from 'node:test'
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
''')

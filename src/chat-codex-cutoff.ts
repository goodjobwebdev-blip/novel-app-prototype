import type { ChatToolCall } from './chat-api'
import { listEntitiesByBook, type CodexEntryEntity } from './persistence'
import { searchBookEntities } from './chat-search'

/** Normal author chat may restrict lore without restricting manuscript discovery. */
export async function executeCodexCutoffRead(bookId: string, call: ChatToolCall, entries?: CodexEntryEntity[]): Promise<string | undefined> {
  if (!entries) return undefined
  try {
    const args = JSON.parse(call.function.arguments || '{}'), name = call.function.name
    const entry = entries.find(item => item.id === args.entity_id)
    if (name === 'list_entities' || name === 'search_entities') {
      const other = (await listEntitiesByBook(bookId)).filter(item => item.type !== 'codexEntry')
      return JSON.stringify(searchBookEntities([...other, ...entries], args, name === 'list_entities'))
    }
    if (!entry) return undefined
    if (name === 'read_entity') return JSON.stringify({ ok: true, entity: { id: entry.id, type: entry.type, title: entry.title, category: entry.category, updatedAt: entry.updatedAt, content: entry.content, representation: 'State at captured scene', planningBlocks: [] } })
    if (name === 'read_summary') return JSON.stringify({ ok: true, entityId: entry.id, state: typeof entry.timelineSummary === 'string' ? 'current' : 'missing', content: entry.timelineSummary ?? '', representation: 'State at captured scene' })
    if (['propose_document_edit', 'propose_document_replacement', 'propose_summary_regeneration'].includes(name)) return JSON.stringify({ ok: false, error: 'This is a captured checkpoint state. Edit the checkpoint in Codex, or turn off the author-chat lore cutoff before proposing baseline edits.' })
  } catch (reason) { return JSON.stringify({ ok: false, error: (reason as Error).message }) }
  return undefined
}

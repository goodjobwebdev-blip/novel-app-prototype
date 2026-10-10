import type { CodexEntryEntity } from '../../data/persistence'
import { proseText } from '../editor/document-projection.ts'
export type CodexDashboardPreferences = { view: 'list' | 'cards'; sort: 'title' | 'edited' | 'type'; archived: boolean; typeId: string; scope: 'all' | 'book' | 'world' | 'inherited' | 'override'; status: 'all' | 'draft' | 'active'; summary: 'all' | 'missing' | 'current' | 'outdated'; triggers: 'all' | 'yes' | 'no'; query: string }
export const defaultCodexDashboard: CodexDashboardPreferences = { view: 'list', sort: 'title', archived: false, typeId: '', scope: 'all', status: 'all', summary: 'all', triggers: 'all', query: '' }
export function dashboardPreferences(value?: Partial<CodexDashboardPreferences>): CodexDashboardPreferences {
  return { view: value?.view === 'cards' ? 'cards' : 'list', sort: value?.sort === 'edited' || value?.sort === 'type' ? value.sort : 'title', archived: value?.archived === true, typeId: typeof value?.typeId === 'string' ? value.typeId : '', scope: value?.scope === 'inherited' ? 'world' : value?.scope === 'override' ? 'book' : value?.scope === 'book' || value?.scope === 'world' ? value.scope : 'all', status: value?.status === 'draft' || value?.status === 'active' ? value.status : 'all', summary: ['missing','current','outdated'].includes(value?.summary ?? '') ? value!.summary! : 'all', triggers: value?.triggers === 'yes' || value?.triggers === 'no' ? value.triggers : 'all', query: typeof value?.query === 'string' ? value.query : '' }
}
export function queryCodexDashboard(entries: CodexEntryEntity[], preferences: CodexDashboardPreferences, summaries: Record<string, string>) {
  const query = preferences.query.trim().toLocaleLowerCase()
  return entries.filter(entry => {
    const archived = Boolean(entry.archivedAt), scope = entry.worldId ? 'world' : entry.codexScope === 'inherited' ? 'inherited' : entry.codexScope === 'override' ? 'override' : 'book'
    const status = entry.codexStatus === 'draft' ? 'draft' : 'active'
    const hasTriggers = Boolean(entry.autoIncludeTriggers?.some(text => text.trim()))
    return !entry.hiddenInBook && archived === preferences.archived && (preferences.archived || !preferences.status || preferences.status === 'all' || preferences.status === status) && (!preferences.typeId || (entry.typeId ?? entry.category) === preferences.typeId) && (preferences.scope === 'all' || preferences.scope === scope || (preferences.scope === 'world' && scope === 'inherited')) && (preferences.summary === 'all' || preferences.summary === (summaries[entry.id] ?? 'missing')) && (preferences.triggers === 'all' || hasTriggers === (preferences.triggers === 'yes')) && (!query || `${entry.title} ${entry.category} ${proseText(entry.content)}`.toLocaleLowerCase().includes(query))
  }).sort((a, b) => (preferences.sort === 'edited' ? b.updatedAt - a.updatedAt : preferences.sort === 'type' ? a.category.localeCompare(b.category) : 0) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
}
export const CODEX_PAGE_SIZE = 40

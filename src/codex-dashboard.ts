import type { CodexEntryEntity } from './persistence'
import { proseText } from './document-projection.ts'
export type CodexDashboardPreferences = { view: 'list' | 'cards'; sort: 'title' | 'edited' | 'type'; archived: boolean; typeId: string; scope: 'all' | 'book' | 'inherited' | 'override'; summary: 'all' | 'missing' | 'current' | 'outdated'; triggers: 'all' | 'yes' | 'no'; query: string }
export const defaultCodexDashboard: CodexDashboardPreferences = { view: 'list', sort: 'title', archived: false, typeId: '', scope: 'all', summary: 'all', triggers: 'all', query: '' }
export function dashboardPreferences(value?: Partial<CodexDashboardPreferences>): CodexDashboardPreferences {
  return { view: value?.view === 'cards' ? 'cards' : 'list', sort: value?.sort === 'edited' || value?.sort === 'type' ? value.sort : 'title', archived: value?.archived === true, typeId: typeof value?.typeId === 'string' ? value.typeId : '', scope: ['book','inherited','override'].includes(value?.scope ?? '') ? value!.scope! : 'all', summary: ['missing','current','outdated'].includes(value?.summary ?? '') ? value!.summary! : 'all', triggers: value?.triggers === 'yes' || value?.triggers === 'no' ? value.triggers : 'all', query: typeof value?.query === 'string' ? value.query : '' }
}
export function queryCodexDashboard(entries: CodexEntryEntity[], preferences: CodexDashboardPreferences, summaries: Record<string, string>) {
  const query = preferences.query.trim().toLocaleLowerCase()
  return entries.filter(entry => {
    const archived = Boolean(entry.archivedAt), scope = entry.codexScope === 'inherited' ? 'inherited' : entry.codexScope === 'override' ? 'override' : 'book'
    const hasTriggers = Boolean(entry.autoIncludeTriggers?.some(text => text.trim()))
    return !entry.hiddenInBook && archived === preferences.archived && (!preferences.typeId || (entry.typeId ?? entry.category) === preferences.typeId) && (preferences.scope === 'all' || preferences.scope === scope) && (preferences.summary === 'all' || preferences.summary === (summaries[entry.id] ?? 'missing')) && (preferences.triggers === 'all' || hasTriggers === (preferences.triggers === 'yes')) && (!query || `${entry.title} ${entry.category} ${proseText(entry.content)}`.toLocaleLowerCase().includes(query))
  }).sort((a, b) => (preferences.sort === 'edited' ? b.updatedAt - a.updatedAt : preferences.sort === 'type' ? a.category.localeCompare(b.category) : 0) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
}
export const CODEX_PAGE_SIZE = 40

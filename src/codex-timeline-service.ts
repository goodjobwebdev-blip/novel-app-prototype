import { database, getEntity, getBookAiSettings, isCodexEntryArchived, type ArcEntity, type BookEntity, type CodexEntryEntity } from './persistence'
import { synchronizeSeriesCodex } from './series-codex'
import { checkpointPlaced, resolveCodexState, timelineOrderSignature, type CodexCheckpoint, type StoryCutoff, type TimelineMode, type TimelineWorld } from './codex-timeline'
import { proseText } from './document-projection.ts'
import { loadAiSettings } from './ai-settings'
import { streamTextProviderCompletion } from './text-provider'

export async function readTimelineWorld(bookId: string): Promise<TimelineWorld> {
  const db = await database()
  const all = await db.table('entities').where('type').anyOf(['book', 'act', 'chapter', 'scene']).toArray() as ArcEntity[]
  const book = all.find(e => e.id === bookId) as BookEntity | undefined
  if (!book) throw new Error('This book no longer exists.')
  const books = all.filter((e): e is BookEntity => e.type === 'book' && (e.id === bookId || Boolean(book.seriesId && e.seriesId === book.seriesId)))
  const ids = new Set(books.map(book => book.id))
  return { books, outline: all.filter(e => e.type !== 'book' && ids.has(e.bookId ?? '')) }
}
function notify(bookId: string, entityId: string) { if (typeof window !== 'undefined') { window.dispatchEvent(new CustomEvent('arc-entity-changed', { detail: { bookId, entityId } })); window.dispatchEvent(new Event('arc-series-codex-changed')) } }
export async function saveCodexCheckpoints(bookId: string, entryId: string, before: CodexCheckpoint[], checkpoints: CodexCheckpoint[]) {
  const db = await database(); await synchronizeSeriesCodex(db, bookId)
  const world = await readTimelineWorld(bookId)
  const result = await db.transaction('rw', db.table('entities'), async () => {
    const book = await db.table('entities').get(bookId) as BookEntity | undefined
    const entry = await db.table('entities').get(entryId) as CodexEntryEntity | undefined
    if (!book || entry?.type !== 'codexEntry' || isCodexEntryArchived(entry) || entry.codexScope === 'inherited' || (entry.bookId !== bookId && !(entry.codexScope === 'series' && entry.bookId === book.seriesId))) throw new Error('Edit this book’s own entry or explicitly open its series source before changing checkpoints.')
    if (JSON.stringify(entry.checkpoints ?? []) !== JSON.stringify(before)) throw new Error('These checkpoints changed. Reopen the timeline before saving.')
    if (checkpoints.length > 500 || new Set(checkpoints.map(p => p.id)).size !== checkpoints.length) throw new Error('Checkpoint IDs must be distinct (maximum 500 checkpoints).')
    const anchors = new Set<string>()
    for (const point of checkpoints) {
      if (!point.id || !point.label.trim() || typeof point.content !== 'string' || !Number.isFinite(point.revision)) throw new Error('Each checkpoint needs a label and a body.')
      const old = before.find(p => p.id === point.id)
      const anchorChanged = !old || old.anchorBookId !== point.anchorBookId || old.sceneId !== point.sceneId
      if (anchorChanged) {
        const scene = await db.table('entities').get(point.sceneId), anchorBook = await db.table('entities').get(point.anchorBookId)
        if (scene?.type !== 'scene' || scene.bookId !== point.anchorBookId || !checkpointPlaced(point, world) || (point.anchorBookId !== bookId && (!(entry.seriesSourceId || entry.codexScope === 'series') || !book.seriesId || anchorBook?.seriesId !== book.seriesId))) throw new Error('Choose an existing scene in the entry’s book or shared series.')
      }
      const anchor = point.anchorBookId + ':' + point.sceneId
      if (anchors.has(anchor)) throw new Error('Use one checkpoint per scene; edit the existing checkpoint for that position.')
      anchors.add(anchor)
    }
    const revision = Math.max(Date.now(), entry.updatedAt + 1, (entry.sourceRevision ?? 0) + 1)
    const next = { ...entry, checkpoints: checkpoints.map(point => ({ ...point, label: point.label.trim(), revision: before.some(old => JSON.stringify(old) === JSON.stringify(point)) ? point.revision : revision })), updatedAt: revision, sourceRevision: revision }
    await db.table('entities').put(next); return next
  }); notify(bookId, entryId); return result
}
export async function generateTimelineSummary(bookId: string, entryId: string, checkpointId: string, mode: TimelineMode, signal: AbortSignal) {
  const entry = await getEntity<CodexEntryEntity>(entryId), world = await readTimelineWorld(bookId)
  if (entry?.type !== 'codexEntry' || (entry.bookId !== bookId && entry.bookId !== world.books.find(b => b.id === bookId)?.seriesId) || isCodexEntryArchived(entry)) throw new Error('This entry is unavailable.')
  const checkpoint = entry.checkpoints?.find(point => point.id === checkpointId)
  if (checkpointId !== 'baseline' && !checkpoint) throw new Error('This checkpoint no longer exists.')
  const sourceText = proseText(checkpoint?.content ?? entry.content), orderSignature = timelineOrderSignature(world)
  const settings = await getBookAiSettings(bookId, loadAiSettings().favorites)
  if (!settings.supportModel || (settings.provider !== 'fake' && (settings.provider !== 'nanogpt' || !settings.apiKey))) throw new Error('Configure a Support model before summarizing.')
  let content = ''
  await streamTextProviderCompletion({ provider: settings.provider, task: 'summary', thinkingEffort: settings.supportThinkingEffort, apiKey: settings.apiKey, baseUrl: settings.baseUrl, model: settings.supportModel, systemPrompt: 'Summarize only the supplied story state. Preserve established facts and uncertainty. Do not infer future events or add outside knowledge. Return only the summary.', userMessage: sourceText }, chunk => { content += chunk }, signal)
  signal.throwIfAborted()
  if (!content.trim()) throw new Error('The model returned no summary.')
  if (timelineOrderSignature(await readTimelineWorld(bookId)) !== orderSignature) throw new Error('Story order changed during generation. The summary was not saved.')
  const db = await database()
  await db.transaction('rw', db.table('entities'), async () => {
    const latest = await db.table('entities').get(entryId) as CodexEntryEntity | undefined
    const body = checkpointId === 'baseline' ? latest?.content : latest?.checkpoints?.find(p => p.id === checkpointId)?.content
    if (!latest || body === undefined || proseText(body) !== sourceText || isCodexEntryArchived(latest)) throw new Error('The source changed during generation. The summary was not saved.')
    await db.table('entities').update(entryId, { timelineSummaries: [...(latest.timelineSummaries ?? []).filter(s => s.checkpointId !== checkpointId || s.mode !== mode).slice(-31), { checkpointId, mode, sourceText, orderSignature, content }] })
  }); notify(bookId, entryId)
}
export async function resolveEntryAt(entryId: string, cutoff: StoryCutoff, mode: TimelineMode = 'cutoff') { const entry = await getEntity<CodexEntryEntity>(entryId); if (entry?.type !== 'codexEntry' || entry.bookId !== cutoff.bookId) throw new Error('The entry is unavailable in this book.'); return resolveCodexState(entry, cutoff, await readTimelineWorld(cutoff.bookId), mode) }

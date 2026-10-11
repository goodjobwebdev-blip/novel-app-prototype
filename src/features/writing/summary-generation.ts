import { proseEntities } from '../editor/document-projection.ts'
import { listEntitiesByBook } from '../../data/persistence'
import { loadAiSettings } from '../../shared/ai/ai-settings'
import { database, getBookAiSettings, getEntity, getOrCreateSummary, isCodexEntryArchived, listSeries, saveBookAiSettings, saveSummaryContent, createSnapshot, type BookEntity, type SummaryEntity } from '../../data/persistence'
import { entityAvailableInWorkspace as entityAvailableInBook, worldPromptValues, type WorkspaceOwner } from '../../app/workspace-owner'
import type { ChatMessageEntity } from '../chat/chat-service'
import { assertPromptTemplateValid, type BookPromptValues } from '../../shared/ai/prompt-template'
import { buildSummarySource, type SummarySourceEntity } from './summary-service'
import { assembleSummaryGenerationRequest } from './summary-request'
import { generationContextDiagnostics } from '../../shared/context/context-service'
import { fetchTextProviderModelContextLength, streamTextProviderCompletion, textProviderRequestText } from '../../shared/ai/text-provider'

async function summaryAccess(bookId: string, summary: SummaryEntity) {
  const db = await database()
  return db.transaction('r', db.table('entities'), async () => {
    const book = await getEntity<WorkspaceOwner>(bookId)
    const current = await getEntity<SummaryEntity>(summary.id)
    const entity = await getEntity<SummarySourceEntity>(summary.sourceEntityId)
    if (!book || !['book', 'world'].includes(book.type) || current?.type !== 'summary' || current.sourceEntityId !== summary.sourceEntityId || current.bookId !== summary.bookId || current.worldId !== summary.worldId || !entityAvailableInBook(current, book) || !entity || !['act', 'chapter', 'scene', 'codexEntry'].includes(entity.type) || !entityAvailableInBook(entity, book) || isCodexEntryArchived(entity) || current.bookId !== entity.bookId || current.worldId !== entity.worldId) throw new Error('The summary source is unavailable or archived in this workspace.')
    return book
  })
}

export async function prepareSummaryGeneration(book: WorkspaceOwner, summary: SummaryEntity, signal: AbortSignal, bookValues?: BookPromptValues) {
  signal.throwIfAborted()
  book = await summaryAccess(book.id, summary)
  if (book.type === 'world') bookValues = worldPromptValues(book)
  const defaults = loadAiSettings()
  const settings = await getBookAiSettings(book.id, defaults.favorites)
  signal.throwIfAborted()
  if (!['nanogpt', 'litellm', 'fake'].includes(settings.provider) || (settings.provider !== 'fake' && !settings.apiKey.trim()) || !settings.supportModel.trim()) {
    throw new Error('Choose NanoGPT, LiteLLM, or Fake (testing) and a Support model in Book settings before summarizing.')
  }
  const composition = settings.promptCompositions.summarize
  assertPromptTemplateValid(composition.systemPrompt, 'summarize')
  composition.predefinedMessages.filter((message) => message.enabled).forEach((message) => assertPromptTemplateValid(message.template, 'summarize'))
  const db = await database()
  const source = await db.transaction('r', db.table('entities'), async () => {
    book = await summaryAccess(book.id, summary)
    return buildSummarySource(summary.sourceEntityId, book.id)
  })
  signal.throwIfAborted()
  const series = bookValues ? [] : await listSeries()
  const seriesTitle = series.find((item) => item.id === book.seriesId)?.title ?? ''
  const responseLength = settings.responseLengths.summary
  const action = summary.content.trim() ? 'resummarize' : 'summarize'
  const normalizedRequest = assembleSummaryGenerationRequest({
    composition,
    book: { ...(bookValues ?? (book.type === 'world' ? worldPromptValues(book) : { title: book.title, series: seriesTitle, seriesOrder: seriesTitle ? book.seriesOrder ?? '' : '', overview: book.overview ?? '', genre: book.genre ?? '', style: book.writingStyle ?? '', pov: book.pointOfView ?? '', tense: book.tense ?? '', language: book.language ?? '' })), responseLength },
    responseLength, summary: { id: summary.id, content: proseEntities(await listEntitiesByBook(book.id)).find((entity) => entity.id === summary.id)?.content ?? '' },
    target: { id: source.source.id, type: source.source.type, title: source.source.title, source: source.content },
    sourceDiagnostics: source.diagnostics, action,
  })
  const modelContextLength = settings.supportModelContextLength ?? await fetchTextProviderModelContextLength({ provider: settings.provider, apiKey: settings.apiKey.trim(), baseUrl: settings.baseUrl, model: settings.supportModel }).catch(() => undefined)
  signal.throwIfAborted()
  if (modelContextLength && modelContextLength !== settings.supportModelContextLength) {
    // The metadata writer resolves live profiles; keep this operation's captured settings.
    await saveBookAiSettings(book.id, { ...settings, supportModelContextLength: modelContextLength })
    signal.throwIfAborted()
  }
  const messages = normalizedRequest.providerMessages
  const diagnostics = generationContextDiagnostics(settings.supportModel, modelContextLength, '', textProviderRequestText({ systemPrompt: '', contextMessage: '', userMessage: '', messages }))
  if (!diagnostics.fits) throw new Error(`Summary source is too large: ~${diagnostics.requestTokens.toLocaleString()} input tokens for a ${diagnostics.usableInputTokens.toLocaleString()}-token usable budget. Arc will not trim or replace authoritative source material.`)
  await summaryAccess(book.id, summary)
  signal.throwIfAborted()
  return { settings, source, action, messages, diagnostics }
}

export async function regenerateEntitySummary(bookId: string, entityId: string, signal: AbortSignal, approval?: { messageId: string; proposalId: string }) {
  const book = await getEntity<BookEntity>(bookId)
  const entity = await getEntity<SummarySourceEntity>(entityId)
  signal.throwIfAborted()
  if (book?.type !== 'book' || !entity || !entityAvailableInBook(entity, book) || !['act', 'chapter', 'scene', 'codexEntry'].includes(entity.type) || isCodexEntryArchived(entity)) throw new Error('The summary source is unavailable in this book.')
  const db = await database()
  const summary = await db.transaction('rw', db.table('entities'), async () => {
    const currentBook = await getEntity<BookEntity>(bookId)
    const current = await getEntity<SummarySourceEntity>(entityId)
    if (!current || !['act', 'chapter', 'scene', 'codexEntry'].includes(current.type) || !entityAvailableInBook(current, currentBook) || isCodexEntryArchived(current)) throw new Error('The summary source is unavailable in this book.')
    signal.throwIfAborted()
    return getOrCreateSummary(current)
  })
  const { settings, source, messages } = await prepareSummaryGeneration(book, summary, signal)
  let generated = ''
  await streamTextProviderCompletion({ provider: settings.provider, task: 'summary', thinkingEffort: settings.supportThinkingEffort, apiKey: settings.apiKey.trim(), baseUrl: settings.baseUrl, model: settings.supportModel, systemPrompt: '', userMessage: '', messages }, (chunk) => { generated += chunk }, signal)
  signal.throwIfAborted()
  if (!generated.trim()) throw new Error('The summary model returned no text. The previous summary was kept.')
  return db.transaction('rw', db.table('entities'), db.table('snapshots'), async () => {
    await summaryAccess(bookId, summary)
    const latestSource = await buildSummarySource(entityId, bookId)
    if (latestSource.sourceRevision !== source.sourceRevision || isCodexEntryArchived(latestSource.source)) throw new Error('The source changed during generation. Regenerate its summary again.')
    if (approval) {
      const message = await getEntity<ChatMessageEntity>(approval.messageId)
      if (message?.type !== 'chatMessage' || message.bookId !== bookId || !message.entityActions?.some(item => item.id === approval.proposalId && item.status === 'applying' && item.entityId === entityId && item.operation?.kind === 'summary')) throw new Error('The summary approval is no longer active. The previous summary was kept.')
    }
    await createSnapshot(summary.id, 'generation', summary.content)
    signal.throwIfAborted()
    // Persistence's legacy approval guard assumes Book ownership. World approval
    // and requesting-Book visibility are checked above in this same transaction.
    return saveSummaryContent(summary.id, generated, source.sourceRevision, summary, summary.worldId ? undefined : approval)
  })
}

import { proseEntities } from './document-projection.ts'
import { listEntitiesByBook } from './persistence'
import { loadAiSettings } from './ai-settings'
import { getBookAiSettings, getEntity, getOrCreateSummary, isCodexEntryArchived, listSeries, saveBookAiSettings, saveSummaryContent, createSnapshot, type BookEntity, type SummaryEntity } from './persistence'
import { assertPromptTemplateValid, type BookPromptValues } from './prompt-template'
import { buildSummarySource, type SummarySourceEntity } from './summary-service'
import { assembleSummaryGenerationRequest } from './summary-request'
import { generationContextDiagnostics } from './context-service'
import { fetchTextProviderModelContextLength, streamTextProviderCompletion, textProviderRequestText } from './text-provider'

export async function prepareSummaryGeneration(book: BookEntity, summary: SummaryEntity, signal: AbortSignal, bookValues?: BookPromptValues) {
  signal.throwIfAborted()
  if (summary.bookId !== book.id) throw new Error('The summary does not belong to this book.')
  const defaults = loadAiSettings()
  let settings = await getBookAiSettings(book.id, defaults.favorites)
  signal.throwIfAborted()
  if ((settings.provider !== 'nanogpt' && settings.provider !== 'fake') || (settings.provider === 'nanogpt' && !settings.apiKey.trim()) || !settings.supportModel.trim()) {
    throw new Error('Choose NanoGPT or Fake (testing) and a Support model in Book settings before summarizing.')
  }
  const composition = settings.promptCompositions.summarize
  assertPromptTemplateValid(composition.systemPrompt, 'summarize')
  composition.predefinedMessages.filter((message) => message.enabled).forEach((message) => assertPromptTemplateValid(message.template, 'summarize'))
  const source = await buildSummarySource(summary.sourceEntityId)
  signal.throwIfAborted()
  if (source.source.bookId !== book.id || isCodexEntryArchived(source.source)) throw new Error('The summary source is unavailable or archived.')
  const series = bookValues ? [] : await listSeries()
  const seriesTitle = series.find((item) => item.id === book.seriesId)?.title ?? ''
  const responseLength = settings.responseLengths.summary
  const action = summary.content.trim() ? 'resummarize' : 'summarize'
  const normalizedRequest = assembleSummaryGenerationRequest({
    composition,
    book: { ...(bookValues ?? { title: book.title, series: seriesTitle, seriesOrder: seriesTitle ? book.seriesOrder ?? '' : '', overview: book.overview ?? '', genre: book.genre ?? '', style: book.writingStyle ?? '', pov: book.pointOfView ?? '', tense: book.tense ?? '', language: book.language ?? '' }), responseLength },
    responseLength, summary: { id: summary.id, content: proseEntities(await listEntitiesByBook(book.id)).find((entity) => entity.id === summary.id)?.content ?? '' },
    target: { id: source.source.id, type: source.source.type, title: source.source.title, source: source.content },
    sourceDiagnostics: source.diagnostics, action,
  })
  const modelContextLength = settings.supportModelContextLength ?? await fetchTextProviderModelContextLength({ provider: settings.provider, apiKey: settings.apiKey.trim(), baseUrl: settings.baseUrl, model: settings.supportModel }).catch(() => undefined)
  signal.throwIfAborted()
  if (modelContextLength && modelContextLength !== settings.supportModelContextLength) {
    settings = await saveBookAiSettings(book.id, { ...settings, supportModelContextLength: modelContextLength })
    signal.throwIfAborted()
  }
  const messages = normalizedRequest.providerMessages
  const diagnostics = generationContextDiagnostics(settings.supportModel, modelContextLength, '', textProviderRequestText({ systemPrompt: '', contextMessage: '', userMessage: '', messages }))
  if (!diagnostics.fits) throw new Error(`Summary source is too large: ~${diagnostics.requestTokens.toLocaleString()} input tokens for a ${diagnostics.usableInputTokens.toLocaleString()}-token usable budget. Arc will not trim or replace authoritative source material.`)
  return { settings, source, action, messages, diagnostics }
}

export async function regenerateEntitySummary(bookId: string, entityId: string, signal: AbortSignal, approval?: { messageId: string; proposalId: string }) {
  const book = await getEntity<BookEntity>(bookId)
  const entity = await getEntity<SummarySourceEntity>(entityId)
  signal.throwIfAborted()
  if (book?.type !== 'book' || !entity || entity.bookId !== bookId || !['act', 'chapter', 'scene', 'codexEntry'].includes(entity.type) || isCodexEntryArchived(entity)) throw new Error('The summary source is unavailable in this book.')
  const summary = await getOrCreateSummary(entity)
  const { settings, source, messages } = await prepareSummaryGeneration(book, summary, signal)
  let generated = ''
  await streamTextProviderCompletion({ provider: settings.provider, task: 'summary', thinkingEffort: settings.supportThinkingEffort, apiKey: settings.apiKey.trim(), baseUrl: settings.baseUrl, model: settings.supportModel, systemPrompt: '', userMessage: '', messages }, (chunk) => { generated += chunk }, signal)
  signal.throwIfAborted()
  if (!generated.trim()) throw new Error('The summary model returned no text. The previous summary was kept.')
  const latestSource = await buildSummarySource(entityId)
  if (latestSource.sourceRevision !== source.sourceRevision || isCodexEntryArchived(latestSource.source)) throw new Error('The source changed during generation. Regenerate its summary again.')
  await createSnapshot(summary.id, 'generation', summary.content)
  signal.throwIfAborted()
  return saveSummaryContent(summary.id, generated, source.sourceRevision, summary, approval)
}

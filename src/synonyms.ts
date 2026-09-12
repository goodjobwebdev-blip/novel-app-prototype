import { selectionProse, selectionWordCount, type QuickToolCapture } from './quick-tools'
import { protectedRanges } from './document-projection.ts'
import { resolveSceneWriting, sceneWritingValues } from './scene-writing'
import { loadAiSettings } from './ai-settings'
import { getBookAiSettings } from './persistence'
import { assembleCompositionRequest, normalizeAppManagedPart } from './prompt-composition'
import { generationContextDiagnostics } from './context-service'
import { fetchTextProviderModelContextLength, streamTextProviderCompletion, textProviderRequestText } from './text-provider'
import type { RewriteRequestPreview } from './ProseRewriteDialog'

export type SynonymCandidate = { text: string; note: string }
const normalized = (text: string) => text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
export function synonymContext(capture: QuickToolCapture) {
  const selection = selectionProse(capture)
  const words = selectionWordCount(selection.selected)
  if (words < 1 || words > 6) throw new Error('Select one word or a phrase of up to six words for synonyms.')
  const previousParagraph = selection.source.lastIndexOf('\n\n', selection.from - 1)
  const paragraphStart = Math.max(previousParagraph < 0 ? 0 : previousParagraph + 2, selection.from - 600)
  const nextParagraph = selection.source.indexOf('\n\n', selection.to)
  const paragraphEnd = Math.min(nextParagraph < 0 ? selection.source.length : nextParagraph, selection.to + 600)
  const paragraph = selection.source.slice(paragraphStart, paragraphEnd)
  const relativeFrom = selection.from - paragraphStart, relativeTo = selection.to - paragraphStart
  const segments = typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(paragraph)] : [{ index: 0, segment: paragraph }]
  const overlapping = segments.filter((segment) => segment.index < relativeTo && segment.index + segment.segment.length > relativeFrom)
  const from = overlapping[0]?.index ?? 0, to = overlapping.at(-1) ? overlapping.at(-1)!.index + overlapping.at(-1)!.segment.length : paragraph.length
  const sentence = paragraph.slice(from, to)
  return { paragraph, sentence, before: paragraph.slice(from, relativeFrom), selected: selection.selected, after: paragraph.slice(relativeTo, to) }
}
export function parseSynonyms(output: string, original: string, existing: SynonymCandidate[] = []) {
  let value: unknown
  try { value = JSON.parse(output.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) } catch { throw new Error('The model returned invalid suggestions. Retry to request alternatives.') }
  const values = Array.isArray(value) ? value : (value as { candidates?: unknown })?.candidates
  if (!Array.isArray(values)) throw new Error('The model did not return a candidate list. Retry to request alternatives.')
  const seen = new Set([normalized(original), ...existing.map((item) => normalized(item.text))])
  const added: SynonymCandidate[] = []
  for (const candidate of values) {
    const text = typeof candidate === 'string' ? candidate : typeof candidate?.text === 'string' ? candidate.text : ''
    const clean = text.trim()
    if (!clean || clean.length > 120 || /[\r\n]/.test(clean) || protectedRanges(clean).length || seen.has(normalized(clean))) continue
    seen.add(normalized(clean)); added.push({ text: clean, note: typeof candidate?.note === 'string' ? candidate.note.slice(0, 180) : '' })
    if (added.length === 8) break
  }
  return [...existing, ...added]
}
export async function prepareSynonymRequest(capture: QuickToolCapture, existing: SynonymCandidate[], signal: AbortSignal) {
  const context = synonymContext(capture)
  if (capture.document.bookId !== capture.bookId || Number(capture.document.archivedAt) > 0) throw new Error('This document is not editable in this Book.')
  const settings = await getBookAiSettings(capture.bookId, loadAiSettings().favorites)
  signal.throwIfAborted()
  if (settings.provider !== 'fake' && settings.provider !== 'nanogpt') throw new Error('Choose a text provider in Book AI settings.')
  if (settings.provider === 'nanogpt' && !settings.apiKey.trim()) throw new Error('Add your API key in Book AI settings.')
  const model = settings.supportModel.trim()
  if (!model) throw new Error('Choose a Support model in Book AI settings for synonyms.')
  const language = resolveSceneWriting(capture.book, capture.document.type === 'scene' ? sceneWritingValues(capture.document) : undefined).language.value
  const request = assembleCompositionRequest({ composition: { systemPrompt: 'Suggest up to eight distinct contextual synonyms or short equivalent phrases for only the selected text. Preserve its language, grammatical role, inflection and capitalization. Use the sentence and paragraph to choose fitting alternatives, without inventing facts. Return JSON only: {"candidates":[{"text":"replacement","note":"brief nuance or fit"}]}. Exclude the original and already suggested alternatives. Return an empty candidates array if no suitable alternatives exist.', predefinedMessages: [] }, values: {}, after: [normalizeAppManagedPart({ id: 'synonym-context', name: 'Word context', role: 'user', sourceKind: 'app-managed', sourceId: capture.document.id, ownership: 'app-managed', content: JSON.stringify({ selected: context.selected, sentence: context.sentence, paragraph: context.paragraph, language, exclude: existing.map((item) => item.text) }) })] })
  const limit = settings.supportModelContextLength ?? await fetchTextProviderModelContextLength({ provider: settings.provider, apiKey: settings.apiKey, baseUrl: settings.baseUrl, model }).catch(() => undefined)
  signal.throwIfAborted()
  if (!generationContextDiagnostics(model, limit, '', textProviderRequestText({ systemPrompt: '', userMessage: '', messages: request.providerMessages })).fits) throw new Error('This synonym request exceeds the model context limit.')
  return { settings, model, request }
}
export async function generateSynonyms(capture: QuickToolCapture, existing: SynonymCandidate[], signal: AbortSignal, onRequest?: (value: RewriteRequestPreview) => void) {
  const { settings, model, request } = await prepareSynonymRequest(capture, existing, signal)
  onRequest?.({ model, request })
  let output = ''
  await streamTextProviderCompletion({ provider: settings.provider, task: 'story', apiKey: settings.apiKey, baseUrl: settings.baseUrl, model, systemPrompt: '', userMessage: '', messages: request.providerMessages }, (text) => { output += text }, signal)
  signal.throwIfAborted()
  return parseSynonyms(output, capture.snapshot.text, existing)
}

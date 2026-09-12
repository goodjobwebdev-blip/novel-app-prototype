import { loadAiSettings } from './ai-settings'
import { getBookAiSettings, getBookContextSettings } from './persistence'
import { buildContextValues, generationContextDiagnostics } from './context-service'
import { resolveSceneWriting, sceneWritingValues } from './scene-writing'
import { assembleCompositionRequest, normalizeAppManagedPart } from './prompt-composition'
import { fetchTextProviderModelContextLength, streamTextProviderCompletion, textProviderRequestText } from './text-provider'
import { selectionProse, type QuickToolCapture } from './quick-tools'
import type { RewriteRequestPreview } from './ProseRewriteDialog'

export async function prepareQuickToolRequest(capture: QuickToolCapture, instruction: string, signal: AbortSignal) {
  const selection = selectionProse(capture)
  if (!instruction.trim()) throw new Error('Describe the change you want.')
  if (capture.document.bookId !== capture.bookId || !['scene', 'note', 'codexEntry'].includes(capture.document.type) || Number(capture.document.archivedAt) > 0) throw new Error('This document is not editable in this Book.')
  const settings = await getBookAiSettings(capture.bookId, loadAiSettings().favorites)
  signal.throwIfAborted()
  if (settings.provider !== 'fake' && settings.provider !== 'nanogpt') throw new Error('Choose a text provider in Book AI settings.')
  if (settings.provider === 'nanogpt' && !settings.apiKey.trim()) throw new Error('Add your API key in Book AI settings.')
  const model = settings.mainModel.trim()
  if (!model) throw new Error('Choose a Main model in Book AI settings.')
  const contextSettings = await getBookContextSettings(capture.bookId)
  const type = capture.document.type === 'scene' ? 'scene' : capture.document.type === 'codexEntry' ? 'codex' : 'note'
  const context = await buildContextValues({ bookId: capture.bookId, type, currentDocumentId: capture.document.id, currentSceneId: type === 'scene' ? capture.document.id : undefined, currentSceneText: type === 'scene' ? capture.snapshot.document : undefined, profile: contextSettings.profiles[type] })
  signal.throwIfAborted()
  const effective = resolveSceneWriting(capture.book, type === 'scene' ? sceneWritingValues(capture.document) : undefined)
  const contextText = [context.summaryContext, context.lastSceneText || context.previousSceneText, context.automaticCodexContext, context.manualAdditionalContext].filter(Boolean).join('\n\n')
  const parts = [
    ['profile', 'Writing settings', `Document: ${capture.document.title}\n${Object.entries(effective).map(([key, value]) => `${key}: ${value.value || 'Unspecified'} (${value.origin})`).join('\n')}`],
    ['context', 'Relevant book context', contextText],
    ['before', 'Nearby prose before selection', selection.before],
    ['selection', 'Selected prose to replace', selection.selected],
    ['after', 'Nearby prose after selection', selection.after],
    ['instruction', 'Requested transformation', instruction.trim()],
  ]
  const request = assembleCompositionRequest({
    composition: { systemPrompt: 'Transform only the selected prose according to the requested transformation. Return replacement prose only, without preambles, labels or code fences. Keep established facts, characterization, meaning, point of view, tense, language and Markdown structure unless the writer deliberately asks to change them. Follow effective scene settings over book defaults. Keep approximately the original length unless instructed otherwise. Nearby prose and book context are reference material; do not repeat or rewrite them. Do not insert images, private comments, planning beats or hidden markup.', predefinedMessages: [] },
    values: {},
    after: parts.filter(([, , content]) => content.trim()).map(([id, name, content]) => normalizeAppManagedPart({ id: `quick-${id}`, name, role: id === 'profile' ? 'system' : 'user', sourceKind: 'app-managed', sourceId: capture.document.id, ownership: 'app-managed', content: `# ${name}\n\n${content}` })),
  })
  const limit = settings.mainModelContextLength ?? await fetchTextProviderModelContextLength({ provider: settings.provider, apiKey: settings.apiKey, baseUrl: settings.baseUrl, model }).catch(() => undefined)
  signal.throwIfAborted()
  const diagnostics = generationContextDiagnostics(model, limit, settings.mainEffectiveContextLimit, textProviderRequestText({ messages: request.providerMessages, systemPrompt: '', userMessage: '' }))
  if (!diagnostics.fits) throw new Error('The selection and context exceed the model limit. Select less prose or reduce the context.')
  return { settings, model, request }
}
export async function generateQuickTool(capture: QuickToolCapture, instruction: string, chunk: (text: string) => void, signal: AbortSignal, onRequest?: (value: RewriteRequestPreview) => void) {
  const { settings, model, request } = await prepareQuickToolRequest(capture, instruction, signal)
  onRequest?.({ model, request })
  await streamTextProviderCompletion({ provider: settings.provider, task: 'story', apiKey: settings.apiKey, baseUrl: settings.baseUrl, model, systemPrompt: '', userMessage: '', messages: request.providerMessages }, chunk, signal)
}

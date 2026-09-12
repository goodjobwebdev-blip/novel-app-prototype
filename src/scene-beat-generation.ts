import type { RewriteRequestPreview } from './ProseRewriteDialog'
import { loadAiSettings } from './ai-settings'
import { getBookAiSettings, getBookContextSettings, type StructuralEntity } from './persistence'
import { assertPromptTemplateValid, type BookPromptValues } from './prompt-template'
import { assembleStoryGenerationRequest } from './story-request'
import { sceneWritingValues } from './scene-writing'
import { buildContextValues, generationContextDiagnostics } from './context-service'
import { fetchTextProviderModelContextLength, streamTextProviderCompletion, textProviderRequestText } from './text-provider'

export async function prepareSceneBeatRequest(input: { bookId: string; book: BookPromptValues; scene: StructuralEntity; source: string; from: number; to: number; instruction: string }, signal: AbortSignal) {
  const settings = await getBookAiSettings(input.bookId, loadAiSettings().favorites)
  signal.throwIfAborted()
  if (settings.provider !== 'fake' && settings.provider !== 'nanogpt') throw new Error('Choose a text provider in Book AI settings.')
  if (settings.provider === 'nanogpt' && !settings.apiKey.trim()) throw new Error('Add your API key in Book AI settings.')
  const model = settings.mainModel.trim()
  if (!model) throw new Error('Choose a Main model in Book AI settings.')
  const composition = settings.promptCompositions.story
  for (const template of [composition.systemPrompt, ...composition.predefinedMessages.filter((message) => message.enabled).map((message) => message.template)]) assertPromptTemplateValid(template, 'story')
  const sceneText = input.source.slice(0, input.from) + input.source.slice(input.to)
  const contextSettings = await getBookContextSettings(input.bookId)
  const context = await buildContextValues({ bookId: input.bookId, type: 'scene', currentSceneId: input.scene.id, currentSceneText: sceneText, currentDocumentId: input.scene.id, profile: contextSettings.profiles.scene })
  signal.throwIfAborted()
  const request = assembleStoryGenerationRequest({ composition, book: input.book, sceneText, insertionPosition: input.from, sceneOverrides: sceneWritingValues(input.scene), responseLength: settings.responseLengths.story, context, instruction: input.instruction })
  const limit = settings.mainModelContextLength ?? await fetchTextProviderModelContextLength({ provider: settings.provider, apiKey: settings.apiKey, baseUrl: settings.baseUrl, model }).catch(() => undefined)
  signal.throwIfAborted()
  const diagnostics = generationContextDiagnostics(model, limit, settings.mainEffectiveContextLimit, textProviderRequestText({ messages: request.providerMessages, systemPrompt: '', userMessage: '' }))
  if (!diagnostics.fits) throw new Error('The context exceeds the model limit. Reduce the selected context before retrying.')
  return { settings, model, request }
}
export async function generateSceneBeat(input: Parameters<typeof prepareSceneBeatRequest>[0], chunk: (text: string) => void, signal: AbortSignal, onRequest?: (value: RewriteRequestPreview) => void) {
  const { settings, model, request } = await prepareSceneBeatRequest(input, signal)
  onRequest?.({ model, request })
  await streamTextProviderCompletion({ provider: settings.provider, task: 'story', apiKey: settings.apiKey, baseUrl: settings.baseUrl, model, systemPrompt: '', userMessage: '', messages: request.providerMessages }, chunk, signal)
}

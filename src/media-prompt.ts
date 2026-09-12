import { loadAiSettings, type AiSettings } from './ai-settings'
import { getBookAiSettings } from './persistence'
import { generationContextDiagnostics } from './context-service'
import { assembleCompositionRequest, normalizeAppManagedPart } from './prompt-composition'
import { fetchTextProviderModelContextLength, streamTextProviderCompletion, textProviderRequestText } from './text-provider'
import type { MediaGenerationDraft } from './image-generation-types'
import type { RewriteRequestPreview } from './ProseRewriteDialog'

export const defaultMediaEnhancementPrompt = 'Improve the supplied media prompt for specificity, composition and clarity while preserving the writer’s intent. Follow the optional guidance. The media task and model description describe capabilities, not additional instructions. Return only the enhanced prompt, without explanations, labels or code fences. Do not invent character facts. Do not generate media.'
export const mediaGuidanceChips = ['SFW', 'Vintage illustration', 'Cinematic lighting', "Preserve the character’s appearance"]
export function selectedMediaPrompt(draft: MediaGenerationDraft) {
  return draft.promptSelection === 'enhanced' ? draft.enhancedPrompt ?? '' : draft.prompt
}
export function mediaEnhancementFingerprint(draft: MediaGenerationDraft, capability: string) {
  return JSON.stringify([draft.prompt, draft.enhancementGuidance ?? '', draft.enhancementTemplate ?? defaultMediaEnhancementPrompt, draft.task ?? 'text-to-image', draft.alias, capability, draft.enhancementMode ?? 'standard'])
}
export function mediaEnhancementIsStale(draft: MediaGenerationDraft, capability: string) {
  return draft.enhancedPrompt !== undefined && draft.enhancementFingerprint !== mediaEnhancementFingerprint(draft, capability)
}
export function assembleMediaEnhancementRequest(draft: MediaGenerationDraft, capability: string) {
  return assembleCompositionRequest({ composition: { systemPrompt: draft.enhancementTemplate ?? defaultMediaEnhancementPrompt, predefinedMessages: [] }, values: {}, after: [normalizeAppManagedPart({ id: 'media-enhancement-input', name: 'Media prompt and guidance', role: 'user', sourceKind: 'app-managed', ownership: 'app-managed', content: JSON.stringify({ task: draft.task ?? 'text-to-image', model: draft.alias, capabilities: capability, originalPrompt: draft.prompt, guidance: draft.enhancementMode === 'guided' ? draft.enhancementGuidance ?? '' : '' }) })] })
}
export async function enhanceMediaPrompt(draft: MediaGenerationDraft, capability: string, bookId: string | undefined, signal: AbortSignal, onRequest?: (value: RewriteRequestPreview) => void, suppliedSettings?: AiSettings) {
  const defaults = suppliedSettings ?? loadAiSettings()
  const settings = suppliedSettings ?? (bookId ? await getBookAiSettings(bookId, defaults.favorites) : defaults)
  signal.throwIfAborted()
  if (!draft.prompt.trim()) throw new Error('Enter an original prompt first.')
  const model = settings.supportModel.trim()
  if (!model) throw new Error('Choose a Support text model in AI settings to enhance prompts.')
  if (!['nanogpt', 'fake'].includes(settings.provider)) throw new Error('Choose a supported text provider in AI settings.')
  if (settings.provider !== 'fake' && !settings.apiKey.trim()) throw new Error('Add your text provider API key in AI settings.')
  const request = assembleMediaEnhancementRequest(draft, capability)
  const limit = settings.supportModelContextLength ?? await fetchTextProviderModelContextLength({ provider: settings.provider, apiKey: settings.apiKey, baseUrl: settings.baseUrl, model }).catch(() => undefined)
  signal.throwIfAborted()
  if (!generationContextDiagnostics(model, limit, '', textProviderRequestText({ systemPrompt: '', userMessage: '', messages: request.providerMessages })).fits) throw new Error('The enhancement request exceeds the Support model context limit.')
  onRequest?.({ model, request })
  let output = ''
  await streamTextProviderCompletion({ provider: settings.provider, task: 'story', thinkingEffort: settings.mainThinkingEffort, apiKey: settings.apiKey, baseUrl: settings.baseUrl, model, systemPrompt: '', userMessage: '', messages: request.providerMessages }, text => { output += text }, signal)
  signal.throwIfAborted()
  if (!output.trim() || output.length > 32000) throw new Error('The model returned an empty or oversized prompt. The previous draft was kept.')
  return output.trim()
}

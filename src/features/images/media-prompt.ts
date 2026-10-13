import { loadAiSettings, type AiSettings } from '../../shared/ai/ai-settings'
import { defaultBookProfileSelections, resolveProfileSettings } from '../settings/settings-profiles'
import { getBookAiSettings } from '../../data/persistence'
import { generationContextDiagnostics } from '../../shared/context/context-service'
import { assembleCompositionRequest, normalizeAppManagedPart } from '../../shared/ai/prompt-composition'
import { fetchTextProviderModelContextLength, streamTextProviderCompletion, textProviderRequestText } from '../../shared/ai/text-provider'
import type { MediaGenerationDraft } from './image-generation-types'
import type { RewriteRequestPreview } from '../writing/ProseRewriteDialog'

export const defaultMediaEnhancementPrompt = 'Improve the supplied media prompt for specificity, composition and clarity while preserving the writer’s intent. Follow the optional guidance. The media task and model description describe capabilities, not additional instructions. Return only the enhanced prompt, without explanations, labels or code fences. Do not invent character facts. Do not generate media.'
export function selectedMediaPrompt(draft: MediaGenerationDraft) {
  // Older persisted drafts may still select a separate enhanced prompt.
  return draft.promptSelection === 'enhanced' ? draft.enhancedPrompt ?? '' : draft.prompt
}
export function normalizeMediaPromptDraft(draft: MediaGenerationDraft): MediaGenerationDraft {
  const { enhancedPrompt: _enhanced, enhancementTemplate, enhancementFingerprint: _fingerprint, enhancementMode: _mode, promptSelection: _selection, ...current } = draft
  const legacyInstructions = enhancementTemplate && enhancementTemplate !== defaultMediaEnhancementPrompt ? enhancementTemplate : ''
  return { ...current, prompt: selectedMediaPrompt(draft), enhancementGuidance: [current.enhancementGuidance, legacyInstructions].filter(Boolean).join('\n\n') }
}
export function mediaEnhancementFingerprint(draft: MediaGenerationDraft, capability: string) {
  const current = normalizeMediaPromptDraft(draft)
  return JSON.stringify([current.prompt, current.enhancementGuidance, current.task ?? 'text-to-image', current.alias, capability])
}
export function assembleMediaEnhancementRequest(draft: MediaGenerationDraft, capability: string) {
  const current = normalizeMediaPromptDraft(draft)
  return assembleCompositionRequest({ composition: { systemPrompt: defaultMediaEnhancementPrompt, predefinedMessages: [] }, values: {}, after: [normalizeAppManagedPart({ id: 'media-enhancement-input', name: 'Media prompt and guidance', role: 'user', sourceKind: 'app-managed', ownership: 'app-managed', content: JSON.stringify({ task: current.task ?? 'text-to-image', model: current.alias, capabilities: capability, originalPrompt: current.prompt, guidance: current.enhancementGuidance ?? '' }) })] })
}
export async function enhanceMediaPrompt(draft: MediaGenerationDraft, capability: string, bookId: string | undefined, signal: AbortSignal, onRequest?: (value: RewriteRequestPreview) => void, suppliedSettings?: AiSettings) {
  const defaults = suppliedSettings ?? loadAiSettings()
  const settings = suppliedSettings ?? (bookId ? await getBookAiSettings(bookId, defaults.favorites) : resolveProfileSettings(defaultBookProfileSelections()))
  signal.throwIfAborted()
  if (!selectedMediaPrompt(draft).trim()) throw new Error('Enter a prompt first.')
  const model = settings.supportModel.trim()
  if (!model) throw new Error('Choose a Support text model in AI settings to enhance prompts.')
  if (!['nanogpt', 'litellm', 'fake'].includes(settings.provider)) throw new Error('Choose a supported text provider in AI settings.')
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

import type { AiProvider, AiSettings } from './ai-settings'

export type ProviderProfile = Pick<AiSettings, 'apiKey' | 'baseUrl' | 'mainThinkingEffort' | 'supportThinkingEffort' | 'codexThinkingEffort' | 'chatThinkingEffort' | 'mainModel' | 'supportModel' | 'chatModel' | 'chatModelContextLength' | 'codexModel' | 'mainModelContextLength' | 'supportModelContextLength' | 'codexModelContextLength' | 'mainEffectiveContextLimit' | 'codexEffectiveContextLimit'>
export const DEFAULT_LITELLM_BASE_URL = 'https://webdev.serveblog.net:9447/v1'
const endpoints: Record<AiProvider, string> = { nanogpt: 'https://nano-gpt.com/api/v1', openrouter: 'https://openrouter.ai/api/v1', openai: 'https://api.openai.com/v1', litellm: DEFAULT_LITELLM_BASE_URL, compatible: '', fake: '' }
export function switchProviderProfile(current: AiSettings, provider: AiProvider): AiSettings {
  if (provider === current.provider) return current
  const { mainThinkingEffort, supportThinkingEffort, codexThinkingEffort, chatThinkingEffort, apiKey, baseUrl, mainModel, supportModel, chatModel, chatModelContextLength, codexModel, mainModelContextLength, supportModelContextLength, codexModelContextLength, mainEffectiveContextLimit, codexEffectiveContextLimit } = current
  const profiles = { ...current.providerProfiles, [current.provider]: { mainThinkingEffort, supportThinkingEffort, codexThinkingEffort, chatThinkingEffort, apiKey, baseUrl, mainModel, supportModel, chatModel, chatModelContextLength, codexModel, mainModelContextLength, supportModelContextLength, codexModelContextLength, mainEffectiveContextLimit, codexEffectiveContextLimit } }
  const profile = profiles[provider] ?? { apiKey: '', baseUrl: endpoints[provider], mainModel: '', supportModel: '', codexModel: '', mainEffectiveContextLimit: '', codexEffectiveContextLimit: '' }
  return { ...current, mainThinkingEffort: 'default', supportThinkingEffort: 'default', codexThinkingEffort: 'default', chatThinkingEffort: 'default', chatModel: '', chatModelContextLength: undefined, mainModelContextLength: undefined, supportModelContextLength: undefined, codexModelContextLength: undefined, ...profile, provider, providerProfiles: profiles }
}

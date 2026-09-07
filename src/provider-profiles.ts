import type { AiProvider, AiSettings } from './ai-settings'

export type ProviderProfile = Pick<AiSettings, 'apiKey' | 'baseUrl' | 'mainModel' | 'supportModel' | 'codexModel' | 'mainModelContextLength' | 'supportModelContextLength' | 'codexModelContextLength' | 'mainEffectiveContextLimit' | 'codexEffectiveContextLimit'>
const endpoints: Record<AiProvider, string> = { nanogpt: 'https://nano-gpt.com/api/v1', openrouter: 'https://openrouter.ai/api/v1', openai: 'https://api.openai.com/v1', compatible: '', fake: '' }
export function switchProviderProfile(current: AiSettings, provider: AiProvider): AiSettings {
  if (provider === current.provider) return current
  const { apiKey, baseUrl, mainModel, supportModel, codexModel, mainModelContextLength, supportModelContextLength, codexModelContextLength, mainEffectiveContextLimit, codexEffectiveContextLimit } = current
  const profiles = { ...current.providerProfiles, [current.provider]: { apiKey, baseUrl, mainModel, supportModel, codexModel, mainModelContextLength, supportModelContextLength, codexModelContextLength, mainEffectiveContextLimit, codexEffectiveContextLimit } }
  const profile = profiles[provider] ?? { apiKey: '', baseUrl: endpoints[provider], mainModel: '', supportModel: '', codexModel: '', mainEffectiveContextLimit: '', codexEffectiveContextLimit: '' }
  return { ...current, mainModelContextLength: undefined, supportModelContextLength: undefined, codexModelContextLength: undefined, ...profile, provider, providerProfiles: profiles }
}

import type { AiProvider } from './ai-settings'

export const THINKING_EFFORT_OPTIONS = [
  { value: 'default', label: 'Provider default' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' },
] as const

export type ThinkingEffort = typeof THINKING_EFFORT_OPTIONS[number]['value']

export function normalizeThinkingEffort(value: unknown): ThinkingEffort {
  return THINKING_EFFORT_OPTIONS.find(option => option.value === value)?.value ?? 'default'
}

/** Keep legacy enable/default behavior; only send effort when explicitly selected. */
export function thinkingRequestParameters(provider: AiProvider, thinking: boolean, value?: ThinkingEffort): Record<string, unknown> {
  if (!thinking || provider === 'fake') return {}
  const effort = normalizeThinkingEffort(value)
  if (provider === 'openai') return effort === 'default' ? {} : { reasoning_effort: effort }
  if (provider === 'compatible' && effort !== 'default') return { reasoning_effort: effort }
  return {
    reasoning: {
      enabled: true,
      ...(effort !== 'default' ? { effort } : {}),
      ...(provider === 'nanogpt' ? { delta_field: 'reasoning_content' } : {}),
    },
    ...(provider === 'openrouter' ? { include_reasoning: true } : {}),
  }
}

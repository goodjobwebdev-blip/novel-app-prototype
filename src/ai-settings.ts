export type AiProvider = 'openrouter' | 'nanogpt' | 'openai' | 'compatible'

export type AiPrompts = {
  story: string
  summarize: string
  titles: string
}

export type AiSettings = {
  provider: AiProvider
  apiKey: string
  baseUrl: string
  mainModel: string
  supportModel: string
  favorites: string[]
  prompts: AiPrompts
}

export const AI_SETTINGS_STORAGE_KEY = 'arc-ai-defaults-v1'

export const defaultAiPrompts: AiPrompts = {
  story: `You are the story writer for {{book.title}}.

{% if scene.pov %}
Stay close to {{scene.pov}} and preserve the established voice.
{% endif %}

Continue from {{scene.text}} without summarizing it.`,
  summarize: `Summarize {{target.type}} for future story context.

Keep names, decisions, promises, and unresolved questions.
{% if target.previous_summary %}
Update the existing summary instead of starting over.
{% endif %}`,
  titles: `Generate concise names or titles for {{target.type}}.

Tone: {{book.style}}
Return {{count}} distinct options without commentary.`,
}

export const initialAiSettings: AiSettings = {
  provider: 'nanogpt',
  apiKey: '',
  baseUrl: 'https://nano-gpt.com/api/v1',
  mainModel: '',
  supportModel: '',
  favorites: [],
  prompts: defaultAiPrompts,
}

export function loadAiSettings(): AiSettings {
  const stored = localStorage.getItem(AI_SETTINGS_STORAGE_KEY)
  if (!stored) return initialAiSettings

  try {
    const parsed = JSON.parse(stored) as Partial<AiSettings>
    return {
      ...initialAiSettings,
      ...parsed,
      prompts: { ...defaultAiPrompts, ...parsed.prompts },
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
    }
  } catch {
    return initialAiSettings
  }
}

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
  mainModelContextLength?: number
  supportModel: string
  supportModelContextLength?: number
  favorites: string[]
  prompts: AiPrompts
}

export type BookAiSettings = Omit<AiSettings, 'favorites'>

export const AI_SETTINGS_STORAGE_KEY = 'arc-ai-defaults-v1'

const previousDefaultAiPrompts: AiPrompts[] = [{
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
}, {
  story: `You are the story writer for {{book.title}}.

{% if scene.pov %}
Stay close to {{scene.pov}} and preserve the established voice.
{% endif %}

Use the supplied structured story context. Continue the current scene without summarizing or repeating it.`,
  summarize: `Summarize {{target.type}} for future story context.

Keep names, decisions, promises, and unresolved questions.
{% if target.previous_summary %}
Update the existing summary instead of starting over.
{% endif %}`,
  titles: `Generate concise names or titles for {{target.type}}.

Tone: {{book.style}}
Return {{count}} distinct options without commentary.`,
}]

export const defaultAiPrompts: AiPrompts = {
  story: `You are the story writer for {{book.title}}.

{% if book.series %}
Series: {{book.series}}.
{% endif %}
{% if book.series_order %}
Series position: Book {{book.series_order}}.
{% endif %}
{% if book.overview %}
Book overview: {{book.overview}}
{% endif %}
{% if book.genre %}
Genre: {{book.genre}}
{% endif %}
{% if book.style %}
Writing style: {{book.style}}
{% endif %}
{% if book.pov %}
Default point of view: {{book.pov}}
{% endif %}
{% if book.tense %}
Narrative tense: {{book.tense}}
{% endif %}
{% if book.language %}
Write in {{book.language}}.
{% endif %}
{% if scene.pov %}
This scene uses {{scene.pov}}; prefer it over the book default.
{% endif %}

Continue from the supplied Current scene section without summarizing it.`,
  summarize: `Summarize {{target.type}} from {{book.title}} for future story context.

Keep names, decisions, promises, and unresolved questions.
{% if book.language %}
Write the summary in {{book.language}}.
{% endif %}
{% if target.previous_summary %}
Update the existing summary instead of starting over.
{% endif %}`,
  titles: `Generate concise names or titles for {{target.type}}.

{% if book.genre %}
Genre: {{book.genre}}
{% endif %}
Tone: {{book.style}}
Language: {{book.language}}
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

export function normalizeAiSettings(value?: Partial<AiSettings>): AiSettings {
  const prompts = { ...defaultAiPrompts, ...value?.prompts }
  ;(Object.keys(defaultAiPrompts) as Array<keyof AiPrompts>).forEach((key) => {
    if (previousDefaultAiPrompts.some((defaults) => prompts[key] === defaults[key])) prompts[key] = defaultAiPrompts[key]
  })
  return {
    ...initialAiSettings,
    ...value,
    prompts,
    favorites: Array.isArray(value?.favorites) ? [...value.favorites] : [],
    mainModelContextLength: Number.isFinite(value?.mainModelContextLength) ? value?.mainModelContextLength : undefined,
    supportModelContextLength: Number.isFinite(value?.supportModelContextLength) ? value?.supportModelContextLength : undefined,
  }
}

export function copyAiSettings(settings: AiSettings): AiSettings {
  return normalizeAiSettings(settings)
}

export function toBookAiSettings(settings: AiSettings): BookAiSettings {
  const { favorites: _globalFavorites, ...bookSettings } = copyAiSettings(settings)
  return bookSettings
}

export function withGlobalFavorites(settings: BookAiSettings, favorites: string[]): AiSettings {
  return normalizeAiSettings({ ...settings, favorites })
}

export function loadAiSettings(): AiSettings {
  const stored = localStorage.getItem(AI_SETTINGS_STORAGE_KEY)
  if (!stored) return copyAiSettings(initialAiSettings)

  try {
    const parsed = JSON.parse(stored) as Partial<AiSettings>
    return normalizeAiSettings(parsed)
  } catch {
    return copyAiSettings(initialAiSettings)
  }
}

export function saveAiSettings(settings: AiSettings) {
  const normalized = copyAiSettings(settings)
  localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(normalized))
  return normalized
}

export function saveGlobalFavorites(favorites: string[]) {
  return saveAiSettings({ ...loadAiSettings(), favorites: [...favorites] })
}

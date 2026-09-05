export type AiProvider = 'openrouter' | 'nanogpt' | 'openai' | 'compatible'

export type AiPrompts = {
  story: string
  summarize: string
  titles: string
  lore: string
  assistant: string
}

export type AiSettings = {
  provider: AiProvider
  apiKey: string
  baseUrl: string
  mainModel: string
  mainModelContextLength?: number
  supportModel: string
  supportModelContextLength?: number
  codexModel: string
  codexModelContextLength?: number
  generationWordDelayMs: string
  favorites: string[]
  prompts: AiPrompts
}

export type BookAiSettings = Omit<AiSettings, 'favorites'>

export const AI_SETTINGS_STORAGE_KEY = 'arc-ai-defaults-v1'
export const DEFAULT_GENERATION_WORD_DELAY_MS = 40
export const MAX_GENERATION_WORD_DELAY_MS = 2000

const previousDefaultAiPrompts: Array<Partial<AiPrompts>> = [{
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
  assistant: `You are a thoughtful writing assistant for {{book.title}}.

Use the supplied book context as the source of truth. Distinguish established facts from suggestions, point out uncertainty when the manuscript is ambiguous, and help with continuity, character motivation, structure, brainstorming, and revision without pretending invented ideas are already canon.

{% if book.genre %}
Genre: {{book.genre}}
{% endif %}
{% if book.style %}
Writing style: {{book.style}}
{% endif %}
{% if book.language %}
Answer in {{book.language}} unless the user asks otherwise.
{% endif %}`,
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
{% if scene.previous_text %}
# Previous scene
{{scene.previous_text}}
{% endif %}
{% if scene.summary_context %}
# Earlier summaries
{{scene.summary_context}}
{% endif %}
{% if additional_context %}
# Additional context
{{additional_context}}
{% endif %}

# Current scene
{{scene.text}}

Continue the current scene without summarizing or repeating it.`,
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
  lore: `You are the canon editor for {{book.title}}.

Create or revise the Codex entry “{{entry.title}}”.
Category: {{entry.category}}.

Preserve established facts. Do not turn uncertainty into certainty, and do not invent details unless the instruction asks you to develop new lore.

{% if entry.content %}
# Existing entry
{{entry.content}}
{% endif %}
{% if scene.text %}
# Current scene
{{scene.text}}
{% endif %}
{% if additional_context %}
# Additional context
{{additional_context}}
{% endif %}
{% if book.language %}
Write in {{book.language}}.
{% endif %}

Return only the final Markdown body. Do not repeat the entry title as a top-level heading.`,
}

export const initialAiSettings: AiSettings = {
  provider: 'nanogpt',
  apiKey: '',
  baseUrl: 'https://nano-gpt.com/api/v1',
  mainModel: '',
  supportModel: '',
  codexModel: '',
  generationWordDelayMs: String(DEFAULT_GENERATION_WORD_DELAY_MS),
  favorites: [],
  prompts: defaultAiPrompts,
}

function normalizeGenerationWordDelay(value: unknown) {
  const text = typeof value === 'number' || typeof value === 'string' ? String(value).trim() : ''
  if (!/^\d+$/.test(text)) return String(DEFAULT_GENERATION_WORD_DELAY_MS)
  const delay = Number(text)
  if (!Number.isSafeInteger(delay) || delay < 1 || delay > MAX_GENERATION_WORD_DELAY_MS) {
    return String(DEFAULT_GENERATION_WORD_DELAY_MS)
  }
  return String(delay)
}

export function generationWordDelayMs(settings: Pick<AiSettings, 'generationWordDelayMs'>) {
  return Number(normalizeGenerationWordDelay(settings.generationWordDelayMs))
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
    generationWordDelayMs: normalizeGenerationWordDelay(value?.generationWordDelayMs),
    mainModelContextLength: Number.isFinite(value?.mainModelContextLength) ? value?.mainModelContextLength : undefined,
    supportModelContextLength: Number.isFinite(value?.supportModelContextLength) ? value?.supportModelContextLength : undefined,
    codexModelContextLength: Number.isFinite(value?.codexModelContextLength) ? value?.codexModelContextLength : undefined,
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

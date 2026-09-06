import { PROMPT_COMPOSITION_SCHEMA_VERSION, clonePromptComposition, compositionsFromLegacyPrompts, legacyPromptMirror, normalizePromptCompositions, withSystemPrompt, type PromptCompositions, type PromptCompositionScope } from './prompt-composition'

export type AiProvider = 'openrouter' | 'nanogpt' | 'openai' | 'compatible' | 'fake'
export type SpeechProvider = 'nanogpt'
export type SpeechSettings = {
  provider: SpeechProvider
  apiKey: string
  model: string
  voice: string
  readAloudAfterGeneration: boolean
  maxParallelRequests: string
  openaiApiKey: string
  transcriptionModel: string
  transcriptionLanguage: string
  streamTranscription: boolean
}

export const initialSpeechSettings: SpeechSettings = {
  provider: 'nanogpt',
  apiKey: '',
  model: 'Kokoro-82m',
  voice: 'af_bella',
  readAloudAfterGeneration: false,
  maxParallelRequests: '1',
  openaiApiKey: '',
  transcriptionModel: 'openai:whisper-1',
  transcriptionLanguage: 'auto',
  streamTranscription: false,
}

export type AiPrompts = {
  story: string
  summarize: string
  lore: string
  assistant: string
}

export type AiSettings = {
  provider: AiProvider
  apiKey: string
  baseUrl: string
  mainModel: string
  mainModelContextLength?: number
  mainEffectiveContextLimit: string
  supportModel: string
  supportModelContextLength?: number
  codexModel: string
  codexModelContextLength?: number
  codexEffectiveContextLimit: string
  generationWordDelayMs: string
  responseLength: string
  speech: SpeechSettings
  favorites: string[]
  promptCompositionVersion: number
  promptCompositions: PromptCompositions
  /** Runtime compatibility mirror for pre-#119 consumers. New persistence omits this legacy field. */
  prompts: AiPrompts
}

export type BookAiSettings = Omit<AiSettings, 'favorites' | 'prompts'> & { prompts?: AiPrompts }

export const AI_SETTINGS_STORAGE_KEY = 'arc-ai-defaults-v1'
export const DEFAULT_GENERATION_WORD_DELAY_MS = 40
export const MAX_GENERATION_WORD_DELAY_MS = 2000

export const RESPONSE_LENGTH_PRESETS = [
  { label: 'One paragraph', value: 'Write approximately one substantial paragraph, stopping at a natural beat rather than completing the whole scene.' },
  { label: '2–3 paragraphs', value: 'Write 2–3 substantial paragraphs, developing the current beat and stopping at a natural transition.' },
  { label: 'Half scene', value: 'Write roughly half of a typical scene continuation. Develop the current situation substantially, but do not rush to a full resolution.' },
  { label: 'Finish scene', value: 'Continue with a full scene-sized passage and bring the current scene to a natural ending when the existing momentum supports it.' },
  { label: '≤300 words', value: 'Keep the response concise and do not exceed 300 words.' },
] as const

export const previousDefaultAssistantPrompt = `You are a thoughtful writing assistant for {{book.title}}.

Use the supplied book context as the source of truth. Distinguish established facts from suggestions, point out uncertainty when the manuscript is ambiguous, and help with continuity, character motivation, structure, brainstorming, and revision without pretending invented ideas are already canon.

{% if book.genre %}
Genre: {{book.genre}}
{% endif %}
{% if book.style %}
Writing style: {{book.style}}
{% endif %}
{% if book.language %}
Answer in {{book.language}} unless the user asks otherwise.
{% endif %}`

const assistantPromptBeforeBookOverview = `You are a writing partner for a novelist.

Help the user develop, understand, plan, and revise their book. You can analyze continuity, characters, motivation, structure, pacing, worldbuilding, prose, and story possibilities.

Treat the manuscript and supplied book context as canon. Do not silently invent facts and present them as established. When information is uncertain, incomplete, or contradictory, say so.

Be creatively useful. Invent and brainstorm freely when the user asks for ideas or when proposing possibilities helps, but clearly distinguish proposed material from established story facts.

When judging voice, characterization, pacing, or prose style, prefer the actual nearby manuscript over broad book-level style descriptions.

Use supplied context as knowledge, not as a checklist. Do not force a detail into the answer merely because it was provided.

Be specific rather than generically encouraging. Point out continuity problems, weak motivations, structural problems, unclear causality, or meaningful trade-offs when they affect the user's goal.

Follow the user's requested language, format, level of detail, and creative direction.

{% if book.title %}
Book: {{book.title}}
{% endif %}
{% if book.genre %}
Genre: {{book.genre}}
{% endif %}
{% if book.style %}
Book-level style guidance: {{book.style}}
{% endif %}
{% if book.language %}
Default response language: {{book.language}}
{% endif %}`

export const previousDefaultAssistantPrompts = [previousDefaultAssistantPrompt, assistantPromptBeforeBookOverview] as const

const previousDefaultAiPrompts: Array<Partial<AiPrompts> & { titles?: string }> = [{
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
}, {
  assistant: previousDefaultAssistantPrompt,
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
}, {
  assistant: assistantPromptBeforeBookOverview,
}]

export const defaultAiPrompts: AiPrompts = {
  assistant: `You are a writing partner for a novelist.

Help the user develop, understand, plan, and revise their book. You can analyze continuity, characters, motivation, structure, pacing, worldbuilding, prose, and story possibilities.

Treat the manuscript and supplied book context as canon. Do not silently invent facts and present them as established. When information is uncertain, incomplete, or contradictory, say so.

Be creatively useful. Invent and brainstorm freely when the user asks for ideas or when proposing possibilities helps, but clearly distinguish proposed material from established story facts.

When judging voice, characterization, pacing, or prose style, prefer the actual nearby manuscript over broad book-level style descriptions.

Use supplied context as knowledge, not as a checklist. Do not force a detail into the answer merely because it was provided.

Be specific rather than generically encouraging. Point out continuity problems, weak motivations, structural problems, unclear causality, or meaningful trade-offs when they affect the user's goal.

Follow the user's requested language, format, level of detail, and creative direction.

{% if book.title %}
Book: {{book.title}}
{% endif %}
{% if book.overview %}
Book overview: {{book.overview}}
{% endif %}
{% if book.genre %}
Genre: {{book.genre}}
{% endif %}
{% if book.style %}
Book-level style guidance: {{book.style}}
{% endif %}
{% if book.language %}
Default response language: {{book.language}}
{% endif %}`,
  story: `You are a fiction writer. Your output is inserted directly into the manuscript.

Return only manuscript prose. Never add commentary, explanations, notes, introductions, headings, or discussion of the writing process.

Follow the explicit generation instruction for what happens next. Unless that instruction deliberately changes direction, preserve established facts, characterization, relationships, chronology, setting, and other story continuity.

Treat the nearby manuscript as the strongest guide to prose style, rhythm, pacing, dialogue, description, narrative voice, point of view, and tense. Book-level style guidance is secondary to the style actually established in the manuscript.

Be creatively proactive. Invent actions, dialogue, reactions, sensory details, transitions, minor details, and other material needed to move the story forward naturally, as long as they do not contradict the generation instruction or established story facts.

Use supplied context as knowledge and constraints, not as a checklist. Do not mention a fact merely because it appears in the context, and do not turn background information into unnecessary exposition.

Do not repeat, paraphrase, summarize, or rewrite prose that already exists. Continue from the generation point. If the current scene is empty, begin a new scene naturally from the established story state.

Advance the scene through concrete action, dialogue, perception, thought, and specific detail rather than explaining what the scene means.

Do not rush toward resolution, revelation, or a scene ending unless the instruction or existing momentum calls for it.`,
  summarize: `Summarize {{target.type}} from {{book.title}} for future story context.

Keep names, decisions, promises, and unresolved questions.
{% if book.language %}
Write the summary in {{book.language}}.
{% endif %}
{% if target.previous_summary %}
Update the existing summary instead of starting over.
{% endif %}`,
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

export const defaultPromptCompositions: PromptCompositions = compositionsFromLegacyPrompts(defaultAiPrompts)

export const initialAiSettings: AiSettings = {
  provider: 'nanogpt',
  apiKey: '',
  baseUrl: 'https://nano-gpt.com/api/v1',
  mainModel: '',
  mainEffectiveContextLimit: '',
  supportModel: '',
  codexModel: '',
  codexEffectiveContextLimit: '',
  generationWordDelayMs: String(DEFAULT_GENERATION_WORD_DELAY_MS),
  responseLength: '',
  speech: initialSpeechSettings,
  favorites: [],
  promptCompositionVersion: PROMPT_COMPOSITION_SCHEMA_VERSION,
  promptCompositions: defaultPromptCompositions,
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

export function textAiIsConfigured(settings: Pick<AiSettings, 'provider' | 'apiKey' | 'mainModel'>) {
  if (settings.provider === 'fake') return settings.mainModel.trim() === 'fake/test'
  return settings.provider === 'nanogpt' && Boolean(settings.apiKey.trim() && settings.mainModel.trim())
}

function normalizeSpeechSettings(value: unknown): SpeechSettings {
  const speech = value && typeof value === 'object' ? value as Partial<SpeechSettings> : {}
  const rawConcurrency = typeof speech.maxParallelRequests === 'number' || typeof speech.maxParallelRequests === 'string' ? String(speech.maxParallelRequests).trim() : '1'
  const concurrency = /^\d+$/.test(rawConcurrency) ? Math.max(1, Math.min(8, Number(rawConcurrency))) : 1
  return {
    provider: 'nanogpt',
    apiKey: typeof speech.apiKey === 'string' ? speech.apiKey : '',
    model: typeof speech.model === 'string' && speech.model.trim() ? speech.model : initialSpeechSettings.model,
    voice: typeof speech.voice === 'string' ? speech.voice : initialSpeechSettings.voice,
    readAloudAfterGeneration: speech.readAloudAfterGeneration === true,
    maxParallelRequests: String(concurrency),
    openaiApiKey: typeof speech.openaiApiKey === 'string' ? speech.openaiApiKey : '',
    transcriptionModel: typeof speech.transcriptionModel === 'string' && speech.transcriptionModel.trim() ? speech.transcriptionModel : initialSpeechSettings.transcriptionModel,
    transcriptionLanguage: typeof speech.transcriptionLanguage === 'string' && speech.transcriptionLanguage.trim() ? speech.transcriptionLanguage.trim() : 'auto',
    streamTranscription: speech.streamTranscription === true,
  }
}

export function normalizeAiSettings(value?: Partial<AiSettings>): AiSettings {
  const storedPrompts = value?.prompts as (Partial<AiPrompts> & { titles?: string }) | undefined
  const prompts: AiPrompts = {
    story: storedPrompts?.story ?? defaultAiPrompts.story,
    summarize: storedPrompts?.summarize ?? defaultAiPrompts.summarize,
    lore: storedPrompts?.lore ?? defaultAiPrompts.lore,
    assistant: storedPrompts?.assistant ?? defaultAiPrompts.assistant,
  }
  ;(Object.keys(defaultAiPrompts) as Array<keyof AiPrompts>).forEach((key) => {
    if (previousDefaultAiPrompts.some((defaults) => prompts[key] === defaults[key])) prompts[key] = defaultAiPrompts[key]
  })
  const promptCompositions = normalizePromptCompositions(value?.promptCompositions, prompts)
  const promptMirror = legacyPromptMirror(promptCompositions) as AiPrompts
  return {
    ...initialAiSettings,
    ...value,
    apiKey: value?.provider === 'fake' ? '' : typeof value?.apiKey === 'string' ? value.apiKey : initialAiSettings.apiKey,
    baseUrl: value?.provider === 'fake' ? '' : typeof value?.baseUrl === 'string' ? value.baseUrl : initialAiSettings.baseUrl,
    responseLength: typeof value?.responseLength === 'string' ? value.responseLength : '',
    speech: normalizeSpeechSettings(value?.speech),
    promptCompositionVersion: PROMPT_COMPOSITION_SCHEMA_VERSION,
    promptCompositions,
    prompts: promptMirror,
    mainEffectiveContextLimit: typeof value?.mainEffectiveContextLimit === 'string' ? value.mainEffectiveContextLimit : '',
    codexEffectiveContextLimit: typeof value?.codexEffectiveContextLimit === 'string' ? value.codexEffectiveContextLimit : '',
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
  const { favorites: _globalFavorites, prompts: _legacyPromptMirror, ...bookSettings } = copyAiSettings(settings)
  return bookSettings
}

export function withPromptSystemPrompt(settings: AiSettings, scope: PromptCompositionScope, systemPrompt: string): AiSettings {
  return normalizeAiSettings({
    ...settings,
    promptCompositions: withSystemPrompt(settings.promptCompositions, scope, systemPrompt),
    prompts: undefined as unknown as AiPrompts,
  })
}

export function resetPromptComposition(settings: AiSettings, scope: PromptCompositionScope): AiSettings {
  return normalizeAiSettings({
    ...settings,
    promptCompositions: {
      ...settings.promptCompositions,
      [scope]: clonePromptComposition(defaultPromptCompositions[scope]),
    },
    prompts: undefined as unknown as AiPrompts,
  })
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
  const { prompts: _legacyPromptMirror, ...persisted } = normalized
  localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(persisted))
  return normalized
}

export function saveGlobalFavorites(favorites: string[]) {
  return saveAiSettings({ ...loadAiSettings(), favorites: [...favorites] })
}

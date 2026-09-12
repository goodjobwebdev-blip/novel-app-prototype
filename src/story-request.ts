import { sceneWritingTemplateValues, type SceneWritingOverrides } from './scene-writing.ts'
import { bookTemplateValues, type BookPromptValues } from './prompt-template.ts'
import {
  assembleCompositionRequest,
  clonePromptComposition,
  dedupeDynamicSources,
  normalizeAppManagedPart,
  providerMessagesFromNormalized,
  type DynamicContextSource,
  type NormalizedAssembledRequest,
  type PromptComposition,
} from './prompt-composition.ts'
import type { PreparedContextValues } from './context-service'

export const STORY_CONTINUE_FALLBACK = 'Continue the story naturally from the generation point.'

const previousStoryContextTemplate = `{% if context.automatic %}{{context.automatic}}{% endif %}

{% if context.additional %}# Additional context

{{context.additional}}{% endif %}`

export const defaultStoryPromptComposition: PromptComposition = {
  systemPrompt: `You are a fiction writer. Your output is inserted directly into the manuscript.

Return only manuscript prose. Never add commentary, explanations, notes, introductions, headings, or discussion of the writing process.

Follow the explicit generation instruction for what happens next. Unless that instruction deliberately changes direction, preserve established facts, characterization, relationships, chronology, setting, and other story continuity.

Follow the effective scene writing settings for point of view, tense, style, and language unless the explicit generation instruction deliberately changes them. Scene overrides take precedence over conflicting book defaults or nearby prose. Use the nearby manuscript to guide rhythm, pacing, dialogue, and description within those settings.

Be creatively proactive. Invent actions, dialogue, reactions, sensory details, transitions, minor details, and other material needed to move the story forward naturally, as long as they do not contradict the generation instruction or established story facts.

Use supplied context as knowledge and constraints, not as a checklist. Do not mention a fact merely because it appears in the context, and do not turn background information into unnecessary exposition.

Do not repeat, paraphrase, summarize, or rewrite prose that already exists. Continue from the generation point. If the current scene is empty, begin a new scene naturally from the established story state.

Advance the scene through concrete action, dialogue, perception, thought, and specific detail rather than explaining what the scene means.

Do not rush toward resolution, revelation, or a scene ending unless the instruction or existing momentum calls for it.`,
  predefinedMessages: [
    {
      id: 'story-book',
      name: 'Book',
      role: 'system',
      enabled: true,
      template: `{% if book.title %}Title: {{book.title}}{% endif %}
{% if book.series %}Series: {{book.series}}{% endif %}
{% if book.series_order %}Series position: Book {{book.series_order}}{% endif %}
{% if book.overview %}Overview: {{book.overview}}{% endif %}
{% if book.genre %}Genre: {{book.genre}}{% endif %}
{% if scene.effective_style %}Writing style: {{scene.effective_style}} ({{scene.style_origin}}){% endif %}
{% if scene.effective_pov %}Point of view: {{scene.effective_pov}} ({{scene.pov_origin}}){% endif %}
{% if scene.effective_tense %}Narrative tense: {{scene.effective_tense}} ({{scene.tense_origin}}){% endif %}
{% if scene.effective_language %}Language: {{scene.effective_language}} ({{scene.language_origin}}){% endif %}`,
    },
    {
      id: 'story-context',
      name: 'Story context',
      role: 'user',
      enabled: true,
      // Keep reusable references before the manuscript that changes each generation.
      template: `{% if story.so_far %}# Story so far

{{story.so_far}}{% endif %}

{% if scene.previous_text %}# Previous scene

{{scene.previous_text}}{% endif %}

{% if context.automatic_codex %}# Automatic Codex

{{context.automatic_codex}}{% endif %}

{% if context.additional %}# Additional context

{{context.additional}}{% endif %}

{% if scene.before_cursor %}# Before generation point

{{scene.before_cursor}}{% endif %}

{% if scene.after_cursor %}# After generation point

{{scene.after_cursor}}{% endif %}`,
    },
    {
      id: 'story-response-length',
      name: 'Response length',
      role: 'user',
      enabled: true,
      template: `{% if response.length %}# Response length

{{response.length}}{% endif %}`,
    },
  ],
}

const previousStorySystemPrompt = `You are a fiction writer. Your output is inserted directly into the manuscript.

Return only manuscript prose. Never add commentary, explanations, notes, introductions, headings, or discussion of the writing process.

Follow the explicit generation instruction for what happens next. Unless that instruction deliberately changes direction, preserve established facts, characterization, relationships, chronology, setting, and other story continuity.

Treat the nearby manuscript as the strongest guide to prose style, rhythm, pacing, dialogue, description, narrative voice, point of view, and tense. Book-level style guidance is secondary to the style actually established in the manuscript.

Be creatively proactive. Invent actions, dialogue, reactions, sensory details, transitions, minor details, and other material needed to move the story forward naturally, as long as they do not contradict the generation instruction or established story facts.

Use supplied context as knowledge and constraints, not as a checklist. Do not mention a fact merely because it appears in the context, and do not turn background information into unnecessary exposition.

Do not repeat, paraphrase, summarize, or rewrite prose that already exists. Continue from the generation point. If the current scene is empty, begin a new scene naturally from the established story state.

Advance the scene through concrete action, dialogue, perception, thought, and specific detail rather than explaining what the scene means.

Do not rush toward resolution, revelation, or a scene ending unless the instruction or existing momentum calls for it.`
const previousStoryBookTemplate = `{% if book.title %}Title: {{book.title}}{% endif %}
{% if book.series %}Series: {{book.series}}{% endif %}
{% if book.series_order %}Series position: Book {{book.series_order}}{% endif %}
{% if book.overview %}Overview: {{book.overview}}{% endif %}
{% if book.genre %}Genre: {{book.genre}}{% endif %}
{% if book.style %}Book-level style guidance: {{book.style}}{% endif %}
{% if book.pov %}Default point of view: {{book.pov}}{% endif %}
{% if book.tense %}Default narrative tense: {{book.tense}}{% endif %}
{% if book.language %}Language: {{book.language}}{% endif %}
{% if scene.pov %}Current Scene point of view: {{scene.pov}}{% endif %}`

/** Upgrade exact app defaults only. Keep authored text and preset-assigned IDs intact. */
export function upgradeDefaultStoryPromptComposition(composition: PromptComposition): PromptComposition {
  const candidates = [
    { system: previousStorySystemPrompt, book: previousStoryBookTemplate, context: previousStoryContextTemplate },
    { system: previousStorySystemPrompt, book: previousStoryBookTemplate, context: defaultStoryPromptComposition.predefinedMessages[1].template },
    { system: defaultStoryPromptComposition.systemPrompt, book: defaultStoryPromptComposition.predefinedMessages[0].template, context: previousStoryContextTemplate },
  ]
  const unchanged = candidates.some((candidate) => composition.systemPrompt === candidate.system
    && composition.predefinedMessages.length === defaultStoryPromptComposition.predefinedMessages.length
    && composition.predefinedMessages.every((message, index) => {
      const expected = defaultStoryPromptComposition.predefinedMessages[index]
      const template = index === 0 ? candidate.book : index === 1 ? candidate.context : expected.template
      return message.name === expected.name && message.role === expected.role && message.enabled === expected.enabled && message.template === template
    }))
  if (!unchanged) return composition
  const upgraded = clonePromptComposition(composition)
  upgraded.systemPrompt = defaultStoryPromptComposition.systemPrompt
  upgraded.predefinedMessages = upgraded.predefinedMessages.map((message, index) => ({ ...message, template: defaultStoryPromptComposition.predefinedMessages[index].template }))
  return upgraded
}

export type StoryRequestInput = {
  composition: PromptComposition
  book: BookPromptValues
  responseLength: string
  sceneText: string
  insertionPosition: number
  scenePov?: string
  sceneOverrides?: SceneWritingOverrides
  context: PreparedContextValues
  instruction?: string
}

function section(heading: string, content: string) {
  return content.trim() ? `# ${heading}\n\n${content.trim()}` : ''
}

function clampInsertion(sceneText: string, insertionPosition: number) {
  return Math.max(0, Math.min(sceneText.length, Math.floor(Number.isFinite(insertionPosition) ? insertionPosition : sceneText.length)))
}

export function storyAutomaticContext(input: Pick<StoryRequestInput, 'sceneText' | 'insertionPosition' | 'context'>) {
  const insertionPosition = clampInsertion(input.sceneText, input.insertionPosition)
  return [
    section('Story so far', input.context.summaryContext),
    section('Previous scene', input.context.previousSceneText),
    section('Before generation point', input.sceneText.slice(0, insertionPosition)),
    section('After generation point', input.sceneText.slice(insertionPosition)),
    section('Automatic Codex', input.context.automaticCodexContext ?? ''),
  ].filter(Boolean).join('\n\n')
}

function sourcesFor(input: StoryRequestInput) {
  const insertionPosition = clampInsertion(input.sceneText, input.insertionPosition)
  const automatic: DynamicContextSource[] = [
    ...(input.context.storySoFarSources ?? (input.context.summaryContext.trim() ? [{ sourceId: 'story-so-far', title: 'Story so far', type: 'summary', representation: 'Summary', content: input.context.summaryContext, reason: 'Earlier-story context' }] : [])),
    ...(input.context.previousSceneText.trim() ? [{ sourceId: input.context.previousSceneId || 'previous-scene', title: input.context.previousSceneTitle || 'Previous scene', type: 'scene', representation: 'Full', content: input.context.previousSceneText, reason: 'Empty-scene fallback' }] : []),
    ...(input.sceneText.slice(0, insertionPosition).trim() || input.sceneText.slice(insertionPosition).trim() ? [{ sourceId: input.context.currentSceneId || 'current-scene', title: input.context.currentSceneTitle || 'Current scene', type: 'scene', representation: 'Caret split', content: input.sceneText, reason: `Captured generation point at character ${insertionPosition}` }] : []),
    ...(input.context.automaticSources ?? []),
  ]
  const dedupe = dedupeDynamicSources(automatic, input.context.additionalSources ?? [])
  return { automatic: dedupe.automatic, additional: dedupe.additional, dedupe: dedupe.decisions }
}

export function storyRequestValues(input: StoryRequestInput) {
  const insertionPosition = clampInsertion(input.sceneText, input.insertionPosition)
  const { additional } = sourcesFor(input)
  const additionalText = input.context.additionalSources !== undefined
    ? additional.map((source) => source.content).filter(Boolean).join('\n\n')
    : input.context.manualAdditionalContext ?? input.context.additionalContext
  return {
    ...bookTemplateValues({ ...input.book, responseLength: input.responseLength }),
    'scene.text': input.sceneText,
    ...sceneWritingTemplateValues(input.book, { pov: input.scenePov, ...input.sceneOverrides }),
    'scene.previous_text': input.context.previousSceneText,
    'scene.before_cursor': input.sceneText.slice(0, insertionPosition),
    'scene.after_cursor': input.sceneText.slice(insertionPosition),
    'story.so_far': input.context.summaryContext,
    'context.automatic': storyAutomaticContext(input),
    'context.automatic_codex': input.context.automaticCodexContext ?? '',
    'context.additional': additionalText,
  }
}

export function assembleStoryGenerationRequest(input: StoryRequestInput): NormalizedAssembledRequest {
  const { automatic, additional, dedupe } = sourcesFor(input)
  const request = assembleCompositionRequest({
    composition: input.composition,
    values: storyRequestValues(input),
    dynamicSources: {
      'story.so_far': input.context.storySoFarSources ?? automatic.filter((source) => source.type === 'summary'),
      'scene.previous_text': automatic.filter((source) => source.sourceId === (input.context.previousSceneId || 'previous-scene')),
      'scene.text': automatic.filter((source) => source.representation === 'Caret split'),
      'scene.before_cursor': automatic.filter((source) => source.representation === 'Caret split'),
      'scene.after_cursor': automatic.filter((source) => source.representation === 'Caret split'),
      'context.automatic': automatic,
      'context.automatic_codex': input.context.automaticSources ?? [],
      'context.additional': additional,
    },
    dynamicSourceDedupe: dedupe,
    after: [normalizeAppManagedPart({
      id: 'story-current-instruction',
      role: 'user',
      sourceKind: 'current-turn',
      sourceId: 'story-current-instruction',
      name: 'Current instruction',
      ownership: 'current-turn',
      content: input.instruction?.trim() || STORY_CONTINUE_FALLBACK,
    })],
  })
  providerMessagesFromNormalized(request, { system: true, user: true, assistant: true })
  return request
}

import { bookTemplateValues, type BookPromptValues } from './prompt-template.ts'
import {
  assembleCompositionRequest,
  dedupeDynamicSources,
  normalizeAppManagedPart,
  providerMessagesFromNormalized,
  type DynamicContextSource,
  type DynamicSourceExclusionDecision,
  type NormalizedAssembledRequest,
  type PromptComposition,
} from './prompt-composition.ts'
import type { PreparedContextValues } from './context-service'

export const CODEX_CONTINUE_FALLBACK = 'Continue or expand this Codex entry from the generation point using the established context as factual guidance.'

export const defaultCodexPromptComposition: PromptComposition = {
  systemPrompt: `You create canonical reference material for a novel-writing workspace.

Return only usable Codex prose or Markdown appropriate to the current entry, never commentary about the writing process or a meta-explanation.

Preserve established facts, continuity, relationships, chronology, and terminology. Do not contradict authoritative existing Codex or story context unless the current instruction explicitly asks for a change.

When source material is uncertain or ambiguous, preserve that uncertainty rather than inventing false certainty.

Use supplied context as factual guidance and constraints, not as a checklist. Do not unnecessarily repeat or paraphrase material that already exists in the current entry.

Continue or expand the entry at the captured generation point.`,
  predefinedMessages: [
    {
      id: 'codex-book',
      name: 'Book',
      role: 'system',
      enabled: true,
      template: `{% if book.title %}Book: {{book.title}}{% endif %}
{% if book.series %}Series: {{book.series}}{% endif %}
{% if book.series_order %}Series position: {{book.series_order}}{% endif %}
{% if book.overview %}Overview: {{book.overview}}{% endif %}
{% if book.genre %}Genre: {{book.genre}}{% endif %}
{% if book.language %}Language: {{book.language}}{% endif %}`,
    },
    {
      id: 'codex-current-entry',
      name: 'Current entry',
      role: 'user',
      enabled: true,
      template: `# Current Codex entry

{% if entry.title %}Title: {{entry.title}}{% endif %}
{% if entry.category %}Category: {{entry.category}}{% endif %}

{% if entry.before_cursor %}# Before generation point
{{entry.before_cursor}}{% endif %}

{% if entry.after_cursor %}# After generation point
{{entry.after_cursor}}{% endif %}`,
    },
    {
      id: 'codex-context',
      name: 'Context',
      role: 'user',
      enabled: true,
      template: `{% if context.automatic %}# Automatic context
{{context.automatic}}{% endif %}

{% if context.additional %}# Additional context
{{context.additional}}{% endif %}`,
    },
    {
      id: 'codex-response-length',
      name: 'Response length',
      role: 'user',
      enabled: true,
      template: `{% if response.length %}# Response length
{{response.length}}{% endif %}`,
    },
  ],
}

export type CodexRequestInput = {
  composition: PromptComposition
  book: BookPromptValues
  responseLength: string
  entry: { id: string; title: string; category: string; content: string }
  insertionPosition: number
  context: PreparedContextValues
  instruction?: string
}

function section(heading: string, content: string) {
  return content.trim() ? `# ${heading}\n\n${content.trim()}` : ''
}

function clampInsertion(content: string, insertionPosition: number) {
  return Math.max(0, Math.min(content.length, Math.floor(Number.isFinite(insertionPosition) ? insertionPosition : content.length)))
}

function codexSection(source: DynamicContextSource) {
  const title = source.title?.trim() || source.sourceId
  return `### ${source.category ? `${source.category}: ` : ''}${title}\n\n${source.content.trim()}`
}

function sourcesFor(input: CodexRequestInput) {
  const exclusions: DynamicSourceExclusionDecision[] = (input.context.targetExcludedSources ?? [])
    .filter((source) => source.sourceId === input.entry.id)
    .map((source) => ({ sourceId: source.sourceId, omitted: { ...source }, reason: 'current-target' }))
  const excludeTarget = (source: DynamicContextSource) => {
    if (source.sourceId !== input.entry.id) return true
    exclusions.push({ sourceId: source.sourceId, omitted: { ...source }, reason: 'current-target' })
    return false
  }
  const automaticCodex = (input.context.automaticSources ?? []).filter(excludeTarget)
  const storySources = input.context.storySoFarSources ?? []
  const sceneSource: DynamicContextSource[] = input.context.lastSceneText.trim()
    ? [{
        sourceId: input.context.currentSceneId || 'current-scene',
        title: input.context.lastSceneTitle || input.context.currentSceneTitle || 'Current scene',
        type: 'scene',
        representation: 'Full',
        content: input.context.lastSceneText,
        reason: 'Current/last-opened story anchor',
      }]
    : input.context.previousSceneText.trim()
      ? [{
          sourceId: input.context.previousSceneId || 'previous-scene',
          title: input.context.previousSceneTitle || 'Previous scene',
          type: 'scene',
          representation: 'Full',
          content: input.context.previousSceneText,
          reason: 'Empty anchor Scene fallback',
        }]
      : []
  const automatic: DynamicContextSource[] = [...storySources, ...sceneSource, ...automaticCodex]
  const additionalCandidates = (input.context.additionalSources ?? []).filter(excludeTarget)
  const dedupe = dedupeDynamicSources(automatic, additionalCandidates)
  return { automatic: dedupe.automatic, automaticCodex, storySources, sceneSource, additional: dedupe.additional, dedupe: dedupe.decisions, exclusions }
}

export function codexAutomaticContext(input: CodexRequestInput) {
  const { automaticCodex } = sourcesFor(input)
  return [
    section('Story so far', input.context.summaryContext),
    input.context.lastSceneText.trim()
      ? section('Current scene', input.context.lastSceneText)
      : section('Previous scene', input.context.previousSceneText),
    section('Automatically relevant Codex', automaticCodex.map(codexSection).join('\n\n')),
  ].filter(Boolean).join('\n\n')
}

export function codexRequestValues(input: CodexRequestInput) {
  const insertionPosition = clampInsertion(input.entry.content, input.insertionPosition)
  const { additional } = sourcesFor(input)
  const additionalText = input.context.additionalSources !== undefined
    ? additional.map((source) => source.content).filter(Boolean).join('\n\n')
    : input.context.manualAdditionalContext ?? ''
  return {
    ...bookTemplateValues({ ...input.book, responseLength: input.responseLength }),
    'entry.title': input.entry.title,
    'entry.category': input.entry.category,
    'entry.content': input.entry.content,
    'entry.before_cursor': input.entry.content.slice(0, insertionPosition),
    'entry.after_cursor': input.entry.content.slice(insertionPosition),
    'scene.text': input.context.lastSceneText,
    'scene.previous_text': input.context.lastSceneText.trim() ? '' : input.context.previousSceneText,
    'story.so_far': input.context.summaryContext,
    'context.automatic': codexAutomaticContext(input),
    'context.automatic_codex': (input.context.automaticSources ?? []).filter((source) => source.sourceId !== input.entry.id).map(codexSection).join('\n\n'),
    'context.additional': additionalText,
  }
}

export function assembleCodexGenerationRequest(input: CodexRequestInput): NormalizedAssembledRequest {
  const { automatic, automaticCodex, storySources, sceneSource, additional, dedupe, exclusions } = sourcesFor(input)
  const request = assembleCompositionRequest({
    composition: input.composition,
    values: codexRequestValues(input),
    dynamicSources: {
      'entry.content': [{ sourceId: input.entry.id, title: input.entry.title, type: 'codex', representation: 'Authoritative target', content: input.entry.content, reason: 'Captured current entry body' }],
      'entry.before_cursor': [{ sourceId: input.entry.id, title: input.entry.title, type: 'codex', representation: 'Before caret', content: input.entry.content.slice(0, clampInsertion(input.entry.content, input.insertionPosition)), reason: `Captured generation point at character ${clampInsertion(input.entry.content, input.insertionPosition)}` }],
      'entry.after_cursor': [{ sourceId: input.entry.id, title: input.entry.title, type: 'codex', representation: 'After caret', content: input.entry.content.slice(clampInsertion(input.entry.content, input.insertionPosition)), reason: `Captured generation point at character ${clampInsertion(input.entry.content, input.insertionPosition)}` }],
      'story.so_far': storySources,
      'scene.text': input.context.lastSceneText.trim() ? sceneSource : [],
      'scene.previous_text': input.context.lastSceneText.trim() ? [] : sceneSource,
      'context.automatic': automatic,
      'context.automatic_codex': automaticCodex,
      'context.additional': additional,
    },
    dynamicSourceDedupe: dedupe,
    dynamicSourceExclusions: exclusions,
    after: [normalizeAppManagedPart({
      id: 'codex-current-instruction',
      role: 'user',
      sourceKind: 'current-turn',
      sourceId: 'codex-current-instruction',
      name: 'Current instruction',
      ownership: 'current-turn',
      content: input.instruction?.trim() || CODEX_CONTINUE_FALLBACK,
    })],
  })
  providerMessagesFromNormalized(request, { system: true, user: true, assistant: true })
  return request
}

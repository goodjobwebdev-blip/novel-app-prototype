import {
  assembleCompositionRequest,
  dedupeDynamicSources,
  normalizeAppManagedPart,
  type DynamicContextSource,
  type NormalizedAssembledRequest,
  type PromptComposition,
} from './prompt-composition'
import { bookTemplateValues, type BookPromptValues } from './prompt-template'
import type { PreparedContextValues } from './context-service'

type CodexRequestInput = {
  composition: PromptComposition
  book: BookPromptValues
  context: PreparedContextValues
  entryId: string
  entryTitle: string
  entryCategory: string
  entryContent: string
  instruction: string
}

type SummaryRequestInput = {
  composition: PromptComposition
  book: BookPromptValues
  sourceId: string
  sourceTitle: string
  sourceType: string
  sourceContent: string
  previousSummary: string
}

function currentInstruction(id: string, name: string, instruction: string) {
  return normalizeAppManagedPart({
    id,
    role: 'user',
    sourceKind: 'current-turn',
    sourceId: id,
    name,
    ownership: 'current-turn',
    content: `# Instruction\n\n${instruction.trim()}`,
  })
}

function section(heading: string, content: string) {
  return content.trim() ? `# ${heading}\n\n${content.trim()}` : ''
}

export function sharedGenerationContext(context: PreparedContextValues) {
  const currentSceneSources: DynamicContextSource[] = context.lastSceneText.trim()
    ? [{ sourceId: context.currentSceneId || 'current-scene', title: context.lastSceneTitle || 'Current scene', type: 'scene', representation: 'Full', content: context.lastSceneText, reason: 'Included by context profile' }]
    : []
  const automaticCodexSources = context.automaticSources ?? []
  const automaticSources = [...currentSceneSources, ...automaticCodexSources]
  const dedupe = dedupeDynamicSources(automaticSources, context.additionalSources ?? [])
  const additionalSources = dedupe.additional
  const additionalContext = context.additionalSources === undefined
    ? context.manualAdditionalContext ?? context.additionalContext
    : additionalSources.map((source) => source.content).filter(Boolean).join('\n\n')
  return {
    values: {
      'context.automatic': [
        section(`Current scene${context.lastSceneTitle ? ` — ${context.lastSceneTitle}` : ''}`, context.lastSceneText),
        section('Automatic Codex', context.automaticCodexContext ?? ''),
      ].filter(Boolean).join('\n\n'),
      'context.automatic_codex': context.automaticCodexContext ?? '',
      'context.additional': additionalContext,
    },
    dynamicSources: {
      'scene.text': currentSceneSources,
      'context.automatic_codex': automaticCodexSources,
      'context.automatic': automaticSources,
      'context.additional': additionalSources,
    },
    dynamicSourceDedupe: dedupe.decisions,
  }
}

export function assembleCodexGenerationRequest(input: CodexRequestInput): NormalizedAssembledRequest {
  const context = sharedGenerationContext(input.context)
  const entrySource: DynamicContextSource = {
    sourceId: input.entryId,
    title: input.entryTitle,
    type: 'codexEntry',
    representation: 'Full entry',
    content: input.entryContent,
  }
  return assembleCompositionRequest({
    composition: input.composition,
    values: {
      ...bookTemplateValues(input.book),
      ...context.values,
      'scene.text': input.context.lastSceneText,
      'entry.title': input.entryTitle,
      'entry.category': input.entryCategory,
      'entry.content': input.entryContent,
    },
    dynamicSources: {
      ...context.dynamicSources,
      'entry.title': [entrySource],
      'entry.category': [entrySource],
      'entry.content': [entrySource],
    },
    dynamicSourceDedupe: context.dynamicSourceDedupe,
    after: [currentInstruction('codex-instruction', 'Generation instruction', input.instruction)],
  })
}

export function assembleSummaryGenerationRequest(input: SummaryRequestInput): NormalizedAssembledRequest {
  const source: DynamicContextSource = {
    sourceId: input.sourceId,
    title: input.sourceTitle,
    type: input.sourceType,
    representation: 'Full source',
    content: input.sourceContent,
  }
  const action = input.previousSummary.trim()
    ? `# Existing summary\n\n${input.previousSummary.trim()}\n\n# Source material\n\n${input.sourceContent}\n\nReturn only the updated summary as Markdown.`
    : `# Source material\n\n${input.sourceContent}\n\nReturn only the summary as Markdown.`
  return assembleCompositionRequest({
    composition: input.composition,
    values: {
      ...bookTemplateValues(input.book),
      'target.type': input.sourceType === 'codexEntry' ? 'Codex entry' : input.sourceType,
      'target.previous_summary': input.previousSummary,
      'context.automatic': input.sourceContent,
      'context.automatic_codex': '',
      'context.additional': '',
    },
    dynamicSources: {
      'target.type': [source],
      'target.previous_summary': input.previousSummary.trim() ? [source] : [],
      'context.automatic': [source],
    },
    after: [normalizeAppManagedPart({
      id: 'summary-action',
      role: 'user',
      sourceKind: 'current-turn',
      sourceId: 'summary-action',
      name: input.previousSummary.trim() ? 'Re-summarize' : 'Summarize',
      ownership: 'current-turn',
      content: action,
    })],
  })
}

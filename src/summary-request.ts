import { bookTemplateValues, type BookPromptValues } from './prompt-template.ts'
import {
  assembleCompositionRequest,
  normalizeAppManagedPart,
  providerMessagesFromNormalized,
  type DynamicContextSource,
  type NormalizedAssembledRequest,
  type PromptComposition,
} from './prompt-composition.ts'
import type { SummarySourceType } from './persistence.ts'

export const SUMMARY_CREATE_ACTION = 'Produce a concise replacement summary of the supplied authoritative source for future story context.'
export const SUMMARY_REPLACE_ACTION = 'Replace the previous summary with an updated summary of the current authoritative source. Preserve still-valid useful information, but treat the current source as authoritative.'

export const defaultSummaryPromptComposition: PromptComposition = {
  systemPrompt: `You produce faithful derived summaries for future AI and story context.

Preserve concrete names, events, decisions, promises, relationships, discoveries, constraints, causal links, and unresolved threads that remain useful later.

Distinguish established fact from uncertainty or ambiguity. Never invent unsupported facts.

Prefer concise, concrete information over commentary about writing. Do not add introductions, conclusions, or meta-explanations around the Summary.

Output only the replacement Summary content. The current authoritative source always outranks previous derived Summary text when they disagree.`,
  predefinedMessages: [
    {
      id: 'summary-book',
      name: 'Book',
      role: 'system',
      enabled: true,
      template: `{% if book.title %}Book: {{book.title}}{% endif %}
{% if book.language %}Summary language: {{book.language}}{% endif %}`,
    },
    {
      id: 'summary-input',
      name: 'Summary input',
      role: 'user',
      enabled: true,
      template: `# Target
{% if target.type %}Type: {{target.type}}{% endif %}
{% if target.title %}Title: {{target.title}}{% endif %}

# Authoritative source
{{target.source}}

{% if target.previous_summary %}
# Previous derived summary
{{target.previous_summary}}
{% endif %}`,
    },
    {
      id: 'summary-response-length',
      name: 'Response length',
      role: 'user',
      enabled: true,
      template: `{% if response.length %}# Response length
{{response.length}}{% endif %}`,
    },
  ],
}

export function summaryTargetTypeLabel(type: SummarySourceType) {
  return type === 'codexEntry' ? 'Codex entry' : type[0].toUpperCase() + type.slice(1)
}

export type SummaryRequestInput = {
  composition: PromptComposition
  book: BookPromptValues
  responseLength: string
  summary: { id: string; content: string }
  target: { id: string; type: SummarySourceType; title: string; source: string }
  sourceDiagnostics?: DynamicContextSource[]
  action?: 'summarize' | 'resummarize'
}

export function summaryRequestValues(input: SummaryRequestInput) {
  return {
    ...bookTemplateValues({ ...input.book, responseLength: input.responseLength }),
    'target.type': summaryTargetTypeLabel(input.target.type),
    'target.title': input.target.title,
    'target.source': input.target.source,
    'target.previous_summary': input.summary.content,
  }
}

export function assembleSummaryGenerationRequest(input: SummaryRequestInput): NormalizedAssembledRequest {
  const replacing = input.action === 'resummarize' || (input.action === undefined && Boolean(input.summary.content.trim()))
  const sourceDiagnostics = input.sourceDiagnostics?.length
    ? input.sourceDiagnostics
    : [{
        sourceId: input.target.id,
        title: input.target.title,
        type: input.target.type,
        representation: 'Authoritative source',
        content: input.target.source,
        reason: 'Exact Summary source selected by the source builder',
      }]
  const previousSummaryDiagnostics: DynamicContextSource[] = input.summary.content.trim()
    ? [{
        sourceId: input.summary.id,
        title: `${input.target.title} summary`,
        type: 'summary',
        representation: 'Previous derived summary',
        content: input.summary.content,
        reason: 'Previous derived state; current authoritative source takes precedence',
      }]
    : []
  const request = assembleCompositionRequest({
    composition: input.composition,
    values: summaryRequestValues(input),
    dynamicSources: {
      'target.source': sourceDiagnostics,
      'target.previous_summary': previousSummaryDiagnostics,
    },
    after: [normalizeAppManagedPart({
      id: 'summary-current-action',
      role: 'user',
      sourceKind: 'current-turn',
      sourceId: 'summary-current-action',
      name: replacing ? 'Re-summarize action' : 'Summarize action',
      ownership: 'current-turn',
      content: replacing ? SUMMARY_REPLACE_ACTION : SUMMARY_CREATE_ACTION,
    })],
  })
  providerMessagesFromNormalized(request, { system: true, user: true, assistant: true })
  return request
}

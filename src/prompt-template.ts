import {
  canonicalVariableName,
  renderCompositionTemplate,
  validatePromptTemplate,
  type PromptTemplateDiagnostic,
  type VariableStability,
} from './prompt-composition'

export type PromptScope = 'story' | 'summarize' | 'lore' | 'assistant'

export type BookPromptValues = {
  title: string
  series: string
  seriesOrder: string
  overview: string
  genre: string
  style: string
  pov: string
  tense: string
  language: string
  responseLength?: string
}

export type PromptVariable = {
  name: string
  description: string
  scopes: PromptScope[]
  stability: VariableStability
  canonical?: boolean
  aliasFor?: string
}

const everyPrompt: PromptScope[] = ['story', 'summarize', 'lore', 'assistant']
export const RESPONSE_LENGTH_VARIABLE = 'response.length'

export const promptVariables: PromptVariable[] = [
  { name: 'book.title', description: 'Current book title', scopes: everyPrompt, stability: 'book-state', canonical: true },
  { name: 'book.series', description: 'Series title, empty for standalone books', scopes: everyPrompt, stability: 'book-state', canonical: true },
  { name: 'book.series_order', description: 'Position of the book within its series', scopes: everyPrompt, stability: 'book-state', canonical: true },
  { name: 'book.overview', description: 'Book overview from the Book tab', scopes: everyPrompt, stability: 'book-state', canonical: true },
  { name: 'book.genre', description: 'Genre or combination of genres', scopes: everyPrompt, stability: 'book-state', canonical: true },
  { name: 'book.style', description: 'Preferred writing style', scopes: everyPrompt, stability: 'book-state', canonical: true },
  { name: 'book.pov', description: 'Default point of view for the book', scopes: everyPrompt, stability: 'book-state', canonical: true },
  { name: 'book.tense', description: 'Default narrative tense', scopes: everyPrompt, stability: 'book-state', canonical: true },
  { name: 'book.language', description: 'Primary writing language', scopes: everyPrompt, stability: 'book-state', canonical: true },
  { name: RESPONSE_LENGTH_VARIABLE, description: 'Response-length guidance from AI settings', scopes: ['story', 'lore'], stability: 'book-state', canonical: true },
  { name: 'scene.text', description: 'Current Scene used as the generation anchor', scopes: ['story', 'lore', 'assistant'], stability: 'turn-dynamic', canonical: true },
  { name: 'scene.before_cursor', description: 'Scene text before the captured generation point', scopes: ['story'], stability: 'turn-dynamic', canonical: true },
  { name: 'scene.after_cursor', description: 'Scene text after the captured generation point', scopes: ['story'], stability: 'turn-dynamic', canonical: true },
  { name: 'scene.pov', description: 'Scene-specific POV when one is set', scopes: ['story'], stability: 'turn-dynamic', canonical: true },
  { name: 'scene.previous_text', description: 'Previous Scene when automatic rules expose it', scopes: ['story', 'assistant'], stability: 'turn-dynamic', canonical: true },
  { name: 'story.so_far', description: 'Hierarchically compressed earlier-story state', scopes: ['story', 'assistant'], stability: 'turn-dynamic', canonical: true },
  { name: 'context.automatic', description: 'Complete automatically assembled context for this scope', scopes: everyPrompt, stability: 'turn-dynamic', canonical: true },
  { name: 'context.automatic_codex', description: 'Codex entries automatically selected through trigger/dependency rules', scopes: ['story', 'lore', 'assistant'], stability: 'turn-dynamic', canonical: true },
  { name: 'context.additional', description: 'Only context explicitly selected through Context Management', scopes: ['story', 'lore', 'assistant'], stability: 'turn-dynamic', canonical: true },
  { name: 'chat.workspace_instructions', description: 'Current Arc-owned workspace-tool contract', scopes: ['assistant'], stability: 'stable', canonical: true },
  { name: 'target.type', description: 'The current Summary target type', scopes: ['summarize'], stability: 'turn-dynamic', canonical: true },
  { name: 'target.previous_summary', description: 'Existing summary when re-summarizing', scopes: ['summarize'], stability: 'turn-dynamic', canonical: true },
  { name: 'entry.title', description: 'Current Codex entry title', scopes: ['lore'], stability: 'turn-dynamic', canonical: true },
  { name: 'entry.category', description: 'Current Codex entry category', scopes: ['lore'], stability: 'turn-dynamic', canonical: true },
  { name: 'entry.content', description: 'Current/existing Codex entry Markdown', scopes: ['lore'], stability: 'turn-dynamic', canonical: true },
  { name: 'scene.summary_context', description: 'Legacy alias for story.so_far', scopes: ['story'], stability: 'turn-dynamic', aliasFor: 'story.so_far' },
  { name: 'additional_context', description: 'Legacy alias for context.additional', scopes: ['story', 'lore'], stability: 'turn-dynamic', aliasFor: 'context.additional' },
]

export function bookTemplateValues(book: BookPromptValues): Record<string, string> {
  return {
    'book.title': book.title,
    'book.series': book.series,
    'book.series_order': book.seriesOrder,
    'book.overview': book.overview,
    'book.genre': book.genre,
    'book.style': book.style,
    'book.pov': book.pov,
    'book.tense': book.tense,
    'book.language': book.language,
    [RESPONSE_LENGTH_VARIABLE]: book.responseLength ?? '',
  }
}

export function templateInterpolatesVariable(template: string, variableName: string) {
  const escaped = variableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`{{\\s*${escaped}\\s*}}`).test(template)
}

export function responseLengthMessage(template: string, responseLength: string) {
  const guidance = responseLength.trim()
  if (!guidance || templateInterpolatesVariable(template, RESPONSE_LENGTH_VARIABLE)) return ''
  return `# Response length\n\n${guidance}`
}

export function generationInstructionMessage(template: string, responseLength: string, instruction: string) {
  return [responseLengthMessage(template, responseLength), `# Instruction\n\n${instruction.trim()}`].filter(Boolean).join('\n\n')
}

export function renderPromptTemplate(template: string, values: Record<string, string>) {
  return renderCompositionTemplate(template, values).content
}

export function promptTemplateDiagnostics(
  template: string,
  scope: PromptScope,
  values?: Record<string, string>,
): PromptTemplateDiagnostic[] {
  return validatePromptTemplate({ template, variables: promptVariables, scope, values })
}

export function promptTemplateError(template: string, scope: PromptScope) {
  return promptTemplateDiagnostics(template, scope).find((diagnostic) => diagnostic.severity === 'error')
}

export function assertPromptTemplateValid(template: string, scope: PromptScope) {
  const diagnostic = promptTemplateError(template, scope)
  if (diagnostic) throw new Error(`Fix the invalid ${scope} prompt in Book AI settings: ${diagnostic.message}`)
}

export function promptVariableStability(name: string) {
  const canonical = canonicalVariableName(name)
  return promptVariables.find((variable) => variable.name === canonical)?.stability
}

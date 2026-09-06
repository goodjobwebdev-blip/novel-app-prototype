import type { ChatCompletionMessage, ChatToolDefinition } from './chat-api'
import { chatWorkspaceTools } from './chat-tools'
import { chatEntityTools } from './chat-entity-tools'
import { chatOutlineTools } from './chat-outline-tools'
import { bookTemplateValues, type BookPromptValues } from './prompt-template'
import {
  assembleCompositionRequest,
  assembleNormalizedRequest,
  clonePromptComposition,
  dedupeDynamicSources,
  normalizeRuntimeMessagePart,
  normalizeStructuredTools,
  normalizedRequestDiagnosticText,
  providerMessagesFromNormalized,
  type DynamicContextSource,
  type NormalizedAssembledRequest,
  type NormalizedRequestPart,
  type PromptComposition,
} from './prompt-composition'
import type { PreparedContextValues } from './context-service'
export { defaultChatPromptComposition } from './chat-default-composition'

export const CHAT_WORKSPACE_INSTRUCTIONS = `# Workspace tools

You can inspect and propose edits to Scenes, Notes, and Codex entries in this book. You can propose renaming the current Book, creating Notes and Codex entries, renaming or deleting Notes/Codex entries, and changing a Codex category. For the outline, use read_outline before structural changes; you may propose creating, renaming, moving/reordering, or deleting Acts, Chapters, and Scenes, and a newly created Scene may include initial Markdown content. Mutating tools only create approval proposals: never claim an edit, creation, rename, move, reorder, category change, or deletion happened until the user approves the card in Chat. Outline deletion is allowed only when the target and every descendant Scene have empty content. Search/read tools are read-only and can run automatically. Use search_entities and read_entity when a document target is not already known. For localized document changes, prefer propose_document_edit with exact old_text copied from read_entity. Use propose_document_replacement only for whole-document rewrites.`

export const CHAT_TOOL_DEFINITIONS = [...chatWorkspaceTools, ...chatEntityTools, ...chatOutlineTools]

export type ChatRequestHistoryItem = {
  id?: string
  role: 'user' | 'assistant'
  content: string
  thoughts?: string
  documentEdits?: Array<{ entityTitle: string; status: string }>
  codexCreations?: Array<{ title: string; status: string }>
  outlineActions?: Array<{ action: string; entityTitle: string; status: string }>
  entityActions?: Array<{ action: string; entityTitle: string; status: string }>
}

function stableProposalItems(items: string, statuses: string[]) {
  const statusPattern = new RegExp(`: (?:${statuses.join('|')})$`)
  return items.split('; ').map((item) => item.replace(statusPattern, '')).join('; ')
}

function stabilizeProposalHistory(content: string) {
  return content
    .replace(/\[Workspace edit proposals: ([^\]]*)\]/g, (_match, items: string) => `[Workspace edit proposals: ${stableProposalItems(items, ['proposed', 'applying', 'applied', 'rejected', 'stale'])}]`)
    .replace(/\[Codex creation proposals: ([^\]]*)\]/g, (_match, items: string) => `[Codex creation proposals: ${stableProposalItems(items, ['proposed', 'applying', 'created', 'rejected', 'duplicate', 'stale'])}]`)
    .replace(/\[Outline proposals: ([^\]]*)\]/g, (_match, items: string) => `[Outline proposals: ${stableProposalItems(items, ['proposed', 'applying', 'applied', 'rejected', 'stale'])}]`)
    .replace(/\[Entity proposals: ([^\]]*)\]/g, (_match, items: string) => `[Entity proposals: ${stableProposalItems(items, ['proposed', 'applying', 'applied', 'rejected', 'stale'])}]`)
}

export function chatHistoryContent(message: ChatRequestHistoryItem) {
  const editState = message.role === 'assistant' && message.documentEdits?.length
    ? `\n\n[Workspace edit proposals: ${message.documentEdits.map((proposal) => `${proposal.entityTitle}: ${proposal.status}`).join('; ')}]` : ''
  const creationState = message.role === 'assistant' && message.codexCreations?.length
    ? `\n\n[Codex creation proposals: ${message.codexCreations.map((proposal) => `${proposal.title}: ${proposal.status}`).join('; ')}]` : ''
  const outlineState = message.role === 'assistant' && message.outlineActions?.length
    ? `\n\n[Outline proposals: ${message.outlineActions.map((proposal) => `${proposal.action} ${proposal.entityTitle}: ${proposal.status}`).join('; ')}]` : ''
  const entityActionState = message.role === 'assistant' && message.entityActions?.length
    ? `\n\n[Entity proposals: ${message.entityActions.map((proposal) => `${proposal.action} ${proposal.entityTitle}: ${proposal.status}`).join('; ')}]` : ''
  return stabilizeProposalHistory(`${message.content}${editState}${creationState}${outlineState}${entityActionState}`)
}

function section(title: string, content: string) {
  return `## ${title}\n\n${content.trim()}`
}

function source(sourceId: string, title: string, content: string, reason: string): DynamicContextSource[] {
  return content.trim() ? [{ sourceId, title, representation: 'Full', content, reason }] : []
}

export function chatRequestValues(book: BookPromptValues, context: PreparedContextValues) {
  const bookValues = bookTemplateValues(book)
  delete bookValues['response.length']
  const storySoFar = context.summaryContext.trim()
  const currentScene = context.currentSceneText.trim()
  const previousScene = !currentScene ? context.previousSceneText.trim() : ''
  const automaticCodex = context.automaticCodexContext?.trim() ?? ''
  const automatic = [
    storySoFar ? section('Story so far', storySoFar) : '',
    currentScene ? section(`Current scene${context.currentSceneTitle ? ` — ${context.currentSceneTitle}` : ''}`, currentScene) : '',
    previousScene ? section(`Previous scene${context.previousSceneTitle ? ` — ${context.previousSceneTitle}` : ''}`, previousScene) : '',
    automaticCodex ? section('Automatic Codex', automaticCodex) : '',
  ].filter(Boolean).join('\n\n')
  return {
    ...bookValues,
    'scene.text': currentScene,
    'scene.previous_text': previousScene,
    'story.so_far': storySoFar,
    'context.automatic_codex': automaticCodex,
    'context.automatic': automatic,
    'context.additional': '',
    'chat.workspace_instructions': CHAT_WORKSPACE_INSTRUCTIONS,
  }
}

export function assembleChatGenerationRequest(input: {
  composition: PromptComposition
  book: BookPromptValues
  context: PreparedContextValues
  history: ChatRequestHistoryItem[]
  tools?: ChatToolDefinition[]
}): NormalizedAssembledRequest {
  const values = chatRequestValues(input.book, input.context)
  const storySources = input.context.storySoFarSources ?? []
  const sceneSources = input.context.currentSceneText.trim()
    ? source(input.context.currentSceneId || 'chat-current-scene', input.context.currentSceneTitle || 'Current scene', input.context.currentSceneText, 'Current Chat story anchor')
    : source(input.context.previousSceneId || 'chat-previous-scene', input.context.previousSceneTitle || 'Previous scene', input.context.previousSceneText, 'Previous-Scene fallback for empty Chat anchor')
  const automaticSources = [...storySources, ...sceneSources, ...(input.context.automaticSources ?? [])]
  const dedupe = dedupeDynamicSources(automaticSources, input.context.additionalSources ?? [])
  values['context.additional'] = dedupe.additional.map((item) => item.content.trim()).filter(Boolean).join('\n\n')
  const latestUserIndex = input.history.at(-1)?.role === 'user' ? input.history.length - 1 : -1
  const historyParts = input.history.map((message, index) => normalizeRuntimeMessagePart({
    id: message.id || `chat-history-${index + 1}`,
    sourceKind: index === latestUserIndex ? 'current-turn' : 'history',
    sourceId: message.id,
    name: index === latestUserIndex ? 'Current user turn' : `${message.role === 'user' ? 'User' : 'Assistant'} history`,
    ownership: index === latestUserIndex ? 'current-turn' : 'conversation',
    message: {
      role: message.role,
      content: chatHistoryContent(message),
      ...(message.role === 'assistant' && message.thoughts ? { reasoning_content: message.thoughts } : {}),
    },
  }))
  return assembleCompositionRequest({
    composition: clonePromptComposition(input.composition),
    values,
    dynamicSources: {
      'story.so_far': storySources,
      'scene.text': input.context.currentSceneText.trim() ? sceneSources : [],
      'scene.previous_text': input.context.currentSceneText.trim() ? [] : sceneSources,
      'context.automatic_codex': input.context.automaticSources ?? [],
      'context.automatic': dedupe.automatic,
      'context.additional': dedupe.additional,
    },
    after: historyParts,
    structuredParts: [normalizeStructuredTools((input.tools ?? CHAT_TOOL_DEFINITIONS) as unknown as Array<Record<string, unknown>>)],
    dynamicSourceDedupe: dedupe.decisions,
  })
}

export function appendChatRuntimeMessages(base: NormalizedAssembledRequest, runtimeParts: NormalizedRequestPart[]) {
  return assembleNormalizedRequest([...base.parts, ...runtimeParts], {
    structuredParts: base.structuredParts,
    dynamicSourceDedupe: base.dynamicSourceDedupe,
  })
}

export function chatWorkspaceInstructionsWarning(composition: PromptComposition) {
  const templates = [composition.systemPrompt, ...composition.predefinedMessages.filter((message) => message.enabled).map((message) => message.template)]
  return templates.some((template) => /{{\s*chat\.workspace_instructions\s*}}/.test(template))
    ? ''
    : 'Workspace tools are enabled, but their Arc instructions are not included in this Chat composition.'
}

export function serializeChatModelInput(request: NormalizedAssembledRequest) {
  return normalizedRequestDiagnosticText(request)
}

export function chatProviderMessages(request: NormalizedAssembledRequest): ChatCompletionMessage[] {
  return providerMessagesFromNormalized(request) as ChatCompletionMessage[]
}

export function chatProviderTools(request: NormalizedAssembledRequest): ChatToolDefinition[] {
  return request.providerTools as unknown as ChatToolDefinition[]
}

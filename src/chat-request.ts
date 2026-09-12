import type { CharacterBoundary } from './character-chat'
import { loreTypesForTools, type LoreType } from './lore-types'
import { chatSkillParts, type CapturedChatSkill } from './chat-skills'
import { brainstormTools } from './chat-brainstorm'
import { projectProse } from './document-projection'
import type { ProposalDraft } from './chat-proposal-draft'
import { chatImageTools } from './image-tools'
import { imageModelInstructions } from './image-settings'
import type { ChatToolDefinition } from './chat-api'
import { chatWorkspaceTools } from './chat-tools'
import { chatEntityTools } from './chat-entity-tools'
import { chatOutlineTools } from './chat-outline-tools'
import { chatManagementTools } from './chat-management-tools'
import { bookTemplateValues, type BookPromptValues } from './prompt-template'
import {
  assembleCompositionRequest,
  assembleNormalizedRequest,
  clonePromptComposition,
  dedupeDynamicSources,
  normalizeRuntimeMessagePart,
  normalizeAppManagedPart,
  normalizeStructuredTools,
  type DynamicContextSource,
  type NormalizedAssembledRequest,
  type NormalizedRequestPart,
  type PromptComposition,
} from './prompt-composition'
import type { PreparedContextValues } from './context-service'
export { defaultChatPromptComposition } from './chat-default-composition'
export { finalizeChatProviderRequest, type FinalizedChatProviderRequest } from './chat-finalized-request'

export const CHAT_WORKSPACE_INSTRUCTIONS = `# Workspace tools

You can inspect and propose edits to Scenes, Notes, and Codex entries in this book. You can propose renaming the current Book, creating Notes and Codex entries, renaming or deleting Notes/Codex entries, and changing a Codex category. For the outline, use read_outline before structural changes; you may propose creating, renaming, moving/reordering, or deleting Acts, Chapters, and Scenes, and a newly created Scene may include initial Markdown content. Mutating tools only create approval proposals: never claim an edit, creation, rename, move, reorder, category change, or deletion happened until the user approves the card in Chat. Outline deletion is allowed only when the target and every descendant Scene have empty content. Search/read tools are read-only and can run automatically. Use search_entities and read_entity when a document target is not already known. Use read_book_metadata before proposing any Book metadata changes; it also lists valid Series IDs. Use list_entities for browsing and search_entities for text search; follow next_offset to retrieve additional pages. Use read_codex_settings before proposing directional dependency or trigger changes. Use read_summary to inspect stored summaries and freshness. propose_summary_regeneration creates an approval card; after approval Arc runs the existing summarize workflow with the Book’s selected Support model, summary prompt, response length and hierarchical source selection. Notes and Books do not support summaries. Never write a replacement summary yourself in place of this workflow. For localized document changes, prefer propose_document_edit with exact old_text copied from read_entity. Use propose_document_replacement only for whole-document rewrites.`

export const CHAT_TOOL_DEFINITIONS = [...chatWorkspaceTools, ...chatEntityTools, ...chatOutlineTools, ...chatManagementTools, ...chatImageTools, ...brainstormTools]

export type ChatRequestHistoryItem = {
  id?: string
  characterBoundary?: CharacterBoundary
  role: 'user' | 'assistant'
  content: string
  thoughts?: string
  imageGenerations?: Array<{ prompt: string; status: string; modelAlias: string; size: string; task?: string }>
  documentEdits?: Array<ProposalDraft & { entityTitle: string; status: string }>
  codexCreations?: Array<ProposalDraft & { title: string; status: string }>
  outlineActions?: Array<ProposalDraft & { action: string; entityTitle: string; status: string }>
  entityActions?: Array<ProposalDraft & { action: string; entityTitle: string; status: string }>
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
  const imageState = message.imageGenerations?.length ? `\n\n[Visual proposals (generation requires user action): ${JSON.stringify(message.imageGenerations.map((proposal) => ({ prompt: proposal.prompt, status: proposal.status, modelAlias: proposal.modelAlias, size: proposal.size, task: proposal.task ?? 'text-to-image' })))}]` : ''
  const edited = [...(message.documentEdits ?? []), ...(message.codexCreations ?? []), ...(message.outlineActions ?? []), ...(message.entityActions ?? [])]
    .filter(proposal => proposal.editedValues).map(proposal => ({ status: proposal.status, values: Object.fromEntries(Object.entries(proposal.editedValues!).map(([key, value]) => [key, projectProse(value).text])) }))
  const editedState = edited.length ? `\n\n[User-edited proposal values (only applied/created statuses changed the workspace): ${JSON.stringify(edited)}]` : ''
  return editedState + stabilizeProposalHistory(`${imageState}${message.content}${editState}${creationState}${outlineState}${entityActionState}`)
}

function section(title: string, content: string) {
  return `## ${title}\n\n${content.trim()}`
}

function source(sourceId: string, title: string, content: string, reason: string): DynamicContextSource[] {
  return content.trim() ? [{ sourceId, title, representation: 'Full', content, reason }] : []
}

export const emptyCharacterBook: BookPromptValues = { title: '', series: '', seriesOrder: '', overview: '', genre: '', style: '', pov: '', tense: '', language: '' }
export function chatRequestValues(book: BookPromptValues, context: PreparedContextValues, restrictedInstructions?: string) {
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
    'chat.workspace_instructions': restrictedInstructions ?? CHAT_WORKSPACE_INSTRUCTIONS + imageModelInstructions(),
  }
}

export function assembleChatGenerationRequest(input: {
  restrictedInstructions?: string
  composition: PromptComposition
  book: BookPromptValues
  context: PreparedContextValues
  history: ChatRequestHistoryItem[]
  loreTypes?: LoreType[]
  skills?: CapturedChatSkill[]
  tools?: ChatToolDefinition[]
}): NormalizedAssembledRequest {
  const values = chatRequestValues(input.restrictedInstructions ? emptyCharacterBook : input.book, input.context, input.restrictedInstructions)
  if (input.restrictedInstructions) values['chat.workspace_instructions'] = input.restrictedInstructions
  const storySources = input.context.storySoFarSources ?? []
  const sceneSources = input.context.currentSceneText.trim()
    ? source(input.context.currentSceneId || 'chat-current-scene', input.context.currentSceneTitle || 'Current scene', input.context.currentSceneText, 'Current Chat story anchor')
    : source(input.context.previousSceneId || 'chat-previous-scene', input.context.previousSceneTitle || 'Previous scene', input.context.previousSceneText, 'Previous-Scene fallback for empty Chat anchor')
  const automaticSources = [...storySources, ...sceneSources, ...(input.context.automaticSources ?? [])]
  const skillIds = new Set(input.skills?.map(skill => skill.id) ?? [])
  const dedupe = dedupeDynamicSources(automaticSources, (input.context.additionalSources ?? []).filter(item => !skillIds.has(item.sourceId)))
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
  const assembled = assembleCompositionRequest({
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
    after: [
      ...(input.restrictedInstructions ? [normalizeAppManagedPart({ id: 'character-boundary', role: 'system', sourceKind: 'app-managed', sourceId: 'character-boundary', name: 'Character context boundary', ownership: 'app-managed', content: input.restrictedInstructions })] : []),
      ...chatSkillParts(input.restrictedInstructions ? [] : input.skills),
      ...(!input.restrictedInstructions && input.context.sceneBeats?.length ? [normalizeAppManagedPart({ id: 'scene-planning-beats', role: 'system', sourceKind: 'app-managed', sourceId: input.context.currentSceneId, name: 'Scene planning beats', ownership: 'app-managed', content: `Planning only, distinct from manuscript facts. Use propose_scene_beat to suggest changes; approval is required.\n${JSON.stringify(input.context.sceneBeats)}` })] : []),
      ...historyParts,
    ],
    structuredParts: [normalizeStructuredTools(loreTypesForTools(input.tools ?? CHAT_TOOL_DEFINITIONS, input.loreTypes) as unknown as Array<Record<string, unknown>>)],
    dynamicSourceDedupe: dedupe.decisions,
  })
  if (!input.restrictedInstructions || !input.context.requiredCharacterSources?.length) return assembled
  const represented = new Set(assembled.parts.filter(part => !part.omitted).flatMap(part => part.dynamicVariables?.flatMap(variable => variable.sources.map(item => item.sourceId)) ?? []))
  const required = new Map(input.context.requiredCharacterSources.map(item => [item.sourceId, item]))
  // Older or customized prompts may omit context variables. Keep participant knowledge
  // and explicitly pinned references present without duplicating sources already rendered.
  const missing = [...required.values()].filter(item => !represented.has(item.sourceId)).map(item => normalizeAppManagedPart({
    id: `character-reference-${item.sourceId}`, sourceId: item.sourceId, role: 'system', sourceKind: 'app-managed', ownership: 'app-managed',
    name: `Character reference: ${item.title || item.sourceId}`, content: item.content,
    dynamicVariables: [{ variable: 'context.character_references', sources: [item] }],
  }))
  if (!missing.length) return assembled
  const firstHistory = assembled.parts.findIndex(part => part.sourceKind === 'history' || part.sourceKind === 'current-turn')
  const index = firstHistory < 0 ? assembled.parts.length : firstHistory
  return assembleNormalizedRequest([...assembled.parts.slice(0, index), ...missing, ...assembled.parts.slice(index)], { structuredParts: assembled.structuredParts, dynamicSourceDedupe: assembled.dynamicSourceDedupe })
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


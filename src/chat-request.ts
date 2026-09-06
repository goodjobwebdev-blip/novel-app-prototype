import { chatWorkspaceTools } from './chat-tools'
import { chatEntityTools } from './chat-entity-tools'
import { chatOutlineTools } from './chat-outline-tools'
import { assembleCompositionRequest, normalizeAppManagedPart, normalizedRequestDiagnosticText, normalizeRuntimeMessagePart, normalizeStructuredTools, type NormalizedAssembledRequest } from './prompt-composition'
import { bookTemplateValues, type BookPromptValues } from './prompt-template'
import type { PreparedContextValues } from './context-service'
import { sharedGenerationContext } from './scope-request'

export const CHAT_WORKSPACE_INSTRUCTIONS = `# Workspace tools

You can inspect and propose edits to Scenes, Notes, and Codex entries in this book. You can propose renaming the current Book, creating Notes and Codex entries, renaming or deleting Notes/Codex entries, and changing a Codex category. For the outline, use read_outline before structural changes; you may propose creating, renaming, moving/reordering, or deleting Acts, Chapters, and Scenes, and a newly created Scene may include initial Markdown content. Mutating tools only create approval proposals: never claim an edit, creation, rename, move, reorder, category change, or deletion happened until the user approves the card in Chat. Outline deletion is allowed only when the target and every descendant Scene have empty content. Search/read tools are read-only and can run automatically. Use search_entities and read_entity when a document target is not already known. For localized document changes, prefer propose_document_edit with exact old_text copied from read_entity. Use propose_document_replacement only for whole-document rewrites.`

export const CHAT_TOOL_DEFINITIONS = [...chatWorkspaceTools, ...chatEntityTools, ...chatOutlineTools]

export type ChatCompositionHistoryItem = {
  id?: string
  role: 'user' | 'assistant'
  content: string
  thoughts?: string
}

export function assembleChatRequest(input: {
  systemPrompt: string
  book: BookPromptValues
  context: PreparedContextValues
  history: ChatCompositionHistoryItem[]
}): NormalizedAssembledRequest {
  let latestUserIndex = -1
  input.history.forEach((message, index) => { if (message.role === 'user') latestUserIndex = index })
  const context = sharedGenerationContext(input.context)
  return assembleCompositionRequest({
    composition: { systemPrompt: input.systemPrompt, predefinedMessages: [] },
    values: {
      ...bookTemplateValues(input.book),
      ...context.values,
      'scene.text': input.context.lastSceneText,
      'scene.previous_text': '',
      'story.so_far': input.context.summaryContext,
    },
    dynamicSources: context.dynamicSources,
    dynamicSourceDedupe: context.dynamicSourceDedupe,
    structuredParts: [normalizeStructuredTools(CHAT_TOOL_DEFINITIONS.map((tool) => ({ ...tool, function: { ...tool.function } })))],
    after: [
      normalizeAppManagedPart({
        id: 'chat-workspace-instructions',
        role: 'system',
        sourceKind: 'app-managed',
        sourceId: 'chat-workspace-instructions',
        name: 'Workspace instructions',
        ownership: 'app-managed',
        content: CHAT_WORKSPACE_INSTRUCTIONS,
      }),
      ...input.history.map((message, index) => normalizeRuntimeMessagePart({
        id: `chat-${message.id ?? index}`,
        sourceKind: index === latestUserIndex ? 'current-turn' : 'history',
        sourceId: message.id ?? `history-${index}`,
        name: message.role === 'user' ? 'User message' : 'Assistant message',
        ownership: index === latestUserIndex ? 'current-turn' : 'conversation',
        message: {
          role: message.role,
          content: message.content,
          ...(message.role === 'assistant' && message.thoughts ? { reasoning_content: message.thoughts } : {}),
        },
      })),
    ],
  })
}

export function serializeChatModelInput(request: NormalizedAssembledRequest) {
  return normalizedRequestDiagnosticText(request)
}

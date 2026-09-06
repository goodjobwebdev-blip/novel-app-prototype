import type { ChatCompletionMessage } from './chat-api'
import { chatWorkspaceTools } from './chat-tools'
import { chatEntityTools } from './chat-entity-tools'
import { chatOutlineTools } from './chat-outline-tools'

export const CHAT_WORKSPACE_INSTRUCTIONS = `# Workspace tools

You can inspect and propose edits to Scenes, Notes, and Codex entries in this book. You can propose renaming the current Book, creating Notes and Codex entries, renaming or deleting Notes/Codex entries, and changing a Codex category. For the outline, use read_outline before structural changes; you may propose creating, renaming, moving/reordering, or deleting Acts, Chapters, and Scenes, and a newly created Scene may include initial Markdown content. Mutating tools only create approval proposals: never claim an edit, creation, rename, move, reorder, category change, or deletion happened until the user approves the card in Chat. Outline deletion is allowed only when the target and every descendant Scene have empty content. Search/read tools are read-only and can run automatically. Use search_entities and read_entity when a document target is not already known. For localized document changes, prefer propose_document_edit with exact old_text copied from read_entity. Use propose_document_replacement only for whole-document rewrites.`

export const CHAT_TOOL_DEFINITIONS = [...chatWorkspaceTools, ...chatEntityTools, ...chatOutlineTools]

export function serializeChatModelInput(messages: ChatCompletionMessage[]) {
  return JSON.stringify({ messages, tools: CHAT_TOOL_DEFINITIONS })
}

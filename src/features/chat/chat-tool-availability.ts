import { CHAT_TOOL_DEFINITIONS, type ChatRequestHistoryItem } from './chat-request'
import { characterReadTools } from './character-chat'
import { chatImageTools } from '../images/image-tools'
import { directImageTools, explicitlyRequestsImage } from './chat-direct-images'
export function availableChatTools(character: boolean, history: ChatRequestHistoryItem[], ownerKind: 'book' | 'world' = 'book') {
  const current = history.at(-1)
  const worldTools = new Set(['search_entities', 'read_entity', 'propose_codex_entry', 'propose_document_edit', 'propose_document_replacement', 'present_brainstorm'])
  const tools = [...(character ? [...characterReadTools, ...chatImageTools] : CHAT_TOOL_DEFINITIONS), ...(current?.role === 'user' && explicitlyRequestsImage(current.content) ? directImageTools : [])]
  return ownerKind === 'world' ? tools.filter(tool => worldTools.has(tool.function.name)) : tools
}

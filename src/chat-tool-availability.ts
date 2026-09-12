import { CHAT_TOOL_DEFINITIONS, type ChatRequestHistoryItem } from './chat-request'
import { characterReadTools } from './character-chat'
import { chatImageTools } from './image-tools'
import { directImageTools, explicitlyRequestsImage } from './chat-direct-images'
export function availableChatTools(character: boolean, history: ChatRequestHistoryItem[]) {
  const current = history.at(-1)
  return [...(character ? [...characterReadTools, ...chatImageTools] : CHAT_TOOL_DEFINITIONS), ...(current?.role === 'user' && explicitlyRequestsImage(current.content) ? directImageTools : [])]
}

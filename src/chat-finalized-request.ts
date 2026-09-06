import type { ChatCompletionMessage, ChatToolDefinition } from './chat-api.ts'
import type { NormalizedAssembledRequest } from './prompt-composition.ts'

export type FinalizedChatProviderRequest = {
  messages: ChatCompletionMessage[]
  tools: ChatToolDefinition[]
  diagnosticText: string
}

/**
 * Freeze the semantic Chat request at the boundary shared by diagnostics,
 * preview, and transport. Nothing downstream may reorder or rewrite it.
 */
export function finalizeChatProviderRequest(request: NormalizedAssembledRequest): FinalizedChatProviderRequest {
  const messages = structuredClone(request.providerMessages) as ChatCompletionMessage[]
  const tools = structuredClone(request.providerTools) as unknown as ChatToolDefinition[]
  return {
    messages,
    tools,
    diagnosticText: JSON.stringify({ messages, ...(tools.length ? { tools } : {}) }),
  }
}

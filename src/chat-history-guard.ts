export type ChatHistoryGuardMessage = {
  id: string
  order: number
  role: string
  content: string
  thoughts?: string
}

function stableHistoryMessage(message: ChatHistoryGuardMessage) {
  return {
    id: message.id,
    order: message.order,
    role: message.role,
    content: message.content,
    thoughts: message.thoughts ?? '',
  }
}

export function chatHistoryPrefixMatches(expected: ChatHistoryGuardMessage[], current: ChatHistoryGuardMessage[]) {
  if (current.length < expected.length) return false
  for (let index = 0; index < expected.length; index += 1) {
    if (JSON.stringify(stableHistoryMessage(expected[index])) !== JSON.stringify(stableHistoryMessage(current[index]))) return false
  }
  return true
}

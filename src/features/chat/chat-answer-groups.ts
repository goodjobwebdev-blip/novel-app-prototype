import type { ChatMessageEntity } from './chat-service'

export type ChatAnswerGroup = { id: string; role: 'user' | 'assistant'; messages: ChatMessageEntity[] }

/** A presentation projection only: persisted rounds retain their original order and IDs. */
export function groupChatAnswers(messages: ChatMessageEntity[]): ChatAnswerGroup[] {
  const groups: ChatAnswerGroup[] = []
  for (const message of messages) {
    const previous = groups.at(-1)
    const previousRound = previous?.messages.at(-1)
    const sameResponse = message.responseId && previousRound?.responseId
      ? message.responseId === previousRound.responseId
      : !message.responseId && !previousRound?.responseId
    if (message.role === 'assistant' && previous?.role === 'assistant' && sameResponse) previous.messages.push(message)
    else groups.push({ id: message.id, role: message.role, messages: [message] })
  }
  return groups
}

export function answerProse(messages: ChatMessageEntity[]) {
  return messages.map(message => message.content.trim()).filter(Boolean).join('\n\n')
}

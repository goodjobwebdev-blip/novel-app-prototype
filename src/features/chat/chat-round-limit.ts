export const DEFAULT_CHAT_ROUNDS = 8
export function normalizeChatRoundLimit(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 32 ? value : DEFAULT_CHAT_ROUNDS
}
export function validateChatRoundLimit(value: unknown): number {
  if (normalizeChatRoundLimit(value) !== value) throw new Error('Choose a whole number of model rounds from 1 to 32.')
  return value as number
}
/** Capture the cap once; each yielded index permits exactly one model request. */
export function* boundedChatRounds(value: unknown, signal: AbortSignal) {
  const limit = normalizeChatRoundLimit(value)
  for (let round = 0; round < limit && !signal.aborted; round += 1) yield round
}

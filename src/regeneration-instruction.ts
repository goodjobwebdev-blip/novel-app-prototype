import type { NormalizedProviderMessage } from './prompt-composition.ts'

/** Story and Codex assemblers always append the current instruction as the last user message. */
export function replaceGenerationInstruction(
  messages: NormalizedProviderMessage[] | undefined,
  instruction: string,
  fallback: string,
): NormalizedProviderMessage[] {
  if (!messages?.length || messages.at(-1)?.role !== 'user') {
    throw new Error('The saved generation request is missing its instruction. Generate a new passage first.')
  }
  const next = structuredClone(messages)
  next[next.length - 1].content = instruction.trim() || fallback
  return next
}

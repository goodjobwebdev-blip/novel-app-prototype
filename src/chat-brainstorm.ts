import type { ChatToolCall, ChatToolDefinition } from './chat-api'

export type BrainstormOption = { id: string; title: string; description: string; tradeOff?: string }
export type ChatBrainstorm = { id: string; topic: string; options: BrainstormOption[]; selectedIds: string[]; customOption: string; revision: number; submittedText?: string }
export const brainstormTools: ChatToolDefinition[] = [{ type: 'function', function: {
  name: 'present_brainstorm', description: 'Present 2–8 ideas for the writer to compare, edit, and select. Presentation only: no workspace mutation or automatic message. The writer explicitly sends selected ideas to continue.',
  parameters: { type: 'object', properties: { topic: { type: 'string' }, options: { type: 'array', minItems: 2, maxItems: 8, items: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, trade_off: { type: 'string' } }, required: ['title', 'description'], additionalProperties: false } } }, required: ['topic', 'options'], additionalProperties: false },
} }]
function text(value: unknown, label: string, max = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label} must contain 1–${max} characters.`)
  return value.trim()
}
export function executeBrainstormTool(call: ChatToolCall): { content: string; brainstorm?: ChatBrainstorm } {
  try {
    const args = JSON.parse(call.function.arguments)
    const topic = text(args.topic, 'Topic', 300)
    if (!Array.isArray(args.options) || args.options.length < 2 || args.options.length > 8) throw new Error('Provide 2–8 options.')
    const brainstorm: ChatBrainstorm = { id: `brainstorm-${crypto.randomUUID()}`, topic, options: args.options.map((option: Record<string, unknown>) => ({ id: `option-${crypto.randomUUID()}`, title: text(option.title, 'Title', 200), description: text(option.description, 'Description'), ...(option.trade_off === undefined ? {} : { tradeOff: text(option.trade_off, 'Trade-off', 1000) }) })), selectedIds: [], customOption: '', revision: 0 }
    return { content: JSON.stringify({ ok: true, message: 'Options displayed. No choice has been submitted and no workspace content was changed.', brainstorm }), brainstorm }
  } catch (reason) { return { content: JSON.stringify({ ok: false, error: reason instanceof Error ? reason.message : 'Invalid brainstorm. Present readable options in your answer.' }) } }
}
export function brainstormSelectionText(value: ChatBrainstorm) {
  const selected = value.options.filter(option => value.selectedIds.includes(option.id))
  const items = selected.map(option => `${option.title}\n${option.description}${option.tradeOff ? `\nTrade-off: ${option.tradeOff}` : ''}`)
  if (value.customOption.trim()) items.push(value.customOption.trim())
  return items.length ? `For “${value.topic}”, I choose:\n\n${items.join('\n\n')}\n\nHelp me develop these choices.` : ''
}
export function brainstormMoreText(value: ChatBrainstorm) {
  return `Suggest different options for “${value.topic}”. Keep the earlier options available and use present_brainstorm for 2–8 new ideas. Earlier options:\n${value.options.map(option => `${option.title}: ${option.description}`).join('\n')}`
}
export function updateBrainstormDraft(current: ChatBrainstorm, next: ChatBrainstorm) {
  if (current.id !== next.id || current.topic !== next.topic || current.revision !== next.revision || current.options.length !== next.options.length || current.options.some((option, index) => option.id !== next.options[index]?.id)) throw new Error('This brainstorm changed elsewhere. Reopen it before editing.')
  const options = next.options.map(option => ({ id: option.id, title: text(option.title, 'Title', 200), description: text(option.description, 'Description'), ...(option.tradeOff?.trim() ? { tradeOff: text(option.tradeOff, 'Trade-off', 1000) } : {}) }))
  if (!Array.isArray(next.selectedIds) || next.selectedIds.some(id => !options.some(option => option.id === id)) || typeof next.customOption !== 'string' || next.customOption.length > 4000) throw new Error('Invalid selection or custom option.')
  return { ...current, options, selectedIds: [...new Set(next.selectedIds)], customOption: next.customOption, revision: current.revision + 1 }
}

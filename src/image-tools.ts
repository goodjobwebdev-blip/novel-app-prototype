import type { ChatToolDefinition, ChatToolCall } from './chat-api'
import type { ChatImageProposal } from './image-generation-types'
import { resolveImageSpec } from './image-settings'
export const chatImageTools: ChatToolDefinition[] = [{ type: 'function', function: {
  name: 'propose_image_generation', description: 'Propose a text-to-image generation. This creates an editable approval card only; it never contacts an image provider or charges money. Use only configured favorite aliases and enabled sizes. The user must accept the proposal and press Generate.',
  parameters: { type: 'object', properties: { prompt: { type: 'string', description: 'Complete image prompt.' }, ratio: { type: 'string', description: 'Optional aspect ratio, e.g. 1:1. Must match an enabled size.' }, size: { type: 'string', description: 'Optional exact enabled dimensions, e.g. 1024x1024.' }, model_alias: { type: 'string', description: 'Optional configured favorite image model alias.' } }, required: ['prompt'], additionalProperties: false },
} }]
export function executeImageProposal(call: ChatToolCall): { content: string; imageGeneration?: ChatImageProposal } {
  try {
    const args = JSON.parse(call.function.arguments)
    if (typeof args.prompt !== 'string' || ['ratio', 'size', 'model_alias'].some((key) => args[key] !== undefined && typeof args[key] !== 'string')) throw new Error('Provide a prompt and optional string ratio, size, and model_alias.')
    const spec = resolveImageSpec(args.prompt, args.model_alias, args.size, args.ratio)
    const proposal: ChatImageProposal = { id: `image-proposal-${crypto.randomUUID()}`, prompt: spec.prompt, modelAlias: spec.modelAlias, size: spec.size.value, status: 'proposed', createdAt: Date.now() }
    return { imageGeneration: proposal, content: JSON.stringify({ ok: true, proposalId: proposal.id, message: 'Image proposal created. No image has been generated. The user must accept the proposal, then press Generate.' }) }
  } catch (error) { return { content: JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Invalid image proposal.' }) } }
}

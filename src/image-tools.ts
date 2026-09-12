import type { ChatToolDefinition, ChatToolCall } from './chat-api'
import type { ChatImageProposal, GenerationSource, GenerationTask } from './image-generation-types'
import { generationTaskNames, resolveImageSpec } from './image-settings'
export const chatImageTools: ChatToolDefinition[] = [{ type: 'function', function: {
  name: 'propose_image_generation', description: 'Propose text-to-image, image-to-image, text-to-video, or image-to-video generation. This creates an editable approval card only; it never contacts a provider or charges money. Source images are selected by the user in the card. Use only configured favorite aliases and capabilities. The user must press Generate to approve the shown draft and queue a request.',
  parameters: { type: 'object', properties: { prompt: { type: 'string', description: 'Complete visual prompt.' }, task: { type: 'string', enum: ['text-to-image', 'image-to-image', 'text-to-video', 'image-to-video'], description: 'Generation task. Defaults to text-to-image.' }, ratio: { type: 'string', description: 'Optional aspect ratio, e.g. 1:1. Must match an enabled size.' }, size: { type: 'string', description: 'Optional exact enabled dimensions, e.g. 1024x1024.' }, model_alias: { type: 'string', description: 'Optional configured favorite model alias.' } }, required: ['prompt'], additionalProperties: false },
} }]
export function executeImageProposal(call: ChatToolCall): { content: string; imageGeneration?: ChatImageProposal } {
  try {
    const args = JSON.parse(call.function.arguments)
    if (typeof args.prompt !== 'string' || ['task', 'ratio', 'size', 'model_alias'].some((key) => args[key] !== undefined && typeof args[key] !== 'string')) throw new Error('Provide a prompt and optional string task, ratio, size, and model_alias.')
    const task: GenerationTask = args.task ?? 'text-to-image'
    if (!Object.hasOwn(generationTaskNames, task)) throw new Error('Choose a supported visual generation task.')
    const placeholder: GenerationSource[] = task.startsWith('image-to-') ? [{ id: 'proposal-source', mime: 'image/png', data: new Blob(), width: 1, height: 1 }] : []
    const spec = resolveImageSpec(args.prompt, args.model_alias, args.size, args.ratio, undefined, task, placeholder)
    const proposal: ChatImageProposal = { id: `image-proposal-${crypto.randomUUID()}`, prompt: spec.prompt, modelAlias: spec.modelAlias, size: spec.size.value, task, status: 'proposed', createdAt: Date.now() }
    return { imageGeneration: proposal, content: JSON.stringify({ ok: true, proposalId: proposal.id, task, message: 'Visual proposal created. No media has been generated. The user must press Generate to approve the draft and queue a request.' }) }
  } catch (error) { return { content: JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Invalid image proposal.' }) } }
}

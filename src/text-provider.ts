import type { AiProvider } from './ai-settings'
import { FAKE_PROVIDER_MODEL, streamFakeProvider, type FakeProviderMessage } from './fake-provider'
import {
  fetchNanoGPTModelContextLength,
  nanoGPTCompletionMessages,
  streamNanoGPTCompletion,
  type NanoGPTGenerationRequest,
  type NanoGPTStreamLifecycle,
} from './nanogpt'

export type TextProviderTask = 'story' | 'codex' | 'summary' | 'autotitle'
export type TextProviderGenerationRequest = NanoGPTGenerationRequest & {
  provider: AiProvider
  task: TextProviderTask
  thinking?: boolean
}

function fakeMessages(request: Pick<TextProviderGenerationRequest, 'systemPrompt' | 'contextMessage' | 'userMessage' | 'messages'>): FakeProviderMessage[] {
  return nanoGPTCompletionMessages(request).map((message) => ({
    role: message.role,
    content: message.content,
  }))
}

export function textProviderMessages(request: Pick<TextProviderGenerationRequest, 'systemPrompt' | 'contextMessage' | 'userMessage' | 'messages'>) {
  return fakeMessages(request)
}

export function textProviderRequestText(request: Pick<TextProviderGenerationRequest, 'systemPrompt' | 'contextMessage' | 'userMessage' | 'messages'>) {
  return JSON.stringify({ messages: textProviderMessages(request) })
}

export async function fetchTextProviderModelContextLength(request: Pick<TextProviderGenerationRequest, 'provider' | 'apiKey' | 'baseUrl' | 'model'>) {
  if (request.provider === 'fake') return request.model === FAKE_PROVIDER_MODEL.id ? FAKE_PROVIDER_MODEL.context_length : undefined
  if (request.provider !== 'nanogpt') return undefined
  return fetchNanoGPTModelContextLength(request.apiKey, request.baseUrl, request.model)
}

export async function streamTextProviderCompletion(
  request: TextProviderGenerationRequest,
  onChunk: (text: string) => void,
  signal: AbortSignal,
  lifecycle: NanoGPTStreamLifecycle = {},
) {
  if (request.provider === 'fake') {
    return streamFakeProvider({
      task: request.task,
      model: request.model,
      messages: textProviderMessages(request),
      thinking: request.thinking === true,
    }, {
      onResponse: lifecycle.onResponse,
      onContent: onChunk,
      onThoughts: lifecycle.onThoughts,
    }, signal)
  }
  if (request.provider !== 'nanogpt') {
    throw new Error('Text generation currently supports NanoGPT or Fake (testing) only.')
  }
  await streamNanoGPTCompletion(request, onChunk, signal, lifecycle)
  return { toolCalls: [], finishReason: 'stop' as const }
}

import type { AiProvider } from './ai-settings'
import { FAKE_PROVIDER_MODEL, streamFakeProvider, type FakeProviderMessage } from './fake-provider'
import { streamChatCompletion, type ChatCompletionMessage } from '../../features/chat/chat-api'
import {
  fetchNanoGPTModelContextLength,
  nanoGPTCompletionMessages,
  streamNanoGPTCompletion,
  type NanoGPTGenerationRequest,
  type NanoGPTStreamLifecycle,
} from './nanogpt'

export type TextProviderTask = 'story' | 'codex' | 'summary' | 'autotitle' | 'autocomplete'
export type TextProviderGenerationRequest = NanoGPTGenerationRequest & {
  provider: AiProvider
  task: TextProviderTask
  thinking?: boolean
}

function fakeMessages(request: Pick<TextProviderGenerationRequest, 'systemPrompt' | 'contextMessage' | 'userMessage' | 'messages'>): FakeProviderMessage[] {
  return nanoGPTCompletionMessages(request).map((message) => ({
    ...message,
    ...(message.tool_calls ? { tool_calls: message.tool_calls.map((call) => ({ ...call, function: { ...call.function } })) } : {}),
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
      thinking: request.thinking === true || (request.thinkingEffort !== undefined && request.thinkingEffort !== 'default'),
      thinkingEffort: request.thinkingEffort,
      maxTokens: request.maxTokens,
    }, {
      onResponse: lifecycle.onResponse,
      onContent: onChunk,
      onThoughts: lifecycle.onThoughts,
    }, signal)
  }
  const requireComplete = request.task === 'autocomplete'
  if (request.provider === 'nanogpt') {
    const metadata = await streamNanoGPTCompletion({ ...request, requireComplete }, onChunk, signal, lifecycle)
    return { toolCalls: [], finishReason: requireComplete ? metadata.finishReason : 'stop' }
  }
  if (request.provider === 'litellm') {
    return streamChatCompletion({
      apiKey: request.apiKey,
      baseUrl: request.baseUrl,
      provider: request.provider,
      requireComplete,
      model: request.model,
      messages: textProviderMessages(request) as ChatCompletionMessage[],
      thinking: request.thinking === true || (request.thinkingEffort !== undefined && request.thinkingEffort !== 'default'),
      thinkingEffort: request.thinkingEffort,
      maxTokens: request.maxTokens,
    }, (chunk) => {
      if (chunk.thoughts) lifecycle.onThoughts?.(chunk.thoughts)
      if (chunk.content) onChunk(chunk.content)
    }, signal, lifecycle.onResponse)
  }
  throw new Error('Text generation currently supports NanoGPT, LiteLLM, or Fake (testing) only.')
}

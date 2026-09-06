import type { AiProvider } from './ai-settings'
import { FAKE_PROVIDER_MODEL, streamFakeProvider, type FakeProviderMessage } from './fake-provider'
import {
  fetchNanoGPTModelContextLength,
  streamNanoGPTCompletion,
  type NanoGPTStreamLifecycle,
} from './nanogpt'
import { normalizedRequestDiagnosticText, providerMessagesFromNormalized, type NormalizedAssembledRequest } from './prompt-composition'

export type TextProviderTask = 'story' | 'codex' | 'summary' | 'autotitle'
export type TextProviderGenerationRequest = {
  provider: AiProvider
  task: TextProviderTask
  apiKey: string
  baseUrl: string
  model: string
  normalizedRequest: NormalizedAssembledRequest
  thinking?: boolean
}

export function textProviderMessages(request: Pick<TextProviderGenerationRequest, 'normalizedRequest'>): FakeProviderMessage[] {
  return providerMessagesFromNormalized(request.normalizedRequest, { system: true, user: true, assistant: true }).map((message) => ({ ...message }))
}

export function textProviderRequestText(request: Pick<TextProviderGenerationRequest, 'normalizedRequest'>) {
  return normalizedRequestDiagnosticText(request.normalizedRequest)
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
  const messages = textProviderMessages(request)
  if (messages.some((message) => message.role === 'tool' || message.content === null)) {
    throw new Error('This text-generation provider cannot represent tool messages or null content.')
  }
  await streamNanoGPTCompletion({
    apiKey: request.apiKey,
    baseUrl: request.baseUrl,
    model: request.model,
    messages: messages.map((message) => ({ role: message.role as 'system' | 'user' | 'assistant', content: message.content as string })),
  }, onChunk, signal, lifecycle)
  return { toolCalls: [], finishReason: 'stop' as const }
}

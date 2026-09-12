import { thinkingRequestParameters, type ThinkingEffort } from './thinking-effort'
import type { AiProvider } from './ai-settings'
import { streamFakeProvider } from './fake-provider'
import { consumeCompletionStream, fetchCompletionResponse, readCompletionError } from './completion-stream'

export type ChatToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type ChatToolDefinition = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export type ChatCompletionMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  reasoning_content?: string
  tool_calls?: ChatToolCall[]
  tool_call_id?: string
}

export type ChatCompletionRequest = {
  apiKey: string
  baseUrl: string
  provider: AiProvider
  model: string
  messages: ChatCompletionMessage[]
  thinking: boolean
  thinkingEffort?: ThinkingEffort
  tools?: ChatToolDefinition[]
}

export type ChatCompletionChunk = {
  content?: string
  thoughts?: string
}

export type ChatCompletionUsage = {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  cachedTokens?: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
}

export type ChatCompletionResult = {
  toolCalls: ChatToolCall[]
  finishReason?: string
  usage?: ChatCompletionUsage
}

type ToolCallFragment = {
  index?: number
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
}

function completionEndpoint(baseUrl: string) {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  return `${normalized}/chat/completions`
}

function errorMessage(status: number, payload: unknown, apiKey: string) {
  if (payload && typeof payload === 'object') {
    const value = payload as { message?: unknown; error?: { message?: unknown } | string }
    const message = typeof value.error === 'object' && typeof value.error?.message === 'string'
      ? value.error.message
      : typeof value.error === 'string'
        ? value.error
        : typeof value.message === 'string'
          ? value.message
          : ''
    if (message) return apiKey ? message.split(apiKey).join('[redacted]').slice(0, 320) : message.slice(0, 320)
  }
  return `Chat request failed (${status}).`
}

function reasoningText(delta: Record<string, unknown>) {
  if (typeof delta.reasoning_content === 'string') return delta.reasoning_content
  if (typeof delta.reasoning === 'string') return delta.reasoning
  if (typeof delta.thinking === 'string') return delta.thinking
  const details = delta.reasoning_details
  if (!Array.isArray(details)) return ''
  return details.map((item) => {
    if (!item || typeof item !== 'object') return ''
    const value = item as Record<string, unknown>
    if (typeof value.text === 'string') return value.text
    if (typeof value.content === 'string') return value.content
    if (typeof value.reasoning === 'string') return value.reasoning
    return ''
  }).join('')
}

function parseChunk(payload: unknown): { chunk: ChatCompletionChunk; toolFragments: ToolCallFragment[]; finishReason?: string } {
  if (!payload || typeof payload !== 'object') return { chunk: {}, toolFragments: [] }
  const choice = (payload as { choices?: Array<{ delta?: Record<string, unknown>; finish_reason?: unknown }> }).choices?.[0]
  const delta = choice?.delta
  if (!delta) return { chunk: {}, toolFragments: [], finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined }
  return {
    chunk: {
      content: typeof delta.content === 'string' ? delta.content : undefined,
      thoughts: reasoningText(delta) || undefined,
    },
    toolFragments: Array.isArray(delta.tool_calls) ? delta.tool_calls as ToolCallFragment[] : [],
    finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined,
  }
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function parseUsage(payload: unknown): ChatCompletionUsage {
  if (!payload || typeof payload !== 'object') return {}
  const value = payload as Record<string, unknown>
  const usage = value.usage && typeof value.usage === 'object' ? value.usage as Record<string, unknown> : undefined
  const details = usage?.prompt_tokens_details && typeof usage.prompt_tokens_details === 'object'
    ? usage.prompt_tokens_details as Record<string, unknown>
    : undefined
  if (!usage) return {}
  return {
    promptTokens: finiteNumber(usage.prompt_tokens),
    completionTokens: finiteNumber(usage.completion_tokens),
    totalTokens: finiteNumber(usage.total_tokens),
    cachedTokens: finiteNumber(details?.cached_tokens),
    cacheReadInputTokens: finiteNumber(usage.cache_read_input_tokens) ?? finiteNumber(details?.cache_read_input_tokens),
    cacheCreationInputTokens: finiteNumber(usage.cache_creation_input_tokens) ?? finiteNumber(details?.cache_creation_input_tokens),
  }
}

function hasUsage(usage: ChatCompletionUsage) {
  return Object.values(usage).some((value) => value !== undefined)
}

export async function streamChatCompletion(
  request: ChatCompletionRequest,
  onChunk: (chunk: ChatCompletionChunk) => void,
  signal: AbortSignal,
  onResponse?: () => void,
): Promise<ChatCompletionResult> {
  const providerMessages = request.messages
  if (request.provider === 'fake') {
    const result = await streamFakeProvider({
      task: 'chat',
      model: request.model,
      messages: providerMessages,
      tools: request.tools,
      thinking: request.thinking,
      thinkingEffort: request.thinkingEffort,
    }, {
      onResponse,
      onContent: (content) => onChunk({ content }),
      onThoughts: (thoughts) => onChunk({ thoughts }),
    }, signal)
    return { toolCalls: result.toolCalls, finishReason: result.finishReason }
  }

  const body: Record<string, unknown> = {
    model: request.model,
    messages: providerMessages,
    stream: true,
  }
  if (request.provider !== 'compatible') body.stream_options = { include_usage: true }
  if (request.tools?.length) {
    body.tools = request.tools
    body.tool_choice = 'auto'
  }
  Object.assign(body, thinkingRequestParameters(request.provider, request.thinking, request.thinkingEffort))

  const response = await fetchCompletionResponse(completionEndpoint(request.baseUrl), {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${request.apiKey.trim()}`,
    },
    body: JSON.stringify(body),
  }, signal)

  if (!response.ok) {
    const payload = await readCompletionError(response, signal)
    throw new Error(errorMessage(response.status, payload, request.apiKey))
  }
  if (!response.body) throw new Error('The provider returned an empty streaming response.')
  let received = false
  let finishReason: string | undefined
  let usage: ChatCompletionUsage = {}
  const accumulated = new Map<number, ChatToolCall>()

  const appendToolFragment = (fragment: ToolCallFragment, fallbackIndex: number) => {
    const index = Number.isInteger(fragment.index) ? Number(fragment.index) : fallbackIndex
    const current = accumulated.get(index) ?? {
      id: '',
      type: 'function' as const,
      function: { name: '', arguments: '' },
    }
    if (fragment.id) current.id = fragment.id
    if (fragment.function?.name) current.function.name += fragment.function.name
    if (fragment.function?.arguments) current.function.arguments += fragment.function.arguments
    accumulated.set(index, current)
    received = true
  }

  const consumeLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return false
    const data = trimmed.slice(5).trim()
    if (!data || data === '[DONE]') return data === '[DONE]'
    const payload = JSON.parse(data) as unknown
    const nextUsage = parseUsage(payload)
    if (hasUsage(nextUsage)) {
      const definedUsage = Object.fromEntries(Object.entries(nextUsage).filter(([, value]) => value !== undefined)) as Partial<ChatCompletionUsage>
      usage = { ...usage, ...definedUsage }
    }
    const parsed = parseChunk(payload)
    if (parsed.finishReason) finishReason = parsed.finishReason
    parsed.toolFragments.forEach((fragment, index) => appendToolFragment(fragment, index))
    if (parsed.chunk.content || parsed.chunk.thoughts) {
      received = true
      onChunk(parsed.chunk)
    }
    return false
  }

  await consumeCompletionStream(response.body, signal, consumeLine, onResponse)

  if (!received) throw new Error('The provider completed without returning a response.')
  const toolCalls = [...accumulated.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, call], index) => ({
      ...call,
      id: call.id || `tool-call-${index}`,
    }))
    .filter((call) => call.function.name)
  if (hasUsage(usage) && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('arc-chat-cache-usage', { detail: usage }))
  }
  return { toolCalls, finishReason, ...(hasUsage(usage) ? { usage } : {}) }
}

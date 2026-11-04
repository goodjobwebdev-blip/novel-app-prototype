import { thinkingRequestParameters, type ThinkingEffort } from '../../shared/ai/thinking-effort'
import type { AiProvider } from '../../shared/ai/ai-settings'
import { streamFakeProvider } from '../../shared/ai/fake-provider'
import { consumeCompletionStream, fetchCompletionResponse, readCompletionError } from '../../shared/ai/completion-stream'

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
  maxTokens?: number
  requireComplete?: boolean
  /** Opt in to chat-specific response validation; defaults to false. */
  validateChatResponse?: boolean
  /** Include safe per-request diagnostics in chat errors. */
  diagnosticRound?: number
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

function errorMessage(status: number, payload: unknown, apiKey: string, fallback = `Chat request failed (${status}).`) {
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
  return fallback
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

type StreamDiagnostics = {
  stage: string
  source?: string
  errorType?: unknown
  errorCode?: unknown
  status?: number
  lastFragmentAt?: number
  lastNetworkAt?: number
  networkGap?: number
  toolNames: Map<number, string>
  argumentsReceived: boolean
}

export async function streamChatCompletion(
  request: ChatCompletionRequest,
  onChunk: (chunk: ChatCompletionChunk) => void,
  signal: AbortSignal,
  onResponse?: () => void,
): Promise<ChatCompletionResult> {
  const startedAt = Date.now()
  const diagnostics: StreamDiagnostics = { stage: 'waiting for response', toolNames: new Map(), argumentsReceived: false }
  try {
    return await streamChatCompletionRequest(request, onChunk, signal, onResponse, diagnostics)
  } catch (error) {
    if (request.diagnosticRound === undefined || signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw error
    const now = Date.now()
    const seconds = (ms: number) => `${Math.max(0, Math.round(ms / 1000))} s`
    // Only known tool names are safe to display; never include streamed arguments/content.
    const names = [...diagnostics.toolNames.values()].map(name => request.tools?.some(tool => tool.function.name === name) ? name : 'unknown tool')
    const message = error instanceof Error ? error.message : 'Chat generation stopped unexpectedly.'
    const field = (value: unknown) => typeof value === 'string'
      ? JSON.stringify((request.apiKey ? value.split(request.apiKey).join('[redacted]') : value).slice(0, 120))
      : typeof value === 'number' && Number.isFinite(value) ? String(value) : 'not provided'
    const detail = [
      `Round: ${request.diagnosticRound}; Stage: ${diagnostics.stage}; HTTP: ${diagnostics.status ?? 'none'}`,
      `Error source: ${diagnostics.source ?? 'request transport'}; Error type: ${field(diagnostics.errorType ?? (error instanceof Error ? error.name : undefined))}; Error code: ${field(diagnostics.errorCode)}`,
      `Tool: ${names.join(', ') || 'not received'}; Tool arguments received: ${diagnostics.argumentsReceived ? 'yes' : 'no'}`,
      `Request duration: ${seconds(now - startedAt)}; Last fragment before error: ${diagnostics.lastFragmentAt === undefined ? 'none' : `${seconds(now - diagnostics.lastFragmentAt)} ago`}`,
      `Gap before last network chunk: ${diagnostics.networkGap === undefined ? 'none' : seconds(diagnostics.networkGap)}`,
    ].join('\n')
    throw new Error(`${errorMessage(0, { message }, request.apiKey)}\n${detail}`, { cause: error })
  }
}

async function streamChatCompletionRequest(
  request: ChatCompletionRequest,
  onChunk: (chunk: ChatCompletionChunk) => void,
  signal: AbortSignal,
  onResponse: (() => void) | undefined,
  diagnostics: StreamDiagnostics,
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
      maxTokens: request.maxTokens,
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
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens
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

  diagnostics.status = response.status
  diagnostics.stage = 'HTTP response'
  if (!response.ok) {
    const payload = await readCompletionError(response, signal)
    diagnostics.source = 'provider HTTP'
    const value = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const detail = value.error && typeof value.error === 'object' ? value.error as Record<string, unknown> : value
    diagnostics.errorType = detail.type
    diagnostics.errorCode = detail.code
    throw new Error(errorMessage(response.status, payload, request.apiKey))
  }
  if (!response.body) throw new Error('The provider returned an empty streaming response.')
  let received = false
  let receivedContent = false
  let streamingError = false
  let done = false
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
    diagnostics.toolNames.set(index, current.function.name)
    if (fragment.function?.arguments) diagnostics.argumentsReceived = true
    received = true
  }

  const consumeLine = (line: string) => {
    const trimmed = line.trim()
    const providerError = (payload?: unknown) => {
      diagnostics.source = 'provider stream'
      const value = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
      const detail = value.error && typeof value.error === 'object' ? value.error as Record<string, unknown> : value
      diagnostics.errorType = detail.type
      diagnostics.errorCode = detail.code
    }
    if (request.requireComplete && /^event:\s*error$/i.test(trimmed)) throw new Error('The provider returned a streaming error.')
    if (request.validateChatResponse && trimmed.startsWith('event:')) {
      streamingError = /^event:\s*error$/i.test(trimmed)
      return false
    }
    if (!trimmed.startsWith('data:')) return false
    const data = trimmed.slice(5).trim()
    if (!data) return false
    if (data === '[DONE]') {
      if (streamingError) providerError()
      if (streamingError) throw new Error('The provider returned a streaming error.')
      done = true
      return true
    }
    const payload = JSON.parse(data) as unknown
    if (streamingError) providerError(payload)
    if ((request.requireComplete || request.validateChatResponse) && payload && typeof payload === 'object') {
      const value = payload as Record<string, unknown>
      if (streamingError || value.error != null || value.type === 'error' || value.object === 'error') {
        providerError(payload)
        if (request.requireComplete) throw new Error('The provider returned a streaming error.')
        throw new Error(errorMessage(response.status, payload, request.apiKey, 'The provider returned a streaming error.'))
      }
    } else if (streamingError) throw new Error('The provider returned a streaming error.')
    diagnostics.lastFragmentAt = Date.now()
    const nextUsage = parseUsage(payload)
    if (hasUsage(nextUsage)) {
      const definedUsage = Object.fromEntries(Object.entries(nextUsage).filter(([, value]) => value !== undefined)) as Partial<ChatCompletionUsage>
      usage = { ...usage, ...definedUsage }
    }
    const parsed = parseChunk(payload)
    if (request.requireComplete && parsed.finishReason !== undefined && parsed.finishReason !== 'stop') throw new Error('The provider returned an incomplete response.')
    if (parsed.finishReason) finishReason = parsed.finishReason
    parsed.toolFragments.forEach((fragment, index) => appendToolFragment(fragment, index))
    if (parsed.chunk.content || parsed.chunk.thoughts) {
      received = true
      if (parsed.chunk.content?.trim()) receivedContent = true
      onChunk(parsed.chunk)
    }
    return false
  }

  diagnostics.stage = 'receiving stream'
  diagnostics.source = 'stream read'
  await consumeCompletionStream(response.body, signal, line => {
    diagnostics.source = 'stream parsing'
    const done = consumeLine(line)
    diagnostics.source = 'stream read'
    return done
  }, onResponse, () => {
    const now = Date.now()
    diagnostics.networkGap = diagnostics.lastNetworkAt === undefined ? undefined : now - diagnostics.lastNetworkAt
    diagnostics.lastNetworkAt = now
  })
  diagnostics.source = streamingError ? 'provider stream' : 'response validation'

  if (request.requireComplete && !done && finishReason !== 'stop') throw new Error('The provider did not complete the response.')
  if (request.validateChatResponse) {
    if (streamingError) throw new Error('The provider returned a streaming error.')
    if (finishReason === 'length' || finishReason === 'max_tokens') throw new Error(`The provider hit its output token limit (${finishReason}). The response is incomplete; try again or adjust the provider's output limit.`)
    if (finishReason === 'content_filter') throw new Error('The provider stopped the response because of its content filter (content_filter).')
    if (finishReason && !['stop', 'tool_calls'].includes(finishReason)) throw new Error(errorMessage(response.status, { message: `The provider returned an incomplete response (finish_reason: ${finishReason}).` }, request.apiKey))
    if (!done && !finishReason) throw new Error('The provider did not complete the response. The stream was interrupted; try again.')
  }
  if (!received) throw new Error('The provider completed without returning a response.')
  const toolCalls = [...accumulated.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, call], index) => ({
      ...call,
      id: call.id || `tool-call-${index}`,
    }))
    .filter((call) => call.function.name)
  if (request.validateChatResponse && !receivedContent && !toolCalls.length) throw new Error('The provider completed without returning an answer or a tool call (only reasoning or empty content).')
  if (hasUsage(usage) && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('arc-chat-cache-usage', { detail: usage }))
  }
  return { toolCalls, finishReason, ...(hasUsage(usage) ? { usage } : {}) }
}

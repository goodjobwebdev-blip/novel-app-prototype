import type { AiProvider } from './ai-settings'

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
  tools?: ChatToolDefinition[]
}

export type ChatCompletionChunk = {
  content?: string
  thoughts?: string
}

export type ChatCompletionResult = {
  toolCalls: ChatToolCall[]
  finishReason?: string
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

export async function streamChatCompletion(
  request: ChatCompletionRequest,
  onChunk: (chunk: ChatCompletionChunk) => void,
  signal: AbortSignal,
  onResponse?: () => void,
): Promise<ChatCompletionResult> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
    stream: true,
  }
  if (request.tools?.length) {
    body.tools = request.tools
    body.tool_choice = 'auto'
  }
  if (request.thinking && request.provider === 'nanogpt') {
    body.reasoning = { enabled: true, delta_field: 'reasoning_content' }
  } else if (request.thinking && request.provider === 'openrouter') {
    body.reasoning = { enabled: true }
    body.include_reasoning = true
  } else if (request.thinking && request.provider === 'compatible') {
    body.reasoning = { enabled: true }
  }

  const response = await fetch(completionEndpoint(request.baseUrl), {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${request.apiKey.trim()}`,
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(errorMessage(response.status, payload, request.apiKey))
  }
  if (!response.body) throw new Error('The provider returned an empty streaming response.')
  onResponse?.()

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let received = false
  let finishReason: string | undefined
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
    const parsed = parseChunk(JSON.parse(data))
    if (parsed.finishReason) finishReason = parsed.finishReason
    parsed.toolFragments.forEach((fragment, index) => appendToolFragment(fragment, index))
    if (parsed.chunk.content || parsed.chunk.thoughts) {
      received = true
      onChunk(parsed.chunk)
    }
    return false
  }

  let done = false
  while (!done) {
    const read = await reader.read()
    buffer += decoder.decode(read.value, { stream: !read.done })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (consumeLine(line)) {
        done = true
        break
      }
    }
    if (read.done) {
      if (buffer) consumeLine(buffer)
      break
    }
  }

  if (!received) throw new Error('The provider completed without returning a response.')
  const toolCalls = [...accumulated.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, call], index) => ({
      ...call,
      id: call.id || `tool-call-${index}`,
    }))
    .filter((call) => call.function.name)
  return { toolCalls, finishReason }
}

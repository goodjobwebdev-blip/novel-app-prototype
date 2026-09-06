export const FAKE_PROVIDER_MODEL = {
  id: 'fake/test',
  name: 'Fake Test Model',
  context_length: 32_768,
} as const

export type FakeProviderTask = 'story' | 'codex' | 'summary' | 'autotitle' | 'chat' | 'unknown'

export type FakeProviderToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type FakeProviderToolDefinition = {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: Record<string, unknown>
  }
}

export type FakeProviderMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  reasoning_content?: string
  tool_calls?: FakeProviderToolCall[]
  tool_call_id?: string
}

export type FakeProviderRequest = {
  task?: FakeProviderTask
  model: string
  messages: FakeProviderMessage[]
  tools?: FakeProviderToolDefinition[]
  thinking?: boolean
}

export type FakeProviderStreamCallbacks = {
  onResponse?: () => void
  onContent?: (text: string) => void
  onThoughts?: (text: string) => void
}

export type FakeProviderResult = {
  toolCalls: FakeProviderToolCall[]
  finishReason: 'stop' | 'tool_calls'
}

export type FakeProviderTraceOutcome = 'complete' | 'aborted' | 'failed'
export type FakeProviderTraceEntry = {
  id: number
  task: FakeProviderTask
  model: string
  messages: FakeProviderMessage[]
  toolNames: string[]
  thinking: boolean
  directives: string[]
  emittedContent: string
  emittedThoughts: string
  emittedToolCalls: FakeProviderToolCall[]
  outcome: FakeProviderTraceOutcome
  error?: string
}

type ParsedToolDirective = {
  token: string
  name: string
  argumentsText: string
  parsedArguments: Record<string, unknown>
}

type ParsedScript = {
  sourceIndex: number
  source: string
  visibleText: string
  beforeStreamFailure: string
  requestFailure: boolean
  streamFailure: boolean
  delayMs: number
  thoughts: string
  tool?: ParsedToolDirective
  directives: string[]
}

const DEFAULT_DELAY_MS = 12
const MAX_DELAY_MS = 5_000
const TRACE_LIMIT = 20
const listeners = new Set<() => void>()
let traceSequence = 0
let traceEntries: FakeProviderTraceEntry[] = []

function cloneToolCall(call: FakeProviderToolCall): FakeProviderToolCall {
  return { ...call, function: { ...call.function } }
}

function cloneMessage(message: FakeProviderMessage): FakeProviderMessage {
  return {
    ...message,
    ...(message.tool_calls ? { tool_calls: message.tool_calls.map(cloneToolCall) } : {}),
  }
}

function cloneTrace(entry: FakeProviderTraceEntry): FakeProviderTraceEntry {
  return {
    ...entry,
    messages: entry.messages.map(cloneMessage),
    toolNames: [...entry.toolNames],
    directives: [...entry.directives],
    emittedToolCalls: entry.emittedToolCalls.map(cloneToolCall),
  }
}

function notifyTrace() {
  listeners.forEach((listener) => listener())
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('arc-fake-provider-trace'))
}

function appendTrace(entry: FakeProviderTraceEntry) {
  traceEntries = [...traceEntries, cloneTrace(entry)].slice(-TRACE_LIMIT)
  notifyTrace()
}

export function getFakeProviderTrace() {
  return traceEntries.map(cloneTrace)
}

export function clearFakeProviderTrace() {
  traceEntries = []
  notifyTrace()
}

export function subscribeFakeProviderTrace(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function abortError() {
  return new DOMException('Fake provider request was aborted.', 'AbortError')
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw abortError()
}

function abortableDelay(ms: number, signal: AbortSignal) {
  throwIfAborted(signal)
  if (ms <= 0) return Promise.resolve().then(() => throwIfAborted(signal))
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(abortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function defaultOutput(task: FakeProviderTask) {
  if (task === 'story') return 'FAKE TEST OUTPUT — Story generation.'
  if (task === 'codex') return 'FAKE TEST OUTPUT — Codex generation.'
  if (task === 'summary') return 'FAKE TEST OUTPUT — Summary generation.'
  if (task === 'autotitle') return 'Fake Test Title'
  if (task === 'chat') return 'FAKE TEST RESPONSE'
  return 'FAKE TEST OUTPUT'
}

function hasDirective(value: string) {
  return /\[(?:REQUEST_FAIL|STREAM_FAIL|DELAY_MS:|THOUGHTS:|invoke_tool:)/.test(value)
}

function findToolDirective(source: string): ParsedToolDirective | undefined {
  const marker = '[invoke_tool:'
  const start = source.indexOf(marker)
  if (start < 0) return undefined
  const nameStart = start + marker.length
  const colon = source.indexOf(':', nameStart)
  if (colon < 0) throw new Error('Fake provider: malformed invoke_tool directive.')
  const name = source.slice(nameStart, colon).trim()
  if (!name) throw new Error('Fake provider: invoke_tool requires a tool name.')

  let cursor = colon + 1
  while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1
  if (source[cursor] !== '{') throw new Error(`Fake provider: invoke_tool for "${name}" requires a JSON object.`)

  const jsonStart = cursor
  let depth = 0
  let quoted = false
  let escaped = false
  let jsonEnd = -1
  for (; cursor < source.length; cursor += 1) {
    const char = source[cursor]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
      continue
    }
    if (char === '"') {
      quoted = true
      continue
    }
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        jsonEnd = cursor + 1
        break
      }
    }
  }
  if (jsonEnd < 0) throw new Error(`Fake provider: invoke_tool for "${name}" has incomplete JSON arguments.`)
  let close = jsonEnd
  while (close < source.length && /\s/.test(source[close])) close += 1
  if (source[close] !== ']') throw new Error(`Fake provider: invoke_tool for "${name}" is missing its closing bracket.`)
  const argumentsText = source.slice(jsonStart, jsonEnd)
  let parsed: unknown
  try {
    parsed = JSON.parse(argumentsText)
  } catch {
    throw new Error(`Fake provider: invoke_tool for "${name}" has invalid JSON arguments.`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Fake provider: invoke_tool for "${name}" requires a JSON object.`)
  }
  return {
    token: source.slice(start, close + 1),
    name,
    argumentsText,
    parsedArguments: parsed as Record<string, unknown>,
  }
}

function removeTokenOnce(source: string, token: string) {
  const index = source.indexOf(token)
  return index < 0 ? source : `${source.slice(0, index)}${source.slice(index + token.length)}`
}

function parseScript(messages: FakeProviderMessage[]): ParsedScript {
  let sourceIndex = -1
  let source = ''
  messages.forEach((message, index) => {
    if (typeof message.content === 'string' && hasDirective(message.content)) {
      sourceIndex = index
      source = message.content
    }
  })

  const requestFailure = source.includes('[REQUEST_FAIL]')
  const streamFailure = source.includes('[STREAM_FAIL]')
  const delayMatches = [...source.matchAll(/\[DELAY_MS:\s*(-?\d+)\s*\]/g)]
  const rawDelay = delayMatches.length ? Number(delayMatches[delayMatches.length - 1][1]) : DEFAULT_DELAY_MS
  const delayMs = Math.max(0, Math.min(MAX_DELAY_MS, Number.isFinite(rawDelay) ? rawDelay : DEFAULT_DELAY_MS))
  const thoughtMatches = [...source.matchAll(/\[THOUGHTS:([^\]]*)\]/g)]
  const thoughts = thoughtMatches.length ? thoughtMatches[thoughtMatches.length - 1][1] : ''
  const tool = findToolDirective(source)
  const directives: string[] = []
  if (requestFailure) directives.push('REQUEST_FAIL')
  if (streamFailure) directives.push('STREAM_FAIL')
  if (delayMatches.length) directives.push(`DELAY_MS:${delayMs}`)
  if (thoughtMatches.length) directives.push('THOUGHTS')
  if (tool) directives.push(`invoke_tool:${tool.name}`)

  let visibleText = source
    .replace(/\[REQUEST_FAIL\]/g, '')
    .replace(/\[DELAY_MS:\s*-?\d+\s*\]/g, '')
    .replace(/\[THOUGHTS:[^\]]*\]/g, '')
  if (tool) visibleText = removeTokenOnce(visibleText, tool.token)
  const failureIndex = visibleText.indexOf('[STREAM_FAIL]')
  const beforeStreamFailure = (failureIndex >= 0 ? visibleText.slice(0, failureIndex) : visibleText).trim()
  visibleText = visibleText.replace(/\[STREAM_FAIL\]/g, '').trim()

  return {
    sourceIndex,
    source,
    visibleText,
    beforeStreamFailure,
    requestFailure,
    streamFailure,
    delayMs,
    thoughts,
    tool,
    directives,
  }
}

function chunksFor(text: string) {
  return text.match(/\S+\s*/g) ?? (text ? [text] : [])
}

async function emitText(text: string, delayMs: number, signal: AbortSignal, emit: (chunk: string) => void) {
  for (const chunk of chunksFor(text)) {
    await abortableDelay(delayMs, signal)
    throwIfAborted(signal)
    emit(chunk)
  }
}

function toolResultFollowsScript(messages: FakeProviderMessage[], sourceIndex: number) {
  if (sourceIndex < 0) return false
  return messages.slice(sourceIndex + 1).some((message) => message.role === 'tool')
}

function validateTool(tool: ParsedToolDirective, definitions: FakeProviderToolDefinition[]) {
  const available = definitions.some((definition) => definition.function.name === tool.name)
  if (!available) throw new Error(`Fake provider: tool "${tool.name}" is not available in this request.`)
}

export async function streamFakeProvider(
  request: FakeProviderRequest,
  callbacks: FakeProviderStreamCallbacks,
  signal: AbortSignal,
): Promise<FakeProviderResult> {
  const task = request.task ?? 'unknown'
  const parsed = parseScript(request.messages)
  const trace: FakeProviderTraceEntry = {
    id: ++traceSequence,
    task,
    model: request.model,
    messages: request.messages.map(cloneMessage),
    toolNames: (request.tools ?? []).map((tool) => tool.function.name),
    thinking: request.thinking === true,
    directives: [...parsed.directives],
    emittedContent: '',
    emittedThoughts: '',
    emittedToolCalls: [],
    outcome: 'complete',
  }

  const finishTrace = (outcome: FakeProviderTraceOutcome, error?: unknown) => {
    trace.outcome = outcome
    if (error instanceof Error && error.message) trace.error = error.message
    appendTrace(trace)
  }

  try {
    throwIfAborted(signal)
    if (request.model !== FAKE_PROVIDER_MODEL.id) throw new Error(`Fake provider: unsupported model "${request.model}".`)
    if (parsed.requestFailure) throw new Error('Fake provider: deliberate request failure.')

    callbacks.onResponse?.()
    throwIfAborted(signal)

    if (request.thinking && parsed.thoughts) {
      await emitText(parsed.thoughts, parsed.delayMs, signal, (chunk) => {
        trace.emittedThoughts += chunk
        callbacks.onThoughts?.(chunk)
      })
    }

    if (parsed.tool) {
      if (toolResultFollowsScript(request.messages, parsed.sourceIndex)) {
        const followUp = parsed.visibleText || 'FAKE TEST RESPONSE — tool result received.'
        await emitText(followUp, parsed.delayMs, signal, (chunk) => {
          trace.emittedContent += chunk
          callbacks.onContent?.(chunk)
        })
        finishTrace('complete')
        return { toolCalls: [], finishReason: 'stop' }
      }
      validateTool(parsed.tool, request.tools ?? [])
      throwIfAborted(signal)
      const call: FakeProviderToolCall = {
        id: 'fake-tool-call-1',
        type: 'function',
        function: { name: parsed.tool.name, arguments: parsed.tool.argumentsText },
      }
      trace.emittedToolCalls.push(cloneToolCall(call))
      finishTrace('complete')
      return { toolCalls: [call], finishReason: 'tool_calls' }
    }

    const output = parsed.sourceIndex >= 0
      ? (parsed.streamFailure ? parsed.beforeStreamFailure : parsed.visibleText) || defaultOutput(task)
      : defaultOutput(task)
    await emitText(output, parsed.delayMs, signal, (chunk) => {
      trace.emittedContent += chunk
      callbacks.onContent?.(chunk)
    })
    if (parsed.streamFailure) throw new Error('Fake provider: deliberate stream failure.')
    finishTrace('complete')
    return { toolCalls: [], finishReason: 'stop' }
  } catch (error) {
    finishTrace(signal.aborted || (error instanceof DOMException && error.name === 'AbortError') ? 'aborted' : 'failed', error)
    throw error
  }
}

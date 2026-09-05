import { bookTemplateValues, renderPromptTemplate, type BookPromptValues } from './prompt-template'

export type StoryPromptValues = {
  book: BookPromptValues
  sceneText: string
  scenePov?: string
  previousSceneText?: string
  summaryContext?: string
  additionalContext?: string
}

export type LorePromptValues = {
  book: BookPromptValues
  entryTitle: string
  entryCategory: string
  entryContent: string
  sceneText?: string
  additionalContext?: string
}

export type NanoGPTGenerationRequest = {
  apiKey: string
  baseUrl: string
  model: string
  systemPrompt: string
  contextMessage?: string
  userMessage?: string
}

export type NanoGPTStreamLifecycle = {
  onResponse?: () => void
}

const templateValues = (values: StoryPromptValues): Record<string, string> => ({
  ...bookTemplateValues(values.book),
  'scene.text': values.sceneText,
  'scene.pov': values.scenePov ?? '',
  'scene.previous_text': values.previousSceneText ?? '',
  'scene.summary_context': values.summaryContext ?? '',
  'additional_context': values.additionalContext ?? '',
})

export function renderStoryPrompt(template: string, values: StoryPromptValues) {
  return renderPromptTemplate(template, templateValues(values))
}

export function renderLorePrompt(template: string, values: LorePromptValues) {
  return renderPromptTemplate(template, {
    ...bookTemplateValues(values.book),
    'entry.title': values.entryTitle,
    'entry.category': values.entryCategory,
    'entry.content': values.entryContent,
    'scene.text': values.sceneText ?? '',
    'additional_context': values.additionalContext ?? '',
  })
}

function completionEndpoint(baseUrl: string) {
  const normalized = baseUrl.trim().replace(/\/+$/, '') || 'https://nano-gpt.com/api/v1'
  return `${normalized}/chat/completions`
}

export async function fetchNanoGPTModelContextLength(apiKey: string, baseUrl: string, modelId: string) {
  const normalized = baseUrl.trim().replace(/\/+$/, '') || 'https://nano-gpt.com/api/v1'
  const response = await fetch(`${normalized}/models?detailed=true&sort=favorites`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(4_000),
  })
  if (!response.ok) return undefined
  const payload = await response.json().catch(() => ({})) as { data?: Array<{ id?: string; context_length?: number }> }
  const contextLength = payload.data?.find((model) => model.id === modelId)?.context_length
  return Number.isFinite(contextLength) ? contextLength : undefined
}

function providerError(status: number, payload: unknown, apiKey: string) {
  if (payload && typeof payload === 'object') {
    const value = payload as { message?: unknown; error?: { message?: unknown } | string }
    const message = typeof value.error === 'object' && typeof value.error?.message === 'string'
      ? value.error.message
      : typeof value.error === 'string'
        ? value.error
        : typeof value.message === 'string'
          ? value.message
          : ''
    if (message) {
      const safeMessage = apiKey ? message.split(apiKey).join('[redacted]') : message
      return `NanoGPT: ${safeMessage.slice(0, 240)}`
    }
  }
  return `NanoGPT request failed (${status}).`
}

function chunkText(payload: unknown) {
  if (!payload || typeof payload !== 'object') return ''
  const choice = (payload as { choices?: Array<{ delta?: { content?: unknown } }> }).choices?.[0]
  return typeof choice?.delta?.content === 'string' ? choice.delta.content : ''
}

export async function streamNanoGPTCompletion(
  request: NanoGPTGenerationRequest,
  onChunk: (text: string) => void,
  signal: AbortSignal,
  lifecycle: NanoGPTStreamLifecycle = {},
) {
  const messages = [{ role: 'system', content: request.systemPrompt }]
  if (request.contextMessage?.trim()) messages.push({ role: 'user', content: request.contextMessage })
  if (request.userMessage?.trim()) messages.push({ role: 'user', content: request.userMessage })

  const response = await fetch(completionEndpoint(request.baseUrl), {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${request.apiKey}`,
    },
    body: JSON.stringify({ model: request.model, messages, stream: true }),
    signal,
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(providerError(response.status, payload, request.apiKey))
  }
  if (!response.body) throw new Error('NanoGPT returned an empty streaming response.')
  lifecycle.onResponse?.()

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let receivedText = false

  const consumeLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return false
    const data = trimmed.slice(5).trim()
    if (!data || data === '[DONE]') return data === '[DONE]'
    const text = chunkText(JSON.parse(data))
    if (text) {
      receivedText = true
      onChunk(text)
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

  if (!receivedText) throw new Error('NanoGPT completed without returning generated text.')
}

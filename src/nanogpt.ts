import { bookTemplateValues, renderPromptTemplate, type BookPromptValues } from './prompt-template'
import type { ProviderMessageRole } from './prompt-composition'

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
  messages?: Array<{ role: ProviderMessageRole; content: string }>
}

export type NanoGPTStreamLifecycle = {
  onResponse?: () => void
  onThoughts?: (text: string) => void
  onMetadata?: (metadata: NanoGPTStreamMetadata) => void
}

export type NanoGPTStreamMetadata = {
  responseId?: string
  responseModel?: string
  finishReason?: string
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

const STORY_BOOK_CONTEXT_SEPARATOR = '\n\n<<<ARC_STORY_BOOK_CONTEXT_V1>>>\n\n'
const STORY_SCENE_CONTEXT_SEPARATOR = '\n\n<<<ARC_STORY_SCENE_CONTEXT_V1>>>\n\n'

const templateValues = (values: StoryPromptValues): Record<string, string> => ({
  ...bookTemplateValues(values.book),
  'scene.text': values.sceneText,
  'scene.pov': values.scenePov ?? '',
  'scene.previous_text': values.previousSceneText ?? '',
  'scene.summary_context': values.summaryContext ?? '',
  'additional_context': values.additionalContext ?? '',
})

function storyTemplateEmbedsContext(template: string) {
  return /{{\s*(?:book\.[\w.]+|scene\.[\w.]+|additional_context)\s*}}/.test(template)
}

function storyBookContext(values: StoryPromptValues) {
  const lines = ['# Book context']
  if (values.book.title.trim()) lines.push(`Title: ${values.book.title}`)
  if (values.book.series.trim()) lines.push(`Series: ${values.book.series}`)
  if (values.book.seriesOrder.trim()) lines.push(`Series position: Book ${values.book.seriesOrder}`)
  if (values.book.overview.trim()) lines.push(`Overview: ${values.book.overview}`)
  if (values.book.genre.trim()) lines.push(`Genre: ${values.book.genre}`)
  if (values.book.style.trim()) lines.push(`Book-level style guidance: ${values.book.style}`)
  if (values.book.pov.trim()) lines.push(`Default point of view: ${values.book.pov}`)
  if (values.book.tense.trim()) lines.push(`Default narrative tense: ${values.book.tense}`)
  if (values.book.language.trim()) lines.push(`Language: ${values.book.language}`)
  return lines.join('\n')
}

function storySceneContext(values: StoryPromptValues) {
  const sections: string[] = []
  if (values.summaryContext?.trim()) sections.push(`# Earlier story context\n\n${values.summaryContext.trim()}`)
  if (values.previousSceneText?.trim()) sections.push(`# Previous scene\n\n${values.previousSceneText}`)
  if (values.scenePov?.trim()) sections.push(`# Scene settings\n\nPoint of view: ${values.scenePov}`)
  sections.push(`# Current manuscript\n\n${values.sceneText}`)
  return sections.join('\n\n')
}

export function renderStoryPrompt(template: string, values: StoryPromptValues) {
  const rendered = renderPromptTemplate(template, templateValues(values))
  if (storyTemplateEmbedsContext(template)) return rendered
  return `${rendered}${STORY_BOOK_CONTEXT_SEPARATOR}${storyBookContext(values)}${STORY_SCENE_CONTEXT_SEPARATOR}${storySceneContext(values)}`
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

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function streamMetadata(payload: unknown): NanoGPTStreamMetadata {
  if (!payload || typeof payload !== 'object') return {}
  const value = payload as Record<string, unknown>
  const choice = (value.choices as Array<{ finish_reason?: unknown }> | undefined)?.[0]
  const usage = value.usage && typeof value.usage === 'object' ? value.usage as Record<string, unknown> : undefined
  return {
    responseId: typeof value.id === 'string' ? value.id : undefined,
    responseModel: typeof value.model === 'string' ? value.model : undefined,
    finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined,
    promptTokens: finiteNumber(usage?.prompt_tokens),
    completionTokens: finiteNumber(usage?.completion_tokens),
    totalTokens: finiteNumber(usage?.total_tokens),
  }
}

function hasMetadata(metadata: NanoGPTStreamMetadata) {
  return Object.values(metadata).some((value) => value !== undefined)
}

function splitStoryPrompt(systemPrompt: string) {
  const bookIndex = systemPrompt.indexOf(STORY_BOOK_CONTEXT_SEPARATOR)
  if (bookIndex < 0) return null
  const sceneIndex = systemPrompt.indexOf(STORY_SCENE_CONTEXT_SEPARATOR, bookIndex + STORY_BOOK_CONTEXT_SEPARATOR.length)
  if (sceneIndex < 0) return null
  return {
    systemPrompt: systemPrompt.slice(0, bookIndex),
    bookContext: systemPrompt.slice(bookIndex + STORY_BOOK_CONTEXT_SEPARATOR.length, sceneIndex),
    sceneContext: systemPrompt.slice(sceneIndex + STORY_SCENE_CONTEXT_SEPARATOR.length),
  }
}

export function nanoGPTCompletionMessages(request: Pick<NanoGPTGenerationRequest, 'systemPrompt' | 'contextMessage' | 'userMessage' | 'messages'>): Array<{ role: ProviderMessageRole; content: string }> {
  if (request.messages) return request.messages.map((message) => ({ ...message }))
  const storyPrompt = splitStoryPrompt(request.systemPrompt)
  const messages: Array<{ role: ProviderMessageRole; content: string }> = [{ role: 'system', content: storyPrompt?.systemPrompt ?? request.systemPrompt }]
  if (storyPrompt?.bookContext.trim()) messages.push({ role: 'user', content: storyPrompt.bookContext })
  if (request.contextMessage?.trim()) messages.push({ role: 'user', content: request.contextMessage })
  if (storyPrompt?.sceneContext.trim()) messages.push({ role: 'user', content: storyPrompt.sceneContext })
  if (request.userMessage?.trim()) messages.push({ role: 'user', content: request.userMessage })
  return messages
}

export function nanoGPTRequestText(request: Pick<NanoGPTGenerationRequest, 'systemPrompt' | 'contextMessage' | 'userMessage' | 'messages'>) {
  return JSON.stringify({ messages: nanoGPTCompletionMessages(request) })
}

export async function streamNanoGPTCompletion(
  request: NanoGPTGenerationRequest,
  onChunk: (text: string) => void,
  signal: AbortSignal,
  lifecycle: NanoGPTStreamLifecycle = {},
) {
  const messages = nanoGPTCompletionMessages(request)

  const response = await fetch(completionEndpoint(request.baseUrl), {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${request.apiKey}`,
    },
    body: JSON.stringify({
      model: request.model,
      messages,
      stream: true,
      reasoning: { enabled: true, delta_field: 'reasoning_content' },
      stream_options: { include_usage: true },
    }),
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
    const payload = JSON.parse(data) as unknown
    const metadata = streamMetadata(payload)
    if (hasMetadata(metadata)) lifecycle.onMetadata?.(metadata)
    const delta = (payload as { choices?: Array<{ delta?: Record<string, unknown> }> }).choices?.[0]?.delta
    const thoughts = delta ? reasoningText(delta) : ''
    if (thoughts) lifecycle.onThoughts?.(thoughts)
    const text = chunkText(payload)
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

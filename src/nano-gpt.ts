export const AI_SETTINGS_STORAGE_KEY = 'arc-ai-defaults-v1'

export type NanoGptSettings = {
  provider: string
  apiKey: string
  baseUrl: string
  mainModel: string
  prompts: { story: string }
}

export type StoryPromptContext = {
  bookTitle: string
  sceneText: string
  scenePov?: string
}

type StreamOptions = {
  settings: NanoGptSettings
  context: StoryPromptContext
  instruction: string
  signal: AbortSignal
  onChunk: (text: string) => void
  fetchImpl?: typeof fetch
}

const DEFAULT_BASE_URL = 'https://nano-gpt.com/api/v1'

export function loadNanoGptSettings(storage: Pick<Storage, 'getItem'> = localStorage): NanoGptSettings {
  const raw = storage.getItem(AI_SETTINGS_STORAGE_KEY)
  if (!raw) throw new Error('Set up nano-gpt.com in AI settings before generating.')

  let value: Partial<NanoGptSettings>
  try {
    value = JSON.parse(raw) as Partial<NanoGptSettings>
  } catch {
    throw new Error('AI settings could not be read. Save them again before generating.')
  }

  if (value.provider !== 'nanogpt') throw new Error('Select nano-gpt.com as the AI provider before generating.')
  if (!value.apiKey?.trim()) throw new Error('Add a NanoGPT API key in AI settings before generating.')
  if (!value.mainModel?.trim()) throw new Error('Choose a Main model in AI settings before generating.')

  return {
    provider: 'nanogpt',
    apiKey: value.apiKey.trim(),
    baseUrl: value.baseUrl?.trim() || DEFAULT_BASE_URL,
    mainModel: value.mainModel.trim(),
    prompts: { story: value.prompts?.story ?? '' },
  }
}

function replaceVariable(template: string, name: string, value: string) {
  return template.replace(new RegExp(`{{\\s*${name.replace('.', '\\.') }\\s*}}`, 'g'), value)
}

export function renderStoryPrompt(template: string, context: StoryPromptContext) {
  let rendered = template.replace(
    /{%\s*if\s+scene\.pov\s*%}([\s\S]*?){%\s*endif\s*%}/g,
    context.scenePov ? '$1' : '',
  )
  rendered = replaceVariable(rendered, 'book.title', context.bookTitle)
  rendered = replaceVariable(rendered, 'scene.text', context.sceneText)
  rendered = replaceVariable(rendered, 'scene.pov', context.scenePov ?? '')
  return rendered.trim()
}

function providerError(payload: unknown, status: number) {
  if (payload && typeof payload === 'object') {
    const value = payload as { message?: unknown; error?: { message?: unknown } | string }
    const message = typeof value.error === 'object' ? value.error?.message : value.error
    if (typeof message === 'string' && message.trim()) return message
    if (typeof value.message === 'string' && value.message.trim()) return value.message
  }
  return `NanoGPT returned ${status}.`
}

export async function streamNanoGptGeneration({
  settings,
  context,
  instruction,
  signal,
  onChunk,
  fetchImpl = fetch,
}: StreamOptions) {
  const systemPrompt = renderStoryPrompt(settings.prompts.story, context)
  const messages: Array<{ role: 'system' | 'user'; content: string }> = []
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
  if (instruction.trim()) messages.push({ role: 'user', content: instruction })
  if (!messages.length) throw new Error('The Story system prompt is empty. Add one in AI settings.')

  const endpoint = `${settings.baseUrl.replace(/\/$/, '')}/chat/completions`
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      Authorization: `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: settings.mainModel, messages, stream: true }),
    signal,
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(providerError(payload, response.status))
  }
  if (!response.body) throw new Error('NanoGPT returned an empty response stream.')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const consumeLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return false
    const data = trimmed.slice(5).trim()
    if (!data || data === '[DONE]') return data === '[DONE]'
    let payload: { choices?: Array<{ delta?: { content?: string } }>; error?: { message?: string } }
    try {
      payload = JSON.parse(data) as typeof payload
    } catch {
      return false
    }
    if (payload.error?.message) throw new Error(payload.error.message)
    const content = payload.choices?.[0]?.delta?.content
    if (typeof content === 'string' && content) onChunk(content)
    return false
  }

  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const lines = buffer.split(/\r?\n/)
    buffer = done ? '' : (lines.pop() ?? '')
    for (const line of lines) {
      if (consumeLine(line)) return
    }
    if (done) {
      if (buffer) consumeLine(buffer)
      return
    }
  }
}

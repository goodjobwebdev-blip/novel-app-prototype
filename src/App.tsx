import { useMemo, useState } from 'react'

const MODELS_ENDPOINT = 'https://nano-gpt.com/api/v1/models?detailed=true&sort=favorites'
const CHAT_ENDPOINT = 'https://nano-gpt.com/api/v1/chat/completions'

type NanoModel = {
  id: string
  name?: string
  owned_by?: string
}

type ModelsResponse = {
  data?: NanoModel[]
  message?: string
}

type ChatResponse = {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
  error?: string | { message?: string }
  message?: string
}

export default function App() {
  const [prompt, setPrompt] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState<NanoModel[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [message, setMessage] = useState('Enter an API key, then refresh the model list.')
  const [hasError, setHasError] = useState(false)
  const [generationMessage, setGenerationMessage] = useState('')
  const [generationError, setGenerationError] = useState(false)

  const modelOptions = useMemo(
    () =>
      models.map((model) => ({
        id: model.id,
        label: model.name && model.name !== model.id ? `${model.name} — ${model.id}` : model.id,
      })),
    [models],
  )

  async function refreshModels() {
    setIsLoading(true)
    setHasError(false)
    setMessage('Loading models…')

    try {
      const headers: HeadersInit = { Accept: 'application/json' }
      const trimmedKey = apiKey.trim()

      if (trimmedKey) {
        headers.Authorization = `Bearer ${trimmedKey}`
      }

      const response = await fetch(MODELS_ENDPOINT, { headers })
      const payload = (await response.json().catch(() => ({}))) as ModelsResponse

      if (!response.ok) {
        throw new Error(payload.message || `NanoGPT returned ${response.status}.`)
      }

      const availableModels = Array.isArray(payload.data)
        ? payload.data.filter((model) => typeof model.id === 'string' && model.id.length > 0)
        : []

      setModels(availableModels)

      if (!availableModels.some((model) => model.id === selectedModel)) {
        setSelectedModel('')
      }

      setMessage(
        availableModels.length > 0
          ? `${availableModels.length} models available.`
          : 'NanoGPT returned no available models.',
      )
    } catch (error) {
      setModels([])
      setSelectedModel('')
      setHasError(true)
      setMessage(error instanceof Error ? error.message : 'Could not load the model list.')
    } finally {
      setIsLoading(false)
    }
  }

  async function generateContinuation() {
    const trimmedKey = apiKey.trim()
    const story = prompt.trim()

    setGenerationError(false)

    if (!trimmedKey) {
      setGenerationError(true)
      setGenerationMessage('Enter your NanoGPT API key before generating.')
      return
    }

    if (!selectedModel) {
      setGenerationError(true)
      setGenerationMessage('Choose a model before generating.')
      return
    }

    if (!story) {
      setGenerationError(true)
      setGenerationMessage('Add some story text before generating.')
      return
    }

    setIsGenerating(true)
    setGenerationMessage('Generating continuation…')

    try {
      const response = await fetch(CHAT_ENDPOINT, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${trimmedKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [
            {
              role: 'user',
              content: `${story}\n\nContinue the story.`,
            },
          ],
        }),
      })

      const payload = (await response.json().catch(() => ({}))) as ChatResponse

      if (!response.ok) {
        const apiMessage =
          typeof payload.error === 'string' ? payload.error : payload.error?.message
        throw new Error(apiMessage || payload.message || `NanoGPT returned ${response.status}.`)
      }

      const continuation = payload.choices?.[0]?.message?.content?.trim()

      if (!continuation) {
        throw new Error('NanoGPT returned an empty continuation.')
      }

      setPrompt(`${prompt.trimEnd()}\n\n${continuation}`)
      setGenerationMessage('Continuation added to the text.')
    } catch (error) {
      setGenerationError(true)
      setGenerationMessage(error instanceof Error ? error.message : 'Could not generate a continuation.')
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <main>
      <section className="workspace" aria-labelledby="page-title">
        <header>
          <p className="eyebrow">NanoGPT</p>
          <h1 id="page-title">Generation prototype</h1>
        </header>

        <div className="field">
          <label htmlFor="prompt">Text</label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Write something to continue, rewrite, or explore…"
            rows={10}
          />
        </div>

        <div className="field">
          <label htmlFor="api-key">NanoGPT API key</label>
          <div className="key-row">
            <input
              id="api-key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Enter API key"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" onClick={refreshModels} disabled={isLoading}>
              {isLoading ? 'Refreshing…' : 'Refresh model list'}
            </button>
          </div>
          <p className="hint">The key stays in this browser tab and is not saved.</p>
        </div>

        <div className="field">
          <label htmlFor="model">Model</label>
          <input
            id="model"
            list="available-models"
            value={selectedModel}
            onChange={(event) => setSelectedModel(event.target.value)}
            placeholder={models.length > 0 ? 'Search models…' : 'Refresh the model list first'}
            disabled={models.length === 0}
            autoComplete="off"
          />
          <datalist id="available-models">
            {modelOptions.map((model) => (
              <option key={model.id} value={model.id} label={model.label} />
            ))}
          </datalist>
          <p className={hasError ? 'status error' : 'status'} role="status">
            {message}
          </p>
        </div>

        <div className="generation-actions">
          <button
            className="generate-button"
            type="button"
            onClick={generateContinuation}
            disabled={isGenerating || isLoading}
          >
            {isGenerating ? 'Generating…' : 'Generate'}
          </button>
          {generationMessage ? (
            <p className={generationError ? 'status error' : 'status'} role="status">
              {generationMessage}
            </p>
          ) : null}
        </div>
      </section>
    </main>
  )
}

import assert from 'node:assert/strict'
import test from 'node:test'

test('NanoGPT audio model requests use supported type filters', async () => {
  const requestedUrls = []
  globalThis.fetch = async (input) => {
    requestedUrls.push(String(input))
    const type = new URL(String(input)).searchParams.get('type')
    return new Response(JSON.stringify({ data: type === 'tts' ? [
      {
        id: 'xai-tts',
        name: 'SpaceXAI TTS',
        pricing: { per_thousand_chars: 0.0165, currency: 'USD' },
        capabilities: { text_to_speech: true },
        supported_parameters: { max_chars: 5000, voices: ['Eve', 'Ara'] },
      },
      {
        id: 'music-model',
        name: 'Not speech',
        pricing: { per_generation: 0.1, currency: 'USD' },
        capabilities: { text_to_music: true },
      },
    ] : [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  const cacheBust = Date.now()
  const { fetchSpeechModels } = await import(`../src/tts-service.ts?audio-model-filter=${cacheBust}`)
  const { fetchTranscriptionModels } = await import(`../src/stt-service.ts?audio-model-filter=${cacheBust}`)

  const speechModels = await fetchSpeechModels('test-key')
  await fetchTranscriptionModels({
    apiKey: 'test-key',
    openaiApiKey: '',
  })

  assert.equal(requestedUrls.length, 2)
  assert.equal(new URL(requestedUrls[0]).searchParams.get('type'), 'tts')
  assert.equal(new URL(requestedUrls[1]).searchParams.get('type'), 'stt')
  assert.deepEqual(speechModels, [{
    id: 'xai-tts',
    name: 'SpaceXAI TTS',
    voices: ['Eve', 'Ara'],
    price: '$0.0165 / 1k chars',
    maxChars: 5000,
  }])
})

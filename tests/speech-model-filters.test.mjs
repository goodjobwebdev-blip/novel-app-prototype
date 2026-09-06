import assert from 'node:assert/strict'
import test from 'node:test'

test('NanoGPT audio model requests use supported type filters', async () => {
  const requestedUrls = []
  globalThis.fetch = async (input) => {
    requestedUrls.push(String(input))
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  const cacheBust = Date.now()
  const { fetchSpeechModels } = await import(`../src/tts-service.ts?audio-model-filter=${cacheBust}`)
  const { fetchTranscriptionModels } = await import(`../src/stt-service.ts?audio-model-filter=${cacheBust}`)

  await fetchSpeechModels('test-key')
  await fetchTranscriptionModels({
    apiKey: 'test-key',
    openaiApiKey: '',
  })

  assert.equal(requestedUrls.length, 2)
  assert.equal(new URL(requestedUrls[0]).searchParams.get('type'), 'tts')
  assert.equal(new URL(requestedUrls[1]).searchParams.get('type'), 'stt')
})

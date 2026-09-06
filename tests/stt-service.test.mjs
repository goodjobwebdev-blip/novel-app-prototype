import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTranscriptForInsertion, openAiSupportsLiveTranscription, parseTranscriptionModelId, transcriptionModelUnavailable } from '../src/stt-service.ts'

test('provider-qualified transcription model IDs are collision safe', () => {
  assert.deepEqual(parseTranscriptionModelId('openai:whisper-1'), { provider: 'openai', modelId: 'whisper-1' })
  assert.deepEqual(parseTranscriptionModelId('nanogpt:whisper-1'), { provider: 'nanogpt', modelId: 'whisper-1' })
  assert.equal(parseTranscriptionModelId('whisper-1'), null)
  assert.equal(parseTranscriptionModelId('other:model'), null)
})

test('transcript insertion only normalizes transport whitespace and word boundaries', () => {
  assert.equal(normalizeTranscriptForInsertion('  Hello, World!  ', '', ''), 'Hello, World!')
  assert.equal(normalizeTranscriptForInsertion('world', 'hello', ''), ' world')
  assert.equal(normalizeTranscriptForInsertion('hello', '', 'world'), 'hello ')
  assert.equal(normalizeTranscriptForInsertion('—hello!', 'word ', ' next'), '—hello!')
})


test('OpenAI live capability only advertises models Arc can stream as partial dictation', () => {
  for (const model of ['gpt-live-transcribe', 'gpt-realtime-whisper', 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe']) {
    assert.equal(openAiSupportsLiveTranscription(model), true, model)
  }
  for (const model of ['whisper-1', 'gpt-transcribe', 'gpt-4o-transcribe-diarize']) {
    assert.equal(openAiSupportsLiveTranscription(model), false, model)
  }
})


test('model unavailability is scoped to the selected provider catalog', () => {
  const nanoOnly = [{ id: 'nanogpt:whisper-large-v3', provider: 'nanogpt', modelId: 'whisper-large-v3', name: 'Whisper Large V3', supportsFile: true, supportsLive: false }]
  assert.equal(transcriptionModelUnavailable(nanoOnly, 'openai', 'openai:whisper-1'), false)
  assert.equal(transcriptionModelUnavailable(nanoOnly, 'nanogpt', 'nanogpt:missing'), true)
  assert.equal(transcriptionModelUnavailable(nanoOnly, 'nanogpt', 'nanogpt:whisper-large-v3'), false)
})

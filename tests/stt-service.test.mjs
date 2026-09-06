import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTranscriptForInsertion, parseTranscriptionModelId } from '../src/stt-service.ts'

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

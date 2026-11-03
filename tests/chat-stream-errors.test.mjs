import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const url = new URL(specifier + '.ts', context.parentURL)
    if (existsSync(fileURLToPath(url))) return nextResolve(url.href, context)
  }
  return nextResolve(specifier, context)
} })
const { streamChatCompletion } = await import('../src/features/chat/chat-api.ts')
const request = { provider: 'compatible', apiKey: 'test-only-secret', baseUrl: 'https://provider.invalid/v1', model: 'test', messages: [{ role: 'user', content: 'Create a scene' }], thinking: true }
const event = (delta, finish_reason) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\n\n`
const tool = { index: 0, id: 'scene-call', type: 'function', function: { name: 'propose_scene_create', arguments: '{"title":"Next"}' } }
function mockStream(t, text) {
  const response = new Response(text, { headers: { 'Content-Type': 'text/event-stream' } })
  t.mock.method(globalThis, 'fetch', async () => response)
  return response
}

test('chat rejects a disconnected stream after thoughts or partial tool arguments', async t => {
  for (const delta of [{ reasoning_content: 'Planning the scene' }, { tool_calls: [{ ...tool, function: { ...tool.function, arguments: '{"title":' } }] }]) {
    const response = mockStream(t, event(delta))
    await assert.rejects(streamChatCompletion(request, () => {}, new AbortController().signal), /did not complete|interrupted/i)
    assert.equal(response.body.locked, false)
  }
})

test('chat surfaces in-band provider errors with credentials redacted', async t => {
  for (const payload of [{ error: { message: 'Quota exceeded for test-only-secret' } }, { type: 'error', message: 'Quota exceeded for test-only-secret' }, { object: 'error', message: 'Quota exceeded for test-only-secret' }]) {
    mockStream(t, event({ reasoning_content: 'Thinking' }) + `data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`)
    await assert.rejects(streamChatCompletion(request, () => {}, new AbortController().signal), error => {
      assert.match(error.message, /Quota exceeded for \[redacted\]/)
      assert.doesNotMatch(error.message, /test-only-secret/)
      return true
    })
  }
})

test('chat explains token exhaustion and filtering instead of accepting truncated tools', async t => {
  for (const [reason, message] of [['length', /token limit/i], ['content_filter', /content filter/i], ['error', /error/]]) {
    mockStream(t, event({ tool_calls: [tool] }, reason) + 'data: [DONE]\n\n')
    await assert.rejects(streamChatCompletion(request, () => {}, new AbortController().signal), message)
  }
})

test('thoughts-only completion is not a successful chat answer even with DONE', async t => {
  mockStream(t, event({ reasoning_content: 'Planning' }, 'stop') + 'data: [DONE]\n\n')
  await assert.rejects(streamChatCompletion(request, () => {}, new AbortController().signal), /without.*answer|only.*reasoning/i)
})

test('chat accepts normal text and complete tool rounds with DONE or a finish reason', async t => {
  for (const [delta, finish, done] of [[{ content: 'Answer' }, 'stop', false], [{ content: 'Answer' }, undefined, true], [{ tool_calls: [tool] }, 'tool_calls', false], [{ tool_calls: [tool] }, 'tool_calls', true]]) {
    mockStream(t, event(delta, finish) + (done ? 'data: [DONE]\n\n' : ''))
    const result = await streamChatCompletion(request, () => {}, new AbortController().signal)
    assert.equal(result.toolCalls.length, delta.tool_calls ? 1 : 0)
  }
})

test('strict text-only callers still reject tool completions', async t => {
  mockStream(t, event({ tool_calls: [tool] }, 'tool_calls') + 'data: [DONE]\n\n')
  await assert.rejects(streamChatCompletion({ ...request, requireComplete: true }, () => {}, new AbortController().signal), /incomplete/)
})

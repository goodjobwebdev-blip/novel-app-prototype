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
const request = { provider: 'compatible', apiKey: 'test-only-secret', baseUrl: 'https://provider.invalid/v1', model: 'test', messages: [{ role: 'user', content: 'Create a scene' }], thinking: true, validateChatResponse: true }
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

test('diagnostics describe a stalled tool stream without leaking arguments or keys', async t => {
  let now = 0
  t.mock.method(Date, 'now', () => now)
  let reads = 0
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    pull(controller) {
      if (reads++ === 0) {
        now = 1000
        controller.enqueue(new TextEncoder().encode(event({ tool_calls: [tool] })))
      } else {
        now = 121000
        controller.enqueue(new TextEncoder().encode('data: {"error":{"message":"Request timed out. Please try again later."}}\n\n'))
        controller.close()
      }
    },
  }, { highWaterMark: 0 })))
  await assert.rejects(streamChatCompletion({ ...request, diagnosticRound: 2, tools: [{ type: 'function', function: { name: tool.function.name, parameters: {} } }] }, () => {}, new AbortController().signal), error => {
    assert.match(error.message, /Request timed out\. Please try again later\./)
    assert.match(error.message, /Round: 2/)
    assert.match(error.message, /Tool: propose_scene_create/)
    assert.match(error.message, /Tool arguments received: yes/)
    assert.match(error.message, /Request duration: 121 s/)
    assert.match(error.message, /Last fragment before error: 120 s ago/)
    assert.match(error.message, /Gap before last network chunk: 120 s/)
    assert.doesNotMatch(error.message, /Next|test-only-secret/)
    return true
  })
})

test('diagnostics distinguish HTTP failures and failures before response headers', async t => {
  for (const http of [false, true]) {
    t.mock.method(globalThis, 'fetch', async () => {
      if (!http) throw new TypeError('Failed to fetch')
      return new Response('{"error":{"message":"Request timed out"}}', { status: 504 })
    })
    await assert.rejects(streamChatCompletion({ ...request, diagnosticRound: 1 }, () => {}, new AbortController().signal), error => {
      assert.match(error.message, http ? /Stage: HTTP response; HTTP: 504/ : /Stage: waiting for response; HTTP: none/)
      assert.match(error.message, /Tool: not received/)
      assert.match(error.message, /Tool arguments received: no/)
      assert.match(error.message, /Last fragment before error: none/)
      return true
    })
  }
})

test('diagnostics do not wrap cancellation', async t => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(streamChatCompletion({ ...request, diagnosticRound: 1 }, () => {}, controller.signal), error => error.name === 'AbortError' && !error.message.includes('Round:'))
})

test('diagnostics identify provider stream errors and preserve only safe type/code fields', async t => {
  for (const [prefix, payload] of [
    ['', { error: { message: 'Request timed out. Please try again later.', type: 'timeout_error', code: 504, arguments: 'private scene' } }],
    ['', { type: 'error', message: 'Request timed out', code: 'timeout' }],
    ['event: error\n', { message: 'Request timed out', type: 'test-only-secret', code: 'test-only-secret' }],
    ['event: error\n', null],
  ]) {
    mockStream(t, `${prefix}data: ${JSON.stringify(payload)}\n\n`)
    await assert.rejects(streamChatCompletion({ ...request, diagnosticRound: 5 }, () => {}, new AbortController().signal), error => {
      assert.match(error.message, /Error source: provider stream/)
      if (payload?.error) assert.match(error.message, /Error type: "timeout_error"; Error code: 504/)
      if (payload?.code === 'timeout') assert.match(error.message, /Error type: "error"; Error code: "timeout"/)
      assert.doesNotMatch(error.message, /private scene|test-only-secret/)
      return true
    })
  }
})

test('diagnostics distinguish stream read failures from malformed provider data', async t => {
  for (const network of [true, false]) {
    t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
      start(controller) {
        if (network) controller.error(new TypeError('network error'))
        else { controller.enqueue(new TextEncoder().encode('data: {invalid}\n\n')); controller.close() }
      },
    })))
    await assert.rejects(streamChatCompletion({ ...request, diagnosticRound: 2 }, () => {}, new AbortController().signal), error => {
      assert.match(error.message, network ? /Error source: stream read/ : /Error source: stream parsing/)
      assert.match(error.message, network ? /Error type: "TypeError"/ : /Error type: "SyntaxError"/)
      assert.match(error.message, /HTTP: 200/)
      return true
    })
  }
})

test('strict text-only callers still reject tool completions', async t => {
  mockStream(t, event({ tool_calls: [tool] }, 'tool_calls') + 'data: [DONE]\n\n')
  await assert.rejects(streamChatCompletion({ ...request, requireComplete: true }, () => {}, new AbortController().signal), /incomplete/)
})

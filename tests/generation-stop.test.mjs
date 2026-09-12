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
const { streamChatCompletion } = await import('../src/chat-api.ts')
const { streamTextProviderCompletion } = await import('../src/text-provider.ts')
const request = { provider: 'nanogpt', task: 'story', apiKey: 'test-only', baseUrl: 'https://provider.invalid/v1', model: 'test', messages: [{ role: 'user', content: 'Continue' }], thinking: true, systemPrompt: '', userMessage: '' }
const encoder = new TextEncoder()
const event = delta => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`
const nextTurn = () => new Promise(resolve => setImmediate(resolve))
function deferred() { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
async function promptly(pending) {
  let timer
  try { return await Promise.race([pending, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Stop did not settle the generation')), 500) })]) }
  finally { clearTimeout(timer) }
}
function stalledResponse(initial = '', cancel = () => {}) {
  let source
  const response = new Response(new ReadableStream({
    start(controller) { source = controller; if (initial) controller.enqueue(encoder.encode(initial)) },
    cancel,
  }))
  return { response, source }
}

for (const [name, run] of [['chat', streamChatCompletion], ['writing', streamTextProviderCompletion]]) {
  test(`${name}: Stop releases a stalled response even when stream cancellation never settles`, async t => {
    const entered = deferred()
    let cancelled = 0
    const { response } = stalledResponse('', () => { cancelled++; return new Promise(() => {}) })
    t.mock.method(globalThis, 'fetch', async () => response)
    const controller = new AbortController()
    const chunks = []
    const lifecycle = name === 'chat' ? () => entered.resolve() : { onResponse: () => entered.resolve() }
    const pending = run(request, chunk => chunks.push(chunk), controller.signal, lifecycle)
    const rejected = assert.rejects(promptly(pending), { name: 'AbortError' })
    await entered.promise
    await nextTurn()
    controller.abort()
    await rejected
    assert.deepEqual(chunks, [])
    assert.equal(cancelled, 1)
    assert.equal(response.body.locked, false)
  })

  test(`${name}: Stop preserves delivered text and ignores later events in the same chunk`, async t => {
    let cancelled = 0
    const { response } = stalledResponse(event({ content: 'Partial' }) + event({ content: 'Too late', reasoning_content: 'Late thought' }), () => { cancelled++ })
    t.mock.method(globalThis, 'fetch', async () => response)
    const controller = new AbortController()
    const chunks = []
    const thoughts = []
    const pending = run(request, chunk => { chunks.push(chunk); controller.abort() }, controller.signal, name === 'chat' ? undefined : { onThoughts: text => thoughts.push(text) })
    await assert.rejects(promptly(pending), { name: 'AbortError' })
    assert.deepEqual(chunks, name === 'chat' ? [{ content: 'Partial', thoughts: undefined }] : ['Partial'])
    assert.deepEqual(thoughts, [])
    assert.equal(cancelled, 1)
    assert.equal(response.body.locked, false)
  })

  test(`${name}: Stop before headers returns promptly and closes a late response`, async t => {
    const headers = deferred()
    const started = deferred()
    let cancelled = 0
    const { response } = stalledResponse(event({ content: 'Too late' }), () => { cancelled++ })
    t.mock.method(globalThis, 'fetch', () => { started.resolve(); return headers.promise })
    const controller = new AbortController()
    const chunks = []
    let responses = 0
    const lifecycle = name === 'chat' ? () => responses++ : { onResponse: () => responses++ }
    const pending = run(request, chunk => chunks.push(chunk), controller.signal, lifecycle)
    const rejected = assert.rejects(promptly(pending), { name: 'AbortError' })
    await started.promise
    controller.abort()
    try { await rejected }
    finally { headers.resolve(response); await nextTurn() }
    assert.deepEqual(chunks, [])
    assert.equal(responses, 0)
    assert.equal(cancelled, 1)
  })

  test(`${name}: an already stopped request never contacts the provider`, async t => {
    const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected request') })
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(run(request, () => assert.fail('Unexpected chunk'), controller.signal), { name: 'AbortError' })
    assert.equal(fetch.mock.callCount(), 0)
  })

  test(`${name}: DONE closes the stream and permits a new generation`, async t => {
    const responses = []
    let cancelled = 0
    t.mock.method(globalThis, 'fetch', async () => {
      const { response } = stalledResponse(event({ content: 'Answer' }) + 'data: [DONE]\n\n', () => { cancelled++ })
      responses.push(response)
      return response
    })
    for (let index = 0; index < 2; index++) {
      const chunks = []
      await promptly(run(request, chunk => chunks.push(chunk), new AbortController().signal))
      assert.equal(chunks.length, 1)
      assert.equal(responses[index].body.locked, false)
    }
    assert.equal(cancelled, 2)
  })

  test(`${name}: fragmented UTF-8, tool calls, usage and the final unterminated line survive cleanup`, async t => {
    const payloads = [
      { id: 'response-1', model: 'test', choices: [{ delta: { content: 'Café', reasoning_content: 'Thought', tool_calls: [{ index: 0, id: 'call-1', function: { name: 'read', arguments: '{"q":' } }] } }] },
      { choices: [{ delta: { content: ' answer', tool_calls: [{ index: 0, function: { arguments: '"text"}' } }] }, finish_reason: 'stop' }] },
      { usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7, prompt_tokens_details: { cached_tokens: 3 } } },
    ]
    const bytes = encoder.encode(payloads.map(payload => `data: ${JSON.stringify(payload)}`).join('\r\n\r\n'))
    const response = new Response(new ReadableStream({ start(controller) {
      for (let offset = 0; offset < bytes.length; offset += 3) controller.enqueue(bytes.slice(offset, offset + 3))
      controller.close()
    } }))
    t.mock.method(globalThis, 'fetch', async () => response)
    const chunks = [], thoughts = [], metadata = []
    const result = await run(request, chunk => chunks.push(chunk), new AbortController().signal, name === 'chat' ? undefined : { onThoughts: text => thoughts.push(text), onMetadata: value => metadata.push(value) })
    assert.equal(chunks.map(chunk => typeof chunk === 'string' ? chunk : chunk.content ?? '').join(''), 'Café answer')
    assert.equal(response.body.locked, false)
    if (name === 'chat') {
      assert.deepEqual(result.toolCalls, [{ id: 'call-1', type: 'function', function: { name: 'read', arguments: '{"q":"text"}' } }])
      assert.equal(result.finishReason, 'stop')
      assert.equal(result.usage.totalTokens, 7)
      assert.equal(result.usage.cachedTokens, 3)
      assert.equal(chunks[0].thoughts, 'Thought')
    } else {
      assert.deepEqual(thoughts, ['Thought'])
      assert.equal(metadata.at(-1).totalTokens, 7)
    }
  })

  test(`${name}: malformed events release the reader; provider errors still redact credentials`, async t => {
    let cancelled = 0
    const { response } = stalledResponse('data: invalid-json\n\n', () => { cancelled++ })
    const fetch = t.mock.method(globalThis, 'fetch', async () => response)
    await assert.rejects(run(request, () => {}, new AbortController().signal), SyntaxError)
    assert.equal(cancelled, 1)
    assert.equal(response.body.locked, false)
    fetch.mock.mockImplementation(async () => new Response(JSON.stringify({ error: { message: 'Limit for test-only' } }), { status: 429 }))
    await assert.rejects(run(request, () => {}, new AbortController().signal), /Limit for \[redacted\]/)
  })

  test(`${name}: Stop also interrupts a stalled provider error body`, async t => {
    let cancelled = 0
    const response = new Response(new ReadableStream({
      start(controller) { controller.enqueue(encoder.encode('{')) },
      cancel() { cancelled++ },
    }), { status: 500 })
    t.mock.method(globalThis, 'fetch', async () => response)
    const controller = new AbortController()
    const pending = run(request, () => assert.fail('Unexpected chunk'), controller.signal)
    const rejected = assert.rejects(promptly(pending), { name: 'AbortError' })
    await nextTurn()
    controller.abort()
    await rejected
    assert.equal(cancelled, 1)
    assert.equal(response.body.locked, false)
  })
}

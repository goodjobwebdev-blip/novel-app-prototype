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
const { buildAutocompleteRequest, requestAutocompleteCompletion, sanitizeAutocompleteCompletion, createAutocompleteController } = await import('../src/features/writing/autocomplete.ts')
const { streamTextProviderCompletion } = await import('../src/shared/ai/text-provider.ts')
const { getFakeProviderTrace, clearFakeProviderTrace } = await import('../src/shared/ai/fake-provider.ts')
const encoder = new TextEncoder()
const nextTurn = () => new Promise(resolve => setImmediate(resolve))
const event = (content, extra = {}, finishReason) => `data: ${JSON.stringify({ choices: [{ delta: { content, ...extra }, ...(finishReason !== undefined ? { finish_reason: finishReason } : {}) }] })}\n\n`
const finish = reason => event('', {}, reason)
const done = 'data: [DONE]\n\n'
function input(provider = 'fake', length = 'phrase') {
  const document = 'The door opened'
  return {
    snapshot: { editorId: 'one', revision: 1, document, from: document.length, to: document.length, text: '' },
    configurationKey: 'opaque', writing: { pov: 'third', tense: 'past', style: 'spare', language: 'English' },
    settings: { provider, apiKey: 'test-secret', baseUrl: 'https://provider.invalid/v1', mainModel: '', autocomplete: { enabled: true, model: provider === 'fake' ? 'fake/test' : 'exact/model', delayMs: 100, length } },
  }
}
function response(t, data) {
  const stream = new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(data)); controller.close() } })
  t.after(async () => { if (!stream.locked) await stream.cancel().catch(() => {}) })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
}
function stalledResponse(t, initial) {
  let cancelled = 0
  const stream = new ReadableStream({
    start(controller) { if (initial) controller.enqueue(encoder.encode(initial)) },
    cancel() { cancelled += 1 },
  })
  t.after(async () => { if (!stream.locked) await stream.cancel().catch(() => {}) })
  return { response: new Response(stream), cancelled: () => cancelled }
}

for (const provider of ['nanogpt', 'litellm']) {
  for (const length of ['phrase', 'sentence']) {
    test(`${provider} transports the ${length} token ceiling and explicit autocomplete messages`, async t => {
      const request = buildAutocompleteRequest(input(provider, length))
      assert.equal(request.requireComplete, true)
      const payloads = []
      const streams = []
      t.mock.method(globalThis, 'fetch', async (url, init) => {
        assert.equal(url, 'https://provider.invalid/v1/chat/completions')
        payloads.push(JSON.parse(init.body))
        const value = response(t, event(' quietly') + 'data: [DONE]\n\n')
        streams.push(value)
        return value
      })
      const abort = new AbortController()
      t.after(() => abort.abort())
      assert.equal(await requestAutocompleteCompletion(request, abort.signal), ' quietly')
      assert.equal(payloads.length, 1)
      const payload = payloads[0]
      assert.equal(payload.max_tokens, length === 'phrase' ? 64 : 128)
      assert.equal(payload.model, 'exact/model')
      assert.equal(payload.stream, true)
      assert.equal(payload.messages.length, 2)
      assert.equal(payload.messages[1].role, 'user')
      assert.equal(JSON.parse(payload.messages[1].content).manuscript, 'The door opened')
      assert.equal(payload.reasoning, undefined)
      assert.equal(payload.reasoning_effort, undefined)
      assert.equal(Object.hasOwn(payload, 'requireComplete'), false)
      assert.equal(streams[0].body.locked, false)
    })
  }

  test(`${provider} preserves legacy requests without introducing a max_tokens field`, async t => {
    const request = { ...buildAutocompleteRequest(input(provider)), task: 'story' }
    delete request.maxTokens
    let payload
    t.mock.method(globalThis, 'fetch', async (_url, init) => {
      payload = JSON.parse(init.body)
      return response(t, event(' text') + 'data: [DONE]\n\n')
    })
    const abort = new AbortController()
    t.after(() => abort.abort())
    await streamTextProviderCompletion(request, () => {}, abort.signal)
    assert.equal(Object.hasOwn(payload, 'max_tokens'), false)
  })

  for (const [name, ending, expectedReason] of [
    ['DONE without a finish reason', done, undefined],
    ['real stop at EOF', finish('stop'), 'stop'],
    ['real stop followed by usage and DONE', finish('stop') + 'data: {"choices":[],"usage":{"completion_tokens":3}}\n\n' + done, 'stop'],
  ]) {
    test(`${provider} accepts ${name} and preserves the real finish reason`, async t => {
      const streams = []
      t.mock.method(globalThis, 'fetch', async () => {
        const value = response(t, event(' quietly') + ending)
        streams.push(value)
        return value
      })
      const abort = new AbortController()
      t.after(() => abort.abort())
      let content = ''
      const result = await streamTextProviderCompletion(buildAutocompleteRequest(input(provider)), chunk => { content += chunk }, abort.signal)
      assert.equal(content, ' quietly')
      assert.equal(result.finishReason, expectedReason)
      assert.equal(streams[0].body.locked, false)
    })
  }

  for (const [name, ending, expectedError] of [
    ['structured SSE error after partial text', 'data: {"error":{"message":"test-secret manuscript"}}\n\n' + done, 'The provider returned a streaming error.'],
    ['typed SSE error after partial text', 'data: {"type":"error","message":"test-secret manuscript"}\n\n', 'The provider returned a streaming error.'],
    ['named SSE error event after partial text', 'event: error\ndata: {"message":"test-secret manuscript"}\n\n', 'The provider returned a streaming error.'],
    ['premature EOF after partial text', '', 'The provider did not complete the response.'],
    ...['length', 'content_filter', 'error', 'incomplete'].map(reason => [`${reason} termination despite DONE`, finish(reason) + done, 'The provider returned an incomplete response.']),
  ]) {
    test(`${provider} rejects ${name}, discards partial autocomplete and reports only a generic error`, async t => {
      t.mock.timers.enable({ apis: ['setTimeout'] })
      const streams = []
      const network = t.mock.method(globalThis, 'fetch', async () => {
        const value = response(t, event(' partial') + ending)
        streams.push(value)
        return value
      })
      const abort = new AbortController()
      t.after(() => abort.abort())
      let content = ''
      await assert.rejects(streamTextProviderCompletion(buildAutocompleteRequest(input(provider)), chunk => { content += chunk }, abort.signal), error => {
        assert.equal(error.message, expectedError)
        assert.doesNotMatch(error.message, /test-secret|manuscript/)
        return true
      })
      assert.equal(content, ' partial')
      assert.equal(streams[0].body.locked, false)
      const shown = [], errorArgumentCounts = []
      const controller = createAutocompleteController({
        onSuggestion: value => { if (value) shown.push(value) },
        onError: (...args) => errorArgumentCounts.push(args.length),
        isCurrent: () => true,
      })
      t.after(() => controller.dispose())
      controller.schedule(input(provider))
      t.mock.timers.tick(100)
      await nextTurn()
      assert.equal(shown.length, 0)
      assert.equal(errorArgumentCounts.length, 1)
      assert.equal(errorArgumentCounts[0], 0)
      assert.equal(streams[1].body.locked, false)
      t.mock.timers.tick(20_000)
      await nextTurn()
      assert.equal(errorArgumentCounts.length, 1)
      assert.equal(network.mock.callCount(), 2)
    })
  }

  for (const [name, ending] of [['EOF', ''], ['length termination', finish('length') + done]]) {
    test(`${provider} retains non-autocomplete behavior on ${name}`, async t => {
      t.mock.method(globalThis, 'fetch', async () => response(t, event(' partial') + ending))
      const abort = new AbortController()
      t.after(() => abort.abort())
      let content = ''
      // The task boundary, not an inherited flag, enables strict autocomplete checks.
      await streamTextProviderCompletion({ ...buildAutocompleteRequest(input(provider)), task: 'story' }, chunk => { content += chunk }, abort.signal)
      assert.equal(content, ' partial')
    })
  }

  test(`${provider} keeps partial text invisible and times out a stalled body at ten seconds`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const value = stalledResponse(t, event(' partial'))
    t.mock.method(globalThis, 'fetch', async () => value.response)
    const suggestions = []
    let errors = 0
    const controller = createAutocompleteController({ onSuggestion: value => suggestions.push(value), onError: () => { errors += 1 }, isCurrent: () => true })
    t.after(() => controller.dispose())
    controller.schedule(input(provider))
    t.mock.timers.tick(100)
    await nextTurn()
    assert.equal(suggestions.filter(Boolean).length, 0)
    assert.equal(errors, 0)
    t.mock.timers.tick(9_999)
    assert.equal(errors, 0)
    t.mock.timers.tick(1)
    await nextTurn()
    assert.equal(errors, 1)
    assert.equal(suggestions.filter(Boolean).length, 0)
    assert.equal(value.cancelled(), 1)
    assert.equal(value.response.body.locked, false)
    t.mock.timers.tick(20_000)
    assert.equal(errors, 1)
  })

  test(`${provider} does not display partial text on transport failure or leak provider secrets`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    let source
    const stream = new ReadableStream({ start(controller) { source = controller; controller.enqueue(encoder.encode(event(' partial'))) } })
    t.after(async () => { if (!stream.locked) await stream.cancel().catch(() => {}) })
    t.mock.method(globalThis, 'fetch', async () => new Response(stream))
    const shown = [], errorArgumentCounts = []
    const controller = createAutocompleteController({ onSuggestion: value => { if (value) shown.push(value) }, onError: (...args) => errorArgumentCounts.push(args.length), isCurrent: () => true })
    t.after(() => controller.dispose())
    controller.schedule(input(provider))
    t.mock.timers.tick(100)
    await nextTurn()
    source.error(new Error('test-secret and manuscript'))
    await nextTurn()
    assert.equal(shown.length, 0)
    assert.equal(errorArgumentCounts.length, 1)
    assert.equal(errorArgumentCounts[0], 0)
    assert.equal(stream.locked, false)
  })
}

test('Fake autocomplete is local and deterministic, preserves leading whitespace and traces the ceiling', async t => {
  clearFakeProviderTrace()
  t.after(() => clearFakeProviderTrace())
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No paid network allowed') })
  for (const length of ['phrase', 'sentence']) {
    const request = buildAutocompleteRequest(input('fake', length))
    const abort = new AbortController()
    t.after(() => abort.abort())
    const result = await requestAutocompleteCompletion(request, abort.signal)
    assert.equal(result, ' and the story continued.')
    assert.equal(sanitizeAutocompleteCompletion(result, 'The door opened', length), result)
    const trace = getFakeProviderTrace().at(-1)
    assert.equal(trace.task, 'autocomplete')
    assert.equal(trace.maxTokens, length === 'phrase' ? 64 : 128)
    assert.equal(trace.model, 'fake/test')
    assert.equal(trace.outcome, 'complete')
    assert.equal(trace.emittedContent, result)
    assert.equal(trace.thinking, false)
  }
  assert.equal(network.mock.callCount(), 0)
})

test('Fake cancellation closes the request quietly and records an aborted autocomplete attempt', async t => {
  clearFakeProviderTrace()
  t.after(() => clearFakeProviderTrace())
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('No paid network allowed') })
  const abort = new AbortController()
  t.after(() => abort.abort())
  const request = buildAutocompleteRequest(input())
  request.messages = [{ role: 'user', content: '[DELAY_MS:100] delayed completion' }]
  const pending = requestAutocompleteCompletion(request, abort.signal)
  const rejected = assert.rejects(pending, { name: 'AbortError' })
  abort.abort()
  await rejected
  assert.equal(getFakeProviderTrace().at(-1).task, 'autocomplete')
  assert.equal(getFakeProviderTrace().at(-1).maxTokens, 64)
  assert.equal(getFakeProviderTrace().at(-1).outcome, 'aborted')
})

test('buffer stays bounded and rejects provider output that exceeds the response ceiling', async t => {
  t.mock.method(globalThis, 'fetch', async () => response(t, event('x'.repeat(20_000)) + 'data: [DONE]\n\n'))
  const abort = new AbortController()
  t.after(() => abort.abort())
  const result = await requestAutocompleteCompletion(buildAutocompleteRequest(input('nanogpt', 'sentence')), abort.signal)
  assert.equal(result.length, 601)
  assert.equal(sanitizeAutocompleteCompletion(result, 'The door opened', 'sentence'), null)
})

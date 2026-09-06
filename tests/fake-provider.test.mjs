import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/fake-provider.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText
const fake = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

function user(content) {
  return { role: 'user', content }
}

async function run(content, options = {}) {
  const chunks = []
  const thoughts = []
  let responses = 0
  const controller = options.controller ?? new AbortController()
  const result = await fake.streamFakeProvider({
    task: options.task ?? 'chat',
    model: fake.FAKE_PROVIDER_MODEL.id,
    messages: options.messages ?? [user(content)],
    tools: options.tools,
    thinking: options.thinking ?? false,
  }, {
    onResponse: () => { responses += 1 },
    onContent: (chunk) => chunks.push(chunk),
    onThoughts: (chunk) => thoughts.push(chunk),
  }, controller.signal)
  return { result, content: chunks.join(''), thoughts: thoughts.join(''), responses }
}

const tool = (name) => ({ type: 'function', function: { name, description: 'test tool', parameters: { type: 'object' } } })

test('Fake exposes exactly one stable local model and deterministic task fixtures', async () => {
  assert.deepEqual(fake.FAKE_PROVIDER_MODEL, {
    id: 'fake/test',
    name: 'Fake Test Model',
    context_length: 32_768,
  })
  const expected = {
    story: 'FAKE TEST OUTPUT — Story generation.',
    codex: 'FAKE TEST OUTPUT — Codex generation.',
    summary: 'FAKE TEST OUTPUT — Summary generation.',
    autotitle: 'Fake Test Title',
    chat: 'FAKE TEST RESPONSE',
  }
  for (const [task, output] of Object.entries(expected)) {
    const value = await run('[DELAY_MS:0]', { task })
    assert.equal(value.content, output)
    assert.equal(value.responses, 1)
    assert.equal(value.result.finishReason, 'stop')
  }
})

test('ordinary scripted text streams deterministically with control directives removed', async () => {
  const value = await run('[DELAY_MS:0]Alpha beta gamma')
  assert.equal(value.content, 'Alpha beta gamma')
  assert.equal(value.thoughts, '')
})

test('REQUEST_FAIL fails before response lifecycle or content', async () => {
  let responses = 0
  let content = ''
  await assert.rejects(
    fake.streamFakeProvider({ task: 'chat', model: 'fake/test', messages: [user('[REQUEST_FAIL] should never stream')] }, {
      onResponse: () => { responses += 1 },
      onContent: (chunk) => { content += chunk },
    }, new AbortController().signal),
    { message: 'Fake provider: deliberate request failure.' },
  )
  assert.equal(responses, 0)
  assert.equal(content, '')
  assert.equal(fake.getFakeProviderTrace().at(-1).outcome, 'failed')
})

test('STREAM_FAIL emits only preceding scripted text and then fails exactly', async () => {
  let content = ''
  await assert.rejects(
    fake.streamFakeProvider({ task: 'story', model: 'fake/test', messages: [user('[DELAY_MS:0]before failure [STREAM_FAIL] after failure')] }, {
      onContent: (chunk) => { content += chunk },
    }, new AbortController().signal),
    { message: 'Fake provider: deliberate stream failure.' },
  )
  assert.equal(content, 'before failure')
  assert.ok(!content.includes('after failure'))
})

test('DELAY_MS is abortable so Stop interrupts mid-stream and traces aborted outcome', async () => {
  fake.clearFakeProviderTrace()
  const controller = new AbortController()
  let content = ''
  const pending = fake.streamFakeProvider({ task: 'story', model: 'fake/test', messages: [user('[DELAY_MS:40]one two three four')] }, {
    onContent: (chunk) => { content += chunk },
  }, controller.signal)
  setTimeout(() => controller.abort(), 65)
  await assert.rejects(pending, (error) => error?.name === 'AbortError')
  assert.ok(content.startsWith('one'))
  assert.notEqual(content.trim(), 'one two three four')
  assert.equal(fake.getFakeProviderTrace().at(-1).outcome, 'aborted')
})

test('THOUGHTS streams through the normal reasoning channel only when thinking is enabled', async () => {
  const enabled = await run('[DELAY_MS:0][THOUGHTS:reasoning here]final answer', { thinking: true })
  assert.equal(enabled.thoughts, 'reasoning here')
  assert.equal(enabled.content, 'final answer')

  const disabled = await run('[DELAY_MS:0][THOUGHTS:reasoning here]final answer', { thinking: false })
  assert.equal(disabled.thoughts, '')
  assert.equal(disabled.content, 'final answer')
})

test('invoke_tool preserves nested JSON with colons and commas and emits a normal tool call', async () => {
  const value = await run('[DELAY_MS:0][invoke_tool:read_entity:{"id":"scene:1","meta":{"label":"a,b:c","count":2}}]after tool', {
    tools: [tool('read_entity')],
  })
  assert.equal(value.content, '')
  assert.equal(value.result.finishReason, 'tool_calls')
  assert.equal(value.result.toolCalls.length, 1)
  assert.equal(value.result.toolCalls[0].function.name, 'read_entity')
  assert.deepEqual(JSON.parse(value.result.toolCalls[0].function.arguments), {
    id: 'scene:1',
    meta: { label: 'a,b:c', count: 2 },
  })
})

test('invoke_tool rejects tools not supplied by the real request boundary', async () => {
  await assert.rejects(
    run('[DELAY_MS:0][invoke_tool:not_available:{"x":1}]', { tools: [tool('read_entity')] }),
    { message: 'Fake provider: tool "not_available" is not available in this request.' },
  )
})

test('tool-result follow-up does not reinvoke and supports default or scripted final text', async () => {
  const script = '[DELAY_MS:0][invoke_tool:read_entity:{"id":"scene-1"}]'
  const call = { id: 'fake-tool-call-1', type: 'function', function: { name: 'read_entity', arguments: '{"id":"scene-1"}' } }
  const baseMessages = [
    user(script),
    { role: 'assistant', content: null, tool_calls: [call] },
    { role: 'tool', tool_call_id: call.id, content: '{"title":"Scene 1"}' },
  ]
  const defaultFollowUp = await run('', { messages: baseMessages, tools: [tool('read_entity')] })
  assert.equal(defaultFollowUp.result.toolCalls.length, 0)
  assert.equal(defaultFollowUp.content, 'FAKE TEST RESPONSE — tool result received.')

  const customMessages = [
    user('[DELAY_MS:0][invoke_tool:read_entity:{"id":"scene-1"}]Custom final response.'),
    { role: 'assistant', content: null, tool_calls: [call] },
    { role: 'tool', tool_call_id: call.id, content: '{"title":"Scene 1"}' },
  ]
  const customFollowUp = await run('', { messages: customMessages, tools: [tool('read_entity')] })
  assert.equal(customFollowUp.result.toolCalls.length, 0)
  assert.equal(customFollowUp.content, 'Custom final response.')
})

test('request trace is bounded to 20 entries, clones provider-boundary data, and clears', async () => {
  fake.clearFakeProviderTrace()
  for (let index = 0; index < 21; index += 1) {
    await run(`[DELAY_MS:0]trace ${index}`, { thinking: index % 2 === 0 })
  }
  const trace = fake.getFakeProviderTrace()
  assert.equal(trace.length, 20)
  assert.equal(trace[0].emittedContent, 'trace 1')
  assert.equal(trace.at(-1).emittedContent, 'trace 20')
  assert.deepEqual(trace.at(-1).directives, ['DELAY_MS:0'])
  assert.equal(trace.at(-1).outcome, 'complete')
  fake.clearFakeProviderTrace()
  assert.deepEqual(fake.getFakeProviderTrace(), [])
})

test('Fake performs zero network calls even when fetch exists globally', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    throw new Error('network should not be called')
  }
  try {
    const value = await run('[DELAY_MS:0]local only')
    assert.equal(value.content, 'local only')
    assert.equal(calls, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})
